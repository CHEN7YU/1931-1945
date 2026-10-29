import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { battleVoiceClips } from '../src/battle-voice-lines.js';

export const VOICE_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const hash = data => createHash('sha256').update(data).digest('hex');
const xml = text => text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

export function voiceSSML(clip) {
  const text = clip.pauseMs
    ? clip.text.split(/[!！。]/u).map(part => part.trim()).filter(Boolean).map(xml).join(`<break time="${clip.pauseMs}ms"/>`) + '！'
    : xml(clip.text);
  const speech = `<prosody rate="${clip.rate}" pitch="${clip.pitch}" volume="loud">${text}</prosody>`;
  const styled = clip.style ? `<mstts:express-as style="${clip.style}" styledegree="${clip.styledegree ?? '1.5'}">${speech}</mstts:express-as>` : speech;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${clip.locale}"><voice name="${clip.voice}">${styled}</voice></speak>`;
}

export function voiceSynthesisHash(clip) {
  const synthesisHash = hash(`${clip.delivery ? 'raw-24khz-16bit-mono-pcm\nword-boundaries' : VOICE_FORMAT}\n${voiceSSML(clip)}`);
  if (clip.delivery && synthesisHash !== clip.delivery.sourceSynthesisHash) {
    throw new Error(`Reviewed delivery text or voice parameters changed: ${clip.file}; approve a new take before changing its source evidence.`);
  }
  return synthesisHash;
}

function azureToken() {
  const args = ['account', 'get-access-token', '--resource', 'https://cognitiveservices.azure.com', '--query', 'accessToken', '-o', 'tsv', '--only-show-errors'];
  try {
    const token = (process.platform === 'win32'
      ? execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `az ${args.join(' ')}`], { encoding: 'utf8', stdio: 'pipe', windowsHide: true })
      : execFileSync('az', args, { encoding: 'utf8', stdio: 'pipe' })).trim();
    if (!token || /\s/.test(token)) throw new Error('Empty Azure token');
    return token;
  } catch {
    throw new Error('Azure login token unavailable. Sign in with az login for the Speech resource tenant; no token is written to disk.');
  }
}

