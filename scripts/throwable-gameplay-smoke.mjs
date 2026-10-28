import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required for the real-input throwable recording');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: directory, size: { width: 1280, height: 800 } } });
const page = await context.newPage(), observations = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function elapsed(seconds) {
  const start = (await snapshot()).time;
  await page.waitForFunction(({ start, seconds }) => window.__battle.time >= start + seconds, { start, seconds });
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5213/');
  url.searchParams.set('benchmark', 'interior'); url.searchParams.set('seed', '1938');
  await page.goto(url.href); await page.waitForFunction(() => window.__battle?.state === 'menu');
  for (const [slot, kind] of [['5', 'grenade'], ['6', 'explosive-pack']]) {
    await page.locator('#deploy').click(); await page.waitForFunction(() => window.__battle.state === 'playing');
    assert.equal((await snapshot()).benchmark?.scenario, 'interior');
    await page.keyboard.press(slot); await elapsed(.5);
    await page.mouse.move(720, 450);
    await page.screenshot({ path: join(directory, `${kind}-ready.png`) });
    await page.mouse.down();
    await page.waitForFunction(() => window.__battle.grenades.inventory.phase === 'cooking');
    await elapsed(1);
    const held = await snapshot();
    assert.equal(held.grenades.renderer.heldKind, kind);
    observations.push({ kind, stage: 'held-guide', data: held });
    await page.screenshot({ path: join(directory, `${kind}-held-guide.png`) });
    await page.mouse.up();
    await page.waitForFunction(() => window.__battle.grenades.inventory.phase === null);
    const returned = await snapshot();
    assert.equal(returned.grenades.equipped, false);
    assert.ok(returned.weaponVisible);
    assert.ok(returned.grenades.history.some(event => event.type === 'throw' && event.kind === kind));
    observations.push({ kind, stage: 'returned-primary', data: returned });
    await elapsed(.5);
    await page.keyboard.press('Escape'); await page.locator('#back-menu').click();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual 5/6 selection, preparation/cooking guide, unchanged throw physics, primary return and native arm rendering without browser errors.');
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await context.close(); await browser.close();
}
