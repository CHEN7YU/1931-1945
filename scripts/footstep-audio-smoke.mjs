import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
const observations = [], errors = [], requests = [];
let stage = 'loading';
async function open(scenario, failure = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/kenney-impact\/.*\.ogg/.test(response.url())) requests.push({ url: response.url(), status: response.status() });
  });
  if (failure) {
    await page.route('**/assets/audio/kenney-impact/wood.ogg', route => route.abort());
    await page.addInitScript(() => {
      window.__syntheticContactStarts = 0;
      const prototype = (window.AudioContext || window.webkitAudioContext).prototype;
      const original = prototype.createBufferSource;
      prototype.createBufferSource = function (...args) {
        const source = original.apply(this, args), start = source.start;
        source.start = function (...args) {
          if (source.buffer?.duration === 1 && args[2] === .15) window.__syntheticContactStarts++;
          return start.apply(this, args);
        };
        return source;
      };
    });
  }
  const url = new URL(base);
  url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  return page;
}
const snapshot = page => page.evaluate(() => window.__battle);
async function save(page, name) {
  stage = name;
  const data = await snapshot(page);
  observations.push({ stage, audio: data.footstepAudio, rifleAudio: data.rifleAudio,
    position: data.position, owner: data.control.soldierId, population: data.population,
    events: data.controlEvents, state: data.state });
  if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `${name}.png`) });
  return data;
}
async function walkTo(page, x, z) {
  await page.keyboard.down('c'); await page.keyboard.down('w');
  const result = await page.evaluate(({ x, z }) => new Promise(resolve => {
    const deadline = performance.now() + 30000;
    let walking = true, opening = null;
    const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code }));
    function frame() {
      const data = window.__battle, dx = x - data.position.x, dz = z - data.position.z;
      if (data.state !== 'playing' || performance.now() > deadline || Math.hypot(dx, dz) < .16) {
        key('keyup', 'KeyW'); resolve({ state: data.state, position: data.position }); return;
      }
      const yaw = Math.atan2(-dx, -dz), delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: data.look.pitch / .00132 }));
      if (opening && data.doors.find(door => door.id === opening)?.state === 'open') opening = null;
      const door = data.doors.find(door => door.state === 'closed' &&
        Math.hypot(door.x - data.position.x, door.z - data.position.z) < 2.2);
      if (!opening && door && !document.querySelector('#interaction-prompt').hidden) {
        opening = door.id; key('keydown', 'KeyF'); key('keyup', 'KeyF');
      }
      if (opening && walking) { key('keyup', 'KeyW'); walking = false; }
      if (!opening && !walking) { key('keydown', 'KeyW'); walking = true; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), { x, z });
  await page.keyboard.up('w'); await page.keyboard.up('c');
  assert.equal(result.state, 'playing');
  assert.ok(Math.hypot(result.position.x - x, result.position.z - z) < .3, `normal movement reaches (${x}, ${z})`);
  await page.waitForFunction(() => window.__battle.locomotion.speed === 0);
}
try {
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  const page = await open('interior');
  let data = await snapshot(page);
  assert.equal(data.footstepAudio.status, 'recorded');
  assert.equal(data.population.enemy.alive, 0, 'surface route is labelled geometry-only, not combat evidence');
  for (const sample of Object.values(data.footstepAudio.samples)) assert.ok(sample.duration <= .161);
  await page.locator('#deploy').click();
  await page.mouse.down({ button: 'right' });
  await walkTo(page, 0, 76);
  data = await save(page, 'stone-contact');
  assert.ok(data.footstepAudio.history.some(item => item.surface === 'stone' && item.sample === 'concrete.ogg'));
  await walkTo(page, 6, 76);
  data = await save(page, 'earth-contact');
  assert.ok(data.footstepAudio.history.some(item => item.surface === 'earth' && item.sample === 'grass.ogg'));
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__battle.footstepAudio.history.some(item => item.landing));
  await save(page, 'landing-contact');
  await page.keyboard.press('Escape');
  const paused = await snapshot(page);
  assert.equal(paused.footstepAudio.active, 0);
  await page.waitForTimeout(300);
  assert.deepEqual((await snapshot(page)).footstepAudio, paused.footstepAudio);
  await page.locator('#resume').click();
  await page.mouse.down({ button: 'right' });
  await walkTo(page, 0, 76); await walkTo(page, 0, 64); await walkTo(page, -8.5, 64);
  data = await save(page, 'wood-contact');
  assert.ok(data.footstepAudio.history.some(item => item.surface === 'wood' && item.sample === 'wood.ogg'));
  const standingCount = data.footstepAudio.counts.played;
  await page.waitForTimeout(300);
  assert.equal((await snapshot(page)).footstepAudio.counts.played, standingCount, 'standing still cannot generate contacts');
  const previous = data.control.soldierId;
  const nextMember = data.allies.find((actor, index) => index > data.current && actor.health > 0);
  assert.ok(nextMember);
  await page.keyboard.press('y');
  data = await snapshot(page);
  assert.notEqual(data.control.soldierId, previous);
  assert.equal(data.control.soldierId, nextMember.id);
  assert.ok(Math.abs(data.locomotion.stamina - nextMember.stamina) < .05, 'Y retains the actual teammate stamina, not an assumed full tank');
  assert.equal(data.footstepAudio.owner, data.control.soldierId);
  assert.equal(data.footstepAudio.active, 0, 'Y stops the previous contact tail immediately');
  assert.ok(data.footstepAudio.peakVoices <= 4);
  await save(page, 'owner-transfer');
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click(); await page.locator('#deploy').click();
  const restart = await snapshot(page);
  assert.equal(restart.footstepAudio.active, 0);
  const played = restart.footstepAudio.counts.played;
  await page.waitForTimeout(250);
  assert.equal((await snapshot(page)).footstepAudio.counts.played, played, 'new battle cannot replay old steps');
  await page.close();

  const full = await open('full');
  await full.locator('#deploy').click();
  data = await save(full, 'full-army-startup');
  assert.equal(data.population.friendly.alive, 110);
  assert.equal(data.population.enemy.alive, 96);
  await full.keyboard.down('w');
  await full.waitForFunction(() => window.__battle.footstepAudio.counts.played >= 2);
  await full.keyboard.up('w');
  await full.waitForFunction(() => window.__battle.locomotion.speed === 0);
  await full.mouse.down();
  await full.waitForFunction(() => window.__battle.rifleAudio.counts.owned >= 1);
  await full.mouse.up();
  data = await save(full, 'full-army-contact-and-rifle');
  assert.ok(data.footstepAudio.history.every(item => item.soldierId === data.control.soldierId));
  await full.close();

  const crew = await open('control');
  await crew.locator('#squad-choices [data-type="tank"]').click();
  await crew.locator('#deploy').click();
  assert.equal((await snapshot(crew)).type, 'tank');
  await crew.keyboard.press('f');
  assert.equal((await snapshot(crew)).type, 'infantry');
  await crew.keyboard.down('w');
  await crew.waitForFunction(() => window.__battle.footstepAudio.counts.played >= 1);
  await crew.keyboard.up('w');
  await crew.keyboard.press('y');
  data = await save(crew, 'vehicle-owner-transfer');
  assert.equal(data.type, 'tank');
  assert.equal(data.footstepAudio.active, 0);
  const crewPlayed = data.footstepAudio.counts.played;
  await crew.keyboard.down('w'); await crew.waitForTimeout(300); await crew.keyboard.up('w');
  assert.equal((await snapshot(crew)).footstepAudio.counts.played, crewPlayed);
  await crew.close();

  const failed = await open('interior', true);
  data = await snapshot(failed);
  assert.equal(data.footstepAudio.status, 'fallback');
  assert.ok(data.footstepAudio.error);
  assert.equal(data.rifleAudio.status, 'recorded', 'missing footstep must not disable the recorded rifle');
  await failed.locator('#deploy').click();
  assert.match(await failed.locator('#force-status').textContent(), /脚步录音未加载/);
  await failed.keyboard.down('w');
  await failed.waitForFunction(() => window.__battle.locomotion.footsteps > 0);
  await failed.keyboard.up('w');
  assert.ok(await failed.evaluate(() => window.__syntheticContactStarts > 0), 'the explicit fallback actually plays the old contact sound');
  await save(failed, 'explicit-fallback');
  await failed.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, stages: observations.map(item => item.stage),
    limitation: 'Surface route is a geometry fixture; normal 110v110 startup is not a performance or listening acceptance.' }));
} finally {
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'observations.json'),
    JSON.stringify({ stage, observations, requests, errors }, null, 2));
  await browser.close();
}
