import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5187';
const out = process.env.ARTIFACT_DIR;
const production = process.env.PRODUCTION === '1';
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], requests = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => requests.push(request.url()));
const snapshot = () => page.evaluate(() => {
  const data = window.__battle;
  return data ? { state: data.state, time: data.time, benchmark: data.benchmark, population: data.population,
    enemies: data.enemyPositions, force: data.enemyHistoricalForce, focused: data.enemyHistoricalCharacter,
    friendly: data.historicalForce, entityCounts: data.entityCounts, performance: data.performance } : null;
});
try {
  await page.goto(new URL('/?benchmark=full&seed=1938', origin).href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' || !document.querySelector('#fatal').hidden, null, { timeout: 120000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').innerText());
  await page.locator('#menu-quality').selectOption('high');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.enemyHistoricalForce?.assigned === 98);
  const initial = await snapshot();
  assert.equal(Boolean(initial.benchmark), !production, 'diagnostic fixtures must remain development-only');
  assert.equal(initial.population.enemy.alive, 98);
  assert.equal(initial.population.friendly.alive, 110);
  assert.equal(initial.entityCounts.soldiers, 206);
  assert.equal(initial.enemies.length, 96);
  assert.equal(new Set(initial.force.members.map(actor => actor.id)).size, 96);
  assert.equal(initial.force.poseBanks, 44); assert.equal(initial.friendly.poseBanks, 44);
  assert.ok(initial.force.members.every(actor => actor.uniform === 'ija1938' && actor.helmet));
  assert.ok(initial.friendly.members.every(actor => actor.uniform === 'nra88'));
  assert.ok(initial.force.near <= 6 && initial.force.poolSize === 6 && initial.force.far > 0);
  assert.equal(initial.population.renderer.procedural.visible, 0, 'old soldier visuals must not be drawn over the new uniforms');
  observations.push({ stage: '88-infantry-and-eight-tank-crew', ...initial });
  if (out) await page.screenshot({ path: join(out, 'ija-full-army-game.png') });
  await page.waitForFunction(time => window.__battle.time > time + 4, initial.time, { timeout: 60000 });
  const moving = await snapshot();
  assert.ok(moving.enemies.some(actor => {
    const before = initial.enemies.find(item => item.id === actor.id);
    return before && Math.hypot(actor.x - before.x, actor.z - before.z) > .5;
  }), 'real enemy entities still move in the game');
  assert.ok(moving.enemies.some(actor => actor.speed > .5), 'Enemy movement speed is a simulation fact, not render-only translation');
  assert.ok(moving.force.members.some(actor => actor.motionSpeed > .5 && actor.motionWeight > .5),
    'Actual moving enemies select moving poses rather than sliding in idle');
  observations.push({ stage: 'normal-enemy-movement', ...moving });
  await page.keyboard.press('Escape');
  await page.locator('#back-menu').click();
  await page.waitForFunction(() => window.__battle.enemyHistoricalForce.assigned === 0);
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.enemyHistoricalForce.assigned === 98);
  const redeployed = await snapshot();
  assert.equal(redeployed.population.enemy.alive, 98);
  assert.ok(redeployed.force.near <= 3 && redeployed.force.poolSize <= 6);
  assert.ok(redeployed.force.members.every(actor => actor.uniform === 'ija1938'));
  observations.push({ stage: 'low-quality-redeployment', ...redeployed });
  assert.equal(requests.filter(url => url.endsWith('/ija-1938/character.glb')).length, 1, '110 enemy soldiers share one downloaded asset');
  assert.ok(!requests.some(url => url.includes('/uniform-study/')), 'game runtime must not build the research mannequin');
  assert.deepEqual(errors, []);

  if (!production) {
    await page.goto(new URL('/?benchmark=duel&seed=1938', origin).href);
    await page.waitForFunction(() => window.__battle?.state === 'menu' || !document.querySelector('#fatal').hidden, null, { timeout: 120000 });
    assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').innerText());
    await page.locator('#menu-quality').selectOption('high');
    await page.locator('#deploy').click();
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(() => window.__battle.enemyHistoricalForce.near > 0, null, { timeout: 15000 });
    } finally { await page.keyboard.up('w'); }
    const close = await snapshot();
    assert.ok(close.force.views.some(view => view.soldier.health > 0), 'close-up validation requires a living enemy');
    for (const view of close.force.views.filter(view => view.soldier.health > 0)) {
      assert.equal(view.issue, null);
      assert.equal(view.gait.source, 'native-foot-cycle');
      assert.ok(view.animationSources.every(name => !/^(walk|run)$|Walking_C|run_rest_calibrated|kneelingBoth/.test(name)));
      const actual = view.riflePose.muzzle, expected = view.logicalMuzzle;
      assert.ok(Math.hypot(actual[0] - expected.x, actual[1] - expected.y, actual[2] - expected.z) < 1e-4);
      assert.ok(view.geometry.triangles < 65000);
    }
    observations.push({ stage: 'actual-close-enemy-poses', ...close });
    if (out) await page.screenshot({ path: join(out, 'ija-close-enemies-game.png') });
  }
  assert.deepEqual(errors, []);
  console.log(production
    ? 'PASS: production 110-enemy deployment, faction separation, shared asset, low-quality redeployment and enemy movement; development-only duel fixture remains disabled.'
    : 'PASS: all 110 real enemies, faction separation, shared asset, near/far LOD, low-quality redeployment, enemy movement and displayed rifle alignment.');
} finally {
  if (out) {
    observations.push({ stage: 'final-observation', ...await snapshot() });
    await page.screenshot({ path: join(out, 'ija-final-game.png') });
    await writeFile(join(out, 'ija-force-observations.json'), JSON.stringify({ observations, errors, requests }, null, 2));
  }
  await browser.close();
}
