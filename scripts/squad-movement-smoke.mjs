import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const snapshot = () => page.evaluate(() => {
    const data = window.__battle;
    return { time: data.time, state: data.state, position: data.position, allies: data.allies,
      friends: data.friendlyPositions, enemies: data.enemyPositions };
  });
  await page.waitForFunction(() => window.__battle.time > 6, null, { timeout: 60000 });
  const settled = await snapshot();
  samples.push(settled);
  const ownIds = new Set(settled.allies.map(actor => actor.id));
  const guards = settled.friends.filter(actor => ownIds.has(actor.soldierId));
  assert.equal(guards.length, 10);
  assert.ok(guards.every(actor => actor.mode === 'guard' && actor.pathLength === 0),
    'stationary player squad guards instead of seeking rear formation slots');
  assert.ok(guards.some(actor => actor.stance === 'crouched' && actor.rifleReady));
  assert.ok(guards.some(actor => actor.stance === 'standing' && actor.rifleReady));
  const started = Date.now();
  await page.keyboard.down('w');
  await page.waitForFunction(z => window.__battle.position.z < z - 10, settled.position.z, { timeout: 40000 });
  await page.keyboard.up('w');
  while (samples.at(-1).time < 75 && Date.now() - started < 240000) {
    samples.push(await snapshot());
    await page.waitForTimeout(500);
  }
  assert.ok(samples.some(sample => sample.friends.some(actor => ownIds.has(actor.soldierId) &&
    actor.movement.speed > .5)), 'guards physically follow when the player walks away');
  assert.ok(samples.at(-1).friends.some(actor => ownIds.has(actor.soldierId) && actor.mode === 'guard'),
    'the squad guards again after catching the stopped player');
  assert.ok(samples.at(-1).time >= 75, 'complete the observation interval rather than reporting a timed-out run as success');
  const end = samples.at(-1), earlier = samples.find(sample => sample.time >= end.time - 10);
  const cornerStalls = end.friends.filter(actor => actor.x > -45 && actor.x < -35 && actor.z > 30 && actor.z < 45 &&
    ['assault', 'turn-to-path', 'wait-for-spacing', 'formation-advance', 'advance-to-objective'].includes(actor.mode) &&
    actor.pathGoal && Math.hypot(actor.x - actor.pathGoal.x, actor.z - actor.pathGoal.z) > 3).filter(actor => {
    const previous = earlier.friends.find(other => other.soldierId === actor.soldierId);
    return previous && Math.hypot(actor.x - previous.x, actor.z - previous.z) < 1;
  });
  assert.ok(cornerStalls.length < 3, `no persistent crowd at the west building corner: ${cornerStalls.map(actor => actor.soldierId)}`);
  assert.deepEqual(errors, []);
  const slow = samples.at(-1).friends.filter(actor => !ownIds.has(actor.soldierId) &&
    actor.movement.speed < .1 && actor.z > 40).map(actor => ({
    id: actor.soldierId, x: actor.x, z: actor.z, mode: actor.mode, blockedBy: actor.blockedBy,
    path: actor.pathGoal, traffic: actor.traffic,
  }));
  console.log(JSON.stringify({ result: 'PASS', time: end.time, cornerStalls: cornerStalls.length, slow }, null, 2));
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'squad-movement.json'), JSON.stringify({ samples, errors }, null, 2));
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'squad-movement.png') });
    }
  } finally {
    await browser.close();
  }
}
