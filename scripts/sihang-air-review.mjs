import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  if (process.env.REVIEW_SEED !== undefined) {
    const seed = Number(process.env.REVIEW_SEED);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Invalid review seed');
    await page.addInitScript(initial => {
      let state = initial;
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    }, seed);
  }
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.airReview = {
        events: [],
        start() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          this.startTime = time;
          this.initial = this.snapshot();
        },
        step(seconds) {
          setGameState('playing');
          const end = time + seconds;
          while (time < end && ['playing', 'transferring'].includes(state)) {
            aiDecisions.beginFrame();
            advanceBattleStep(Math.min(.05, end - time), time);
          }
          const result = this.snapshot();
          if (['playing', 'transferring'].includes(state)) setGameState('pause');
          return result;
        },
        snapshot() {
          return { time, state, stage: sihangCampaign.stage, elapsed: sihangCampaign.stageElapsed,
            planes: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.team === 'enemy')
              .map(vehicle => ({ id: vehicle.id, health: vehicle.health, position: vehicle.position.toArray() })),
            antiAircraft: [...emplacements.values()].filter(point => point.weapon.settings.antiAircraft)
              .map(point => ({ id: point.id, operatorId: point.operatorId, health: point.health,
                ammo: point.weapon.ammo, shots: point.weapon.shots })) };
        }
      };
      const reviewDamageVehicle = damageVehicle;
      damageVehicle = function(vehicle, damage, source, weaponKind) {
        const before = vehicle.health;
        reviewDamageVehicle(vehicle, damage, source, weaponKind);
        if (vehicle.type === 'plane' && vehicle.team === 'enemy' && vehicle.health < before) {
          window.airReview.events.push({ time, id: vehicle.id, before, health: vehicle.health,
            weaponKind, source, position: vehicle.position.toArray() });
        }
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => airReview.start());
  const samples = [];
  for (let i = 0; i < 12; i++) {
    const sample = await page.evaluate(() => airReview.step(5));
    samples.push(sample);
    if (!['playing', 'transferring'].includes(sample.state)) break;
  }
  const result = await page.evaluate(() => ({ startTime: airReview.startTime, initial: airReview.initial,
    events: airReview.events }));
  await writeFile(join(directory, 'air-review.json'), JSON.stringify({
    fixture: 'idle-player-production-ai-manual-0.05s-simulation-steps-no-render-catch-up-not-natural-framerate',
    seed: process.env.REVIEW_SEED ?? null, character: process.env.GAME_CHARACTER ?? 'native',
    ...result, samples, errors,
  }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ startTime: result.startTime, end: samples.at(-1), hits: result.events.length,
    destroyed: result.events.filter(event => event.health <= 0) }));
} finally {
  await browser.close();
}
