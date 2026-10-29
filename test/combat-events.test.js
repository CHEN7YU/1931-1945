import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCombatEvents, COMBAT_EVENT_LIMIT, COMBAT_HISTORY_LIMIT } from '../src/combat-events.js';
import { captureImpact } from '../src/combat-effects.js';

const source = () => ({ credit: 'player', team: 'friendly', unitId: 'alpha', soldierId: 's1', weaponId: 's1:rifle', vehicleId: null, seatId: null });
const shot = () => ({ source: source(), weaponType: 'infantry', start: { x: 0, y: 1.4, z: 0 },
  end: { x: 0, y: 1.4, z: -30 }, muzzle: true, sound: 'shot', recoil: .05 });
const target = () => ({ kind: 'soldier', id: 'enemy-1', unitId: 'bravo', team: 'enemy' });
const emptyCounts = () => ({ shot: 0, impact: 0, explosion: 0, damage: 0, casualty: 0 });

test('shot feedback copies original source and geometry values without retaining model or actor references', () => {
  const events = createCombatEvents(), data = shot();
  data.source.actor = { health: 100 };
  data.start.model = { mutable: true };
  const event = events.publish('shot', { ...data, id: -1, type: 'wrong', time: -1 }, 2);
  data.source.soldierId = 's2'; data.start.x = 999; data.end.z = 999;
  assert.equal(event.source.soldierId, 's1');
  assert.equal(event.start.x, 0); assert.equal(event.end.z, -30);
  assert.equal('actor' in event.source, false);
  assert.equal('model' in event.start, false);
  assert.equal(event.type, 'shot'); assert.equal(event.time, 2); assert.equal(event.id, 1);
  assert.throws(() => { event.source.weaponId = 'another'; }, TypeError);
  assert.throws(() => { event.end.z = 0; }, TypeError);
});
test('automatic fire classification is copied and validated at the original shot event', () => {
  const events = createCombatEvents();
  assert.equal(events.publish('shot', { ...shot(), automatic: true }, 0).automatic, true);
  assert.equal(events.publish('shot', shot(), 0).automatic, undefined);
  assert.throws(() => events.publish('shot', { ...shot(), automatic: 'yes' }, 0), /Invalid shot/);
  assert.throws(() => events.publish('shot', { ...shot(), weaponType: 'tank', automatic: true }, 0), /Invalid shot/);
});
test('shot, impact and explosion render in order exactly once and publishing never requires a live shooter', () => {
  const events = createCombatEvents(), rendered = [], original = source();
  events.publish('shot', shot(), 1);
  events.publish('impact', { source: original, position: { x: 0, y: 1, z: -30 }, kind: 'stone', normal: { x: 0, y: 0, z: 1 } }, 1);
  original.soldierId = 'new-controller';
  events.publish('explosion', { source: source(), position: { x: 0, y: 0, z: -50 }, sound: true }, 4);
  assert.deepEqual(rendered, [], 'emitting simulation facts does not invoke a render callback');
  assert.equal(events.drain(event => rendered.push(event)), 3);
  assert.deepEqual(rendered.map(event => event.type), ['shot', 'impact', 'explosion']);
  assert.ok(rendered.every(event => event.source.soldierId === 's1'));
  assert.equal(events.drain(() => assert.fail('replayed feedback')), 0);
  assert.deepEqual(events.snapshot.published, events.snapshot.presented);
  assert.equal(events.snapshot.pending, 0);
});
test('a full 200-actor shot/impact burst is bounded, and overflow is explicit rather than silently dropped', () => {
  const events = createCombatEvents();
  for (let i = 0; i < COMBAT_EVENT_LIMIT; i++) {
    if (i < 600) {
      if (i % 3 === 0) events.publish('shot', shot(), i / 100);
      else if (i % 3 === 1) events.publish('damage', { source: source(), target: target(), amount: 50, health: 0 }, i / 100);
      else events.publish('casualty', { source: source(), target: target(), health: 0 }, i / 100);
    } else if (i < 800) events.publish('impact', { source: source(), position: { x: i, y: 0, z: 0 } }, i / 100);
    else events.publish('explosion', { source: source(), position: { x: i, y: 0, z: 0 }, sound: false }, i / 100);
  }
  assert.equal(events.snapshot.pending, COMBAT_EVENT_LIMIT);
  assert.equal(events.snapshot.history.length, COMBAT_HISTORY_LIMIT);
  assert.equal(events.snapshot.history[0].id, COMBAT_EVENT_LIMIT - COMBAT_HISTORY_LIMIT + 1);
  assert.throws(() => events.publish('shot', shot(), 6), /bounded capacity/);
  assert.equal(events.drain(() => {}), COMBAT_EVENT_LIMIT);
  assert.deepEqual(events.snapshot.presented, { shot: 200, impact: 200, explosion: COMBAT_EVENT_LIMIT - 800, damage: 200, casualty: 200 });
  const snapshot = events.snapshot;
  snapshot.history.length = 0; snapshot.published.shot = 0;
  assert.equal(events.snapshot.history.length, COMBAT_HISTORY_LIMIT);
  assert.equal(events.snapshot.published.shot, 200);
});
test('new battle clears pending feedback, history and counts, while crash sources remain explicit', () => {
  const events = createCombatEvents();
  const crash = events.publish('explosion', { source: { credit: 'environment', cause: 'crash', vehicleId: 'plane-1' },
    position: { x: 5, y: 0, z: 2 }, sound: false }, 1);
  assert.equal(crash.source.cause, 'crash');
  events.clear();
  assert.equal(events.drain(() => assert.fail('old battle feedback replayed')), 0);
  assert.deepEqual(events.snapshot, { pending: 0, history: [], published: emptyCounts(), presented: emptyCounts() });
  assert.equal(events.publish('shot', shot(), 0).id, 1);
});
test('explosion events preserve presentation styles without altering their gameplay radius or ownership', () => {
  const events = createCombatEvents();
  for (const style of ['default', 'explosive-pack', 'tank-destruction']) {
    const event = events.publish('explosion', { source: source(), position: { x: 0, y: 1.5, z: 0 },
      sound: true, radius: 9, style }, 1);
    assert.equal(event.style, style);
    assert.equal(event.radius, 9);
    assert.equal(event.source.weaponId, 's1:rifle');
  }
  assert.equal(events.publish('explosion', { source: source(), position: { x: 0, y: 0, z: 0 }, sound: false }, 1).style, 'default');
  assert.throws(() => events.publish('explosion', { source: source(), position: { x: 0, y: 0, z: 0 },
    sound: true, style: 'unknown' }, 1), /Invalid explosion style/);
  assert.equal(events.snapshot.pending, 4);
});
test('invalid feedback is explicit and cannot poison the event stream', () => {
  const events = createCombatEvents();
  for (const data of [{ ...shot(), source: null }, { ...shot(), weaponType: 'unknown' }, { ...shot(), color: -1 },
    { ...shot(), start: { x: NaN, y: 0, z: 0 } }, { ...shot(), muzzle: true, end: null }, { ...shot(), recoil: Infinity },
    { ...shot(), source: { ...source(), team: 'enemy' } },
    { ...shot(), source: { credit: 'environment', cause: 'crash', vehicleId: 'plane' } }]) assert.throws(() => events.publish('shot', data, 0));
  assert.throws(() => events.publish('impact', { source: source(), position: {}, kind: 'stone' }, 0));
  assert.throws(() => events.publish('explosion', { source: source(), position: { x: 0, y: 0, z: 0 } }, 0));
  assert.throws(() => events.publish('unknown', shot(), 0), RangeError);
  assert.throws(() => events.publish('shot', shot(), -1), RangeError);
  assert.equal(events.snapshot.pending, 0);
  assert.deepEqual(events.snapshot.published, emptyCounts());
});
test('applied damage and confirmed casualties snapshot targets and reject zero damage or live victims', () => {
  const events = createCombatEvents(), victim = target();
  victim.actor = { health: 50 };
  const event = events.publish('damage', { source: source(), target: victim, amount: 50, health: 50, observerId: 's1' }, 1);
  victim.id = 'replacement'; victim.actor.health = 0;
  assert.equal(event.target.id, 'enemy-1');
  assert.equal('actor' in event.target, false);
  assert.equal(event.observerId, 's1');
  assert.throws(() => { event.target.id = 'changed'; }, TypeError);
  for (const data of [{ amount: 0, health: 100 }, { amount: -1, health: 100 }, { amount: 50, health: -1 },
    { amount: 50, health: 50, observerId: {} }]) assert.throws(() => events.publish('damage', { source: source(), target: target(), ...data }, 1));
  assert.throws(() => events.publish('casualty', { source: source(), target: target(), health: 50 }, 1), /confirmed dead/);
  assert.throws(() => events.publish('casualty', { source: source(), target: { ...target(), kind: 'vehicle' }, health: 0 }, 1), /confirmed dead/);
  events.publish('casualty', { source: source(), target: target(), health: 0 }, 1);
  assert.equal(events.snapshot.published.damage, 1);
  assert.equal(events.snapshot.published.casualty, 1);
});
test('instanced mesh contact captures world-space normals and material without keeping the mesh alive', () => {
  const geometry = new THREE.PlaneGeometry(4, 4), material = new THREE.MeshBasicMaterial();
  material.userData.surface = 'timber';
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeRotationX(Math.PI / 2).scale(new THREE.Vector3(2, 1, 3)));
  mesh.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const incoming = new THREE.Vector3(-1, 0, 0);
  const hit = new THREE.Raycaster(new THREE.Vector3(5, 0, 0), incoming).intersectObject(mesh)[0];
  assert.ok(hit);
  const contact = captureImpact(hit, incoming), events = createCombatEvents();
  const event = events.publish('impact', { source: source(), ...contact }, 0);
  assert.equal(event.kind, 'wood');
  assert.ok(event.normal.x > .999);
  assert.ok(Math.abs(Math.hypot(event.normal.x, event.normal.y, event.normal.z) - 1) < 1e-8);
  assert.ok(Math.abs(event.position.x) < 1e-8);
  const opposite = captureImpact(hit, incoming.clone().negate());
  assert.ok(opposite.normal.x < -.999, 'captured normal faces against the actual incoming shot');
  material.userData.surface = 'brick'; hit.point.x = 999;
  assert.equal(event.kind, 'wood'); assert.ok(Math.abs(event.position.x) < 1e-8);
  assert.equal('object' in event, false); assert.equal('face' in event, false);
  assert.throws(() => captureImpact({ ...hit, face: null }, incoming), /face normal/);
  mesh.dispose(); geometry.dispose(); material.dispose();
});