export async function generateBattleVoices({ cacheOnly = false,
  approvedDirectory = process.env.BATTLE_VOICE_APPROVED_DELIVERY_DIR } = {}) {
  const region = process.env.AZURE_SPEECH_REGION;
  const resourceId = process.env.AZURE_SPEECH_RESOURCE_ID;
  if (!cacheOnly && (!/^[a-z0-9]+$/.test(region ?? '') ||
    !/^\/subscriptions\/[a-f0-9-]+\/resourceGroups\/[\w.-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[\w.-]+$/i.test(resourceId ?? ''))) {
    throw new Error('Set AZURE_SPEECH_REGION and AZURE_SPEECH_RESOURCE_ID for an existing Speech resource. Uses Azure CLI Entra login, not a subscription key.');
  }
  const root = fileURLToPath(new URL('../public/assets/audio/battle-voices/', import.meta.url));
  await mkdir(root, { recursive: true });
  let previous = { files: [] };
  try { previous = JSON.parse(await readFile(join(root, 'source.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices`;
  let authorization, available;
  if (!cacheOnly) {
    authorization = `Bearer aad#${resourceId}#${azureToken()}`;
    const voicesResponse = await fetch(`${endpoint}/voices/list`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(30000) });
    if (!voicesResponse.ok) throw new Error(`Azure voice list HTTP ${voicesResponse.status}: check Speech User RBAC and region.`);
    available = await voicesResponse.json();
  }
  const files = [], clips = battleVoiceClips();
  for (const clip of clips) {
    if (!cacheOnly) {
      const voice = available.find(item => item.ShortName === clip.voice && item.Gender === 'Male' && item.Locale === clip.locale);
      if (!voice || clip.style && !voice.StyleList?.includes(clip.style)) throw new Error(`Required male voice/style is unavailable: ${clip.voice}`);
    }
    const ssml = voiceSSML(clip), synthesisHash = voiceSynthesisHash(clip);
    if (clip.delivery) {
      let bytes;
      try { bytes = await readFile(join(root, clip.file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (bytes && hash(bytes) !== clip.delivery.sha256) throw new Error(`Reviewed delivery is corrupt: ${clip.file}`);
      if (!bytes) {
        if (!approvedDirectory) throw new Error(`Restore ${clip.file} or set BATTLE_VOICE_APPROVED_DELIVERY_DIR to the reviewed audition WAV folder; never synthesize an unreviewed replacement.`);
        bytes = await readFile(join(approvedDirectory, clip.delivery.sourceFile));
        if (hash(bytes) !== clip.delivery.sha256) throw new Error(`Approved audition hash mismatch: ${clip.delivery.sourceFile}`);
        await writeFile(join(root, `${clip.file}.tmp`), bytes);
        await rename(join(root, `${clip.file}.tmp`), join(root, clip.file));
      }
      files.push({ ...clip, gender: 'Male', bytes: bytes.length, sha256: hash(bytes), synthesisHash,
        format: 'riff-24khz-16bit-mono-pcm',
        processing: 'Reviewed audition WAV, unchanged. Azure word boundaries located ah; only that syllable was stretched with pitch/formant preservation and 5ms joins. Other syllables reuse the same synthesis, apart from level normalization and PCM quantization.' });
      console.log(`${files.length}/${clips.length} reviewed ${clip.file}`);
      continue;
    }
    const old = previous.files.find(item => item.file === clip.file && item.synthesisHash === synthesisHash);
    let bytes = null;
    if (old && old.gender === 'Male') {
      try { bytes = await readFile(join(root, clip.file)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (bytes && hash(bytes) !== old.sha256) bytes = null;
    }
    if (!bytes) {
      if (cacheOnly) throw new Error(`Missing or changed MP3 cache in --cache-only mode: ${clip.file}; no Azure synthesis was attempted.`);
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(`${endpoint}/v1`, { method: 'POST',
          headers: { Authorization: authorization, 'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': VOICE_FORMAT, 'User-Agent': 'EmbersOfChinaVoicePreparation' },
          body: ssml, signal: AbortSignal.timeout(60000) });
        if (![429, 503].includes(response.status) || attempt === 3) break;
        const retry = Math.min(30, Math.max(1, Number(response.headers.get('retry-after')) || 2 ** attempt));
        await response.body?.cancel();
        await new Promise(done => setTimeout(done, retry * 1000));
      }
      if (!response.ok) {
        const detail = (await response.text()).replaceAll(authorization, '[redacted]')
          .replace(/eyJ[\w.-]+/g, '[redacted]').slice(0, 500);
        throw new Error(`Azure synthesis HTTP ${response.status} for ${clip.file}: ${detail}`);
      }
      bytes = Buffer.from(await response.arrayBuffer());
      const mp3 = bytes.subarray(0, 3).toString() === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
      if (bytes.length < 500 || !mp3) throw new Error(`Azure did not return MP3 audio for ${clip.file}`);
      await writeFile(join(root, `${clip.file}.tmp`), bytes);
      await rename(join(root, `${clip.file}.tmp`), join(root, clip.file));
    }
    files.push({ ...clip, gender: 'Male', bytes: bytes.length, sha256: hash(bytes), synthesisHash });
    console.log(`${files.length}/${clips.length} ${clip.file}`);
  }
  const retained = new Set(files.map(file => file.file));
  const metadata = { provider: 'Azure AI Speech', generatedAt: new Date().toISOString(),
    source: 'https://learn.microsoft.com/azure/ai-services/speech-service/text-to-speech',
    license: 'Azure-generated-speech', licenseUrl: 'https://www.microsoft.com/licensing/terms/productoffering/MicrosoftAzure/MCA',
    provenance: 'Original fictional game dialogue, synthesized with stock male neural voices. Not historical recordings or cloned voices; not CC0. Use is subject to the Azure agreement.',
    format: 'mixed', defaultFormat: VOICE_FORMAT, files };
  await writeFile(join(root, 'source.json.tmp'), `${JSON.stringify(metadata, null, 2)}\n`);
  await rename(join(root, 'source.json.tmp'), join(root, 'source.json'));
  // Publish the replacement catalog before retiring audio referenced by the previous one.
  for (const old of previous.files.filter(file => !retained.has(file.file))) {
    if (!/^(friendly|enemy)-\d+-[a-z0-9-]+\.(mp3|wav)$/.test(old.file)) throw new Error(`Unsafe retired voice filename: ${old.file}`);
    try { await unlink(join(root, old.file)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  console.log(`Generated ${files.length} clips (${files.reduce((sum, item) => sum + item.bytes, 0)} bytes).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateBattleVoices({ cacheOnly: process.argv.includes('--cache-only') });
}
