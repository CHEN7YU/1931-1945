import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TINNITUS_CANDIDATES, tinnitusCandidateSamples, repeatedBlastPreviewSamples } from '../src/tinnitus-candidates.js';

if (!process.env.ARTIFACT_DIR) throw new Error('ARTIFACT_DIR is required');
const directory = process.env.ARTIFACT_DIR;
await mkdir(directory, { recursive: true });
for (const id of [...TINNITUS_CANDIDATES.map(preset => preset.id), 'single-episode']) {
  const rate = 48000, samples = id === 'single-episode' ? repeatedBlastPreviewSamples(rate) : tinnitusCandidateSamples(id, rate);
  const wav = Buffer.alloc(44 + samples.length * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
  wav.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => wav.writeInt16LE(Math.round(value * 32767), 44 + index * 2));
  await writeFile(join(directory, `${id}.wav`), wav);
}
await writeFile(join(directory, 'candidates.json'), JSON.stringify({ presets: TINNITUS_CANDIDATES,
  source: 'Original synthesized listening candidates; not field recordings or medical simulations.',
  productionChanged: false, newCandidates: ['D', 'E', 'F'],
  episodePreview: { exposureSeconds: [.6, 1.3, 1.9], endsAt: 5.1, logicInProduction: false } }, null, 2));
console.log('Prepared six gentle-onset candidates and one bounded single-episode design preview');
