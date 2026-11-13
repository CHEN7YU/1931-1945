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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/door-world.js*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const instrumented = body.replace('if (leaf.matrixWorld.equals(identity) && !doors.some',
      'if (!window.doorFocusBaseline && leaf.matrixWorld.equals(identity) && !doors.some');
    assert.notEqual(body, instrumented, 'door focus comparison must attach to the actual game');
    await route.fulfill({ response, body: instrumented });
  });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const instrumented = body.replace('createQueryDiagnostics(Boolean(benchmark?.queryStats))', 'createQueryDiagnostics(true)');
    assert.notEqual(body, instrumented, 'query diagnostics instrumentation must attach to the actual game');
    await route.fulfill({ response, body: instrumented + `
      window.dockPerfReview = {
        start() {
          setGameState('pause'); missionBriefing.hide();
          advanceNanjingCampaign(nanjingCampaign, nanjingCampaign.stageRemaining);
          if (!activateNanjingDock(nanjingCampaign)) throw new Error('Could not activate dock defense');
          const actor = allies[current];
          actor.position.set(-55, .36, -80);
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          updateNanjingMission(0); updateCamera(0);
          queryDiagnostics.reset();
          setGameState('playing'); bindControlInput();
        },
        status() { return { state, stage: nanjingCampaign.stage, time,
          friendly: friendlyForces.filter(actor => actor.health > 0).length,
          enemy: enemies.filter(actor => actor.health > 0).length,
          civilians: world.civilians.filter(person => !person.userData.dead && !person.userData.evacuated).length,
          diagnostics: queryDiagnostics.snapshot }; },
        compareDoorFocus() {
          setGameState('pause');
          const sample = baseline => {
            window.doorFocusBaseline = baseline;
            const before = world.doorSystem.raycastStats.queries, start = performance.now(), results = [];
            for (let i = 0; i < 30; i++) results.push(world.doorSystem.focus(camera)?.id ?? null);
            return { milliseconds: performance.now() - start,
              doorRaycasts: world.doorSystem.raycastStats.queries - before, results };
          };
          sample(true); sample(false);
          const baseline = sample(true), current = sample(false);
          window.doorFocusBaseline = false;
          return { baseline, current };
        },
        compareClearance() {
          setGameState('pause');
          const actor = enemies.find(item => item.health > 0 && !item.vehicleId && item.rifle &&
            (item.rifle.model ?? 'rifle') === 'rifle' && item.nativeMotion);
          const tank = [...entities.vehicles.values()].find(item => item.type === 'tank');
          if (!actor || !tank) throw new Error('Live enemy rifleman and real tank are required');
          const tankPosition = tank.position.clone(), original = { bayonet: { ...actor.bayonet },
            rifleReady: actor.rifleReady, weaponBlocked: actor.weaponBlocked };
          const restore = () => {
            Object.assign(actor.bayonet, original.bayonet);
            actor.rifleReady = original.rifleReady; actor.weaponBlocked = original.weaponBlocked;
          };
          const sample = stable => {
            restore();
            if (stable) movementCollision.beginStablePass();
            try { updateAIWeaponClearance(actor); }
            finally { if (stable) movementCollision.endStablePass(); }
            return { blocked: actor.weaponBlocked, bayonet: { ...actor.bayonet }, rifleReady: actor.rifleReady };
          };
          try {
            return [30, 0, 30].map(offset => {
              tank.position.set(actor.position.x + offset, tank.position.y, actor.position.z);
              return { offset, baseline: sample(false), current: sample(true) };
            });
          } finally { tank.position.copy(tankPosition); restore(); }
        }
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'nanjing'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.evaluate(() => dockPerfReview.start());
  const initial = await page.evaluate(() => dockPerfReview.status());
  assert.equal(initial.stage, 'dock-defense');
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
  await page.waitForTimeout(30000);
  const profile = (await session.send('Profiler.stop')).profile;
  const final = await page.evaluate(() => dockPerfReview.status());
  const focus = await page.evaluate(() => dockPerfReview.compareDoorFocus());
  assert.deepEqual(focus.current.results, focus.baseline.results, 'focus results cannot change');
  const clearance = await page.evaluate(() => dockPerfReview.compareClearance());
  for (const sample of clearance) assert.deepEqual(sample.current, sample.baseline,
    'a motion-pass snapshot cannot change actual AI bayonet clearance');
  await writeFile(join(directory, 'cpu-profile.json'), JSON.stringify(profile));
  await writeFile(join(directory, 'dock-performance.json'), JSON.stringify({
    limitation: 'Second stage activated artificially, player placed at the dock. Existing AI, civilians and combat remain enabled; this is not a natural full match.',
    initial, final, focus, clearance, errors }, null, 2));
  assert.deepEqual(errors, []);
  const counts = new Map();
  for (const id of profile.samples ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const hotspots = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([id, samples]) => ({
    function: nodes.get(id)?.callFrame.functionName, url: nodes.get(id)?.callFrame.url, samples,
  }));
  console.log(JSON.stringify({ initial: { ...initial, diagnostics: undefined },
    final: { ...final, diagnostics: undefined }, focus, hotspots }));
} finally {
  await browser.close();
}
