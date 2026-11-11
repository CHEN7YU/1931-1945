import * as THREE from 'three';
import { createEmplacement, emplacementObstacles } from './emplacements.js';

export function addSihangBridgeDefenses(scene, world, positions) {
  const geometry = new THREE.CapsuleGeometry(.22, .5, 2, 6);
  geometry.rotateZ(Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geometry,
    new THREE.MeshStandardMaterial({ color: 0x857754, roughness: 1 }), positions.length * 24);
  mesh.name = 'sihang-bridgehead-sandbags';
  mesh.castShadow = mesh.receiveShadow = true;
  const transform = new THREE.Object3D();
  let count = 0;
  for (const point of positions) world.obstacles.push(...emplacementObstacles(createEmplacement(point)));
  for (const point of positions) for (const side of [-1, 1]) {
    // Two separated firing parapets leave the weapon muzzle and the retreat lane open.
    const x = point.x + side * 2.3, z = point.z - 1.8;
    for (let row = 0; row < 3; row++) for (let bag = 0; bag < 4; bag++) {
      transform.position.set(x + (bag - 1.5) * .85 + (row % 2 ? .15 : 0), .13 + row * .24, z);
      transform.scale.set(1, .55, 1); transform.updateMatrix();
      mesh.setMatrixAt(count++, transform.matrix);
    }
    world.obstacles.push({ minX: x - 1.9, maxX: x + 1.9, minZ: z - .24, maxZ: z + .24,
      minY: 0, height: .75, id: `${point.id}-sandbags-${side}` });
  }
  mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh); world.solids.push(mesh);
  return mesh;
}
