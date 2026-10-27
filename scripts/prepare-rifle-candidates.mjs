import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv.length !== 3) throw new Error('Usage: node scripts\\prepare-rifle-candidates.mjs <source-directory>');
const input = resolve(process.argv[2]);
const output = fileURLToPath(new URL('../audio-study/assets/', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const library = 'https://opengameart.org/content/the-free-firearm-sound-library';
const authors = 'Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney';
const selections = [
  { file: 'current.wav', title: 'A · 当前游戏音源', author: 'kurt',
    path: fileURLToPath(new URL('../public/assets/audio/recorded-rifle/report.wav', import.meta.url)),
    source: 'https://opengameart.org/content/gunshots',
    bytes: 28844, sha256: 'e414ff77b2fc14bc39205997629375351450d154cd83638c900b78b8d64a2349',
    note: '枪型未知的现有片段，仅作为对照；原素材已有削波记录。', search: null },
  { file: 'arisaka-near.wav', title: 'B · Arisaka 近距录音', author: authors,
    path: join(input, 'Prepared SFX Library', 'Arisaka', 'E_25P.wav'), source: library,
    bytes: 3862686, sha256: '0f0190fb6826fb167b4eb5f1d2df25372b0c220d64633446d9e4ab48c018630d',
    note: '源库标注 Arisaka、栓动、.30-06、枪手前方近距；不是已确认的原装三八式或射手耳位录音。', search: [.45, .8] },
  { file: 'mosin-near.wav', title: 'C · 莫辛步枪近距录音', author: authors,
    path: join(input, 'Prepared SFX Library', 'Mosin Nagant', 'M_21P.wav'), source: library,
    bytes: 9864044, sha256: '970ed2322ba61579dc8afaefb4f25e6ae791a3acb1e6e23372ea948cfe2a97b3',
    note: '源库标注 Mosin Nagant、栓动、7.62×54、枪手前方近距；是音色候选，不冒充中正式录音。', search: [.95, 1.3] },
];
const clips = [];
for (const selection of selections) {
  const original = await readFile(selection.path);
  if (original.length !== selection.bytes || hash(original) !== selection.sha256) {
    throw new Error(`Source differs: ${selection.file}`);
  }
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', selection.path,
    '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 });
  if (decoded.error) throw decoded.error;
  if (decoded.status !== 0) throw new Error(`FFmpeg failed: ${decoded.stderr.toString()}`);
  const samples = Array.from({ length: decoded.stdout.length / 4 }, (_, i) => decoded.stdout.readFloatLE(i * 4));
  if (!samples.length || samples.some(value => !Number.isFinite(value))) throw new Error('Invalid decoded samples');
  let start = 0;
  if (selection.search) {
    const [from, to] = selection.search.map(seconds => Math.round(seconds * 24000));
    const peak = samples.slice(from, to).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    if (peak < .01) throw new Error(`Expected shot missing: ${selection.file}`);
    let onset = from;
    while (onset < to && Math.abs(samples[onset]) < peak * .12) onset++;
    start = Math.max(0, onset - 144);
  }
  const values = samples.slice(start, start + 14400);
  if (values.length !== 14400) throw new Error(`Incomplete shot: ${selection.file}`);
  if (selection.search) {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    for (let i = 0; i < values.length; i++) {
      values[i] = (values[i] - mean) * Math.min(1, i / 12, (values.length - 1 - i) / 600);
    }
  }
  const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
  const peak = values.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (rms < .00001) throw new Error(`Silent selection: ${selection.file}`);
  clips.push({ selection, values, start, rms, peak });
}
// A common RMS low enough for every excerpt avoids compressing the sharper candidates.
const targetRms = Math.min(...clips.map(clip => clip.rms * .7 / clip.peak));
await mkdir(output, { recursive: true });
const files = [];
for (const clip of clips) {
  const gain = targetRms / clip.rms, wave = Buffer.alloc(44 + 14400 * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
  wave.writeUInt32LE(14400 * 2, 40);
  clip.values.forEach((value, i) => wave.writeInt16LE(Math.round(value * gain * 32767), 44 + i * 2));
  await writeFile(join(output, clip.selection.file), wave);
  const { path, search, ...selection } = clip.selection;
  files.push({ file: selection.file, title: selection.title, note: selection.note, bytes: wave.length, sha256: hash(wave),
    original: { file: selection.file === 'current.wav' ? 'public/assets/audio/recorded-rifle/report.wav' :
      selection.file === 'arisaka-near.wav' ? 'Prepared SFX Library/Arisaka/E_25P.wav' : 'Prepared SFX Library/Mosin Nagant/M_21P.wav',
    author: selection.author, source: selection.source, bytes: selection.bytes, sha256: selection.sha256 },
    selection: { startSeconds: clip.start / 24000, duration: .6, gain, sourceExcerptRms: clip.rms, sourceExcerptPeak: clip.peak } });
}
const metadata = {
  asset: 'Free rifle report listening comparison', license: 'CC0-1.0',
  source: library, licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', verified: '2026-10-27',
  licenseEvidence: 'The source page quotes the team: CC0 NO RIGHTS RESERVED; any application, personal or professional, without royalty or credit.',
  archive: { url: 'https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z', bytes: 193954738,
    sha256: 'cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6' },
  use: 'Development-only audition; not loaded by the game or included in its production entry.',
  feedback: { preferredReference: 'current.wav', rejectedCandidates: ['arisaka-near.wav', 'mosin-near.wav'],
    basis: 'User found B and C worse than current A. Keep the existing game sound; this is not acceptance of A tone or historical authenticity.' },
  processing: ['FFmpeg mono 24kHz decode; fixed 0.6s excerpts', 'New candidates: DC removal, 0.5ms attack and 25ms tail fades',
    'All three excerpts matched to common whole-window RMS using constant gain; no added compression or pitch shift', '16-bit PCM WAV'],
  targetRms, files,
  limitations: ['RMS matching is an electrical-level comparison, not proof of equal perceived loudness.',
    'Library recordings are prepared effects, contain full-scale source samples, and are not certified unclipped or unprocessed masters.',
    'Gun and cartridge labels are the library metadata, not an independent firearm identification.',
    'Arisaka is labelled .30-06; no original Type 38 cartridge or exact model is verified.',
    'Both new candidates were recorded in front of the shooter, not at the shooter ear.',
    'A 0.6s excerpt truncates the original environmental tail and may not represent the full report.',
    'No independent listening, historical-authenticity or in-game sound acceptance is claimed.'],
};
await writeFile(join(output, 'source.json'), JSON.stringify(metadata, null, 2) + '\n');
await writeFile(join(output, 'LICENSE.txt'), `CC0 1.0 Universal\nhttps://creativecommons.org/publicdomain/zero/1.0/\n\n` +
  `New recordings: ${authors}\n${library}\n` +
  `Source statement: "CC0 NO RIGHTS RESERVED" and use "for any application, personal or professional".\n\n` +
  `Current-game reference: kurt\nhttps://opengameart.org/content/gunshots\nCC0; "None needed" attribution notice.\n` +
  `See source.json for original hashes, selections, processing and authenticity limitations.\n`);
console.log(JSON.stringify({ output, targetRms, files: files.map(file => ({ file: file.file, selection: file.selection })) }, null, 2));
