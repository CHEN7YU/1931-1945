import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.shieldReview = {
        liveStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          return this.liveSnapshot();
        },
        liveStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && sihangCampaign.stage === 'sihang-defense' &&
            !sihangCampaign.outcome; i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.liveSnapshot();
        },
        liveSnapshot() {
          return { time, stage: sihangCampaign.stage, outcome: sihangCampaign.outcome,
            breached: sihangCampaign.northWallBreached, charge: {...sihangCampaign.demolition},
            demolition: sihangCombat.snapshot,
            sappers: enemies.filter(actor => actor.health > 0 &&
              (actor.formation.sihangDemolition || actor.tactics.sihangDemolitionReturned)).map(actor => ({
                id: actor.id, health: actor.health, position: actor.position.toArray(),
                mode: actor.tactics.mode, returned: Boolean(actor.tactics.sihangDemolitionReturned),
                goal: sihangCombat.goalFor(actor, sihangCampaign), pathReason: actor.tactics.pathReason })),
            infantry: enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
              !actor.formation.sihangDemolition && !actor.tactics.sihangDemolitionReturned).map(actor => ({
                id: actor.id, health: actor.health, position: actor.position.toArray(),
                mode: actor.tactics.mode, pathReason: actor.tactics.pathReason,
                target: actor.target?.id ?? null, shots: actor.rifle.shots })) };
        },
        setup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const sappers = enemies.filter(actor => actor.formation.sihangDemolition).sort((a,b) => a.index-b.index);
          if (sappers.length !== 20) throw new Error('Expected the original twenty sappers');
          sihangCombat.reset();
          for (let i = 0; i < sappers.length; i++) {
            const pose = sihangShieldLayout(i, sappers.length);
            sappers[i].position.set(pose.x, 0, -72 + pose.z);
            sappers[i].heading = pose.facing;
            sappers[i].locomotion.speed = 0;
          }
          sihangCombat.update(0, time, { campaign: sihangCampaign, actors: allForces,
            player: allies[current], keys });
          return sihangCombat.snapshot;
        },
        setupThrow() {
          this.setup();
          const actor = controlledSoldier(entities);
          const sideRows = this.sideShieldPositions().filter(position => position > -76 && position < -72);
          const gaps = sideRows.slice(1).map((position, index) => ({
            lower: sideRows[index], upper: position, width: position - sideRows[index] }));
          const gap = gaps.filter(item => item.width > 1.3).sort((a,b) =>
            Math.abs((a.lower + a.upper) / 2 + 74.4) - Math.abs((b.lower + b.upper) / 2 + 74.4))[0];
          if (!gap) throw new Error('No grenade-clear side-plate gap in the current turtle formation');
          const gapCenter = (gap.lower + gap.upper) / 2;
          actor.position.set(-4, 0, gapCenter - .32);
          actor.health = 100000;
          actor.heading = controlPose.yaw = -Math.PI / 2;
          controlPose.pitch = -.5;
          for (const enemy of enemies) enemy.nextFire = time + 100000;
          this.throwHits = [];
          const originalTrace = traceGrenade;
          traceGrenade = (...args) => {
            const hit = originalTrace(...args);
            const [from, to, radius] = args;
            if (hit && radius === .065 && from.x < -.5 && from.y > .5 &&
              Math.abs(from.z - gapCenter) < .3) {
              const start = new THREE.Vector3(from.x, from.y, from.z);
              const delta = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
              const candidates = solidIndex.sweptCandidates(from, to, radius);
              const hits = [];
              for (const offset of [[0,0,0],[radius,0,0],[-radius,0,0],[0,radius,0],
                [0,-radius,0],[0,0,radius],[0,0,-radius]]) {
                const testRay = new THREE.Raycaster(start.clone().add(new THREE.Vector3(...offset)),
                  delta.clone().normalize(), 0, delta.length());
                hits.push(...testRay.intersectObjects(candidates, true).map(item => ({
                  distance: item.distance, dynamic: Boolean(item.object.userData.dynamicCollision),
                  name: item.object.name, position: item.object.position.toArray() })));
              }
              hits.sort((a,b) => a.distance - b.distance);
              window.shieldReview.throwHits.push({ time, from, to, surfaceKind: hit.surfaceKind,
                nearest: hits[0] ?? null, sappers: enemies.filter(item => item.formation.sihangDemolition &&
                  Math.abs(item.position.z - from.z) < 2).map(item => ({ id: item.id, slot: item.index,
                    position: item.position.toArray(), heading: item.heading })) });
            }
            return hit;
          };
          setGameState('playing');
          return { player: actor.id, position: actor.position.toArray(), gap };
        },
        sideShieldPositions() {
          return world.solids.filter(mesh => mesh.visible && mesh.userData.dynamicCollision &&
            Math.abs(mesh.position.x + 1.48) < .15).map(mesh => mesh.position.z).sort((a,b) => a-b);
        },
        trace(from, to) {
          const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
          const direction = end.clone().sub(start), distance = direction.length();
          direction.normalize();
          const testRay = new THREE.Raycaster(start, direction, 0, distance);
          const hits = testRay.intersectObjects(solidIndex.candidates(start, direction, distance), true);
          const grenade = traceGrenade(start, end, GRENADE.size);
          return { bullet: hits[0] ? { dynamic: Boolean(hits[0].object.userData.dynamicCollision),
            distance: hits[0].distance } : null, grenade: grenade && {
              surfaceKind: grenade.surfaceKind, position: grenade.position.toArray() }, radius: GRENADE.size };
        },
        capture(eye, target) {
          camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld(true);
          const displayed = allForces.filter(actor => actor.health > 0);
          nraCharacter?.update(displayed.filter(actor => actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          ijaCharacter?.update(displayed.filter(actor => !actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          uniformExcludedIds.clear();
          for (const force of [nraCharacter, ijaCharacter])
            for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
          soldierRenderer.update(displayed, graphics.snapshot.preset, time,
            entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png').split(',')[1];
        },
        breachSupport() {
          for (const actor of enemies.filter(actor => actor.formation.sihangDemolition))
            actor.position.z += 22;
          sihangCombat.update(0, time, { campaign: sihangCampaign, actors: allForces,
            player: allies[current], keys });
          updateAI(.05);
          const sample = () => ({ supportMembers: sihangSupportContext?.members.length ?? 0,
            livingSappers: enemies.filter(actor => actor.health > 0 && actor.formation.sihangDemolition).length,
            modes: enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
              !actor.formation.sihangDemolition).reduce((counts, actor) => {
                counts[actor.tactics.mode] = (counts[actor.tactics.mode] ?? 0) + 1; return counts;
              }, {}) });
          const before = sample();
          const infantry = enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
            !actor.formation.sihangDemolition);
          const positions = new Map(infantry.map(actor => [actor.id, actor.position.clone()]));
          sihangCampaign.northWallBreached = true;
          world.breachNorthWall();
          updateAI(.05);
          const after = sample();
          setGameState('playing');
          for (let i = 0; i < 200; i++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time); }
          setGameState('pause');
          return { before, after, final: sample(), moved: infantry.filter(actor =>
            actor.position.distanceTo(positions.get(actor.id)) > 1).length };
        }
      };` });
  });
  await page.goto(new URL('/?campaign=sihang&resources=low-memory', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href,
    { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.shieldReview || !document.getElementById('fatal').hidden,
    null, { timeout: 300000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing' &&
    document.getElementById('loading').hidden || !document.getElementById('fatal').hidden,
  null, { timeout: 180000 });
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  if (process.env.LIVE_ASSAULT_REVIEW === '1') {
    const records = [await page.evaluate(() => shieldReview.liveStart())];
    let breachedAt = null;
    for (let i = 0; i < 50; i++) {
      records.push(await page.evaluate(() => shieldReview.liveStep(5)));
      const last = records.at(-1);
      if (last.breached && breachedAt === null) breachedAt = last.time;
      await writeFile(join(directory, 'live-assault.json'), JSON.stringify({
        fixture: 'unmodified-normal-combat-player-idle', records, errors }, null, 2));
      console.log(JSON.stringify({time:last.time, stage:last.stage, breached:last.breached,
        phase:last.demolition.phase, living:last.demolition.members.length, outcome:last.outcome}));
      if (last.stage !== 'sihang-defense' || last.outcome || breachedAt !== null && last.time >= breachedAt + 35) break;
    }
    assert.deepEqual(errors, []);
  } else if (process.env.GRENADE_REVIEW_ONLY === '1') {
    const setup = await page.evaluate(() => shieldReview.setupThrow());
    await page.keyboard.press('ControlLeft');
    await page.keyboard.press('5');
    await page.waitForTimeout(500);
    await writeFile(join(directory, 'grenade-selection.json'), JSON.stringify(
      await page.evaluate(() => ({ state: window.__battle.state, grenades: window.__battle.grenades,
        controlInput: window.__battle.controlInput })), null, 2));
    await page.waitForFunction(() => window.__battle.grenades.equipped &&
      window.__battle.grenades.renderer.handVisible, null, { timeout: 30000 });
    await page.mouse.move(640, 360);
    await page.mouse.down();
    await page.waitForFunction(() => window.__battle.grenades.active.some(item =>
      item.source.soldierId === 'soldier-131' && item.phase !== 'flight'), null, { timeout: 10000 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForFunction(id => window.__battle.grenades.active.some(item =>
      item.source.soldierId === id && item.phase === 'flight'), setup.player, { timeout: 30000 });
    const flight = await page.evaluate(id => new Promise(resolve => {
      const frames = [];
      const collect = () => {
        const grenade = window.__battle.grenades.active.find(item => item.source.soldierId === id && item.phase === 'flight');
        if (!grenade) return resolve(frames);
        frames.push({ time: window.__battle.time, position: grenade.position, collisions: grenade.collisions,
          sideShields: shieldReview.sideShieldPositions() });
        if (grenade.collisions || grenade.position.x >= -.5 || frames.length >= 100) return resolve(frames);
        requestAnimationFrame(collect);
      };
      collect();
    }), setup.player);
    await writeFile(join(directory, 'grenade-flight.json'), JSON.stringify({ fixture:
      'manual-sapper-formation-and-player-position-real-grenade-input-enemy-fire-disabled-health-raised',
      setup, flight, hits: await page.evaluate(() => shieldReview.throwHits), errors }, null, 2));
    assert.ok(flight.some(frame => frame.position.x >= -.5 && frame.collisions === 0),
      'a thrown grenade must physically cross the side gap before its first collision');
    const crossingIndex = flight.findIndex(frame => frame.position.x >= -1.48);
    assert.ok(crossingIndex > 0, 'flight samples must bracket the side shield plane');
    const before = flight[crossingIndex - 1].position, after = flight[crossingIndex].position;
    const fraction = (-1.48 - before.x) / (after.x - before.x);
    const height = before.y + (after.y - before.y) * fraction;
    assert.ok(height > .6 && height < 1.5,
      `grenade must cross within the shield height, not fly over it (height ${height})`);
    const sideShields = flight[crossingIndex].sideShields;
    const z = before.z + (after.z - before.z) * fraction;
    const lower = sideShields.filter(center => center < z).at(-1);
    const upper = sideShields.find(center => center > z);
    assert.ok(lower !== undefined && upper !== undefined &&
      z - lower >= .565 && upper - z >= .565,
    'grenade must cross between two actual side plates with enough clearance for its radius');
    assert.deepEqual(errors, []);
  } else {
  const snapshot = await page.evaluate(() => shieldReview.setup());
  assert.equal(snapshot.shields, 20);
  const cases = [
    { name: 'side-plate', from: [-4, 1, -75], to: [-.5, 1, -75], blocked: true },
    { name: 'side-gap', from: [-4, 1, -74.4], to: [-.5, 1, -74.4], blocked: false },
    { name: 'roof-plate', from: [0, 3, -72 - 5.8 / 6], to: [0, 1.75, -72 - 5.8 / 6], blocked: true },
    { name: 'roof-gap', from: [0, 3, -72], to: [0, 1.75, -72], blocked: false },
  ];
  const records = [];
  for (const item of cases) {
    const result = await page.evaluate(({from, to}) => shieldReview.trace(from, to), item);
    records.push({ ...item, ...result });
  }
  await writeFile(join(directory, 'shield-traces.json'), JSON.stringify({ fixture: 'manually-positioned-native-sappers',
    snapshot, records, errors }, null, 2));
  const image = await page.evaluate(() => shieldReview.capture([-4, 2.4, -72], [0, 1, -72]));
  await writeFile(join(directory, 'shield-formation.png'), Buffer.from(image, 'base64'));
  const support = await page.evaluate(() => shieldReview.breachSupport());
  await writeFile(join(directory, 'breach-support.json'), JSON.stringify({ fixture: 'artificial-breach-living-sappers-actual-ai-steps',
    support }, null, 2));
  assert.equal(support.before.supportMembers, 20);
  assert.equal(support.after.supportMembers, 20, 'tank stand-off must remain while the sappers return');
  assert.equal(support.after.livingSappers, 20);
  assert.ok(support.final.livingSappers > 0, 'the test must observe infantry while the sappers are still returning');
  assert.ok(support.moved > 0, 'ordinary infantry must be able to advance before living sappers return');
  for (const record of records) {
    assert.equal(record.radius, .065);
    assert.equal(Boolean(record.bullet), record.blocked, `${record.name} bullet`);
    if (record.blocked) assert.equal(record.bullet.dynamic, true, `${record.name} shield`);
    assert.equal(Boolean(record.grenade), record.blocked, `${record.name} grenade`);
  }
  assert.deepEqual(errors, []);
  }
} finally {
  await browser.close();
}
