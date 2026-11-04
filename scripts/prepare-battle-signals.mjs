import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const [whistlePath, ...extra] = process.argv.slice(2);
if (!whistlePath || extra.length) throw new Error('Provide only the reviewed SpliceSound whistle WAV');
const output = resolve('public\\assets\\audio\\battle-signals');
await mkdir(output, { recursive: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [
  { id: 'whistle', author: 'SpliceSound', license: 'CC0-1.0',
    source: 'https://commons.wikimedia.org/wiki/File:218318_splicesound_referee-whistle-blow-gymnasium.wav',
    originalPage: 'https://freesound.org/people/SpliceSound/sounds/218318/',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    download: 'https://upload.wikimedia.org/wikipedia/commons/7/7d/218318_splicesound_referee-whistle-blow-gymnasium.wav',
    sha256: sha256(await readFile(whistlePath)) },
];
const files = [];
if (sources[0].sha256 !== '6659d56633874aba1b03a1639df8019eef0fe57569ea98159e16d1273041c509')
  throw new Error('Signal input differs from the reviewed instrument recordings');
for (const [file, input, team, filter] of [
  ['enemy-whistle.wav', whistlePath, 'enemy', 'atrim=start=0.08:end=0.60,asetpts=PTS-STARTPTS,highpass=f=650,lowpass=f=6500,atempo=0.5,atempo=0.5,afade=t=in:d=0.012,afade=t=out:st=1.85:d=0.16'],
]) {
  const bytes = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', resolve(input), '-af', filter,
    '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'], { maxBuffer: 2 * 1024 * 1024 });
  await writeFile(join(output, file), bytes);
  files.push({ file, team, sourceId: 'whistle', bytes: bytes.length, sha256: sha256(bytes),
    processing: filter + '; mono 24kHz PCM16; no synthetic instrument replacement' });
}
await writeFile(join(output, 'source.json'), JSON.stringify({
  sourceKind: 'reviewed-instrument-recordings', license: 'CC0-1.0',
  source: 'https://commons.wikimedia.org/', sources, files,
  limitations: ['The whistle is a modern referee whistle recorded indoors, not an original Japanese military recording.'],
}, null, 2) + '\n');
console.log(JSON.stringify({ files: files.map(({ file, bytes }) => ({ file, bytes })) }));
