import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Bone, Vector3 } from 'three';
import { lowStepTarget, runningStepTarget, turningStepTarget, applyNativeFootCycle, applyNativeRestStance,
  createNativeGaitProjection, NativeGaitReachError, applyNativeBodyLean } from '../src/nra-gait.js';
import { updateFootContacts } from '../src/foot-contact.js';

function legs() {
  const root = new Group(), bones = new Map(), hips = new Bone();
  root.add(hips); bones.set('Hips', hips);
  for (const side of ['Left', 'Right']) {
    const upper = new Bone(), knee = new Bone(), foot = new Bone();
    upper.position.set(side === 'Left' ? -.1 : .1, 1, 0);
    knee.position.set(0, -.4, -.2); foot.position.set(0, -.35, .2);
    hips.add(upper); upper.add(knee); knee.add(foot);
    for (const [name, bone] of [['UpLeg', upper], ['Leg', knee], ['Foot', foot]]) bones.set(`${side}${name}`, bone);
  }

  root.updateMatrixWorld(true);
  const restFeet = Object.fromEntries(['Left', 'Right'].map(side => [side, bones.get(`${side}Foot`).getWorldPosition(new Vector3())]));
  return { root, bones, restFeet };
}

test('real leg IK uses the simulation-owned planted contact when moving and turning', () => {
  const { root, bones, restFeet } = legs();
  const base = [...bones.values()].map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone() }));
  const gait = { jog: 0, walkStride: 1.25, runStride: 1.6, walkContact: .52,
    runContact: .4, walkClearance: .04, heelHeight: .2 };
  const actor = { health: 100, stance: 'standing', heading: 0, position: root.position,
    nativeMotion: { weight: 1, profile: { restFeet: Object.fromEntries(['Left', 'Right'].map(side =>
      [side.toLowerCase(), { x: restFeet[side].x, z: restFeet[side].z }])) } } };
  let anchor;
  for (let i = 0; i < 5; i++) {
    for (const entry of base) { entry.bone.position.copy(entry.position); entry.bone.quaternion.copy(entry.rotation); }
    actor.position.z = -.02 * i; actor.heading = .04 * i; root.rotation.y = actor.heading;
    root.updateMatrixWorld(true);
    const phase = .1 + .02 * i;
    updateFootContacts(actor, gait, phase, .02);
    anchor ??= { ...actor.nativeMotion.footContacts.left };
    const result = applyNativeFootCycle(root, bones, { weight: 1, upright: 1, hipDrop: .04,
      legLift: .55, walkPhase: phase, runPhase: phase, ...gait, footContacts: actor.nativeMotion.footContacts }, restFeet, () => 0);
    const foot = bones.get('LeftFoot').getWorldPosition(new Vector3());
    assert.ok(Math.hypot(foot.x - anchor.x, foot.z - anchor.z) < .001);
    assert.ok(result.left.error < 1e-5);
  }
});

test('resting legs on raised local support resolve the inner reach without stretching or throwing during anatomy sampling', () => {
  for (const floor of [.73, .75, .77, 1.2]) for (const yaw of [0, 1.3, Math.PI]) {
    const { root, bones, restFeet } = legs();
    root.rotation.y = yaw; root.updateMatrixWorld(true);
    const lengths = ['Left', 'Right'].flatMap(side => [bones.get(side + 'Leg').position.length(),
      bones.get(side + 'Foot').position.length()]);
    applyNativeRestStance(root, bones, { upright: 1, weight: 0, turn: { weight: 0 } }, restFeet, () => floor);
    assert.deepEqual(['Left', 'Right'].flatMap(side => [bones.get(side + 'Leg').position.length(),
      bones.get(side + 'Foot').position.length()]), lengths);
    assert.ok([...bones.values()].every(bone => bone.quaternion.toArray().every(Number.isFinite)));
  }
});

test('only a classified live pose failure rolls back modified legs and reports recovery while leaving anatomy intact', () => {
  const { root, bones, restFeet } = legs(), reports = [];
  const original = [...bones].map(([name, bone]) => [name, bone.position.toArray(), bone.quaternion.toArray()]);
  let calls = 0;
  const failure = new NativeGaitReachError('Native resting foot is unreachable: Right', { side: 'Right', error: .068 });
  const project = createNativeGaitProjection(root, bones, restFeet, () => {
    if (++calls === 2) throw failure;
    return 0;
  }, (error, context) => reports.push({ error, context }));
  const actor = { id: 'original-soldier', health: 100, team: 'enemy', stance: 'standing', position: new Vector3() };
  const motion = { upright: 1, weight: 0, turn: { weight: 0 } };
  assert.equal(project(actor, motion).legPose.recovered, true);
  assert.deepEqual([...bones].map(([name, bone]) => [name, bone.position.toArray(), bone.quaternion.toArray()]), original);
  assert.equal(reports.length, 1); assert.equal(reports[0].error, failure);
  assert.equal(reports[0].context.soldierId, actor.id);
  const invalid = createNativeGaitProjection(root, bones, restFeet, () => { throw new Error('corrupt collision'); }, () => {});
  assert.throws(() => invalid(actor, motion), /corrupt collision/);
  const initialization = createNativeGaitProjection(root, bones, restFeet, () => { throw failure; }, () => {});
  assert.throws(() => initialization({ ...actor, id: 'pose-bake' }, motion), NativeGaitReachError);
});

