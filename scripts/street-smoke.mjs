import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const snapshot = () => page.evaluate(() => window.__battle);
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
  await page.keyboard.down('c');
  await page.keyboard.down('w');
  const result = await page.evaluate(({ x, z }) => new Promise(resolve => {
    const deadline = performance.now() + 45000;
    let walking = true, opening = null;
    const key = (type, code) => document.dispatchEvent(new KeyboardEvent(type, { code }));
    function frame() {
      const data = window.__battle, dx = x - data.position.x, dz = z - data.position.z;
      if (data.state !== 'playing' || performance.now() > deadline || Math.hypot(dx, dz) < .16) {
        key('keyup', 'KeyW'); resolve({ state: data.state, position: data.position }); return;
      }
      const yaw = Math.atan2(-dx, -dz), delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
      document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: data.look.pitch / .00132 }));
      if (opening && data.doors.find(door => door.id === opening)?.state === 'open') opening = null;
      const prompt = document.querySelector('#interaction-prompt');
      const door = data.doors.find(door => door.state === 'closed' && Math.hypot(door.x - data.position.x, door.z - data.position.z) < 2.2);
      if (!opening && door && prompt.getClientRects().length > 0) {
        opening = door.id; key('keydown', 'KeyF'); key('keyup', 'KeyF');
      }
      if (opening && walking) { key('keyup', 'KeyW'); walking = false; }
      if (!opening && !walking) { key('keydown', 'KeyW'); walking = true; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), { x, z });
  assert.equal(result.state, 'playing', 'route remains ordinary live gameplay');
  await page.keyboard.up('w'); await page.keyboard.up('c');
  await page.waitForTimeout(160);
  const data = await snapshot();
  assert.ok(Math.hypot(data.position.x - x, data.position.z - z) < .3, `reached (${x}, ${z}) using real movement`);
}
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.mouse.down({ button: 'right' });
  let data = await snapshot();
  assert.deepEqual(data.town.visibility, { doorOpening: true, wall: false, window: true, sill: false, lintel: false }, 'actual wall apertures remain distinct from the physical door leaves');
  assert.equal(data.town.buildings.length, 25);
  assert.equal(data.town.buildings.filter(building => building.kind === 'home' && !building.riverSide).length, 6);
  assert.equal(data.doors.length, 93);
  assert.equal(data.staticDamage.craters.length, 5);
  assert.equal(data.staticDamage.ruinedShops.length, 3);
  assert.equal(data.staticDamage.wrecks.length, 3);
  await walkTo(0, 73);
  await look(0); await capture('street-narrow.png');
  await walkTo(0, 64);
  await walkTo(8.5, 64);
  assert.equal((await snapshot()).town.inside, 'east-0', 'the opposite street frontage is also enterable');
  await walkTo(0, 64);
  await walkTo(-8.5, 64);
  assert.equal((await snapshot()).town.inside, 'west-0', 'front door enters an actual room');
  assert.equal((await snapshot()).locomotion.surface, 'wood', 'indoor footsteps follow the actual wooden floor rather than outside earth');
  await look(Math.PI / 2, -.25); await capture('street-room.png');
  await walkTo(-8.5, 58.5);
  assert.equal((await snapshot()).town.inside, 'west-0', 'partition opening leads to back room');
  await look(0, -.75); await page.keyboard.press('x');
  const guardPoint = (await snapshot()).allies[1].orderPoint;
  assert.ok(guardPoint.z > 55 && guardPoint.z < 60 && Math.abs(guardPoint.x + 8.5) < .5, 'X uses the latest aim and marks this room, not an old camera direction');
  await page.waitForFunction(() => window.__battle.allies.some((actor, index) => index !== window.__battle.current && actor.x < -4.8 && actor.x > -12 && actor.z > 55 && actor.z < 69), null, { timeout: 20000 });
  await capture('street-ai-room.png');
  await walkTo(-8.5, 64);
  await walkTo(-16, 64);
  assert.equal((await snapshot()).town.inside, null, 'rear door leads into courtyard');
  await look(Math.PI / 2); await capture('street-courtyard.png');
  await walkTo(-23.5, 64);
  assert.equal((await snapshot()).town.inside, 'courtyard-shop', 'courtyard connects a separate third building');
  await walkTo(-16, 64);
  await walkTo(-16, 74);
  await walkTo(0, 74);
  assert.equal((await snapshot()).town.inside, null, 'courtyard gate and side lane return to the street without teleportation');
  await walkTo(-29.5, 74);
  await walkTo(-29.5, 64);
  await walkTo(-35.5, 64);
  assert.equal((await snapshot()).town.inside, 'west-home-0');
  assert.equal((await snapshot()).locomotion.surface, 'wood');
  await walkTo(-35.5, 58.5);
  await look(0, -.75); await page.keyboard.press('x');
  await page.waitForFunction(() => window.__battle.allies.some((actor, index) =>
    index !== window.__battle.current && actor.x > -39 && actor.x < -32 && actor.z > 55 && actor.z < 69),
  null, { timeout: 30000 });
  await capture('district-home-ai.png');
  await walkTo(-35.5, 64);
  await walkTo(-29.5, 64);
  await look(-Math.PI / 2, -.12); await capture('district-workshop-courtyard.png');
  await walkTo(-29.5, 52.5);
  await walkTo(-18, 52.5);
  await walkTo(-18, 46.5);
  await walkTo(-29.5, 46.5);
  await walkTo(-29.5, 45);
  await walkTo(-35.5, 45);
  assert.equal((await snapshot()).town.inside, 'west-home-1');
  await walkTo(-29.5, 45);
  await walkTo(-29.5, 46.5);
  await walkTo(-18, 46.5);
  await walkTo(-18, 52.5);
  await walkTo(0, 52.5);
  await walkTo(31.75, 52.5);
  await walkTo(31.75, 72);
  await look(0, -.1); await capture('district-back-lane.png');
  for (const [index, z] of [64, 45].entries()) {
    await walkTo(31.75, z);
    await walkTo(25.5, z);
    assert.equal((await snapshot()).town.inside, `east-home-${index}`);
    await walkTo(31.75, z);
    await walkTo(38, z);
    assert.equal((await snapshot()).town.inside, `east-lane-home-${index}`);
    await walkTo(31.75, z);
  }
  await walkTo(31.75, 52.5);
  await walkTo(0, 52.5);
  assert.deepEqual(errors, []);
  console.log('PASS: twenty-five buildings registered; six southern homes, courtyard gates, both back lanes and cross street walked; real player/AI entry and all existing fixed war damage retained. Canal buildings are walked by the separate bridge check. Geometry routes may use the interior diagnostic and are not a full-roster performance claim.');
} catch (error) {
  const state = await snapshot();
  console.error(JSON.stringify({ time: state?.time, state: state?.state, position: state?.position, allies: state?.allies, enemies: state?.enemyPositions?.length }));
  throw error;
} finally {
  await browser.close();
}
