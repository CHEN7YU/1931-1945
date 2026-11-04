import { continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
  await page.locator('#redeploy-choices [data-type="infantry"]').click();
  await page.locator('#spawn-choices [data-spawn="china-base"]').click();
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 120000 });
  for (const [key, kind, slot] of [['5', 'grenade', 5], ['5', 'grenade', 5],
    ['6', 'explosive-pack', 6], ['6', 'explosive-pack', 6], ['5', 'grenade', 5]]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
    const actual = await page.evaluate(() => window.__battle.grenades);
    assert.equal(actual.selected, kind);
    assert.equal(actual.equipped, true);
    assert.equal(actual.inventory.ammo, 1);
    assert.equal(actual.inventory.packs, 1);
    assert.ok(await page.locator(`[data-equipment-slot="${slot}"]`).evaluate(element => element.classList.contains('selected')));
  }
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.grenades.inventory.phase === 'cooking', null, { timeout: 10000 });
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.grenades.inventory.ammo === 0 &&
    window.__battle.grenades.inventory.phase === null, null, { timeout: 10000 });
  await page.keyboard.press('5'); await page.waitForTimeout(200);
  const exhausted = await page.evaluate(() => window.__battle.grenades);
  assert.equal(exhausted.selected, 'grenade');
  assert.equal(exhausted.equipped, false, 'an empty grenade slot must not silently equip the pack');
  assert.equal(exhausted.inventory.packs, 1);
  await page.keyboard.press('6'); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__battle.grenades.selected), 'explosive-pack');
  assert.deepEqual(errors, []);
  console.log('Separate 5/6 keys, repeated presses, independent stocks and no empty-slot fallback passed');
} finally {
  await browser.close();
}
