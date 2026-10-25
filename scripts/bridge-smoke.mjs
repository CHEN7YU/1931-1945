import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { groundHeight } from '../src/ground.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
async function turnTo(yaw, pitch = 0) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ yaw, pitch }) => {
    const look = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - look.yaw), Math.cos(yaw - look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - look.pitch) / .00132 }));
  }, { yaw, pitch });
  await page.mouse.up({ button: 'right' });
}
async function walkTo(x, z) {
  await page.keyboard.down('w');
  for (let i = 0; i < 300; i++) {
    const data = await snapshot();
    assert.equal(data.state, 'playing', 'ordinary live movement reaches the bridge');
    const dx = x - data.position.x, dz = z - data.position.z, distance = Math.hypot(dx, dz);
    if (distance < .65) break;
    await turnTo(Math.atan2(-dx, -dz));
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < 1.1, `reached (${x}, ${z}) without teleportation`);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  const probes = (await snapshot()).bridgeSurfaces;
  assert.ok(Math.abs(probes.deck - .45) < 1e-6, 'actual 3D bridge ray hit matches its support height');
  assert.ok(Math.abs(probes.northRamp - .225) < 1e-6 && Math.abs(probes.southRamp - .225) < 1e-6, 'visible ramp geometry and the height sampler agree');
  await walkTo(0, 0);
  await walkTo(8, 0);
  await walkTo(8, -16);
  let data = await snapshot();
  assert.equal(data.position.y, .45);
  await page.keyboard.press('Control');
  await page.waitForFunction(() => Math.abs(window.__battle.locomotion.cameraHeight - window.__battle.position.y - 1.05) < .03);
  data = await snapshot();
  assert.ok(Math.abs(data.locomotion.cameraHeight - .45 - 1.05) < .03, 'crouch eye height starts above the deck');
  await page.keyboard.press('z');
  await page.waitForFunction(() => Math.abs(window.__battle.locomotion.cameraHeight - window.__battle.position.y - .45) < .03);
  data = await snapshot();
  assert.equal(data.stance, 'prone');
  assert.ok(Math.abs(data.locomotion.cameraHeight - .9) < .03, 'prone camera is .45m above the .45m deck, not inside it');
  assert.ok(data.locomotion.cameraHeight - .07 > probes.deck);
  await turnTo(0, -.65);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'bridge-prone.png') });
  }
  await page.keyboard.press('z');
  await page.waitForTimeout(600);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__battle.locomotion.cameraHeight > 2.3);
  await page.waitForFunction(() => Math.abs(window.__battle.locomotion.cameraHeight - 2.12) < .03);
  await page.keyboard.press('z');
  await page.keyboard.press('y');
  data = await snapshot();
  assert.ok(Math.abs(data.position.y - groundHeight(data.position.x, data.position.z)) < 1e-6, 'Y changes support height to the newly controlled member immediately');
  assert.ok(data.locomotion.cameraHeight - data.position.y > .37, 'swapping prone members never drops the eyes into the support surface');
  assert.deepEqual(errors, []);
  console.log('PASS: real bridge/ramp ray heights, normal approach, raised character support, crouch/prone near-plane clearance, jumping and Y transfer.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ current: data?.current, health: data?.health, position: data?.position, stance: data?.stance, locomotion: data?.locomotion }));
  throw error;
} finally {
  await browser.close();
}
