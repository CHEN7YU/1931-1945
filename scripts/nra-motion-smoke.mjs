import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'nra-motion-observations');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), samples = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => ({ time: window.__battle.time, state: window.__battle.state,
  view: window.__battle.historicalCharacter }));
let failure = null;
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.time > 2 && window.__battle.historicalCharacter?.motion?.weight === 0, null, { timeout: 20000 });
  const initial = await snapshot(), resets = initial.view.motion.resets;
  for (const stage of ['idle', 'moving', 'settling', 'moving-again']) {
    if (stage.startsWith('moving')) await page.keyboard.down('s');
    const started = (await snapshot()).time, limit = stage === 'idle' ? 7 : stage === 'settling' ? 3 : 4;
    const wall = Date.now();
    while (Date.now() - wall < 20000) {
      const sample = await snapshot(); samples.push({ stage, ...sample });
      if (sample.time - started >= limit || sample.state !== 'playing') break;
      await page.waitForTimeout(100);
    }
    await page.keyboard.up('s');
    await page.screenshot({ path: join(directory, `${stage}.png`) });
  }
  const standing = samples.filter(sample => sample.view.motion.weight === 0 && sample.view.speed < .03);
  assert.ok(standing.length >= 5, 'Observe genuinely stationary native poses, not just an idle label');
  const hipY = standing.map(sample => sample.view.hips[1] - sample.view.position[1]);
  assert.ok(Math.max(...hipY) - Math.min(...hipY) < .002, 'Stationary hips must not cycle up and down');
  const moving = samples.filter(sample => sample.view.motion.weight > .7);
  assert.ok(moving.length >= 3);
  const gunY = moving.map(sample => sample.view.riflePose.muzzle[1] - sample.view.position[1]);
  assert.ok(Math.max(...gunY) - Math.min(...gunY) > .01, 'Weapon must follow the moving body');
  for (const sample of samples) {
    const view = sample.view, logical = view.logicalMuzzle, muzzle = view.riflePose.muzzle;
    assert.equal(view.motion.resets, resets, 'Start/stop must not repeatedly reset the action');
    assert.equal(view.issue, null);
    assert.ok(Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z) < 1e-4);
  }
  await page.keyboard.press('Escape');
  const paused = (await snapshot()).view.motion;
  await page.waitForTimeout(250);
  assert.deepEqual((await snapshot()).view.motion, paused);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, directory, standing: standing.length, moving: moving.length,
    hipVariation: Math.max(...hipY) - Math.min(...hipY), gunVariation: Math.max(...gunY) - Math.min(...gunY), resets }));
} catch (error) {
  failure = { message: error.message, stack: error.stack }; throw error;
} finally {
  await page.keyboard.up('s');
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, errors, failure }, null, 2));
  await context.close(); await browser.close();
}
