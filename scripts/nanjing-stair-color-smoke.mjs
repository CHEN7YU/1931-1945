import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.stairColorReview = () => {
        setGameState('pause'); missionBriefing.hide();
        $('hud').hidden = true;
        for (const child of camera.children) child.visible = false;
        camera.position.set(-63.5, 3.6, -70.5);
        camera.lookAt(-68.7, 3.5, -77);
        camera.updateMatrixWorld(true);
        renderer.render(scene, camera);
      };` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5376/').href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => stairColorReview());
  await page.screenshot({ path: join(directory, 'west-stair.png') });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
