import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.ferrySwitchReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide();
          for (const actor of enemies) actor.health = 0;
          for (const actor of allies) { actor.health = 100; actor.dying = null; actor.blastReaction = null; }
          nanjingCampaign.stage = 'withdrawal-to-boats';
          nanjingCampaign.playerBoardingBoatId = 0;
          allies[0].tactics.nanjingFerry = { phase: 'aboard', ferryId: 0 };
          delete allies[1].tactics.nanjingFerry;
          allies[2].tactics.nanjingFerry = { phase: 'aboard', ferryId: 1 };
          setGameState('playing'); bindControlInput();
        },
        status() { return { current, boat: nanjingCampaign.playerBoardingBoatId }; },
        killControlledAndTransfer() {
          hurt(allies[current], 1000,
            { credit: 'environment', cause: 'fall', subjectId: allies[current].id }, 'collision');
          for (let i = 0; i < 40 && state === 'transferring'; i++) updateDeathFeedback(.25);
          return { state, current, boat: nanjingCampaign.playerBoardingBoatId };
        },
        debug() { return { state, next: nextControllableMember(), alive: allies.map(actor => actor.health),
          target: document.activeElement?.tagName, dialog: $('feedback-dialog').open,
          dying: Boolean(allies[current]?.dying), blast: Boolean(allies[current]?.blastReaction),
          owner: entities.control.soldierId }; }
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.locator('#world').click();
  await page.evaluate(() => ferrySwitchReview.setup());
  assert.deepEqual(await page.evaluate(() => ferrySwitchReview.status()), { current: 0, boat: 0 });
  await page.keyboard.press('y');
  if ((await page.evaluate(() => ferrySwitchReview.status())).current !== 1)
    console.error('Y input did not switch:', await page.evaluate(() => ferrySwitchReview.debug()));
  assert.deepEqual(await page.evaluate(() => ferrySwitchReview.status()), { current: 1, boat: null });
  await page.keyboard.press('y');
  assert.deepEqual(await page.evaluate(() => ferrySwitchReview.status()), { current: 2, boat: 1 });
  assert.deepEqual(await page.evaluate(() => ferrySwitchReview.killControlledAndTransfer()),
    { state: 'playing', current: 3, boat: null },
    'death transfer from a boat to a living shore squadmate must clear the former boat selection');
  assert.deepEqual(errors, []);
  console.log('Actual Y input and death transfer switched between boats and shore; fixture assigned ferry states.');
} finally {
  await browser.close();
}
