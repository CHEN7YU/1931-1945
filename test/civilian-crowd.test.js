import test from 'node:test';
import assert from 'node:assert/strict';
import { circleBlocked, createNavigator, segmentClear } from '../src/core.js';
import { obstacleLookup } from '../src/spatial.js';
import { NANJING_CIVILIAN_COUNT, civilianWaitingSlot, civilianWaypointReached, moveCivilianInCrowd, animateCivilianWaiting,
  nanjingOpeningCivilianStart, nanjingOpeningCivilianReleaseAt, civilianPaceMultiplier,
  releaseNanjingCivilianWave, createCivilianCrowdPlanner, rejoinCivilianRoute,
  activateCivilianEvacuation, closestCivilianForBoat, civilianBoardingSpeed } from '../src/civilian-crowd.js';

test('boarding chooses the physically nearest waiting civilian independently of queue order and uses a jog', () => {
  const queue = [8, 2, 5].map(x => ({ position: { x, y: 0, z: 0 } }));
  assert.equal(closestCivilianForBoat(queue, { x: 0, z: 0 }), queue[1]);
  assert.equal(closestCivilianForBoat([...queue].reverse(), { x: 10, z: 0 }), queue[0]);
  for (const age of ['adult', 'elderly', 'child']) assert.ok(civilianBoardingSpeed(age) >= 2.4);
});

test('visible residents can start evacuating at legal crowd spacing without applying the hidden-emergence gate twice', () => {
  const people = [0, .73].map((x, index) => ({ visible: true, position: { x, z: 0 },
    userData: { civilianId: index, active: false, releaseAt: 0 } }));
  for (const person of people) assert.equal(activateCivilianEvacuation(person, 1, people), true);
  assert.equal(people.length, 2, 'visible people already belong to the peer list');
  const hidden = { visible: false, position: { x: .1, z: 0 }, userData: { active: false, releaseAt: 0 } };
  assert.equal(activateCivilianEvacuation(hidden, 1, people), false, 'hidden people cannot emerge through an occupied body');
  hidden.position.x = 2;
  assert.equal(activateCivilianEvacuation(hidden, 1, people), true);
  assert.equal(people.length, 3);
  assert.equal(activateCivilianEvacuation(hidden, 2, people), true);
  assert.equal(people.length, 3, 'already-active people are not inserted again');
});

test('sixty bridge refugees have independent exterior positions, and the 120 residents do not emerge before the retreat order', () => {
  const starts = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianStart(index));
  for (let index = 0; index < starts.length; index++) {
    assert.ok(starts[index].z >= 39 && starts[index].z <= 64 && Math.abs(starts[index].x + 24) <= 2.2);
    for (const other of starts.slice(index + 1))
      assert.ok(Math.hypot(starts[index].x - other.x, starts[index].z - other.z) > .72);
  }
  const civilians = Array.from({ length: 180 }, (_, civilianId) => ({
    userData: { civilianId, homeId: civilianId % 20, withdrawalWave: civilianId >= 60,
      releaseAt: civilianId < 60 ? 0 : Infinity },
  }));
  releaseNanjingCivilianWave(civilians, 180);
  assert.equal(civilians[59].userData.releaseAt, 0);
  for (const person of civilians.slice(60)) assert.ok(person.userData.releaseAt >= 180 && person.userData.releaseAt < 242);
  for (let home = 0; home < 20; home++) {
    const releases = civilians.slice(60).filter(person => person.userData.homeId === home).map(person => person.userData.releaseAt);
    for (let index = 1; index < releases.length; index++) assert.ok(releases[index] - releases[index - 1] >= 1.4);
  }
});

