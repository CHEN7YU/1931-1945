import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { validatePerformanceBatch } from '../src/performance-schema.js';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'adaptive-load');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const map of ['nanjing', 'taierzhuang-fort']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage(), errors = [], reports = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/performance', async route => {
      const body = route.request().postDataJSON();
      assert.equal(validatePerformanceBatch(body), null);
      reports.push(body);
      await route.fulfill({ contentType: 'application/json', status: 201,
        body: JSON.stringify({ id: body.id, saved: true }) });
    });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
      window.adaptiveReview = {
        pause() { showOverlay('pause'); },
        invariant() { return JSON.stringify({ time, remaining, actors: allForces.map(actor =>
          [actor.id, actor.health, actor.position.toArray(), actor.rifle.ammo, actor.rifle.shots]),
          objectives: objectives.map(point => [point.id, point.owner, point.progress]) }); },
        pressure() {
          const now=performance.now();
          automaticQuality.observe(0,{active:false,now});
          automaticQuality.observe(16,{active:true,now});
          automaticQuality.observe(600,{active:true,backlogSeconds:1,now:now+600});
          automaticQuality.observe(0,{active:false,now:now+600});
        },
        counters() { return { ...automaticQuality.statistics }; },
        flush() { performanceDiagnostics.flush(); },
        preferences() { return preferences.snapshot.quality; }
      };` });
    });
    const cdp = await context.newCDPSession(page);
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5332/');
    url.searchParams.set('campaign', map); url.searchParams.set('diagnostics', '1');
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    if (map !== 'nanjing') await page.locator('#confirm-campaign').click();
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing' &&
      window.__battle.historicalForce.assigned > 0, null, { timeout: 180000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.waitForFunction(() => window.__battle.automaticQuality.level > 0, null, { timeout: 30000 });
    const automatic = await page.evaluate(() => ({
      automatic: __battle.automaticQuality, graphics: __battle.graphics,
      friendly: __battle.historicalForce.assigned, enemy: __battle.enemyHistoricalForce.assigned,
      backlog: __battle.simulationClock ?? null,
    }));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => adaptiveReview.pause());
    const invariant = await page.evaluate(() => adaptiveReview.invariant());
    await page.evaluate(() => adaptiveReview.pressure());
    await page.waitForFunction(() => __battle.graphics.automaticLevel === 3 &&
      __battle.historicalForce.detailBudget === 1 && __battle.enemyHistoricalForce.detailBudget === 1);
    const emergency = await page.evaluate(() => ({ graphics: __battle.graphics, automatic: __battle.automaticQuality }));
    assert.equal(emergency.graphics.pixelRatio, .6);
    assert.equal(emergency.graphics.canvasWidth, 768);
    assert.equal(emergency.graphics.shadowsEnabled, false);
    assert.equal(emergency.graphics.effects.muzzle, true);
    assert.equal(emergency.graphics.effects.hitParticles, true);
    assert.equal(emergency.graphics.effects.damageVignette, true);
    assert.equal(await page.evaluate(() => adaptiveReview.invariant()), invariant);
    const counts = await page.evaluate(() => adaptiveReview.counters());
    await page.waitForTimeout(1000);
    assert.deepEqual(await page.evaluate(() => adaptiveReview.counters()), counts, 'paused time must not inflate reductions or active seconds');
    assert.equal(await page.locator('#overlay [data-quality-toggle]').inputValue(), 'high');
    await page.locator('#pause-settings > summary').click();
    await page.locator('#overlay [data-quality-toggle]').selectOption('low');
    let manual = await page.evaluate(() => ({ graphics: __battle.graphics, saved: adaptiveReview.preferences() }));
    assert.equal(manual.graphics.automaticLevel, 0);
    assert.equal(manual.saved.preset, 'low');
    await page.locator('#overlay [data-quality-toggle]').selectOption('high');
    manual = await page.evaluate(() => ({ graphics: __battle.graphics, saved: adaptiveReview.preferences() }));
    assert.equal(manual.saved.preset, 'high');
    assert.equal(manual.graphics.pixelRatio, 1.5);
    assert.equal(await page.evaluate(() => adaptiveReview.invariant()), invariant);
    await page.evaluate(() => adaptiveReview.flush());
    await page.waitForTimeout(500);
    const loads = reports.flatMap(report => report.windows.map(window => window.context.automaticLoad).filter(Boolean));
    assert.ok(loads.some(load => load.activations >= 1 && load.peak === 3), 'actual uploaded windows must contain reduction counters');
    assert.deepEqual(errors, []);
    results.push({ map, automatic, emergency, manual, counters: counts, reportedAutomaticWindows: loads.length });
    await writeFile(join(directory, 'adaptive-load.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ map, naturalReductions: automatic.automatic.reductions,
      peak: counts.peak, preservedActors: [automatic.friendly, automatic.enemy], loggedWindows: loads.length, passed: true }));
    await context.close();
  }
} finally { await browser.close(); }
