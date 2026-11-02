import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.cityReview = (view) => {
        state = 'review';
        for (const child of camera.children) child.visible = false;
        if (view === 'overview') {
          camera.position.set(6, 132, 47);
          camera.lookAt(6, 0, -43);
        } else {
          camera.position.set(-12, 12, -9);
          camera.lookAt(8, 2, -58);
        }
        renderer.render(scene, camera);
        return { houses: world.landmarks.residentialBuildings.length,
          streets: world.landmarks.cityStreets, trees: world.landmarks.trees.length };
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  await page.addStyleTag({ content: 'body > :not(canvas) { visibility: hidden !important; }' });
  for (const view of ['overview', 'wall']) {
    const result = await page.evaluate(view => window.cityReview(view), view);
    assert.ok(result.houses >= 115);
    assert.equal(result.streets.length, 5);
    assert.ok(result.trees >= 25);
    if (process.env.CITY_SCREENSHOT_DIR) {
      await mkdir(process.env.CITY_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.CITY_SCREENSHOT_DIR, `nanjing-city-${view}.png`) });
    }
    console.log(JSON.stringify({ view, ...result }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
