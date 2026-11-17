import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const map = process.env.PERFORMANCE_MAP ?? 'sihang';
assert.ok(['sihang', 'nanjing'].includes(map), 'PERFORMANCE_MAP must be sihang or nanjing');
const target = map === 'sihang' ? 'sihang-defense' : 'dock-defense';
const wallSeconds = Number(process.env.PROFILE_WALL_SECONDS ?? 1200);
const targetSeconds = Number(process.env.PROFILE_TARGET_SECONDS ?? 120);
const walkToDock = process.env.PROFILE_NANJING_WALK === '1';
assert.ok(Number.isInteger(wallSeconds) && wallSeconds >= 60 && wallSeconds <= 3600);
assert.ok(Number.isInteger(targetSeconds) && targetSeconds >= 10 && targetSeconds <= wallSeconds);
assert.ok(process.env.ARTIFACT_DIR, 'ARTIFACT_DIR is required');
const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5179/');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'Diagnostics must stay local');
assert.equal(url.searchParams.has('benchmark'), false, 'Use the normal campaign roster');
url.searchParams.set('campaign', map);
url.searchParams.set('diagnostics', '1');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], batches = [], observations = [], actions = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/api/performance', async route => {
  const batch = route.request().postDataJSON();
  batches.push(batch);
  await route.fulfill({ status: 201, json: { id: batch.id, saved: true } });
});
let status = 'starting', targetStarted = null, profile = null, profiling = false, environment = null;
let walkGoal = null, bestDistance = Infinity, lastWalkProgress = null;
let detour = null, detourUsed = false;
const cdp = await page.context().newCDPSession(page);
const save = async () => writeFile(join(directory, 'natural-battle.json'), JSON.stringify({
  map, target, status, commit, dirty, url: url.href, environment, observations, actions, batches, errors,
  limitations: 'Headless local browser; diagnostic collection and CDP sampling add overhead. Automated player inputs are listed in actions; no forced phase or actor mutations. Not a real player, GPU timing, whole-match acceptance, or a controlled before/after comparison. Scope timings may be nested. Corpse-distance pairs are not geometry intersections.',
}, null, 2));
try {
  const settings = defaultPreferences();
  settings.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }));
  }, { key: PREFERENCES_KEY, settings });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__battle || document.querySelector('#overlay')?.dataset.deploymentStep ||
    !document.querySelector('#fatal').hidden, null, { timeout: 300000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  environment = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null };
  });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  const started = Date.now();
  status = 'running';
  while (Date.now() - started < wallSeconds * 1000) {
    const sample = await page.evaluate(() => {
      const b = window.__battle;
      const bodies = b.corpses.members;
      let near01 = 0, near05 = 0;
      for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], c = bodies[j];
        const ay = a.position.y + (a.offset?.y ?? 0), cy = c.position.y + (c.offset?.y ?? 0);
        if (Math.abs(ay - cy) > .25) continue;
        const dx = a.position.x + (a.offset?.x ?? 0) - c.position.x - (c.offset?.x ?? 0);
        const dz = a.position.z + (a.offset?.z ?? 0) - c.position.z - (c.offset?.z ?? 0);
        const d2 = dx * dx + dz * dz;
        if (d2 <= .01) near01++;
        if (d2 <= .25) near05++;
      }
      return { wall: Date.now(), build: b.build, state: b.state, time: b.time,
        stage: b.campaign?.stage, stageRemaining: b.campaign?.stageRemaining,
        population: b.population, clock: b.simulationClock, corpses: bodies.length,
        nearbyCorpsePairs: { within01m: near01, within05m: near05 }, type: b.type, position: b.position, look: b.look,
        fatal: !document.querySelector('#fatal').hidden };
    });
    observations.push(sample);
    if (sample.fatal) throw new Error('Fatal screen during battle');
    if (sample.stage === target && targetStarted === null) {
      targetStarted = Date.now();
      await cdp.send('Profiler.start'); profiling = true;
    }
    if (targetStarted !== null && sample.stage !== target) { status = 'target-ended-early'; break; }
    if (targetStarted !== null && Date.now() - targetStarted >= targetSeconds * 1000) {
      status = 'target-observed';
      break;
    }
    if (['victory', 'defeat', 'draw'].includes(sample.state)) { status = 'battle-ended'; break; }
    if (sample.state === 'dead') {
      const button = page.locator('#redeploy-choices [data-type]:not([disabled])').first();
      if (await button.isVisible()) {
        await button.click();
        const confirm = page.locator('#confirm-deploy');
        if (await confirm.isEnabled()) { await confirm.click(); actions.push({ time: sample.time, action: 'redeploy' }); }
      }
    }
    if (observations.length % 3 === 0) {
      console.log(`${map}: wall=${Math.round((Date.now() - started) / 1000)} sim=${sample.time.toFixed(1)} stage=${sample.stage} corpses=${sample.corpses}`);
      await save();
    }
    if (walkToDock && map === 'nanjing' && sample.state === 'playing' &&
      sample.stage === 'withdrawal' && sample.position) {
      const { x, z } = sample.position;
      if (detour && Math.hypot(detour.x - x, detour.z - z) < 4) detour = null;
      const goal = detour ?? (z > -20 ? { x: 0, z: -25 } : { x: -66, z: -80 });
      const dx = goal.x - x, dz = goal.z - z, yaw = sample.look.yaw;
      const goalKey = `${goal.x},${goal.z}`, distance = Math.hypot(dx, dz);
      if (goalKey !== walkGoal || distance < bestDistance - .5) {
        walkGoal = goalKey; bestDistance = distance; lastWalkProgress = Date.now();
      } else if (Date.now() - lastWalkProgress > 30000) {
        if (detourUsed) { status = 'walk-blocked'; break; }
        detour = { x: x + 3, z: -80 };
        detourUsed = true;
        actions.push({ time: sample.time, action: 'try-detour', position: sample.position, goal: detour });
        continue;
      }
      const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      const side = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      const keys = [];
      if (Math.abs(forward) > 2) keys.push(forward > 0 ? 'w' : 's');
      if (Math.abs(side) > 2) keys.push(side > 0 ? 'd' : 'a');
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(2000);
      for (const key of keys) await page.keyboard.up(key);
      actions.push({ time: sample.time, action: 'walk-to-dock', position: sample.position, keys });
    } else await page.waitForTimeout(10000);
  }
  if (status === 'running') status = 'wall-limit';
  if (profiling) { profile = (await cdp.send('Profiler.stop')).profile; profiling = false; }
  if (profile) await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  if (await page.evaluate(() => window.__battle?.state === 'playing')) await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await save();
  assert.deepEqual(errors, [], 'Browser errors were recorded');
  if (status !== 'target-observed') process.exitCode = 2;
  console.log(JSON.stringify({ map, status, observations: observations.length, batches: batches.length, errors }));
} finally {
  if (profiling) {
    profile = (await cdp.send('Profiler.stop')).profile;
    await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  }
  await save();
  await browser.close();
}
