import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  let available = false, posts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/feedback/status', route =>
    route.fulfill({ json: { available } }));
  await page.route('**/api/feedback', route => {
    posts++;
    const body = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { id: body.id, saved: true } });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203',
    { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#menu [data-feedback-open]').first().click();
  await page.locator('#feedback-retry').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#feedback-submit').isDisabled(), true);
  const unavailable = await page.locator('#feedback-status').textContent();
  await page.locator('#feedback-content').fill('测试测试 十一月2日');
  await page.locator('#feedback-contact').fill('test-contact');
  assert.equal(await page.locator('#feedback-status').textContent(), unavailable,
    'typing must not erase the explanation while submit remains disabled');
  assert.match(unavailable, /服务当前不可用/);
  assert.equal(posts, 0);
  available = true;
  await page.locator('#feedback-retry').click();
  await page.waitForFunction(() => !document.getElementById('feedback-submit').disabled);
  assert.equal(await page.locator('#feedback-content').inputValue(), '测试测试 十一月2日');
  assert.equal(await page.locator('#feedback-contact').inputValue(), 'test-contact');
  assert.equal(await page.locator('#feedback-retry').isVisible(), false);
  await page.locator('#feedback-submit').click();
  await page.waitForFunction(() => document.getElementById('feedback-status').dataset.kind === 'success');
  assert.equal(posts, 1);
  assert.match(await page.locator('#feedback-status').textContent(), /回执编号/);
  assert.equal(await page.locator('#feedback-content').inputValue(), '');
  assert.deepEqual(errors, []);
  console.log('PASS: offline explanation survives typing; reconnect preserves draft and enables receipt-checked submission. Requests are browser-only fixtures, not production feedback.');
} finally { await browser.close(); }
