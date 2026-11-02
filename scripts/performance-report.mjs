import { execFileSync } from 'node:child_process';
import { writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--mode', '--since', '--until', '--build', '--map', '--session', '--out'].includes(name) || !value) {
    throw new Error('Use --mode summary|export [--since ISO --until ISO --build SHA --map ID --session UUID --out FILE]');
  }
  args.set(name.slice(2), value);
}
const mode = args.get('mode') ?? 'summary';
if (!['summary', 'export'].includes(mode)) throw new Error('Mode must be summary or export');
const tokenFromWindows = () => execFileSync('python', ['-c', `
import base64, ctypes, json, os
from pathlib import Path
from ctypes import wintypes
class Blob(ctypes.Structure):
    _fields_ = [('length', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
path = Path(os.environ['LOCALAPPDATA']) / 'ShanHe' / 'feedback-secrets.dpapi.json'
record = json.loads(path.read_text(encoding='utf-8'))
if record.get('worker') != '1931-1945' or record.get('encoding') != 'base64 CryptProtectData':
    raise RuntimeError('Unexpected encrypted administrator credential record')
data = base64.b64decode(record['secrets']['FEEDBACK_ADMIN_TOKEN'])
buffer = ctypes.create_string_buffer(data)
source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
out = Blob()
crypt = ctypes.WinDLL('crypt32', use_last_error=True)
crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
crypt.CryptUnprotectData.restype = wintypes.BOOL
if not crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(out)):
    raise ctypes.WinError(ctypes.get_last_error())
try:
    print(ctypes.string_at(out.data, out.length).decode('ascii'))
finally:
    kernel = ctypes.WinDLL('kernel32')
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree(out.data)
`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
let token = process.env.FEEDBACK_ADMIN_TOKEN;
if (!token && process.platform === 'win32') {
  try { token = tokenFromWindows(); }
  catch { throw new Error('Cannot read the Windows-user-encrypted administrator credential; alternatively set FEEDBACK_ADMIN_TOKEN locally. Never paste it into chat or source.'); }
}
if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) throw new Error('A valid local FEEDBACK_ADMIN_TOKEN is required');
const origin = 'https://1931-1945.shan-he.workers.dev';
const params = new URLSearchParams({
  since: args.get('since') ?? new Date(Date.now() - 86400000).toISOString(),
  until: args.get('until') ?? new Date().toISOString(),
});
for (const name of ['build', 'map', 'session']) if (args.has(name)) params.set(name, args.get(name));
async function get(path) {
  const response = await fetch(`${origin}${path}?${params}`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Performance API HTTP ${response.status}`);
  return response.json();
}
if (mode === 'summary') {
  const result = await get('/api/performance/summary');
  if (args.has('out')) await writeFile(resolve(args.get('out')), JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
} else {
  if (!args.has('out')) throw new Error('Export requires --out for a new private JSONL output file');
  const path = resolve(args.get('out')), file = await open(path, 'wx');
  let after = 0, reports = 0, complete = false;
  try {
    for (let page = 0; page < 200; page++) {
      params.set('after', String(after)); params.set('limit', '50');
      const result = await get('/api/performance');
      if (!Number.isInteger(result.nextCursor) || result.nextCursor < after ||
        result.hasMore && result.nextCursor === after) throw new Error('Non-advancing performance cursor');
      for (const item of result.items) { await file.write(JSON.stringify(item) + '\n'); reports++; }
      after = result.nextCursor;
      if (!result.hasMore) { complete = true; break; }
    }
    if (!complete) throw new Error('Export page bound reached; partial output retained and marked incomplete');
  } finally {
    await file.close();
    await writeFile(`${path}.meta.json`, JSON.stringify({ origin, schemaVersion: 1, filters: Object.fromEntries(params),
      complete, reports, lastCursor: after, exportedAt: new Date().toISOString() }, null, 2), { flag: 'wx' });
  }
  console.log(`Exported ${reports} reports to the requested private JSONL file; complete=${complete}`);
}
