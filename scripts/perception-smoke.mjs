import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function turnTo(goal) {
  for (let i = 0; i < 60; i++) {
    const heading = (await snapshot()).vehicles[0].heading;
    const delta = Math.atan2(Math.sin(goal - heading), Math.cos(goal - heading));
    if (Math.abs(delta) < .025) return;
    const key = delta > 0 ? 'a' : 'd';
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.min(150, Math.max(20, Math.abs(delta) / .8 * 450)));
    await page.keyboard.up(key);
  }
  assert.fail('Normal tank steering did not reach the requested heading');
}
async function driveToX(x) {
  const before = (await snapshot()).position.x;
  await page.keyboard.down('w');
  await page.waitForFunction(({ x, before }) => before > x ? window.__battle.position.x <= x : window.__battle.position.x >= x,
    { x, before }, { timeout: 10000 });
  await page.keyboard.up('w');
}
async function observe(stage) {
  const data = await snapshot();
  const sample = { stage, time: data.time, position: data.position, health: data.health, enemies: data.enemyPositions };
  observations.push(sample);
  return sample;
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  const initial = await snapshot(), crewIds = initial.allies.map(actor => actor.id);
  assert.equal(initial.benchmark?.scenario, 'full');
  assert.equal(initial.population.enemy.alive, 110);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z <= 0, null, { timeout: 25000 });
  await page.keyboard.up('w');
  await observe('approached-the-main-street-sightline');
  await page.waitForFunction(ids => window.__battle.enemyPositions.some(actor => ids.includes(actor.observation.targetId)),
    crewIds, { timeout: 15000 });
  const visible = await observe('visible-in-main-street');
  const targetObservers = visible.enemies.filter(actor => crewIds.includes(actor.observation.targetId));
  assert.ok(targetObservers.length > 0);
  await turnTo(-Math.PI / 2);
  const recording = page.evaluate(ids => new Promise(resolve => {
    const samples = [], deadline = performance.now() + 3500;
    const collect = () => {
      const data = window.__battle;
      samples.push({ time: data.time, position: data.position,
        enemies: data.enemyPositions.filter(actor => ids.includes(actor.observation.targetId)) });
      if (performance.now() >= deadline) resolve(samples);
      else requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }), crewIds);
  await driveToX(8);
  const occluded = await observe('behind-existing-street-geometry');
  await driveToX(9);
  const frames = await recording;
  observations.push({ stage: 'movement-frames', frames });
  const cachedMoving = frames.flatMap(frame => frame.enemies.filter(actor =>
    actor.engagementPoint && actor.observation.time < frame.time - .05 &&
    Math.hypot(actor.observation.point.x - frame.position.x, actor.observation.point.z - frame.position.z) > .3));
  assert.ok(cachedMoving.length > 0, 'moving a known target does not grant a free continuous position update');
  for (const frame of frames) for (const actor of frame.enemies) {
    if (actor.engagementPoint) assert.deepEqual(actor.engagementPoint, actor.observation.point,
      'the actual tactical point is the last observed copy, not live target coordinates');
  }
  const hidden = await observe('after-hidden-movement');
  const blockedObservations = [occluded, hidden, ...frames].flatMap(sample => sample.enemies.filter(actor =>
    crewIds.includes(actor.observation.targetId) && actor.sightCheck?.visible === false &&
    actor.sightCheck.targetId === actor.observation.targetId && sample.time - actor.sightCheck.time < 1 &&
    actor.observation.time < actor.sightCheck.time));
  assert.ok(blockedObservations.length > 0, 'real in-range, in-view geometry checks block sight without refreshing the remembered point');
  assert.equal(hidden.health, initial.health, 'normal sealed armor rules protect the observer test; no health override is used');
  await turnTo(Math.PI / 2);
  await driveToX(0);
  await page.waitForFunction(ids => {
    const data = window.__battle;
    return data.enemyPositions.some(actor => ids.includes(actor.observation.targetId) &&
      data.time - actor.observation.time < .8 && Math.abs(actor.observation.point.x - data.position.x) < 1);
  }, crewIds, { timeout: 15000 });
  await observe('visually-reacquired');
  assert.deepEqual(errors, []);
  console.log('PASS: actual tank movement, copied tactical knowledge, physical occlusion and visual reacquisition without state mutation.');
} finally {
  try {
    if (process.env.ARTIFACT_DIR) {
      await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.ARTIFACT_DIR, 'perception-observations.json'), JSON.stringify({ observations, errors }, null, 2));
    }
  } finally { await browser.close(); }
}
