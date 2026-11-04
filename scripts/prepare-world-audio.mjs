import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const paths = process.argv.slice(2);
if (paths.length !== 4) throw new Error('Provide reviewed Kenney ZIP, water ZIP, heavy-engine WAV and propeller WAV');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = [
  '029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8',
  '7cd39abb49d4362a37ba18dc0e454c7dc1d08029d4e5b683149046bc237b2eba',
  '11b053f13c40a8ea9926b16cc8ed51c67ad90bfe9b49e80cfd974500ded6a400',
  '1fb80a280b7b62dc5d60e34531d6ba18aa3b22f5e7ab4fc5a1054940772f1a70',
];
const originals = await Promise.all(paths.map(path => readFile(resolve(path))));
if (originals.some((bytes, index) => hash(bytes) !== expected[index])) throw new Error('Audio input differs from reviewed sources');
const rate = 24000;
const zip = (index, file) => execFileSync('python', ['-c',
  'import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
  resolve(paths[index]), file], { maxBuffer: 8 * 1024 * 1024 });
function decode(bytes) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', 'pipe:0', '-ac', '1', '-ar', String(rate),
    '-f', 'f32le', 'pipe:1'], { input: bytes, maxBuffer: 8 * 1024 * 1024 });
  return Float32Array.from({ length: raw.length / 4 }, (_, index) => raw.readFloatLE(index * 4));
}
function excerpt(samples, seconds, start = 0) {
  return samples.slice(Math.round(start * rate), Math.min(samples.length, Math.round((start + seconds) * rate)));
}
function wave(samples, loop = false) {
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  if (!Number.isFinite(peak) || peak < .001) throw new Error('Prepared sound is silent or invalid');
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index++) {
    const fade = loop ? 1 : Math.min(1, index / 24, (samples.length - 1 - index) / Math.min(600, samples.length / 5));
    bytes.writeInt16LE(Math.round(samples[index] / peak * .65 * fade * 32767), 44 + index * 2);
  }
  return bytes;
}
function seamless(samples) {
  const overlap = Math.round(rate * .06), result = samples.slice(overlap);
  for (let index = 0; index < overlap; index++) {
    const blend = index / (overlap - 1), at = result.length - overlap + index;
    result[at] = result[at] * (1 - blend) + samples[index] * blend;
  }
  return result;
}
async function save(directory, file, samples, record, loop = false) {
  const bytes = wave(samples, loop);
  await writeFile(join(directory, file), bytes);
  return { file, ...record, duration: samples.length / rate, sampleRate: rate, channels: 1,
    bytes: bytes.length, sha256: hash(bytes) };
}
const feedbackRoot = resolve('public\\assets\\audio\\tactical-feedback');
await mkdir(feedbackRoot, { recursive: true });
const files = [];
for (const [file, index, original, seconds] of [
  ['hit-stone.wav', 0, 'Audio/impactMining_000.ogg', .22],
  ['hit-wood.wav', 0, 'Audio/impactWood_light_000.ogg', .22],
  ['hit-soil.wav', 0, 'Audio/impactSoft_medium_000.ogg', .20],
  ['hit-generic.wav', 0, 'Audio/impactGeneric_light_000.ogg', .20],
  ['deck-step.wav', 0, 'Audio/footstep_wood_001.ogg', .16],
  ['submerged-metal.wav', 0, 'Audio/impactMetal_heavy_000.ogg', .55],
  ['oar.wav', 1, 'splash_03.ogg', .65],
  ['bubbles.wav', 1, 'bubble_01.ogg', .9],
]) {
  files.push(await save(feedbackRoot, file, excerpt(decode(zip(index, original)), seconds),
    { sourceId: index ? 'rubberduck-water' : 'kenney-impact', original, license: 'CC0-1.0' }));
}
const crash = new Float32Array(rate * 2);
for (const [original, pitch, delay, gain] of [['splash_11.ogg', .7, 0, 1], ['splash_04.ogg', .85, .12, .65]]) {
  const samples = decode(zip(1, original));
  for (let at = Math.round(delay * rate); at < crash.length; at++) {
    const from = (at - delay * rate) * pitch, index = Math.floor(from);
    if (index + 1 >= samples.length) break;
    crash[at] += (samples[index] + (samples[index + 1] - samples[index]) * (from - index)) * gain;
  }
}
files.push(await save(feedbackRoot, 'water-crash.wav', crash, { sourceId: 'rubberduck-water',
  originals: ['splash_11.ogg', 'splash_04.ogg'], license: 'CC0-1.0', processing: 'Layered splashes, reduced pitch; not an actual aircraft-crash recording.' }));
