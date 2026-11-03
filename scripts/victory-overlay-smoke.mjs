import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  const settings=defaultPreferences();settings.quality.preset='low';
  Object.keys(settings.quality.effects).forEach(key=>settings.quality.effects[key]=false);
  await page.addInitScript(({key,settings})=>localStorage.setItem(key,JSON.stringify({version:1,settings})),
    {key:PREFERENCES_KEY,settings});
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
window.__overlayFixture = kind => showOverlay(kind);` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203',
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  for (const kind of ['victory', 'defeat', 'draw', 'pause', 'dead', 'victory']) {
    await page.evaluate(kind => window.__overlayFixture(kind), kind);
    const ended = ['victory', 'defeat', 'draw'].includes(kind);
    assert.equal(await page.locator('#deployment-help').isVisible(), !ended);
    assert.equal(await page.locator('#overlay [data-build-version]').isVisible(), !ended);
    assert.equal(await page.locator('#overlay-description').isVisible(), kind !== 'victory');
    assert.equal(await page.locator('#battle-summary').isVisible(), true);
    assert.equal(await page.locator('#back-menu').isVisible(), true);
    if (kind === 'victory') assert.equal(await page.locator('#overlay-description').textContent(), '');
    assert.doesNotMatch(await page.locator('#overlay-description').textContent(),/原创玩法|不代表真实历史|玩法演示/);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: clean victory overlay, hidden end-screen help/version, and restored pause/deployment content.');
} finally { await browser.close(); }
