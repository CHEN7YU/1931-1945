import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.aaEntryReview = {
        prepare(id, offset) {
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          if (actor.emplacementId) releaseEmplacement(actor);
          point.yaw = point.heading + offset; point.view.userData.update();
          const blockedPose = emplacementPose(point, point.altitude).operator;
          const blocked = circleBlocked(blockedPose.x, blockedPose.z, .43,
            movementObstacles(blockedPose.x, blockedPose.z), blockedPose.y);
          const safe = emplacementEntry(point, point.altitude, p =>
            circleBlocked(p.x, p.z, .43, movementObstacles(p.x, p.z), p.y));
          if (!safe) throw new Error('No safe AA entry point');
          actor.position.set(safe.pose.operator.x, safe.pose.operator.y, safe.pose.operator.z);
          actor.nativeMotion.position = {x: actor.position.x, z: actor.position.z};
          controlPose.yaw = point.yaw; controlPose.pitch = -.2;
          setGameState('playing'); bindControlInput(); updateCamera(0); updateHUD();
          return { blocked, before: point.yaw };
        },
        status(id) {
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          return { mounted: actor.emplacementId, yaw: point.yaw, shots: point.shots,
            ammo: point.weapon.ammo, operator: point.operatorId === actor.id };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  for (const id of ['dock-aa', 'gate-aa']) {
    const before = await page.evaluate(id => aaEntryReview.prepare(id, Math.PI / 4), id);
    assert.equal(before.blocked, true, `${id}: test must reproduce the real blocker`);
    await page.keyboard.press('f');
    await page.waitForFunction(id => aaEntryReview.status(id).mounted === id, id, { timeout: 10000 });
    const mounted = await page.evaluate(id => aaEntryReview.status(id), id);
    assert.equal(mounted.operator, true);
    assert.notEqual(mounted.yaw, before.before);
    await page.locator('#world').click();
    await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    const fired = await page.evaluate(id => aaEntryReview.status(id), id);
    assert.ok(fired.shots > mounted.shots && fired.ammo < mounted.ammo, `${id} must actually fire`);
    await page.keyboard.press('f');
    await page.waitForFunction(id => !aaEntryReview.status(id).mounted, id);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, mounts: ['dock-aa', 'gate-aa'], errors }));
} finally { await browser.close(); }
