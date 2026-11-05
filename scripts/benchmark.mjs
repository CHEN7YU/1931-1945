import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cpus, totalmem, platform, release } from 'node:os';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { queryDiagnosticsDelta } from '../src/query-diagnostics.js';
import { installDriverProbe, driverProbeWindow } from './driver-probe.mjs';
import { sampleBattleWindow, activeWindowStatus } from './benchmark-window.mjs';
import { installRenderTimingProbe, renderTimingWindow } from './render-timing-probe.mjs';
import { installRenderPassTimingProbe, renderPassTimingWindow } from './render-pass-timing-probe.mjs';
import { installRenderWorkProbe, renderWorkWindow } from './render-work-probe.mjs';

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

export function baselineModuleSource(original, transformed) {
  if (original.includes('import.meta.env.')) {
    const environment = transformed.match(/^import\.meta\.env\s*=\s*\{[^\n]*\};/m)?.[0];
    assert.ok(environment, 'Vite must provide the development environment for baseline modules');
    original = `${environment}\n${original}`;
  }
  for (const [specifier, pattern] of [
    ['three', /from\s+["']([^"']*\/three\.js[^"']*)["']/],
    ['three/addons/utils/BufferGeometryUtils.js', /from\s+["']([^"']*BufferGeometryUtils[^"']*)["']/],
    ['meshoptimizer/simplifier', /from\s+["']([^"']*meshoptimizer_simplifier[^"']*)["']/],
  ]) {
    if (!original.includes(`from '${specifier}'`)) continue;
    const resolved = transformed.match(pattern)?.[1];
    assert.ok(resolved, `Vite must resolve ${specifier} identically for both variants`);
    original = original.replaceAll(`from '${specifier}'`, `from '${resolved}'`);
  }
  return original;
}

export function baselineModulePattern(modules) {
  return new RegExp(`/(?:${modules.map(name => name.replaceAll('.', '\\.')).join('|')})(?:\\?|$)`);
}

const integer = (name, fallback, min, max) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
  return value;
};

export function booleanOption(name, value, fallback) {
  if (value === undefined) return fallback;
  if (value !== '0' && value !== '1') throw new RangeError(`${name} must be 0 or 1`);
  return value === '1';
}

export function collisionKernelBaseline(current, legacy) {
  const start = 'export function circleBlocked(', end = '\nexport function moveGround(';
  const from = current.indexOf(start), to = current.indexOf(end, from), replacement = legacy.indexOf(start);
  assert.ok(from >= 0 && to > from && replacement >= 0, 'collision comparison must replace only the circle kernel');
  return current.slice(0, from) + legacy.slice(replacement).trimEnd() + '\n' + current.slice(to);
}

async function main() {
  const output = process.env.ARTIFACT_DIR;
  if (!output) throw new Error('Set ARTIFACT_DIR to a session artifact directory; raw profiles must be preserved');
  const directory = resolve(output);
  await mkdir(directory, { recursive: true });
  const sources = {};
  for (const name of await readdir(new URL('../src/', import.meta.url))) {
    if (name.endsWith('.js')) sources[`src/${name}`] = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
  }
  for (const path of ['scripts/benchmark.mjs', 'scripts/benchmark-window.mjs', 'scripts/driver-probe.mjs', 'scripts/render-timing-probe.mjs',
    'scripts/render-pass-timing-probe.mjs', 'scripts/render-work-probe.mjs', 'package.json', 'vite.config.js']) sources[path] = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  await writeFile(join(directory, 'sources.json'), JSON.stringify(sources, null, 2));
  const repeats = integer('BENCH_REPEATS', 2, 1, 5), seconds = integer('BENCH_SECONDS', 18, 5, 180);
  const settleSeconds = integer('BENCH_SETTLE_SECONDS', 5, 1, 30);
  const cpuProfile = booleanOption('BENCH_CPU_PROFILE', process.env.BENCH_CPU_PROFILE, true);
  const profileComparison = booleanOption('BENCH_COMPARE_PROFILE', process.env.BENCH_COMPARE_PROFILE, false);
  const headless = booleanOption('BENCH_HEADLESS', process.env.BENCH_HEADLESS, true);
  const kernelComparison = booleanOption('BENCH_COMPARE_CIRCLE_KERNEL', process.env.BENCH_COMPARE_CIRCLE_KERNEL, false);
  const gpuTimer = booleanOption('BENCH_GPU_TIMER', process.env.BENCH_GPU_TIMER, false);
  const gpuPassTimer = booleanOption('BENCH_GPU_PASS_TIMER', process.env.BENCH_GPU_PASS_TIMER, false);
  const gpuComparison = booleanOption('BENCH_COMPARE_GPU', process.env.BENCH_COMPARE_GPU, false);
  const backbufferComparison = booleanOption('BENCH_COMPARE_BACKBUFFER', process.env.BENCH_COMPARE_BACKBUFFER, false);
  const passCapture = booleanOption('BENCH_PASS_CAPTURE', process.env.BENCH_PASS_CAPTURE, false);
  if ((gpuTimer || gpuComparison) && cpuProfile) throw new Error('GPU diagnosis must set BENCH_CPU_PROFILE=0');
  if (gpuPassTimer && cpuProfile) throw new Error('GPU pass attribution must set BENCH_CPU_PROFILE=0');
  if ((backbufferComparison || passCapture) && cpuProfile) throw new Error('Render work diagnosis must set BENCH_CPU_PROFILE=0');
  const warmup = integer('BENCH_WARMUP', 3, 1, 15), seed = integer('BENCH_SEED', 1938, 0, 0xffffffff);
  const minimumTime = integer('BENCH_MIN_TIME', 0, 0, 180);
  if ([process.env.BENCH_BASELINE_ATLAS, process.env.BENCH_BASELINE_POSE, process.env.BENCH_BASELINE_COLLISION, process.env.BENCH_BASELINE_QUERY,
    process.env.BENCH_BASELINE_MOVEMENT, process.env.BENCH_COMPARE_AI, process.env.BENCH_BASELINE_RENDERER, process.env.BENCH_BASELINE_WORLD,
    process.env.BENCH_COMPARE_QUERY_STATS, process.env.BENCH_COMPARE_MOVEMENT_CACHE,
    process.env.BENCH_COMPARE_RENDER_SPLIT, process.env.BENCH_COMPARE_TRACERS,
    process.env.BENCH_BASELINE_HEAD_AIM, process.env.BENCH_BASELINE_FULL, process.env.BENCH_BASELINE_SPATIAL,
    profileComparison, kernelComparison, gpuComparison, backbufferComparison, passCapture, gpuPassTimer].filter(Boolean).length > 1) {
    throw new Error('Choose one isolated baseline comparison');
  }
  const collisionComparison = Boolean(process.env.BENCH_BASELINE_COLLISION);
  const atlasComparison = Boolean(process.env.BENCH_BASELINE_ATLAS);
  const queryComparison = Boolean(process.env.BENCH_BASELINE_QUERY);
  const movementComparison = Boolean(process.env.BENCH_BASELINE_MOVEMENT);
  const aiComparison = process.env.BENCH_COMPARE_AI === '1';
  const rendererComparison = Boolean(process.env.BENCH_BASELINE_RENDERER);
  const worldComparison = Boolean(process.env.BENCH_BASELINE_WORLD);
  const headAimComparison = Boolean(process.env.BENCH_BASELINE_HEAD_AIM);
  const fullCandidateComparison = Boolean(process.env.BENCH_BASELINE_FULL);
  const spatialComparison = Boolean(process.env.BENCH_BASELINE_SPATIAL);
  const statsComparison = process.env.BENCH_COMPARE_QUERY_STATS === '1', queryStats = process.env.BENCH_QUERY_STATS === '1';
  const cacheComparison = process.env.BENCH_COMPARE_MOVEMENT_CACHE === '1';
  const renderSplit = process.env.BENCH_COMPARE_RENDER_SPLIT === '1';
  const tracerComparison = process.env.BENCH_COMPARE_TRACERS === '1';
  if (process.env.BENCH_COMPARE_TRACERS && !tracerComparison) throw new Error('BENCH_COMPARE_TRACERS must be 1');
  if (process.env.BENCH_COMPARE_RENDER_SPLIT && !renderSplit) throw new Error('BENCH_COMPARE_RENDER_SPLIT must be 1');
  if (renderSplit && queryStats) throw new Error('Run render isolation without query attribution overhead');
  const renderSplitAt = integer('BENCH_RENDER_SPLIT_AT', 25, 0, 180);
  const driverTrace = process.env.BENCH_TRACE_DRIVER === '1';
  if ((backbufferComparison || passCapture) && (queryStats || driverTrace)) throw new Error('Render work diagnosis excludes query and driver probes');
  if (gpuPassTimer && (gpuTimer || gpuComparison || backbufferComparison || passCapture || queryStats || driverTrace)) {
    throw new Error('GPU pass attribution must run without other GPU, render-work, query or driver probes');
  }
  if (gpuComparison && (gpuTimer || queryStats || driverTrace)) throw new Error('Compare GPU timer overhead separately without query/driver probes');
  if (profileComparison && gpuTimer) throw new Error('Compare profiler overhead without GPU queries');
  if (profileComparison && (queryStats || driverTrace)) throw new Error('Compare profiler overhead without query/driver probes');
  if (process.env.BENCH_TRACE_DRIVER && !driverTrace) throw new Error('BENCH_TRACE_DRIVER must be 1');
  if (process.env.BENCH_COMPARE_MOVEMENT_CACHE && !cacheComparison) throw new Error('BENCH_COMPARE_MOVEMENT_CACHE must be 1');
  if (process.env.BENCH_COMPARE_QUERY_STATS && !statsComparison) throw new Error('BENCH_COMPARE_QUERY_STATS must be 1');
  if (process.env.BENCH_QUERY_STATS && !queryStats) throw new Error('BENCH_QUERY_STATS must be 1');
  if (statsComparison && queryStats) throw new Error('Choose a diagnostic run or an off/on overhead comparison');
  if (process.env.BENCH_COMPARE_AI && !aiComparison) throw new Error('BENCH_COMPARE_AI must be 1');
  for (const [name, value] of [['BENCH_BASELINE_HEAD_AIM', process.env.BENCH_BASELINE_HEAD_AIM],
    ['BENCH_BASELINE_FULL', process.env.BENCH_BASELINE_FULL], ['BENCH_BASELINE_SPATIAL', process.env.BENCH_BASELINE_SPATIAL]]) {
    if (value && !value.toLowerCase().endsWith('.json')) throw new RangeError(`${name} must be a JSON source snapshot path`);
  }
  const baselinePath = process.env.BENCH_BASELINE_ATLAS || process.env.BENCH_BASELINE_RENDERER ||
    process.env.BENCH_BASELINE_WORLD || process.env.BENCH_BASELINE_HEAD_AIM || process.env.BENCH_BASELINE_FULL ||
    process.env.BENCH_BASELINE_SPATIAL || process.env.BENCH_BASELINE_MOVEMENT || process.env.BENCH_BASELINE_QUERY || process.env.BENCH_BASELINE_COLLISION || process.env.BENCH_BASELINE_POSE;
  const poseModules = atlasComparison ? ['src/nra-atlas.js'] : kernelComparison ? ['src/core.js'] : tracerComparison ? ['src/tracer-pool.js'] : cacheComparison ? ['src/movement-obstacles.js'] : rendererComparison ? ['src/nra-force-renderer.js'] : worldComparison ? ['src/battlefield.js'] : headAimComparison ? ['src/head-aim.js'] : fullCandidateComparison ? ['src/battlefield.js', 'src/distant-pose-lod.js', 'src/head-aim.js', 'src/nra-force-renderer.js'] : spatialComparison ? ['src/main.js'] : aiComparison ? ['src/ai-decisions.js'] : movementComparison ? ['src/core.js', 'src/infantry-spacing.js']
    : queryComparison ? ['src/occlusion-query.js'] : collisionComparison ? ['src/solid-index.js'] : ['src/nra-motion.js', 'src/entities.js', 'src/nra-force-renderer.js'];
  const baselineSources = kernelComparison
    ? { 'src/core.js': collisionKernelBaseline(sources['src/core.js'], await readFile(new URL('./fixtures/circle-blocked-legacy.js', import.meta.url), 'utf8')) }
    : tracerComparison
    ? { 'src/tracer-pool.js': await readFile(new URL('./fixtures/tracer-pool-legacy.js', import.meta.url), 'utf8') }
    : cacheComparison
    ? { 'src/movement-obstacles.js': await readFile(new URL('./fixtures/movement-obstacles-legacy.js', import.meta.url), 'utf8') }
    : aiComparison
    ? { 'src/ai-decisions.js': await readFile(new URL('./fixtures/ai-decisions-legacy.js', import.meta.url), 'utf8') }
    : baselinePath ? JSON.parse(await readFile(resolve(baselinePath), 'utf8')) : null;
  if (baselineSources) {
    for (const name of poseModules) assert.equal(typeof baselineSources[name], 'string', `baseline snapshot must contain ${name}`);
    await writeFile(join(directory, atlasComparison ? 'baseline-atlas-sources.json' : kernelComparison ? 'baseline-circle-kernel-sources.json' : tracerComparison ? 'baseline-tracer-sources.json' : cacheComparison ? 'baseline-movement-cache-sources.json' : rendererComparison ? 'baseline-renderer-sources.json' : worldComparison ? 'baseline-world-sources.json' : headAimComparison ? 'baseline-head-aim-sources.json' : fullCandidateComparison ? 'baseline-full-sources.json' : spatialComparison ? 'baseline-spatial-sources.json' : aiComparison ? 'baseline-ai-sources.json' : movementComparison ? 'baseline-movement-sources.json' : queryComparison ? 'baseline-query-sources.json' : collisionComparison ? 'baseline-collision-sources.json' : 'baseline-pose-sources.json'), JSON.stringify(
      Object.fromEntries(poseModules.map(name => [name, baselineSources[name]])), null, 2));
  }
  const scenarios = (process.env.BENCH_SCENARIOS || 'duel,full').split(',');
  assert.ok(scenarios.every(scenario => ['duel', 'full'].includes(scenario)));
  const quality = process.env.BENCH_QUALITY || 'high';
  assert.ok(['high', 'low'].includes(quality));
  const browser = await chromium.launch({ channel: 'chrome', headless });
  const browserCDP = await browser.newBrowserCDPSession();
  const system = await browserCDP.send('SystemInfo.getInfo');
  const metadata = { recordedAt: new Date().toISOString(), cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    memoryGiB: totalmem() / 1024 ** 3, os: `${platform()} ${release()}`, browser: browser.version(), headless,
    gpu: system.gpu.devices, gpuFeatures: system.gpu.featureStatus,
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, quality, seed, warmupSeconds: warmup,
    sampleSeconds: seconds, settleSeconds, minimumSimulationTime: minimumTime,
    cpuProfile, profileComparison, cpuSampleIntervalUs: cpuProfile || profileComparison ? 1000 : null, repeats,
    measurement: 'Page-local rAF boundaries after settling; profiler starts before settling and stops after capture. No raw long frames removed. CPU profiles include settling/tail and are not frame-window CPU totals. Development build, not production acceptance.',
    queryStats, statsComparison,
    renderSplit, renderSplitAt: renderSplit ? renderSplitAt : null,
    driverTrace, gpuTimer, gpuComparison, gpuPassTimer, backbufferComparison, passCapture,
    baselineCircleKernel: kernelComparison ? 'scripts/fixtures/circle-blocked-legacy.js: former closure/Array.some kernel only' : null,
    baselineTracers: tracerComparison ? 'scripts/fixtures/tracer-pool-legacy.js: former per-shot line construction and disposal' : null,
    baselineMovementCandidates: cacheComparison ? 'scripts/fixtures/movement-obstacles-legacy.js: former per-query candidate builder' : null,
    baselineAtlasSource: atlasComparison ? resolve(baselinePath) : null,
    baselinePoseSource: baselinePath && !atlasComparison && !rendererComparison && !worldComparison && !headAimComparison &&
      !fullCandidateComparison && !spatialComparison && !collisionComparison && !queryComparison && !movementComparison ? resolve(baselinePath) : null,
    baselineCollisionSource: baselinePath && collisionComparison ? resolve(baselinePath) : null,
    baselineQuerySource: baselinePath && queryComparison ? resolve(baselinePath) : null,
    baselineMovementSource: baselinePath && movementComparison ? resolve(baselinePath) : null,
    baselineAIDecisions: aiComparison ? 'scripts/fixtures/ai-decisions-legacy.js: former per-substep decision budgets' : null,
    baselineRendererSource: rendererComparison ? resolve(baselinePath) : null,
    baselineWorldSource: worldComparison ? resolve(baselinePath) : null,
    baselineHeadAimSource: headAimComparison ? resolve(baselinePath) : null,
    baselineFullSource: fullCandidateComparison ? resolve(baselinePath) : null,
    baselineSpatialSource: spatialComparison ? resolve(baselinePath) : null,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyFiles: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    limitation: 'Seed fixes random choices, not exact per-frame scheduling. Frame intervals include renderer/browser/OS work; CPU renderMs is submission, not GPU timing. Inclusive CPU entries overlap.' };
  await writeFile(join(directory, 'environment.json'), JSON.stringify(metadata, null, 2));
  const summaries = [];
  try {
    for (const scenario of scenarios) for (let repeat = 1; repeat <= repeats; repeat++)
      for (const variant of renderSplit ? repeat % 2 ? ['normal', 'no-shadows', 'no-characters', 'no-draw'] : ['no-draw', 'no-characters', 'no-shadows', 'normal']
        : profileComparison ? repeat % 2 ? ['profile-off', 'profile-on'] : ['profile-on', 'profile-off']
        : gpuComparison ? repeat % 2 ? ['cpu-timer', 'gpu-timer'] : ['gpu-timer', 'cpu-timer']
        : backbufferComparison ? repeat % 2 ? ['full-buffer', 'half-buffer'] : ['half-buffer', 'full-buffer']
        : statsComparison ? repeat % 2 ? ['stats-off', 'stats-on'] : ['stats-on', 'stats-off']
        : baselineSources ? repeat % 2 ? ['baseline', 'current'] : ['current', 'baseline'] : ['current']) {
      const isolationMode = variant === 'no-shadows' ? 'normal' : variant;
      const context = await browser.newContext({ viewport: metadata.viewport, deviceScaleFactor: 1 });
      const page = await context.newPage(), errors = [], events = [];
      if (driverTrace) await page.addInitScript(installDriverProbe);
      if (gpuTimer || gpuComparison) await page.addInitScript(installRenderTimingProbe, { gpu: gpuTimer || variant === 'gpu-timer' });
      if (gpuPassTimer) await page.addInitScript(installRenderPassTimingProbe, { sampleEvery: 16 });
      if (passCapture || backbufferComparison) await page.addInitScript(installRenderWorkProbe,
        { passes: passCapture, backbufferScale: variant === 'half-buffer' ? .5 : 1 });
      const poseRequests = new Set();
      if (baselineSources) await page.route(baselineModulePattern(poseModules), async route => {
        const response = await route.fetch(), current = await response.text();
        const name = new URL(route.request().url()).pathname.slice(1), original = baselineSources[name];
        poseRequests.add(name);
        await route.fulfill({ response, body: variant === 'baseline'
          ? baselineModuleSource(original, current) : current });
      });
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const cdp = await context.newCDPSession(page);
      const name = `${scenario}-${repeat}${baselineSources || statsComparison || renderSplit || profileComparison || gpuComparison || backbufferComparison ? `-${variant}` : ''}`;
      const profileEnabled = profileComparison ? variant === 'profile-on' : cpuProfile;
      let profileStarted = false;
      try {
        const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
        url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', String(seed));
        url.searchParams.delete('queryStats');
        url.searchParams.delete('renderIsolation'); url.searchParams.delete('renderIsolationAt');
        if (renderSplit) {
          url.searchParams.set('renderIsolation', isolationMode);
          url.searchParams.set('renderIsolationAt', String(renderSplitAt));
        }
        const statsEnabled = queryStats || variant === 'stats-on';
        if (statsEnabled) url.searchParams.set('queryStats', '1');
        const loadingStartedAt = performance.now();
        await page.goto(url.href);
        await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 120000, polling: 250 });
        if (driverTrace) await page.evaluate(async () => {
          const { Material } = await import('/node_modules/.vite/deps/three.js');
          window.__attachDriverMaterials(Material);
        });
        await page.locator('#deploy').waitFor({ state: 'visible', timeout: 90000 });
        const loadingWallSeconds = (performance.now() - loadingStartedAt) / 1000;
        console.log(`${name}: ready in ${loadingWallSeconds.toFixed(1)}s; starting battle`);
        assert.equal(await page.evaluate(() => window.__battle.benchmark?.scenario), scenario, 'benchmarks must not silently run against a production build without overrides');
        assert.equal(await page.evaluate(() => Boolean(window.__battle.queryDiagnostics)), statsEnabled, 'diagnostics must match the requested variant');
        assert.equal(await page.evaluate(() => Boolean(window.__driverProbe)), driverTrace);
        assert.equal(await page.evaluate(() => Boolean(window.__renderTimingProbe?.attached)), gpuTimer || gpuComparison);
        assert.equal(await page.evaluate(() => Boolean(window.__renderPassTimingProbe?.attached)), gpuPassTimer);
        assert.equal(await page.evaluate(() => Boolean(window.__renderWorkProbe?.attached)), passCapture || backbufferComparison);
        if (driverTrace) assert.equal(await page.evaluate(() => window.__driverProbe.materialAttached), true);
        if (renderSplit) assert.equal(await page.evaluate(() => window.__battle.benchmark.renderIsolation), isolationMode);
        if (baselineSources) assert.ok(poseModules.every(name => poseRequests.has(name)), 'paired run must load every selected baseline module');
        await page.locator('#menu-quality').selectOption(quality);
        if (variant === 'no-shadows') await page.evaluate(() => {
          const toggle = document.querySelector('[data-quality-effect="shadows"]');
          if (!toggle) throw new Error('Shadow isolation requires the existing graphics control');
          toggle.checked = false;
          toggle.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await page.locator('#deploy').click();
        const initial = await page.evaluate(() => {
          const data = window.__battle;
          return { population: data.population, spawnEvents: data.spawnEvents, graphics: data.graphics, time: data.time, position: data.position,
            collisionAcceleration: data.collisionAcceleration ?? null, shaderPrograms: data.shaderPrograms };
        });
        assert.equal(initial.population.friendly.alive, scenario === 'duel' ? 5 : 110);
        assert.equal(initial.population.enemy.alive, scenario === 'duel' ? 5 : 98);
        if (renderSplit) assert.equal(initial.graphics.shadowsEnabled, variant !== 'no-shadows');
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
        const sampleAfter = Math.max(minimumTime, renderSplit ? renderSplitAt : 0);
        if (sampleAfter) await page.waitForFunction(minimum => window.__battle.time >= minimum, sampleAfter, { timeout: 180000, polling: 1000 });
        if (renderSplit) await page.waitForFunction(mode => window.__battle.renderIsolation.mode === mode, isolationMode, { timeout: 30000 });
        let profile = null;
        if (profileEnabled) {
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
          await cdp.send('Profiler.start'); profileStarted = true;
        }
        const result = await page.evaluate(sampleBattleWindow, { seconds, settleSeconds });
        const { sampleStart } = result;
        if (gpuTimer || gpuComparison || gpuPassTimer) await page.waitForTimeout(1000);
        const resolvedRenderTiming = gpuTimer || gpuComparison ? await page.evaluate(() => window.__renderTimingProbe) : null;
        const resolvedRenderPassTiming = gpuPassTimer ? await page.evaluate(() => window.__renderPassTimingProbe) : null;
        if (profileEnabled) {
          ({ profile } = await cdp.send('Profiler.stop')); profileStarted = false;
          await writeFile(join(directory, `${name}.cpuprofile`), JSON.stringify(profile));
        }
        const frames = result.frames.filter(frame => frame.serial > sampleStart.serial && frame.now <= result.now);
        assert.ok(frames.length >= 60, 'raw sample needs enough active/deployment frames, not a menu/paused scene');
        assert.equal(result.frames.some(frame => frame.serial === sampleStart.serial + 1), true, 'raw frame buffer did not overwrite the sample');
        const metrics = Object.fromEntries(['intervalMs', 'callbackQueueDelayMs', 'callbackMs', 'cpuMs', 'aiMs', 'pathMs', 'coverMs', 'sensingMs', 'playerMs', 'doorsMs', 'effectsMs', 'hudMs', 'instancesMs', 'renderMs'].map(key => [key, distribution(frames.map(frame => frame[key]))]));
        const summary = { name, scenario, repeat, variant, loadingWallSeconds, sampleWallSeconds: (result.now - sampleStart.now) / 1000,
          cpuProfile: profileEnabled, boundaries: result.boundaries, activeWindow: activeWindowStatus(sampleStart, result),
          corpsesBefore: sampleStart.corpses, corpsesAfter: result.final.corpses.count,
          simulatedSeconds: result.final.time - sampleStart.time, simulatedWallRatio: (result.final.time - sampleStart.time) / ((result.now - sampleStart.now) / 1000),
          shotsBefore: sampleStart.shots, shotsAfter: result.final.combat.aiRifleShots,
          initialAlive: { friendly: initial.population.friendly.alive, enemy: initial.population.enemy.alive },
          finalAlive: { friendly: result.final.population.friendly.alive, enemy: result.final.population.enemy.alive },
          collisionAcceleration: result.final.collisionAcceleration,
          aiDecisions: result.final.aiDecisions,
          renderIsolation: { start: sampleStart.renderIsolation, end: result.final.renderIsolation },
          characterRendering: { start: sampleStart.characterRendering, end: result.final.characterRendering },
          tracers: { start: sampleStart.tracers, end: result.final.tracers },
          driverProbe: driverProbeWindow(sampleStart.driverProbe, result.final.driverProbe, frames),
          renderTiming: renderTimingWindow(sampleStart.renderTimingProbe, result.final.renderTimingProbe, resolvedRenderTiming, frames),
          renderPassTiming: renderPassTimingWindow(sampleStart.renderPassTimingProbe, result.final.renderPassTimingProbe,
            resolvedRenderPassTiming, frames),
          renderWork: renderWorkWindow(sampleStart.renderWorkProbe, result.final.renderWorkProbe),
          queryDiagnostics: queryDiagnosticsDelta(sampleStart.queryDiagnostics, result.final.queryDiagnostics),
          shaderPrograms: { initial: initial.shaderPrograms, sampleStart: sampleStart.shaderPrograms, final: result.final.shaderPrograms },
          cpuMsPerSimulatedSecond: Object.fromEntries(['cpuMs', 'aiMs', 'pathMs', 'coverMs', 'sensingMs', 'instancesMs', 'renderMs']
            .map(key => [key, frames.reduce((sum, frame) => sum + frame[key], 0) / (result.final.time - sampleStart.time)])),
          maxDecisionWaitSeconds: Object.fromEntries(['sensor', 'cover', 'posture', 'path'].map(kind =>
            [kind, Math.max(...frames.map(frame => frame.aiDecisions.oldestWaitSeconds[kind]))])),
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
          finalState: result.final.state, errors, cpu: profile ? summarizeProfile(profile) : null };
        if (summary.renderTiming) {
          summary.renderTiming.cpu = distribution(summary.renderTiming.events.map(event => event.cpuMs));
          summary.renderTiming.gpu = distribution(summary.renderTiming.events.filter(event => event.gpuStatus === 'valid').map(event => event.gpuMs));
          summary.renderTiming.probeOverhead = distribution(summary.renderTiming.events.map(event => event.probeOverheadMs));
        }
        if (summary.renderWork) {
          const work = summary.renderWork;
          assert.equal(work.startBuffer.width, variant === 'half-buffer' ? 640 : 1280);
          assert.equal(work.startBuffer.height, variant === 'half-buffer' ? 360 : 720);
          assert.deepEqual(work.startBuffer, work.endBuffer, 'buffer dimensions must stay fixed throughout the sample');
          if (passCapture) {
            assert.equal(work.events.length, frames.length);
            assert.ok(work.events.every(event => !event.threw && event.shadowEntries > 0));
            work.totals = Object.fromEntries(['setup', 'shadow', 'main'].map(phase => [phase,
              Object.fromEntries(['submissions', 'calls', 'triangles', 'lines', 'points'].map(key =>
                [key, work.events.reduce((sum, event) => sum + event[phase][key], 0)]))]));
            assert.equal(work.events.filter(event => event.detailed).length, 3);
          }
        }
        await writeFile(join(directory, `${name}-frames.json`), JSON.stringify({ seed, initial, sampleStart, sampleEnd: result.now, boundaries: result.boundaries, events, frames, final: result.final, resolvedRenderTiming }, null, 2));
        await writeFile(join(directory, `${name}-summary.json`), JSON.stringify(summary, null, 2));
        await page.screenshot({ path: join(directory, `${name}.png`) });
        summaries.push(summary);
        assert.ok(summary.activeWindow.valid, 'sample was paused, stopped, or not active for the whole rAF window');
        assert.equal(errors.length, 0, errors.join('\n'));
        if (renderSplit) {
          assert.ok(frames.every(frame => frame.renderIsolation === isolationMode), 'the whole sampled interval must use the requested render isolation');
          assert.equal(result.final.graphics.shadowsEnabled, variant !== 'no-shadows');
          const start = sampleStart.renderIsolation, end = result.final.renderIsolation;
          assert.equal(end.characterPresentationFrames - start.characterPresentationFrames, frames.length, 'all modes retain character presentation updates');
          assert.equal(end.skippedFrames - start.skippedFrames, variant === 'no-draw' ? frames.length : 0);
          assert.equal(end.drawFrames - start.drawFrames, variant === 'no-draw' ? 0 : frames.length);
          assert.equal(end.hiddenCharacterFrames - start.hiddenCharacterFrames, variant === 'no-characters' ? frames.length : 0);
          if (variant === 'no-characters') assert.equal(end.visibleNativeRoots, 0);
          if (variant === 'no-draw') assert.ok(frames.every(frame => frame.renderMs === 0 && frame.drawCalls === 0 && frame.triangles === 0));
          else assert.ok(frames.some(frame => frame.drawCalls > 0), 'character hiding must not suppress the world');
        }
        assert.ok(summary.clock.maxStepsPerFrame <= result.final.simulationClock.limits.maxStepsPerFrame);
        assert.ok(summary.clock.maxConservationErrorSeconds < 1e-7, 'active world time must be simulated or retained as debt');
        assert.ok(summary.shotsAfter > summary.shotsBefore, 'the sampled interval must contain actual autonomous firing');
        if (tracerComparison) {
          const { start, end } = summary.tracers;
          assert.ok(end.created + end.reused > start.created + start.reused, 'both variants must present new tracers');
          assert.ok(end.retained <= end.capacity && end.idle <= end.retained);
          if (variant === 'current') assert.ok(end.reused > start.reused, 'the pooled variant must actually reuse tracers');
          else assert.equal(end.created, end.disposed + end.active, 'the legacy variant must dispose every expired tracer');
        }
        console.log(`${name}: frames=${frames.length}, P50/P95/P99=${metrics.intervalMs.p50.toFixed(1)}/${metrics.intervalMs.p95.toFixed(1)}/${metrics.intervalMs.p99.toFixed(1)}ms, >50ms=${metrics.intervalMs.over50ms}, AI mean=${metrics.aiMs.mean.toFixed(2)}ms, sim/wall=${summary.simulatedWallRatio.toFixed(3)}, shots=${summary.shotsAfter - summary.shotsBefore}`);
      } catch (error) {
        if (profileStarted) {
          const { profile } = await cdp.send('Profiler.stop');
          await writeFile(join(directory, `${name}-failed.cpuprofile`), JSON.stringify(profile));
        }
        let state = null, stateCaptureError = null;
        try {
          state = await page.evaluate(() => {
            const data = window.__battle;
            return data ? { state: data.state, time: data.time, population: data.population, combat: data.combatStats,
              simulationClock: data.simulationClock, telemetry: window.__battleTelemetry, driverProbe: window.__driverProbe ?? null,
              renderTimingProbe: window.__renderTimingProbe ?? null,
              renderPassTimingProbe: window.__renderPassTimingProbe ?? null } : null;
          });
        } catch (captureError) { stateCaptureError = captureError.message; }
        await writeFile(join(directory, `${name}-error.json`),
          JSON.stringify({ error: error.message, state, stateCaptureError, events, errors }, null, 2));
        throw error;
      } finally {
        if (!page.isClosed()) await page.evaluate(() => {
          window.__stopRenderWorkProbe?.();
          window.__stopRenderPassTimingProbe?.();
          window.__stopRenderTimingProbe?.();
        });
        await context.close();
      }
    }
    await writeFile(join(directory, 'summary.json'), JSON.stringify({ metadata, runs: summaries }, null, 2));
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
