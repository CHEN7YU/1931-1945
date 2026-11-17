import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const map = process.env.PERFORMANCE_MAP ?? 'sihang';
assert.ok(['sihang', 'nanjing'].includes(map), 'PERFORMANCE_MAP must be sihang or nanjing');
const fullSihang = process.env.PROFILE_SIHANG_END === '1';
assert.ok(!fullSihang || map === 'sihang', 'PROFILE_SIHANG_END requires sihang');
const target = map === 'sihang' ? fullSihang ? 'sihang-retreat' : 'sihang-defense' : 'dock-defense';
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
page.on('framenavigated', frame => {
  if (frame === page.mainFrame()) actions.push({ action: 'page-navigation', url: frame.url(), wall: Date.now() });
});
await page.route('**/api/performance', async route => {
  const batch = route.request().postDataJSON();
  batches.push(batch);
  await route.fulfill({ status: 201, json: { id: batch.id, saved: true } });
});
if (walkToDock && map === 'nanjing' || fullSihang) {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    assert.ok(body.includes('const navigate = createNavigator('), 'Route guidance requires the development source');
    await route.fulfill({ response, body: `${body}
window.__profileRoute = goal => {
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0 || state !== 'playing') return { points: [], reason: 'control-transition' };
  const position = actor.position;
  if (nanjingCampaignMode) {
    const exit = nanjingWallExitWaypoint(position);
    if (exit) return { points: [exit], reason: 'wall-exit' };
    if (position.y > .25) return { points: [], reason: 'unsupported-height' };
  }
  const elevated = sihangCampaignMode ? world.elevatedPath(position, goal) : null;
  if (elevated?.length) return { points: elevated, reason: 'elevated-path' };
  if (sihangCampaignMode && position.y > .25) return { points: [], reason: 'no-elevated-path' };
  const points = navigate(position, goal);
  return { points, reason: navigate.stats.reason };
};` });
  });
}
let status = 'starting', targetStarted = null, profile = null, profiling = false, environment = null;
let walkAnchor = null, lastWalkProgress = null;
let lastRouteGoal = null, lastDestination = null;
const cdp = await page.context().newCDPSession(page);
const save = async () => writeFile(join(directory, 'natural-battle.json'), JSON.stringify({
  map, target, status, commit, dirty, url: url.href, environment, observations, actions, batches, errors,
  limitations: 'Headless local browser; diagnostic collection and CDP sampling add overhead. Automated player inputs are listed in actions; optional development-only route guidance queries the game navigator and adds overhead. No forced phase or actor mutations. Not a real player, GPU timing, whole-match acceptance, or a controlled before/after comparison. Scope timings may be nested. Corpse-distance pairs are not geometry intersections.',
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
      if (!b) throw new Error(`Battle snapshot unavailable at ${location.href}`);
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
        sihang: b.campaign && b.campaign.stage?.startsWith('sihang-') ? {
          outcome: b.campaign.outcome, assemblyReleased: b.campaign.assemblyReleased,
          finalRetreatOrdered: b.campaign.finalRetreatOrdered, playerRetreatOpen: b.campaign.playerRetreatOpen,
          retreat: b.campaign.retreat, voices: b.sihangVoices, ending: b.battleEnding } : null,
        fatal: !document.querySelector('#fatal').hidden };
    });
    observations.push(sample);
    if (sample.fatal) throw new Error('Fatal screen during battle');
    if (sample.stage === target && targetStarted === null) {
      targetStarted = Date.now();
      await cdp.send('Profiler.start'); profiling = true;
    }
    if (!fullSihang && targetStarted !== null && sample.stage !== target) { status = 'target-ended-early'; break; }
    if (targetStarted !== null && Date.now() - targetStarted >= targetSeconds * 1000) {
      if (!fullSihang) { status = 'target-observed'; break; }
      if (profiling) {
        profile = (await cdp.send('Profiler.stop')).profile; profiling = false;
        await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
      }
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
    const sihangAssembly = fullSihang && sample.stage === 'sihang-retreat' && !sample.sihang?.assemblyReleased &&
      !(sample.position?.x >= -34 && sample.position?.x <= 26 &&
        sample.position?.z >= -7.7 && sample.position?.z <= -.4 && Math.abs(sample.position?.y) < .4);
    const sihangExit = fullSihang && sample.stage === 'sihang-retreat' &&
      sample.sihang?.finalRetreatOrdered && !sample.sihang?.outcome;
    if (sample.state === 'playing' && sample.position &&
      (walkToDock && map === 'nanjing' && sample.stage === 'withdrawal' || sihangAssembly || sihangExit)) {
      const { x, z } = sample.position;
      if (!walkAnchor || Math.hypot(x - walkAnchor.x, z - walkAnchor.z) > 1) {
        walkAnchor = { x, z }; lastWalkProgress = Date.now();
      } else if (Date.now() - lastWalkProgress > 30000) {
        status = 'walk-blocked'; break;
      }
      const destination = sihangAssembly ? { x: 0, y: 0, z: -4 }
        : sihangExit ? { x: 90, y: 0, z: 4 } : { x: -66, y: 0, z: -80 };
      const destinationKey = `${destination.x},${destination.z}`;
      if (destinationKey !== lastDestination) { lastRouteGoal = null; lastDestination = destinationKey; }
      const route = await page.evaluate(goal => window.__profileRoute(goal), destination);
      if (route.reason === 'control-transition') {
        actions.push({ time: sample.time, action: 'control-transition' });
        walkAnchor = null; lastRouteGoal = null; lastDestination = null;
        await page.waitForTimeout(500);
        continue;
      }
      let goal = route.points.find(point => Math.hypot(point.x - x, point.z - z) > .6);
      if (!goal && lastRouteGoal && Math.hypot(lastRouteGoal.x - x, lastRouteGoal.z - z) > .6) {
        goal = lastRouteGoal; route.reason = 'previous-waypoint';
      }
      if (!goal) {
        status = 'route-unavailable';
        actions.push({ time: sample.time, action: 'route-unavailable', position: sample.position, reason: route.reason });
        break;
      }
      lastRouteGoal = goal;
      const dx = goal.x - x, dz = goal.z - z, yaw = sample.look.yaw;
      const forward = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      const side = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      const angle = Math.atan2(side, forward);
      const stalledSeconds = (Date.now() - lastWalkProgress) / 1000;
      const offsets = [1, -1, 2, -2, 3, -3, 4];
      const offset = stalledSeconds < 3 ? 0 : offsets[Math.floor((stalledSeconds - 3) / 2) % offsets.length];
      const sector = ((Math.round(angle / (Math.PI / 4)) + offset) % 8 + 8) % 8;
      const keys = [['w'], ['w', 'd'], ['d'], ['s', 'd'], ['s'],
        ['s', 'a'], ['a'], ['w', 'a']][sector];
      for (const key of keys) await page.keyboard.down(key);
      await page.waitForTimeout(Math.max(100, Math.min(600, Math.round(Math.hypot(dx, dz) * 200))));
      for (const key of keys) await page.keyboard.up(key);
      actions.push({ time: sample.time, action: 'walk', position: sample.position, destination, goal, reason: route.reason, offset, keys });
    } else {
      walkAnchor = null; lastRouteGoal = null; lastDestination = null;
      await page.waitForTimeout(fullSihang ? 5000 : 10000);
    }
  }
  if (status === 'running') status = 'wall-limit';
  if (profiling) { profile = (await cdp.send('Profiler.stop')).profile; profiling = false; }
  if (profile) await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  if (await page.evaluate(() => window.__battle?.state === 'playing')) await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await save();
  assert.deepEqual(errors, [], 'Browser errors were recorded');
  if (status !== (fullSihang ? 'battle-ended' : 'target-observed')) process.exitCode = 2;
  console.log(JSON.stringify({ map, status, observations: observations.length, batches: batches.length, errors }));
} catch (error) {
  status = 'failed';
  errors.push(error.message);
  throw error;
} finally {
  if (profiling) {
    profile = (await cdp.send('Profiler.stop')).profile;
    await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  }
  await save();
  await browser.close();
}
