import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const observedFixedShots = [];
      const originalFireAutomaticShot = fireAutomaticShot;
      fireAutomaticShot = function(transport, shot, source, start, yaw, pitch, aircraft, emplacementId) {
        const point = emplacements.get(emplacementId);
        if (!point || point.operatorId !== controlledSoldier(entities)?.id)
          return originalFireAutomaticShot(transport, shot, source, start, yaw, pitch, aircraft, emplacementId);
        const forward = camera.getWorldDirection(new THREE.Vector3()).toArray();
        const aim = { yaw: point.yaw, pitch: point.pitch };
        const result = originalFireAutomaticShot(transport, shot, source, start, yaw, pitch, aircraft, emplacementId);
        if (shot.gun === point.weapon && shot.gun.lastShot) {
          observedFixedShots.push({ id: emplacementId, yaw, pitch, aim, forward,
            start: shot.gun.lastShot.start, end: shot.gun.lastShot.end,
            spread: point.weapon.settings.spread });
        }
        return result;
      };
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
          if (actor.nativeMotion) actor.nativeMotion.position = {x: actor.position.x, z: actor.position.z};
          controlPose.yaw = point.yaw; controlPose.pitch = -.2;
          setGameState('playing'); bindControlInput(); updateCamera(0); updateHUD();
          return { blocked, before: point.yaw };
        },
        status(id) {
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          return { mounted: actor.emplacementId, yaw: point.yaw, shots: point.shots,
            ammo: point.weapon.ammo, operator: point.operatorId === actor.id,
            crosshairHidden: document.getElementById('crosshair').hidden,
            observedShots: observedFixedShots.filter(shot => shot.id === id) };
        },
        sight(id, pitch) {
          const point = emplacements.get(id);
          emplacementLook(point, point.yaw, pitch);
          point.view.userData.update(); updateCamera(0);
          let ring;
          point.view.traverse(object => { if (object.userData.sightReticle) ring = object; });
          if (!ring) throw new Error('AA ring sight missing');
          const projected = new THREE.Vector3(0, .25, -.45).applyMatrix4(ring.parent.matrixWorld).project(camera);
          return { x: projected.x, y: projected.y, crosshairHidden: document.getElementById('crosshair').hidden };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory&character=procedural',
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
    for (const pitch of [.05, .6, 1.3, 1.45]) {
      const sight = await page.evaluate(({ id, pitch }) => aaEntryReview.sight(id, pitch), { id, pitch });
      assert.equal(sight.crosshairHidden, true);
      assert.ok(Math.abs(sight.x) < 1e-6 && Math.abs(sight.y) < 1e-6, `${id}: ring is not centered at pitch ${pitch}`);
    }
    await page.evaluate(id => aaEntryReview.sight(id, .6), id);
    if (process.env.AA_SCREENSHOT && id === 'dock-aa') await page.screenshot({ path: process.env.AA_SCREENSHOT });
    await page.locator('#world').click();
    await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
    const fired = await page.evaluate(id => aaEntryReview.status(id), id);
    assert.ok(fired.shots > mounted.shots && fired.ammo < mounted.ammo, `${id} must actually fire`);
    assert.ok(fired.observedShots.length, `${id}: actual automatic-shot path must be observed`);
    for (const shot of fired.observedShots) {
      const yawDelta = Math.atan2(Math.sin(shot.yaw - shot.aim.yaw), Math.cos(shot.yaw - shot.aim.yaw));
      assert.ok(Math.abs(yawDelta) <= shot.spread + 1e-10);
      assert.ok(Math.abs(shot.pitch - shot.aim.pitch) <= shot.spread + 1e-10);
      const expected = [-Math.sin(shot.aim.yaw) * Math.cos(shot.aim.pitch), Math.sin(shot.aim.pitch),
        -Math.cos(shot.aim.yaw) * Math.cos(shot.aim.pitch)];
      assert.ok(Math.hypot(...expected.map((value, index) => value - shot.forward[index])) < 1e-6,
        `${id}: camera and unspread firing direction must match`);
      const travel = shot.end.map((value, index) => value - shot.start[index]);
      const distance = Math.hypot(...travel);
      assert.ok(distance > 0, `${id}: shot must have a nonzero trajectory`);
      const actual = [-Math.sin(shot.yaw) * Math.cos(shot.pitch), Math.sin(shot.pitch),
        -Math.cos(shot.yaw) * Math.cos(shot.pitch)];
      assert.ok(Math.hypot(...actual.map((value, index) => value - travel[index] / distance)) < 1e-6,
        `${id}: observed shot must follow its actual firing direction`);
    }
    await page.keyboard.press('f');
    await page.waitForFunction(id => !aaEntryReview.status(id).mounted, id);
    await page.waitForFunction(() => !document.getElementById('crosshair').hidden);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, mounts: ['dock-aa', 'gate-aa'], errors }));
} catch (error) {
  console.error(JSON.stringify({ errors }));
  throw error;
} finally { await browser.close(); }
