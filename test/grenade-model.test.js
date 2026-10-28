import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, PerspectiveCamera, Scene, Triangle, Vector3 } from 'three';
import { createGrenadeRenderer } from '../src/grenade-renderer.js';
import { throwableProfile } from '../src/grenades.js';
import { grenadeModel, explosivePackModel, grenadeHand, poseGrenadeHand, throwableGripPoint } from '../src/grenade-model.js';

test('throwing uses five articulated fingers, nails and a cuff rather than a sphere hand', () => {
  for (const side of ['left', 'right']) {
    const hand = grenadeHand(side), other = grenadeHand(side), before = new Box3().setFromObject(hand).getSize(new Vector3());
    assert.ok(before.x > .06 && before.x < .14 && before.y > .15 && before.y < .25);
    assert.notEqual(hand.getObjectByName('joint-1-0'), other.getObjectByName('joint-1-0'));
    assert.equal(hand.getObjectByName('palm').geometry.type, 'BufferGeometry');
    assert.ok(hand.getObjectByName('woven-cuff'));
    for (let finger = 0; finger < 4; finger++) assert.ok(hand.getObjectByName(`nail-${finger}`));
    assert.ok(hand.getObjectByName('thumbnail'));
    poseGrenadeHand(hand, .85); const closed = hand.getObjectByName('joint-1-1').rotation.x;
    poseGrenadeHand(hand, 0); assert.notEqual(hand.getObjectByName('joint-1-1').rotation.x, closed);
    assert.ok(Math.abs(other.getObjectByName('joint-1-1').rotation.x) < 1e-12);
    assert.throws(() => poseGrenadeHand(hand, NaN), RangeError);
  }
  const model = grenadeModel();
  for (const name of ['safety-ring', 'safety-lever', 'fuse-neck', 'cast-shell-ridges']) assert.ok(model.getObjectByName(name));
});

test('explosive pack is a shared original paper bundle with two separate bindings and a carrying loop', () => {
  const model = explosivePackModel(), second = explosivePackModel();
  for (const name of ['paper-wrappers', 'binding-strap-0', 'binding-strap-1', 'carrying-loop', 'pull-handle']) {
    assert.ok(model.getObjectByName(name));
    assert.equal(model.getObjectByName(name).geometry, second.getObjectByName(name).geometry);
  }
  const dimensions = new Box3().setFromObject(model).getSize(new Vector3());
  assert.ok(dimensions.z > .30 && dimensions.z < .4);
  assert.ok(dimensions.x < .15 && dimensions.y < .13);
  assert.notEqual(model.getObjectByName('binding-strap-0'), second.getObjectByName('binding-strap-0'));
  assert.equal(model.userData.paperRolls, 7);
});

test('detailed throwable surfaces and cheaper shared world models remain bounded and finite', () => {
  for (const factory of [grenadeModel, explosivePackModel]) {
    const counts = [];
    for (const detail of ['near', 'world']) {
      const model = factory(detail); let triangles = 0, batches = 0;
      model.traverse(part => {
        if (!part.isMesh) return;
        const { position, normal, uv } = part.geometry.attributes;
        assert.ok([...position.array, ...normal.array, ...uv.array].every(Number.isFinite));
        triangles += (part.geometry.index?.count ?? position.count) / 3; batches++;
      });
      assert.ok(batches <= 8 && triangles < (detail === 'near' ? 14000 : 4000), `${detail}: ${triangles} triangles/${batches} batches`);
      counts.push(triangles);
      assert.equal(factory(detail).children[0].geometry, model.children[0].geometry);
    }
    assert.ok(counts[1] < counts[0] * .6);
  }
  assert.ok(grenadeModel().getObjectByName('cast-shell-ridges').material.normalMap);
  assert.ok(explosivePackModel().getObjectByName('paper-wrappers').material.roughnessMap);
});

test('finger contact landmarks sit just outside the actual rendered shell and paper bundle surfaces', () => {
  for (const kind of ['grenade', 'explosive-pack']) {
    const model = kind === 'grenade' ? grenadeModel() : explosivePackModel();
    if (kind === 'explosive-pack') model.rotation.y = Math.PI / 2;
    model.updateMatrixWorld(true);
    const surfaces = kind === 'grenade'
      ? ['fragmentation-body', 'cast-shell-ridges'].map(name => model.getObjectByName(name))
      : [model.getObjectByName('paper-wrappers')];
    const triangles = [];
    for (const mesh of surfaces) {
      const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
      const count = indices?.count ?? positions.count;
      for (let at = 0; at < count; at += 3) {
        const triangle = new Triangle(...[0, 1, 2].map(corner =>
          new Vector3().fromBufferAttribute(positions, indices ? indices.getX(at + corner) : at + corner).applyMatrix4(mesh.matrixWorld)));
        if (triangle.getArea() > 1e-12) triangles.push(triangle);
      }
    }
    for (const x of [-.03, 0, .03]) for (const angle of [-.45, .7, 1.4, 2.1]) {
      const point = throwableGripPoint(kind, x, angle), closest = new Vector3(), normal = new Vector3();
      let distance = Infinity, signed = 0;
      for (const triangle of triangles) {
        triangle.closestPointToPoint(point, closest);
        const next = point.distanceTo(closest);
        if (next >= distance) continue;
        distance = next; signed = point.clone().sub(closest).dot(triangle.getNormal(normal));
      }
      assert.ok(distance < .006, `${kind}: contact gap ${distance}`);
      assert.ok(signed > -.001, `${kind}: contact penetrates the actual surface by ${signed}`);
    }
  }
});

test('armed world models remove released hardware without letting invisible parts hold the body above ground', () => {
  const scene = new Scene(), renderer = createGrenadeRenderer(scene, new PerspectiveCamera());
  for (const kind of ['grenade', 'explosive-pack']) {
    const grenade = { id: kind, kind, holderId: null, detonateAt: 4, phase: 'flight', resting: true,
      position: { x: 1, y: throwableProfile(kind).size + .02, z: Math.PI / 2 } };
    renderer.update([grenade], null, false);
    const model = scene.children.find(child => child.userData.grenadeId === kind);
    if (kind === 'grenade') {
      assert.equal(model.getObjectByName('safety-ring').visible, false);
      assert.equal(model.getObjectByName('safety-lever').visible, false);
      assert.equal(grenadeModel('world').getObjectByName('safety-ring').visible, true);
    }
    const bounds = new Box3();
    model.updateMatrixWorld(true);
    model.traverseVisible(part => { if (part.isMesh) bounds.expandByObject(part); });
    assert.ok(Math.abs(bounds.min.y - .023) < 1e-7, `${kind}: visible bottom ${bounds.min.y}`);
  }
  renderer.clear();
  assert.equal(scene.children.length, 0);
});
