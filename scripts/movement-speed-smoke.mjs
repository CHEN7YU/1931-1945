import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'movement-speed');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
let failure = null;
try {
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle.time > 1 && window.__battle.simulationClock.pendingSeconds < .001);
  await page.keyboard.down('w');
  const data = await page.evaluate(() => new Promise(resolve => {
    const samples = [], started = performance.now();
    let stalled = false;
    function frame() {
      const state = window.__battle;
      samples.push({ wall: performance.now(), time: state.time, position: state.position, speed: state.locomotion.speed,
        clock: state.simulationClock, friends: state.friendlyPositions.map(actor => ({ id: actor.id, x: actor.x, z: actor.z })) });
      if (!stalled && performance.now() - started > 700) {
        stalled = true;
        const until = performance.now() + 650;
        while (performance.now() < until) { /* Reproduce a real foreground shader/main-thread stall. */ }
      }
      if (performance.now() - started >= 4000) resolve(samples);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
  observations.push(...data);
  await page.keyboard.up('w');
  const intervals = [];
  for (let index = 0; index < data.length; index++) {
    for (let end = index + 1; end < data.length; end++) {
      if (data[end].wall - data[end - 1].wall > 150) break;
      const previous = data[index], current = data[end], wall = (current.wall - previous.wall) / 1000;
      // Render completion can shift samples by tens of milliseconds; also check exact clock budgets below.
      if (wall < .4) continue;
      intervals.push({ wall, ratio: (current.time - previous.time) / wall,
        speed: Math.hypot(current.position.x - previous.position.x, current.position.z - previous.position.z) / wall,
        pending: current.clock.pendingSeconds });
      break;
    }
  }
  assert.ok(intervals.length > 10, 'Observe sustained rendered movement, not an empty or frozen scene');
  for (let index = 1; index < data.length; index++) {
    const current = data[index].clock, previous = data[index - 1].clock;
    if (current.limits.maxRecoveryRate) assert.ok(current.frameSeconds <=
      (current.activeSeconds - previous.activeSeconds) * current.limits.maxRecoveryRate + 1e-8);
  }
  const worst = intervals.reduce((a, b) => a.ratio > b.ratio ? a : b);
  console.log(JSON.stringify({ url: page.url(), worst, samples: data.length, directory }));
  assert.ok(worst.ratio < 1.3, `A rendered recovery interval cannot fast-forward the whole battle ${worst.ratio.toFixed(2)}x`);
  assert.ok(intervals.every(interval => interval.speed < 4.1), 'Normal jogging cannot become a real-time sprint during recovery');
  assert.deepEqual(errors, []);
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await page.keyboard.up('w');
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors, failure }, null, 2));
  await browser.close();
}