test('opening refugees arrive in two uneven waves with a real release gap and independently varying walking speeds', () => {
  const releases = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianReleaseAt(index));
  assert.equal(releases[0], 0);
  assert.ok(releases[47] < 38);
  assert.equal(releases[48], 46);
  assert.ok(releases[48] - releases[47] >= 8);
  assert.ok(releases[59] < 66);
  assert.ok(new Set(releases.slice(1, 48).map((value, index) => (value - releases[index]).toFixed(3))).size > 30);
  const speeds = Array.from({ length: 180 }, (_, index) => civilianPaceMultiplier(index, 20));
  assert.ok(Math.max(...speeds) - Math.min(...speeds) > .3);
  assert.ok(speeds.every(speed => speed > .77 && speed < 1.26));
  assert.notEqual(civilianPaceMultiplier(1, 20), civilianPaceMultiplier(1, 30));
  const starts = Array.from({ length: 60 }, (_, index) => nanjingOpeningCivilianStart(index));
  assert.equal(new Set(starts.map(point => point.x)).size, 60);
});
test('crowds can spread through a shared street waypoint without cutting solid corners or missing their final slot', () => {
  const route = [{ x: 0, z: 0 }, { x: 0, z: -5 }];
  const position = { x: .7, z: 0 };
  assert.equal(civilianWaypointReached(position, route, 0, []), true);
  const corner = { minX: .25, maxX: 2, minZ: -3, maxZ: -.4, height: 3 };
  assert.equal(civilianWaypointReached(position, route, 0, [corner]), false);
  assert.equal(civilianWaypointReached({ x: .01, z: 0 }, route, 0, [corner]), true);
  assert.equal(civilianWaypointReached({ x: .7, z: -5 }, route, 1, []), false);
  assert.equal(civilianWaypointReached({ x: .01, z: -5 }, route, 1, []), true);
});

test('sixty individual waiting places form a dense crowd on the dock without merged bodies', () => {
  const slots = Array.from({ length: 60 }, (_, index) => civilianWaitingSlot(index));
  for (const [index, slot] of slots.entries()) {
    assert.ok(slot.x > -73 && slot.x < -64 && slot.z > -90 && slot.z < -70);
    assert.equal(slot.y, .36);
    for (const other of slots.slice(index + 1)) assert.ok(Math.hypot(slot.x - other.x, slot.z - other.z) >= .58);
  }
  assert.throws(() => civilianWaitingSlot(NANJING_CIVILIAN_COUNT), RangeError);
  assert.ok(new Set(slots.map(slot => Math.round(slot.z * 100))).size > 55, 'waiting people must not form grid rows');
  const nearest = slots.map((slot, index) => Math.min(...slots.filter((_, other) => other !== index)
    .map(other => Math.hypot(slot.x - other.x, slot.z - other.z))));
  assert.ok(nearest.reduce((sum, distance) => sum + distance, 0) / slots.length < 1, 'the crowd must actually be tightly packed');
});

test('one hundred and eighty civilians prefer the western dock instead of the eastern fighting approach', () => {
  const slots = Array.from({ length: NANJING_CIVILIAN_COUNT }, (_, index) => civilianWaitingSlot(index));
  assert.equal(slots.length, 180);
  assert.ok(slots.every(slot => slot.x < -59.8));
  for (let index = 0; index < slots.length; index++) for (const other of slots.slice(index + 1))
    assert.ok(Math.hypot(slots[index].x - other.x, slots[index].z - other.z) >= .74);
});
test('a moving civilian cannot pass through a waiting person or a solid barrier', () => {
  const first = { position: { x: 0, y: 0, z: 0 }, userData: { civilianId: 0 } };
  const second = { position: { x: 1, y: 0, z: 0 }, userData: { civilianId: 1 } };
  const wall = { minX: 2, maxX: 3, minZ: -4, maxZ: 4, height: 2 };
  for (let frame = 0; frame < 60; frame++) {
    moveCivilianInCrowd(first, { x: 4, z: 0 }, .1, [first, second], [wall]);
    assert.ok(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z) >= .72);
    assert.ok(first.position.x <= 1.64);
  }
  const dock = { position: { x: -65, y: 0, z: -80 }, userData: { civilianId: 2 } };
  moveCivilianInCrowd(dock, { x: -66, z: -80 }, .1, [dock], []);
  assert.equal(dock.position.y, .36, 'feet stand on the platform instead of sinking through its planks');
});

