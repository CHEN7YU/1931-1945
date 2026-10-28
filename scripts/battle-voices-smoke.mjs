import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
const errors = [], requests = new Set();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (/battle-voices\/.*\.mp3/.test(response.url()) && response.ok()) requests.add(response.url());
  });
  const url = new URL(base); url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  const snapshot = () => page.evaluate(() => window.__battle);
  assert.equal((await snapshot()).battleVoices.status, 'ready');
  assert.equal(requests.size, 252, 'all actual Azure MP3s load and decode');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.battleVoices.history.some(item => item.cue === 'deploy'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('x');
  await page.waitForFunction(() => window.__battle.battleVoices.counts.command === 3);
  await page.keyboard.down('x'); await page.waitForTimeout(500); await page.keyboard.up('x');
  await page.waitForFunction(() => window.__battle.battleVoices.history.at(-1).cue === 'order-follow');
  assert.equal((await snapshot()).battleVoices.counts.command, 4);
  const route = await page.evaluate(() => new Promise(resolve => {
    const targets = [{ x: 0, z: 76 }, { x: 0, z: 64 }, { x: 0, z: 44 }, { x: 0, z: 34 }];
    const deadline = performance.now() + 60000;
    let index = 0, opening = null;
    const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code }));
    function frame() {
      const data = window.__battle, target = targets[index];
      if (data.state !== 'playing' || performance.now() > deadline || !target) {
        key('keyup', 'KeyW'); resolve({ state: data.state, completed: index === targets.length, position: data.position }); return;
      }
      const dx = target.x - data.position.x, dz = target.z - data.position.z;
      if (Math.hypot(dx, dz) < .25) { index++; requestAnimationFrame(frame); return; }
      const yaw = Math.atan2(-dx, -dz), delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .0022, movementY: data.look.pitch / .0022 }));
      if (opening && data.doors.find(door => door.id === opening)?.state === 'open') opening = null;
      const door = data.doors.find(door => door.state === 'closed' &&
        Math.hypot(door.x - data.position.x, door.z - data.position.z) < 2.2);
      if (!opening && door && !document.querySelector('#interaction-prompt').hidden) {
        opening = door.id; key('keydown', 'KeyF'); key('keyup', 'KeyF');
      }
      key(opening ? 'keyup' : 'keydown', 'KeyW');
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
  assert.ok(route.completed, `normal movement must reach the actual capture area: ${JSON.stringify(route)}`);
  await page.evaluate(() => {
    const data = window.__battle, objective = data.objectives.find(point => !point.captured);
    const dx = objective.x - data.position.x, dz = objective.z - data.position.z;
    const yaw = Math.atan2(-dx, -dz), pitch = -Math.atan2(1.7, Math.hypot(dx, dz));
    const delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .0022, movementY: (data.look.pitch - pitch) / .0022 }));
  });
  await page.keyboard.press('x');
  await page.waitForFunction(() => window.__battle.battleVoices.history.some(item => item.cue === 'order-advance'));
  await page.waitForFunction(() => window.__battle.objectives[0].captured, null, { timeout: 30000 });
  await page.waitForFunction(() => window.__battle.battleVoices.history.some(item =>
    item.cue === 'captured' && item.eventKey === 'objective:A:captured'), null, { timeout: 15000 });
  assert.ok((await snapshot()).battleVoices.history.some(item => item.cue === 'capturing' && item.eventKey === 'objective:A:capturing'),
    'real game updateObjectives must dispatch capture events, not only an isolated tracker test');
  await page.keyboard.press('Escape');
  assert.equal((await snapshot()).battleVoices.active, 0);
  const paused = (await snapshot()).battleVoices;
  await page.waitForTimeout(200);
  assert.deepEqual((await snapshot()).battleVoices, paused);
  await page.locator('#resume').click();
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  assert.equal((await snapshot()).battleVoices.history.length, 0);
  assert.equal((await snapshot()).battleVoices.queued, 0);
  await page.close();

  const integration = await browser.newPage();
  await integration.goto(base.href);
  const results = await integration.evaluate(async () => {
    const { loadBattleVoices, createObjectiveVoiceTracker } = await import('/src/battle-voices.js');
    const { makeObjectives, advanceCapture } = await import('/src/core.js');
    const { createTactics, observeVisualThreat, visibleTargetPoint } = await import('/src/tactics.js');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const voices = await loadBattleVoices(), context = new AudioContext();
    await context.resume(); voices.sync(true);
    const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 }, soldierId: 'player' };
    const tracker = createObjectiveVoiceTracker(), objective = makeObjectives()[0];
    const cues = [];
    for (const [dt, friendly, hostile] of [[1, true, false], [1, true, true], [24, false, true], [12, true, false]]) {
      const status = advanceCapture(objective, dt, friendly, hostile);
      for (const cue of tracker.update(objective, status)) {
        voices.event(context, cue); cues.push(cue);
      }
    }
    voices.event(context, 'rally-lost'); voices.event(context, 'victory');
    const deadline = performance.now() + 40000;
    while ((voices.snapshot.queued || voices.snapshot.active) && performance.now() < deadline) {
      voices.update(context, [], listener, 30, false);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    const events = voices.snapshot;
    voices.reset();
    const actors = [
      { id: 'friendly', team: 'friendly', health: 100, groundType: 'infantry', position: { x: 3, y: 0, z: 0 }, locomotion: { speed: 2 } },
      { id: 'enemy', team: 'enemy', health: 100, groundType: 'infantry', position: { x: -3, y: 0, z: 0 }, rifle: { action: 'reload' } },
    ];
    voices.update(context, [actors[0]], listener, 2);
    await new Promise(resolve => setTimeout(resolve, 4500));
    voices.update(context, [actors[1]], listener, 12);
    const ambient = voices.snapshot;
    const callouts = [];
    for (const [role, clock] of [['sniper', 3], ['machine-gunner', 10], ['tank', 12]]) {
      voices.reset();
      const angle = clock * Math.PI / 6;
      const player = { id: 'player', team: 'friendly', health: 100, position: { x: 0, y: 0, z: 0 } };
      const observer = { id: 'reporter', team: 'friendly', health: 100, groundType: 'infantry',
        position: { x: -2, y: 0, z: 1 }, tactics: createTactics(1, 0, 0) };
      const target = { id: 'sighted-enemy', team: 'enemy', health: 100, groundType: 'infantry', role,
        targetKind: role === 'tank' ? 'closed-armor' : 'person', vehicleId: role === 'tank' ? 'enemy-tank' : null,
        position: { x: Math.sin(angle) * 25, y: 0, z: -Math.cos(angle) * 25 } };
      const from = new THREE.Vector3(observer.position.x, 1.67, observer.position.z);
      const midpoint = from.clone().lerp(new THREE.Vector3(target.position.x, 1.1, target.position.z), .5);
      const wall = new THREE.Box3(midpoint.clone().addScalar(-2), midpoint.clone().addScalar(2));
      let blocked = true;
      const canSeePoint = point => {
        const to = new THREE.Vector3(point.x, point.y, point.z);
        const ray = new THREE.Ray(from, to.clone().sub(from).normalize());
        const hit = blocked ? ray.intersectBox(wall, new THREE.Vector3()) : null;
        return !hit || from.distanceTo(hit) >= from.distanceTo(to);
      };
      const sight = () => Boolean(visibleTargetPoint(target, canSeePoint));
      observeVisualThreat(observer.tactics, target, 2, canSeePoint);
      const participants = [player, observer, target];
      voices.update(context, participants, listener, 2, true, sight);
      const hiddenCount = voices.snapshot.counts.callout;
      blocked = false;
      observeVisualThreat(observer.tactics, target, 3, canSeePoint);
      voices.update(context, participants, listener, 3, true, sight);
      callouts.push({ hiddenCount, ...voices.snapshot.history.find(item => item.channel === 'callout') });
    }
    voices.reset(); await context.close();
    return { cues, events, ambient, callouts };
  });
  assert.deepEqual(results.cues, ['capturing', 'contested', 'setback', 'captured']);
  assert.deepEqual(results.events.history.map(item => item.cue), [...results.cues, 'rally-lost', 'victory']);
  assert.equal(results.events.queued, 0);
  assert.equal(results.events.active, 0);
  assert.deepEqual(results.ambient.history.map(item => item.team), ['friendly', 'enemy']);
  assert.ok(results.ambient.history[0].voice.startsWith('zh-CN-'));
  assert.ok(results.ambient.history[1].voice.startsWith('ja-JP-'));
  assert.deepEqual(results.callouts.map(item => item.cue), ['callout-sniper-3', 'callout-machine-gunner-10', 'callout-tank-12']);
  assert.ok(results.callouts.every(item => item.hiddenCount === 0 && item.soldierId === 'reporter'));
  assert.deepEqual(errors, []);
  await integration.close();

  const failed = await browser.newPage();
  await failed.route('**/assets/audio/battle-voices/friendly-0-advance-1.mp3', route => route.abort());
  await failed.goto(url.href);
  await failed.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  assert.equal((await failed.evaluate(() => window.__battle)).battleVoices.status, 'unavailable');
  await failed.locator('#deploy').click();
  assert.match(await failed.locator('#force-status').textContent(), /战场语音不可用/);
  await failed.close();
  console.log(JSON.stringify({ clips: requests.size, commands: 5, objectiveAndMatchEvents: results.events.history,
    ambient: results.ambient.history, callouts: results.callouts,
    actualObjectiveCapture: true, pauseAndRestart: true, missingAudioWarning: true }, null, 2));
} finally {
  await browser.close();
}
