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
      window.nanjingCountersReview = {
        entry(edge) {
          setGameState('pause'); missionBriefing.hide();
          for (const actor of enemies) actor.health = 0;
          for (const person of world.civilians) {
            person.userData.dead = true; person.visible = false;
          }
          const refugee = world.civilians[0], data = refugee.userData;
          Object.assign(data, { dead: false, health: 100, active: true, fleeReleased: true, arrived: false,
            enteredCity: false, route: [{ x: 0, z: edge - 2 }], waypoint: 0, boarding: false,
            resting: false, restPoseWeight: 0, streetEvacuating: false });
          refugee.visible = true; refugee.position.set(0, 0, edge + .4);
          Object.assign(nanjingCampaign, { stage: 'gate-defense', civiliansEnteredCity: 0, civilianCasualties: 0 });
          for (let i = 0; i < 30; i++) { time += .05; updateNanjingCivilians(.05); }
          updateHUD();
          const entered = document.getElementById('objective-help').textContent;
          applyCivilianDamage(refugee, 100, { team: 'enemy', weaponClass: 'rifle', soldierId: 'fixture' });
          updateHUD();
          return { entered, killed: document.getElementById('objective-help').textContent,
            count: nanjingCampaign.civiliansEnteredCity, z: refugee.position.z };
        },
        startWithdrawal() {
          for (const actor of [...enemies, ...friendlyAI]) actor.health = 0;
          const player = controlledSoldier(entities);
          for (const actor of allies) if (actor !== player) actor.health = 0;
          const ally = friendlyAI[0], allyBoat = world.ferries[ally.index % world.ferries.length];
          ally.health = 100;
          ally.position.set(-72.2, world.groundHeight(-72.2, allyBoat.position.z), allyBoat.position.z);
          delete ally.tactics.nanjingFerry;
          for (const person of world.civilians) {
            person.userData.dead = true; person.visible = false;
          }
          const stranded = world.civilians[1], passenger = world.civilians[2], ferry = world.ferries[0];
          Object.assign(stranded.userData, { dead: false, health: 100, active: false, arrived: false,
            unrescued: false, evacuated: false, boarding: false, fleeReleased: false });
          Object.assign(passenger.userData, { dead: false, health: 100, arrived: true,
            unrescued: false, evacuated: false, boarding: false });
          ferry.add(passenger); ferry.userData.passengers = [passenger]; ferry.userData.boarding = null;
          ferry.userData.loadedAt = time - 16;
          world.civilianQueue.length = 0;
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats', presentedStage: 'withdrawal-to-boats',
            dockActivated: true, outcome: null, stageRemaining: 0, civiliansWaiting: 0, civiliansAboard: 1,
            civiliansEvacuated: 4, civiliansUnrescued: 0, civilianCasualties: 178,
            finalWithdrawalElapsed: NANJING_CIVILIAN_FINAL_WAIT - .05, finalShoreWaitExpired: false });
          Object.assign(nanjingCampaign.boats[0], { passengers: 1, returning: false });
          player.position.set(-72.2, world.groundHeight(-72.2, -77), -77);
          setGameState('playing'); bindControlInput();
          advanceNanjingCampaign(nanjingCampaign, .05); time += .05; updateNanjingCivilians(.05);
          updateHUD();
          return { unrescued: nanjingCampaign.civiliansUnrescued, aboard: nanjingCampaign.civiliansAboard,
            evacuated: nanjingCampaign.civiliansEvacuated, ready: nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready,
            hud: document.getElementById('objective-help').textContent };
        },
        cross() {
          for (let i = 0; i < 320; i++) { time += .25; updateNanjingCivilians(.25); updateNanjingMission(.25); }
          updateHUD();
          return { evacuated: nanjingCampaign.civiliansEvacuated, aboard: nanjingCampaign.civiliansAboard,
            ready: nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready,
            aiReady: nanjingAISquadsBoarded(nanjingCampaign), aiBoarded: nanjingAIBoardedCount(nanjingCampaign),
            ai: friendlyAI.filter(actor => actor.health > 0).map(actor => ({ id: actor.id, position: actor.position.toArray(),
              traversal: actor.traversal.kind, ferry: actor.tactics.nanjingFerry, vehicle: actor.vehicleId })),
            boats: world.ferries.map(ferry => ({ state: ferry.userData.state, boarding: Boolean(ferry.userData.troopBoarding),
              troops: ferry.userData.troopPassengers?.length })),
            hud: document.getElementById('objective-help').textContent };
        },
        playerBoarding() {
          return { ferry: nanjingCampaign.playerBoardingBoatId, outcome: nanjingCampaign.outcome };
        },
        finish() {
          for (let i = 0; i < 200 && !nanjingCampaign.outcome; i++) {
            time += .1; updateNanjingCivilians(.1); updateNanjingMission(.1);
          }
          return { outcome: nanjingCampaign.outcome, escaped: nanjingCampaign.playerEscaped };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const edge = await page.evaluate(async () => (await import('/src/nanjing-layout.js')).NANJING_GATE_NORTH_EDGE);
  const entry = await page.evaluate(edge => nanjingCountersReview.entry(edge), edge);
  assert.equal(entry.count, 1, JSON.stringify(entry));
  assert.ok(entry.entered.includes('百姓已安全进城 1'), entry.entered);
  assert.ok(entry.killed.includes('遭日军残害致死 1'), entry.killed);
  const waiting = await page.evaluate(() => nanjingCountersReview.startWithdrawal());
  assert.equal(waiting.unrescued, 1); assert.equal(waiting.aboard, 1);
  assert.equal(waiting.evacuated, 4); assert.equal(waiting.ready, false);
  assert.ok(waiting.hud.includes('已过江 4'), waiting.hud);
  const crossed = await page.evaluate(() => nanjingCountersReview.cross());
  assert.equal(crossed.aboard, 0); assert.equal(crossed.evacuated, 5); assert.equal(crossed.ready, true);
  assert.equal(crossed.aiReady, true, JSON.stringify(crossed)); assert.equal(crossed.aiBoarded, 1);
  assert.ok(crossed.hud.includes('已过江 5'), crossed.hud);
  await page.keyboard.press('f');
  const boarding = await page.evaluate(() => nanjingCountersReview.playerBoarding());
  assert.notEqual(boarding.ferry, null, JSON.stringify(boarding));
  const finish = await page.evaluate(() => nanjingCountersReview.finish());
  assert.deepEqual(finish, { outcome: 'evacuated', escaped: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, entry, waiting, crossed, boarding, finish }));
} finally {
  await browser.close();
}
