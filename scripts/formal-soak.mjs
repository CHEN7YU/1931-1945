import { setQualityPreset } from './game-entry.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function bounded(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be ${min}..${max}`);
  return value;
}
const matches = bounded('SOAK_MATCHES', 3, 3, 5);
const seconds = bounded('SOAK_SECONDS', 180, 60, 600);
const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required to preserve formal multi-match observations');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable');
const errors = [], rounds = [], menus = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
let stage = 'loading';
let inProgress = null;
let result = null;
const watchdog = setTimeout(() => {
  console.error(`Formal soak exceeded bounded wall-time at ${stage}`);
  void browser.close();
}, (matches * Math.max(seconds * 3, 180) + 180) * 1000);
async function sample() {
  return page.evaluate(() => {
    const b = window.__battle;
    const inventory = window.__battleResourceInventory;
    return { build: b.build, state: b.state, time: b.time, remaining: b.remaining, position: b.position,
      resources: b.resources, entities: b.entityCounts, clock: b.simulationClock,
      population: { friendly: b.population.friendly, enemy: b.population.enemy },
      shots: b.combatStats.aiRifleShots, corpseCount: b.corpses.count,
      audio: { mixer: b.audioMix, rifle: b.rifleAudio.active, footstep: b.footstepAudio.active,
        mechanical: b.mechanicalAudio.active, voices: b.battleVoices.active, reactions: b.battleReactions.active,
        queued: b.battleVoices.queued },
      grenades: b.grenades.active.length, projectileViews: b.projectileViews,
      particles: { fragments: b.combatEffects.fragments, clouds: b.combatEffects.clouds, lights: b.combatEffects.lights },
      inventory: { logicalTextures: inventory.textures.length, skeletonTextures: inventory.skeletonTextures,
        skeletonsByOwner: Object.fromEntries(['friendly-force', 'enemy-force', 'reusable-weapon-hands'].map(owner =>
          [owner, inventory.textures.filter(texture => texture.kind === 'skeleton' &&
            texture.owners.some(label => label.startsWith(`${owner}:`))).length])) },
      forceVisible: b.population.renderer.visible, control: b.control, fatal: !document.querySelector('#fatal').hidden };
  });
}
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5214/');
  assert.equal(url.searchParams.has('benchmark'), false, 'formal soak must not use a diagnostic roster');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('#menu').waitFor({ state: 'visible', timeout: 120000 });
  await setQualityPreset(page, process.env.SOAK_QUALITY || 'low');
  const initial = await sample();
  assert.equal(initial.build.development, false, 'use an immutable production build, not a hot-reloading server');
  for (let round = 1; round <= matches; round++) {
    stage = `match-${round}`;
    const tank = round % 2 === 0;
    await page.locator(`#squad-choices [data-type="${tank ? 'tank' : 'infantry'}"]`).click();
    await page.locator('#deploy').click();
    await page.waitForFunction(() => window.__battle.state === 'playing', null, { timeout: 30000 });
    const start = await sample(), observations = [start];
    inProgress = { round, squad: tank ? 'tank' : 'infantry', observations };
    assert.equal(start.population.friendly.alive, tank ? 102 : 110, 'original full friendly roster is intact');
    assert.equal(start.population.enemy.alive, 98, 'enemy population is not reduced for this check');
    let walking = !tank, lastShot = -30, loggedAt = 0;
    const startedAt = Date.now(), wallLimit = Math.max(seconds * 3, 180) * 1000;
    if (walking) await page.keyboard.down('w');
    while (true) {
      await page.waitForTimeout(2000);
      const current = await sample(); observations.push(current);
      assert.equal(current.fatal, false, `match ${round}: fatal overlay`);
      assert.deepEqual(errors, [], `match ${round}: browser errors`);
      if (walking && (current.position?.z <= 0 || current.state !== 'playing' || Date.now() - startedAt > 90000)) {
        await page.keyboard.up('w'); walking = false;
      }
      if (!walking && current.state === 'playing' && current.time >= lastShot + 30) {
        await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
        lastShot = current.time;
      }
      if (current.time >= loggedAt + 30) {
        console.log(`Formal match ${round}: sim=${current.time.toFixed(1)}s shots=${current.shots} corpses=${current.corpseCount} geometry=${current.resources.geometries} textures=${current.resources.textures}`);
        loggedAt = current.time;
      }
      if (['victory', 'defeat', 'draw'].includes(current.state) || current.time >= seconds) break;
      assert.ok(Date.now() - startedAt < wallLimit, `match ${round}: simulation did not reach target within bounded wall time`);
    }
    await page.keyboard.up('w'); await page.mouse.up(); await page.mouse.up({ button: 'right' });
    const final = observations.at(-1);
    assert.ok(final.time > start.time + 30, 'the formal match actually advances, not just the wall-clock timer');
    assert.ok(final.shots > 0, 'real autonomous combat occurred');
    if (['playing', 'transferring'].includes(final.state)) await page.keyboard.press('Escape');
    const beforeReset = await sample();
    await page.locator('#back-menu').click();
    await page.locator('#menu').waitFor({ state: 'visible' });
    await page.waitForTimeout(1500);
    const menu = await sample();
    menu.inventory = await page.evaluate(() => window.__battleResourceInventory);
    const metrics = await cdp.send('Performance.getMetrics');
    menu.heapUsed = metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
    assert.equal(menu.state, 'menu');
    assert.equal(menu.fatal, false);
    assert.equal(menu.entities.soldiers, 0); assert.equal(menu.entities.vehicles, 0);
    assert.equal(menu.entities.weapons, 0);
    assert.equal(menu.control.soldierId, null);
    assert.equal(menu.grenades, 0); assert.equal(menu.projectileViews, 0);
    assert.equal(menu.corpseCount, 0); assert.equal(menu.forceVisible, 0);
    assert.equal(menu.resources.transientEffects, 0); assert.equal(menu.resources.pathRequests, 0);
    assert.deepEqual(menu.particles, { fragments: 0, clouds: 0, lights: 0 });
    for (const key of ['geometries', 'textures', 'programs']) assert.ok(menu.resources[key] <= beforeReset.resources[key],
      `${key} increased during match cleanup: ${beforeReset.resources[key]} -> ${menu.resources[key]}`);
    const appearance = menu.inventory.appearance;
    assert.ok(appearance.geometryIds.length <= appearance.limits.geometries, 'face/build/uniform cache stays within its actual variant families');
    assert.ok(appearance.materialEntries <= appearance.limits.materials, 'skin color cache stays within its actual complexion families');
    assert.ok(menu.inventory.skeletonTextures <= menu.inventory.skeletons.length, 'bone textures stay owned by retained skeletons');
    for (const [kind, active] of Object.entries(menu.audio)) {
      if (kind === 'mixer') assert.equal(active.activeSynthetic, 0);
      else assert.equal(active, 0, `${kind} audio must release/reset on return to menu`);
    }
    rounds.push({ round, squad: tank ? 'tank' : 'infantry', wallSeconds: (Date.now() - startedAt) / 1000,
      observations, beforeReset });
    inProgress = null;
    menus.push(menu);
    await writeFile(join(directory, 'formal-soak.json'), JSON.stringify({ matches, seconds, initial, rounds, menus, errors,
      limitation: 'Bounded formal multi-match run; not an FPS guarantee, exhaustive soak, heap-leak proof or complete ten-minute match coverage. Heap is observed without forcing GC.' }, null, 2));
    await page.screenshot({ path: join(directory, `formal-menu-${round}.png`) });
    console.log(`Formal match ${round}: menu cleanup complete; geometry=${menu.resources.geometries}, textures=${menu.resources.textures}, programs=${menu.resources.programs}`);
  }
  // First visibility uploads new pose banks and bone textures. Compare retained owners, not an assumed two-match warm-up.
  const warmed = menus[1].resources, last = menus.at(-1).resources;
  assert.deepEqual([...menus.at(-1).inventory.skeletons].sort(), [...menus[0].inventory.skeletons].sort(),
    'restarting and binding new soldiers cannot allocate another character/hand skeleton pool');
  assert.equal(last.sceneChildren, warmed.sceneChildren, 'menu roots do not accumulate across restarts');
  assert.equal(last.cameraChildren, warmed.cameraChildren, 'old first-person weapons do not remain attached');
  assert.deepEqual(errors, []);
  result = { cleanupPassed: true, rendererGrowthAfterSecondMatch: Object.fromEntries(
    ['geometries', 'textures', 'programs'].map(key => [key, last[key] - warmed[key]])),
    fixedSkeletons: menus.at(-1).inventory.skeletons.length,
    appearance: menus.at(-1).inventory.appearance,
    limitation: 'Renderer cache counts may grow on first use; this verifies bounded owned pools and reset cleanup, not zero heap growth or complete leak freedom.' };
  console.log(`Renderer counts after warm-up: ${JSON.stringify({ second: warmed, last })}; first-use cache growth is retained in the report, not called a leak or ignored.`);
  console.log('PASS: full formal rosters, real combat, zero live match/audio effects after reset, no allocation during cleanup, fixed skeleton pool and bounded appearance caches.');
} finally {
  clearTimeout(watchdog);
  try {
    await writeFile(join(directory, 'formal-soak-final.json'), JSON.stringify({ stage, matches, seconds, rounds, menus, inProgress, result, errors }, null, 2));
  } finally { await browser.close(); }
}