test('civilians can step sideways away from a solid corner before continuing along a street', () => {
  const person = { position: { x: .369, y: 0, z: 0 }, userData: { civilianId: 11 } };
  const wall = { minX: -3, maxX: 0, minZ: 0, maxZ: 5, height: 3 };
  const target = { x: -4, z: -1 };
  for (let frame = 0; frame < 200; frame++) moveCivilianInCrowd(person, target, .135, [person], [wall]);
  assert.ok(Math.hypot(person.position.x - target.x, person.position.z - target.z) < .02);
});

test('a civilian displaced from a city route replans around a long wall instead of oscillating at its face', () => {
  const person = { position: { x: .4, y: 0, z: 0 }, userData: { civilianId: 135 } };
  const wall = { minX: -4, maxX: 0, minZ: -4, maxZ: 4, height: 3 };
  const target = { x: -5, z: 0 };
  for (let frame = 0; frame < 600; frame++) {
    moveCivilianInCrowd(person, target, .135, [person], [wall]);
    assert.equal(circleBlocked(person.position.x, person.position.z, .36, [wall]), false);
  }
  assert.ok(Math.hypot(person.position.x - target.x, person.position.z - target.z) < .02);
});

test('a shared crowd step admits only one full detour search and invalidation never reuses a stale obstacle grid',()=>{
  const planner=createCivilianCrowdPlanner();
  planner.beginStep();
  assert.equal(planner.take(),true);assert.equal(planner.take(),false);
  planner.beginStep();assert.equal(planner.take(),true);
  const obstacles=[];let builds=0;
  assert.equal(planner.grid('dock',obstacles,()=>++builds),1);
  assert.equal(planner.grid('dock',obstacles,()=>++builds),1);
  planner.invalidate();
  assert.equal(planner.grid('dock',obstacles,()=>++builds),2);
  assert.equal(planner.stats.deferred,1);
});
test('six blocked civilians cannot trigger six full synchronous searches in one simulation step',()=>{
  const planner=createCivilianCrowdPlanner(),target={x:4,z:0};
  const people=Array.from({length:6},(_,index)=>({position:{x:-4,y:0,z:index*2},
    userData:{civilianId:index,crowdTarget:{...target},crowdBestDistance:0,crowdStalled:2}}));
  const wall={minX:0,maxX:1,minZ:-20,maxZ:20,height:3},obstacles=[wall];
  planner.beginStep();
  for(const person of people)moveCivilianInCrowd(person,target,.1,people,obstacles,obstacles,null,planner);
  assert.equal(planner.stats.searches,1);
  assert.equal(planner.stats.deferred,5);
  assert.ok(people.every(person=>!circleBlocked(person.position.x,person.position.z,.36,obstacles)));
});

test('waiting civilians look toward the boats, shift their upper bodies, and stop walking in place', () => {
  const limb = () => ({ rotation: { x: 1, set(x, y, z) { Object.assign(this, { x, y, z }); } } });
  const civilian = { position: { x: -66, y: .36, z: -80 }, rotation: {},
    userData: { civilianId: 5, carrying: 'none' }, civilianArms: [limb(), limb()],
    civilianLegs: [limb(), limb()], civilianTorso: limb(), civilianHead: limb() };
  const before = { ...civilian.position };
  animateCivilianWaiting(civilian, 10);
  const head = civilian.civilianHead.rotation.y;
  animateCivilianWaiting(civilian, 12);
  assert.notEqual(civilian.civilianHead.rotation.y, head);
  assert.ok(civilian.civilianLegs.every(leg => leg.rotation.x === 0));
  assert.deepEqual(civilian.position, before);
});

