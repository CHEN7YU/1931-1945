import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTankCover, ARMOR_COOPERATION } from '../src/armor-cooperation.js';

const tank = { id: 'tank', team: 'enemy', type: 'tank', health: 280, heading: 0, position: { x: 0, z: 0 } };
function choose({ position = { x: 0, z: 5 }, vehicles = [tank], ...extra } = {}) {
  return chooseTankCover({ actor: { id: 'soldier', team: 'enemy', health: 100, groundType: 'infantry', index: 0,
    tactics: {}, position }, vehicles, objective: { x: 0, z: -100 }, blocked: () => false, clear: () => true,
    reserved: () => false, ...extra });
}
test('near infantry choose reachable rear cover behind a living same-team tank', () => {
  const cover = choose();
  assert.equal(cover.vehicleId, tank.id);
  assert.ok(cover.z >= ARMOR_COOPERATION.rearDistance);
  assert.ok(Math.abs(cover.x) < 1.16);
  assert.ok(Math.abs(cover.peek.x) > 2);
});
test('distant armor never diverts advancing infantry, including a tank hundreds of metres behind', () => {
  for (const position of [{ x: 0, z: -200 }, { x: 0, z: -20 }, { x: 17, z: 0 }]) assert.equal(choose({ position }), null);
  assert.equal(choose({ position: { x: 0, z: -7 } }), null, 'nearby forward infantry do not reverse eleven metres to reach the rear');
  assert.equal(choose({ position: { x: 0, z: -1 } }), null, 'a slot cannot increase objective distance by more than four metres');
});
test('rear cover rotates with the actual hull, and a tank facing away from danger offers no protection', () => {
  const rotated = { ...tank, heading: Math.PI, position: { x: 12, z: 10 } };
  const cover = choose({ position: { x: 12, z: 5 }, vehicles: [rotated], objective: { x: 12, z: 100 } });
  assert.ok(cover.z < 10); assert.equal(cover.vehicleId, tank.id);
  assert.equal(choose({ vehicles: [{ ...tank, heading: Math.PI }] }), null);
  assert.equal(choose({ threat: { x: 100, z: 0 } }), null, 'side fire is not falsely marked shielded by the hull');
});
test('wrecks, hostile vehicles, blocked routes, occupied slots and explicit player orders are not recruited', () => {
  for (const vehicles of [[{ ...tank, health: 0 }], [{ ...tank, team: 'friendly' }], [{ ...tank, type: 'plane' }]]) {
    assert.equal(choose({ vehicles }), null);
  }
  assert.equal(choose({ blocked: () => true }), null);
  assert.equal(choose({ clear: () => false }), null);
  assert.equal(choose({ reserved: () => true }), null);
  const actor = { team: 'enemy', health: 100, groundType: 'infantry', index: 0, tactics: {}, position: { x: 0, z: 5 } };
  assert.equal(choose({ actor: { ...actor, playerUnit: true } }), null);
  assert.equal(choose({ actor: { ...actor, vehicleId: tank.id } }), null);
});
test('nearer usable armor wins; existing slots remain stable and cannot be reserved twice', () => {
  const cover = choose({ vehicles: [tank, { ...tank, id: 'farther', position: { x: 8, z: 0 } }] });
  assert.equal(cover.vehicleId, tank.id);
  const second = choose({ reserved: (id, slot) => id === cover.vehicleId && slot === cover.slot });
  assert.notEqual(second.slot, cover.slot);
});
