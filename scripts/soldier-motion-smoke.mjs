import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173/');
  if (process.env.PRODUCTION !== '1') { url.searchParams.set('benchmark', 'full'); url.searchParams.set('seed', '1938'); }
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' && !document.querySelector('#menu').hidden,
    null, { timeout: 90000 });
  await page.locator('#squad-choices [data-type="tank"]').click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z < 45, null, { timeout: 25000 });
  await page.keyboard.up('w');
  const result = await page.evaluate(() => new Promise(resolve => {
    const previous = new Map(), controllers = new Set(), samples = [];
    let turns = 0, lowered = 0, firing = 0, brakes = 0, worstRate = 0;
    const failures = [], deadline = performance.now() + 45000;
    function collect() {
      const data = window.__battle;
      controllers.add(data.control.soldierId);
      const actors = [...data.friendlyPositions, ...data.enemyPositions];
      for (const actor of actors) {
        const old = previous.get(actor.soldierId), dt = old ? data.time - old.time : 0;
        if (old && dt > 1e-5 && !controllers.has(actor.soldierId)) {
          const angle = Math.abs(Math.atan2(Math.sin(actor.heading - old.heading), Math.cos(actor.heading - old.heading)));
          if (angle > .005) {
            turns++;
            worstRate = Math.max(worstRate, angle / dt);
            if (angle > 2.4 * dt + 1e-6) failures.push({ id: actor.soldierId, angle, dt });
          }
        }
        if (actor.turningToPath && (actor.movement?.speed ?? actor.speed) <= .1) brakes++;
        if (actor.lastShot?.lowReady !== null && actor.lastShot?.time > (old?.shotAt ?? -1)) {
          firing++;
          if (actor.lastShot.lowReady > .05 || actor.lastShot.facingError > .07 + 1e-8) failures.push({ shot: actor.lastShot });
          const head = actor.lastShot.headAim;
          if (!head || head.weight <= .98 || head.sightError >= .004 || head.cheekError >= .012 ||
            head.gazeError >= .05 || head.eyeRelief <= .04) failures.push({ unalignedHead: actor.lastShot });
        }
        previous.set(actor.soldierId, { time: data.time, heading: actor.heading, shotAt: actor.lastShot?.time ?? -1 });
      }
      for (const view of [...data.historicalForce.views, ...data.enemyHistoricalForce.views]) {
        if (!view.visible || view.soldier.health <= 0) continue;
        const actor = actors.find(candidate => candidate.soldierId === view.soldier.id);
        const speed = actor?.movement?.speed ?? actor?.speed ?? 0;
        if (speed > .5 && actor.lowReady > .95) {
          lowered++;
          if (view.riflePose.direction[1] > -.35 || view.issue) failures.push({ view });
        }
      }
      if (!samples.length || data.time - samples.at(-1).time >= 3) samples.push({
        time: data.time, population: { friendly: data.population.friendly.alive, enemy: data.population.enemy.alive },
        banks: [data.historicalForce.poseBanks, data.enemyHistoricalForce.poseBanks], turns, lowered, firing, brakes });
      if (performance.now() >= deadline) resolve({ samples, turns, lowered, firing, brakes, worstRate, failures });
      else setTimeout(collect, 80);
    }
    collect();
  }));
  samples.push(result);
  await page.screenshot({ path: join(directory, 'actual-battle.png') });
  assert.ok(result.turns > 20 && result.brakes > 0, 'real AI turn and braking samples required');
  assert.ok(result.lowered > 20, 'actual moving skinned guns, not just logical metadata, point down');
  assert.ok(result.firing > 5, 'AI still completes raising/facing and actually fires');
  assert.ok(result.samples.every(sample => sample.banks.every(count => count === 30)));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, turns: result.turns, lowered: result.lowered,
    firing: result.firing, brakes: result.brakes, worstRate: result.worstRate }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, errors }, null, 2));
  await context.close(); await browser.close();
}
