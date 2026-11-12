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
    const c = Math.cos(point.heading), s = Math.sin(point.heading);
    const localX = side * 2.3, localZ = -1.8;
    const x = point.x + localX * c + localZ * s, z = point.z - localX * s + localZ * c;
    for (let row = 0; row < 3; row++) for (let bag = 0; bag < 4; bag++) {
      const offset = (bag - 1.5) * .85 + (row % 2 ? .15 : 0);
      transform.position.set(x + offset * c, .13 + row * .24, z - offset * s);
      transform.rotation.y = point.heading;
      transform.scale.set(1, .55, 1); transform.updateMatrix();
      mesh.setMatrixAt(count++, transform.matrix);
    }
    const extentX = 1.9 * Math.abs(c) + .24 * Math.abs(s);
    const extentZ = 1.9 * Math.abs(s) + .24 * Math.abs(c);
    world.obstacles.push({ oriented: true, angle: point.heading, cos: c, sin: s,
      cx: x, cz: z, hx: 1.9, hz: .24,
      minX: x - extentX, maxX: x + extentX, minZ: z - extentZ, maxZ: z + extentZ,
      minY: 0, height: .75, id: `${point.id}-sandbags-${side}` });
  }
  mesh.count = count; mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh); world.solids.push(mesh);
  return mesh;
}
