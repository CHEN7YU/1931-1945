import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5189');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__rifle-mix-check', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Internal rifle mix check</title>',
  }));
  await page.goto(new URL('/__rifle-mix-check', base).href);
  const result = await page.evaluate(async () => {
    const { createRifleAudio, rifleMix } = await import('/src/rifle-audio.js');
    const decoded = new OfflineAudioContext(1, 1, 24000);
    const response = await fetch('/assets/audio/recorded-rifle/report.wav');
    if (!response.ok) throw new Error(`Rifle recording HTTP ${response.status}`);
    const buffer = await decoded.decodeAudioData(await response.arrayBuffer());
    const ears = { position: { x: 0, y: 1.6, z: 0 }, right: { x: 1, y: 0, z: 0 },
      soldierId: 'player', weaponId: 'player:rifle' };
    const event = (id, distance, owned = false, x = 0) => ({
      id, start: { x, y: 1.6, z: -distance },
      source: { soldierId: owned ? 'player' : `npc-${id}`, weaponId: owned ? 'player:rifle' : `npc-${id}:rifle`,
        credit: owned ? 'player' : id % 2 ? 'ally' : 'enemy' },
    });
    const graph = () => {
      const context = new OfflineAudioContext(2, 24000, 24000);
      return { context, audio: { state: 'running', currentTime: 0, destination: context.destination,
        createBufferSource: context.createBufferSource.bind(context), createGain: context.createGain.bind(context),
        createBiquadFilter: context.createBiquadFilter.bind(context), createStereoPanner: context.createStereoPanner.bind(context),
        createWaveShaper: context.createWaveShaper.bind(context) } };
    };
    const metrics = buffer => {
      const channels = Array.from({ length: 2 }, (_, index) => buffer.getChannelData(index));
      const peaks = [0, 0], squares = [0, 0];
      for (let channel = 0; channel < 2; channel++) {
        for (const sample of channels[channel]) {
          if (!Number.isFinite(sample)) throw new Error('Non-finite rendered audio');
          peaks[channel] = Math.max(peaks[channel], Math.abs(sample));
          squares[channel] += sample * sample;
        }
      }
      return { peak: Math.max(...peaks), rms: Math.sqrt((squares[0] + squares[1]) / buffer.length), peaks };
    };
    async function render(shot) {
      const { context, audio } = graph(), mixer = createRifleAudio(buffer);
      mixer.playBatch(audio, [shot], ears);
      return { ...metrics(await context.startRendering()), mix: rifleMix(shot.start, ears, shot.source.soldierId === 'player'),
        active: mixer.snapshot.active };
    }
    const personal = await render(event(3, 0, true)), distances = [];
    for (const distance of [3, 5, 10, 25, 50, 100, 180, 210, 239, 240]) {
      distances.push({ distance, ...await render(event(3, distance)) });
    }
    const left = await render(event(3, 0, false, -10)), right = await render(event(3, 0, false, 10));
    const old = graph();
    const source = old.context.createBufferSource(), gain = old.context.createGain();
    const filter = old.context.createBiquadFilter(), panner = old.context.createStereoPanner();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 14000;
    gain.gain.value = .65 * 10 ** (3 / 20) * .7;
    source.connect(filter).connect(gain).connect(panner).connect(old.context.destination); source.start();
    const previousPersonal = metrics(await old.context.startRendering());
    const stress = graph(), mixer = createRifleAudio(buffer);
    for (let i = 0; i < 8; i++) {
      if (i % 3 === 0) mixer.beginBatch();
      mixer.play(stress.audio, event((i + 1) * 3, 0), ears, false);
    }
    mixer.play(stress.audio, event(27, 0, true), ears, true);
    const peakVoices = mixer.snapshot.peakVoices;
    const overlap = metrics(await stress.context.startRendering());
    return { personal, previousPersonal, personalIncreaseDb: 20 * Math.log10(personal.rms / previousPersonal.rms),
      distances, left, right, overlap: { ...overlap, peakVoices, activeAfterRender: mixer.snapshot.active },
      limitation: 'Offline rendering of real recording; the nine synchronized reports are a synthetic peak stress case, not battlefield evidence.' };
  });
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'rifle-mix.json'), JSON.stringify(result, null, 2));
  }
  assert.ok(result.personalIncreaseDb > 1.9 && result.personalIncreaseDb < 2.1, `isolated personal increase: ${result.personalIncreaseDb}dB`);
  assert.ok(result.personal.peak < .85, 'one personal report must not reach the safety saturation region');
  let previous = result.personal.rms;
  for (const item of result.distances) {
    assert.ok(item.rms < previous, `${item.distance}m must be quieter than the preceding distance`);
    assert.equal(item.active, 0);
    previous = item.rms;
  }
  assert.ok(result.distances[1].rms / result.personal.rms > .45, '5m reports must remain clearly present');
  assert.equal(result.distances.at(-1).peak, 0);
  assert.ok(result.left.peaks[0] > result.left.peaks[1] * 5);
  assert.ok(result.right.peaks[1] > result.right.peaks[0] * 5);
  assert.equal(result.overlap.peakVoices, 9);
  assert.equal(result.overlap.activeAfterRender, 0);
  assert.ok(result.overlap.peak < .95);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, personalIncreaseDb: result.personalIncreaseDb,
    levels: result.distances.map(item => ({ metres: item.distance, peak: item.peak, rms: item.rms })),
    overlapPeak: result.overlap.peak, limitation: result.limitation }));
} finally {
  await browser.close();
}
