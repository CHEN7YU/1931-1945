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
      window.ferryRegression = {
        prepareVault() {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          nanjingCampaign.stage = 'withdrawal-to-boats';
          const actor = controlledSoldier(entities), x = NANJING_DOCK.x + 9.25;
          actor.position.set(x, world.groundHeight(x, -90.7), -90.7);
          if (actor.nativeMotion) actor.nativeMotion.position = { x, z: -90.7 };
          actor.traversal.kind = 'grounded'; actor.locomotion.stamina = 1;
          controlPose.yaw = Math.PI; controlPose.stance = 'standing';
          setGameState('playing'); bindControlInput(); updateCamera(0);
          return actor.position.toArray();
        },
        vault() {
          const actor = controlledSoldier(entities);
          return { position: actor.position.toArray(), kind: actor.traversal.kind };
        },
        deadline() {
          setGameState('pause');
          const civilian = world.civilians[0], ferry = world.ferries[0];
          for (const person of world.civilians) {
            person.visible = false; person.userData.dead = true;
          }
          Object.assign(civilian.userData, { dead: false, health: 100, arrived: true,
            evacuated: false, unrescued: false, boarding: true, active: true });
          scene.add(civilian); civilian.visible = true;
          const { shore, plank } = ferryBoardingPoints(ferry);
          const floor = ferry.position.y + NANJING_FERRY_FLOOR;
          civilian.position.set(plank.x, floor, plank.z);
          const boat = nanjingCampaign.boats[ferry.userData.ferryId];
          Object.assign(boat, { passengers: 0, returning: false });
          Object.assign(ferry.userData, { state: 'docked', passengers: [], troopPassengers: [],
            boarding: { civilian, path: [{ x: ferry.position.x, y: floor, z: ferry.position.z }],
              returnPath: [{ ...plank, y: floor }, { ...shore, y: world.groundHeight(shore.x, shore.z) }] } });
          world.civilianQueue.length = 0;
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats', outcome: null,
            finalWithdrawalElapsed: NANJING_CIVILIAN_FINAL_WAIT, finalShoreWaitExpired: false,
            civiliansWaiting: 1, civiliansUnrescued: 0, civiliansAboard: 0, dockActivated: true });
          let maxStep = 0, previous = civilian.position.clone();
          for (let frame = 0; frame < 300 && (frame === 0 || ferry.userData.boarding); frame++) {
            time += .05; updateNanjingCivilians(.05);
            maxStep = Math.max(maxStep, civilian.position.distanceTo(previous)); previous.copy(civilian.position);
          }
          return { position: civilian.position.toArray(), shore,
            unrescued: civilian.userData.unrescued, boarding: civilian.userData.boarding,
            ferryBusy: !!ferry.userData.boarding, maxStep,
            inWater: world.isDeepWater(civilian.position.x, civilian.position.z),
            count: nanjingCampaign.civiliansUnrescued };
        },
        boatView(view = 'bow') {
          setGameState('pause');
          const boat = world.ferries[0];
          boat.position.set(-135, .05, -80);
          boat.userData.rower.visible = false;
          scene.updateMatrixWorld(true);
          const positions = { bow: [-.6, 1.25, 0], stern: [.6, 1.25, 0],
            port: [0, 2.4, -5], starboard: [0, 2.4, 5] };
          const targets = { bow: [3.2, .45, 0], stern: [-3.2, .45, 0],
            port: [0, .45, 0], starboard: [0, .45, 0] };
          if (!positions[view]) throw new Error('Unknown ferry view: ' + view);
          camera.position.copy(boat.localToWorld(new THREE.Vector3(...positions[view])));
          camera.lookAt(boat.localToWorld(new THREE.Vector3(...targets[view])));
          for (const child of camera.children) child.visible = false;
          $('hud').hidden = true; renderer.render(scene, camera);
        },
        dockView() {
          camera.position.set(-96, 9, -91); camera.lookAt(-90, 0, -80);
          renderer.render(scene, camera);
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const start = await page.evaluate(() => ferryRegression.prepareVault());
  await page.locator('#world').click(); await page.keyboard.press('KeyF');
  await page.waitForFunction(() => ferryRegression.vault().kind === 'vaulting', null, { timeout: 10000 });
  await page.waitForFunction(() => ferryRegression.vault().kind === 'grounded', null, { timeout: 10000 });
  const end = await page.evaluate(() => ferryRegression.vault());
  assert.ok(end.position[2] > -90, 'F crosses the northern fence during final withdrawal');
  const deadline = await page.evaluate(() => ferryRegression.deadline());
  assert.equal(deadline.unrescued, true); assert.equal(deadline.boarding, false);
  assert.equal(deadline.ferryBusy, false); assert.equal(deadline.count, 1);
  assert.equal(deadline.inWater, false); assert.ok(deadline.maxStep < .3);
  assert.ok(Math.hypot(deadline.position[0] - deadline.shore.x, deadline.position[2] - deadline.shore.z) < .02);
  for (const view of ['bow', 'stern', 'port', 'starboard']) {
    await page.evaluate(view => ferryRegression.boatView(view), view);
    await page.screenshot({ path: join(directory, `boat-${view}.png`) });
  }
  await page.evaluate(() => ferryRegression.dockView());
  await page.screenshot({ path: join(directory, 'dock-weapons.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ start, end, deadline, errors,
    limitation: 'Actual F and game update paths; player and civilian are manually positioned, enemies disabled, and views use paused cameras.' }, null, 2));
  console.log(JSON.stringify({ start, end, deadline, errors }));
} finally {
  await browser.close();
}
