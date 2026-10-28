import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3) throw new Error('Usage: node scripts\\prepare-enemy-rifle-audio.mjs <source-mp3>');
const input = resolve(process.argv[2]), raw = await readFile(input);
const hash = data => createHash('sha256').update(data).digest('hex');
if (hash(raw) !== 'fa77589d088a844f741850fc5667ba37ada6542320b843c5785a3a6246d7a2fb') {
  throw new Error('Enemy rifle input differs from the reviewed user-supplied recording');
}
const output = fileURLToPath(new URL('../public/assets/audio/enemy-rifle/', import.meta.url));
await mkdir(output, { recursive: true });
const decoded = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', input,
  '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1']);
let peak = 0;
for (let offset = 0; offset < decoded.length; offset += 4) peak = Math.max(peak, Math.abs(decoded.readFloatLE(offset)));
if (!Number.isFinite(peak) || peak < .001) throw new Error('Silent or invalid rifle recording');
// Remove MP3 encoder lead-in, but retain the complete report and reverberation.
const processing = `atrim=start=0.0460416667,asetpts=PTS-STARTPTS,volume=${.65 / peak},afade=t=in:d=0.0005,afade=t=out:st=3.02:d=0.054`;
execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', input,
  '-af', processing, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le',
  '-map_metadata', '-1', '-fflags', '+bitexact', join(output, 'report.wav')]);
const bytes = await readFile(join(output, 'report.wav'));
const metadata = {
  asset: 'Japanese infantry rifle report selected by the user', author: 'morganpurkis',
  license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  source: 'https://freesound.org/people/morganpurkis/sounds/391847/',
  original: { file: 'freesound_community-single-gunshot-54-40780.mp3', bytes: raw.length, sha256: hash(raw),
    title: 'Single Gunshot 5.4.wav',
    discovery: 'https://pixabay.com/sound-effects/film-special-effects-single-gunshot-54-40780/' },
  licenseEvidence: 'Original Freesound author page explicitly offers Creative Commons 0; Pixabay page could not be fetched.',
  identityEvidence: {
    preview: 'https://cdn.freesound.org/previews/391/391847_5937039-lq.mp3',
    sha256: '487637cc83e1cd090cc6538e05aba640e1d0fd31b9dcb10ca5ce7301cf075800',
    alignedWaveformCorrelation: 0.9997787450604955,
    comparison: 'Mono 24kHz, 0.6 seconds aligned by peak; user MP3 delayed by 1105 samples relative to the author preview.',
  },
  processing: ['Mono 24kHz 16-bit PCM', 'Remove 1105 samples of encoder lead-in',
    'Normalize decoded peak to 0.65 before integer PCM conversion to avoid additional clipping',
    '0.5ms attack and 54ms final tail fade; full report retained; no pitch change'],
  limitations: ['Not a verified Arisaka or historical Japanese rifle recording.',
    'Decoded MP3 exceeds full scale; normalization does not restore clipping already in the source.',
    'Source identity supported by waveform comparison, not byte identity with the original WAV.',
    'No independent listening acceptance is claimed.'],
  files: [{ file: 'report.wav', bytes: bytes.length, sha256: hash(bytes) }],
};
await writeFile(join(output, 'source.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(`Prepared enemy rifle recording: ${bytes.length} bytes`);
