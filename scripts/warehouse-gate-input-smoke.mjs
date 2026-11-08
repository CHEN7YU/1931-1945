import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__gateInputFixture=()=>{
 const actor=controlledSoldier(entities);
 actor.position.set(-20,0,-39.8);actor.traversal.kind='grounded';
 actor.stance='standing';actor.firingPose=null;actor.heading=0;actor.lookPitch=0;
 stopLocomotion(actor.locomotion);if(actor.nativeMotion)actor.nativeMotion.position={x:-20,z:-39.8};
 updateCamera(0);return world.doorSystem.focus(camera)?.groupId;
};
window.__gateInputState=()=>({
 gates:world.doorSystem.doors.filter(door=>door.groupId==='sihang-warehouse-north-gate').map(door=>({state:door.state,angle:door.angle})),
 emplacement:controlledSoldier(entities).emplacementId,
 state,time
});` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5347/');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  try { await deployFromMenu(page); }
  catch (error) {
    await writeFile(join(directory, 'gate-startup-failure.json'), JSON.stringify({
      error: error.message, errors, loading: await page.locator('#loading-message').textContent(),
      fatal: await page.locator('#fatal-message').textContent(), body: await page.locator('body').innerText(),
    }, null, 2));
    throw error;
  }
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  assert.equal(await page.evaluate(() => window.__gateInputFixture()), 'sihang-warehouse-north-gate');
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__gateInputState().gates.every(door => door.state === 'open'));
  const opened = await page.evaluate(() => window.__gateInputState());
  assert.ok(opened.emplacement === null || opened.emplacement === undefined,
    'F looked at the gate must not incorrectly mount the nearby MG');
  await page.screenshot({ path: join(directory, 'warehouse-gate-open.png') });
  await page.keyboard.press('f');
  await page.waitForFunction(() => window.__gateInputState().gates.every(door => door.state === 'closed'));
  const closed = await page.evaluate(() => window.__gateInputState());
  assert.equal(closed.state, 'playing');
  await page.screenshot({ path: join(directory, 'warehouse-gate-closed.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'gate-input.json'), JSON.stringify({ opened, closed, errors,
    note: 'Actual deployed player, real paired gate and F input; only the observation position is controlled' }, null, 2));
  console.log(JSON.stringify({ passed: true, pairedGateFInput: true, gameContinued: true }));
} finally { await browser.close(); }
