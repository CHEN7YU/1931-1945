import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { continueIdentitySelection, setQualityPreset } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.bCaptureReview = () => {
        state = 'review';
        const actor = controlledSoldier(entities), point = objectives.find(item => item.id === 'B');
        if (!actor || !point) throw new Error('B capture fixture requires a controlled soldier and objective');
        for (const other of [...allies, ...friendlyAI, ...enemies]) if (other !== actor) other.health = 0;
        actor.position.set(point.x, world.groundHeight(point.x, point.z), point.z);
        actor.vehicleId = null;
        const marker = world.flags.find(item => item.userData.groundCaptureMarker === 'B');
        const before = { owner: point.owner, control: point.control, marker: Boolean(marker),
          geometry: marker?.geometry.type, inside: objectiveContainsPosition(point, actor.position) };
        let steps = 0;
        while (point.owner !== 'friendly' && steps++ < 1200) updateObjectives(.05);
        return { before, owner: point.owner, control: point.control, steps, color: marker?.material.color.getHex() };
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'taierzhuang-fort');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'low');
  await page.locator('#confirm-campaign').waitFor({ state: 'visible', timeout: 180000 });
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const result = await page.evaluate(() => window.bCaptureReview());
  assert.equal(result.before.marker, true);
  assert.equal(result.before.geometry, 'RingGeometry');
  assert.equal(result.before.inside, true);
  assert.equal(result.owner, 'friendly');
  assert.equal(result.color, 0x70865d);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
