import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.ferryApproachReview = (x, z, targetX, targetZ) => {
        setGameState('pause'); missionBriefing.hide();
        for (const enemy of enemies) enemy.health = 0;
        const actor = controlledSoldier(entities);
        actor.position.set(x, world.groundHeight(x, z), z);
        if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
        stopLocomotion(actor.locomotion);
        controlPose.yaw = Math.atan2(x - targetX, z - targetZ);
        controlPose.pitch = -.08;
        setGameState('playing'); bindControlInput(); updateCamera(0);
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu' &&
    document.getElementById('overlay').dataset.deploymentStep === 'identity', null, { timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const views = [
    { name: 'roadblock', x: -72, z: -79, targetX: -80, targetZ: -80 },
    { name: 'truck', x: -78, z: -60, targetX: -85, targetZ: -64 },
    { name: 'bus', x: -90, z: -100, targetX: -90, targetZ: -94 },
  ];
  for (const view of views) {
    await page.evaluate(({ x, z, targetX, targetZ }) => ferryApproachReview(x, z, targetX, targetZ), view);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(directory, `${view.name}.png`) });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({ views, errors,
    limitation: 'Low-quality gameplay diagnostic: player placed at the listed coordinates and enemies disabled.' }, null, 2));
} finally {
  await browser.close();
}
