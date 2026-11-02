import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }), errors = [], failures = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#menu').waitFor({ state: 'visible' });
  const result = await page.evaluate(async () => {
    const { LOADING_PHOTOS } = await import('/src/loading-screen.js');
    const wall = document.getElementById('menu-photo-wall');
    const images = [...wall.querySelector('.photo-wall-copy').querySelectorAll('img')];
    await Promise.all(images.map(image => image.decode()));
    return {
      images: images.map((image, index) => {
        const displayed = image.getBoundingClientRect();
        return { url: image.src, width: image.naturalWidth, height: image.naturalHeight,
          expectedWidth: LOADING_PHOTOS[index].width, expectedHeight: LOADING_PHOTOS[index].height,
          displayedRatio: displayed.width / displayed.height, naturalRatio: image.naturalWidth / image.naturalHeight,
          trimmed: image.parentElement.classList.contains('photo-wall-trimmed'),
          restored: LOADING_PHOTOS[index].restored };
      }),
      notice: wall.querySelector('[data-photo-wall-status]').textContent,
      loadingSources: [...document.getElementById('loading').querySelector('.photo-wall-copy').querySelectorAll('img')]
        .map(image => image.getAttribute('src')),
      sources: LOADING_PHOTOS.map(photo => photo.src),
    };
  });
  assert.equal(result.images.length, 23);
  assert.equal(result.images.filter(image => image.trimmed).length, 7);
  assert.equal(result.images.filter(image => image.restored).length, 16);
  assert.match(result.notice, /AI修复上色/);
  assert.deepEqual(result.loadingSources, result.sources, 'both walls must use the same reviewed variants');
  for (const image of result.images) {
    assert.equal(image.width, image.expectedWidth);
    assert.equal(image.height, image.expectedHeight);
    assert.ok(Math.abs(image.displayedRatio - image.naturalRatio) < .01, image.url);
  }
  for (const number of [4, 9, 10, 11, 15, 17, 22]) {
    assert.ok(result.images[number - 1].url.endsWith(`photo-${String(number).padStart(2, '0')}.png`));
  }
  await page.screenshot({ path: join(directory, 'colorized-wall.png') });
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(join(directory, 'wall.json'), JSON.stringify({ passed: true, result, errors, failures }, null, 2));
  console.log(JSON.stringify({ passed: true, restored: 16, unchanged: 7, bothWalls: true }));
} finally { await browser.close(); }
