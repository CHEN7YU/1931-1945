import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { SIHANG_RULES, sihangSafePosition } from '../src/sihang-campaign.js';

const map = process.env.PERFORMANCE_MAP ?? 'sihang';
assert.ok(['sihang', 'nanjing'].includes(map), 'PERFORMANCE_MAP must be sihang or nanjing');
const fullSihang = process.env.PROFILE_SIHANG_END === '1';
assert.ok(!fullSihang || map === 'sihang', 'PROFILE_SIHANG_END requires sihang');
const fullNanjing = process.env.PROFILE_NANJING_END === '1';
assert.ok(!fullNanjing || map === 'nanjing', 'PROFILE_NANJING_END requires nanjing');
const prepareSihangAssembly = process.env.PROFILE_SIHANG_PREPARE === '1';
assert.ok(!prepareSihangAssembly || fullSihang, 'PROFILE_SIHANG_PREPARE requires PROFILE_SIHANG_END');
const exitWithLastWave = process.env.PROFILE_SIHANG_EXIT_WITH_WAVE === '1';
assert.ok(!exitWithLastWave || fullSihang, 'PROFILE_SIHANG_EXIT_WITH_WAVE requires PROFILE_SIHANG_END');
const activePlay = process.env.PROFILE_SIHANG_ACTIVE_PLAY === '1' || process.env.PROFILE_NANJING_ACTIVE_PLAY === '1';
assert.ok(process.env.PROFILE_SIHANG_ACTIVE_PLAY !== '1' || fullSihang,
  'PROFILE_SIHANG_ACTIVE_PLAY requires PROFILE_SIHANG_END');
assert.ok(process.env.PROFILE_NANJING_ACTIVE_PLAY !== '1' || fullNanjing,
  'PROFILE_NANJING_ACTIVE_PLAY requires PROFILE_NANJING_END');
const target = map === 'sihang' ? fullSihang ? 'sihang-retreat' : 'sihang-defense'
  : fullNanjing ? 'withdrawal-to-boats' : 'dock-defense';
