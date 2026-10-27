import * as THREE from 'three';

export function prepareNraRig(model) {
  return connectSharedSkinRig(model, 14, 65);
}

export function connectSharedSkinRig(model, expectedMeshes, expectedBones) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
  if (meshes.length !== expectedMeshes) throw new Error(`Expected ${expectedMeshes} inspected skins, got ${meshes.length}`);
  const canonical = new Map(meshes[0].skeleton.bones.map(bone => [bone.name, bone]));
  if (canonical.size !== expectedBones) throw new Error('Humanoid skeleton differs from the inspected asset');
  const rest = new Map([...canonical.values()].map(bone => [bone, bone.matrixWorld.clone()]));
  const parents = new Map([...canonical.values()].map(bone => {
    let ancestor = bone.parent;
    while (ancestor && (!canonical.has(ancestor.name) || ancestor.name === bone.name)) ancestor = ancestor.parent;
    return [bone, ancestor ? canonical.get(ancestor.name) : model];
  }));
  // Multi-skin FBX import nests same-name copies instead of connecting the next actual joint.
  for (const [bone, parent] of parents) if (bone.parent !== parent) parent.attach(bone);
  model.updateMatrixWorld(true);
  for (const [bone, matrix] of rest) {
    if (matrix.elements.some((value, index) => Math.abs(value - bone.matrixWorld.elements[index]) > 1e-4)) {
      throw new Error(`Rebuilding the NRA hierarchy changed its bind pose: ${bone.name}`);
    }
  }
  for (const mesh of meshes) {
    const original = mesh.skeleton;
    const bones = original.bones.map(bone => {
      const target = canonical.get(bone.name);
      if (!target || target.matrixWorld.elements.some((value, index) => Math.abs(value - bone.matrixWorld.elements[index]) > 1e-5)) {
        throw new Error(`NRA part has a mismatched bind pose: ${mesh.name}/${bone.name}`);
      }
      return target;
    });
    mesh.bind(new THREE.Skeleton(bones, original.boneInverses.map(matrix => matrix.clone())), mesh.bindMatrix);
  }
  const keep = new Set([model]);
  for (const node of [...canonical.values(), ...meshes]) for (let parent = node; parent; parent = parent.parent) keep.add(parent);
  const unused = [];
  model.traverse(node => { if (node.isBone && !keep.has(node)) unused.push(node); });
  for (const bone of unused) bone.removeFromParent();
  return { meshes, canonical };
}
