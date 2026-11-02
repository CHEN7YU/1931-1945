import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const fullCrowd = process.argv.includes('--full-crowd');
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.boardingReview = () => {
        enemies = []; rebuildForces();
        combatSounds.length = 0;
        const total = ${fullCrowd ? 180 : 10};
        const selected = world.civilians.slice(0, total);
        for (const [index, civilian] of world.civilians.entries()) {
          civilian.visible = index < total;
          civilian.userData.active = true;
          civilian.userData.dead = index >= total;
          if (index < total) {
            const slot = total === 180 ? civilian.userData.waitingSlot :
              { x: -70 + Math.floor(index / 5), y: .36, z: -86 + index % 5 * 1.75 };
            civilian.position.set(slot.x, slot.y, slot.z);
            civilian.userData.arrived = true;
            world.civilianQueue.push(civilian);
            registerCivilianArrival(nanjingCampaign);
          }
        }
        nanjingCampaign.stage = 'withdrawal';
        activateNanjingDock(nanjingCampaign);
        const previous = new Map(selected.map(person => [person, person.position.clone()]));
        let movingFrames = 0, maxStep = 0, rowed = false, rescued = 0;
        for (let frame = 0; frame < (total === 180 ? 12000 : 4000); frame++) {
          time += .05;
          updateNanjingCivilians(.05);
          for (const person of selected) {
            if (person.userData.boarding && person.parent === scene) movingFrames++;
            const before = previous.get(person);
            person.updateWorldMatrix(true, false);
            const current = person.getWorldPosition(new THREE.Vector3());
            if (person.parent) maxStep = Math.max(maxStep, before.distanceTo(current));
            previous.set(person, current);
          }
          rowed ||= world.ferries.some(ferry => ferry.userData.oar.visible &&
            ferry.userData.passengers.some(person => person.userData.ageGroup === 'adult'));
          rescued = nanjingCampaign.civiliansEvacuated;
          if (rescued === total) break;
        }
        state = 'review';
        camera.position.set(-66, 4, -68); camera.lookAt(-75, 1, -80);
        for (const child of camera.children) child.visible = false;
        updateCivilianAppearance(world.civilians, camera, 'low');
        renderer.render(scene, camera);
        return { movingFrames, maxStep, rowed, rescued, waiting: nanjingCampaign.civiliansWaiting,
          pending: world.ferries.filter(ferry => ferry.userData.boarding).map(ferry => ({
            boat: ferry.userData.ferryId, passengers: ferry.userData.passengers.length,
            civilian: ferry.userData.boarding.civilian.userData.civilianId,
            position: ferry.userData.boarding.civilian.position, next: ferry.userData.boarding.path[0],
          })),
          ground: world.walkHeight(-66, -80, 0), northWall: world.solids.some(mesh =>
            mesh.userData.nanjingFeature === 'northern-city-wall') };
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  const result = await page.evaluate(() => window.boardingReview());
  console.log(JSON.stringify(result));
  assert.ok(result.movingFrames > 100, 'boarding must remain visible for seconds, not teleport');
  assert.ok(result.maxStep < .3, 'boarding and parenting must preserve continuous world position');
  assert.equal(result.rescued, fullCrowd ? 180 : 10);
  assert.equal(result.waiting, 0);
  assert.ok(result.rowed && result.northWall);
  assert.equal(result.ground, .36);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
