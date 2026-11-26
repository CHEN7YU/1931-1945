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
      window.departureReview = {
        start(aboard) {
          setGameState('pause'); missionBriefing.hide();
          for (const actor of [...enemies, ...friendlyAI]) actor.health = 0;
          const player = controlledSoldier(entities);
          for (const actor of allies) if (actor !== player) actor.health = 0;
          for (const person of world.civilians) { person.userData.dead = true; person.visible = false; }
          const stranded = world.civilians[0], passenger = world.civilians[1];
          Object.assign(stranded.userData, { dead: false, health: 100, arrived: false,
            unrescued: true, evacuated: false, boarding: false, active: false });
          const civilianFerry = world.ferries[0], playerFerry = world.ferries[1];
          if (aboard) {
            Object.assign(passenger.userData, { dead: false, health: 100, arrived: true,
              unrescued: false, evacuated: false, boarding: false });
            civilianFerry.add(passenger);
            civilianFerry.userData.passengers = [passenger];
            civilianFerry.userData.loadedAt = time - 16;
          }
          world.civilianQueue.length = 0;
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats', presentedStage: 'withdrawal-to-boats',
            dockActivated: true, outcome: null, stageRemaining: 0, civiliansWaiting: 0, civiliansAboard: aboard,
            civiliansEvacuated: 52, civiliansUnrescued: 1, civilianCasualties: 127 - aboard,
            finalWithdrawalElapsed: NANJING_CIVILIAN_FINAL_WAIT, finalShoreWaitExpired: true,
            requiredAISquads: 0, boardedAISquads: [], evacuatedSquads: [], playerBoardingBoatId: null });
          Object.assign(nanjingCampaign.boats[0], { passengers: aboard, returning: false });
          const shore = ferryBoardingPoints(playerFerry).shore;
          player.position.set(shore.x, world.groundHeight(shore.x, shore.z), shore.z);
          player.nativeMotion.position = { x: player.position.x, z: player.position.z };
          delete player.tactics.nanjingFerry;
          setGameState('playing'); bindControlInput();
          updateNanjingMission(0);
          return { ready: nanjingAISquadsBoarded(nanjingCampaign), waiting: nanjingCampaign.civiliansWaiting,
            aboard: nanjingCampaign.civiliansAboard, unrescued: nanjingCampaign.civiliansUnrescued };
        },
        startStuck() {
          this.start(0);
          const teammate = allies.find(actor => actor !== controlledSoldier(entities));
          const other = formations.find(formation => formation.team === 'friendly' && !formation.player &&
            formation.members.length).members[0];
          teammate.health = 100;
          const shore = ferryBoardingPoints(world.ferries[2]).shore;
          teammate.position.set(shore.x, world.groundHeight(shore.x, shore.z), shore.z);
          teammate.nativeMotion.position = { x: shore.x, z: shore.z };
          other.health = 100; other.position.set(50, 0, 40);
          other.nextThink = Infinity;
          rebuildForces(); updateNanjingMission(0);
          this.teammate = teammate; this.other = other;
          return { required: nanjingCampaign.requiredAISquads, ready: nanjingAISquadsBoarded(nanjingCampaign) };
        },
        waitForTeammate() {
          for (let i = 0; i < 600 && this.teammate.tactics.nanjingFerry?.phase !== 'aboard' &&
            this.teammate.tactics.nanjingFerry?.phase !== 'evacuated'; i++)
            advanceBattleStep(.05, time + .05);
          return { phase: this.teammate.tactics.nanjingFerry?.phase,
            playerSelected: nanjingCampaign.playerBoardingBoatId, otherHealth: this.other.health };
        },
        advance() {
          for (let i = 0; i < 400 && !nanjingCampaign.outcome; i++) {
            time += .05; updateNanjingCivilians(.05); updateNanjingMission(.05);
          }
          const player = controlledSoldier(entities), ferry = nanjingPlayerFerry();
          return { outcome: nanjingCampaign.outcome, escaped: nanjingCampaign.playerEscaped,
            selected: nanjingCampaign.playerBoardingBoatId, phase: player.tactics.nanjingFerry?.phase,
            state: ferry?.userData.state, x: ferry?.position.x, originX: ferry?.userData.originX,
            aboard: nanjingCampaign.civiliansAboard, ending: battleEnding.snapshot.phase };
        },
        ending() { return battleEnding.snapshot; },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5376/').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const aboard = process.env.REVIEW_CIVILIANS_ABOARD === '0' ? 0 : 1;
  const stuck = process.env.REVIEW_STUCK_ALLY === '1';
  const start = stuck ? await page.evaluate(() => departureReview.startStuck())
    : await page.evaluate(aboard => departureReview.start(aboard), aboard);
  if (stuck) {
    assert.deepEqual(start, { ready: false, required: 1 });
    const teammate = await page.evaluate(() => departureReview.waitForTeammate());
    assert.ok(['aboard', 'evacuated'].includes(teammate.phase), JSON.stringify(teammate));
    assert.equal(teammate.playerSelected, null, 'the teammate boards without a player interaction');
    assert.equal(teammate.otherHealth, 100, 'an unboarded AI remains alive');
  } else assert.deepEqual(start, { ready: true, waiting: 0, aboard, unrescued: 1 });
  await page.keyboard.press('f');
  const result = await page.evaluate(() => departureReview.advance());
  console.log(JSON.stringify({ start, result, errors }));
  assert.equal(result.escaped, true, 'a physically boarded player must finish after departure');
  assert.equal(result.outcome, 'evacuated');
  assert.equal(result.ending, 'fade', 'departure starts the actual fade');
  await page.waitForFunction(() => departureReview.ending().opacity > .05, null, { timeout: 30000 });
  const ending = await page.evaluate(() => departureReview.ending());
  assert.ok(ending.opacity > .05, 'the fade actually darkens the scene');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
