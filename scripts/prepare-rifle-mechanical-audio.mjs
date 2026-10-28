import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3) throw new Error('Usage: node scripts\\prepare-rifle-mechanical-audio.mjs <download-directory>');
const input = resolve(process.argv[2]);
const output = fileURLToPath(new URL('../public/assets/audio/rifle-mechanical/', import.meta.url));
const originals = [
  { file: 'equipment_clicks3.wav', author: 'LFA', source: 'https://opengameart.org/content/equipment-clicks-iii',
    url: 'https://opengameart.org/sites/default/files/equipment_clicks3.wav', bytes: 2021420,
    sha256: '1cd2612f226886a7c0badbe26e9732e097a448e97cbea72a3e3cd2c8aa91ace8',
    evidence: 'Source page lists CC0. Author describes a mixture of bolt-action rifle, stapler and tape-measure recordings.' },
  { file: 'clipload1.wav', author: 'BMacZero (Brian MacIntosh)', source: 'https://opengameart.org/content/gun-reload-sound-effects',
    url: 'https://opengameart.org/sites/default/files/clipload1.wav', bytes: 22572,
    sha256: '1cdc10c50a26834ce7562a5f2925b9aa1118e3bb58a86fea80f34558bf2c5101',
    evidence: 'Source page lists CC0 and says credit to Brian MacIntosh is optional.' },
];
const selections = [
  { file: 'unlock.wav', original: 'equipment_clicks3.wav', startSeconds: .18, seconds: .29 },
  { file: 'extract.wav', original: 'equipment_clicks3.wav', startSeconds: .85, seconds: .24 },
  { file: 'close.wav', original: 'equipment_clicks3.wav', startSeconds: 1.44, seconds: .29 },
  { file: 'load.wav', original: 'clipload1.wav', startSeconds: 0, seconds: .255 },
];
const hash = data => createHash('sha256').update(data).digest('hex');
for (const original of originals) {
  const bytes = await readFile(join(input, original.file));
  if (bytes.length !== original.bytes || hash(bytes) !== original.sha256) throw new Error(`Original differs: ${original.file}`);
}
await mkdir(output, { recursive: true });
const files = [];
for (const selection of selections) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', join(input, selection.original),
    '-ss', String(selection.startSeconds), '-t', String(selection.seconds),
    '-af', 'highpass=f=40', '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${selection.file}: ${result.stderr.toString()}`);
  const raw = result.stdout, length = raw.length / 4;
  if (!Number.isInteger(length) || length < 240) throw new Error(`Invalid decoded recording: ${selection.file}`);
  const values = Array.from({ length }, (_, i) => raw.readFloatLE(i * 4));
  if (values.some(value => !Number.isFinite(value))) throw new Error(`Non-finite samples: ${selection.file}`);
  const mean = values.reduce((sum, value) => sum + value, 0) / length;
  const peak = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value - mean)), 0);
  if (peak < .001) throw new Error(`Silent selection: ${selection.file}`);
  const wave = Buffer.alloc(44 + length * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
  wave.writeUInt32LE(length * 2, 40);
  values.forEach((value, i) => {
    const fade = Math.min(1, i / 24, (length - 1 - i) / 360);
    wave.writeInt16LE(Math.round((value - mean) / peak * .65 * fade * 32767), 44 + i * 2);
  });
  await writeFile(join(output, selection.file), wave);
  files.push({ ...selection, bytes: wave.length, sha256: hash(wave), duration: length / 24000 });
}
const metadata = {
  asset: 'Independent rifle mechanical Foley candidate', license: 'CC0-1.0',
  source: 'https://opengameart.org/content/equipment-clicks-iii',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  verified: '2026-10-27', purpose: 'Controlled personal rifle mechanical feedback, driven by original weapon.mechanical events in the main game.',
  originals, files,
  processing: ['FFmpeg mono 24kHz resampling and 40Hz high-pass', 'Fixed excerpts without time stretching',
    'DC removal, peak bounded to 0.65, 1ms attack and 15ms tail fades', '16-bit PCM WAV'],
  limitations: [
    'The mixed LFA recording contains a rifle, stapler and tape measure; the object producing each excerpt is not verified.',
    'Cue mappings are Foley choices, not verified Type 24 or Japanese rifle mechanisms.',
    'extract means bolt extraction motion, not proof of an ejected case or a case striking the ground.',
    'load is generic clip-loading audio, not a verified period five-round stripper-clip recording.',
    'No independent listening acceptance or battlefield mix acceptance is claimed.',
    'Regeneration requires FFmpeg; different FFmpeg versions may change hashes and require explicit review.',
  ],
};
await writeFile(join(output, 'source.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ output, files, totalAudioBytes: files.reduce((sum, file) => sum + file.bytes, 0) }, null, 2));
