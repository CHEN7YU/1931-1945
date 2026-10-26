import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], doorId = 'west-0-east-door';
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
const door = async () => (await snapshot()).doors.find(item => item.id === doorId);
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
async function look(yaw, pitch = 0) {
  await page.evaluate(({ yaw, pitch }) => {
    const current = window.__battle.look;
    const delta = Math.atan2(Math.sin(yaw - current.yaw), Math.cos(yaw - current.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - current.pitch) / .00132 }));
  }, { yaw, pitch });
}
async function walkTo(x, z) {
  await page.keyboard.down('c'); await page.keyboard.down('w');
  for (let i = 0; i < 180; i++) {
    const data = await snapshot(), dx = x - data.position.x, dz = z - data.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .17) break;
    assert.equal(data.state, 'playing');
    if (distance < .75) await page.keyboard.up('w');
    await look(Math.atan2(-dx, -dz));
    await page.keyboard.down('w');
    await page.waitForTimeout(Math.min(100, Math.max(10, distance / 1.5 * 180)));
    if (distance < .75) {
      await page.keyboard.up('w');
      await page.waitForTimeout(130);
    }
  }
  await page.keyboard.up('w'); await page.keyboard.up('c');
  await page.waitForTimeout(150);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < .3, `ordinary movement reaches (${x}, ${z})`);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.mouse.down({ button: 'right' });
  assert.equal((await door()).state, 'closed');
  await walkTo(0, 64);
  await look(0, -.75); await page.keyboard.press('x');
  await walkTo(-2.4, 64);
  await look(Math.PI / 2);
  await page.waitForFunction(() => !document.querySelector('#interaction-prompt').hidden);
  assert.match(await page.locator('#interaction-prompt').textContent(), /F.*开门/);
  await capture('door-closed.png');
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.rifle.shots === 1);
  await page.mouse.up();
  assert.equal((await snapshot()).rifle.trace.doorId, doorId, 'actual gun ray hits the closed door leaf, not the room behind it');
  await page.keyboard.press('f');
  await page.waitForFunction(id => Math.abs(window.__battle.doors.find(item => item.id === id).angle) > .25, doorId);
  await page.keyboard.press('Escape');
  const paused = await door();
  await page.waitForTimeout(250);
  assert.equal((await door()).angle, paused.angle, 'pause freezes the door animation');
  await page.locator('#resume').click();
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id).state === 'open', doorId);
  await capture('door-open.png');
  await walkTo(-8.5, 64);
  assert.equal((await snapshot()).town.inside, 'west-0', 'open door can actually be crossed');
  await walkTo(-6.1, 64);
  await look(-Math.PI / 2);
  await page.waitForFunction(() => !document.querySelector('#interaction-prompt').hidden);
  await page.keyboard.press('f');
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id).blocked, doorId);
  const blocked = await snapshot();
  assert.equal(blocked.doors.find(item => item.id === doorId).state, 'blocked', 'closing stops before sweeping through the player');
  await page.waitForTimeout(200);
  const still = await snapshot();
  assert.ok(Math.hypot(still.position.x - blocked.position.x, still.position.z - blocked.position.z) < .05, 'door collision never teleports or pushes the player through a wall');
  await walkTo(-6.1, 65.5);
  await walkTo(-8.5, 65.5);
  await walkTo(-8.5, 64);
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id).state === 'closed', doorId);
  await walkTo(-6.8, 64); await look(-Math.PI / 2);
  await page.keyboard.press('f');
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id).state === 'open', doorId);
  assert.ok((await door()).angle > 1.4, 'opening from inside swings away to the other side');
  await walkTo(-2.5, 64);
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click(); await page.locator('#deploy').click();
  assert.equal((await door()).state, 'closed', 'starting a fresh battle restores authored door state');
  await page.mouse.up({ button: 'right' }); await page.mouse.down({ button: 'right' });
  await walkTo(0, 58.6); await walkTo(-2, 58.6);
  await look(Math.PI / 2, -.23); await page.keyboard.press('x');
  const orderPoint = (await snapshot()).allies[1].orderPoint;
  assert.ok(orderPoint.x < -6 && orderPoint.x > -10 && Math.abs(orderPoint.z - 58.6) < .4, `a command above the window sill points into this room: ${JSON.stringify(orderPoint)}`);
  await page.waitForFunction(id => window.__battle.doors.find(item => item.id === id).state === 'open', doorId, { timeout: 20000 });
  await page.waitForFunction(() => window.__battle.allies.some((actor, index) => index !== window.__battle.current && actor.x < -4.8 && actor.x > -12 && actor.z > 55 && actor.z < 69), null, { timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log('PASS: contextual F, closed-door bullet hit, opening/pause, actual passage, safe sweep, opposite-side opening, battle reset and AI opening a closed door to obey a window-issued indoor order.');
} catch (error) {
  const state = await snapshot();
  console.error(JSON.stringify({ position: state?.position, state: state?.state, door: state?.doors?.find(item => item.id === doorId),
    nearby: state?.population.units.flatMap(unit => unit.members).filter(actor => actor.health > 0 && Math.hypot(actor.x + 4.5, actor.z - 64) < 3) }));
  throw error;
} finally {
  await browser.close();
}
