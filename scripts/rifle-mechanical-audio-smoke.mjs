import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:5189';
const files = new Map([
  ['/', { contentType: 'text/html', body: '<!doctype html><title>Internal mechanical audio check</title>' }],
]);
for (const name of ['rifle-mechanical-audio.js', 'rifle-action.js', 'control-events.js']) {
  files.set(`/src/${name}`, { contentType: 'text/javascript', body: await readFile(new URL(`../src/${name}`, import.meta.url)) });
}
for (const name of ['unlock.wav', 'extract.wav', 'load.wav', 'close.wav']) {
  files.set(`/assets/audio/rifle-mechanical/${name}`, {
    contentType: 'audio/wav', body: await readFile(new URL(`../public/assets/audio/rifle-mechanical/${name}`, import.meta.url)),
  });
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  const requests = [], unexpected = [], errors = [];
  let blockedCue = null;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), file = files.get(url.pathname);
    if (url.origin !== origin || !file) {
      unexpected.push(url.href);
      await route.fulfill({ status: 404, body: 'Unexpected internal check request' });
      return;
    }
    if (blockedCue && url.pathname.endsWith(`/${blockedCue}.wav`)) {
      await route.fulfill({ status: 404, body: 'Deliberate missing sample' });
      return;
    }
    requests.push(url.pathname);
    await route.fulfill(file);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { loadRifleMechanicalAudio } = await import('/src/rifle-mechanical-audio.js');
    const { createRifleState, shootRifle, advanceRifle, reloadRifle } = await import('/src/rifle-action.js');
    const { createControlEvents } = await import('/src/control-events.js');
    const sounds = await loadRifleMechanicalAudio(), owner = { soldierId: 'original', weaponId: 'original:rifle' };
    const graph = (seconds = .4) => {
      const context = new OfflineAudioContext(1, Math.round(24000 * seconds), 24000);
      // Offline rendering starts after cue submission; only the transport state is adapted.
      const audio = { state: 'running', currentTime: 0, destination: context.destination,
        createBufferSource: context.createBufferSource.bind(context), createGain: context.createGain.bind(context) };
      return { context, audio };
    };
    const events = createControlEvents(), recordings = [];
    for (const cue of ['unlock', 'extract', 'load', 'close']) {
      sounds.reset(); sounds.beginBatch(owner, true);
      const { context, audio } = graph();
      const event = events.publish('weapon.mechanical', { ...owner, cue }, 0);
      if (!sounds.play(audio, event)) throw new Error(`Rejected ${cue}`);
      if (sounds.play(audio, event)) throw new Error(`Replayed ${cue}`);
      const rendered = await context.startRendering(), data = rendered.getChannelData(0);
      let peak = 0, squares = 0;
      for (const value of data) { peak = Math.max(peak, Math.abs(value)); squares += value * value; }
      recordings.push({ cue, peak, rms: Math.sqrt(squares / data.length), activeAfterRender: sounds.snapshot.active });
    }
    const stopped = [];
    for (const change of ['pause', 'soldier', 'weapon', 'reset']) {
      sounds.reset(); sounds.beginBatch(owner, true);
      const { context, audio } = graph();
      sounds.play(audio, events.publish('weapon.mechanical', { ...owner, cue: 'unlock' }, 0));
      if (change === 'pause') sounds.sync(owner, false);
      else if (change === 'soldier') sounds.sync({ ...owner, soldierId: 'replacement' }, true);
      else if (change === 'weapon') sounds.sync({ ...owner, weaponId: 'replacement:rifle' }, true);
      else sounds.reset();
      const rendered = await context.startRendering();
      stopped.push({ change, peak: rendered.getChannelData(0).reduce((max, value) => Math.max(max, Math.abs(value)), 0),
        active: sounds.snapshot.active });
    }
    sounds.reset(); sounds.beginBatch(owner, true);
    const live = new AudioContext();
    try {
      await live.resume();
      const accepted = sounds.play(live, events.publish('weapon.mechanical', { ...owner, cue: 'load' }, 0));
      if (!accepted) throw new Error(`Live AudioContext rejected cue (${live.state})`);
      sounds.sync(owner, false);
    } finally { await live.close(); }
    sounds.reset(); sounds.beginBatch(owner, true);
    const { context, audio } = graph(3.5), rifle = createRifleState(), sequence = [];
    shootRifle(rifle); reloadRifle(rifle);
    let time = 0;
    for (let frame = 0; frame < 210; frame++) {
      time += 1 / 60;
      sounds.beginBatch(owner, true);
      audio.currentTime = time;
      for (const cue of advanceRifle(rifle, 1 / 60)) {
        if (cue === 'ready') continue;
        const event = events.publish('weapon.mechanical', { ...owner, cue }, time);
        if (!sounds.play(audio, event)) throw new Error(`Action cue was rejected: ${cue}`);
        sequence.push({ cue, time });
      }
    }
    await context.startRendering();
    return { recordings, stopped, sequence, samples: sounds.snapshot.samples, ammo: rifle.ammo,
      voicesAfterSequence: sounds.snapshot.active, liveContext: 'running-and-stopped' };
  });
  assert.equal(result.recordings.length, 4);
  for (const item of result.recordings) {
    assert.ok(item.peak > .005 && item.peak <= .079, `${item.cue} peak ${item.peak}`);
    assert.ok(item.rms > .0001);
    assert.equal(item.activeAfterRender, 0);
  }
  for (const item of result.stopped) {
    assert.equal(item.peak, 0, `${item.change} must not retain old audio`);
    assert.equal(item.active, 0);
  }
  assert.deepEqual(result.sequence.map(item => item.cue), ['unlock', 'extract', 'close', 'unlock', 'extract', 'load', 'close']);
  assert.ok(result.sequence[0].time >= .13, 'trigger pull is not a mechanical cue');
  assert.equal(result.ammo, 5);
  assert.equal(result.voicesAfterSequence, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  assert.equal(requests.filter(path => path.endsWith('.wav')).length, 4);
  blockedCue = 'extract';
  const failed = await page.evaluate(async () => {
    const { loadRifleMechanicalAudio } = await import('/src/rifle-mechanical-audio.js');
    try { await loadRifleMechanicalAudio(); return null; } catch (error) { return error.message; }
  });
  assert.match(failed, /extract: HTTP 404/);
  const report = { ...result, requests, failure: failed, scope: 'Internal decoder/graph check; no main-game or listening acceptance' };
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'rifle-mechanical-audio.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
