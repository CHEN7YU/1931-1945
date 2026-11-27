import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.openingSpawnReview = {
        releaseInside() {
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); world.doorSystem.reset(); time = 0; nanjingCampaign = createNanjingCampaign();
          camera.position.set(0, 130, 45); camera.lookAt(0, 0, 70);
          camera.updateMatrixWorld(true);
          let selected = null, released = false, releasedWhileInside = false;
          const samples = [];
          for (let frame = 0; frame < 3600; frame++) {
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible && !person.userData.dead)
              .map(person => ({ ...person.position, radius: .36 })));
            updateNanjingCivilians(.05);
            controlEvents.drain(() => {});
            if (!selected) {
              selected = world.civilians.find(person => person.userData.openingInside);
              if (selected) {
                nanjingCampaign.stage = 'withdrawal';
                nanjingCampaign.dockActivated = true;
                selected.userData.flightReleaseAt = time;
              }
            } else {
              if (!released && selected.userData.fleeReleased)
                releasedWhileInside = selected.userData.openingInside;
              released ||= selected.userData.fleeReleased;
              if (frame % 100 === 0) {
                const data = selected.userData;
                samples.push({ time, position: selected.position.toArray(), active: data.active,
                  released: data.fleeReleased, inside: data.openingInside, streetEvacuating: data.streetEvacuating,
                  waypoint: data.waypoint, target: data.route?.[data.waypoint], exit: data.streetLife?.exit,
                  stalled: data.crowdStalled, routeRejoins: data.routeRejoins, routeRejoinFailures: data.routeRejoinFailures,
                  nearby: world.civilians.filter(other => other !== selected && other.visible && !other.userData.dead &&
                    other.position.distanceTo(selected.position) < 3)
                    .map(other => ({ id: other.userData.civilianId, position: other.position.toArray(),
                      target: other.userData.route?.[other.userData.waypoint], inside: other.userData.openingInside })) });
              }
              if (released && !selected.userData.openingInside && selected.userData.crossedRiver)
                return { id: selected.userData.civilianId, released, releasedWhileInside, crossed: true, time, samples };
            }
            if (${process.env.INDOOR_DIAGNOSTIC === '1' ? 'frame === 599' : 'false'}) break;
          }
          return { id: selected?.userData.civilianId, released, releasedWhileInside,
            inside: selected?.userData.openingInside, crossed: selected?.userData.crossedRiver, time, samples };
        },
        restartInside() {
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); world.doorSystem.reset(); time = 0; nanjingCampaign = createNanjingCampaign();
          camera.position.set(0, 130, 45); camera.lookAt(0, 0, 70);
          for (let frame = 0; frame < 100; frame++) {
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible && !person.userData.dead)
              .map(person => ({ ...person.position, radius: .36 })));
            updateNanjingCivilians(.05);
            if (world.civilians.some(person => person.userData.openingInside)) {
              world.resetCampaign(); world.doorSystem.reset();
              return world.civilians.filter(person => person.userData.openingWave)
                .every(person => !person.visible && !person.userData.streetLife && !person.userData.openingInside);
            }
          }
          throw new Error('No opening refugee appeared in a house before the restart');
        },
        run(mode) {
          enemies = []; rebuildForces(); combatSounds.length = 0;
          world.resetCampaign(); world.doorSystem.reset(); time = 0; nanjingCampaign = createNanjingCampaign();
          if (${process.env.DOOR_REGRESSION === '1' ? 'true' : 'false'})
            world.openingCivilianSources = world.openingCivilianSources.filter(point =>
              !point.street || Math.abs(point.x - point.street.door.x) <= 1);
          const opening = world.civilians.filter(person => person.userData.openingWave);
          const spawned = [], visibleAtSpawn = [], unknownSource = [], trace = [];
          let held = 0, allSourcesObserved = false;
          for (let frame = 0; frame < ${process.env.OVERHEAD_TRACE === '1' ? 800 : 3600}; frame++) {
            if (mode === 'overhead') {
              camera.position.set(0, 130, 45); camera.lookAt(0, 0, 70);
            } else if (mode === 'moving') {
              camera.position.set(-5 + Math.sin(frame * .003) * 12, 1.7, 24 + Math.cos(frame * .004) * 8);
              camera.lookAt(-24 + Math.sin(frame * .009) * 12, 1, 52 + Math.cos(frame * .006) * 15);
            } else {
              camera.position.set(0, 1.7, -8); camera.lookAt(-24, 1, 70);
            }
            camera.updateMatrixWorld(true);
            const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
              .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
            const before = opening.filter(person => !person.userData.active);
            time += .05;
            world.doorSystem.update(.05, world.civilians.filter(person => person.visible && !person.userData.dead)
              .map(person => ({ ...person.position, radius: .36 })));
            updateNanjingCivilians(.05);
            controlEvents.drain(() => {});
            if (${process.env.OVERHEAD_TRACE === '1' ? 'frame % 20 === 0' : 'false'}) {
              const person = opening.find(item => item.userData.civilianId === 1), data = person.userData;
              const door = data.streetLife?.door;
              trace.push({ time, position: person.position.toArray(), waypoint: data.waypoint,
                target: data.route?.[data.waypoint], inside: data.openingInside, stalled: data.crowdStalled,
                door: door && { x: door.x, z: door.z, angle: door.angle, targetAngle: door.targetAngle },
                crowdPath: data.crowdPath, rejoined: data.routeRejoins, rejoinFailures: data.routeRejoinFailures });
            }
            for (const person of before.filter(person => person.userData.active)) {
              const source = world.openingCivilianSources.find(point =>
                Math.hypot(person.position.x - point.x, person.position.z - point.z) < .25);
              if (!source) { unknownSource.push(person.userData.civilianId); continue; }
              const sphere = new THREE.Sphere(new THREE.Vector3(source.x,
                world.groundHeight(source.x, source.z) + 1.2, source.z), 1.7);
              if (frustum.intersectsSphere(sphere) &&
                !openingSourceHiddenByCover(source, camera.position, world.groundHeight))
                visibleAtSpawn.push(person.userData.civilianId);
              spawned.push({ id: person.userData.civilianId, x: source.x, z: source.z, time,
                indoors: Boolean(source.street) });
            }
            if (mode === 'overhead' && frame === 599) {
              held = opening.filter(person => !person.userData.active && person.userData.releaseAt <= time).length;
              allSourcesObserved = world.openingCivilianSources.every(point => frustum.intersectsSphere(
                new THREE.Sphere(new THREE.Vector3(point.x, world.groundHeight(point.x, point.z) + 1.2, point.z), 1.7)));
            }
          }
          return { spawned, visibleAtSpawn, unknownSource, held, allSourcesObserved, trace,
            active: opening.filter(person => person.userData.active).length,
            crossed: opening.filter(person => person.userData.crossedRiver).length,
            unfinished: opening.filter(person => !person.userData.crossedRiver).map(person => ({
              id: person.userData.civilianId, position: person.position.toArray(),
              inside: person.userData.openingInside, streetEvacuating: person.userData.streetEvacuating,
              waypoint: person.userData.waypoint, target: person.userData.route?.[person.userData.waypoint],
              stalled: person.userData.crowdStalled, released: person.userData.fleeReleased,
              nearby: world.civilians.filter(other => other !== person && other.visible && !other.userData.dead &&
                other.position.distanceTo(person.position) < 2).map(other => ({
                  id: other.userData.civilianId, position: other.position.toArray(), inside: other.userData.openingInside,
                  target: other.userData.route?.[other.userData.waypoint],
                })),
            })),
            sources: world.openingCivilianSources.map(({ x, z }) => ({ x, z })) };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  if (process.env.INDOOR_RELEASE_ONLY === '1') {
    const result = await page.evaluate(() => openingSpawnReview.releaseInside());
    if (process.env.SPAWN_RESULT) await writeFile(process.env.SPAWN_RESULT, JSON.stringify({ result, errors,
      limitation: 'Enemies disabled; withdrawal and dock activation forced while an opening refugee is indoors.' }, null, 2));
    assert.ok(result.releasedWhileInside && result.crossed, 'an indoor opening refugee must leave and cross after withdrawal');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify(result));
  } else if (process.env.OVERHEAD_DIAGNOSTIC === '1') {
    const result = await page.evaluate(() => openingSpawnReview.run('overhead'));
    if (process.env.SPAWN_RESULT) await writeFile(process.env.SPAWN_RESULT, JSON.stringify({ result, errors,
      limitation: 'Low-quality fixed-step game update, enemies disabled and camera held above the scene.' }, null, 2));
    console.log(JSON.stringify({ active: result.active, crossed: result.crossed, unfinished: result.unfinished }));
    assert.deepEqual(result.visibleAtSpawn, []);
    assert.deepEqual(result.unknownSource, []);
    if (process.env.DOOR_REGRESSION === '1') {
      assert.ok(result.spawned.some(person => person.id === 1 && person.x === -10 && person.z === 76 && person.indoors),
        'the regression must exercise the house where the open door blocked a refugee');
    }
    if (process.env.OVERHEAD_TRACE !== '1') {
      assert.equal(result.crossed, 60, 'all opening refugees must cross without opposition');
    }
    assert.deepEqual(errors, []);
  } else {
    const restartInside = await page.evaluate(() => openingSpawnReview.restartInside());
    const bridge = await page.evaluate(() => openingSpawnReview.run('bridge'));
    const overhead = await page.evaluate(() => openingSpawnReview.run('overhead'));
    const moving = await page.evaluate(() => openingSpawnReview.run('moving'));
    const report = { restartInside, bridge, overhead, moving, errors,
      limitation: 'Low-quality fixed-step game update, enemies disabled and camera positioned or moved artificially.' };
    if (process.env.SPAWN_RESULT) await writeFile(process.env.SPAWN_RESULT, JSON.stringify(report, null, 2));
    for (const sample of [bridge, overhead, moving]) {
      assert.deepEqual(sample.visibleAtSpawn, []);
      assert.deepEqual(sample.unknownSource, []);
      assert.equal(sample.active, 60);
      assert.ok(sample.crossed >= 54, 'opening refugees must actually cross the bridge');
      assert.equal(new Set(sample.spawned.map(person => person.id)).size, 60);
    }
    assert.equal(restartInside, true, 'restarting while a refugee is indoors clears its temporary street state');
    assert.equal(overhead.allSourcesObserved, true);
    assert.ok(overhead.spawned.some(person => person.indoors), 'roof cover supplies concealed sources');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ bridge: { active: bridge.active, crossed: bridge.crossed },
      overhead: { active: overhead.active, crossed: overhead.crossed, held: overhead.held },
      moving: { active: moving.active, crossed: moving.crossed } }));
  }
} finally {
  await browser.close();
}
