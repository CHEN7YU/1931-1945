import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const settings = defaultPreferences();
  settings.quality.preset = 'low';
  settings.resourceMode = 'standard';
  settings.startupQualityLevel = 2;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.buildingSmokeReview = {
        capturePair() {
          setGameState('pause'); missionBriefing.hide();
          graphics.setAutomaticLevel(2);
          const first = world.smoke[0].userData;
          camera.position.set(first.originX + 22, first.originY + 5, first.originZ + 22);
          camera.lookAt(first.originX, first.originY + 7, first.originZ);
          camera.updateMatrixWorld(true);
          return [false, true].map(enabled => {
            graphics.setEffect('smoke', enabled);
            world.buildingFire.update(time, { smoke: graphics.snapshot.effects.smoke, low: true });
            renderer.render(scene, camera);
            return { enabled, image: renderer.domElement.toDataURL('image/png'), smoke: graphics.snapshot.visibleSmoke,
              lowMemory: graphics.snapshot.lowMemory, level: graphics.snapshot.automaticLevel,
              drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
          });
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const records = await page.evaluate(() => window.buildingSmokeReview.capturePair());
  for (const capture of records) {
    await writeFile(join(directory, capture.enabled ? 'smoke-on.png' : 'smoke-off.png'),
      Buffer.from(capture.image.split(',')[1], 'base64'));
    delete capture.image;
  }
  assert.equal(records[0].smoke, 0);
  assert.equal(records[1].smoke, 10);
  assert.equal(records[1].lowMemory, false);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'smoke-review.json'), JSON.stringify({
    fixture: 'Production Nanjing scene; paused; manually positioned diagnostic camera; fixed automatic quality level two; manual smoke off/on.',
    records, errors }, null, 2));
  console.log('Nanjing reduced-quality skyline smoke review captured.');
} finally {
  await browser.close();
}
