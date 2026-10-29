import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { ADDITIONAL_REACTION_CLIPS } from '../src/battle-reaction-clips.js';

const hash = data => createHash('sha256').update(data).digest('hex');
const kind = process.argv[2], input = process.argv[3] && resolve(process.argv[3]);
if (!input || !['reactions', 'machine-gun'].includes(kind)) {
  throw new Error('Usage: node scripts\\prepare-combat-recordings.mjs <reactions|machine-gun> <reviewed-source>');
}
const original = await readFile(input), originalHash = hash(original);
const expected = kind === 'reactions' ? 'e9100a4e3b9dcd146993089970dc6097dcf9935fa4683b196040012bad65d67a'
  : '6d744d3c82244de278f9dac2c6f4792bdfcf4ae15869befef590f6b7844be46b';
if (originalHash !== expected) throw new Error('Input differs from the reviewed recording');
const output = fileURLToPath(new URL(`../public/assets/audio/${kind === 'reactions' ? 'battle-reactions' : 'machine-gun'}/`, import.meta.url));
await mkdir(output, { recursive: true });

function wave(data, trim) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', 'pipe:0',
    '-ac', '1', '-ar', '24000', '-f', 'f32le', 'pipe:1'], { input: data, maxBuffer: 8 * 1024 * 1024 });
  const firstSample = trim ? Math.round(trim.start * 24000) : 0;
  const sampleCount = trim ? Math.round(trim.duration * 24000) : raw.length / 4;
  if ((firstSample + sampleCount) * 4 > raw.length) throw new Error('Excerpt exceeds source duration');
  let samples = Array.from({ length: sampleCount }, (_, i) => raw.readFloatLE((firstSample + i) * 4));
  const peak = samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
  if (!Number.isFinite(peak) || peak < .001) throw new Error('Silent or invalid recording');
  if (!trim) {
    let first = samples.findIndex(value => Math.abs(value) > peak * .025), last = samples.length - 1;
    while (last > first && Math.abs(samples[last]) < peak * .025) last--;
    samples = samples.slice(Math.max(0, first - 120), Math.min(samples.length, last + 241));
  }
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => bytes.writeInt16LE(Math.round(value / peak * .65 *
    Math.min(1, i / 24, (samples.length - 1 - i) / 192) * 32767), 44 + i * 2));
  return { bytes, duration: samples.length / 24000 };
}
const files = [];
async function save(file, data, selection, trim = null, maxDuration = 2) {
  const result = wave(data, trim);
  if (result.duration < .08 || result.duration > maxDuration) throw new Error(`Invalid combat recording: ${file}`);
  await writeFile(join(output, file), result.bytes);
  files.push({ file, ...selection, duration: result.duration, bytes: result.bytes.length, sha256: hash(result.bytes) });
}
let metadata;
if (kind === 'reactions') {
  const selections = [
    { hurt: ['1yell1', '1yell8'], cover: ['1yell2', '1yell14'], charge: ['1yell10', '1yell15'] },
    { hurt: ['2yell1', '2yell3'], cover: ['2yell10', '2yell2'], charge: ['2yell7', '2yell8'] },
    { hurt: ['3grunt3', '3grunt4'], cover: ['3yell3', '3yell7'], charge: ['3yell8', '3yell12'] },
  ];
  for (const [variant, cues] of selections.entries()) for (const [cue, names] of Object.entries(cues)) {
    for (const [take, name] of names.entries()) {
      const data = execFileSync('python', ['-c',
        'import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
        input, `yelling sounds/${name}.wav`], { maxBuffer: 2 * 1024 * 1024 });
      await save(`${variant}-${cue}-${take}.wav`, data, { variant, cue, original: `${name}.wav`, originalSha256: hash(data) });
    }
  }
  for (const clip of ADDITIONAL_REACTION_CLIPS) {
    const data = execFileSync('python', ['-c',
      'import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
      input, `yelling sounds/${clip.original}`], { maxBuffer: 4 * 1024 * 1024 });
    await save(clip.file, data, { ...clip, originalSha256: hash(data) }, null, clip.maxDuration);
  }
  metadata = { asset: 'Wordless male combat reactions', author: 'HaelDB', license: 'CC0-1.0',
    source: 'https://opengameart.org/content/male-gruntyelling-sounds',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    archive: { url: 'https://opengameart.org/sites/default/files/yelling%20sounds.zip', sha256: originalHash },
    licenseEvidence: 'Author page offers OGA-BY 3.0 and CC0 as alternative licenses; CC0 selected.',
    limitations: ['Wordless human vocals shared across factions, not Chinese/Japanese spoken performances or historical recordings.',
      'The original 18 clips use three performer groups and two takes per cue. Twelve extra hurt takes are shared across both factions and voice variants, including a fourth performer group.',
      'All twelve audition candidates retained by the user; 08-12 preferred. This does not independently establish a pain/fear/despair classification or historical authenticity.'],
    selection: { trigger: 'Actual infantry damage only; existing probability, range and cooldowns unchanged.',
      originalVariantHurtWeight: 1, additionalWeights: '01-07: 1 each; 08-12: 3 each.',
      noImmediateHurtRepeat: true, maximumExtraDuration: 4.5 } };
} else {
  // The source fires approximately every 100ms. Each excerpt ends before the next report.
  for (const [take, start] of [.674, .774, .874].entries()) {
    await save(`shot-${take}.wav`, original, { take, startSeconds: start }, { start, duration: .095 });
  }
  metadata = { asset: 'Shared light-machine-gun single shots selected by the user', author: 'Foisal72',
    license: 'Pixabay-Content-License', licenseUrl: 'https://pixabay.com/service/license-summary/',
    source: 'https://pixabay.com/sound-effects/film-special-effects-gun-fire-346766/',
    original: { file: 'foisal72-gun-fire-346766.mp3', sha256: originalHash, bytes: original.length },
    licenseEvidence: 'User supplied the recording. Indexed asset result identifies Gun fire by Foisal72 under Pixabay Content License. Direct asset and license page requests returned HTTP 403.',
    limitations: ['Not CC0. Independent verification of redistribution terms is still required before public release.',
      'Only use as integrated game audio, not a standalone sound pack.',
      'Not verified recordings of ZB-26 or Type 11; no independent listening acceptance is claimed.'] };
}
metadata.processing = ['FFmpeg mono 24kHz, 16-bit PCM', 'Peak bounded to 0.65; 1ms attack and 8ms tail fades',
  kind === 'reactions' ? 'Trim leading/trailing silence only; no pitch change' : 'Three 95ms single-shot excerpts; no burst loop or source pauses'];
metadata.files = files;
await writeFile(join(output, 'source.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(`Prepared ${files.length} ${kind} clips`);
