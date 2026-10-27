import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.NRA_OBSERVATION_DIR ?? 'asset-research', 'nra-observations');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], warnings = [], samples = [], requests = new Map(), transfers = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
  if (message.type() === 'warning') warnings.push(message.text());
});
const cdp = await page.context().newCDPSession(page);
await cdp.send('Network.enable');
cdp.on('Network.requestWillBeSent', event => requests.set(event.requestId, event.request.url));
cdp.on('Network.loadingFinished', event => transfers.push({ url: requests.get(event.requestId), encodedBytes: event.encodedDataLength }));
try {
  await page.goto(process.env.NRA_BATTLE_URL ?? 'http://127.0.0.1:5173/?character=nra88&benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu' || !document.querySelector('#fatal').hidden, null, { timeout: 60000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').textContent());
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalCharacter?.visible);
  await page.keyboard.down('s'); await page.waitForTimeout(600); await page.keyboard.up('s');
  await page.waitForFunction(() => window.__battle.historicalCharacter?.active === 'idle', null, { timeout: 10000 });
  await page.screenshot({ path: join(directory, 'idle.png') });
  samples.push(await page.evaluate(() => window.__battle.historicalCharacter));
  const movementStarted = await page.evaluate(() => window.__battle.time);
  const wallStarted = Date.now();
  await page.keyboard.down('s');
  let running = false;
  while (Date.now() - wallStarted < 30000) {
    await page.waitForTimeout(200);
    const sample = await page.evaluate(() => ({ ...window.__battle.historicalCharacter,
      simulationTime: window.__battle.time, playerPosition: window.__battle.position }));
    samples.push(sample);
    if (!running && ['walk', 'run'].includes(sample.active)) {
      await page.screenshot({ path: join(directory, 'moving.png') }); running = true;
    }
    if (running && sample.simulationTime >= movementStarted + 6) break;
  }
  await page.keyboard.up('s');
  await page.keyboard.press('Escape');
  const result = { samples, running, errors, warnings, transfers, state: await page.evaluate(() => window.__battle.state) };
  await writeFile(join(directory, 'observations.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(result.state, 'pause');
  assert.equal(running, true, 'Ordinary player displacement must produce real native-soldier movement');
  console.log(JSON.stringify({ directory, running, errors, warnings, samples: samples.length,
    candidateEncodedBytes: transfers.filter(item => item.url?.includes('/assets/game/nra-88/') ||
      item.url?.includes('/asset-research/nra-88/calibrated/')).reduce((sum, item) => sum + item.encodedBytes, 0) }));
} finally {
  await browser.close();
}
