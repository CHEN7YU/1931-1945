import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const directory = new URL('../public/assets/game/ija-1938/', import.meta.url);

test('production Japanese character has verified provenance, normalized skinning and bounded near/far geometry', async () => {
  const [binary, manifest, original] = await Promise.all([
    readFile(new URL('character.glb', directory)),
    readFile(new URL('source.json', directory), 'utf8').then(JSON.parse),
    readFile(new URL('../nra-88/source.json', directory), 'utf8').then(JSON.parse),
  ]);
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  assert.equal(binary.readUInt32LE(4), 2);
  assert.equal(binary.readUInt32LE(8), binary.length);
  const jsonLength = binary.readUInt32LE(12);
  assert.equal(binary.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  assert.equal(binary.readUInt32LE(binStart + 4), 0x004e4942);
  const payload = binary.subarray(binStart + 8);
  assert.equal(manifest.modelSha256, createHash('sha256').update(binary).digest('hex'));
  const registration = manifest.files.find(file => file.file === 'character.glb');
  assert.equal(registration.bytes, binary.length);
  assert.equal(registration.sha256, manifest.modelSha256);
  assert.deepEqual(manifest.runtimeMotion.inactiveEmbeddedClips, ['walk', 'run']);
  assert.equal(manifest.sourceModelSha256, original.modelOriginalSha256);
  assert.deepEqual(manifest.permission, original.permission);
  assert.deepEqual(manifest.motionSource, original.motionSource);
  assert.equal(manifest.historicalAcceptance, false);
  assert.equal(manifest.sourceClothingTexturesIncluded, false);
  assert.equal(manifest.sourceInsigniaIncluded, false);
  assert.equal(manifest.proportions.version, 1);
  assert.equal(manifest.proportions.helmetTopMeters, 1.683);
  assert.equal(manifest.proportions.historicalAcceptance, false);
  assert.ok(binary.length < 8 * 1024 * 1024);
  assert.ok(gltf.skins.length > 0);
  const joints = gltf.skins[0].joints;
  const clothIndex = gltf.materials.findIndex(material => material.extensions?.KHR_materials_sheen);
  assert.ok(clothIndex >= 0);
  const linearToByte = value => Math.round(255 * (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055));
  assert.deepEqual(gltf.materials[clothIndex].pbrMetallicRoughness.baseColorFactor.slice(0, 3).map(linearToByte), [146, 124, 66],
    'production cloth must retain dark mustard-brown rather than grey-beige or bright yellow');
  assert.equal(joints.length, 65);
  assert.equal(new Set(joints.map(index => gltf.nodes[index].name)).size, 65);
  for (const skin of gltf.skins) assert.deepEqual(skin.joints, joints);
  assert.deepEqual(gltf.animations.map(clip => clip.name).sort(), ['idle', 'run', 'walk']);
  for (const clip of gltf.animations) {
    assert.ok(clip.channels.length > 0);
    for (const channel of clip.channels) {
      assert.ok(joints.includes(channel.target.node));
      assert.ok(['rotation', 'translation'].includes(channel.target.path));
    }
  }
  function component(accessorId, index, slot) {
    const accessor = gltf.accessors[accessorId], view = gltf.bufferViews[accessor.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const bytes = accessor.componentType === 5126 ? 4 : 2;
    assert.ok([5123, 5126].includes(accessor.componentType));
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) +
      index * (view.byteStride ?? width * bytes) + slot * bytes;
    return accessor.componentType === 5126 ? payload.readFloatLE(offset) : payload.readUInt16LE(offset);
  }
  for (const level of ['near', 'far']) {
    const group = gltf.nodes.find(node => node.name === level);
    assert.ok(group?.children.length > 0);
    let triangles = 0, batches = 0;
    let hasCloth = false;
    for (const child of group.children) {
      const node = gltf.nodes[child];
      assert.ok(Number.isInteger(node.skin));
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        hasCloth ||= primitive.material === clothIndex;
        assert.equal(primitive.mode ?? 4, 4);
        const { POSITION, JOINTS_0, WEIGHTS_0 } = primitive.attributes;
        const vertices = gltf.accessors[POSITION].count;
        assert.equal(gltf.accessors[JOINTS_0].count, vertices);
        assert.equal(gltf.accessors[WEIGHTS_0].count, vertices);
        for (let vertex = 0; vertex < vertices; vertex++) {
          let sum = 0;
          for (let slot = 0; slot < 4; slot++) {
            const weight = component(WEIGHTS_0, vertex, slot);
            assert.ok(Number.isFinite(weight) && weight >= 0 && weight <= 1);
            assert.ok(component(JOINTS_0, vertex, slot) < joints.length);
            sum += weight;
          }
          assert.ok(Math.abs(sum - 1) < 1e-5);
          for (let axis = 0; axis < 3; axis++) assert.ok(Number.isFinite(component(POSITION, vertex, axis)));
        }
        triangles += (primitive.indices === undefined ? vertices : gltf.accessors[primitive.indices].count) / 3;
        batches++;
      }
    }
    assert.deepEqual({ triangles, batches }, manifest.levels[level]);
    assert.ok(hasCloth, `${level} LOD must use the same mustard cloth material`);
    assert.ok(triangles > 0 && triangles < (level === 'near' ? 65000 : 24000));
    assert.ok(batches <= (level === 'near' ? 16 : 12));
  }
});
