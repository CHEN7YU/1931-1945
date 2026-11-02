import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.openingReview = {
        run() {
          const originalEnemies = enemies;
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); time = 0; aiDecisions.reset(); nanjingCampaign = createNanjingCampaign();
          let bridgePeak = 0, separation = Infinity, atFiveSeconds = 0, mainReleased = 0, lateReleased = 0;
          for (let frame = 0; frame < 2600; frame++) {
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible)
              .map(person => ({ x: person.position.x, z: person.position.z, radius: .36 })));
            updateNanjingCivilians(.05);
            controlEvents.drain(() => {});
            if (frame === 99) atFiveSeconds = world.civilians.filter(person => person.userData.active).length;
            if (frame === 799) mainReleased = world.civilians.filter(person => person.userData.active).length;
            if (frame === 1399) lateReleased = world.civilians.filter(person => person.userData.active).length;
            if (frame % 20 === 0) {
              const bridge = world.civilians.filter(person => person.visible && person.userData.openingWave &&
                person.position.z > 32);
              bridgePeak = Math.max(bridgePeak, bridge.length);
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
            [1, 2].includes(actor.formation.index) && actor.index % 11 < 2);
          if (!pursuer) throw new Error('Opening pursuit fixture requires a living infantryman');
          enemies = [pursuer]; rebuildForces();
          // Isolate pursuit from defender gunfire; normal combat may kill the rearguard before the late wave.
          clearTransient();
          friendlyForces = [];
          allForces = [pursuer];
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
              stragglers: world.civilians.filter(person => person.visible && person.userData.openingStraggler)
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
          return { bridgePeak, atFiveSeconds, mainReleased, lateReleased, separation, entered, prematureResidents, audio,
            pursued, firstMode, trailingStart, shots, blocked, proximityCasualties, spoken, paused };
        },
      };
    ` });
  });
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`,
    { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  await page.locator('#menu-quality').selectOption('low');
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  const result = await page.evaluate(() => openingReview.run());
  if (process.env.OPENING_SCREENSHOT) await page.screenshot({ path: process.env.OPENING_SCREENSHOT });
  console.log(JSON.stringify(result));
  assert.ok(result.bridgePeak >= 8 && result.bridgePeak < 48, 'bridge refugees must flow in rather than appear all at once');
  assert.ok(result.atFiveSeconds < 15, 'the opening frames must not activate sixty crowd agents together');
  assert.equal(result.mainReleased, 48, 'the main wave must leave a gap before the smaller pursued wave');
  assert.equal(result.lateReleased, 60);
  assert.ok(result.separation >= .719, 'bridge refugees must not merge into one another');
  assert.equal(result.entered, 60, 'every unopposed opening refugee must cross all gate tunnels');
  assert.equal(result.prematureResidents, 0, 'residential wave stays reserved for the retreat order');
  assert.equal(result.audio.clips, 132, 'all actual Azure recordings must decode');
  assert.ok(result.pursued && result.shots > 0, 'a real Japanese infantryman must follow, aim and fire');
  assert.equal(result.proximityCasualties, 0, 'merely standing near an enemy cannot kill a civilian');
  assert.equal(result.spoken, 1, 'real opening dialogue must play from an actual civilian');
  assert.equal(result.paused, 0, 'pausing must stop all civilian speech');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
