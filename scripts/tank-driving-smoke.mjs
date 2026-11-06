import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5336/');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
url.searchParams.set('benchmark', 'control');
url.searchParams.set('seed', '1938');
const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.tankDrivingSample=()=>{
  const actor=controlledSoldier(entities),vehicle=occupiedVehicle(entities,actor);
  return {state,time,actorId:actor?.id,vehicleId:vehicle?.id,speed:vehicle?.speed,
    position:vehicle?{...vehicle.position}:null,ammo:vehicle?.weapon.ammo,trackDistance:vehicle?.trackDistance};
};
window.tankDrivingObserve=id=>{
  const vehicle=entities.vehicles.get(id);
  if(!vehicle)throw new Error('Observed original tank is missing');
  showOverlay('pause');missionBriefing.hide();$('overlay').hidden=true;
  if(weapon)weapon.visible=false;
  camera.position.copy(vehicle.position).add(new THREE.Vector3(6,3.2,5));
  camera.lookAt(vehicle.position.clone().add(new THREE.Vector3(0,1,0)));
  camera.updateMatrixWorld(true);
};` });
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.tankDrivingSample()?.state === 'playing', null, { timeout: 180000 });
  const snapshot = () => page.evaluate(() => tankDrivingSample());
  const initial = await snapshot();
  assert.equal(initial.speed, 0);
  await page.keyboard.down('KeyW');
  await page.waitForFunction(start => tankDrivingSample().time >= start + 1, initial.time, { timeout: 30000 });
  const accelerating = await snapshot();
  await page.keyboard.up('KeyW');
  const elapsed = accelerating.time - initial.time;
  assert.ok(accelerating.speed > 0 && accelerating.speed <= 1.6 * elapsed + .1);
  assert.ok(Math.hypot(accelerating.position.x - initial.position.x,
    accelerating.position.z - initial.position.z) <= .8 * elapsed ** 2 + .1);
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(400);
  assert.deepEqual(await snapshot(), paused);
  await page.locator('#resume').click();
  await page.waitForFunction(() => tankDrivingSample().speed === 0, null, { timeout: 30000 });
  const stopped = await snapshot();
  await page.keyboard.down('KeyS');
  await page.waitForFunction(start => tankDrivingSample().time >= start + 1, stopped.time, { timeout: 30000 });
  await page.keyboard.up('KeyS');
  const reversing = await snapshot();
  assert.ok(reversing.speed < 0 && reversing.speed >= -2.4);
  assert.equal(reversing.vehicleId, initial.vehicleId);
  assert.equal(reversing.ammo, initial.ammo);
  await page.keyboard.press('KeyY');
  const transferred = await snapshot();
  assert.notEqual(transferred.actorId, reversing.actorId);
  assert.equal(transferred.vehicleId, initial.vehicleId);
  const expectedSpeed = Math.min(0, reversing.speed + 3.2 * (transferred.time - reversing.time));
  assert.ok(Math.abs(transferred.speed - expectedSpeed) < .01,
    'crew handoff must preserve physical braking rather than reset the moving vehicle');
  await page.waitForFunction(() => tankDrivingSample().speed === 0, null, { timeout: 30000 });
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => tankDrivingSample().vehicleId === undefined, null, { timeout: 10000 });
  await page.evaluate(id => tankDrivingObserve(id), initial.vehicleId);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(directory, 'tank-driving.png') });
  const result = { initial, accelerating, paused, stopped, reversing, transferred, errors,
    limitation: 'Real W/S/Y/Escape controls in the explicit control fixture; not a full battle performance measurement.' };
  await writeFile(join(directory, 'tank-driving.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, elapsed, firstSpeed: accelerating.speed, reverseSpeed: reversing.speed }));
} finally { await browser.close(); }