test('low steps use bounded foot trajectories without stretching legs or changing simulation state', () => {
  const results = [];
  for (const legLift of [.55, .85]) {
    const { root, bones, restFeet } = legs(), motion = { legLift, weight: 1, jog: 1, upright: 1,
      hipDrop: .09, walkPhase: .6, runPhase: .6, walkStride: 1.25, runStride: 2.4 };
    const before = structuredClone(motion), result = applyNativeFootCycle(root, bones, motion, restFeet, () => 0);
    assert.deepEqual(motion, before);
    assert.ok(result.left.error < 1e-5 && result.right.error < 1e-5);
    assert.ok(result.left.requestedLift > .1 && result.left.requestedLift < .3);
    assert.equal(bones.get('LeftLeg').position.y, -.4);
    assert.equal(bones.get('LeftFoot').position.y, -.35);
    results.push(result.left.requestedLift);
  }
  assert.ok(results[1] - results[0] > .003);
});

test('low-step feet follow a submerged walking floor instead of targeting the dry-world surface', () => {
  const { root, bones } = legs();
  root.position.y = -1.765;
  root.updateMatrixWorld(true);
  const restFeet = Object.fromEntries(['Left', 'Right'].map(side =>
    [side, root.worldToLocal(bones.get(`${side}Foot`).getWorldPosition(new Vector3()))]));
  const motion = { weight: 1, upright: 1, jog: 0, hipDrop: 0, legLift: .55,
    walkPhase: .6, runPhase: .6, walkStride: 1.25, runStride: 2.4 };
  const groundAt = (_x, _z) => root.position.y;
  const result = applyNativeFootCycle(root, bones, motion, restFeet, groundAt);
  assert.equal(result.left.floor, -1.765);
  assert.equal(result.right.floor, -1.765);
  assert.ok(result.left.error < 1e-5 && result.right.error < 1e-5);
});

test('low-step gait leaves stationary and static combat postures unchanged', () => {
  for (const changes of [{ upright: 0 }, { weight: 0 }]) {
    const { root, bones, restFeet } = legs();
    assert.deepEqual(applyNativeFootCycle(root, bones, { legLift: .55, weight: 1, jog: 1, upright: 1, ...changes },
      restFeet, () => 0), { kind: 'native-foot-cycle', weight: 0 });
  }
});

test('turn steps alternate planted support with a low swing and close continuously in either direction', () => {
  for (const direction of [-1, 1]) {
    for (let frame = 0; frame < 100; frame++) {
      const phase = frame / 100, foot = turningStepTarget(phase, direction);
      assert.ok(foot.lift >= 0 && foot.lift <= .055);
      if (phase < .55) {
        assert.equal(foot.lift, 0);
        assert.ok(Math.abs(foot.yaw + direction * phase * Math.PI / 3) < 1e-10,
          'support counter-rotates the root instead of skating around it');
      }
    }
    assert.ok(Math.abs(turningStepTarget(.999999, direction).yaw) < .00001);
    assert.ok(turningStepTarget(.75, direction).lift > .05);
    assert.equal(turningStepTarget(.25, direction).lift, 0);
  }
  assert.throws(() => turningStepTarget(1, 1), RangeError);
});

test('actual turning leg IK keeps the planted foot in world space while the other foot steps without stretching', () => {
  for (const direction of [-1, 1]) {
    const planted = [];
    for (const phase of [.05, .15, .25, .35, .45]) {
      const { root, bones, restFeet } = legs();
      root.rotation.y = direction * phase * Math.PI / 3;
      root.updateMatrixWorld(true);
      const result = applyNativeFootCycle(root, bones, {
        weight: 0, upright: 1, hipDrop: 0, jog: 0, legLift: .55,
        walkPhase: 0, runPhase: 0, walkStride: 1.25, runStride: 2.4,
        turn: { weight: 1, phase, direction },
      }, restFeet, () => 0);
      assert.equal(result.left.phase, 'turn-support');
      assert.ok(result.left.error < 1e-5 && result.right.error < 1e-5);
      planted.push(bones.get('LeftFoot').getWorldPosition(new Vector3()));
      assert.equal(bones.get('LeftLeg').position.y, -.4);
      assert.equal(bones.get('LeftFoot').position.y, -.35);
    }
    assert.ok(planted.every(point => point.distanceTo(planted[0]) < 1e-5));
  }
});

