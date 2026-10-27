import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const original = resolve('asset-research', 'rifle-audio', 'kurt-original.wav');
const directory = resolve('public', 'assets', 'audio', 'recorded-rifle');
const raw = await readFile(original);
const originalHash = createHash('sha256').update(raw).digest('hex');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let processed;
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:5173/__audio-analysis', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline audio analysis</title>' }));
  await page.goto('http://127.0.0.1:5173/__audio-analysis');
  processed = await page.evaluate(async () => {
    const response = await fetch('/asset-research/rifle-audio/kurt-original.wav');
    if (!response.ok) throw new Error(`Original recording: HTTP ${response.status}`);
    const context = new OfflineAudioContext(1, 1, 24000);
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    const rate = audio.sampleRate, channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
    const sample = index => channels.reduce((sum, data) => sum + data[index], 0) / channels.length;
    const searchStart = Math.floor(4.8 * rate), searchEnd = Math.min(audio.length, Math.ceil(5.5 * rate));
    let peak = 0;
    for (let index = searchStart; index < searchEnd; index++) peak = Math.max(peak, Math.abs(sample(index)));
    if (peak < .05) throw new Error('Expected fourth shot transient is absent');
    let onset = searchStart;
    while (onset < searchEnd && Math.abs(sample(onset)) < peak * .12) onset++;
    const start = Math.max(searchStart, onset - Math.round(.006 * rate));
    const length = Math.min(Math.round(.6 * rate), audio.length - start);
    const values = Array.from({ length }, (_, i) => sample(start + i));
    const dc = values.reduce((sum, value) => sum + value, 0) / length;
    const rawPeak = values.reduce((maximum, value) => Math.max(maximum, Math.abs(value - dc)), 0);
    const gain = Math.pow(10, -3 / 20) / rawPeak;
    const pcm = values.map((value, i) => Math.round((value - dc) * gain *
      Math.min(1, i / (rate * .0005), (length - 1 - i) / (rate * .025)) * 32767));
    return { rate, pcm, startSeconds: start / rate, duration: length / rate, rawPeak, gain,
      sourceChannels: audio.numberOfChannels, sourceDuration: audio.duration };
  });
} finally {
  await browser.close();
}
const wave = Buffer.alloc(44 + processed.pcm.length * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(processed.rate, 24); wave.writeUInt32LE(processed.rate * 2, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36);
wave.writeUInt32LE(processed.pcm.length * 2, 40);
processed.pcm.forEach((value, i) => wave.writeInt16LE(value, 44 + i * 2));
await mkdir(directory, { recursive: true });
await writeFile(join(directory, 'report.wav'), wave);
const metadata = {
  asset: 'Recorded gunshot prototype', author: 'kurt', license: 'CC0-1.0',
  source: 'https://opengameart.org/content/gunshots',
  original: { url: 'https://opengameart.org/sites/default/files/Unkown.wav', file: 'Unkown.wav', bytes: raw.length, sha256: originalHash },
  licenseEvidence: 'Source page explicitly lists Creative Commons 0 and attribution notice: None needed.',
  changes: ['Fourth transient selected', 'Stereo averaged to mono', 'Browser offline resampling to 24kHz',
    'DC offset removed', 'Peak normalized to -3dBFS', '0.5ms attack and 25ms tail fades', '0.6s runtime excerpt'],
  selection: { startSeconds: processed.startSeconds, duration: processed.duration, decodedWindowPeak: processed.rawPeak },
  files: [{ file: 'report.wav', bytes: wave.length, sha256: createHash('sha256').update(wave).digest('hex') }],
  limitations: ['Original firearm is unspecified; not a verified Type24/Chinese or Japanese historical rifle recording.',
    'Source master has some digital clipping; normalization does not restore clipped source information.',
    'No independent listening/weapon-authenticity acceptance is claimed.'],
};
await writeFile(join(directory, 'source.json'), JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify({ directory, ...metadata.selection, bytes: wave.length, sourceHash: originalHash }));
