import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="plane"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  const plane = () => page.evaluate(() => window.__battle.vehicles.find(vehicle => vehicle.team === 'friendly' && vehicle.type === 'plane'));
  const initial = await plane();
  await page.mouse.down({ button: 'right' });
  const moved = await page.evaluate(() => {
    const before = window.__battle.vehicles.find(v => v.team === 'friendly' && v.type === 'plane').heading;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -250, movementY: 0 }));
    const vehicle = window.__battle.vehicles.find(v => v.team === 'friendly' && v.type === 'plane');
    return { before, actual: vehicle.heading, target: vehicle.flightControl.targetHeading };
  });
  assert.equal(moved.actual, moved.before, 'mouse must not rotate the plane directly');
  assert.ok(moved.target > moved.before);
  let maximumBank = 0, turning = await plane();
  for (let sample = 0; sample < 30; sample++) {
    await page.waitForTimeout(50);
    turning = await plane();
    maximumBank = Math.max(maximumBank, Math.abs(turning.roll));
  }
  assert.ok(maximumBank > .1, `assisted turn bank was ${maximumBank}`);
  assert.ok(Math.abs(turning.heading - initial.heading) < 1);
  await page.keyboard.down('c');
  const looked = await page.evaluate(() => {
    const before = window.__battle.vehicles.find(v => v.team === 'friendly' && v.type === 'plane').flightControl.targetHeading;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 160, movementY: 50 }));
    const current = window.__battle.vehicles.find(v => v.team === 'friendly' && v.type === 'plane').flightControl;
    return { before, target: current.targetHeading, lookYaw: current.lookYaw };
  });
  assert.equal(looked.before, looked.target);
  assert.ok(looked.lookYaw < 0);
  await page.keyboard.up('c');
  const beforeThrottle = (await plane()).throttle;
  await page.mouse.wheel(0, 100);
  assert.ok((await plane()).throttle < beforeThrottle);
  await page.mouse.up({ button: 'right' });
  assert.equal(await page.locator('#flight-status').isVisible(), true);
  await page.screenshot({ path: join(directory, 'assisted-flight.png') });
  assert.equal(await page.locator('#fatal').isVisible(), false);
  assert.deepEqual(errors, []);
  const result = { initial, turning, moved, looked, passed: true };
  await writeFile(join(directory, 'player-aircraft.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, mouseTargetNotInstantAttitude: true, turningBank: turning.roll,
    headingAfterTwoSeconds: turning.heading, freeLookIndependent: true }));
} finally { await browser.close(); }
