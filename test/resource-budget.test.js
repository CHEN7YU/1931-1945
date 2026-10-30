import test from 'node:test';
import assert from 'node:assert/strict';
import { NRA_FACE_NAME, NRA_HAND_NAME, nraAppearanceResourceBudget } from '../src/nra-appearance.js';

test('appearance resource ceilings follow eight face families, two uniforms, three builds and five complexions', () => {
  const meshes = [NRA_FACE_NAME, NRA_HAND_NAME, 'cloth', 'boot'].map(name => ({ name }));
  assert.deepEqual(nraAppearanceResourceBudget(meshes), { geometries: 16 + 6 + 6, materials: 10 });
  assert.deepEqual(nraAppearanceResourceBudget([...meshes, ...meshes]), nraAppearanceResourceBudget(meshes),
    'shared/repeated view meshes cannot inflate the cache budget');
});