test('a refugee displaced behind a house or into a gate-side courtyard rejoins through a real exit rather than aiming through masonry', () => {
  for (const walls of [
    [{ minX: -2, maxX: 2, minZ: -14, maxZ: 14, height: 5 }],
    [{ minX: -2, maxX: -1, minZ: -14, maxZ: 14, height: 5 },
      { minX: 5, maxX: 6, minZ: -14, maxZ: 14, height: 5 },
      { minX: -2, maxX: 6, minZ: -14, maxZ: -13, height: 5 }],
  ]) {
    const position = { x: 3, z: 0 }, target = { x: -5, z: 0 };
    const navigate = createNavigator(walls, .5, .45);
    assert.equal(segmentClear(position, target, .36, walls), false);
    const route = rejoinCivilianRoute(position, target, navigate, walls);
    assert.ok(route?.length);
    let from = position;
    for (const point of route) {
      assert.ok(segmentClear(from, point, .36, walls));
      from = point;
    }
    assert.deepEqual(from, target);
    assert.ok(route.some(point => Math.abs(point.z) > 14), 'the route must leave the corner, not cut through its wall');
  }
});

test('route rejoining never accepts an unreachable destination or a near-cell substitute', () => {
  const position = { x: 0, z: 0 }, target = { x: 5, z: 5 };
  assert.equal(rejoinCivilianRoute(position, target, () => [], []), null);
  assert.equal(rejoinCivilianRoute(position, target, () => [{ x: 4, z: 4 }], []), null);
});

test('one difficult detour is split across steps rather than completing a whole grid and search in one callback', () => {
  const person={position:{x:-4,y:0,z:0},userData:{civilianId:1,crowdTarget:{x:4,z:0},
    crowdBestDistance:0,crowdStalled:2}};
  const planner=createCivilianCrowdPlanner(),wall={minX:0,maxX:1,minZ:-20,maxZ:20,height:3};
  const obstacles=[wall];
  planner.beginStep();
  moveCivilianInCrowd(person,{x:4,z:0},.1,[person],obstacles,obstacles,null,planner);
  assert.ok(person.userData.crowdSearch,'the costly job yields instead of blocking the simulation');
  for(let step=0;step<600;step++){
    planner.beginStep();
    moveCivilianInCrowd(person,{x:4,z:0},.1,[person],obstacles,obstacles,null,planner);
    assert.equal(circleBlocked(person.position.x,person.position.z,.36,obstacles),false);
  }
  assert.ok(planner.stats.maxGridCellsPerSlice<=512);
  assert.ok(planner.stats.maxExpandedPerSlice<=256);
  planner.invalidate();
  person.userData.crowdStalled=2;person.userData.crowdPath=null;
  planner.beginStep();
  moveCivilianInCrowd(person,{x:4,z:0},.1,[person],obstacles,obstacles,null,planner);
  assert.equal(person.userData.crowdSearchRevision,planner.revision);
});

test('indexed waypoint checks retain the exact full-obstacle result at walls, corners and final waiting positions', () => {
  const obstacles=[{minX:.25,maxX:2,minZ:-3,maxZ:-.4,height:3},
    ...Array.from({length:2000},(_,index)=>({minX:100+index%40,maxX:100.5+index%40,
      minZ:100+Math.floor(index/40),maxZ:100.5+Math.floor(index/40),height:4}))];
  const lookup=obstacleLookup(obstacles,.8),route=[{x:0,z:0},{x:0,z:-5}];
  for(let x=-1;x<2;x+=.07)for(let z=-1;z<1;z+=.13){
    const position={x,z};
    assert.equal(civilianWaypointReached(position,route,0,obstacles,lookup),
      civilianWaypointReached(position,route,0,obstacles));
  }
  for(const x of [0,.01,.016,.7])assert.equal(
    civilianWaypointReached({x,z:-5},route,1,obstacles,lookup),
    civilianWaypointReached({x,z:-5},route,1,obstacles));
});
