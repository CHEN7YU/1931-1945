import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'combat-postures');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], samples = [], captured = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
let failure = null;
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalForce?.assigned === 100);
  assert.equal(await page.evaluate(() => window.__battle.population.enemy.alive), 100);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z <= 42 || window.__battle.state === 'dead', null, { timeout: 40000 });
  await page.keyboard.up('w');
  const started = Date.now();
  while (Date.now() - started < 60000) {
    const data = await page.evaluate(() => {
      const state = window.__battle;
      return { time: state.time, state: state.state, friends: state.friendlyPositions,
        views: state.historicalForce.views, poseBanks: state.historicalForce.poseBanks };
    });
    samples.push(data);
    for (const view of data.views.filter(view => view.soldier.health > 0 && view.visible)) {
      assert.equal(view.issue, null);
      assert.ok(view.riflePose.left.error < .015 && view.riflePose.right.error < .015);
      const muzzle = view.logicalMuzzle, actual = view.riflePose.muzzle;
      assert.ok(Math.hypot(muzzle.x - actual[0], muzzle.y - actual[1], muzzle.z - actual[2]) < 1e-4);
      for (const stance of ['crouched', 'kneeling', 'kneelingBoth', 'prone', 'wallLeft', 'wallRight']) {
        if (view.motion[stance] > .95 && !captured.has(stance)) {
          captured.add(stance);
          await page.screenshot({ path: join(directory, `actual-${stance}.png`) });
        }
      }
    }
    assert.equal(data.poseBanks, 25);
    assert.ok(data.friends.every(actor => actor.bodyScaleY === 1));
    if (['victory', 'defeat', 'dead'].includes(data.state)) break;
    await page.waitForTimeout(200);
  }
  const actors = samples.flatMap(sample => sample.friends);
  for (const pose of ['standing', 'kneeling', 'kneelingBoth', 'prone']) {
    assert.ok(actors.some(actor => actor.firingPose === pose && actor.postureReady), `Real AI settles into ${pose}`);
    assert.ok(actors.some(actor => actor.lastShot?.firingPose === pose), `Real AI actually fires from ${pose}`);
  }
  assert.ok(actors.some(actor => actor.lastShot?.firingPose.startsWith('wall')), 'Real wall-adjacent AI actually fires');
  assert.ok(captured.has('kneeling') && captured.has('kneelingBoth'), 'Observe distinct near-detail one-knee and two-knee skeletons');
  for (const sample of samples) for (const view of sample.views.filter(view => view.visible && view.soldier.health > 0)) {
    const base = view.position[1];
    if (view.motion.kneeling > .99) {
      assert.ok(Math.abs(view.rightKnee[1] - base - .08) < .035, 'One-knee pose actually puts its right knee near ground');
      assert.ok(view.leftKnee[1] > base + .23, 'Its other knee is visibly raised, not another two-knee pose');
    }
    if (view.motion.kneelingBoth > .99) {
      assert.ok(Math.abs(view.leftKnee[1] - base - .08) < .035 && Math.abs(view.rightKnee[1] - base - .08) < .035);
    }
  }
  const lastShots = new Map();
  for (const sample of samples) for (const actor of sample.friends) {
    const shot = actor.lastShot, previous = lastShots.get(actor.id);
    if (!shot || previous?.time === shot.time) continue;
    if (previous && !previous.coverId && !shot.coverId) {
      assert.ok(Math.hypot(shot.position.x - previous.position.x, shot.position.z - previous.position.z) > 1.8);
      if (shot.eligiblePoses.some(pose => pose !== previous.firingPose)) assert.notEqual(shot.firingPose, previous.firingPose);
    }
    assert.ok(shot.speed <= .1 && shot.aimRecovery <= 0);
    lastShots.set(actor.id, shot);
  }
  assert.ok(actors.some(actor => actor.completedShotMoves > 0), 'Observed actual post-shot displacement');
  for (const pace of ['sprint', 'jog', 'aim']) assert.ok(actors.some(actor => actor.movement.mode === pace && actor.movement.speed > .5),
    `Observe actual ${pace} movement, not an unused preference`);
  const runners = samples.flatMap(sample => sample.views).filter(view => view.soldier.health > 0 && view.active === 'run' && view.gait?.legPose.factor < .9);
  assert.ok(new Set(runners.map(view => view.gait.legLift.toFixed(3))).size >= 3, 'Actual near runners use distinct bounded leg lift');
  assert.ok(new Set(runners.map(view => view.gait.strideScale.toFixed(3))).size >= 3, 'Their displacement-driven cadence is not identical');
  assert.ok(runners.some(view => view.gait.legPose.left?.sourceY - view.gait.legPose.left?.targetY > .03),
    'Lower lift changes actual animated feet, not just stored attributes');
  assert.ok(runners.some(view => view.gait.bodyLean > .08), 'Actual running torsos lean rather than only declaring a preference');
  assert.ok(new Set(runners.map(view => view.gait.runLean.toFixed(3))).size >= 3, 'Personal run lean is not uniform');
  assert.ok(new Set(actors.filter(actor => actor.enteredCover && actor.cover &&
    Math.hypot(actor.x - actor.cover.x, actor.z - actor.cover.z) < .28).map(actor => actor.id)).size >= 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, directory, nearPoses: [...captured], samples: samples.length,
    crouched: new Set(actors.filter(actor => actor.stance === 'crouched').map(actor => actor.id)).size,
    prone: new Set(actors.filter(actor => actor.stance === 'prone').map(actor => actor.id)).size }));
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await page.keyboard.up('w');
  await page.screenshot({ path: join(directory, 'final.png') });
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, errors, failure }, null, 2));
  await context.close(); await browser.close();
}
