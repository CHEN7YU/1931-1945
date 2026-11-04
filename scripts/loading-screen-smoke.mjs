import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let withheld = null;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', route => { withheld = route; return new Promise(() => {}); });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#menu').waitFor({ state: 'visible' });
  const photoCount = await page.evaluate(async () => {
    const images = [...document.querySelector('#menu-photo-wall .photo-wall-copy').querySelectorAll('img')];
    await Promise.all(images.map(async image => {
      await image.decode();
      if (!image.naturalWidth || !image.naturalHeight) throw new Error(`Photo is empty: ${image.src}`);
    }));
    return images.length;
  });
  assert.equal(photoCount, 23);
  assert.equal(await page.locator('#menu-photo-wall .photo-wall-copy').count(), 2);
  const horizontalRow = await page.locator('#menu-photo-wall .photo-wall-copy').first().evaluate(copy => {
    const images = [...copy.querySelectorAll('img')];
    const firstY = images[0].getBoundingClientRect().y;
    return images.every(image => {
      const bounds = image.getBoundingClientRect();
      const trimmed = image.parentElement.classList.contains('photo-wall-trimmed');
      const card = image.parentElement.getBoundingClientRect();
      return Math.abs(bounds.y - firstY) < 1 && getComputedStyle(image).objectFit === 'contain' &&
        (trimmed ? card.height : bounds.height) <= Math.min(innerHeight * .44, 420) + 3 &&
        Math.abs(bounds.width / bounds.height - image.naturalWidth / image.naturalHeight) < .01;
    });
  });
  assert.equal(horizontalRow, true, 'each photograph keeps its original aspect ratio and fits the horizontal viewing window');
  const track = page.locator('#menu-photo-wall [data-photo-wall-track]');
  const photoOrder = await track.evaluate(element => [...element.querySelector('.photo-wall-copy').querySelectorAll('img')].map(image => image.src));
  const offset = element => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
  const before = await track.evaluate(offset);
  await page.waitForTimeout(1000);
  const after = await track.evaluate(offset);
  assert.ok(before - after > 60 && before - after < 90, 'the entire wall must move left continuously at about 72 pixels/second');
  await page.locator('#menu-photo-wall [data-photo-wall-toggle]').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const paused = await track.evaluate(offset);
  await page.waitForTimeout(1000);
  assert.ok(Math.abs(await track.evaluate(offset) - paused) < 1, 'pause preserves the current wall position');
  await page.locator('#menu-photo-wall [data-photo-wall-toggle]').click();
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'photo-wall.png') });
  }
  await page.locator('#confirm-campaign').click();
  assert.equal(await page.locator('#player-identity').isVisible(), true);
  assert.equal(await page.locator('#deployment-options').isVisible(), false);
  assert.equal(await page.locator('#menu-photo-wall').isVisible(), false);
  assert.equal(await page.locator('#deployment-campaign-context').isVisible(), true);
  await page.locator('#back-menu').click();
  await page.waitForFunction(order => {
    const copies = [...document.querySelectorAll('#menu-photo-wall .photo-wall-copy')];
    const current = [...copies[0].querySelectorAll('img')].map(image => image.src);
    return current.some((source, index) => source !== order[index]) &&
      [...copies[1].querySelectorAll('img')].every((image, index) => image.src === current[index]);
  }, photoOrder);
  await page.locator('#confirm-campaign').click();
  await page.locator('#confirm-identity').click();
  await page.locator('#loading').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#menu').isVisible(), false);
  assert.equal(await track.evaluate(element => element.style.animationPlayState), 'paused');
  assert.equal(await page.locator('#loading .loading-years').textContent(), '1931-1945');
  assert.equal(await page.locator('#loading .loading-brand strong').textContent(), '山河');
  const message = await page.locator('#loading-message').textContent();
  assert.match(message, /正在加载/);
  const loadingTrack = page.locator('#loading [data-photo-wall-track]');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#loading-photo-wall').isVisible(), false, 'selected loading must not show the unrelated wall');
  assert.equal(await page.locator('#loading-campaign-preview').isVisible(), true);
  assert.match(await page.locator('#loading-campaign-preview img').getAttribute('src'), /taierzhuang-fort\.webp/);
  assert.equal(await page.locator('#loading-campaign-preview li').count(), 3);
  assert.equal(await loadingTrack.evaluate(element => element.style.animationPlayState), 'paused');
  assert.equal(await page.locator('#loading-message').textContent(), message, 'photo movement cannot overwrite actual stage text');
  assert.equal(await page.locator('#loading-campaign-preview img').evaluate(image => getComputedStyle(image).objectFit), 'contain');
  if (process.env.ARTIFACT_DIR) {
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'loading.png') });
    await writeFile(join(process.env.ARTIFACT_DIR, 'loading.json'), JSON.stringify({
      photoCount, horizontalMotion: before - after, menuPauseResume: true, loadingMovement: true,
      note: 'The main module request was held only by this browser test to observe the real loading UI.',
      errors,
    }, null, 2));
  }
  const reduced = await browser.newPage();
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await reduced.locator('#menu').waitFor({ state: 'visible' });
  assert.equal(await reduced.locator('#menu-photo-wall [data-photo-wall-track]').evaluate(element =>
    element.style.animationPlayState), 'paused', 'reduced motion must not autoplay');
  await reduced.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, photoCount, horizontalPixelsPerSecond: before - after,
    menuPauseResume: true, loadingMovement: true, reducedMotion: true }));
} finally {
  if (withheld) await withheld.abort();
  await browser.close();
}
