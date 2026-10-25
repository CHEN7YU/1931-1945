import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceCapture, makeObjectives, CAPTURE_SECONDS, circleBlocked, moveGround, createNavigator, blastDamage, nextAlive, canDeploySquad, shotState, TYPES } from '../src/core.js';

test('objectives require a full uncontested twelve seconds and do not share mutable state', () => {
  const [point] = makeObjectives();
  assert.equal(advanceCapture(point, CAPTURE_SECONDS / 2, true, false), 'capturing');
  assert.equal(point.progress, .5);
  assert.equal(advanceCapture(point, 10, true, true), 'contested');
  assert.equal(point.progress, .5);
  assert.equal(advanceCapture(point, CAPTURE_SECONDS / 2, true, false), 'captured');
  assert.equal(point.captured, true);
  assert.equal(makeObjectives()[0].progress, 0);
});

test('unattended capture decays and completed objectives stay captured', () => {
  const [point] = makeObjectives();
  point.progress = .5;
  advanceCapture(point, 6, false, false);
  assert.equal(point.progress, .25);
  advanceCapture(point, 100, false, false);
  assert.equal(point.progress, 0);
  advanceCapture(point, 12, true, false);
  advanceCapture(point, 100, false, true);
  assert.equal(point.progress, 1);
});

test('collision permits wall sliding but never tunnels through buildings', () => {
  const walls = [{ minX: 2, maxX: 5, minZ: -5, maxZ: 5 }];
  assert.equal(circleBlocked(1.7, 0, .5, walls), true);
  const position = { x: 0, z: 0 };
  moveGround(position, 20, 0, .5, walls);
  assert.ok(position.x < 1.6);
  moveGround(position, 0, 10, .5, walls);
  assert.ok(position.z > 9);
  moveGround(position, 20, 0, .5, walls);
  assert.ok(position.x > 15);
  assert.equal(circleBlocked(108, 0, .5, []), true);
});

test('explosion damage falls off and has no effect outside radius', () => {
  assert.equal(blastDamage(0, 10, 160), 160);
  assert.equal(blastDamage(5, 10, 160), 80);
  assert.equal(blastDamage(10, 10, 160), 0);
  assert.equal(blastDamage(20, 10, 160), 0);
});

test('navigation finds the bridge corridor and never crosses solid cells', () => {
  const obstacles = [
    { minX: -108, maxX: 0, minZ: -21, maxZ: -11 },
    { minX: 16, maxX: 108, minZ: -21, maxZ: -11 },
    { minX: -1, maxX: 1, minZ: -22, maxZ: -10 },
    { minX: 15, maxX: 17, minZ: -22, maxZ: -10 },
  ];
  const findPath = createNavigator(obstacles);
  const path = findPath({ x: -10, z: 0 }, { x: -10, z: -40 });
  assert.ok(path.length > 0);
  const samples = [];
  let start = { x: -10, z: 0 };
  for (const end of path) {
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / .2));
    for (let i = 0; i <= steps; i++) samples.push({ x: start.x + (end.x - start.x) * i / steps, z: start.z + (end.z - start.z) * i / steps });
    start = end;
  }
  assert.ok(samples.some(p => p.z <= -12 && p.z >= -20 && p.x >= 1.46 && p.x <= 14.54));
  for (const p of samples) assert.equal(circleBlocked(p.x, p.z, .46, obstacles), false);
  const last = path.at(-1);
  assert.ok(Math.hypot(last.x + 10, last.z + 40) <= 3);
});

test('squad switching skips casualties and reports a wiped squad', () => {
  assert.equal(nextAlive([{ health: 100 }, { health: 0 }, { health: 70 }], 0), 2);
  assert.equal(nextAlive([{ health: 0 }, { health: 0 }], 0), -1);
});

test('a new squad is available only at match start or after every member has died', () => {
  const survivors = [{ health: 0 }, { health: 1 }, { health: 0 }, { health: 0 }];
  const wiped = survivors.map(() => ({ health: 0 }));
  assert.equal(canDeploySquad('menu', []), true);
  for (const state of ['playing', 'pause', 'victory', 'defeat']) {
    assert.equal(canDeploySquad(state, survivors), false);
    assert.equal(canDeploySquad(state, wiped), false);
  }
  assert.equal(canDeploySquad('dead', survivors), false);
  assert.equal(canDeploySquad('dead', wiped), true);
  assert.equal(canDeploySquad('dead', []), false);
  assert.equal(nextAlive(survivors, 0), 1);
});

test('all weapon types respect cadence, magazine and automatic reload', () => {
  for (const [type, settings] of Object.entries(TYPES)) {
    const unit = { type, ammo: settings.magazine, nextShot: 0, reloadUntil: 0 };
    assert.equal(shotState(unit, 0, true), true);
    assert.equal(unit.ammo, settings.magazine - 1);
    assert.equal(shotState(unit, .01, true), false);
    unit.ammo = 0;
    assert.equal(shotState(unit, 1, true), false);
    assert.equal(unit.reloadUntil, 1 + settings.reload);
    assert.equal(shotState(unit, 1.1, true), false);
    assert.equal(shotState(unit, unit.reloadUntil, false), false);
    assert.equal(unit.ammo, settings.magazine);
    assert.equal(unit.reloadUntil, 0);
  }
});
