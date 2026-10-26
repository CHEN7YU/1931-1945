import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
async function observe(stage) {
  const data = await page.evaluate(() => {
    const data = window.__battle;
    return { state: data.state, time: data.time, remaining: data.remaining, clock: data.simulationClock,
      ammo: data.ammo, warningHidden: document.querySelector('#simulation-status').hidden };
  });
  observations.push({ stage, ...data });
  return data;
}
function conserved(data) {
  const clock = data.clock;
  assert.ok(Math.abs(clock.activeSeconds - clock.simulatedSeconds - clock.pendingSeconds) < 1e-8,
    'all active elapsed time is either simulated or still pending');
  assert.ok(Math.abs(data.time - clock.simulatedSeconds) < 1e-8, 'the real battle advances every consumed step');
  assert.ok(clock.stepsThisFrame <= clock.limits.maxStepsPerFrame);
  assert.ok(clock.frameSeconds <= clock.limits.maxStepSeconds * clock.limits.maxStepsPerFrame + 1e-9);
  assert.ok(Math.abs(data.remaining + data.time - 600) < 1e-7);
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'bridge'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const fixture = await page.evaluate(() => window.__battle);
  assert.equal(fixture.benchmark?.scenario, 'bridge', 'clock checks require the labelled development geometry fixture');
  assert.equal(fixture.population.friendly.alive, 5);
  assert.equal(fixture.population.enemy.alive, 0, 'this is clock correctness, not 200-soldier performance evidence');
  await page.waitForFunction(() => window.__battle.time > .5 &&
    window.__battle.simulationClock.pendingSeconds < 1e-6 && !window.__battle.simulationClock.limited);
  const before = await observe('before-stall');
  conserved(before);
  const caught = await page.evaluate(() => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('No bounded catch-up frame observed')), 10000);
    let blockedSeconds;
    const observe = () => {
      const data = window.__battle;
      if (!data.simulationClock.limited) { requestAnimationFrame(observe); return; }
      clearTimeout(deadline);
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
      resolve({ state: data.state, time: data.time, remaining: data.remaining, clock: data.simulationClock,
        ammo: data.ammo, effects: data.combatEffects, blockedSeconds,
        warningHidden: document.querySelector('#simulation-status').hidden,
        warningVisible: document.querySelector('#simulation-status').getClientRects().length > 0 });
    };
    requestAnimationFrame(observe);
    document.querySelector('#world').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
    const started = performance.now();
    while (performance.now() - started < 650) { /* Simulate a main-thread stall without mutating gameplay. */ }
    blockedSeconds = (performance.now() - started) / 1000;
  }));
  observations.push({ stage: 'first-catch-up-render', ...caught });
  conserved(caught);
  assert.equal(caught.clock.stepsThisFrame, 5);
  assert.ok(caught.clock.pendingSeconds >= .35);
  assert.equal(caught.warningHidden, false);
  assert.equal(caught.warningVisible, true);
  assert.equal(caught.ammo, before.ammo - 1, 'normal held input fires once, not once per catch-up substep');
  assert.ok(caught.effects.muzzleLightIntensity > 1 && caught.effects.visibleLights > 0,
    'a short world muzzle flash survives all substeps until the first real render');
  assert.equal(caught.effects.shaderLights, 2);
  await page.waitForFunction(() => window.__battle.simulationClock.pendingSeconds < 1e-6 &&
    !window.__battle.simulationClock.limited, null, { timeout: 15000 });
  const recovered = await observe('recovered');
  conserved(recovered);
  assert.ok(recovered.time - before.time >= caught.blockedSeconds - .01, 'the stall is eventually simulated rather than discarded');
  assert.equal(recovered.warningHidden, true);
  const debtAtPause = await page.evaluate(() => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('No pending catch-up frame to pause')), 10000);
    const pause = () => {
      const data = window.__battle;
      if (!data.simulationClock.limited) { requestAnimationFrame(pause); return; }
      clearTimeout(deadline);
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
      resolve(data.simulationClock.pendingSeconds);
    };
    requestAnimationFrame(pause);
    const started = performance.now();
    while (performance.now() - started < 650) { /* Retain actual debt across the pause boundary. */ }
  }));
  assert.ok(debtAtPause >= .35);
  const paused = await observe('paused');
  assert.equal(paused.clock.active, false);
  assert.ok(paused.clock.pendingSeconds >= debtAtPause, 'pausing must not erase already queued active time');
  conserved(paused);
  await page.waitForTimeout(350);
  const stillPaused = await observe('still-paused');
  for (const field of ['active', 'activeSeconds', 'simulatedSeconds', 'pendingSeconds', 'peakPendingSeconds']) {
    assert.equal(stillPaused.clock[field], paused.clock[field], `pause freezes ${field}`);
  }
  assert.equal(stillPaused.time, paused.time);
  await page.locator('#resume').click();
  await page.waitForFunction(time => window.__battle.time > time + .2 &&
    window.__battle.simulationClock.pendingSeconds < 1e-6, paused.time);
  const resumed = await observe('resumed');
  conserved(resumed);
  assert.ok(resumed.time - paused.time >= paused.clock.pendingSeconds - 1e-8, 'resume recovers the pre-pause debt');
  await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  const reset = await observe('returned-to-menu');
  assert.equal(reset.clock.active, false);
  for (const field of ['activeSeconds', 'simulatedSeconds', 'pendingSeconds', 'peakPendingSeconds', 'stepsThisFrame']) {
    assert.equal(reset.clock[field], 0, `leaving a battle clears ${field}`);
  }
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.time > 0);
  conserved(await observe('new-battle'));
  assert.deepEqual(errors, []);
  console.log('Clock smoke passed: bounded stall recovery, visible birth-frame flash, pause conservation, battle reset.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'clock-observations.json'),
        JSON.stringify({ observations, errors }, null, 2));
    }
  } finally {
    await browser.close();
  }
}
