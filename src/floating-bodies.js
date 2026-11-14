import * as THREE from 'three';
import { waterWaveHeight } from './water-waves.js';

export function createFloatingBodies(scene, factory, placements) {
  const up = new THREE.Vector3(0, 1, 0), normal = new THREE.Vector3();
  const yaw = new THREE.Quaternion();
  const bodies = placements.map((placement, index) => {
    const body = factory.create(index + 3000, 'adult', index % 2 ? 'woman' : 'man', 'none');
    const { joints } = body.civilianSkin;
    joints.leftArm.rotation.set(.22, 0, .22);
    joints.rightArm.rotation.set(-.16, 0, -.18);
    joints.leftElbow.rotation.x = .35;
    joints.rightElbow.rotation.x = .2;
    joints.leftLeg.rotation.x = .09;
    joints.rightLeg.rotation.x = -.06;
    body.rotation.x = Math.PI / 2;
    const float = new THREE.Group();
    float.name = 'floating-civilian-remains';
    float.userData.scenery = true;
    float.position.set(placement.x, placement.waterLevel, placement.z);
    float.rotation.y = placement.heading;
    float.add(body);
    scene.add(float);
    return { float, placement };
  });
  return {
    bodies: bodies.map(body => body.float),
    update(time) {
      for (const { float, placement } of bodies) {
        const { x, z, waterLevel, heading } = placement;
        const height = waterWaveHeight(x, z, time);
        const dx = (waterWaveHeight(x + .5, z, time) - waterWaveHeight(x - .5, z, time));
        const dz = (waterWaveHeight(x, z + .5, time) - waterWaveHeight(x, z - .5, time));
        float.position.y = waterLevel + height + .04;
        normal.set(-dx, 1, -dz).normalize();
        float.quaternion.setFromUnitVectors(up, normal).multiply(yaw.setFromAxisAngle(up, heading));
      }
    },
  };
}
