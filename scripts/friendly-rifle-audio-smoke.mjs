import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'audio-observations', 'chinese-rifle-audio');
await mkdir(directory, { recursive: true });
const files = new Map([
  ['/src/rifle-audio.js', ['src/rifle-audio.js', 'text/javascript']],
  ...['recorded-rifle/report.wav', 'friendly-rifle-generated/rifle-report.wav', 'friendly-rifle-generated/sniper-report.wav',
    'enemy-rifle/report.wav', ...[0, 1, 2].map(take => `machine-gun/shot-${take}.wav`)]
    .map(file => [`/assets/audio/${file}`, [`public/assets/audio/${file}`, 'audio/wav']]),
]);
const server = createServer(async (request, response) => {
  if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    return response.end('<!doctype html><title>Rifle audio only</title><button>Start audio</button>');
  }
  const file = files.get(request.url);
  if (!file) { response.writeHead(404); return response.end(); }
  try {
    response.writeHead(200, { 'Content-Type': file[1] });
    response.end(await readFile(new URL(`../${file[0]}`, import.meta.url)));
  } catch (error) {
    console.error('Audio fixture read failed:', file[0], error);
    response.writeHead(500); response.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const { loadRifleAudio } = await import('/src/rifle-audio.js');
    window.mixer = await loadRifleAudio();
    window.context = new AudioContext({ sampleRate: 24000 });
    window.sources = [];
    const createSource = context.createBufferSource.bind(context);
    context.createBufferSource = () => {
      const source = createSource(); sources.push(source); return source;
    };
    window.analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    const createSafety = context.createWaveShaper.bind(context);
    context.createWaveShaper = () => {
      const safety = createSafety(); safety.connect(analyser); return safety;
    };
    document.querySelector('button').onclick = () => context.resume();
  });
  await page.locator('button').click();
  await page.waitForFunction(() => context.state === 'running');
  const result = await page.evaluate(async () => {
    const listener = { position: { x: 0, y: 1.6, z: 0 }, right: { x: 1, y: 0, z: 0 },
      soldierId: 'player', weaponId: 'player:rifle' };
    const samples = [];
    let id = 0;
    for (const [team, weaponClass] of [['friendly', 'rifle'], ['friendly', 'sniper'], ['enemy', 'rifle'],
      ['friendly', 'machine-gun'], ['friendly', 'tank-machine-gun'], [undefined, undefined]]) {
      const event = { id: ++id, start: { ...listener.position }, source: {
        soldierId: 'player', weaponId: 'player:rifle', team, weaponClass } };
      const start = context.currentTime, deadline = performance.now() + 2000;
      mixer.playBatch(context, [event], listener);
      while (context.currentTime < start + .045) {
        if (performance.now() > deadline) throw new Error('Running browser audio clock did not advance');
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      samples.push({ team: team ?? null, weaponClass: weaponClass ?? null,
        report: mixer.snapshot.history.at(-1).report, duration: sources.at(-1).buffer.duration,
        renderedSeconds: context.currentTime - start,
        rms: Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length) });
    }
    const snapshot = mixer.snapshot;
    mixer.reset();
    const reset = mixer.snapshot;
    await context.close();
    return { samples, snapshot, reset, webglCreated: false, audibleListeningClaimed: false };
  });
  await writeFile(join(directory, 'browser-playback.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(result.samples.map(item => item.report),
    ['friendly-rifle', 'friendly-sniper', 'enemy-rifle', 'machine-gun', 'machine-gun', 'recorded-rifle']);
  assert.deepEqual(result.samples.map(item => item.duration), [.42, .28, result.snapshot.enemyDuration,
    result.snapshot.machineGunDurations[1], result.snapshot.machineGunDurations[2], .6]);
  assert.ok(result.samples.every(item => item.rms > .0001), 'real browser graph produces nonzero audio');
  assert.equal(result.snapshot.peakVoices, 1);
  assert.equal(result.reset.active, 0);
  for (const name of ['rifle-report.wav', 'sniper-report.wav']) {
    await page.route(`**/friendly-rifle-generated/${name}`, route => route.fulfill({ status: 404, body: '' }));
    const error = await page.evaluate(async () => {
      try { await (await import('/src/rifle-audio.js')).loadRifleAudio(); return null; }
      catch (error) { return error.message; }
    });
    assert.match(error, new RegExp(`${name}: HTTP 404`));
    await page.unroute(`**/friendly-rifle-generated/${name}`);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, directory, reports: result.samples, errors }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