const wallSeconds = Number(process.env.PROFILE_WALL_SECONDS ?? 1200);
const targetSeconds = Number(process.env.PROFILE_TARGET_SECONDS ?? 120);
const walkToDock = process.env.PROFILE_NANJING_WALK === '1' || fullNanjing;
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
let battleStarted = false, navigatedDuringBattle = false;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('crash', () => actions.push({ action: 'page-crash', wall: Date.now() }));
page.on('close', () => actions.push({ action: 'page-close', wall: Date.now() }));
page.on('framenavigated', frame => {
  if (frame !== page.mainFrame()) return;
  actions.push({ action: 'page-navigation', url: frame.url(), wall: Date.now() });
});
page.on('request', request => {
  if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
    if (battleStarted) navigatedDuringBattle = true;
    actions.push({ action: 'navigation-request', url: request.url(), method: request.method(), wall: Date.now() });
  }
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
window.__profileRoute = (goal, crossing) => {
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0 || state !== 'playing') return { points: [], reason: 'control-transition' };
  const position = actor.position;
  if (nanjingCampaignMode) {
    const exit = nanjingWallExitWaypoint(position);
    if (exit) return { points: [exit], reason: 'wall-exit' };
    if (position.y > world.groundHeight(position.x, position.z) + .5)
      return { points: [], reason: 'unsupported-height' };
  }
  if (sihangCampaignMode && crossing && position.y < 2) {
    const bridge = sihangBridgeCoordinates(position), length = SIHANG_BRIDGE.length;
    if (bridge.along >= -6 && bridge.along < length + 4 && Math.abs(bridge.across) < 6) {
      const lanes = [0, -2, 2].sort((a, b) => Math.abs(a - bridge.across) - Math.abs(b - bridge.across));
      for (const lane of lanes) {
        const along = Math.max(0, Math.min(length + 4, bridge.along + 2));
        const point = sihangBridgePoint(along / length, lane);
        if (sampledRouteClear(position, point, (x, z) => !infantryNavigationBlocked({ x, z }, position, .43, actor)))
          return { points: [point], reason: 'bridge-lane' };
      }
    }
  }
  const elevated = sihangCampaignMode ? world.elevatedPath(position, goal) : null;
  if (elevated?.length) return { points: elevated, reason: 'elevated-path' };
  if (sihangCampaignMode && position.y > .25) return { points: [], reason: 'no-elevated-path' };
  const points = navigate(position, goal);
  if (!points.length && nanjingCampaignMode && position.z < 16 && goal.z < -60) {
    const gateExit = { x: 0, z: 27 };
    const exitPoints = navigate(position, gateExit);
    if (exitPoints.length) return { points: exitPoints, reason: 'nanjing-gate-exit' };
  }
  return { points, reason: navigate.stats.reason };
};
${activePlay ? `window.__profileCombatInput = () => {
  const actor = controlledSoldier(entities);
  if (state !== 'playing' || !actor || actor.health <= 0 || actor.vehicleId || actor.emplacementId ||
    actor.hasFirearm === false || actor.dying || sihangCeasefire(actor)) return null;
  if (actor.rifle.action !== 'idle') return null;
  if (!actor.rifle.ammo) return { reload: true };
  const eye = new THREE.Vector3().copy(soldierEyePosition(actor));
  const sensitivity = lookSensitivity(preferenceValues, { aiming: true });
  let best = null;
  const range = infantryWeaponProfile(actor.rifle).range;
  for (const enemy of enemies) {
    if (enemy.health <= 0 || enemy.vehicleId || eye.distanceToSquared(enemy.position) > range ** 2) continue;
    const point = targetAimPoint(enemy), delta = new THREE.Vector3().copy(point).sub(eye);
    const yaw = Math.atan2(-delta.x, -delta.z), pitch = Math.atan2(delta.y, Math.hypot(delta.x, delta.z));
    const yawError = Math.atan2(Math.sin(controlPose.yaw - yaw), Math.cos(controlPose.yaw - yaw));
    const rawDx = Math.round(yawError / sensitivity), rawDy = Math.round((controlPose.pitch - pitch) / sensitivity);
    const score = Math.abs(rawDx) + 2 * Math.abs(rawDy) + eye.distanceTo(point) * .02;
    if (best && score >= best.score || !hasLine(eye, point, range)) continue;
    best = { dx: Math.max(-360, Math.min(360, rawDx)), dy: Math.max(-200, Math.min(200, rawDy)),
      fire: Math.abs(rawDx) <= 3 && Math.abs(rawDy) <= 3, score };
  }
  return best;
};` : ''}
window.__profileWithdrawalActors = () => {
  const wave = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat'
    ? sihangCampaign.withdrawalWave : null;
  if (!wave) return [];
  const resolved = new Set([...sihangCampaign.evacuatedIds, ...sihangCampaign.retreatLostIds]);
  const ids = new Set(sihangCampaign.retreatIds.filter(id => !resolved.has(id)));
  const waveIds = new Set(wave.squads.flat());
  return friendlyForces.filter(actor => ids.has(actor.id)).map(actor => {
    const target = entities.soldiers.get(actor.tactics.threatId);
    const traffic = actor.tactics.traffic;
    return { id: actor.id, health: actor.health, slot: actor.formation.sihangSlot,
      index: actor.index, position: actor.position.toArray(), mode: actor.tactics.mode,
      inWave: waveIds.has(actor.id), playerUnit: actor.playerUnit,
      heading: actor.heading, speed: actor.locomotion.speed, pathGoal: actor.pathGoal,
      path: actor.path?.slice(0, 3), pathReason: actor.tactics.pathReason,
      blockedBy: actor.tactics.blockedBy, riversideWaypoint: actor.tactics.sihangRiversideWaypoint,
      traffic: traffic ? { reason: traffic.reason, waitSeconds: traffic.waitSeconds } : null,
      target: target ? { id: target.id, health: target.health, position: target.position.toArray() } : null };
  });
};
${map === 'nanjing' ? `window.__profileNanjingStatus = () => {
  const player = controlledSoldier(entities);
  const civilian = nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians);
  return {
    ready: civilian.ready,
    civilians: { enRoute: civilian.enRoute, waiting: civilian.waiting, aboard: civilian.aboard,
      evacuated: civilian.evacuated, casualties: nanjingCampaign.civilianCasualties },
    aiBoarded: nanjingAISquadsBoarded(nanjingCampaign),
    aiBoardedCount: nanjingAIBoardedCount(nanjingCampaign),
    playerBoardingBoatId: nanjingCampaign.playerBoardingBoatId,
    playerEscaped: nanjingCampaign.playerEscaped,
    playerGrounded: player?.traversal?.kind === 'grounded',
    ferries: world.ferries.map(ferry => ({ id: ferry.userData.ferryId, state: ferry.userData.state,
      x: ferry.position.x, z: ferry.position.z, passengers: ferry.userData.troopPassengers?.length ?? 0 })),
  };
};` : ''}` });
  });
}
let status = 'starting', targetStarted = null, profile = null, profiling = false, environment = null;
let walkAnchor = null, lastWalkProgress = null;
let lastRouteGoal = null, lastDestination = null;
const withdrawalSnapshots = [];
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.requestWillBeSent', event => {
  if (event.type === 'Document') actions.push({
    action: 'document-request', url: event.request.url, initiator: event.initiator,
    redirectedFrom: event.redirectResponse?.url ?? null, wall: Date.now(),
  });
});
const save = async () => writeFile(join(directory, 'natural-battle.json'), JSON.stringify({
  map, target, status, commit, dirty, url: url.href, environment, prepareSihangAssembly, exitWithLastWave, activePlay,
  observations, withdrawalSnapshots,
  actions, batches, errors,
  limitations: 'Headless local browser; diagnostic collection and CDP sampling add overhead. Automated player inputs are listed in actions; optional development-only route guidance queries the game navigator and adds overhead. No forced phase or actor mutations. Not a real player, GPU timing, whole-match acceptance, or a controlled before/after comparison. Scope timings may be nested. Corpse-distance pairs are not geometry intersections.',
}, null, 2));
try {
  const settings = defaultPreferences();
  settings.quality.preset = 'low';
  await page.addInitScript(({ origin, key, settings }) => {
    if (window !== window.top || location.origin !== origin) return;
    localStorage.setItem(key, JSON.stringify({ version: 1, settings }));
  }, { origin: url.origin, key: PREFERENCES_KEY, settings });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__battle || document.querySelector('#overlay')?.dataset.deploymentStep ||
    !document.querySelector('#fatal').hidden, null, { timeout: 300000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  battleStarted = true;
  if (activePlay) assert.equal(await page.evaluate(() => typeof window.__profileCombatInput), 'function',
    'The active-play helper requires the instrumented Vite development page');
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
  let previousWaveNumber, previousWavePhase;
  let joinedLastWave = false;
  let nextReportAt = 0;
  while (Date.now() - started < wallSeconds * 1000) {
    if (navigatedDuringBattle) { status = 'page-reloaded'; break; }
    let sample;
    try {
      sample = await page.evaluate(({ troopLimit, captureWithdrawalActors, previousWaveNumber, previousWavePhase }) => {
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
      const wave = b.campaign?.withdrawalWave;
      const captureWave = wave && window.__profileWithdrawalActors &&
        (captureWithdrawalActors || wave.number !== previousWaveNumber || wave.phase !== previousWavePhase);
      return { wall: Date.now(), build: b.build, state: b.state, time: b.time,
        stage: b.campaign?.stage, stageRemaining: b.campaign?.stageRemaining,
        ...(window.__profileNanjingStatus ? { nanjing: window.__profileNanjingStatus(),
          campaignOutcome: b.campaign?.outcome, playerEscaped: b.campaign?.playerEscaped } : {}),
        population: b.population, clock: b.simulationClock, corpses: bodies.length,
        nearbyCorpsePairs: { within01m: near01, within05m: near05 }, type: b.type, position: b.position, look: b.look,
        sihang: b.campaign && b.campaign.stage?.startsWith('sihang-') ? {
          stageElapsed: b.campaign.stageElapsed, troopLimit,
          deployed: b.campaign.deployed, reserve: b.campaign.reserve,
          withdrawalWaveNumber: b.campaign.withdrawalWaveNumber,
          withdrawalWave: b.campaign.withdrawalWave ? {
            number: b.campaign.withdrawalWave.number, phase: b.campaign.withdrawalWave.phase,
            squadSizes: b.campaign.withdrawalWave.squads.map(squad => squad.length),
            memberCount: b.campaign.withdrawalWave.squads.reduce((count, squad) => count + squad.length, 0),
          } : null,
          waveAssemblyAt: b.campaign.waveAssemblyAt,
          outcome: b.campaign.outcome, assemblyReleased: b.campaign.assemblyReleased,
          finalRetreatOrdered: b.campaign.finalRetreatOrdered,
          retreat: b.campaign.retreat, voices: b.sihangVoices, ending: b.battleEnding } : null,
        ...(captureWave ? { withdrawalActors: window.__profileWithdrawalActors() } : {}),
        ...(window.__profileCombatInput ? { playerScore: b.squadScores.find(row => row.player) } : {}),
        fatal: !document.querySelector('#fatal').hidden };
      }, { troopLimit: SIHANG_RULES.troopLimit, captureWithdrawalActors: fullSihang && observations.length % 6 === 0,
        previousWaveNumber, previousWavePhase });
    } catch (error) {
      if (navigatedDuringBattle) {
        status = 'page-reloaded';
        actions.push({ action: 'evaluation-interrupted-by-navigation', message: error.message, wall: Date.now() });
        break;
      }
      throw error;
    }
    const waveNumber = sample.sihang?.withdrawalWave?.number, phase = sample.sihang?.withdrawalWave?.phase;
    if (sample.withdrawalActors) {
      withdrawalSnapshots.push({ time: sample.time, stageElapsed: sample.sihang?.stageElapsed,
        waveNumber, phase,
        saved: sample.sihang?.retreat?.saved, lost: sample.sihang?.retreat?.lost,
        reserve: sample.sihang?.retreat?.waiting, actors: sample.withdrawalActors });
      delete sample.withdrawalActors;
    }
    previousWaveNumber = waveNumber;
    previousWavePhase = phase;
    observations.push(sample);
    if (sample.fatal) throw new Error('Fatal screen during battle');
    if (sample.stage === target && targetStarted === null) {
      targetStarted = Date.now();
      await cdp.send('Profiler.start'); profiling = true;
    }
    if (!fullSihang && !fullNanjing && targetStarted !== null && sample.stage !== target) { status = 'target-ended-early'; break; }
    if (targetStarted !== null && Date.now() - targetStarted >= targetSeconds * 1000) {
      if (!fullSihang && !fullNanjing) { status = 'target-observed'; break; }
      if (profiling) {
        profile = (await cdp.send('Profiler.stop')).profile; profiling = false;
        await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
      }
    }
    if (['victory', 'defeat', 'draw', 'commemoration'].includes(sample.state)) { status = 'battle-ended'; break; }
    if (sample.state === 'dead') {
      const button = page.locator('#redeploy-choices [data-type]:not([disabled])').first();
      if (await button.isVisible()) {
        await button.click();
        const confirm = page.locator('#confirm-deploy');
        if (await confirm.isEnabled()) { await confirm.click(); actions.push({ time: sample.time, action: 'redeploy' }); }
      }
    }
    if (activePlay ? Date.now() >= nextReportAt : observations.length % 3 === 0) {
      nextReportAt = Date.now() + 15000;
      console.log(`${map}: wall=${Math.round((Date.now() - started) / 1000)} sim=${sample.time.toFixed(1)} stage=${sample.stage} corpses=${sample.corpses}`);
      await save();
    }
    const nanjingBoat = fullNanjing && sample.position && sample.stage === 'withdrawal-to-boats' &&
      sample.nanjing?.ready && sample.nanjing.aiBoarded && sample.nanjing.playerBoardingBoatId == null
      ? sample.nanjing.ferries.filter(ferry => ferry.state === 'docked')
        .sort((a, b) => Math.hypot(sample.position.x - a.x, sample.position.z - a.z) -
          Math.hypot(sample.position.x - b.x, sample.position.z - b.z))[0]
      : null;
    const nanjingBoatDistance = nanjingBoat && sample.position
      ? Math.hypot(sample.position.x - nanjingBoat.x, sample.position.z - nanjingBoat.z) : Infinity;
    if (sample.state === 'playing' && nanjingBoat && nanjingBoatDistance <= 3.9 &&
      sample.nanjing.playerGrounded) {
      await page.keyboard.press('f');
      actions.push({ time: sample.time, action: 'press-interact-to-board', ferryId: nanjingBoat.id,
        position: sample.position, readiness: sample.nanjing });
      await page.waitForTimeout(500);
      continue;
    }
    const sihangPreparation = prepareSihangAssembly && sample.stage === 'sihang-defense' &&
      sample.stageRemaining <= 65;
    const sihangAssembly = fullSihang &&
      (sihangPreparation || sample.stage === 'sihang-retreat' && !sample.sihang?.assemblyReleased) &&
      !(sample.position?.x >= -34 && sample.position?.x <= 26 &&
        sample.position?.z >= -7.7 && sample.position?.z <= -.4 && Math.abs(sample.position?.y) < .4);
    if (exitWithLastWave && waveNumber && sample.sihang.retreat.waiting === 0 &&
      sample.sihang.retreat.active <= 25) joinedLastWave = true;
    const sihangExit = fullSihang && sample.stage === 'sihang-retreat' && sample.position &&
      (sample.sihang.finalRetreatOrdered || joinedLastWave) &&
      !sample.sihang.outcome && !sihangSafePosition(sample.position);
    const nanjingDestination = nanjingBoat
      ? { x: nanjingBoat.x + 3.5, y: 0, z: nanjingBoat.z }
      : { x: -66, y: 0, z: -80 };
    const nanjingRouteStage = fullNanjing && ['withdrawal', 'dock-defense', 'withdrawal-to-boats'].includes(sample.stage) &&
      sample.position && sample.nanjing?.playerBoardingBoatId == null && !sample.nanjing?.playerEscaped &&
      (nanjingBoat ? nanjingBoatDistance > 2.5 : Math.hypot(sample.position.x + 66, sample.position.z + 80) > 2.5);
    if (sample.state === 'playing' && sample.position &&
      (walkToDock && map === 'nanjing' && sample.stage === 'withdrawal' || nanjingRouteStage || sihangAssembly || sihangExit)) {
      const { x, z } = sample.position;
      if (!walkAnchor || Math.hypot(x - walkAnchor.x, z - walkAnchor.z) > 1) {
        walkAnchor = { x, z }; lastWalkProgress = Date.now();
      } else if (Date.now() - lastWalkProgress > 30000) {
        status = 'walk-blocked'; break;
      }
      const destination = sihangAssembly ? { x: 0, y: 0, z: -4 }
        : sihangExit ? { x: 90, y: 0, z: 4 } : nanjingRouteStage ? nanjingDestination : { x: -66, y: 0, z: -80 };
      const destinationKey = `${destination.x},${destination.z}`;
      if (destinationKey !== lastDestination) { lastRouteGoal = null; lastDestination = destinationKey; }
      const route = await page.evaluate(({ goal, crossing }) => window.__profileRoute(goal, crossing),
        { goal: destination, crossing: sihangExit });
      if (route.reason === 'control-transition') {
        actions.push({ time: sample.time, action: 'control-transition' });
        walkAnchor = null; lastRouteGoal = null; lastDestination = null;
        await page.waitForTimeout(500);
        continue;
      }
      const waypointTolerance = route.reason === 'wall-exit' || fullNanjing && nanjingBoat ? .08 : .6;
      let goal = route.points.find(point => Math.hypot(point.x - x, point.z - z) > waypointTolerance);
      if (!goal && lastRouteGoal &&
        Math.hypot(lastRouteGoal.x - x, lastRouteGoal.z - z) > waypointTolerance) {
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
      const maxStepMs = route.reason === 'bridge-lane' ? 200 : 600;
      await page.waitForTimeout(Math.max(100, Math.min(maxStepMs, Math.round(Math.hypot(dx, dz) * 200))));
      for (const key of keys) await page.keyboard.up(key);
      actions.push({ time: sample.time, action: 'walk', position: sample.position, destination, goal,
        reason: route.reason, offset, keys, ...(sihangPreparation ? { preparingAssembly: true } : {}) });
    } else {
      walkAnchor = null; lastRouteGoal = null; lastDestination = null;
      if (activePlay && sample.state === 'playing' && !sample.sihang?.outcome) {
        const input = await page.evaluate(() => window.__profileCombatInput?.());
        if (navigatedDuringBattle) { status = 'page-reloaded'; break; }
        assert.notEqual(input, undefined, 'The active-play helper disappeared without a recorded navigation');
        if (input?.reload) {
          await page.keyboard.press('r');
          actions.push({ time: sample.time, action: 'reload' });
        } else if (input) {
          await page.mouse.move(640, 360);
          await page.mouse.down({ button: 'right' });
          try {
            await page.mouse.move(640 + input.dx, 360 + input.dy, { steps: 3 });
            if (input.fire) {
              await page.mouse.down({ button: 'left' });
              await page.waitForTimeout(100);
              await page.mouse.up({ button: 'left' });
            }
          } finally {
            await page.mouse.up({ button: 'right' });
          }
          actions.push({ time: sample.time, action: input.fire ? 'fire-visible' : 'aim-visible',
            dx: input.dx, dy: input.dy });
        }
        await page.waitForTimeout(input ? 350 : 800);
      } else await page.waitForTimeout(fullSihang ? 5000
        : fullNanjing && sample.stage === 'withdrawal-to-boats' ? 1000 : 10000);
    }
  }
  if (status === 'running') status = 'wall-limit';
  if (profiling) { profile = (await cdp.send('Profiler.stop')).profile; profiling = false; }
  if (profile) await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  if (!navigatedDuringBattle && await page.evaluate(() => window.__battle?.state === 'playing')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  if (fullSihang) {
    const observedWaves = observations.flatMap(sample => sample.sihang?.withdrawalWave ? [sample.sihang.withdrawalWave] : []);
    assert.ok(observedWaves.every(wave => wave.memberCount <= SIHANG_RULES.retreatWaveLimit),
      `Observed a withdrawal wave above the configured limit: ${JSON.stringify(observedWaves)}`);
    const defense = observations.find(sample => sample.stage === 'sihang-defense');
    assert.ok(!defense || defense.sihang.stageRemaining === SIHANG_RULES.defenseSeconds ||
      defense.sihang.stageElapsed <= SIHANG_RULES.defenseSeconds,
    `Unexpected Sihang defense duration: ${JSON.stringify(defense?.sihang)}`);
    console.log(JSON.stringify({ observedWaves: [...new Map(observedWaves.map(wave => [wave.number, wave])).values()].map(wave => ({
      number: wave.number, memberCount: wave.memberCount, squadSizes: wave.squadSizes,
    })), finalState: observations.at(-1)?.state, finalRetreat: observations.at(-1)?.sihang?.retreat }));
  }
  assert.deepEqual(errors, [], 'Browser errors were recorded');
  if (status !== (fullSihang || fullNanjing ? 'battle-ended' : 'target-observed')) process.exitCode = 2;
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
if (fullSihang && status === 'battle-ended') {
  const { state, sihang } = observations.at(-1);
  assert.equal(state, 'commemoration');
  assert.equal(sihang.outcome, 'withdrawal-ended');
}
if (fullNanjing && status === 'battle-ended') {
  const { state, campaignOutcome, playerEscaped } = observations.at(-1);
  assert.equal(state, 'commemoration');
  assert.equal(campaignOutcome, 'evacuated');
  assert.equal(playerEscaped, true);
}
