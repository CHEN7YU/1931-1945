import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const reports = [];
try {
  for (const campaign of ['sihang', 'nanjing', 'taierzhuang-streets']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultTimeout(180000);
    const page = await context.newPage(), errors = [], start = performance.now();
    page.on('pageerror', error => errors.push(error.message));
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5341/');
    url.searchParams.set('campaign', campaign); url.searchParams.set('resources', 'low-memory');
    try {
      await page.goto(url.href);
      await deployFromMenu(page);
      await page.waitForFunction(() => window.__battle?.state === 'playing');
      await page.waitForFunction(() => window.__battle.historicalForce?.assigned > 0);
      const data = await page.evaluate(() => {
        const battle = window.__battle;
        return { state: battle.state, time: battle.time, startupResources: battle.startupResources,
          canvas: { width: document.querySelector('#world').width, height: document.querySelector('#world').height,
            cssWidth: document.querySelector('#world').clientWidth },
          friendly: battle.historicalForce, enemy: battle.enemyHistoricalForce };
      });
      assert.equal(data.startupResources.lowMemory, true);
      assert.ok(data.canvas.width <= Math.ceil(data.canvas.cssWidth * .6));
      assert.equal(data.startupResources.textures.textureLimit, 512);
      assert.ok(data.startupResources.textures.resized > 0);
      assert.ok(data.startupResources.textures.residentTexels < data.startupResources.textures.sourceTexels * .6);
      for (const force of [data.friendly, data.enemy]) {
        assert.equal(force.residentResources.lowMemory, true);
        assert.equal(force.poolSize, 2);
        assert.equal(force.lodReady, false, 'Low-memory startup does not retain a second set of coarse body banks');
        assert.ok(force.residentResources.residentBodyBytes < force.residentResources.sourceBodyBytes * .65,
          JSON.stringify(force.residentResources));
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(directory, `${campaign}-low-memory.png`) });
      reports.push({ campaign, readyMs: performance.now() - start, ...data, errors });
    } catch (error) {
      await page.screenshot({ path: join(directory, `${campaign}-failure.png`) });
      reports.push({ campaign, error: error.message, errors });
      throw error;
    } finally { await context.close(); }
  }
  console.log(JSON.stringify({ passed: true, maps: reports.length,
    note: 'Actual resident buffers and textures; not a measurement on the user 4GB computer' }));
} finally {
  await writeFile(join(directory, 'resource-observations.json'), JSON.stringify(reports, null, 2));
  await browser.close();
}
