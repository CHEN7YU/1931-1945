import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.nanjingVoiceReview = {
        start() {
          enemies = []; rebuildForces();
          for (const civilian of world.civilians) {
            civilian.userData.evacuated = true;
            civilian.userData.arrived = true;
          }
          Object.assign(nanjingCampaign, { stage: 'withdrawal-to-boats',
            presentedStage: 'withdrawal-to-boats', dockActivated: true,
            civiliansWaiting: 0, civiliansAboard: 0 });
          const actor = formations.filter(formation => formation.team === 'friendly' && !formation.player)
            .flatMap(formation => formation.members).find(member => member.health > 0);
          if (!actor) throw new Error('No live friendly AI soldier for the voice fixture');
          updateNanjingMission(0);
        },
        ready() {
          const altered = [];
          for (const formation of formations.filter(item => item.team === 'friendly' && !item.player)) {
            for (const actor of formation.members.filter(member => member.health > 0)) {
              altered.push([actor, actor.tactics.nanjingFerry]);
              actor.tactics.nanjingFerry = { phase: 'aboard', ferryId: 0 };
            }
          }
          updateNanjingMission(0);
          const result = { required: nanjingCampaign.requiredAISquads,
            boarded: nanjingAIBoardedCount(nanjingCampaign),
            civiliansReady: nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready,
            outcome: nanjingCampaign.outcome, stage: nanjingCampaign.stage,
            readyCueIssued: nanjingCampaign.evacuationVoiceReady, voices: battleVoices.snapshot };
          for (const [actor, previous] of altered) {
            if (previous) actor.tactics.nanjingFerry = previous;
            else delete actor.tactics.nanjingFerry;
          }
          return result;
        },
        alone() {
          for (const formation of formations.filter(item => item.team === 'friendly' && !item.player))
            for (const actor of formation.members) actor.health = 0;
          nanjingCampaign.evacuatedSquads = [];
          updateNanjingMission(0); updateHUD();
          return { required: nanjingCampaign.requiredAISquads, playerSquadAlive: allies.filter(actor => actor.health > 0).length,
            help: document.getElementById('objective-help').textContent };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    document.getElementById('fatal') && !document.getElementById('fatal').hidden, null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  console.log('Nanjing voice fixture loaded');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  console.log('Nanjing battle started');
  await page.evaluate(() => window.nanjingVoiceReview.start());
  await page.waitForFunction(() => window.__battle.battleVoices.history.some(item =>
    item.cue === 'nanjing-depart-now'), null, { timeout: 30000 });
  console.log('Departure reminder played');
  console.log('Readiness:', JSON.stringify(await page.evaluate(() => window.nanjingVoiceReview.ready())));
  const voices = await page.evaluate(() => window.__battle.battleVoices);
  const history = voices.history.filter(item => item.cue.startsWith('nanjing-'));
  assert.equal(history.filter(item => item.cue === 'nanjing-depart-now').length, 1);
  const alone = await page.evaluate(() => window.nanjingVoiceReview.alone());
  assert.equal(alone.required, 0);
  assert.ok(alone.playerSquadAlive > 1, 'this condition does not mean the player squad was wiped out');
  assert.match(alone.help, /靠近木船按F登船/);
  assert.equal((await page.evaluate(() => window.__battle.battleVoices.history))
    .filter(item => item.cue === 'nanjing-depart-now').length, 1, 'readiness changes must not repeat the reminder');
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'voice-review.json'), JSON.stringify({
    fixture: 'Artificial civilian evacuation and soldier boarding state; production mission update and Web Audio playback',
    history: (await page.evaluate(() => window.__battle.battleVoices)).history, alone, errors }, null, 2));
  console.log('Nanjing evacuation voice events played through Web Audio.');
} finally {
  await browser.close();
}
