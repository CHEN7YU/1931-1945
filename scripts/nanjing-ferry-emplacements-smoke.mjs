import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.ferryEmplacementReview = {
        setup(id) {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), point = emplacements.get(id);
          if (!point) throw new Error('Missing emplacement ' + id);
          if (point.operatorId) {
            const operator = entities.soldiers.get(point.operatorId);
            if (!operator) throw new Error('Missing existing operator for ' + id);
            releaseEmplacement(operator, false);
          }
          point.playerOnly = true;
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          const pose = emplacementPose(point, floor);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          stopLocomotion(actor.locomotion);
          controlPose.yaw = point.heading; controlPose.pitch = -.15;
          setGameState('playing'); bindControlInput(); updateCamera(0);
          this.id = id;
          return this.sample();
        },
        sample() {
          const actor = controlledSoldier(entities), point = emplacements.get(this.id);
          return { mounted: actor.emplacementId, operator: point.operatorId, actor: actor.id,
            shots: point.shots, ammo: point.weapon.ammo, health: actor.health,
            position: actor.position.toArray() };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.locator('#world').click();
  const results = [];
  for (const id of ['ferry-north-mg', 'ferry-south-aa', 'ferry-south-gun']) {
    const before = await page.evaluate(id => ferryEmplacementReview.setup(id), id);
    await page.screenshot({ path: join(directory, `${id}-approach.png`) });
    await page.keyboard.press('KeyF');
    await page.waitForFunction(id => ferryEmplacementReview.sample().mounted === id, id, { timeout: 10000 });
    await page.screenshot({ path: join(directory, `${id}-mounted.png`) });
    await page.mouse.down();
    await page.waitForFunction(shots => ferryEmplacementReview.sample().shots > shots, before.shots, { timeout: 15000 });
    await page.mouse.up();
    const fired = await page.evaluate(() => ferryEmplacementReview.sample());
    assert.equal(fired.operator, fired.actor);
    assert.ok(fired.ammo < before.ammo);
    await page.keyboard.press('KeyF');
    const after = await page.evaluate(() => ferryEmplacementReview.sample());
    assert.equal(after.mounted, null);
    assert.equal(after.operator, null);
    results.push({ id, before, fired, after });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'emplacements.json'), JSON.stringify({ results, errors,
    limitation: 'Player manually placed at each actual weapon; enemies disabled and reviewed weapons reserved for player. F and mouse inputs use production game handlers.' }, null, 2));
  console.log(JSON.stringify({ passed: true, positions: results.map(result => result.id) }));
} finally {
  await browser.close();
}
