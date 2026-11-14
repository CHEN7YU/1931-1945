import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [campaign, expected, benchmark] of [
    ['nanjing', ['第6师团'], null],
    ['taierzhuang-fort', ['第10师团'], null],
    ['taierzhuang-streets', ['第10师团', '第5师团'], 'full'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
    url.searchParams.set('campaign', campaign);
    url.searchParams.set('resources', 'low-memory');
    if (benchmark) url.searchParams.set('benchmark', benchmark);
    if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
    await page.goto(url.href);
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    await page.keyboard.down('Tab');
    const labels = await page.locator('#squad-score-table .score-team.enemy tbody th').allTextContents();
    await page.keyboard.up('Tab');
    for (const name of expected) assert.ok(labels.some(label => label.includes(name)), `${campaign}: ${name}: ${labels}`);
    assert.ok(labels.every(label => !label.includes('游戏')), `${campaign}: ${labels}`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ campaign, labels }));
    await page.close();
  }
} finally {
  await browser.close();
}
