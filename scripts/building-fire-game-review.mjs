import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.EXPECT_FLAMES === '1') {
    await page.route('**/src/battlefield.js*', async route => {
      const response = await route.fetch();
      const original = await response.text();
      const marker = 'createBuildingFire(scene, [...town.buildings, ...outskirts.buildings], { flames: false })';
      if (!original.includes(marker)) throw new Error('Cannot restore baseline building flames for comparison');
      await route.fulfill({ response, body: original.replace(marker,
        'createBuildingFire(scene, [...town.buildings, ...outskirts.buildings])') });
    });
  }
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.buildingFireGameReview = {
        capture(smoke) {
          setGameState('pause'); missionBriefing.hide();
          world.buildingFire.update(12.4, { smoke, low: false });
          const source = world.buildingFire.sources[0];
          if (source) {
            camera.position.set(source.x, source.y + 1.8, source.z + 2.2);
            camera.lookAt(source.x, source.y + .8, source.z);
            camera.updateMatrixWorld(true);
          }
          renderer.render(scene, camera);
          return { source: source && { id: source.id, x: source.x, y: source.y, z: source.z },
            fire: world.buildingFire.snapshot,
            image: renderer.domElement.toDataURL('image/png'), error: renderer.getContext().getError() };
        }
      };
    ` });
  });
  const campaign = process.env.CAMPAIGN ?? 'taierzhuang-fort';
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', campaign);
  if (process.env.BENCHMARK) url.searchParams.set('benchmark', process.env.BENCHMARK);
  url.searchParams.set('character', 'procedural');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const captures = [];
  for (const smoke of [true, false]) {
    const result = await page.evaluate(enabled => window.buildingFireGameReview.capture(enabled), smoke);
    await writeFile(join(directory, `${campaign}-${smoke ? 'smoke' : 'no-smoke'}.png`),
      Buffer.from(result.image.split(',')[1], 'base64'));
    delete result.image;
    assert.equal(result.error, 0);
    if (!smoke) assert.equal(result.fire.smoke, 0);
    if (process.env.EXPECT_FLAMES === '1') assert.ok(result.fire.flames > 0);
    else assert.equal(result.fire.flames, 0);
    captures.push({ smoke, ...result });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, `${campaign}.json`), JSON.stringify({
    fixture: 'actual deployed game, procedural characters, paused, manually positioned diagnostic camera; fixed simulation time',
    captures, errors,
  }, null, 2));
  console.log(`${campaign}: ${captures[0].fire.flames} building flames, ${captures[0].fire.smoke} smoke instances`);
} finally {
  await browser.close();
}
