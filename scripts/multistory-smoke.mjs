import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
async function turnTo(yaw, pitch = 0) {
  await page.mouse.move(720, 450);
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ yaw, pitch }) => {
    const look = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - look.pitch) / .00132 }));
  }, { yaw, pitch });
  await page.mouse.up({ button: 'right' });
}
async function walkTo(target) {
  let arrived = false;
  for (let i = 0; i < 350; i++) {
    assert.deepEqual(errors, [], 'the live movement loop must remain error-free');
    let data = await snapshot();
    assert.equal(data.state, 'playing');
    let dx = target.x - data.position.x, dz = target.z - data.position.z, distance = Math.hypot(dx, dz);
    if (distance < .12) { arrived = true; break; }
    if (distance < 1) {
      await page.keyboard.up('w');
      await page.waitForTimeout(200);
      data = await snapshot();
      dx = target.x - data.position.x; dz = target.z - data.position.z; distance = Math.hypot(dx, dz);
      if (distance < .12) { arrived = true; break; }
    }
    await turnTo(Math.atan2(-dx, -dz));
    await page.keyboard.down('w');
    await page.waitForTimeout(distance < 1 ? Math.min(140, Math.max(40, distance * 180)) : 100);
    if (distance < 1) await page.keyboard.up('w');
  }
  await page.keyboard.up('w');
  await page.waitForTimeout(250);
  const data = await snapshot();
  assert.ok(arrived && Math.hypot(data.position.x - target.x, data.position.z - target.z) < .3,
    JSON.stringify({ target, position: data.position }));
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'bridge'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  await page.keyboard.down('c');
  const building = (await snapshot()).town.buildings.find(item => item.id === 'canal-south-depot');
  assert.equal(building.storeys, 4);
  for (const [x, z] of [[8, -8.1], [43, -8.1], [43, -3], [43, 2]]) await walkTo({ x, z });
  for (const flight of building.stairs) {
    await walkTo(flight.lower);
    for (const waypoint of flight.path.slice(1)) await walkTo(waypoint);
    const data = await snapshot();
    assert.ok(Math.abs(data.position.y - flight.upper.y) < .001);
    assert.ok(data.locomotion.cameraHeight > data.position.y + 1.4);
    observations.push({ floor: flight.level + 1, position: data.position, camera: data.locomotion.cameraHeight });
    console.log(`Reached floor ${flight.level + 1}`);
  }
  await walkTo({ x: building.x - building.w / 4, z: building.stairs[0].upper.z });
  await walkTo({ x: building.x - building.w / 4, z: building.z - building.d / 2 + .75 });
  await page.keyboard.up('c');
  await turnTo(0, -.13);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(500);
  const before = await snapshot();
  await page.mouse.down();
  await page.waitForFunction(shots => window.__battle.rifle.shots > shots, before.rifle.shots, { timeout: 5000 });
  await page.mouse.up();
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(300);
  const after = await snapshot();
  assert.equal(after.rifle.shots, before.rifle.shots + 1, 'a real fourth-floor shot leaves the window');
  assert.ok(after.rifle.trace.start[1] > 10, 'the real muzzle is on the fourth floor');
  observations.push({ shot: after.rifle.trace });
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'fourth-floor-window.png') });
  }
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(300);
  assert.deepEqual((await snapshot()).position, paused.position);
  await page.locator('#resume').click();
  assert.ok(Math.abs((await snapshot()).position.y - 9.6) < .001);
  await page.keyboard.press('y');
  await page.waitForTimeout(150);
  const switched = await snapshot();
  const original = switched.allies[before.current];
  assert.ok(original.y > 9, 'the previous member is not reset to ground after Y');
  for (let i = 1; i < switched.allies.length; i++) await page.keyboard.press('y');
  assert.ok((await snapshot()).position.y > 9);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'multistory.json'), JSON.stringify(observations, null, 2));
  console.log('PASS: normal keyboard entry, three flights to the fourth floor, elevated rifle shot, pause and Y support. Geometry fixture, not a population/performance benchmark.');
} catch (error) {
  console.error(JSON.stringify({ errors, observations, position: (await snapshot())?.position }));
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'multistory-failure.png') });
  }
  throw error;
} finally {
  await browser.close();
}
