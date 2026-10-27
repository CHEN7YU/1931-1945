import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'uniform-force');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], observations = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (request.url().includes('/assets/game/nra-88/')) requests.push(request.url()); });
const snapshot = () => page.evaluate(() => {
  const data = window.__battle;
  return { state: data.state, time: data.time, current: data.current, control: data.control, allies: data.allies,
    force: data.historicalForce, population: { friendly: data.population.friendly, enemy: data.population.enemy },
    renderer: data.population.renderer, rifle: data.rifle, position: data.position };
});
let failure = null;
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalForce?.assigned === 100);
  let data = await snapshot();
  assert.equal(data.population.friendly.alive, 100); assert.equal(data.population.enemy.alive, 100);
  assert.equal(new Set(data.force.members.map(actor => actor.id)).size, 100);
  assert.ok(data.force.members.every(actor => actor.uniform === 'nra88' && actor.helmet));
  assert.equal(data.force.members.find(actor => actor.id === data.control.soldierId).tier, 'hidden');
  assert.ok(data.force.near <= 6 && data.force.poolSize <= 6);
  assert.equal(data.force.poseBanks, 24);
  assert.ok(data.force.views.filter(view => view.soldier.health > 0).length >= 2, 'More than one uniformed soldier can be observed');
  observations.push({ stage: 'all-100-assigned', data });
  await page.screenshot({ path: join(directory, 'uniformed-squad.png') });
  const before = data.allies[1];
  await page.keyboard.press('y');
  await page.waitForFunction(id => window.__battle.control.soldierId === id, before.id);
  data = await snapshot();
  assert.equal(data.force.members.find(actor => actor.id === before.id).tier, 'hidden');
  assert.equal(data.rifle.id, before.rifle.id); assert.equal(data.rifle.ammo, before.rifle.ammo);
  assert.equal(data.allies[1].health, before.health);
  observations.push({ stage: 'Y-hides-owned-body', data });
  await page.keyboard.down('s');
  const started = data.time;
  let observedMoving = false;
  const movementWall = Date.now();
  while (Date.now() - movementWall < 20000) {
    data = await snapshot();
    if (data.force.views.some(view => ['walk', 'run'].includes(view.active))) {
      if (!observedMoving) {
        observations.push({ stage: 'actual-moving-poses', data });
        await page.screenshot({ path: join(directory, 'multiple-moving.png') });
      }
      observedMoving = true;
    }
    if (data.time >= started + 7) break;
    await page.waitForTimeout(100);
  }
  await page.keyboard.up('s');
  data = await snapshot();
  assert.equal(data.force.assigned, 100);
  assert.ok(observedMoving, 'Observe real moving poses during the displacement interval, not just the final stopped frame');
  for (const view of data.force.views.filter(view => view.soldier.health > 0)) {
    assert.equal(view.issue, null);
    const muzzle = view.logicalMuzzle, actual = view.riflePose.muzzle;
    assert.ok(Math.hypot(muzzle.x - actual[0], muzzle.y - actual[1], muzzle.z - actual[2]) < 1e-4);
  }
  observations.push({ stage: 'multiple-native-movers', data });
  await page.screenshot({ path: join(directory, 'multiple-moving.png') });
  await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  await page.waitForFunction(() => window.__battle.historicalForce.assigned === 0);
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalForce.assigned === 100);
  data = await snapshot();
  assert.equal(data.force.members.length, 100); assert.ok(data.force.poolSize <= 6);
  observations.push({ stage: 'new-deployment-no-stale-bodies', data });
  assert.deepEqual(errors, []);
  const modelRequests = requests.filter(url => url.endsWith('/character.fbx'));
  assert.equal(modelRequests.length, 1, 'Army members share one downloaded character, not 100 copies');
  console.log(JSON.stringify({ passed: true, directory, stages: observations.map(item => item.stage), modelDownloads: modelRequests.length }));
} catch (error) {
  failure = { message: error.message, stack: error.stack }; throw error;
} finally {
  await page.keyboard.up('s');
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors, requests, failure }, null, 2));
  await context.close(); await browser.close();
}