test('rising folded legs keep grounded targets outside inner reach without stretching bones', () => {
  for (const yaw of [0, 1.3]) {
    const { root, bones } = legs();
    root.rotation.y = yaw;
    for (const side of ['Left', 'Right']) {
      bones.get(`${side}Leg`).position.set(0, -.55, 0);
      bones.get(`${side}Foot`).position.set(0, -.25, 0);
    }
    root.updateMatrixWorld(true);
    const restFeet = Object.fromEntries(['Left', 'Right'].map(side =>
      [side, root.worldToLocal(bones.get(`${side}Foot`).getWorldPosition(new Vector3()))]));
    const result = applyNativeFootCycle(root, bones, { weight: 1, upright: 1, hipDrop: .75,
      jog: 0, legLift: .55, walkPhase: .26, runPhase: .26, walkStride: .1, runStride: .1 }, restFeet, () => 0);
    for (const side of ['Left', 'Right']) {
      assert.ok(result[side.toLowerCase()].error < 1e-5);
      assert.ok(bones.get(`${side}Foot`).getWorldPosition(new Vector3()).y >= restFeet[side].y - 1e-5);
      assert.equal(bones.get(`${side}Leg`).position.y, -.55);
      assert.equal(bones.get(`${side}Foot`).position.y, -.25);
    }
  }
});

test('running has rear-heel recovery distinct from low walking without high forward foot lifts', () => {
  const samples = Array.from({ length: 100 }, (_, index) => runningStepTarget(index / 100, 2.4, .24));
  assert.ok(samples.some(point => point.stage === 'rear-recovery' && point.z > .1 && point.lift > .18));
  assert.ok(samples.filter(point => point.z < -.2).every(point => point.lift < .08));
  assert.ok(samples.every(point => point.lift >= 0 && point.lift <= .24));
  assert.ok(Math.abs((runningStepTarget(.1, 2.4, .24).z - runningStepTarget(.05, 2.4, .24).z) - .12) < 1e-10);
  assert.ok(lowStepTarget(.6, 1.25, .52, .04).lift < .05);
});

test('ground-contact travel matches actual stride while swing clearance stays below eight centimetres', () => {
  for (const [stride, duty] of [[1.25, .52], [2.4, .27]]) {
    for (let frame = 0; frame < 100; frame++) {
      const phase = frame / 100, point = lowStepTarget(phase, stride, duty, .07);
      assert.ok(point.lift >= 0 && point.lift <= .07);
      if (phase < duty) assert.equal(point.lift, 0);
    }
    const a = lowStepTarget(.05, stride, duty, .07), b = lowStepTarget(.1, stride, duty, .07);
    assert.ok(Math.abs((b.z - a.z) - stride * .05) < 1e-10);
    assert.ok(Math.abs(lowStepTarget(.999999, stride, duty, .07).z - lowStepTarget(0, stride, duty, .07).z) < 1e-5);
  }
});

test('torso lean follows the actor-facing direction and counter-rotates the head without moving the hips', () => {
  const root = new Group(), spine = new Bone(), head = new Bone();
  spine.position.y = 1; head.position.y = .5; root.add(spine); spine.add(head); root.rotation.y = 1.3;
  root.updateMatrixWorld(true);
  const before = spine.getWorldPosition(new Vector3());
  applyNativeBodyLean(root, new Map([['Spine', spine], ['Head', head]]), { bodyLean: .2 });
  const point = head.getWorldPosition(new Vector3());
  assert.ok(point.x < -.09 && point.z < 0 && point.y < 1.5);
  assert.ok(spine.getWorldPosition(new Vector3()).distanceTo(before) < 1e-10);
});

test('firing can blade the shoulders while keeping head and feet facing the actual shot direction', () => {
  const root = new Group(), spine = new Bone(), head = new Bone(), left = new Bone(), right = new Bone();
  spine.position.y = 1.1; head.position.y = .45;
  left.position.set(-.2, .3, 0); right.position.set(.2, .3, 0);
  root.add(spine); spine.add(head, left, right); root.rotation.y = .8; root.updateMatrixWorld(true);
  applyNativeBodyLean(root, new Map([['Spine', spine], ['Head', head]]), { bodyLean: 0, torsoYaw: -.55 });
  const a = root.worldToLocal(left.getWorldPosition(new Vector3())), b = root.worldToLocal(right.getWorldPosition(new Vector3()));
  assert.ok(a.z < b.z - .15, 'left shoulder comes forward instead of stretching the support arm');
  const facing = head.getWorldDirection(new Vector3()), expected = root.getWorldDirection(new Vector3());
  assert.ok(facing.distanceTo(expected) < 1e-8);
  assert.equal(root.rotation.y, .8);
});
