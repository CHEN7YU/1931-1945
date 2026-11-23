import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch(), body = await response.text();
    const selection = 'const ironAim = !profile.automatic && !profile.scoped ? RIFLE_IRON_AIM : null;';
    assert.ok(body.includes(selection), 'review must use the current actual camera implementation');
    await route.fulfill({ response, body: body.replace(selection,
      'const ironAim = !window.legacySightReview && !profile.automatic && !profile.scoped ? RIFLE_IRON_AIM : null;') + `
      window.freezeSightReview = legacy => {
        showOverlay('pause'); missionBriefing.hide();
        window.legacySightReview = legacy;
        state = 'playing'; held.aiming = true;
        for (let frame = 0; frame < 120; frame++) updateCamera(1 / 60);
        activeStates.delete('playing'); $('overlay').hidden = true; weapon.visible = true;
        const project = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(weapon.matrixWorld).project(camera).toArray();
        return { rearLeft: project(-.004, .055, -.36), rearRight: project(.004, .055, -.36),
          front: project(0, .05, -.857), muzzle: weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3()).toArray(),
          weaponPosition: weapon.position.toArray(), pitch: weapon.rotation.x,
          hands: weaponHands?.snapshot, rifle: structuredClone(allies[current].rifle), time };
      };` });
  });
  await page.goto(new URL('/?campaign=nanjing', process.env.GAME_URL ?? 'http://127.0.0.1:5334').href,
    { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'high'); await deployFromMenu(page);
  await page.waitForFunction(() => window.freezeSightReview && __battle.state === 'playing', null, { timeout: 180000 });
  await page.keyboard.press('Enter');
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => __battle.fov < 48.01 && __battle.rifle.sights.every(point =>
    Math.abs(point.x) < .002 && Math.abs(point.y) < .002), null, { timeout: 30000 });
  const input = await page.evaluate(() => ({ sights: __battle.rifle.sights, hands: __battle.rifle.model.nativeHands }));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __battle.state === 'pause' && document.pointerLockElement === null);
  const before = await page.evaluate(() => freezeSightReview(true));
  assert.equal(await page.locator('#overlay').isVisible(), false);
  await page.screenshot({ path: join(directory, 'rifle-sight-before.png') });
  const after = await page.evaluate(() => freezeSightReview(false));
  await page.screenshot({ path: join(directory, 'rifle-sight-after.png') });
  assert.ok(Math.abs(before.front[1] - before.rearLeft[1]) > .01, 'the old visible shoulder misalignment must reproduce');
  assert.ok(Math.abs(after.front[1] - after.rearLeft[1]) < .002);
  assert.ok(Math.abs(after.front[0]) < .002 && Math.abs(after.front[1]) < .002);
  assert.ok(after.rearLeft[0] < after.front[0] && after.rearRight[0] > after.front[0]);
  assert.equal(after.hands.visible, true);
  for (const side of ['left', 'right']) assert.ok(after.hands[side].arm.reachable);
  assert.deepEqual(after.rifle, before.rifle);
  assert.equal(after.time, before.time);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'rifle-sight-review.json'), JSON.stringify({
    input, before, after, errors,
    scope: 'Right mouse input in the actual Nanjing game, then same-scene old/new camera composition with simulation stepping disabled. Camera settling is advanced without advancing combat; not natural combat or user visual acceptance.',
  }, null, 2));
  console.log('PASS: actual right-mouse sight alignment, same-scene old/new visible shoulders, and reachable native hands.');
} finally {
  await browser.close();
}
