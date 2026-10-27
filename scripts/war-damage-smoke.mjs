import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'war-damage');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => {
  const state = window.__battle;
  return { state: state.state, time: state.time, position: state.position, damage: state.staticDamage, counts: state.entityCounts,
    friendly: state.population.friendly, enemy: state.population.enemy, bridge: state.bridgeSurfaces, look: state.look };
});
async function lookAt(point) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(point => {
    const state = window.__battle;
    const yaw = Math.atan2(state.position.x - point.x, state.position.z - point.z);
    const pitch = Math.atan2(point.y - (state.position.y + state.locomotion.eyeHeight),
      Math.hypot(point.x - state.position.x, point.z - state.position.z));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: (state.look.yaw - yaw) / .00132,
      movementY: (state.look.pitch - pitch) / .00132 }));
  }, point);
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100);
}
let failure = null;
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const initial = await snapshot();
  assert.equal(initial.friendly.alive, 100); assert.equal(initial.enemy.alive, 100);
  assert.equal(initial.damage.craters.length, 5); assert.equal(initial.damage.wrecks.length, 3);
  assert.equal(initial.damage.ruinedShops.length, 3);
  assert.equal(initial.counts.vehicles, 0, 'Scenery wrecks cannot create operable vehicle entities');
  observations.push({ stage: 'static-damage-and-full-roster', data: initial });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.y < -.08 || window.__battle.state !== 'playing', null, { timeout: 25000 });
  await page.keyboard.up('w');
  const crater = await snapshot();
  assert.equal(crater.state, 'playing');
  assert.ok(crater.position.y < -.08, 'Normal movement really descends into the shell crater');
  observations.push({ stage: 'physical-crater-floor', data: crater });
  const shellHole = initial.damage.craters.find(item => item.id === 'south-street');
  await lookAt({ x: shellHole.x, y: -.4, z: shellHole.z });
  await page.screenshot({ path: join(directory, 'shell-crater.png') });
  await lookAt({ x: -4.7, y: 2.8, z: 39.6 });
  await page.screenshot({ path: join(directory, 'partial-collapse.png') });
  await lookAt({ x: crater.position.x, y: crater.position.y + 1.67, z: -100 });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < 36 || window.__battle.state !== 'playing', null, { timeout: 15000 });
  await page.keyboard.up('w');
  await lookAt({ x: -2.7, y: 1.2, z: 31 });
  await page.screenshot({ path: join(directory, 'burned-truck.png') });
  observations.push({ stage: 'centre-lane-stays-passable', data: await snapshot() });
  assert.equal(observations.at(-1).data.state, 'playing');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, directory, craterFloor: crater.position.y, stages: observations.map(item => item.stage) }));
} catch (error) {
  failure = { message: error.message, stack: error.stack }; throw error;
} finally {
  await page.keyboard.up('w');
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors, failure }, null, 2));
  await context.close(); await browser.close();
}
