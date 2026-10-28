import * as THREE from 'three';

export function fitIjaPoint(point) {
  const y = point.y;
  const width = 1 - THREE.MathUtils.smoothstep(y, 1.15, 1.35);
  point.x *= 1 + .05 * width;
  point.z *= 1 + .04 * width;
  point.y = y <= .14 ? y : y <= .98 ? .14 + (y - .14) * (1 - .06495 / .84) : y - .06495;
  return point;
}

export function fitIjaProportions(root, skeleton, clips) {
  root.updateMatrixWorld(true);
  const positions = new Map(skeleton.bones.map(bone =>
    [bone, fitIjaPoint(bone.getWorldPosition(new THREE.Vector3()))]));
  const hips = skeleton.bones.find(bone => bone.name === 'Hips');
  if (!hips) throw new Error('Japanese proportions require the inspected hip joint');
  const originalHips = hips.position.clone();
  root.traverse(bone => {
    if (!positions.has(bone)) return;
    bone.position.copy(bone.parent.worldToLocal(positions.get(bone).clone()));
    bone.updateMatrixWorld(true);
  });
  const hipOffset = hips.position.clone().sub(originalHips), point = new THREE.Vector3();
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const vertices = mesh.geometry.attributes.position;
    const inverse = mesh.matrixWorld.clone().invert();
    for (let index = 0; index < vertices.count; index++) {
      point.fromBufferAttribute(vertices, index).applyMatrix4(mesh.matrixWorld);
      fitIjaPoint(point).applyMatrix4(inverse);
      vertices.setXYZ(index, point.x, point.y, point.z);
    }
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  });
  skeleton.calculateInverses();
  for (const clip of clips) for (const track of clip.tracks) {
    if (track.name !== 'Hips.position') continue;
    for (let index = 0; index < track.values.length; index += 3) {
      point.fromArray(track.values, index).sub(originalHips);
      point.x *= 1.05; point.z *= 1.04;
      point.add(originalHips).add(hipOffset).toArray(track.values, index);
    }
  }
  root.userData.proportions = { version: 1, helmetTopMeters: 1.683, historicalAcceptance: false,
    description: 'Shorter legs and modestly broader lower torso; unchanged shoulder/head proportions and boot clearance. Art direction, not a population measurement.' };
}
