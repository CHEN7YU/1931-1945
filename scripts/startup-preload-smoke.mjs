import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GAME_URL ?? 'http://127.0.0.1:5353/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const stub = `
  window.__startupRuns = (window.__startupRuns ?? 0) + 1;
  await new Promise(resolve => { window.__releaseStartup = resolve; });
  document.getElementById('menu').hidden = false;
  document.getElementById('loading').hidden = true;
  export function showInitialSquadDeployment() {
    if (window.__failDeployment) throw new Error('deployment fixture failed');
    const overlay = document.getElementById('overlay');
    overlay.dataset.deploymentStep = 'squad';
    overlay.hidden = false;
  }
`;
try {
  const page = await browser.newPage();
  let requests = 0;
  await page.route('**/src/main.js*', async route => {
    requests++;
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: stub });
  });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.locator('#confirm-campaign').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('link[rel="prefetch"]').length === 2);
  assert.equal(requests, 0, 'the unselected battle must not initialize in the lobby');
  await page.locator('#confirm-campaign').click();
  await page.locator('#confirm-identity').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => typeof window.__releaseStartup === 'function');
  assert.equal(await page.locator('#overlay').getAttribute('data-deployment-step'), 'identity');
  await page.locator('#player-nickname').fill('');
  await page.locator('#confirm-identity').click();
  assert.equal(await page.locator('#overlay').getAttribute('data-deployment-step'), 'identity');
  assert.equal(await page.locator('#loading').isVisible(), false, 'invalid identity must not advance');
  await page.locator('#player-nickname').fill('测试玩家');
  await page.locator('#confirm-identity').click();
  assert.equal(await page.locator('#loading').isVisible(), true);
  assert.equal(requests, 1, 'confirming identity reuses the ongoing load');
  await page.evaluate(() => window.__releaseStartup());
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad');
  assert.equal(await page.locator('#player-nickname').inputValue(), '测试玩家');

  const direct = new URL(base);
  direct.searchParams.set('campaign', 'nanjing');
  await page.goto(direct.href, { waitUntil: 'domcontentloaded' });
  await page.locator('#confirm-identity').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForFunction(() => typeof window.__releaseStartup === 'function');
  await page.locator('#back-menu').click();
  const requestsBeforeReselect = requests;
  await page.locator('#confirm-campaign').click();
  assert.equal(requests, requestsBeforeReselect, 'reselecting the same map must not restart initialization');
  await page.locator('#back-menu').click();
  await page.locator('#campaign-choice').selectOption('sihang');
  await page.waitForURL(url => url.searchParams.get('campaign') === 'sihang');
  await page.locator('#confirm-identity').waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await page.locator('#overlay-title').textContent(), /四行/);
  await page.waitForFunction(() => typeof window.__releaseStartup === 'function');
  await page.evaluate(() => window.__releaseStartup());
  await page.waitForFunction(() => document.getElementById('menu').hidden);
  assert.equal(await page.locator('#confirm-identity').isVisible(), true,
    'background completion must not hide an unfinished identity choice');
  await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad');
  await page.route('**/src/jiangyin/jiangyin-main.js*', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: 'export {};',
  }));
  await page.locator('#back-menu').click();
  await page.locator('#back-menu').click();
  await page.waitForSelector('#campaign-choice option[value="jiangyin"]', { state: 'attached' });
  await page.locator('#campaign-choice').selectOption('jiangyin');
  await page.locator('#confirm-campaign').click();
  await page.waitForURL(url => url.searchParams.get('map') === 'jiangyin');
  await page.waitForTimeout(3500);
  assert.equal(await page.locator('link[rel="prefetch"]').count(), 0, 'Jiangyin must not prefetch infantry assets');
  await page.close();

  const fromLobby = await browser.newPage();
  await fromLobby.route('**/src/main.js*', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: stub,
  }));
  await fromLobby.goto(base, { waitUntil: 'domcontentloaded' });
  await fromLobby.waitForFunction(() => document.querySelectorAll('link[rel="prefetch"]').length === 2);
  await fromLobby.evaluate(() => { window.__lobbyMarker = true; });
  await fromLobby.locator('#campaign-choice').selectOption('nanjing');
  await fromLobby.locator('#confirm-campaign').click();
  assert.equal(await fromLobby.evaluate(() => window.__lobbyMarker), true,
    'the first map choice should reuse the lobby page and its prefetched resources');
  assert.equal(new URL(fromLobby.url()).searchParams.get('campaign'), 'nanjing');
  await fromLobby.locator('#confirm-identity').waitFor({ state: 'visible', timeout: 5000 });
  await fromLobby.waitForFunction(() => typeof window.__releaseStartup === 'function');
  await fromLobby.evaluate(() => { window.__failDeployment = true; window.__releaseStartup(); });
  await fromLobby.locator('#confirm-identity').click();
  await fromLobby.waitForFunction(() => document.getElementById('loading-message').textContent.includes('deployment fixture failed'));
  assert.equal(await fromLobby.locator('#loading').isVisible(), true);
  await fromLobby.close();

  const lowMemory = await browser.newPage();
  const lowMemoryUrl = new URL(base);
  lowMemoryUrl.searchParams.set('resources', 'low-memory');
  await lowMemory.goto(lowMemoryUrl.href, { waitUntil: 'domcontentloaded' });
  await lowMemory.waitForTimeout(3500);
  assert.equal(await lowMemory.locator('link[rel="prefetch"]').count(), 0);
  await lowMemory.close();

  const benchmark = await browser.newPage();
  await benchmark.route('**/src/main.js*', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: stub,
  }));
  const benchmarkUrl = new URL(base);
  benchmarkUrl.searchParams.set('benchmark', '1');
  await benchmark.goto(benchmarkUrl.href, { waitUntil: 'commit' });
  await benchmark.waitForFunction(() => typeof window.__releaseStartup === 'function');
  await benchmark.evaluate(() => window.__releaseStartup());
  await benchmark.waitForFunction(() => document.getElementById('menu').hidden === false);
  assert.equal(new URL(benchmark.url()).searchParams.has('campaign'), false);
  assert.equal(await benchmark.locator('link[rel="prefetch"]').count(), 0);
  await benchmark.close();

  const failure = await browser.newPage();
  await failure.route('**/src/main.js*', route => route.fulfill({
    status: 200, contentType: 'text/javascript', body: `throw new Error('startup fixture failed');`,
  }));
  await failure.goto(direct.href, { waitUntil: 'domcontentloaded' });
  await failure.waitForFunction(() => document.getElementById('loading-message').textContent.includes('startup fixture failed'));
  assert.equal(await failure.locator('#loading').isVisible(), true);
  assert.equal(await failure.locator('#overlay').isVisible(), false);
  await failure.close();
  console.log('Startup prefetch, parallel identity, map switching and failure reporting passed.');
} finally {
  await browser.close();
}
