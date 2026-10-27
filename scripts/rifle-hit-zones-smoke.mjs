import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true }), observations = [], errors = [];
try {
  for (const zone of ['head', 'torso', 'limb']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    try {
      const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173/');
      url.searchParams.set('benchmark', 'duel'); url.searchParams.set('seed', '1938');
      await page.goto(url.href);
      await page.waitForFunction(() => window.__battle?.state === 'menu' && !document.querySelector('#menu').hidden,
        null, { timeout: 90000 });
      await page.locator('#deploy').click();
      await page.waitForFunction(() => window.__battle.state === 'playing');
      const startZ = await page.evaluate(() => window.__battle.position.z);
      await page.keyboard.down('w');
      await page.waitForFunction(z => window.__battle.position.z < z - 2.2, startZ, { timeout: 10000 });
      await page.keyboard.up('w');
      await page.waitForFunction(() => window.__battle.enemyHistoricalForce.views.some(view => view.visible));
      await page.mouse.down({ button: 'right' });
      await page.waitForFunction(() => window.__battle.fov < 49);
      const result = await page.evaluate(zone => new Promise((resolve, reject) => {
        const before = window.__battle;
        const views = before.enemyHistoricalForce.views.filter(view => view.visible && view.soldier.health === 100)
          .sort((a, b) => Math.hypot(a.position[0] - before.position.x, a.position[2] - before.position.z) -
            Math.hypot(b.position[0] - before.position.x, b.position[2] - before.position.z));
        const target = views[0];
        if (!target) { reject(new Error('No visible full-health anatomical target')); return; }
        const [a, b] = zone === 'head' ? [target.head, target.headTop] :
          zone === 'torso' ? [target.hips, target.head] : [target.leftKnee, target.leftFoot];
        const point = a.map((value, i) => (value + b[i]) / 2);
        const dx = before.position.x - point[0], dz = before.position.z - point[2];
        const yaw = Math.atan2(dx, dz), pitch = Math.atan2(point[1] - before.position.y - before.locomotion.cameraHeight, Math.hypot(dx, dz));
        const delta = Math.atan2(Math.sin(yaw - before.look.yaw), Math.cos(yaw - before.look.yaw));
        document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - before.look.pitch) / .00132 }));
        const deadline = setTimeout(() => reject(new Error('No actual single shot')), 10000);
        const observe = () => {
          const data = window.__battle;
          if (data.rifle.shots > before.rifle.shots) {
            clearTimeout(deadline);
            document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
            document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
            document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
            resolve({ zone, point, targetId: target.soldier.id, trace: data.rifle.trace, ammo: data.ammo,
              damage: data.combatEvents.history.find(event => event.type === 'damage' && event.source.soldierId === before.control.soldierId),
              kills: data.kills, state: data.state });
          } else requestAnimationFrame(observe);
        };
        requestAnimationFrame(observe);
        document.querySelector('#world').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
      }), zone);
      observations.push(result);
      await page.screenshot({ path: join(directory, `${zone}.png`) });
      assert.equal(result.trace.targetId, result.targetId, JSON.stringify(result));
      assert.equal(result.trace.hitZone, zone, JSON.stringify(result));
      assert.equal(result.damage?.hitZone, zone, JSON.stringify(result));
      assert.equal(result.damage.amount, zone === 'limb' ? 40 : 100);
      assert.equal(result.damage.health, zone === 'limb' ? 60 : 0);
      assert.equal(result.kills, zone === 'limb' ? 0 : 1);
      assert.equal(result.ammo, 4);
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, cases: observations.map(item => ({ zone: item.zone, damage: item.damage.amount, health: item.damage.health })) }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
