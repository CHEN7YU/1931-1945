import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5189/');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(new URL('/audio-study/', base).href);
  const buttons = page.locator('article button');
  await buttons.first().waitFor();
  assert.equal(await buttons.count(), 4);
  for (let index = 0; index < 4; index++) {
    const title = await page.locator('article h2').nth(index).textContent();
    await buttons.nth(index).click();
    await page.waitForFunction(title => document.querySelector('#status').textContent === `播放完成：${title}`, title);
    assert.equal(await page.locator('audio').nth(index).evaluate(audio => audio.duration), .6);
  }
  await buttons.nth(1).click();
  await buttons.nth(2).click();
  const exclusive = await page.locator('audio').evaluateAll(players => players.map(player => ({
    paused: player.paused, time: player.currentTime, volume: player.volume,
  })));
  assert.ok(exclusive[1].paused && exclusive[1].time === 0);
  assert.equal(exclusive[2].volume, .25);
  await page.locator('#volume').evaluate(input => { input.value = '40'; input.dispatchEvent(new Event('input')); });
  assert.ok((await page.locator('audio').evaluateAll(players => players.map(player => player.volume))).every(value => value === .4));
  const decoded = await page.evaluate(async () => {
    const metadata = await (await fetch('./assets/source.json')).json(), levels = [];
    const context = new OfflineAudioContext(1, 1, 24000);
    for (const entry of metadata.files) {
      const response = await fetch(`./assets/${entry.file}`);
      if (!response.ok) throw new Error(`Candidate HTTP ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const values = buffer.getChannelData(0);
      const rms = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
      levels.push({ file: entry.file, channels: buffer.numberOfChannels, duration: buffer.duration,
        rms, differenceDb: 20 * Math.log10(rms / metadata.targetRms) });
    }
    return levels;
  });
  assert.ok(decoded.every(item => item.channels === 1 && item.duration === .6 && Math.abs(item.differenceDb) < .01));
  assert.ok(!requests.some(path => path.startsWith('/src/main.js') || path.endsWith('.glb')), 'audition must not start the game');
  assert.deepEqual(errors, []);

  const failed = await browser.newPage();
  failed.on('pageerror', error => errors.push(error.message));
  await failed.route('**/audio-study/assets/arisaka-near.wav', route => route.fulfill({
    contentType: 'audio/wav', body: 'invalid audio data',
  }));
  await failed.goto(new URL('/audio-study/', base).href);
  await failed.locator('article[data-candidate="arisaka-near.wav"] button').click();
  await failed.locator('#status[data-error]').waitFor();
  const failureText = await failed.locator('#status').textContent();
  assert.match(failureText, /试听失败/);
  assert.deepEqual(errors, []);
  const result = { passed: true, decoded, exclusive, failureText,
    limitation: 'Verified decoding, playback completion, exclusive playback and explicit failure; not human listening acceptance.' };
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'audition.png'), fullPage: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'audition.json'), JSON.stringify(result, null, 2));
  }
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
