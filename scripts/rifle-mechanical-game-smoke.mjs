import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.GAME_URL ?? 'http://127.0.0.1:5189';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const observations = [], errors = [], requests = [];
const snapshot = page => page.evaluate(() => window.__battle);
async function open(scenario, failure = null, procedural = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/audio/rifle-mechanical/')) requests.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(() => {
    window.__syntheticMechanicalStarts = 0;
    const prototype = (window.AudioContext || window.webkitAudioContext).prototype;
    const original = prototype.createBufferSource;
    prototype.createBufferSource = function (...args) {
      const source = original.apply(this, args), start = source.start;
      source.start = function (...values) {
        if (source.buffer?.duration === 1 && values[1] === .3 && [.045, .1].includes(values[2])) {
          window.__syntheticMechanicalStarts++;
        }
        return start.apply(this, values);
      };
      return source;
    };
  });
  if (failure) await page.route('**/assets/audio/rifle-mechanical/extract.wav', route => failure === 'decode'
    ? route.fulfill({ contentType: 'audio/wav', body: 'invalid wave' })
    : route.fulfill({ status: 404, body: 'deliberately missing recording' }));
  const url = new URL(base);
  url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', '1938');
  if (procedural) url.searchParams.set('character', 'procedural');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  return page;
}
async function save(page, stage) {
  const data = await snapshot(page);
  observations.push({ stage, state: data.state, owner: data.control, ammo: data.ammo,
    mechanical: data.mechanicalAudio, rifleAudio: data.rifleAudio, footstepAudio: data.footstepAudio,
    events: data.controlEvents, population: { friendly: data.population.friendly.alive, enemy: data.population.enemy.alive } });
  return data;
}
async function shoot(page, interrupt = null) {
  return page.evaluate(interrupt => new Promise((resolve, reject) => {
    const before = window.__battle, canvas = document.querySelector('#world'), deadline = performance.now() + 15000;
    const count = before.mechanicalAudio.counts?.played ?? 0;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    let released = false;
    function frame() {
      const data = window.__battle;
      if (!released && data.ammo < before.ammo) {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 })); released = true;
      }
      if (released && (!interrupt || data.mechanicalAudio.counts.played > count && data.mechanicalAudio.active > 0)) {
        if (interrupt === 'pause') document.querySelector('#pause-button').click();
        else if (interrupt) {
          const code = interrupt === 'member' ? 'KeyY' : 'Digit2';
          document.dispatchEvent(new KeyboardEvent('keydown', { code }));
          document.dispatchEvent(new KeyboardEvent('keyup', { code }));
        }
        resolve({ before: data.mechanicalAudio, after: window.__battle.mechanicalAudio, state: window.__battle.state });
        return;
      }
      if (performance.now() > deadline || data.state !== 'playing') {
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        reject(new Error(`Shot/interrupt failed: ${data.state}, ammo ${data.ammo}, action ${data.rifle?.action}`)); return;
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), interrupt);
}
async function ready(page) {
  await page.waitForFunction(() => window.__battle.rifle?.action === 'idle', null, { timeout: 15000 });
}
try {
  const page = await open('interior');
  assert.equal((await snapshot(page)).mechanicalAudio.status, 'recorded');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.mechanicalAudio.contextState === 'running');
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementY: -300 })));
  await shoot(page); await ready(page);
  let data = await save(page, 'native-rifle-cycle');
  assert.equal(data.ammo, 4);
  assert.deepEqual(data.mechanicalAudio.history.map(item => item.cue), ['unlock', 'extract', 'close']);
  await page.keyboard.press('r');
  await ready(page);
  data = await save(page, 'native-rifle-reload');
  assert.equal(data.ammo, 5);
  assert.deepEqual(data.mechanicalAudio.history.map(item => item.cue), ['unlock', 'extract', 'close', 'unlock', 'extract', 'load', 'close']);
  for (const item of data.mechanicalAudio.history) {
    const original = data.controlEvents.history.find(event => event.id === item.eventId);
    assert.ok(original);
    assert.equal(item.soldierId, original.soldierId); assert.equal(item.weaponId, original.weaponId);
    assert.equal(item.cue, original.cue); assert.equal(item.time, original.time);
  }
  assert.equal(await page.evaluate(() => window.__syntheticMechanicalStarts), 0);
  const pause = await shoot(page, 'pause');
  assert.ok(pause.before.active > 0); assert.equal(pause.after.active, 0); assert.equal(pause.state, 'pause');
  const paused = (await snapshot(page)).mechanicalAudio;
  await page.waitForTimeout(300);
  assert.deepEqual((await snapshot(page)).mechanicalAudio, paused);
  await page.locator('#resume').click(); await ready(page);
  await save(page, 'pause-resume');
  const tool = await shoot(page, 'tool');
  assert.ok(tool.before.active > 0); assert.equal(tool.after.active, 0); assert.equal(tool.after.playing, false);
  assert.equal((await snapshot(page)).controlSimulation.toolEquipped, true);
  await page.keyboard.press('1'); await ready(page);
  const transfer = await shoot(page, 'member');
  assert.ok(transfer.before.active > 0); assert.equal(transfer.after.active, 0);
  assert.notEqual(transfer.after.owner.soldierId, transfer.before.owner.soldierId);
  await ready(page);
  await shoot(page); await ready(page);
  data = await save(page, 'new-owner-cycle');
  const newOwnerCues = data.mechanicalAudio.history.slice(-3);
  assert.deepEqual(newOwnerCues.map(item => item.cue), ['unlock', 'extract', 'close']);
  assert.ok(newOwnerCues.every(item => item.soldierId === data.control.soldierId && item.weaponId === data.rifle.id));
  assert.ok(data.mechanicalAudio.peakVoices <= 4);
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  assert.equal((await snapshot(page)).mechanicalAudio.counts.played, 0);
  await page.locator('#deploy').click();
  await shoot(page); await ready(page);
  data = await save(page, 'new-match-event-serial');
  assert.equal(data.mechanicalAudio.history.length, 3, 'new-match IDs must not be discarded as old events');
  await page.close();

  const crew = await open('control', null, true);
  await crew.locator('#squad-choices [data-type="tank"]').click();
  await crew.locator('#deploy').click();
  assert.equal((await snapshot(crew)).mechanicalAudio.playing, false);
  await crew.keyboard.press('f');
  assert.equal((await snapshot(crew)).type, 'infantry');
  await shoot(crew, 'member');
  data = await save(crew, 'crew-return-to-seated-member');
  assert.equal(data.type, 'tank');
  assert.equal(data.mechanicalAudio.active, 0); assert.equal(data.mechanicalAudio.playing, false);
  await crew.close();

  const full = await open('full');
  await full.locator('#deploy').click();
  data = await save(full, 'native-110v110-startup');
  assert.equal(data.population.friendly.alive, 110); assert.equal(data.population.enemy.alive, 110);
  await shoot(full); await ready(full);
  data = await save(full, 'native-110v110-personal-cycle');
  assert.ok(data.mechanicalAudio.history.some(item => item.cue === 'extract'));
  assert.ok(data.mechanicalAudio.history.every(item => item.soldierId === data.control.soldierId));
  assert.ok(data.rifleAudio.counts.owned >= 1);
  await full.close();

  for (const failure of ['http', 'decode']) {
    const failed = await open('interior', failure, true);
    data = await snapshot(failed);
    assert.equal(data.mechanicalAudio.status, 'fallback');
    assert.ok(data.mechanicalAudio.error);
    assert.equal(data.rifleAudio.status, 'recorded'); assert.equal(data.footstepAudio.status, 'recorded');
    await failed.locator('#deploy').click();
    assert.match(await failed.locator('#force-status').textContent(), /步枪机械录音未加载/);
    assert.match(await failed.locator('#toast').textContent(), /步枪机械录音未加载/);
    await shoot(failed); await ready(failed);
    assert.ok(await failed.evaluate(() => window.__syntheticMechanicalStarts >= 3));
    await save(failed, `explicit-${failure}-fallback`);
    await failed.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, stages: observations.map(item => item.stage),
    limitation: 'Functional main-game playback; not human listening acceptance or 110v110 performance acceptance.' }));
} finally {
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'mechanical-game.json'),
      JSON.stringify({ observations, errors, requests }, null, 2));
  }
  await browser.close();
}
