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
      window.nanjingTextFixture = {
        boarding() {
          setGameState('pause'); missionBriefing.hide();
          for (const actor of enemies) actor.health = 0;
          for (const person of world.civilians) {
            person.userData.dead = true; person.visible = false;
          }
          world.civilianQueue.length = 0;
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats', presentedStage: 'withdrawal-to-boats',
            dockActivated: true, outcome: null, stageRemaining: 0, civiliansWaiting: 0, civiliansAboard: 0,
            requiredAISquads: 1, boardedAISquads: [], evacuatedSquads: [], playerBoardingBoatId: null });
          const ferry = world.ferries.find(item => item.userData.state === 'docked');
          if (!ferry) throw new Error('Missing docked ferry');
          const shore = ferryBoardingPoints(ferry).shore, actor = controlledSoldier(entities);
          actor.position.set(shore.x, .36, shore.z);
          actor.traversal.kind = 'grounded'; stopLocomotion(actor.locomotion);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: shore.x, z: shore.z };
          controlPose.yaw = Math.PI / 2; controlPose.pitch = 0; updateCamera(0);
          setGameState('playing'); bindControlInput();
          return { ready: nanjingPlayerBoardingReady(nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians)),
            squadsReady: nanjingAISquadsBoarded(nanjingCampaign) };
        },
        boardingResult() { return nanjingCampaign.playerBoardingBoatId; },
        memorial() {
          const actor = controlledSoldier(entities), unit = getPlayerIdentity(campaign.id).unitName;
          beginDeathFeedback(actor, 'fixture'); renderDeathFeedback();
          return { unit, displayed: document.getElementById('death-transfer-unit').textContent,
            state, name: document.getElementById('death-transfer-name').textContent };
        },
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  assert.deepEqual(await page.evaluate(() => nanjingTextFixture.boarding()), { ready: true, squadsReady: false });
  await page.keyboard.press('f');
  assert.equal(await page.locator('#toast').textContent(), '友军尚未全部登船，继续掩护渡口。');
  assert.equal(await page.evaluate(() => nanjingTextFixture.boardingResult()), null);
  const memorial = await page.evaluate(() => nanjingTextFixture.memorial());
  assert.equal(memorial.state, 'transferring');
  assert.ok(memorial.name);
  assert.equal(memorial.displayed, memorial.unit);
  assert.doesNotMatch(memorial.displayed, /战士$/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, memorial,
    limitation: 'Stage and memorial are set by a diagnostic fixture; boarding uses the actual F input path.' }));
} finally {
  await browser.close();
}
