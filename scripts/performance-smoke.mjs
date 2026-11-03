import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { validatePerformanceBatch } from '../src/performance-schema.js';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], reports = [];
const live = process.env.PERFORMANCE_LIVE_VERIFY === '1';
const map = process.env.PERFORMANCE_MAP ?? 'taierzhuang-fort';
assert.ok(['taierzhuang-fort', 'nanjing'].includes(map));
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/performance', async route => {
  const body = route.request().postDataJSON();
  reports.push(body);
  if (live) await route.continue();
  else await route.fulfill({ status: 201, json: { id: body.id, saved: true } });
});
try {
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  if (map === 'nanjing') url.searchParams.set('campaign', map);
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  assert.equal(await page.locator('#menu [data-performance-diagnostics]').isChecked(), false);
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  await page.evaluate(() => document.querySelector('#menu [data-performance-diagnostics]').click());
  if (map === 'nanjing') {
    await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 120000 });
    await page.locator('#deploy').click();
  } else {
    await page.locator('#confirm-campaign').click();
    await page.locator('#redeploy-choices [data-type="infantry"]').click();
    await page.locator('#confirm-deploy').click();
  }
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  assert.deepEqual(await page.evaluate(() => ({
    encirclement: Boolean(window.__battle.encirclement), nanjing: Boolean(window.__battle.campaign),
  })), { encirclement: map === 'taierzhuang-fort', nanjing: map === 'nanjing' });
  if (!reports.length) await page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/performance', { timeout: 65000 });
  await page.waitForTimeout(500);
  assert.ok(reports.length > 0, 'active gameplay must send a receipt-checked diagnostic batch');
  for (const body of reports) {
    assert.equal(validatePerformanceBatch(body), null, JSON.stringify(body));
    assert.ok(body.windows.every(window => window.context.map === map));
  }
  if (live) {
    await page.waitForFunction(() => window.__battle?.performanceDiagnostics.savedWindows > 0, null, { timeout: 30000 });
    const url = new URL('/api/performance', page.url());
    const duplicate = await page.request.post(url.href, { headers: { Origin: url.origin }, data: reports[0] });
    assert.equal(duplicate.status(), 200);
    assert.deepEqual(await duplicate.json(), { id: reports[0].id, saved: true });
    assert.equal((await page.request.get(url.href)).status(), 401);
  }
  assert.ok(reports.some(body => body.windows.some(window => window.frames > 20 && window.context.allies > 0)));
  const scopes = new Set(reports.flatMap(body => body.windows.flatMap(window => Object.keys(window.scopes))));
  for (const name of ['ai', 'presentation', 'render', 'player', 'vehicles', 'motion']) assert.ok(scopes.has(name), name);
  await page.evaluate(() => document.querySelector('#pause [data-performance-diagnostics], #menu [data-performance-diagnostics]').click());
  const before = reports.length;
  await page.waitForTimeout(6000);
  assert.equal(reports.length, before, 'opt-out must stop new uploads');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, map, reports: reports.length, windows: reports.reduce((n, batch) => n + batch.windows.length, 0),
    sessionId: reports[0].sessionId, scopes: [...scopes],
    note: live ? 'Live deployment verification session only; no private feedback created.' :
      'Mocked browser receipts only; no player report or contact data written to production.' }));
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading').textContent(),
    state: await page.evaluate(() => ({ state: window.__battle?.state,
      diagnostics: window.__battle?.performanceDiagnostics, hidden: document.hidden,
      localPreference: localStorage.getItem('shanhe.performance-diagnostics.v1') })) }));
  throw error;
} finally { await browser.close(); }
