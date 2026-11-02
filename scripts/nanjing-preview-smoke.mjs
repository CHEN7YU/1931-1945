import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [], external = [];
const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
page.on('request', request => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(origin).origin) external.push(request.url());
});
const out = process.env.ARTIFACT_DIR;

try {
  await page.goto(new URL('/nanjing-preview.html', origin).href);
  await page.waitForFunction(() => window.__nanjingPreview?.ready, null, { timeout: 30000 });
  assert.equal(await page.locator('#battle-map').getAttribute('data-phase'), 'defense');
  assert.equal(await page.locator('#boarded-count').textContent(), '—');
  assert.match(await page.locator('#force-summary').innerText(), /3队.*玩家小队.*2支AI小队/);

  const capture = async name => {
    if (!out) return;
    await mkdir(out, { recursive: true });
    await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  };
  await capture('nanjing-defense');

  await page.locator('[data-phase-button="withdrawal"]').click();
  assert.equal(await page.locator('#battle-map').getAttribute('data-phase'), 'withdrawal');
  assert.match(await page.locator('#phase-rule').textContent(), /抵达渡口.*第二阶段/);
  assert.match(await page.locator('#force-summary').innerText(), /停止新增援.*持续逼近/);
  await capture('nanjing-withdrawal');

  await page.locator('[data-phase-button="ferry"]').click();
  assert.equal(await page.locator('#battle-map').getAttribute('data-phase'), 'ferry');
  assert.match(await page.locator('#force-summary').innerText(), /5队.*3队.*2支增援/);
  assert.equal(await page.locator('#boarded-count').textContent(), '86');
  assert.equal(await page.locator('#waiting-count').textContent(), '42');
  assert.equal(await page.locator('#casualty-count').textContent(), '8');
  assert.match(await page.locator('#civilian-note').textContent(), /136人抵达 = 86人已登船 \+ 42人等候 \+ 8人伤亡/);
  assert.equal(await page.locator('#civilian-message').textContent(),
    '你已经成功掩护 136 名百姓到达上新河渡口，其中 86 名已撤离南京，免于日军屠刀。');
  assert.match(await page.locator('.water-label').textContent(), /上新河渡口/);
  await capture('nanjing-ferry');

  await page.locator('#reset-flow').click();
  assert.equal(await page.locator('#battle-map').getAttribute('data-phase'), 'defense');
  await page.locator('#play-flow').click();
  assert.equal(await page.locator('#play-flow').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => window.__nanjingPreview.phase === 'withdrawal', null, { timeout: 6000 });
  await page.locator('#play-flow').click();
  assert.equal(await page.locator('#play-flow').getAttribute('aria-pressed'), 'false');
  await page.locator('#enter-first-person').click();
  await page.waitForFunction(() => window.__nanjingFirstPerson?.active && window.__nanjingFirstPerson.ready);
  assert.equal(await page.locator('#scene-title').textContent(), '中华门 · 瓮城防线');
  assert.deepEqual(await page.evaluate(() => window.__nanjingFirstPerson.layout), {
    innerBarbicans: 3, alignedGateways: 4, rivers: 3, bridgeCrossings: 2,
  });
  assert.match(await page.locator('#scene-status').textContent(), /三道内瓮城、四道券门/);
  await capture('nanjing-zhonghuamen-first-person');
  const gatePosition = await page.evaluate(() => window.__nanjingFirstPerson.position);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  const movedPosition = await page.evaluate(() => window.__nanjingFirstPerson.position);
  assert.ok(movedPosition.z > gatePosition.z, 'First-person movement should advance toward the south gate');
  await page.locator('#scene-ferry').click();
  assert.equal(await page.locator('#scene-title').textContent(), '上新河渡口 · 百姓撤离线');
  assert.equal(await page.locator('#scene-civilian-message').textContent(),
    '你已经成功掩护 136 名百姓到达上新河渡口，其中 86 名已撤离南京，免于日军屠刀。');
  await capture('nanjing-first-person-ferry');
  await page.locator('#scene-exit').click();
  assert.equal(await page.evaluate(() => window.__nanjingFirstPerson.active), false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-phase-button="ferry"]').click();
  const mobile = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
    phase: window.__nanjingPreview.phase,
  }));
  assert.equal(mobile.phase, 'ferry');
  assert.ok(mobile.page <= mobile.viewport, `Horizontal overflow on mobile: ${JSON.stringify(mobile)}`);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const result = { phases: await page.evaluate(() => window.__nanjingPreview.phaseIds), mobile, errors, external };
  if (out) await writeFile(join(out, 'nanjing-preview.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
