import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('Set ARTIFACT_DIR');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Explicit UI fixture only: do not ship a mutation hook or claim this as natural combat deaths.
  await page.route(/\/src\/main\.js(?:\?|$)/, async route => {
    const response = await route.fetch();
    const original = await response.text();
    await route.fulfill({ response, body: original + `
window.__deploymentFixture = (owned = true) => {
  for (const actor of allies) actor.health = 0;
  const point = objectives.find(point => point.id === 'A');
  point.owner = owned ? 'friendly' : 'enemy';
  if (state !== 'dead') showOverlay('dead'); else refreshDeployment();
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  async function checkVisibleDeployment() {
    for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [960, 540], [640, 600]]) {
      await page.setViewportSize({ width, height });
      const result = await page.evaluate(() => {
        const button = document.getElementById('confirm-deploy'), bounds = button.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        const cards = [...document.querySelectorAll('#redeploy-choices button')];
        return { visible: bounds.top >= 0 && bounds.bottom <= innerHeight && bounds.right <= innerWidth &&
          (hit === button || button.contains(hit)),
        cardsVisible: cards.every(card => {
          const box = card.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return box.top >= 0 && box.bottom <= innerHeight && (hit === card || card.contains(hit));
        }),
        scroll: document.querySelector('#overlay > .dialog').scrollTop };
      });
      assert.equal(result.visible, true, `${width}x${height}: entry button must be directly clickable`);
      assert.equal(result.cardsVisible, true, `${width}x${height}: squad cards must fit`);
      assert.equal(result.scroll, 0, 'no dialog scrolling is required');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  await checkVisibleDeployment();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  await page.evaluate(() => window.__deploymentFixture(true));
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await checkVisibleDeployment();
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false, 'new squad gets a safe default recommendation');
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  assert.deepEqual(await page.locator('#spawn-choices button').evaluateAll(buttons => buttons.map(button => button.dataset.spawn)), ['china-garage']);
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#spawn-choices button').click();
  assert.equal(await page.locator('#confirm-deploy').isDisabled(), false);
  await page.locator('#redeploy-choices [data-type="plane"]').click();
  assert.deepEqual(await page.locator('#spawn-choices button').evaluateAll(buttons => buttons.map(button => button.dataset.spawn)), ['china-air']);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#deployment-options').screenshot({ path: join(directory, 'redeploy-map.png') });
  await page.evaluate(() => window.__deploymentFixture(false));
  assert.equal(await page.locator('#spawn-choices [data-spawn^="captured-A"]').count(), 0);
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing' && window.__battle.deployments === 2);
  assert.equal(await page.evaluate(() => window.__battle.type), 'infantry');
  assert.equal(await page.evaluate(() => window.__battle.allies.length), 11);
  assert.deepEqual(errors, []);
  const result = { passed: true, limitation: 'Explicit local death/ownership UI fixture; not natural combat evidence',
    sameTypeRedeployment: true, tankInitialOnly: true, planeAirOnly: true, ownershipRefresh: true };
  await writeFile(join(directory, 'deployment-ui.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
