import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'rifle-audio-observations');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const samples = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5173/?benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__battle.rifleAudio.status), 'recorded');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.rifleAudio.contextState === 'running');
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const data = window.__battle;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -(-.5 - data.look.pitch) / .00132 }));
  });
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.rifleAudio.counts.owned >= 1);
  await page.mouse.up();
  const own = await page.evaluate(() => ({ audio: window.__battle.rifleAudio, ammo: window.__battle.ammo,
    actor: window.__battle.control.soldierId, events: window.__battle.combatEvents.history }));
  assert.equal(own.ammo, 4);
  assert.equal(own.audio.contextState, 'running');
  assert.ok(own.audio.history.some(item => item.owned && item.soldierId === own.actor && item.pan === 0));
  samples.push({ stage: 'owned-shot', ...own });
  await page.evaluate(() => {
    const data = window.__battle;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: data.look.pitch / .00132 }));
  });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z <= 50 || window.__battle.state !== 'playing', null, { timeout: 35000 });
  await page.keyboard.up('w');
  await page.waitForFunction(() => window.__battle.rifleAudio.counts.remote > 0, null, { timeout: 30000 });
  const remote = await page.evaluate(() => ({ audio: window.__battle.rifleAudio, events: window.__battle.combatEvents.history,
    state: window.__battle.state, time: window.__battle.time }));
  assert.ok(remote.audio.history.some(item => !item.owned && ['ally', 'enemy'].includes(item.credit)));
  assert.ok(remote.audio.peakVoices <= 9);
  assert.deepEqual(errors, []);
  samples.push({ stage: 'actual-remote-fire', ...remote });
  await page.screenshot({ path: join(directory, 'battle.png') });
  await page.close();

  const failurePage = await browser.newPage();
  await failurePage.route('**/assets/audio/recorded-rifle/report.wav', route => route.abort());
  const failureUrl = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  failureUrl.search = '?character=procedural';
  await failurePage.goto(failureUrl.href);
  await failurePage.waitForFunction(() => window.__battle?.state === 'menu');
  assert.equal(await failurePage.evaluate(() => window.__battle.rifleAudio.status), 'fallback');
  await failurePage.locator('#deploy').click();
  await failurePage.waitForFunction(() => window.__battle.state === 'playing');
  assert.match(await failurePage.locator('#force-status').textContent(), /录音未加载/);
  samples.push({ stage: 'explicit-fallback', audio: await failurePage.evaluate(() => window.__battle.rifleAudio),
    hud: await failurePage.locator('#force-status').textContent() });
  await failurePage.screenshot({ path: join(directory, 'explicit-fallback.png') });
  await failurePage.close();
  console.log(JSON.stringify({ passed: true, directory, stages: samples.map(sample => sample.stage), errors }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ samples, errors }, null, 2));
  await browser.close();
}
