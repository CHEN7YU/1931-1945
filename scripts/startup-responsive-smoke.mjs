import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { validatePerformanceBatch } from '../src/performance-schema.js';

const base = process.env.GAME_URL ?? 'http://127.0.0.1:5328/';
const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'startup-responsive');
const rate = Number(process.env.CPU_THROTTLE ?? 6);
const identityDelayMs = Number(process.env.STARTUP_IDENTITY_DELAY_MS ?? 0);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  for (const map of (process.env.STARTUP_MAPS ?? 'nanjing,taierzhuang-fort').split(',')) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage(), errors = [], batches = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.text().startsWith('STARTUP ')) console.log(`${map}: ${message.text()}`);
    });
    await page.route('**/api/performance', async route => {
      const batch = route.request().postDataJSON();
      const invalid = validatePerformanceBatch(batch);
      if (invalid) errors.push(invalid);
      batches.push(batch);
      await route.fulfill({ status: invalid ? 400 : 201, contentType: 'application/json',
        body: JSON.stringify(invalid ? { error: invalid } : { id: batch.id, saved: true }) });
    });
    await page.addInitScript(() => {
      const probe = window.__startupProbe = { progress: [], gaps: [], longTasks: [], ticks: 0, timings: {} };
      document.addEventListener('click', event => {
        if (event.target.closest('#confirm-deploy')) probe.timings.deployRequestedMs = performance.now();
      }, true);
      let previous = performance.now(), percent = -1;
      const interval = setInterval(() => {
        const now = performance.now(), next = Number.parseInt(document.getElementById('loading-percentage')?.textContent);
        const step = document.getElementById('overlay')?.dataset.deploymentStep;
        if (step === 'squad' && window.__battle?.state === 'menu' && document.getElementById('loading').hidden)
          probe.timings.squadMenuMs ??= now;
        if (Number.isFinite(next) && next !== percent) {
          percent = next; probe.progress.push({ percent, time: now,
            message: document.getElementById('loading-message')?.textContent });
          console.log(`STARTUP ${percent}% ${Math.round(now)}ms`);
        }
        probe.gaps.push({ ms: now - previous, percent }); probe.ticks++; previous = now;
      }, 16);
      const observer = new PerformanceObserver(list => {
        probe.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration })));
      });
      observer.observe({ type: 'longtask', buffered: true });
      probe.stop = () => { clearInterval(interval); observer.disconnect(); };
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const url = new URL(base);
    url.searchParams.delete('campaign'); url.searchParams.set('diagnostics', '1');
    const navigationStart = Date.now();
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
    const confirmCampaign = page.locator('#confirm-campaign');
    await confirmCampaign.waitFor({ state: 'visible' });
    const entryMenuMs = Date.now() - navigationStart;
    await page.locator('#campaign-choice').selectOption(map);
    const campaignRequestedAt = Date.now();
    await confirmCampaign.click();
    await page.locator('#confirm-identity').waitFor({ state: 'visible', timeout: 600000 });
    const identityReadyMs = Date.now() - campaignRequestedAt;
    await page.waitForTimeout(identityDelayMs);
    const identityConfirmedAt = Date.now();
    await page.locator('#confirm-identity').click({ timeout: 600000 });
    await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad' ||
      !document.getElementById('fatal').hidden, null, { timeout: 600000 });
    assert.equal(await page.locator('#fatal').isVisible(), false);
    await page.waitForFunction(() => window.__battle?.state === 'menu' && document.getElementById('loading').hidden,
      null, { timeout: 600000 });
    const result = await page.evaluate(() => {
      const probe = window.__startupProbe;
      probe.timings.squadMenuMs ??= performance.now();
      const poseGaps = probe.gaps.filter(item => item.percent >= 62 && item.percent <= 78 ||
        item.percent >= 81 && item.percent <= 89);
      return { squadMenuAt: performance.timeOrigin + probe.timings.squadMenuMs,
        progress: [...probe.progress], ticks: probe.ticks,
        maximumGapMs: Math.max(...probe.gaps.map(item => item.ms)),
        maximumPoseGapMs: Math.max(0, ...poseGaps.map(item => item.ms)),
        longTasks: probe.longTasks,
        friendly: window.__battle.historicalForce, enemy: window.__battle.enemyHistoricalForce };
    });
    await writeFile(join(directory, `${map}-initialization.json`), JSON.stringify(result, null, 2));
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(11000);
    assert.equal(result.friendly.poolSize, 6);
    assert.equal(result.enemy.poolSize, 6);
    assert.ok(result.friendly.poseBanks > 40 && result.enemy.poseBanks > 40, 'both complete native pose banks must remain');
    assert.ok(result.progress.some(item => item.percent > 62 && item.percent < 78), 'friendly progress reflects completed banks');
    assert.ok(result.progress.some(item => item.percent > 81 && item.percent < 89), 'enemy progress reflects completed banks');
    assert.ok(result.ticks > 30, 'browser tasks must continue throughout initialization');
    const stages = batches.flatMap(batch => batch.windows.filter(window => window.context.state === 'loading')
      .map(window => window.context.stage));
    assert.ok(stages.includes('friendly-poses') && stages.includes('enemy-poses') && stages.includes('ready'),
      'startup diagnostics must upload without ever starting a battle');
    assert.ok(batches.every(batch => batch.windows.every(window => window.frames === 0)));
    await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 30000 });
    const timings = await page.evaluate(() => {
      const probe = window.__startupProbe;
      probe.stop();
      return { deployMs: performance.now() - probe.timings.deployRequestedMs };
    });
    Object.assign(timings, { entryMenuMs, identityReadyMs, identityDelayMs,
      identityToSquadMenuMs: result.squadMenuAt - identityConfirmedAt,
      campaignToSquadMenuMs: result.squadMenuAt - campaignRequestedAt });
    assert.ok(timings.campaignToSquadMenuMs > 0 && timings.deployMs >= 0);
    if (map === 'nanjing') {
      assert.equal(await page.evaluate(() => window.__battle.population.enemy.alive), 0,
        'Nanjing attackers remain in reserve until the opening delay');
      await page.waitForFunction(() => window.__battle.campaign.openingAssaultReleased &&
        window.__battle.population.enemy.alive > 40, null, { timeout: 360000 });
    }
    const population = await page.evaluate(() => ({ friendly: window.__battle.population.friendly.alive,
      enemy: window.__battle.population.enemy.alive,
      assigned: window.__battle.historicalForce.assigned, enemyAssigned: window.__battle.enemyHistoricalForce.assigned }));
    console.log(JSON.stringify({ map, timings, population }));
    assert.equal(population.assigned, population.friendly);
    assert.equal(population.enemyAssigned, population.enemy);
    assert.ok(population.friendly > 20 && population.enemy > 40);
    assert.deepEqual(errors, []);
    results.push({ map, rate, timings, ...result, stages, population });
    await writeFile(join(directory, 'startup.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ map, rate, timings, maximumGapMs: result.maximumGapMs,
      maximumPoseGapMs: result.maximumPoseGapMs, ticks: result.ticks,
      poseBanks: [result.friendly.poseBanks, result.enemy.poseBanks], population }));
    assert.ok(result.maximumPoseGapMs < 1000, `pose work must remain responsive: ${result.maximumPoseGapMs}ms`);
    await context.close();
  }
} finally {
  await browser.close();
}
