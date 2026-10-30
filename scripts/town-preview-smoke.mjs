import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
const origin = process.env.GAME_URL || 'http://127.0.0.1:53927';
page.on('request', request => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) external.push(request.url());
});
const out = process.env.ARTIFACT_DIR;
const snapshot = () => page.evaluate(() => ({
  ...window.__townPreview,
  position: window.__townPreview.position,
  overview: window.__townPreview.overview,
}));
try {
  await page.goto(new URL('/town-preview.html', origin).href);
  await page.waitForFunction(() => window.__townPreview?.ready, null, { timeout: 90000 });
  assert.equal((await snapshot()).combatActors, 0);
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.equal(await page.evaluate(() => Boolean(window.__battle)), false);
  const capture = async name => {
    if (!out) return;
    await mkdir(out, { recursive: true });
    await page.screenshot({ path: join(out, `${name}.png`) });
  };
  await page.locator('#overview').click();
  assert.equal((await snapshot()).overview, true);
  await page.waitForTimeout(250);
  await capture('town-overview');
  for (const id of ['A', 'B', 'C']) {
    await page.locator(`[data-point="${id}"]`).click();
    assert.equal((await snapshot()).overview, false);
    await page.waitForTimeout(200);
    await capture(`town-${id}`);
  }
  // The actual keyboard/capsule loop crosses the gate opening, not a teleport fixture.
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__townPreview.position.x > 60, null, { timeout: 15000 });
  await page.keyboard.up('w');
  assert.ok((await snapshot()).position.x > 60);
  await page.locator('[data-point="B"]').click();
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__townPreview.position.z < -15, null, { timeout: 15000 });
  await page.keyboard.up('w');
  const deck = await snapshot();
  assert.equal(deck.position.y, .95);
  assert.ok(deck.position.z > -22.5);
  await capture('town-bridge-walk');
  await page.locator('[data-point="A"]').click();
  await page.keyboard.press('m');
  assert.equal((await snapshot()).overview, true);
  await page.keyboard.press('m');
  assert.equal((await snapshot()).overview, false);
  const before = (await snapshot()).position;
  await page.mouse.move(700, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(790, 450, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('s'); await page.waitForTimeout(300); await page.keyboard.up('s');
  const after = await snapshot();
  assert.ok(Math.hypot(after.position.x - before.x, after.position.z - before.z) > .3);
  for (const route of after.routes) assert.ok(Math.abs(route.friendly - route.enemy) <= 15, route.id);
  assert.ok(Math.min(...after.routes.map(route => route.friendly)) <= 40);
  assert.ok(Math.min(...after.routes.map(route => route.enemy)) <= 45);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const result = { routes: after.routes, gateWalk: true, bridgeDeck: deck.position, combatActors: after.combatActors, errors, external };
  if (out) await writeFile(join(out, 'town-preview.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await page.keyboard.up('w');
  await page.keyboard.up('s');
  await browser.close();
}
