import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cpus, totalmem, platform, release } from 'node:os';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = fraction => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { count: sorted.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1),
    over33ms: values.filter(value => value > 33.34).length, over50ms: values.filter(value => value > 50).length,
    over100ms: values.filter(value => value > 100).length };
}

export function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parents = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const aggregate = new Map();
  const key = node => `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url || '(native)'}:${node.callFrame.lineNumber + 1}`;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    let id = profile.samples[i], leaf = true;
    const duration = (profile.timeDeltas?.[i] || 0) / 1000, visited = new Set();
    while (id !== undefined) {
      const node = nodes.get(id);
      if (!node) break;
      const name = key(node);
      if (!visited.has(name)) {
        visited.add(name);
        const entry = aggregate.get(name) || { name, selfMs: 0, inclusiveMs: 0 };
        entry.inclusiveMs += duration;
        if (leaf) entry.selfMs += duration;
        aggregate.set(name, entry);
      }
      leaf = false; id = parents.get(id);
    }
  }
  return { sampledMs: (profile.timeDeltas || []).reduce((sum, delta) => sum + delta, 0) / 1000,
    self: [...aggregate.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 25),
    inclusive: [...aggregate.values()].sort((a, b) => b.inclusiveMs - a.inclusiveMs).slice(0, 25) };
}

const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  return value;
};

