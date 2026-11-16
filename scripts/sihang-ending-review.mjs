import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.sihangEndingReview = {
        start() {
          setGameState('pause'); missionBriefing.hide(); battleEnding.reset();
          const player = controlledSoldier(entities);
          const [rescued, stuck] = friendlyAI.filter(actor => actor.health > 0 && !actor.vehicleId);
          if (!player || !rescued || !stuck) throw new Error('Expected real friendly actors');
          player.position.set(83, 0, 40);
          rescued.position.set(85, 0, 40);
          stuck.position.set(0, 0, -25);
          for (const actor of [player, rescued, stuck]) {
            actor.sihangEvacuated = false; actor.sihangParadeGoal = null;
          }
          formations.filter(formation => formation.team === 'friendly' && !formation.player)
            .forEach((formation, index) => { formation.sihangSlot = index; });
          formations.find(formation => formation.player).sihangSlot = SIHANG_RULES.retreatSquads;
          sihangCampaign = createSihangCampaign();
          Object.assign(sihangCampaign, {
            stage: 'sihang-retreat', stageRemaining: null, reserve: 0, retreatReserve: 0,
            retreatTotal: 3, retreatRequired: 2, deployed: 400,
            assemblyPrepared: true, assemblyReleased: true, withdrawalWaveNumber: 1,
            retreatIds: [player.id, rescued.id, stuck.id], aiRetreatIds: [rescued.id, stuck.id],
            withdrawalWave: { number: 1, phase: 'main', coverSlot: 0, covering: false,
              squads: [[stuck.id], ...Array.from({ length: 9 }, () => [])], completedAt: null },
          });
          this.stuck = stuck; this.rescued = rescued;
          return this.step(.1);
        },
        step(dt) {
          time += dt;
          updateSihangMission(dt);
          updateHUD();
          return {
            outcome: sihangCampaign.outcome, retreat: sihangRetreatStatus(sihangCampaign),
            countdown: sihangCampaign.strandedCountdownAt, elapsed: sihangCampaign.elapsed,
            help: document.getElementById('objective-help').textContent,
            ending: battleEnding.snapshot, stuckHealth: this.stuck.health,
            stuckPosition: this.stuck.position.toArray(),
            stuckEvacuated: Boolean(this.stuck.sihangEvacuated),
            rescuedMovingToParade: Boolean(this.rescued.sihangParadeGoal),
            riverBodies: scene.children.filter(item => item.name === 'floating-civilian-remains').length,
          };
        },
        moveStuck(x, z) { this.stuck.position.set(x, 0, z); },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  url.searchParams.set('character', 'procedural');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });

  const initial = await page.evaluate(() => sihangEndingReview.start());
  assert.equal(initial.riverBodies, 0);
  assert.equal(initial.retreat.unresolved, 1);
  assert.equal(initial.rescuedMovingToParade, true);
  const countdown = await page.evaluate(() => sihangEndingReview.step(30));
  assert.equal(countdown.ending.phase, 'idle');
  assert.match(countdown.help, /滞留北岸.*结算倒计时 30秒/);
  await page.screenshot({ path: join(directory, 'countdown.png') });
  await page.evaluate(() => sihangEndingReview.moveStuck(.6, -25));
  const resumed = await page.evaluate(() => sihangEndingReview.step(.1));
  assert.equal(resumed.countdown, null);
  await page.evaluate(() => sihangEndingReview.step(30));
  const expired = await page.evaluate(() => sihangEndingReview.step(30));
  assert.equal(expired.outcome, 'evacuated');
  assert.equal(expired.ending.phase, 'fade');
  assert.equal(expired.retreat.unresolved, 1);
  assert.equal(expired.stuckHealth, 100);
  assert.equal(expired.stuckEvacuated, false);

  await page.evaluate(() => sihangEndingReview.start());
  await page.evaluate(() => sihangEndingReview.moveStuck(86, 40));
  const complete = await page.evaluate(() => sihangEndingReview.step(.1));
  assert.equal(complete.retreat.unresolved, 0);
  assert.equal(complete.ending.phase, 'fade');
  assert.equal(complete.outcome, 'evacuated');
  assert.equal(complete.stuckEvacuated, true);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({
    fixture: 'Production mission and HUD calls with manually positioned real actors and manually advanced simulation time; not natural play.',
    initial, countdown, resumed, expired, complete, errors,
  }, null, 2));
  console.log('Sihang ending review passed');
} finally {
  await browser.close();
}
