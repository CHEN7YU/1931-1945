import { setQualityPreset } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { booleanOption, distribution } from './benchmark.mjs';
import { installFrameObserver, sampleBattleWindow, activeWindowStatus } from './benchmark-window.mjs';
import { installRenderTimingProbe, renderTimingWindow } from './render-timing-probe.mjs';

async function main() {
  if (!process.env.ARTIFACT_DIR) throw new Error('Set ARTIFACT_DIR; production timing must preserve raw evidence');
  const directory = resolve(process.env.ARTIFACT_DIR);
  await mkdir(directory, { recursive: false });
  const repeats = Number(process.env.BENCH_REPEATS ?? 3), seconds = Number(process.env.BENCH_SECONDS ?? 90);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5 ||
    !Number.isInteger(seconds) || seconds < 5 || seconds > 180) throw new RangeError('Invalid repeats or duration');
  const mode = process.env.BENCH_GPU_MODE ?? 'gpu';
  if (!['gpu', 'cpu', 'compare'].includes(mode)) throw new RangeError('BENCH_GPU_MODE must be gpu, cpu or compare');
  const headless = booleanOption('BENCH_HEADLESS', process.env.BENCH_HEADLESS, false);
  const builtSources = {}, harnessSources = {};
  for (const name of await readdir('dist\\assets')) {
    if (name.endsWith('.js')) builtSources[name] = await readFile(join('dist', 'assets', name), 'utf8');
  }
  for (const name of ['production-render-benchmark.mjs', 'render-timing-probe.mjs', 'benchmark-window.mjs']) {
    harnessSources[name] = await readFile(new URL(name, import.meta.url), 'utf8');
  }
  await writeFile(join(directory, 'sources.json'), JSON.stringify({ builtSources, harnessSources }));
  const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const metadata = { recordedAt: new Date().toISOString(), production: true, headless,
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, quality: 'high',
    seed: null, repeats, seconds, settleSeconds: 5, minimumSimulationTime: 25, mode, cpuProfiler: false,
    limitation: 'Fresh Chrome per run. Ordinary production URL, no seed or population overrides. Independent rAF observer, not game tick CPU telemetry. Natural combat states differ; not deterministic replay. GPU elapsed is not pure busy time and overlaps CPU.' };
  const runs = [];
  try {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      for (const variant of mode === 'compare' ? repeat % 2 ? ['cpu', 'gpu'] : ['gpu', 'cpu'] : [mode]) {
        const name = `production-${repeat}-${variant}`;
        const browser = await chromium.launch({ channel: 'chrome', headless });
        const page = await browser.newPage({ viewport: metadata.viewport, deviceScaleFactor: 1 }), errors = [];
        let stage = 'loading';
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        try {
          metadata.browser = browser.version();
          const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
          metadata.gpuDevices = system.gpu.devices;
          await page.addInitScript(installRenderTimingProbe, { gpu: variant === 'gpu' });
          await page.goto(`http://127.0.0.1:${address.port}/`);
          await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000, polling: 250 });
          await page.locator('#deploy').waitFor({ state: 'visible', timeout: 90000 });
          const setup = await page.evaluate(() => {
            const data = window.__battle;
            return { development: data.build.development, benchmark: data.benchmark,
              hasGameTelemetry: Boolean(window.__battleTelemetry), probe: window.__renderTimingProbe };
          });
          assert.equal(setup.development, false);
          assert.equal(setup.benchmark, null);
          assert.equal(setup.hasGameTelemetry, false);
          assert.equal(setup.probe.attached, true);
          await setQualityPreset(page, 'high');
          await page.locator('#deploy').click();
          const initial = await page.evaluate(() => {
            const data = window.__battle;
            return { population: data.population, graphics: data.graphics, build: data.build };
          });
          assert.equal(initial.population.friendly.alive, 110);
          assert.equal(initial.population.enemy.alive, 98);
          stage = 'walking';
          await page.waitForTimeout(3000);
          await page.keyboard.down('w');
          await page.waitForFunction(() => {
            const data = window.__battle;
            return data.position.z <= 42 || data.state === 'dead';
          }, null, { timeout: 60000, polling: 100 });
          await page.keyboard.up('w');
          await page.waitForFunction(() => {
            const data = window.__battle;
            return data.time >= 25 && data.combatStats.aiRifleShots > 0;
          }, null, { timeout: 180000, polling: 1000 });
          await page.evaluate(() => {
            window.__reviewVisibility = [];
            document.addEventListener('visibilitychange', () => window.__reviewVisibility.push({
              now: performance.now(), state: document.visibilityState,
            }));
          });
          await page.evaluate(installFrameObserver);
          stage = 'sampling';
          const result = await page.evaluate(sampleBattleWindow, { seconds, settleSeconds: 5 });
          const frames = result.frames.filter(frame => frame.serial > result.sampleStart.serial && frame.now <= result.now);
          const raw = { initial, ...result, frames };
          await writeFile(join(directory, `${name}-frames.json`), JSON.stringify(raw, null, 2));
          stage = 'resolving';
          await page.waitForTimeout(1000);
          const resolvedRenderTiming = await page.evaluate(() => window.__renderTimingProbe);
          const visibility = await page.evaluate(() => ({ state: document.visibilityState, changes: window.__reviewVisibility }));
          const timing = renderTimingWindow(result.sampleStart.renderTimingProbe, result.final.renderTimingProbe, resolvedRenderTiming);
          timing.cpu = distribution(timing.events.map(event => event.cpuMs));
          timing.gpu = distribution(timing.events.filter(event => event.gpuStatus === 'valid').map(event => event.gpuMs));
          timing.probeOverhead = distribution(timing.events.map(event => event.probeOverheadMs));
          const summary = { name, repeat, variant, initial, boundaries: result.boundaries, visibility,
            activeWindow: activeWindowStatus(result.sampleStart, result),
            frameIntervals: distribution(frames.map(frame => frame.intervalMs)), renderTiming: timing,
            simulatedWallRatio: (result.final.time - result.sampleStart.time) / ((result.now - result.sampleStart.now) / 1000),
            debtGrowth: result.final.simulationClock.pendingSeconds - result.sampleStart.clock.pendingSeconds,
            shots: result.final.combat.aiRifleShots - result.sampleStart.shots,
            clock: { start: result.sampleStart.clock, end: result.final.simulationClock }, errors };
          await writeFile(join(directory, `${name}-frames.json`), JSON.stringify({ ...raw, resolvedRenderTiming, visibility }, null, 2));
          await writeFile(join(directory, `${name}-summary.json`), JSON.stringify(summary, null, 2));
          runs.push(summary);
          await writeFile(join(directory, 'summary.json'), JSON.stringify({ metadata, runs }, null, 2));
          assert.ok(summary.activeWindow.valid, 'paused or interrupted production windows must not count as complete battles');
          assert.ok(frames.length >= 60, 'preserve failures instead of accepting an undersized sample');
          assert.ok(summary.shots > 0);
          assert.equal(visibility.state, 'visible');
          assert.equal(visibility.changes.length, 0);
          assert.deepEqual(errors, []);
          for (const clock of [summary.clock.start, summary.clock.end]) {
            assert.ok(Math.abs(clock.activeSeconds - clock.simulatedSeconds - clock.pendingSeconds) < 1e-7);
          }
          await page.screenshot({ path: join(directory, `${name}.png`) });
          console.log(JSON.stringify({ name, frames: frames.length, p50: summary.frameIntervals.p50,
            p95: summary.frameIntervals.p95, p99: summary.frameIntervals.p99,
            gpuP50: timing.gpu?.p50 ?? null, gpuStatus: timing.status, gpuSamples: timing.validGpuSamples,
            renderCpuP50: timing.cpu?.p50 ?? null, probeP95: timing.probeOverhead?.p95 ?? null,
            ratio: summary.simulatedWallRatio, debt: summary.debtGrowth, shots: summary.shots }));
          await page.evaluate(() => window.__stopRenderTimingProbe());
        } catch (error) {
          await writeFile(join(directory, `${name}-error.json`), JSON.stringify({ stage, error: error.message, errors }, null, 2));
          throw error;
        } finally { await browser.close(); }
      }
    }
  } finally { await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
