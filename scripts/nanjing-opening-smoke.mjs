import { setQualityPreset, deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { civilianVoiceClips } from '../src/civilian-voice-lines.js';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (process.env.OPENING_LOW_MEMORY === '1') {
    const preferences = defaultPreferences();
    preferences.quality.preset = 'low';
    for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
    await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
      JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  }
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    let body = await response.text();
    if (process.env.OPENING_BASELINE === '1') {
      const gate = 'if (data.openingWave && !data.active && !civilian.visible && time >= data.releaseAt) {';
      assert.ok(body.includes(gate), 'baseline requires the opening source gate');
      body = body.replace(gate, 'if (false && data.openingWave && !data.active && !civilian.visible && time >= data.releaseAt) {');
    }
    await route.fulfill({ response, body: body + `
      window.openingReview = {
        run() {
          const originalEnemies = enemies;
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); time = 0; aiDecisions.reset(); nanjingCampaign = createNanjingCampaign();
          camera.updateMatrixWorld(true);
          const openingView = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
            .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
          const hiddenSources = world.openingCivilianSources.filter(point => {
            const sphere = new THREE.Sphere(new THREE.Vector3(point.x,
              world.groundHeight(point.x, point.z) + 1.2, point.z), 1.7);
            return !openingView.intersectsSphere(sphere) ||
              openingSourceHiddenByCover(point, camera.position, world.groundHeight);
          }).map(({ x, z, street }) => ({ x, z, indoors: Boolean(street) }));
          const viewPosition = camera.position.toArray();
          const allReady = world.civilians.filter(person => person.userData.openingWave)
            .every(person => person.userData.releaseAt === 0);
          if (${process.env.OPENING_SOURCES_ONLY === '1' ? 'true' : 'false'}) {
            const hiddenBridgeGrid = [];
            for (let x = -28; x <= -20; x++) for (let z = 32; z <= 73; z++) {
              const sphere = new THREE.Sphere(new THREE.Vector3(x, world.groundHeight(x, z) + 1.2, z), 1.7);
              if (!openingView.intersectsSphere(sphere) && !circleBlocked(x, z, .45, movementObstacles(x, z)))
                hiddenBridgeGrid.push({ x, z });
            }
            return { hiddenSources, hiddenBridgeGrid, viewPosition };
          }
          let bridgePeak = 0, physicalBridgePeak = 0, separation = Infinity;
          let atFiveSeconds = 0, mainReleased = 0, lateReleased = 0;
          const sources = {};
          for (let frame = 0; frame < 2600; frame++) {
            time += .05;
            const unreleased = world.civilians.filter(person => person.userData.openingWave && !person.userData.active);
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible)
              .map(person => ({ x: person.position.x, z: person.position.z, radius: .36 })));
            updateNanjingCivilians(.05);
            for (const person of unreleased.filter(person => person.userData.active)) {
              const nearest = world.openingCivilianSources.reduce((best, point) =>
                Math.hypot(person.position.x - point.x, person.position.z - point.z) <
                  Math.hypot(person.position.x - best.x, person.position.z - best.z) ? point : best);
              const key = Math.hypot(person.position.x - nearest.x, person.position.z - nearest.z) < .25
                ? nearest.x + ',' + nearest.z : 'original-bridge';
              sources[key] = (sources[key] ?? 0) + 1;
            }
            controlEvents.drain(() => {});
            if (frame === 99) atFiveSeconds = world.civilians.filter(person => person.userData.active).length;
            if (frame === 799) mainReleased = world.civilians.filter(person => person.userData.active).length;
            if (frame === 1399) lateReleased = world.civilians.filter(person => person.userData.active).length;
            if (frame % 20 === 0) {
              const bridge = world.civilians.filter(person => person.visible && person.userData.openingWave &&
                person.position.z > 32);
              bridgePeak = Math.max(bridgePeak, bridge.length);
              const deck = world.landmarks.bridges[0];
              physicalBridgePeak = Math.max(physicalBridgePeak, bridge.filter(person =>
                Math.abs(person.position.x - deck.x) <= deck.width / 2 &&
                Math.abs(person.position.z - deck.z) <= deck.length / 2).length);
              for (let a = 0; a < bridge.length; a++) for (let b = a + 1; b < bridge.length; b++)
                separation = Math.min(separation, bridge[a].position.distanceTo(bridge[b].position));
            }
          }
          const entered = world.civilians.filter(person => person.userData.openingWave && person.position.z < -9).length;
          const prematureResidents = world.civilians.filter(person => person.userData.withdrawalWave &&
            !person.userData.streetLife && person.visible).length;
          const audio = civilianVoices?.snapshot;
          world.resetCampaign(); time = 0; aiDecisions.reset(); nanjingCampaign = createNanjingCampaign();
          const pursuer = originalEnemies.find(actor => actor.health > 0 && !actor.vehicleId &&
            [1, 2].includes(actor.formation.index) && !hasBayonet(actor) && !actor.discharger);
          if (!pursuer) throw new Error('Opening pursuit fixture requires a living non-bayonet infantryman');
          enemies = [pursuer]; rebuildForces();
          // Keep the real gunner isolated from combat and periodic roster rebuilding.
          clearTransient();
          friendlyForces = [];
          allForces = [pursuer];
          populationRefreshAt = time + 90;
          pursuer.position.set(-24, 0, 72);
          let pursued = false, firstMode, trailingStart;
          const blocked = {};
          for (let frame = 0; frame < 1500; frame++) {
            time += .05;
            aiDecisions.beginFrame();
            updateWeaponSimulation(.05);
            if (pursuer.nativeMotion) advanceNraMotion(pursuer, .05);
            updateAI(.05); updateNanjingCivilians(.05);
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible)
              .map(person => ({ x: person.position.x, z: person.position.z, radius: .36 })));
            controlEvents.drain(() => {});
            if (frame === 929) trailingStart = {
              pursuer: pursuer.position.toArray(), health: pursuer.health, traversal: pursuer.traversal.kind,
              mode: pursuer.tactics.mode,
              target: pursuer.target?.position.toArray(),
              stragglers: world.civilians.filter(person => person.visible && person.userData.openingWave && person.userData.civilianId >= 48)
                .map(person => person.position.toArray()),
            };
            pursued ||= pursuer.tactics.mode === 'pursue-civilians';
            if (pursuer.tactics.mode === 'pursue-civilians')
              blocked[pursuer.aiRifle.blocked] = (blocked[pursuer.aiRifle.blocked] ?? 0) + 1;
            firstMode ??= pursuer.tactics.mode;
          }
          const shots = nanjingCampaign.civilianShots ?? 0;
          const civilian = world.civilians.find(person => person.visible && !person.userData.dead);
          civilian.position.copy(pursuer.position); civilian.position.z -= 2;
          civilian.userData.arrived = false;
          const casualtiesBefore = nanjingCampaign.civilianCasualties;
          for (let frame = 0; frame < 100; frame++) { time += .05; updateNanjingCivilians(.05); }
          const proximityCasualties = nanjingCampaign.civilianCasualties - casualtiesBefore;
          const voiceListener = { position: civilian.position.clone().add(new THREE.Vector3(0, 1.5, 0)),
            right: { x: 1, y: 0, z: 0 }, soldierId: entities.control.soldierId };
          civilianVoices.reset();
          civilianVoices.update(audioContext, [civilian], voiceListener, 'gate-defense', time, true, false);
          const spoken = civilianVoices.snapshot.spoken;
          civilianVoices.sync(false);
          const paused = civilianVoices.snapshot.active;
          state = 'review';
          camera.position.set(-5, 10, 28); camera.lookAt(-24, 1, 49);
          for (const child of camera.children) child.visible = false;
          renderer.render(scene, camera);
          return { bridgePeak, physicalBridgePeak, atFiveSeconds, mainReleased, lateReleased, allReady, separation, entered, prematureResidents, audio,
            sources, hiddenSources, viewPosition,
            pursued, firstMode, trailingStart, shots, blocked, proximityCasualties, spoken, paused,
            pursuerBayonet: hasBayonet(pursuer), pursuerWeapon: pursuer.rifle.model };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('campaign', 'nanjing');
  if (process.env.OPENING_LOW_MEMORY === '1') url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  try {
    await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  } catch (error) {
    const loading = await page.evaluate(() => ({
      state: window.__battle?.state ?? null,
      percent: document.querySelector('#loading-percentage')?.textContent,
      message: document.querySelector('#loading-message')?.textContent,
    }));
    console.error(JSON.stringify({ stage: 'menu', errors, url: page.url(), loading }));
    throw error;
  }
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  await page.waitForFunction(() => window.__battle?.campaign?.openingAssaultReleased, null, { timeout: 180000 });
  const result = await page.evaluate(() => openingReview.run());
  if (process.env.OPENING_SCREENSHOT) await page.screenshot({ path: process.env.OPENING_SCREENSHOT });
  console.log(JSON.stringify(result));
  if (process.env.OPENING_SOURCES_ONLY === '1') {
    assert.ok(result.hiddenSources.length > 0, 'the current view must have at least one hidden opening source');
    assert.deepEqual(errors, []);
  } else {
    assert.ok(result.bridgePeak >= 8 && result.bridgePeak < 48, 'bridge refugees must flow in rather than appear all at once');
    assert.ok(result.physicalBridgePeak >= 8 && result.physicalBridgePeak < 48,
      'actual bridge-deck refugees must flow in rather than appear all at once');
    assert.equal(result.allReady, true, 'all opening refugees are eligible together');
    assert.ok(result.mainReleased >= result.atFiveSeconds && result.lateReleased >= result.mainReleased);
    assert.ok(result.separation >= .719, 'bridge refugees must not merge into one another');
    assert.equal(result.entered, 60, 'every unopposed opening refugee must cross all gate tunnels');
    assert.equal(result.prematureResidents, 0, 'residential wave stays reserved for the retreat order');
    assert.equal(result.audio.clips, civilianVoiceClips().length, 'all actual Azure recordings must decode');
    assert.ok(result.pursued && result.shots > 0, 'a real Japanese infantryman must follow, aim and fire');
    assert.equal(result.proximityCasualties, 0, 'merely standing near an enemy cannot kill a civilian');
    assert.equal(result.spoken, 1, 'real opening dialogue must play from an actual civilian');
    assert.equal(result.paused, 0, 'pausing must stop all civilian speech');
    assert.deepEqual(errors, []);
  }
} finally {
  await browser.close();
}
