import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'audio-observations', 'chinese-rifle-audio');
const gameUrl = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5213/?benchmark=full&seed=1938');
const paths = ['/assets/audio/recorded-rifle/report.wav',
  '/assets/audio/friendly-rifle-generated/rifle-report.wav', '/assets/audio/friendly-rifle-generated/sniper-report.wav'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = { gameUrl: gameUrl.href, fetched: [], browserResponses: [], errors: [], webglGameStartup: true, routeMocking: false };
await mkdir(directory, { recursive: true });
let browser;
try {
  for (const path of paths) {
    const response = await fetch(new URL(path, gameUrl));
    const bytes = Buffer.from(await response.arrayBuffer());
    const local = await readFile(new URL(`../public${path}`, import.meta.url));
    const record = { path, status: response.status, contentType: response.headers.get('content-type'),
      bytes: bytes.length, magic: bytes.toString('ascii', 0, 12), sha256: hash(bytes), localSha256: hash(local),
      matchesLocal: bytes.equals(local) };
    evidence.fetched.push(record);
    assert.equal(record.status, 200);
    assert.equal(record.matchesLocal, true, `${path} is not the local WAV: ${record.contentType}, ${record.magic}`);
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const responses = [];
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (paths.includes(path)) responses.push((async () => {
      const bytes = await response.body();
      evidence.browserResponses.push({ path, status: response.status(), contentType: response.headers()['content-type'],
        bytes: bytes.length, magic: bytes.toString('ascii', 0, 12), sha256: hash(bytes) });
    })());
  });
  await page.goto(gameUrl.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  evidence.gameAudio = await page.evaluate(() => window.__battle.rifleAudio);
  await Promise.all(responses);
  assert.equal(evidence.gameAudio.status, 'recorded');
  assert.deepEqual(Object.keys(evidence.gameAudio.reports), ['fallback', 'friendly-rifle', 'friendly-sniper']);
  for (const path of paths) {
    const response = evidence.browserResponses.find(item => item.path === path);
    assert.equal(response?.sha256, evidence.fetched.find(item => item.path === path).localSha256);
  }
  evidence.decodeChecks = await page.evaluate(async paths => {
    const bodies = await Promise.all(paths.map(async path => (await fetch(path)).arrayBuffer()));
    const results = [];
    for (const mode of ['sequential', 'parallel']) {
      const context = new OfflineAudioContext(1, 1, 24000);
      for (let iteration = 0; iteration < 3; iteration++) {
        const buffers = [];
        if (mode === 'parallel') buffers.push(...await Promise.all(bodies.map(bytes => context.decodeAudioData(bytes.slice(0)))));
        else for (const bytes of bodies) buffers.push(await context.decodeAudioData(bytes.slice(0)));
        results.push({ mode, iteration, durations: buffers.map(buffer => buffer.duration),
          sampleRates: buffers.map(buffer => buffer.sampleRate), channels: buffers.map(buffer => buffer.numberOfChannels) });
      }
    }
    const mixer = await (await import('/src/rifle-audio.js')).loadRifleAudio();
    return { results, directLoader: mixer.snapshot };
  }, paths);
  for (const check of evidence.decodeChecks.results) {
    assert.deepEqual(check.durations, [.6, .42, .28]);
    assert.deepEqual(check.sampleRates, [24000, 24000, 24000]);
    assert.deepEqual(check.channels, [1, 1, 1]);
  }
  assert.equal(evidence.decodeChecks.directLoader.status, 'recorded');
  assert.deepEqual(evidence.errors, []);
  await page.close();
  console.log(JSON.stringify({ passed: true, directory, fetched: evidence.fetched,
    gameAudio: evidence.gameAudio, decodeChecks: evidence.decodeChecks.results, errors: evidence.errors }));
} finally {
  await browser?.close();
  await writeFile(join(directory, 'actual-vite-startup.json'), JSON.stringify(evidence, null, 2));
}
