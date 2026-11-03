import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { NANJING_CIVILIAN_COUNT } from '../src/civilian-crowd.js';
import { writeFile } from 'node:fs/promises';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  page.on('console', message => { if (message.text().startsWith('[crowd]')) console.log(message.text()); });
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.crowdReview = {
        streetView() {
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); time = 0; nanjingCampaign = createNanjingCampaign();
          for (let frame = 0; frame < 600; frame++) {
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible)
              .map(person => ({ x: person.position.x, z: person.position.z, radius: .36 })));
            updateNanjingCivilians(.05); controlEvents.drain(() => {});
          }
          const person = world.civilians.find(person => person.userData.streetLife && person.visible &&
            Math.hypot(person.position.x - person.userData.streetLife.exit.x,
              person.position.z - person.userData.streetLife.exit.z) > 3);
          if (!person) throw new Error('No visible street walker for the in-game appearance review');
          for (const offset of [Math.PI, Math.PI * .75, Math.PI * 1.25, Math.PI * .5, Math.PI * 1.5]) {
            const angle = person.rotation.y + offset;
            const point = { x: person.position.x + Math.sin(angle) * 3.2,
              z: person.position.z + Math.cos(angle) * 3.2 };
            if (!segmentClear(person.position, point, .1, world.obstacles)) continue;
            camera.position.set(point.x, 1.7, point.z);
            break;
          }
          camera.lookAt(person.position.x, .95, person.position.z);
          for (const child of camera.children) child.visible = false;
          $('hud').hidden = true; $('overlay').hidden = true;
          state = 'review';
          updateCivilianAppearance(world.civilians, camera, 'high');
          renderer.render(scene, camera);
        },
        run() {
          enemies = []; rebuildForces();
          combatSounds.length = 0;
          world.resetCampaign(); time = 0; nanjingCampaign = createNanjingCampaign();
          let minSeparation = Infinity;
          let prematureWave = 0;
          let streetLife;
          for (let frame = 0; frame < 12000; frame++) {
            if (frame % 1200 === 0) console.log('[crowd] '+JSON.stringify({seconds:frame*.05,
              arrived:world.civilians.filter(person=>person.userData.arrived).length}));
            if (frame === 3600) {
              prematureWave = world.civilians.filter(person => person.userData.withdrawalWave &&
                !person.userData.streetLife && person.visible).length;
              streetLife = world.civilians.filter(person => person.userData.streetLife).map(person => ({
                id: person.userData.civilianId, cycles: person.userData.streetLife.cycles,
                position: person.position.toArray(), waypoint: person.userData.streetLife.waypoint,
              }));
              nanjingCampaign.stage = 'withdrawal';
              updateNanjingMission(0);
            }
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible && person.parent === scene)
              .map(person => ({ x: person.position.x, z: person.position.z, radius: .36 })));
            updateNanjingCivilians(.05);
            controlEvents.drain(() => {});
            if (frame % 20 === 0) {
              const dock = world.civilians.filter(person => person.visible && person.parent === scene &&
                person.position.x < -59 && person.position.z < -70);
              for (let a = 0; a < dock.length; a++) for (let b = a + 1; b < dock.length; b++)
                minSeparation = Math.min(minSeparation, dock[a].position.distanceTo(dock[b].position));
            }
          }
          const waiting = world.civilians.filter(person => person.userData.arrived);
          const report = { arrivals: waiting.length, prematureWave, streetLife, minSeparation, trees: world.landmarks.trees.length,
            stuck: world.civilians.filter(person => !person.userData.arrived).map(person =>
              ({ id: person.userData.civilianId, position: person.position, waypoint: person.userData.waypoint,
                target: person.userData.route[person.userData.waypoint], detour: person.userData.crowdPath,
                stalled: person.userData.crowdStalled })),
            feetOnDock: waiting.every(person => Math.abs(person.position.y -
              world.groundHeight(person.position.x, person.position.z)) < .001),
            legsFollowMovement: waiting.every(person => person.userData.escapeMotion.speed > .02 ||
              person.civilianLegs.every(leg => Math.abs(leg.rotation.x) < .02)) };
          state = 'review';
          camera.position.set(-54, 15, -63);
          camera.lookAt(-69, 1, -80);
          for (const child of camera.children) child.visible = false;
          updateCivilianAppearance(world.civilians, camera, 'low');
          renderer.render(scene, camera);
          return report;
        },
        board() {
          nanjingCampaign.stage='dock-defense';
          nanjingCampaign.dockActivated=true;
          let frame=0;
          for(;frame<36000&&nanjingCampaign.civiliansEvacuated<world.civilians.length;frame++) {
            time+=.05;
            updateNanjingCivilians(.05);
            controlEvents.drain(()=>{});
            if(frame%2400===0)console.log('[crowd] '+JSON.stringify({boardingSeconds:frame*.05,
              evacuated:nanjingCampaign.civiliansEvacuated,waiting:nanjingCampaign.civiliansWaiting}));
          }
          return {seconds:frame*.05,evacuated:nanjingCampaign.civiliansEvacuated,
            waiting:nanjingCampaign.civiliansWaiting,aboard:nanjingCampaign.civiliansAboard,
            casualties:nanjingCampaign.civilianCasualties,
            physicallyEvacuated:world.civilians.filter(person=>person.userData.evacuated&&!person.parent&&!person.visible).length,
            boats:world.ferries.map(ferry=>({state:ferry.userData.state,passengers:ferry.userData.passengers.length,
              boarding:ferry.userData.boarding?{id:ferry.userData.boarding.civilian.userData.civilianId,
                position:ferry.userData.boarding.civilian.position,path:ferry.userData.boarding.path}:null}))};
        },
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  if (process.env.STREET_SCREENSHOT) {
    await page.evaluate(() => crowdReview.streetView());
    await page.screenshot({ path: process.env.STREET_SCREENSHOT });
  }
  const result = await page.evaluate(() => crowdReview.run());
  if (process.env.CROWD_RESULT) await writeFile(process.env.CROWD_RESULT, JSON.stringify({ result, errors }, null, 2));
  if (process.env.CROWD_SCREENSHOT) await page.screenshot({ path: process.env.CROWD_SCREENSHOT });
  console.log(JSON.stringify(result));
  assert.equal(result.arrivals, NANJING_CIVILIAN_COUNT, 'every civilian must reach a distinct waiting position');
  assert.equal(result.prematureWave, 0, 'the main refugee wave must wait for the gate withdrawal command');
  assert.equal(result.streetLife.length, 10);
  assert.ok(result.streetLife.every(person => person.cycles > 0),
    'every neighborhood resident must complete a real outside-and-home loop before evacuation');
  assert.ok(result.minSeparation >= .519, 'the packed waiting crowd must retain physical body clearance');
  assert.ok(result.feetOnDock && result.legsFollowMovement);
  assert.ok(result.trees >= 25);
  const boarding = await page.evaluate(() => crowdReview.board());
  console.log(JSON.stringify({ boarding }));
  if (process.env.CROWD_RESULT) await writeFile(process.env.CROWD_RESULT,
    JSON.stringify({ result, boarding, errors }, null, 2));
  assert.equal(boarding.evacuated, NANJING_CIVILIAN_COUNT, 'all survivors must physically board and reach the far bank');
  assert.equal(boarding.physicallyEvacuated, NANJING_CIVILIAN_COUNT);
  assert.equal(boarding.waiting + boarding.aboard + boarding.casualties, 0);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
