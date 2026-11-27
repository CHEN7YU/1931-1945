import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { continueIdentitySelection, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    let source = await response.text();
    if (process.env.BRIDGE_BASELINE === '1') {
      const current = 'moveAirborne(point, dx, dz, radius, obstacles, bodyHeight, world.walkHeight)';
      if (!source.includes(current)) throw new Error('Cannot find airborne terrain check for baseline');
      source = source.replace(current, 'moveAirborne(point, dx, dz, radius, obstacles, bodyHeight)');
    }
    await route.fulfill({ response, body: source + `
      window.bridgeSideReview = {
        setup(x) {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), z = -7;
          actor.position.set(x, world.groundHeight(x, z), z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
          stopLocomotion(actor.locomotion);
          controlPose.yaw = 0; controlPose.pitch = -.1;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        setupAirborneRamp() {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), x = -.005, z = -24;
          actor.position.set(x, .1, z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
          stopLocomotion(actor.locomotion);
          Object.assign(actor.traversal, { kind: 'jumping', velocity: -1, baseY: .1, elapsed: 0, plan: null });
          controlPose.yaw = -Math.PI / 2; controlPose.pitch = -.1;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        setupWalkRamp() {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), x = .02, z = -24;
          actor.position.set(x, world.groundHeight(x, z), z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
          stopLocomotion(actor.locomotion);
          Object.assign(actor.traversal, { kind: 'grounded', velocity: 0, plan: null });
          controlPose.yaw = Math.PI / 2; controlPose.pitch = -.1;
          setGameState('playing'); bindControlInput(); updateCamera(0);
        },
        sample() {
          const actor = controlledSoldier(entities), p = actor.position;
          const ray = new THREE.Raycaster(new THREE.Vector3(p.x, 3, p.z), new THREE.Vector3(0, -1, 0), 0, 5);
          const hit = ray.intersectObjects(world.solids, false).find(item => item.point.y < .3);
          return { x: p.x, y: p.y, z: p.z, floor: world.groundHeight(p.x, p.z),
            rendered: hit?.point.y ?? null, cameraY: camera.position.y, traversal: actor.traversal.kind };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'taierzhuang-fort'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 }); await setQualityPreset(page, 'low');
  await page.locator('#confirm-campaign').waitFor({ state: 'visible', timeout: 180000 });
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.locator('#world').click();
  const runs = [];
  for (const x of process.env.RAMP_ONLY === '1' ? [] : [-1, 17]) {
    await page.evaluate(x => bridgeSideReview.setup(x), x);
    await page.keyboard.down('w');
    const samples = [], deadline = Date.now() + 45000;
    try {
      while (Date.now() < deadline) {
        const sample = await page.evaluate(() => bridgeSideReview.sample());
        samples.push(sample);
        if (sample.z < -25) break;
        await page.waitForTimeout(120);
      }
    } finally {
      await page.keyboard.up('w');
    }
    await page.screenshot({ path: join(directory, `side-${x}.png`) });
    const last = samples.at(-1);
    assert.ok(last.z < -25, `walking along bridge side ${x} stopped at ${JSON.stringify(last)}`);
    for (const sample of samples) {
      assert.ok(sample.y >= sample.floor - .06, `feet below terrain: ${JSON.stringify(sample)}`);
      if (sample.rendered !== null) assert.ok(sample.y >= sample.rendered - .1,
        `feet below visible ground: ${JSON.stringify(sample)}`);
    }
    runs.push({ x, samples });
  }
  await page.evaluate(() => bridgeSideReview.setupAirborneRamp());
  await page.keyboard.down('w');
  const rampSamples = [];
  try {
    for (let frame = 0; frame < 60; frame++) {
      rampSamples.push(await page.evaluate(() => bridgeSideReview.sample()));
      await page.waitForTimeout(20);
    }
  } finally {
    await page.keyboard.up('w');
  }
  if (process.env.BRIDGE_BASELINE === '1') console.log(JSON.stringify({
    rampSamples: [rampSamples[0], rampSamples[1], rampSamples.at(-1)],
  }));
  for (const sample of rampSamples)
    assert.ok(sample.y >= sample.floor - .06, `airborne ramp crossing below terrain: ${JSON.stringify(sample)}`);
  assert.equal(rampSamples.at(-1).traversal, 'grounded');
  assert.ok(rampSamples.at(-1).x < 0, 'raised ramp should block entry from below');
  await page.screenshot({ path: join(directory, 'airborne-ramp.png') });
  await page.evaluate(() => bridgeSideReview.setupWalkRamp());
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => {
      const sample = bridgeSideReview.sample();
      return sample.x < -.03 && sample.traversal === 'jumping' && sample.y < .54;
    }, null, { timeout: 5000, polling: 10 });
  } finally {
    await page.keyboard.up('w');
  }
  await page.keyboard.down('s');
  const rampWalkSamples = [];
  try {
    for (let frame = 0; frame < 60; frame++) {
      rampWalkSamples.push(await page.evaluate(() => bridgeSideReview.sample()));
      await page.waitForTimeout(20);
    }
  } finally {
    await page.keyboard.up('s');
  }
  for (const sample of rampWalkSamples)
    assert.ok(sample.y >= sample.floor - .06, `walk-off return below terrain: ${JSON.stringify(sample)}`);
  assert.equal(rampWalkSamples.at(-1).traversal, 'grounded');
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ runs, rampSamples, rampWalkSamples, errors,
    limitation: 'Low-quality gameplay diagnostic: player placed at each starting pose, enemies disabled, then moved by real keyboard input. Neither ramp case establishes the original screenshot path.' }, null, 2));
} finally {
  await browser.close();
}
