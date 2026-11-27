import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
try {
  if (process.env.OPENING_SEED !== undefined) {
    const seed = Number(process.env.OPENING_SEED);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'OPENING_SEED must be a uint32');
    await page.addInitScript(seedValue => {
      let state = seedValue;
      Math.random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      };
    }, seed);
  }
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
      const onOpeningBridge = position => Math.abs(position.x + 24) < 5 && position.z > 39 && position.z < 65;
      const originalUpdateOpeningCivilians = updateNanjingCivilians;
      let firstOpeningBridgeOverlap = null;
      let assaultSnapshot = null;
      const originalUpdateNanjingMission = updateNanjingMission;
      updateNanjingMission = function(dt) {
        const previouslyReleased = nanjingCampaign.openingAssaultReleased;
        originalUpdateNanjingMission(dt);
        if (!previouslyReleased && nanjingCampaign.openingAssaultReleased) {
          const opening = world.civilians.filter(person => person.userData.openingWave);
          assaultSnapshot = { time, crossed: opening.filter(person => person.userData.crossedRiver).length,
            deadBeforeCrossing: opening.filter(person => person.userData.dead && !person.userData.crossedRiver).length,
            pending: opening.filter(person => !person.userData.dead && !person.userData.crossedRiver)
              .map(person => person.userData.civilianId) };
        }
      };
      const observedOpeningSpawns = new Map();
      window.timedOpeningSpawns = () => Array.from(observedOpeningSpawns.values());
      updateNanjingCivilians = function(dt) {
        originalUpdateOpeningCivilians(dt);
        for (const civilian of world.civilians) {
          const data = civilian.userData;
          if (data.openingWave && data.active && !observedOpeningSpawns.has(data.civilianId)) {
            const record = { id: data.civilianId, time,
              x: civilian.position.x, z: civilian.position.z, indoors: data.openingInside };
            if (${process.env.TIMED_DIAGNOSTIC === '1' ? 'true' : 'false'} && data.civilianId >= 48) {
              camera.updateMatrixWorld(true);
              const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
                .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
              const peers = world.civilians.filter(other => other !== civilian && other.visible &&
                other.parent === scene && !other.userData.dead);
              record.camera = camera.position.toArray();
              record.state = state;
              record.controlled = controlledSoldier(entities)?.position.toArray();
              record.candidates = world.openingCivilianSources.map(point => {
                const visible = frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(point.x,
                  world.groundHeight(point.x, point.z) + 1.2, point.z), 1.7)) &&
                  !openingSourceHiddenByCover(point, camera.position, world.groundHeight);
                return { x: point.x, z: point.z, indoors: Boolean(point.street), visible,
                  blocked: circleBlocked(point.x, point.z, .45, movementObstacles(point.x, point.z)),
                  peerDistance: Math.min(Infinity, ...peers.map(other =>
                    Math.hypot(other.position.x - point.x, other.position.z - point.z))) };
              });
            }
            observedOpeningSpawns.set(data.civilianId, record);
          }
        }
        if (firstOpeningBridgeOverlap || !nanjingCampaign.openingAssaultReleased) return;
        const civilians=world.civilians.filter(c=>c.userData.openingWave&&c.visible&&!c.userData.dead&&onOpeningBridge(c.position)).length;
        const enemies=formations.filter(f=>f.team==='enemy'&&f.type==='infantry')
          .flatMap(f=>f.members).filter(a=>a.health>0&&onOpeningBridge(a.position)).length;
        if(civilians&&enemies) firstOpeningBridgeOverlap={time,civilians,enemies};
      };
      window.timedOpeningSample = () => {
        return { time, state, elapsed:nanjingCampaign.stageElapsed, released:nanjingCampaign.openingAssaultReleased,
          crossed:nanjingCampaign.civiliansCrossedRiver,
          casualties:nanjingCampaign.civilianCasualties,
          civilians:world.civilians.filter(c=>c.userData.openingWave&&c.visible&&!c.userData.dead&&onOpeningBridge(c.position)).length,
          enemies:formations.filter(f=>f.team==='enemy'&&f.type==='infantry')
            .flatMap(f=>f.members).filter(a=>a.health>0&&onOpeningBridge(a.position)).length,
          squads:formations.filter(f=>f.team==='enemy'&&f.type==='infantry'&&f.members.length).length,
          openingActive:world.civilians.filter(c=>c.userData.openingWave&&c.userData.active).length,
          openingDead:world.civilians.filter(c=>c.userData.openingWave&&c.userData.dead).length,
          late: ${process.env.TIMED_DIAGNOSTIC === '1' ? `world.civilians.filter(c=>c.userData.openingWave&&c.userData.civilianId>=48)
            .map(c=>({id:c.userData.civilianId,active:c.userData.active,dead:c.userData.dead,
              crossed:c.userData.crossedRiver,x:c.position.x,z:c.position.z,waypoint:c.userData.waypoint}))` : 'undefined'},
          firstOverlap:firstOpeningBridgeOverlap,assaultSnapshot,hud:$('objective-help').textContent };
      };` });
  });
  const url = new URL('/?campaign=nanjing&character=procedural', process.env.GAME_URL ?? 'http://127.0.0.1:5173');
  if (process.env.OPENING_LOW_MEMORY === '1') url.searchParams.set('resources', 'low-memory');
  if (process.env.TIMED_NATIVE === '1') url.searchParams.delete('character');
  await page.goto(url.href); await setQualityPreset(page, 'low'); await deployFromMenu(page);
  for (const second of [10, 20, 40, 60, 90, 120, 180, 240]) {
    await page.waitForFunction(second => window.__battle?.time >= second,
      second, { timeout: 180000 });
    const sample = await page.evaluate(() => timedOpeningSample());
    samples.push(sample); console.log(JSON.stringify(sample));
    if (sample.assaultSnapshot) break;
  }
  if (process.env.TIMED_RESULT) {
    const spawns = await page.evaluate(() => window.timedOpeningSpawns());
    await writeFile(process.env.TIMED_RESULT, JSON.stringify({ samples, spawns, errors,
      seed: process.env.OPENING_SEED ?? null,
      limitation: 'Normal game update, both sides active and player idle; low quality, optional procedural characters and optional test-seeded Math.random. Different paths can consume randomness differently.' }, null, 2));
  }
  for (const sample of samples.filter(sample => !sample.released)) {
    assert.equal(sample.squads, 0);
    assert.equal(sample.elapsed, 0);
    assert.match(sample.hud, /等待百姓过桥/);
  }
  const attack = samples.find(sample => sample.assaultSnapshot);
  assert.ok(attack, 'the opening attack must start after the refugees finish crossing');
  assert.deepEqual(attack.assaultSnapshot.pending, []);
  assert.equal(attack.assaultSnapshot.crossed + attack.assaultSnapshot.deadBeforeCrossing, 60);
  assert.equal(attack.squads, 8);
  assert.match(attack.hud, /日军已开始进攻/);
  assert.deepEqual(errors, []);
} finally {
  console.log(JSON.stringify({ samples, errors }));
  await browser.close();
}
