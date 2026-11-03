import test from 'node:test';
import assert from 'node:assert/strict';
import { civilianStepAvoidsThreats, observeCivilianThreats, planCivilianEscape,
  updateCivilianThreatResponse, CIVILIAN_THREAT } from '../src/civilian-threat.js';
import { segmentClear } from '../src/core.js';
import { moveCivilianInCrowd } from '../src/civilian-crowd.js';

const position = { x: 0, y: 0, z: 0 };
const enemy = (x, z, y = 0) => ({ health: 100, position: { x, y, z } });

test('civilians only perceive nearby visible live ground soldiers, not enemies behind walls or on ramparts', () => {
  const hidden = enemy(1, 0), seen = enemy(7, 0);
  const threats = observeCivilianThreats(position, [hidden, seen, enemy(1, 0, 8),
    { ...enemy(2, 0), health: 0 }, { ...enemy(3, 0), vehicleId: 'tank' }, enemy(50, 0)],
  (_from, to) => to.x !== 1);
  assert.deepEqual(threats, [seen.position]);
});

test('live Japanese tank crew trigger the same avoidance as infantry, without treating aircraft pilots as road threats',()=>{
  const tank={...enemy(3,-2),vehicleId:'tank',targetKind:'closed-armor'};
  const plane={...enemy(2,0),vehicleId:'plane',targetKind:'aircraft'};
  const queries=[];
  assert.deepEqual(observeCivilianThreats(position,[tank,{...tank},plane],(_from,_to,id)=>{queries.push(id);return true;}),
    [{...tank.position,vehicleId:'tank'}]);
  assert.deepEqual(queries,['tank'],'the tank hull cannot be mistaken for an opaque wall hiding its own crew');
  const data={civilianId:1},response=updateCivilianThreatResponse(data,position,{x:3,z:-20},[tank],[],0,()=>true,()=>false);
  assert.equal(response.mode,'flee');
  assert.ok(civilianStepAvoidsThreats(position,response.target,response.threats));
});

test('an approaching or parallel enemy produces an escape away from its body rather than following the original road', () => {
  for (const threat of [{ x: 0, y: 0, z: -5 }, { x: 2, y: 0, z: 0 }]) {
    const result = planCivilianEscape(position, { x: 0, z: -20 }, [threat], [], () => false);
    assert.equal(result.mode, 'flee');
    assert.ok(civilianStepAvoidsThreats(position, result.target, [threat]));
    assert.ok(Math.hypot(result.target.x - threat.x, result.target.z - threat.z) >
      Math.hypot(threat.x, threat.z) + 1);
  }
  assert.equal(civilianStepAvoidsThreats({ x: -8, z: 0 }, { x: 8, z: 0 }, [{ x: 0, z: 0 }]), false,
    'equal endpoint distances cannot authorize running through a soldier');
});

test('shelter, solid walls and a blocked bridge lead to cowering, never an escape through a wall or water', () => {
  const threats = [{ x: 0, y: 0, z: -5 }], destination = { x: 0, z: -20 };
  assert.deepEqual(planCivilianEscape(position, destination, threats, [], () => true),
    { mode: 'cower', target: null });
  const walls = [
    { minX: -10, maxX: -.5, minZ: -10, maxZ: 10, height: 3 },
    { minX: .5, maxX: 10, minZ: -10, maxZ: 10, height: 3 },
    { minX: -.5, maxX: .5, minZ: .5, maxZ: 10, height: 3 },
  ];
  assert.equal(planCivilianEscape(position, destination, threats, walls, () => false).mode, 'cower');
  const detourWalls = [{ minX: -1, maxX: 1, minZ: -3, maxZ: -2, height: 4 }];
  const result = planCivilianEscape(position, destination, threats, detourWalls, () => false);
  assert.equal(result.mode, 'flee');
  assert.ok(segmentClear(position, result.target, .38, detourWalls));
});

test('fear remembers a lost threat without oscillating each frame, then permits the original route again', () => {
  const data = { civilianId: 3 }, destination = { x: 0, z: -30 };
  const result = updateCivilianThreatResponse(data, position, destination, [enemy(0, -5)], [], 1, () => true, () => false);
  assert.equal(result.mode, 'flee');
  const oldTarget = { ...result.target };
  updateCivilianThreatResponse(data, position, destination, [], [], 1.1, () => false, () => true);
  assert.deepEqual(result.target, oldTarget);
  updateCivilianThreatResponse(data, position, destination, [], [], 2, () => false, () => true);
  assert.equal(result.mode, 'cower');
  updateCivilianThreatResponse(data, position, destination, [], [], 2 + CIVILIAN_THREAT.memorySeconds, () => false, () => true);
  assert.equal(result.mode, 'route');
  assert.equal(result.target, destination);
});

test('crowd sidesteps cannot quietly steer a fleeing person back into a nearby soldier', () => {
  const civilian = { position: { ...position }, userData: { civilianId: 1 } }, threats = [{ x: 2, z: 0 }];
  const before = { ...civilian.position };
  moveCivilianInCrowd(civilian, { x: 4, z: 0 }, .2, [civilian], [], [],
    (from, to) => civilianStepAvoidsThreats(from, to, threats));
  assert.ok(Math.hypot(civilian.position.x - 2, civilian.position.z) >= 1.985);
  assert.ok(Math.hypot(civilian.position.x - before.x, civilian.position.z - before.z) <= .2 + 1e-8);
});
