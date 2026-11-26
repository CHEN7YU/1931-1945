import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.civilianWaterCasualtyFixture = () => {
        setGameState('pause'); missionBriefing.hide();
        Object.assign(nanjingCampaign, { stage: 'dock-defense', dockActivated: true, outcome: null,
          civilianCasualties: 0, civilianEnRouteCasualties: 0, civiliansArrived: 0,
          civiliansWaiting: 0, civiliansAboard: 0 });
        const [land, water, bridge, passenger] = world.civilians;
        const prepare = (person, x, y, z) => {
          scene.add(person); person.position.set(x, y, z); person.visible = true;
          Object.assign(person.userData, { dead: false, health: 100, arrived: false,
            evacuated: false, unrescued: false, boarding: false });
        };
        prepare(land, -50, 0, -70);
        prepare(water, -110, 0, -90);
        prepare(bridge, -24, 0, 52);
        if (world.isDeepWater(land.position.x, land.position.z) ||
          !world.isDeepWater(water.position.x, water.position.z) ||
          !world.isDeepWater(bridge.position.x, bridge.position.z) ||
          world.impactHeight(bridge.position.x, bridge.position.z) > -1)
          throw new Error('Invalid water or bridge fixture');
        const ferry = world.ferries[0], boat = nanjingCampaign.boats[ferry.userData.ferryId];
        ferry.position.set(-120, .05, -84); ferry.userData.passengers = [];
        boat.passengers = 0; boat.returning = false;
        prepare(passenger, -120, .47, -84);
        registerCivilianArrival(nanjingCampaign);
        if (!boardCivilian(nanjingCampaign, boat.id)) throw new Error('Could not board passenger');
        ferry.add(passenger); passenger.position.set(0, NANJING_FERRY_FLOOR, 0);
        ferry.userData.passengers.push(passenger);
        scene.updateMatrixWorld(true);
        const source = { team: 'enemy', soldierId: 'fixture', weaponClass: 'rifle' };
        for (const civilian of [land, water, bridge, passenger]) applyCivilianDamage(civilian, 100, source);
        applyCivilianDamage(water, 100, source);
        camera.position.set(-114, 2, -86); camera.lookAt(-110, 0, -90);
        updateCivilianAppearance(world.civilianVisuals, camera, 'low');
        renderer.render(scene, camera);
        return { visible: [land, water, bridge, passenger].map(person => person.visible),
          dead: [land, water, bridge, passenger].map(person => person.userData.dead),
          registered: [land, water, bridge, passenger].map(person =>
            civilianCorpses.has('civilian-' + person.userData.civilianId)),
          casualtyCount: nanjingCampaign.civilianCasualties, aboard: nanjingCampaign.civiliansAboard,
          boatPassengers: boat.passengers, passengers: ferry.userData.passengers.length,
          detached: passenger.parent === scene };
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const result = await page.evaluate(() => civilianWaterCasualtyFixture());
  assert.deepEqual(result.visible, [true, false, true, false]);
  assert.deepEqual(result.dead, [true, true, true, true]);
  assert.deepEqual(result.registered, [true, true, true, true]);
  assert.equal(result.casualtyCount, 4);
  assert.equal(result.aboard, 0);
  assert.equal(result.boatPassengers, 0);
  assert.equal(result.passengers, 0);
  assert.equal(result.detached, true);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_PATH) await page.screenshot({ path: process.env.ARTIFACT_PATH });
  console.log(JSON.stringify({ passed: true, ...result,
    limitation: 'Casualty positions are diagnostic setup; production damage and ferry accounting are used.' }));
} finally {
  await browser.close();
}
