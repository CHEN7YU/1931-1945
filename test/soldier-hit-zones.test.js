import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, Raycaster } from 'three';
import { createSoldierHitSystem, createHitPoseSampler } from '../src/soldier-hit-zones.js';
import { soldierModel } from '../src/world.js';
import { damageForTarget } from '../src/combat-targets.js';
import { RIFLE } from '../src/rifle-action.js';

function fixture(team = 'enemy') {
  const actor = { id: 'target', team, friendly: team === 'friendly', health: 100, stance: 'standing',
    heading: 0, position: new Vector3(0, 0, -5), model: soldierModel(team === 'friendly') };
  const system = createSoldierHitSystem(() => { throw new Error('No native pose expected'); });
  const ray = new Raycaster();
  const cast = (x, y, z = 0, direction = new Vector3(0, 0, -1)) =>
    system.raycast(actor, 0, new Vector3(x, y, z), direction, ray);
  return { actor, system, ray, cast };
}

test('real anatomical intersections classify head/torso/limbs for both sides, not by world height', () => {
  for (const team of ['friendly', 'enemy']) {
    const { cast } = fixture(team);
    for (const [x, y, zone] of [[0, 1.65, 'head'], [0, 1.1, 'torso'], [-.135, .3, 'limb']]) {
      const hit = cast(x, y);
      assert.equal(hit?.object.userData.hitZone, zone);
      assert.equal(damageForTarget('rifle', 'person', 100, zone), zone === 'limb' ? 40 : 100);
      assert.ok(hit.distance > 4 && hit.distance < 6);
    }
  }
});

test('helmet edge, rifle barrel and backpack-only rays miss anatomy even if legacy decoration is hit', () => {
  const { actor, cast } = fixture();
  actor.model.position.copy(actor.position); actor.model.updateMatrixWorld(true);
  const legacy = new Raycaster();
  for (const [origin, direction] of [
    [new Vector3(.16, 1.76, 0), new Vector3(0, 0, -1)],
    [new Vector3(2, 1.39, -5.89), new Vector3(-1, 0, 0)],
    [new Vector3(2, 1.12, -4.72), new Vector3(-1, 0, 0)],
  ]) {
    legacy.set(origin, direction);
    assert.ok(legacy.intersectObject(actor.model, true).length > 0, 'test actually crosses the old equipment geometry');
    assert.equal(cast(origin.x, origin.y, origin.z, direction), null);
  }
});

test('crouched/prone targets vacate their standing head region and remain hittable at their actual body', () => {
  const { actor, cast } = fixture();
  for (const [stance, y, z] of [['crouched', 1.03, -5.015], ['prone', .42, -5.55]]) {
    actor.stance = stance;
    assert.equal(cast(0, 1.65), null);
    const hit = cast(0, y, z + 3);
    assert.equal(hit?.object.userData.hitZone, 'head');
  }
});

test('pose synchronization ignores render visibility, LOD, stale transforms and first-person body hiding', () => {
  const { actor, system, cast } = fixture();
  const proxy = system.sync(actor, 0);
  actor.model.visible = false; actor.model.position.set(100, 100, 100); actor.model.scale.setScalar(100);
  assert.equal(cast(0, 1.65)?.object.userData.hitZone, 'head');
  assert.equal(system.sync(actor, 1), proxy, 'no per-shot proxy allocation');
  actor.heading = Math.PI / 2; actor.position.set(3, .5, -8);
  const hit = system.raycast(actor, 2, new Vector3(3, 1.6, -3), new Vector3(0, 0, -1), new Raycaster());
  assert.equal(hit?.object.userData.hitZone, 'torso');
  assert.deepEqual(actor.position.toArray(), [3, .5, -8]);
  assert.equal(actor.health, 100);
});

test('the 180m boundary uses physical intersection distance, including origins inside a body volume', () => {
  const { actor, cast } = fixture();
  actor.position.z = -181;
  assert.equal(cast(0, 1.65), null);
  actor.position.z = -RIFLE.range;
  assert.ok(cast(0, 1.65));
  actor.position.z = -5;
  const inside = cast(0, 1.65, -5.015);
  assert.ok(inside && inside.distance > 0 && inside.distance < .2);
});

test('a shared lazy pose sampler does not create one skeleton per soldier or sample the rendered pool', () => {
  let created = 0, bound = null, calls = 0;
  const sample = createHitPoseSampler(() => {
    created++;
    return { get actorId() { return bound; }, bind(id) { bound = id; }, update(actor) { calls++; },
      get anatomy() { return { id: bound }; } };
  });
  for (let i = 0; i < 100; i++) assert.equal(sample({ id: `soldier-${i}` }, 0).id, `soldier-${i}`);
  assert.equal(created, 1); assert.equal(calls, 100);
});

test('missing native skeletons, invalid poses, dead and seated bodies cannot silently become standing targets', () => {
  const { actor, system, cast } = fixture();
  actor.nativeMotion = {};
  assert.throws(() => cast(0, 1), /No native pose/);
  delete actor.nativeMotion;
  actor.health = 0; assert.throws(() => system.sync(actor, 0), /living unseated/);
  actor.health = 100; actor.vehicleId = 'tank'; assert.throws(() => system.sync(actor, 0), /living unseated/);
  actor.vehicleId = null;
  assert.throws(() => system.raycast(actor, 0, new Vector3(), new Vector3(0, 0, -2), new Raycaster()), /normalized/);
});
