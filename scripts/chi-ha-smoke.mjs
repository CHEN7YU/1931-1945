import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5173';
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => {
  const data = window.__battle;
  return { state: data.state, time: data.time, objectives: data.objectives, vehicles: data.vehicles, counts: data.entityCounts,
    views: data.vehicleViews, population: { friendly: data.population.friendly, enemy: data.population.enemy },
    units: data.population.units, events: data.combatEvents, performance: data.performance,
    escorts: data.enemyPositions.filter(actor => actor.armorEscort).map(actor => ({
      id: actor.soldierId, x: actor.x, z: actor.z, mode: actor.mode, ...actor.armorEscort })) };
});
const tank = data => data.vehicles.find(vehicle => vehicle.variant === 'chi-ha');
try {
  await page.goto(origin);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 120000 });
  await page.locator('#menu-quality').selectOption('low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.vehicles.some(vehicle => vehicle.variant === 'chi-ha'));
  const initial = await snapshot();
  assert.equal(initial.population.enemy.alive, 96);
  assert.equal(initial.population.enemy.vehicles, 2);
  assert.equal(initial.population.friendly.alive, 110);
  assert.equal(initial.units.filter(unit => unit.team === 'enemy' && unit.type === 'infantry').length, 8);
  assert.equal(initial.units.filter(unit => unit.team === 'enemy').length, 10);
  assert.equal(tank(initial).seats.length, 4);
  assert.ok(tank(initial).seats.every(seat => seat.occupantId));
  assert.equal(initial.views.count, 2);
  assert.ok(initial.vehicles.every(vehicle => vehicle.machineGuns.length === 2 &&
    vehicle.machineGuns.every(gun => gun.ammo === 20 && gun.ownerId === vehicle.id)));
  await page.evaluate(() => {
    const observations = window.__chiHaSmoke = { samples: [], shots: [], damage: [], cooling: false,
      reloading: false, reachedObjectives: [], lastEvent: 0, lastSample: -5, active: true };
    const observe = () => {
      if (!observations.active) return;
      const data = window.__battle;
      const tanks = data.vehicles.filter(vehicle => vehicle.variant === 'chi-ha');
      for (const tank of tanks) {
        const objective = data.objectives.find(point => point.id === tank.ai?.objectiveId);
        if (objective && tank.health > 0 && tank.ai.distanceToObjective <= objective.radius &&
          !observations.reachedObjectives.some(visit => visit.vehicleId === tank.id && visit.objectiveId === objective.id)) {
          observations.reachedObjectives.push({ vehicleId: tank.id, objectiveId: objective.id, time: data.time,
            distance: tank.ai.distanceToObjective, position: tank.position });
        }
      }
      if (data.time >= observations.lastSample + 5 && observations.samples.length < 32) {
        observations.lastSample = data.time;
        observations.samples.push({ time: data.time, tanks });
      }
      for (const tank of tanks) for (const gun of tank.machineGuns) {
        observations.cooling ||= gun.cooldownUntil > data.time;
        observations.reloading ||= gun.reloadUntil > data.time;
      }
      for (const event of data.combatEvents.history) {
        if (event.id <= observations.lastEvent) continue;
        observations.lastEvent = event.id;
        if (!event.source.weaponId?.includes(':mg-')) continue;
        if (event.type === 'shot' && observations.shots.length < 160) {
          const tank = tanks.find(tank => tank.id === event.source.vehicleId);
          observations.shots.push({ ...event, owned: Boolean(tank?.machineGuns.some(gun => gun.id === event.source.weaponId) &&
            tank.seats.some(seat => seat.id === event.source.seatId && seat.occupantId === event.source.soldierId)) });
        }
        if (event.type === 'damage' && observations.damage.length < 32) observations.damage.push(event);
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  observations.push({ stage: 'eight-infantry-two-tanks', ...initial });
  await page.waitForFunction(() => window.__battle.vehicles.filter(vehicle => vehicle.variant === 'chi-ha')
    .every(vehicle => vehicle.trackDistance > 3), null, { timeout: 60000 });
  const moving = await snapshot();
  for (const vehicle of moving.vehicles) {
    assert.ok(vehicle.position.z > initial.vehicles.find(item => item.id === vehicle.id).position.z + 2,
      'each real tank moves south from its registered northern garage');
  }
  assert.ok(tank(moving).ai.path.length > 0);
  observations.push({ stage: 'actual-tank-navigation', ...moving });
  await page.waitForFunction(() => window.__battle.enemyPositions.some(actor => actor.armorEscort), null, { timeout: 120000 });
  const cooperating = await snapshot();
  for (const escort of cooperating.escorts) {
    const vehicle = cooperating.vehicles.find(vehicle => vehicle.id === escort.vehicleId);
    assert.ok(vehicle?.health > 0);
    const member = cooperating.units.flatMap(unit => unit.members).find(actor => actor.soldierId === escort.id);
    assert.ok(Math.hypot(member.x - vehicle.position.x, member.z - vehicle.position.z) <= 16.1);
    assert.ok(Math.hypot(member.x - escort.x, member.z - escort.z) <= 8.1);
  }
  observations.push({ stage: 'real-local-infantry-armor-cooperation', ...cooperating });
  await page.waitForFunction(() => window.__battle.time >= 100, null, { timeout: 240000 });
  const sustained = await page.evaluate(() => { window.__chiHaSmoke.active = false; return window.__chiHaSmoke; });
  const sustainedBattle = await snapshot();
  observations.push({ stage: 'hundred-second-convoy-and-machine-guns', ...sustained, ...sustainedBattle });
  for (const id of initial.vehicles.map(vehicle => vehicle.id)) {
    const samples = sustained.samples.map(sample => sample.tanks.find(vehicle => vehicle.id === id)).filter(Boolean);
    assert.ok(sustained.reachedObjectives.some(visit => visit.vehicleId === id),
      `${id} must actually enter its assigned objective, not merely accumulate track distance`);
    for (let i = 5; i < samples.length; i++) {
      const interval = samples.slice(i - 5, i + 1);
      if (interval.every(vehicle => vehicle.health > 0 && ['advance', 'blocked'].includes(vehicle.ai.mode))) {
        assert.ok(interval.at(-1).trackDistance - interval[0].trackDistance > 1,
          `${id} must not remain in advance/blocked beside its partner for 25 seconds: ${JSON.stringify(interval.at(-1))}`);
      }
    }
  }
  assert.ok(sustained.shots.length >= 5, 'the actual tank-mounted guns fire in battle');
  assert.ok(sustained.shots.every(shot => shot.owned), 'machine-gun credit uses the actual weapon and seated operator');
  assert.ok(sustained.cooling, 'short bursts actually enter their cooling interval');
  const exhaustedMagazine = sustainedBattle.vehicles.some(vehicle => vehicle.machineGuns.some(gun => gun.shots >= 20));
  assert.ok(!exhaustedMagazine || sustained.reloading, 'a magazine exhausted in battle must actually enter reload');
  assert.ok(sustained.damage.some(event => event.target.kind === 'soldier' && event.amount > 0),
    'machine-gun rounds apply actual ray-confirmed small-arms damage, not just effects');
  await page.keyboard.press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(500);
  assert.deepEqual(tank(await snapshot()), tank(paused), 'pause freezes turret, tracks, movement and reload');
  await page.locator('#back-menu').click();
  assert.equal((await snapshot()).counts.vehicles, 0);
  assert.equal((await snapshot()).views.count, 0);
  await page.locator('#squad-choices [data-type="tank"]').click();
  await deployFromMenu(page);
  let data = await snapshot();
  assert.equal(data.vehicles.length, 3);
  assert.equal(data.vehicles.filter(vehicle => vehicle.variant === 'chi-ha').length, 2);
  assert.equal(tank(data).health, 280);
  assert.ok(data.vehicles.some(vehicle => vehicle.team === 'friendly' && vehicle.seats.length === 3));
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__battle.vehicles.some(vehicle => vehicle.variant === 'chi-ha' && vehicle.ai?.shots > 0),
      null, { timeout: 180000 });
  } finally { await page.keyboard.up('w'); }
  data = await snapshot();
  observations.push({ stage: 'autonomous-live-main-gun-fire', ...data });
  const firingTank = data.vehicles.find(vehicle => vehicle.variant === 'chi-ha' && vehicle.ai?.shots > 0);
  assert.ok(firingTank.weapon.ammo === 0 || firingTank.weapon.reloadUntil > 0);
  assert.ok(data.events.history.some(event => event.type === 'shot' && event.source?.weaponId === firingTank.weapon.id),
    'shot credit belongs to the actual enemy hull and seated gunner');
  if (out) await page.screenshot({ path: join(out, 'chi-ha-live-battle.png') });
  assert.deepEqual(errors, []);

  if (out) {
    // A labelled close model check is separate from the real battle assertions above.
    await page.route('**/chi-ha-model-check', route => route.fulfill({ contentType: 'text/html',
      body: '<html><body style="margin:0;background:#bac0b7"><div style="position:fixed;top:24px;left:30px;font:18px sans-serif;color:#eee;z-index:2">CHI-HA / 57 mm / ORIGINAL PROCEDURAL MODEL<br>MODEL CHECK - NOT A GAMEPLAY SCREENSHOT</div></body></html>' }));
    await page.goto(new URL('/chi-ha-model-check', origin).href);
    await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const { chiHaModel, animateChiHa } = await import('/src/chi-ha-model.js');
      const scene = new THREE.Scene(); scene.background = new THREE.Color(0x68736b);
      const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, .1, 100);
      camera.position.set(-7.3, 3.7, -9.8); camera.lookAt(0, .9, 0);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.35;
      document.body.append(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xdce9ee, 0x74684d, 2.2));
      const sun = new THREE.DirectionalLight(0xffefd0, 3); sun.position.set(-5, 9, -5); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7 });
      sun.shadow.bias = -.0003; scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0x8b8067, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
      const model = chiHaModel(); scene.add(model); animateChiHa(model, 1.2, 0, false);
      renderer.render(scene, camera);
      window.__chiHaCheck = { scene, camera, renderer, model };
    });
    await page.screenshot({ path: join(out, 'chi-ha-model-front.png') });
    await page.evaluate(() => {
      const { renderer, camera, scene } = window.__chiHaCheck;
      camera.position.set(7.7, 3.4, 9.5); camera.lookAt(0, .9, 0); renderer.render(scene, camera);
    });
    await page.screenshot({ path: join(out, 'chi-ha-model-rear.png') });
  }
  console.log(`PASS: two four-man Chi-Ha tanks, sustained convoy movement, local infantry cover, actual machine-gun hits/bursts/cooling, main gun, pause, cleanup and new match. Magazine exhaustion/reload observed: ${sustained.reloading}.`);
} finally {
  if (out) await writeFile(join(out, 'chi-ha-observations.json'), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
