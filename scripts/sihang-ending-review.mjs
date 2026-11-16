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
          player.position.set(83, 0, -25);
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
          this.stuck = stuck; this.rescued = rescued; this.player = player;
          return this.step(.1);
        },
        step(dt) {
          time += dt;
          updateSihangMission(dt);
          updateHUD();
          return {
            outcome: sihangCampaign.outcome, retreat: sihangRetreatStatus(sihangCampaign),
            finalRetreatOrdered: sihangCampaign.finalRetreatOrdered, elapsed: sihangCampaign.elapsed,
            help: document.getElementById('objective-help').textContent,
            ending: battleEnding.snapshot, stuckHealth: this.stuck.health,
            voice: sihangVoices?.snapshot, audioState: audioContext?.state,
            stuckPosition: this.stuck.position.toArray(),
            stuckEvacuated: Boolean(this.stuck.sihangEvacuated),
            rescuedMovingToParade: Boolean(this.rescued.sihangParadeGoal),
            riverBodies: scene.children.filter(item => item.name === 'floating-civilian-remains').length,
          };
        },
        moveStuck(x, z) { this.stuck.position.set(x, 0, z); },
        movePlayer(x, z) { this.player.position.set(x, 0, z); },
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
  assert.equal(initial.retreat.unresolved, 2);
  assert.equal(initial.rescuedMovingToParade, true);
  const before = await page.evaluate(() => sihangEndingReview.step(14.9));
  assert.equal(before.finalRetreatOrdered, false);
  await page.evaluate(() => sihangEndingReview.moveStuck(.6, -25));
  const resumed = await page.evaluate(() => sihangEndingReview.step(.1));
  assert.equal(resumed.finalRetreatOrdered, false);
  const ordered = await page.evaluate(() => sihangEndingReview.step(15));
  assert.equal(ordered.finalRetreatOrdered, true);
  assert.equal(ordered.ending.phase, 'idle');
  assert.match(ordered.help, /立刻撤退到苏州河南岸/);
  assert.equal(ordered.audioState, 'running');
  assert.equal(ordered.voice.active, 'final-retreat');
  await page.screenshot({ path: join(directory, 'final-retreat.png') });
  const waiting = await page.evaluate(() => sihangEndingReview.step(100));
  assert.equal(waiting.outcome, null);
  await page.evaluate(() => sihangEndingReview.movePlayer(83, 40));
  const crossed = await page.evaluate(() => sihangEndingReview.step(.1));
  assert.equal(crossed.outcome, 'evacuated');
  assert.equal(crossed.ending.phase, 'fade');
  assert.equal(crossed.retreat.unresolved, 1);
  assert.equal(crossed.stuckHealth, 100);
  assert.equal(crossed.stuckEvacuated, false);

  await page.evaluate(() => sihangEndingReview.start());
  await page.evaluate(() => sihangEndingReview.movePlayer(83, 40));
  await page.evaluate(() => sihangEndingReview.moveStuck(86, 40));
  const complete = await page.evaluate(() => sihangEndingReview.step(.1));
  assert.equal(complete.retreat.unresolved, 0);
  assert.equal(complete.ending.phase, 'fade');
  assert.equal(complete.outcome, 'evacuated');
  assert.equal(complete.stuckEvacuated, true);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({
    fixture: 'Production mission and HUD calls with manually positioned real actors and manually advanced simulation time; not natural play.',
    initial, before, resumed, ordered, waiting, crossed, complete, errors,
  }, null, 2));
  console.log('Sihang ending review passed');
} finally {
  await browser.close();
}
