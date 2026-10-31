import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { createDistantWeaponGeometry } from '../src/distant-pose-lod.js';
import { rifleWorldModel } from '../src/rifle-model.js';
import { createRifleState } from '../src/rifle-action.js';

await MeshoptSimplifier.ready;

test('expanded weapon triangles regain connectivity without changing the original geometry or material seams', () => {
  const indexed = new THREE.SphereGeometry(.1, 48, 24), source = indexed.toNonIndexed();
  indexed.dispose();
  const before = JSON.stringify(source.toJSON()), reduced = createDistantWeaponGeometry(source);
  assert.ok(reduced.index.count < source.attributes.position.count * .3);
  assert.ok(reduced.userData.distantWeaponLod.error <= .008001);
  const tuples = geometry => {
    const names = Object.keys(geometry.attributes);
    return Array.from({ length: geometry.attributes.position.count }, (_, vertex) => names.flatMap(name => {
      const attribute = geometry.attributes[name];
      return [...attribute.array.subarray(vertex * attribute.itemSize, (vertex + 1) * attribute.itemSize)];
    }).join(','));
  };
  const original = new Set(tuples(source));
  assert.ok(tuples(reduced).every(tuple => original.has(tuple)));
  for (const [name, attribute] of Object.entries(reduced.attributes)) {
    assert.notEqual(attribute.array.buffer, source.attributes[name].array.buffer);
  }
  assert.equal(JSON.stringify(source.toJSON()), before);
  source.dispose(); reduced.dispose();
});

for (const model of ['rifle', 'sniper', 'zb26', 'type11']) {
  test(`real ${model} world geometry is reduced, not just its vertex buffer`, () => {
    const root = rifleWorldModel('far', createRifleState(model), { bayonet: model === 'rifle' });
    root.updateMatrixWorld(true);
    let triangles = 0, reducedTriangles = 0;
    root.traverseVisible(mesh => {
      if (!mesh.isMesh) return;
      const source = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      source.clearGroups();
      const before = JSON.stringify(source.toJSON()), reduced = createDistantWeaponGeometry(source);
      triangles += (source.index?.count ?? source.attributes.position.count) / 3;
      reducedTriangles += reduced.index.count / 3;
      assert.equal(JSON.stringify(source.toJSON()), before);
      assert.ok(reduced.index.array.every(index => index < reduced.attributes.position.count));
      assert.ok(reduced.userData.distantWeaponLod.error <= .008001);
      assert.deepEqual(Object.keys(reduced.attributes), Object.keys(source.attributes));
      source.dispose(); reduced.dispose();
    });
    assert.ok(triangles > 1000);
    assert.ok(reducedTriangles < triangles * .55, `${model}: ${triangles} -> ${reducedTriangles}`);
  });
}
