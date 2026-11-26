import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory || !process.env.LABEL) throw new Error('ARTIFACT_DIR and LABEL are required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.parapetReview = direction => {
        setGameState('pause'); missionBriefing.hide();
        $('hud').hidden = true;
        for (const child of camera.children) child.visible = false;
        if (direction === 'wall') {
          camera.position.set(-70.6, 10.15, -72.5);
          camera.lookAt(-72.3, 9.2, -60);
        } else if (direction === 'gate-east') {
          camera.position.set(6, 10.15, 18.2);
          camera.lookAt(23, 9.2, 18.2);
        } else if (direction === 'gate-west') {
          camera.position.set(-6, 10.15, 18.2);
          camera.lookAt(-23, 9.2, 18.2);
        } else if (direction === 'gate-north') {
          camera.position.set(21.5, 10.15, 20);
          camera.lookAt(21.5, 9.2, -8);
        } else if (direction === 'southwest-corner') {
          camera.position.set(-65, 10.15, 18.2);
          camera.lookAt(-74, 9.3, 18.2);
        } else if (direction === 'north-shore') {
          camera.position.set(-107, 1.65, -105);
          camera.lookAt(-107, 1, -160);
        } else if (direction === 'dock-approach') {
          camera.position.set(-81, 2.2, -60);
          camera.lookAt(-98, 1.5, -66);
        } else if (direction === 'city-wrecks') {
          camera.position.set(-15, 10, -54);
          camera.lookAt(-15, 1, -61);
        } else if (direction === 'street-junction') {
          camera.position.set(-58, 1.65, -56);
          camera.lookAt(-58, 0, -60);
        } else {
          camera.position.set(-83, 11.5, -63);
          camera.lookAt(-72, 9.1, -60);
        }
        renderer.render(scene, camera);
      };
    ` });
  });
  await page.goto(new URL('/?campaign=nanjing&resources=low-memory',
    process.env.GAME_URL ?? 'http://127.0.0.1:5354/').href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  for (const direction of ['wall', 'outside', 'gate-east', 'gate-west', 'gate-north', 'southwest-corner', 'north-shore',
    'dock-approach', 'city-wrecks', 'street-junction']) {
    await page.evaluate(direction => window.parapetReview(direction), direction);
    await page.screenshot({ path: join(directory, `${process.env.LABEL}-${direction}.png`) });
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
