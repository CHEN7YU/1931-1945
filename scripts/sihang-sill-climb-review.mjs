import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

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
      window.sillClimbReview = {
        setup(id) {
          setGameState('pause'); missionBriefing.hide();
          for (const actor of allForces) if (actor !== controlledSoldier(entities)) actor.health = 0;
          const actor = controlledSoldier(entities);
          const opening = world.landmarks.warehouse.breaches.find(item => item.id === id);
          const y = Math.floor(opening.bottom / SIHANG_WAREHOUSE.floorHeight) * SIHANG_WAREHOUSE.floorHeight;
          actor.position.set(opening.x, y, opening.z + .75);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.traversal.kind = 'grounded'; actor.stance = controlPose.stance = 'standing';
          controlPose.yaw = 0; controlPose.pitch = 0;
          stopLocomotion(actor.locomotion);
          actor.locomotion.stamina = 1;
          setGameState('playing'); bindControlInput(); updateCamera(0);
          return { y, sill: opening.bottom };
        },
        sample() {
          const actor = controlledSoldier(entities);
          return { position: actor.position.toArray(), kind: actor.traversal.kind,
            blocked: actor.traversal.blocked, health: actor.health, ammo: actor.rifle.ammo };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const records = [];
  for (const id of ['north-right-middle', 'north-main-lower']) {
    const initial = await page.evaluate(id => sillClimbReview.setup(id), id);
    await page.locator('#world').click();
    await page.screenshot({ path: join(directory, id + '-before.png') });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => sillClimbReview.sample().kind === 'vaulting', null, { timeout: 20000 });
    await page.waitForFunction(() => sillClimbReview.sample().kind === 'grounded', null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const result = await page.evaluate(() => sillClimbReview.sample());
    await page.screenshot({ path: join(directory, id + '-after.png') });
    assert.ok(result.position[1] > initial.y + .2 && result.position[1] <= initial.y + 1.35,
      JSON.stringify({ id, initial, result }));
    assert.ok(Math.abs(result.position[2] + 42) < .02 && !result.blocked && result.health > 0,
      JSON.stringify({ id, result }));
    await page.mouse.click(640, 360);
    await page.waitForFunction(ammo => sillClimbReview.sample().ammo < ammo, result.ammo, { timeout: 20000 });
    records.push({ id, initial, result, afterFire: await page.evaluate(() => sillClimbReview.sample()) });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'sill-climb.json'), JSON.stringify({
    fixture: 'Production Sihang battle; player manually placed at a breach, enemies disabled, actual Space input.',
    records, errors,
  }, null, 2));
  console.log(JSON.stringify(records));
} finally {
  await browser.close();
}
