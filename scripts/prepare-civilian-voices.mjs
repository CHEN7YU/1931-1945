import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { azureToken, voiceSSML, VOICE_FORMAT } from './prepare-battle-voices.mjs';
import { civilianVoiceClips } from '../src/civilian-voice-lines.js';

const cacheOnly = process.argv.includes('--cache-only');
const region = process.env.AZURE_SPEECH_REGION, resource = process.env.AZURE_SPEECH_RESOURCE_ID;
if (!cacheOnly && (!/^[a-z0-9]+$/.test(region ?? '') ||
  !/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[\w.-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w.-]+$/i.test(resource ?? '')))
  throw new Error('Set AZURE_SPEECH_REGION and AZURE_SPEECH_RESOURCE_ID for an existing resource');
const hash = data => createHash('sha256').update(data).digest('hex');
const root = fileURLToPath(new URL('../public/assets/audio/civilian-voices/', import.meta.url));
await mkdir(root, { recursive: true });
let previous = { files: [] };
try { previous = JSON.parse(await readFile(join(root, 'source.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
try {
  const pending = JSON.parse(await readFile(join(root, 'source.json.tmp'), 'utf8'));
  if ((pending.attemptedSSMLCharacters ?? 0) >= (previous.attemptedSSMLCharacters ?? 0)) previous = pending;
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const manifest = { provider: 'Azure AI Speech', format: VOICE_FORMAT,
  source: 'https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech',
  license: 'Azure-generated-speech',
  licenseUrl: 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA',
  provenance: 'Original fictional civilian dialogue. Stock neural voices with supported age roles; not historical recordings, real survivors, cloned voices or CC0.',
  generatedAt: new Date().toISOString(), requestedBudgetUSD: 50, requestSSMLCharacterLimit: 200000,
  budgetPerPhaseUSD: { retreat: 50, opening: 50 },
  budgetBasis: '200,000 SSML characters per phase, including retries. Standard S1 Neural retail meter in Sweden Central: USD 15 per million characters (2026-11-02). Counting full XML overestimates billable text; this is a synthesis guard, not an Azure subscription spending cap or invoice.',
  attemptedSSMLCharacters: previous.attemptedSSMLCharacters ?? 0,
  attemptedCharactersByPhase: previous.attemptedCharactersByPhase ??
    { retreat: previous.attemptedSSMLCharacters ?? 0, opening: 0 }, files: [...previous.files] };
const replaceFile = async (from, to) => {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 7) throw error;
      await new Promise(done => setTimeout(done, 75 * (attempt + 1)));
    }
  }
};
let authorization, available;
if (!cacheOnly) {
  authorization = `Bearer aad#${resource}#${azureToken()}`;
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
    { headers: { Authorization: authorization }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Azure voice list HTTP ${response.status}`);
  available = await response.json();
}
const publish = async () => {
  await writeFile(join(root, 'source.json.tmp'), `${JSON.stringify(manifest, null, 2)}\n`);
  await replaceFile(join(root, 'source.json.tmp'), join(root, 'source.json'));
};
const clips = civilianVoiceClips();
// Validate the whole requested batch before sending any billable synthesis requests.
if (!cacheOnly) for (const clip of clips) {
  const voice = available.find(item => item.ShortName === clip.voice &&
    (clip.role ? true : item.Gender === clip.gender));
  if (!voice?.StyleList?.includes(clip.style) || clip.role && !voice.RolePlayList?.includes(clip.role))
    throw new Error(`Unsupported voice, style or age role: ${clip.file}`);
}
for (const clip of clips) {
  const ssml = voiceSSML(clip), synthesisHash = hash(`${VOICE_FORMAT}\n${ssml}`);
  const old = manifest.files.find(file => file.file === clip.file && file.synthesisHash === synthesisHash);
  let bytes;
  if (old) {
    try { bytes = await readFile(join(root, clip.file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (bytes && hash(bytes) !== old.sha256) bytes = null;
  }
  if (!bytes) {
    if (cacheOnly) throw new Error(`Civilian voice missing or changed: ${clip.file}`);
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (manifest.attemptedCharactersByPhase[clip.phase] + ssml.length > manifest.requestSSMLCharacterLimit)
        throw new Error('Civilian synthesis character budget reached; no further paid requests sent');
      manifest.attemptedSSMLCharacters += ssml.length;
      manifest.attemptedCharactersByPhase[clip.phase] += ssml.length;
      await publish();
      response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': VOICE_FORMAT }, body: ssml, signal: AbortSignal.timeout(60000),
      });
      if (![429, 503].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      await new Promise(done => setTimeout(done, 2000 * (attempt + 1)));
    }
    if (!response.ok) throw new Error(`Civilian synthesis ${clip.file}: Azure HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 500 || !(bytes.subarray(0, 3).toString() === 'ID3' ||
      bytes[0] === 255 && (bytes[1] & 224) === 224)) throw new Error(`Invalid MP3: ${clip.file}`);
    await writeFile(join(root, `${clip.file}.tmp`), bytes);
    await replaceFile(join(root, `${clip.file}.tmp`), join(root, clip.file));
  }
  manifest.files = manifest.files.filter(file => file.file !== clip.file);
  manifest.files.push({ ...clip, bytes: bytes.length, sha256: hash(bytes), synthesisHash });
  await publish();
  console.log(`${manifest.files.length}/${clips.length} ${clip.file}`);
}
console.log(`Cached ${manifest.files.length} civilian clips; ${manifest.attemptedSSMLCharacters} SSML characters requested in total.`);