const flyby = new Float32Array(Math.round(rate * .14));
let seed = 19371213, previous = 0;
for (let index = 0; index < flyby.length; index++) {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  const noise = (seed >>> 0) / 0xffffffff * 2 - 1, t = index / flyby.length;
  flyby[index] = (noise - previous * .65) * Math.sin(Math.PI * t) ** 2 * Math.exp(-t * 3);
  previous = noise;
}
files.push(await save(feedbackRoot, 'flyby.wav', flyby, { sourceId: 'project-procedural',
  license: 'Project-authored procedural audio; not a recording', processing: 'Deterministic short noise transient; no gameplay randomness.' }));
await writeFile(join(feedbackRoot, 'source.json'), JSON.stringify({
  sourceKind: 'reviewed-foley-and-procedural', license: 'Mixed-CC0-and-project-authored',
  sources: [
    { id: 'kenney-impact', author: 'Kenney', source: 'https://kenney.nl/assets/impact-sounds',
      license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', archiveSha256: expected[0] },
    { id: 'rubberduck-water', author: 'rubberduck', source: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx',
      license: 'CC0-1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      download: 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip', archiveSha256: expected[1] },
    { id: 'project-procedural', author: 'Project-authored sound design', source: 'scripts/prepare-world-audio.mjs',
      license: 'Project source license; not independently relicensed CC0' },
  ], processing: 'Mono 24kHz PCM16, short excerpts, bounded peak and endpoint fades.', files,
}, null, 2) + '\n');
const engineRoot = resolve('public\\assets\\audio\\vehicle-engines');
await mkdir(engineRoot, { recursive: true });
const credits = `Vehicle engine recordings and derived loops\n\nTank engine: Nayckron, with source work by qubodup.\nSource: https://opengameart.org/content/engine-loop-heavy-vehicletank\nSelected license: Creative Commons Attribution 3.0 (CC BY 3.0).\nhttps://creativecommons.org/licenses/by/3.0/\nChanges: mono 24kHz PCM conversion, peak normalization, 60ms loop crossfade.\nA designed heavy-vehicle loop derived from a car; not a historical tank recording.\n\nPlane engine: Versatile Virtuoso, \"Propeller-plane-flying-steady-01.wav\".\nSource: https://commons.wikimedia.org/wiki/File:Propeller-plane-flying-steady-01.wav\nLicense: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0).\nhttps://creativecommons.org/licenses/by-sa/4.0/\nChanges: excerpt at 4-12 seconds, mono 24kHz PCM conversion, peak normalization, 60ms loop crossfade.\nThe derived plane-engine.wav is distributed under CC BY-SA 4.0.\nNot identified as any specific historical aircraft or engine model.\nNeither author endorses this project.\n`;
await writeFile(join(engineRoot, 'ATTRIBUTION.txt'), credits);
const engineFiles = [];
for (const [file, index, seconds, start, license] of [
  ['tank-engine.wav', 2, 3.99, 0, 'CC-BY-3.0'], ['plane-engine.wav', 3, 8, 4, 'CC-BY-SA-4.0'],
]) engineFiles.push(await save(engineRoot, file, seamless(excerpt(decode(originals[index]), seconds, start)),
  { license, sourceSha256: expected[index] }, true));
const creditBytes = Buffer.from(credits);
engineFiles.push({ file: 'ATTRIBUTION.txt', bytes: creditBytes.length, sha256: hash(creditBytes) });
await writeFile(join(engineRoot, 'source.json'), JSON.stringify({
  sourceKind: 'attributed-derived-engine-loops', license: 'Mixed-CC-BY-3.0-and-CC-BY-SA-4.0',
  attribution: 'ATTRIBUTION.txt', files: engineFiles,
  sources: [
    { author: 'Nayckron; qubodup', source: 'https://opengameart.org/content/engine-loop-heavy-vehicletank',
      license: 'CC-BY-3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', sha256: expected[2] },
    { author: 'Versatile Virtuoso', source: 'https://commons.wikimedia.org/wiki/File:Propeller-plane-flying-steady-01.wav',
      license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sha256: expected[3] },
  ], processing: 'Derived loops retain their source licenses; not CC0. Mono PCM, normalized, 60ms crossfade.',
}, null, 2) + '\n');
console.log(JSON.stringify({ feedback: files.map(({ file, bytes }) => ({ file, bytes })),
  engines: engineFiles.map(({ file, bytes }) => ({ file, bytes })) }));
