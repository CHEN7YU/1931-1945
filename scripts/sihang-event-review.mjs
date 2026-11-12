import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /THREE|shader|WebGL/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.eventReview = {
        prepare() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const before = combatEffects.snapshot, events = combatEvents.snapshot;
          const restore = combatEffects.prepareBattleViews();
          renderer.render(scene, camera);
          restore();
          return { before, after: combatEffects.snapshot, events, afterEvents: combatEvents.snapshot,
            graphics: graphics.snapshot };
        },
        demolition() {
          const builds = world.navigationStats.builds, start = performance.now();
          const operator = allForces.find(actor => actor.health > 0 && actor.formation.sihangDemolition);
          if (!operator) throw new Error('Demolition fixture requires a living shield operator');
          operator.position.x += 3;
          sihangCampaign.demolition.state = 'armed'; sihangCampaign.demolition.fuseRemaining = .001;
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.02, time);
          const voice = { ...sihangVoices?.snapshot, context: audioContext?.state, failure: sihangVoicesFailure };
          setGameState('pause');
          const simulationMs = performance.now() - start, renderStart = performance.now();
          camera.position.set(0, 3, -54); camera.lookAt(0, 2, -42); camera.updateMatrixWorld(true);
          combatEffects.update(0, time, entities.vehicles.values());
          renderer.render(scene, camera);
          return { simulationMs, renderMs: performance.now() - renderStart, builds,
            afterBuilds: world.navigationStats.builds, northWallBreached: world.northWallBreached,
            charge: sihangCampaign.demolition.state, stage: sihangCampaign.stage, outcome: sihangCampaign.outcome,
            voice, navigation: world.navigationStats,
            population: { friendly: friendlyForces.length, enemy: enemies.length },
            programs: renderer.info.programs.length, effects: combatEffects.snapshot,
            image: renderer.domElement.toDataURL() };
        },
        effect(style) {
          combatEffects.clear();
          camera.position.set(0, 3, -54); camera.lookAt(0, 2, -42); camera.updateMatrixWorld(true);
          const point = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8));
          const before = renderer.info.programs.length, start = performance.now();
          combatEffects.explosion(point, time, 7, style);
          combatEffects.update(.02, time + .02, entities.vehicles.values());
          renderer.render(scene, camera);
          return { style, milliseconds: performance.now() - start, programsBefore: before,
            programsAfter: renderer.info.programs.length, effects: combatEffects.snapshot,
            image: renderer.domElement.toDataURL() };
        },
        vehicleEffects() {
          combatEffects.clear();
          camera.position.set(0, 3, -54); camera.lookAt(0, 2, -42); camera.updateMatrixWorld(true);
          const point = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(8));
          const tank = [...entities.vehicles.values()].find(vehicle => vehicle.type === 'tank');
          const plane = [...entities.vehicles.values()].find(vehicle => vehicle.type === 'plane');
          const owned = JSON.stringify([tank, plane]), before = renderer.info.programs.length;
          const fixtures = [{ ...tank, position: point, health: 0, destroyedAt: time },
            { ...plane, position: point.clone().add(new THREE.Vector3(2, 1, 0)) }];
          combatEffects.update(1, time + 1, fixtures);
          fixtures[1].health *= .5;
          combatEffects.update(.02, time + 1.02, fixtures);
          renderer.render(scene, camera);
          return { effects: combatEffects.snapshot, ownershipPreserved: owned === JSON.stringify([tank, plane]),
            programsBefore: before, programsAfter: renderer.info.programs.length,
            image: renderer.domElement.toDataURL() };
        },
        withdrawalVoices() {
          setGameState('menu'); beginMatch(); missionBriefing.hide(); setGameState('playing');
          sihangCampaign.reserve = 0;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          const withdrawal = { ...sihangVoices?.snapshot };
          sihangCampaign.assemblyReleased = true;
          const crossing = friendlyAI.find(actor => actor.health > 0);
          if (!crossing) throw new Error('Voice fixture requires a living AI soldier');
          crossing.position.set(88, 0, 30);
          updateSihangMission(.05);
          const counterattack = { ...sihangVoices?.snapshot };
          const needed = sihangCampaign.retreatRequired - sihangCampaign.evacuatedIds.length;
          sihangCampaign.evacuatedIds.push(...sihangCampaign.retreatIds
            .filter(id => !sihangCampaign.evacuatedIds.includes(id)).slice(0, needed));
          updateSihangMission(.05);
          const retreatOpen = { ...sihangVoices?.snapshot };
          setGameState('pause');
          return { withdrawal, counterattack, retreatOpen };
        }
      };` });
  });
  await page.goto(new URL('/?campaign=sihang&resources=standard',
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'high'); await deployFromMenu(page);
  await page.waitForFunction(() => window.eventReview && window.__battle?.state === 'playing', null, { timeout: 180000 });
  const preparation = await page.evaluate(() => eventReview.prepare());
  assert.equal(preparation.graphics.preset, 'high', 'verify effective quality, not just the requested UI preference');
  assert.equal(preparation.graphics.lowMemory, false);
  assert.deepEqual(preparation.after, preparation.before, 'render preparation cannot emit or retain synthetic effects');
  assert.deepEqual(preparation.afterEvents, preparation.events, 'render preparation cannot issue gameplay events');
  const { image: demolitionImage, ...demolition } = await page.evaluate(() => eventReview.demolition());
  await writeFile(join(directory, 'demolition.png'), Buffer.from(demolitionImage.split(',')[1], 'base64'));
  await writeFile(join(directory, 'demolition.json'), JSON.stringify({ demolition, errors }, null, 2));
  assert.equal(demolition.northWallBreached, true);
  assert.equal(demolition.charge, 'detonated');
  assert.equal(demolition.voice.context, 'running');
  assert.equal(demolition.voice.active, 'detonated', 'the real detonation path must play its command voice');
  assert.equal(demolition.afterBuilds, demolition.builds);
  const effects = [], report = { fixture: 'full-opening-roster-high-quality-isolated-events',
    preparation, demolition, effects, errors };
  await writeFile(join(directory, 'events.json'), JSON.stringify(report, null, 2));
  for (const style of ['default', 'grenade', 'explosive-pack', 'tank-shell', 'tank-destruction', 'aircraft-hit']) {
    const { image, ...effect } = await page.evaluate(style => eventReview.effect(style), style);
    effects.push(effect);
    await writeFile(join(directory, style + '.png'), Buffer.from(image.split(',')[1], 'base64'));
    await writeFile(join(directory, 'events.json'), JSON.stringify(report, null, 2));
    assert.ok(effect.effects.renderedClouds > 0, style + ' must draw its real pooled particles');
    assert.equal(effect.programsAfter, effect.programsBefore, style + ' must reuse prepared shader variants');
  }
  const { image: vehicleImage, ...vehicles } = await page.evaluate(() => eventReview.vehicleEffects());
  report.vehicles = vehicles;
  await writeFile(join(directory, 'vehicle-fire-smoke.png'), Buffer.from(vehicleImage.split(',')[1], 'base64'));
  await writeFile(join(directory, 'events.json'), JSON.stringify(report, null, 2));
  assert.ok(vehicles.effects.tankFire.flamePlanes > 0);
  assert.ok(vehicles.effects.aircraftSmoke.puffs > 0);
  assert.equal(vehicles.ownershipPreserved, true);
  assert.equal(vehicles.programsAfter, vehicles.programsBefore);
  const voices = await page.evaluate(() => eventReview.withdrawalVoices());
  report.voices = voices;
  await writeFile(join(directory, 'events.json'), JSON.stringify(report, null, 2));
  assert.equal(voices.withdrawal.active, 'withdrawal');
  assert.equal(voices.counterattack.active, 'counterattack');
  assert.equal(voices.retreatOpen.active, 'retreat-open');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ demolition, effects: effects.map(({ style, milliseconds, programsBefore, programsAfter }) =>
    ({ style, milliseconds, programsBefore, programsAfter })) }, null, 2));
} finally {
  await browser.close();
}