async function main() {
  const output = process.env.ARTIFACT_DIR;
  if (!output) throw new Error('Set ARTIFACT_DIR to a session artifact directory; raw profiles must be preserved');
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const sources = {};
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    if (name.endsWith('.js')) sources[`src/${name}`] = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  }
  for (const path of ['scripts/benchmark.mjs', 'package.json', 'vite.config.js']) sources[path] = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  await writeFile(join(directory, 'sources.json'), JSON.stringify(sources, null, 2));
  const repeats = integer('BENCH_REPEATS', 2, 1, 5), seconds = integer('BENCH_SECONDS', 18, 5, 60);
  const warmup = integer('BENCH_WARMUP', 3, 1, 15), seed = integer('BENCH_SEED', 1938, 0, 0xffffffff);
  const minimumTime = integer('BENCH_MIN_TIME', 0, 0, 180);
  const baselinePath = process.env.BENCH_BASELINE_POSE;
  const poseModules = ['src/nra-motion.js', 'src/entities.js', 'src/nra-force-renderer.js'];
  const baselineSources = baselinePath ? JSON.parse(await readFile(resolve(baselinePath), 'utf8')) : null;
  if (baselinePath) {
    for (const name of poseModules) assert.equal(typeof baselineSources[name], 'string', `baseline snapshot must contain ${name}`);
    await writeFile(join(directory, 'baseline-pose-sources.json'), JSON.stringify(
      Object.fromEntries(poseModules.map(name => [name, baselineSources[name]])), null, 2));
  }
  const scenarios = (process.env.BENCH_SCENARIOS || 'duel,full').split(',');
  assert.ok(scenarios.every(scenario => ['duel', 'full'].includes(scenario)));
  const quality = process.env.BENCH_QUALITY || 'high';
  assert.ok(['high', 'low'].includes(quality));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const browserCDP = await browser.newBrowserCDPSession();
  const system = await browserCDP.send('SystemInfo.getInfo');
  const metadata = { recordedAt: new Date().toISOString(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    memoryGiB: totalmem() / 1024 ** 3, os: `${platform()} ${release()}`, browser: browser.version(), headless: true,
    gpu: system.gpu.devices, gpuFeatures: system.gpu.featureStatus,
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, quality, seed, warmupSeconds: warmup,
    sampleSeconds: seconds, minimumSimulationTime: minimumTime, cpuSampleIntervalUs: 1000, repeats,
    baselinePoseSource: baselinePath ? resolve(baselinePath) : null,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyFiles: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    limitation: 'Seed fixes random choices, not exact per-frame scheduling. Frame intervals include renderer/browser/OS work; CPU renderMs is submission, not GPU timing. Inclusive CPU entries overlap.' };
  await writeFile(join(directory, 'environment.json'), JSON.stringify(metadata, null, 2));
  const summaries = [];
  try {
    for (const scenario of scenarios) for (let repeat = 1; repeat <= repeats; repeat++)
      for (const variant of baselineSources ? repeat % 2 ? ['baseline', 'current'] : ['current', 'baseline'] : ['current']) {
      const context = await browser.newContext({ viewport: metadata.viewport, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [], events = [];
      const poseRequests = new Set();
      if (baselineSources) await page.route(/\/src\/(?:nra-motion|entities|nra-force-renderer)\.js(?:\?|$)/, async route => {
        const response = await route.fetch(), current = await response.text();
        const name = new URL(route.request().url()).pathname.slice(1), original = baselineSources[name];
        const three = current.match(/from\s+["']([^"']*\/three\.js[^"']*)["']/)?.[1];
        if (original.includes("from 'three'")) assert.ok(three, 'Vite must resolve the shared Three.js module for both variants');
        poseRequests.add(name);
        await route.fulfill({ response, body: variant === 'baseline'
          ? original.replace("from 'three'", `from '${three}'`) : current });
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const cdp = await context.newCDPSession(page);
      const name = `${scenario}-${repeat}${baselineSources ? `-${variant}` : ''}`;
      let profileStarted = false;
      try {
        const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
        url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', String(seed));
        await page.goto(url.href);
        await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000, polling: 250 });
        await page.locator('#deploy').waitFor({ state: 'visible', timeout: 90000 });
        assert.equal(await page.evaluate(() => window.__battle.benchmark?.scenario), scenario, 'benchmarks must not silently run against a production build without overrides');
        if (baselineSources) assert.ok(poseModules.every(name => poseRequests.has(name)), 'paired run must load all three selected pose modules');
        await page.locator('#menu-quality').selectOption(quality);
        await page.locator('#deploy').click();
        const initial = await page.evaluate(() => {
          const data = window.__battle;
          return { population: data.population, spawnEvents: data.spawnEvents, graphics: data.graphics, time: data.time, position: data.position };
        });
        assert.equal(initial.population.friendly.alive, scenario === 'duel' ? 5 : 110);
        assert.equal(initial.population.enemy.alive, scenario === 'duel' ? 5 : 110);
        await page.waitForTimeout(warmup * 1000);
        if (scenario === 'full') {
          events.push({ input: 'KeyW down; straight route from registered base to z<=42', wall: Date.now() });
          await page.keyboard.down('w');
          await page.waitForFunction(() => {
            const data = window.__battle;
            return data.position.z <= 42 || data.state === 'dead';
          }, null, { timeout: 60000, polling: 100 });
          await page.keyboard.up('w');
          events.push({ input: 'KeyW up', observed: await page.evaluate(() => ({ time: window.__battle.time, position: window.__battle.position, state: window.__battle.state })) });
        } else events.push({ input: 'hold registered 5v5 position; autonomous combat', wall: Date.now() });
        await page.waitForFunction(() => window.__battle.combatStats.aiRifleShots > 0, null, { timeout: 90000, polling: 500 });
        if (minimumTime) await page.waitForFunction(minimum => window.__battle.time >= minimum, minimumTime, { timeout: 180000, polling: 1000 });
        const sampleStart = await page.evaluate(() => ({ now: performance.now(), time: window.__battle.time, clock: window.__battle.simulationClock, shots: window.__battle.combatStats.aiRifleShots,
          corpses: window.__battle.corpses.count, serial: window.__battleTelemetry.totalFrames }));
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
        await cdp.send('Profiler.start'); profileStarted = true;
        await page.waitForTimeout(seconds * 1000);
        const { profile } = await cdp.send('Profiler.stop'); profileStarted = false;
        const result = await page.evaluate(() => ({ now: performance.now(), frames: window.__battleTelemetry.frames,
          final: { time: window.__battle.time, state: window.__battle.state, combat: window.__battle.combatStats, population: window.__battle.population,
            corpses: window.__battle.corpses, position: window.__battle.position, graphics: window.__battle.graphics, simulationClock: window.__battle.simulationClock } }));
        const frames = result.frames.filter(frame => frame.serial > sampleStart.serial && frame.now <= result.now);
        assert.ok(frames.length >= 60, 'raw sample needs enough active/deployment frames, not a menu/paused scene');
        assert.equal(result.frames.some(frame => frame.serial === sampleStart.serial + 1), true, 'raw frame buffer did not overwrite the sample');
        const metrics = Object.fromEntries(['intervalMs', 'cpuMs', 'aiMs', 'pathMs', 'coverMs', 'sensingMs', 'playerMs', 'doorsMs', 'effectsMs', 'hudMs', 'instancesMs', 'renderMs'].map(key => [key, distribution(frames.map(frame => frame[key]))]));
        const summary = { name, scenario, repeat, variant, sampleWallSeconds: (result.now - sampleStart.now) / 1000,
          corpsesBefore: sampleStart.corpses, corpsesAfter: result.final.corpses.count,
          simulatedSeconds: result.final.time - sampleStart.time, simulatedWallRatio: (result.final.time - sampleStart.time) / ((result.now - sampleStart.now) / 1000),
          shotsBefore: sampleStart.shots, shotsAfter: result.final.combat.aiRifleShots,
          initialAlive: { friendly: initial.population.friendly.alive, enemy: initial.population.enemy.alive },
          finalAlive: { friendly: result.final.population.friendly.alive, enemy: result.final.population.enemy.alive },
          metrics, maxQueuedPaths: Math.max(...frames.map(frame => frame.queuedPaths)),
          maxPathWaitSeconds: Math.max(...frames.map(frame => frame.oldestPathWaitSeconds)),
          initialGenerations: initial.population.units.map(unit => unit.generation),
          finalGenerations: result.final.population.units.map(unit => unit.generation),
          peakDrawCalls: Math.max(...frames.map(frame => frame.drawCalls)), peakTriangles: Math.max(...frames.map(frame => frame.triangles)),
          clock: { start: sampleStart.clock, end: result.final.simulationClock,
            maxBacklogSeconds: Math.max(...frames.map(frame => frame.simulationBacklogSeconds)),
            maxStepsPerFrame: Math.max(...frames.map(frame => frame.simulationSteps)),
            maxConservationErrorSeconds: Math.max(...frames.map(frame =>
              Math.abs(frame.activeSeconds - frame.simulationTime - frame.simulationBacklogSeconds))) },
          finalState: result.final.state, errors, cpu: summarizeProfile(profile) };
        await writeFile(join(directory, `${name}.cpuprofile`), JSON.stringify(profile));
        await writeFile(join(directory, `${name}-frames.json`), JSON.stringify({ seed, initial, sampleStart, events, frames, final: result.final }, null, 2));
        await writeFile(join(directory, `${name}-summary.json`), JSON.stringify(summary, null, 2));
        await page.screenshot({ path: join(directory, `${name}.png`) });
        summaries.push(summary);
        assert.equal(errors.length, 0, errors.join('\n'));
        assert.ok(summary.clock.maxStepsPerFrame <= result.final.simulationClock.limits.maxStepsPerFrame);
        assert.ok(summary.clock.maxConservationErrorSeconds < 1e-7, 'active world time must be simulated or retained as debt');
        assert.ok(summary.shotsAfter > summary.shotsBefore, 'the sampled interval must contain actual autonomous firing');
        console.log(`${name}: frames=${frames.length}, P50/P95/P99=${metrics.intervalMs.p50.toFixed(1)}/${metrics.intervalMs.p95.toFixed(1)}/${metrics.intervalMs.p99.toFixed(1)}ms, >50ms=${metrics.intervalMs.over50ms}, AI mean=${metrics.aiMs.mean.toFixed(2)}ms, sim/wall=${summary.simulatedWallRatio.toFixed(3)}, shots=${summary.shotsAfter - summary.shotsBefore}`);
      } catch (error) {
        if (profileStarted) {
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(join(directory, `${name}-failed.cpuprofile`), JSON.stringify(profile));
        }
        const state = await page.evaluate(() => {
          const data = window.__battle;
          return data ? { state: data.state, time: data.time, population: data.population, combat: data.combatStats,
            simulationClock: data.simulationClock, telemetry: window.__battleTelemetry } : null;
        });
        await writeFile(join(directory, `${name}-error.json`), JSON.stringify({ error: error.message, state, events, errors }, null, 2));
        throw error;
      } finally { await context.close(); }
    }
    await writeFile(join(directory, 'summary.json'), JSON.stringify({ metadata, runs: summaries }, null, 2));
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
