import * as THREE from 'three';
import { makeDoors, doorCollider, requestDoor, advanceDoor, resetDoors } from './doors.js';
import { circleBlocked } from './core.js';

export function createDoorWorld(scene, town, obstacles, solids, wood, iron) {
  const doors = makeDoors(town), navigationObstacles = [...obstacles];
  const leaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wood, doors.length);
  const bands = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wood, doors.length * 3);
  const handles = new THREE.InstancedMesh(new THREE.TorusGeometry(.055, .01, 8, 16), iron, doors.length * 2);
  leaf.userData.doorIds = doors.map(door => door.id);
  for (const mesh of [leaf, bands, handles]) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh);
  }
  solids.push(leaf);
  const pivot = new THREE.Object3D(), child = new THREE.Object3D();
  pivot.add(child);
  const colliders = doors.map(door => doorCollider(door));
  obstacles.push(...colliders);
  let onNavigationChanged = () => {};
  let onRequested = () => {};
  const activate = (door, actor, openOnly = false) => {
    const changed = requestDoor(door, actor, openOnly);
    if (changed) onRequested(door);
    return changed;
  };
  const draw = index => {
    const door = doors[index], along = door.width / 2;
    pivot.position.set(door.x - (door.axis === 'x' ? along : 0), 0, door.z - (door.axis === 'z' ? along : 0));
    pivot.rotation.y = door.angle;
    child.position.set(door.axis === 'x' ? along : 0, door.height / 2 + .01, door.axis === 'z' ? along : 0);
    child.rotation.set(0, 0, 0);
    child.scale.set(door.axis === 'x' ? door.width - .04 : .07, door.height, door.axis === 'z' ? door.width - .04 : .07);
    pivot.updateMatrixWorld(true);
    leaf.setMatrixAt(index, child.matrixWorld);
    for (let band = 0; band < 3; band++) {
      child.position.y = .2 + band * (door.height - .4) / 2;
      child.scale.set(door.axis === 'x' ? door.width - .08 : .12, .09, door.axis === 'z' ? door.width - .08 : .12);
      pivot.updateMatrixWorld(true);
      bands.setMatrixAt(index * 3 + band, child.matrixWorld);
    }
    for (let side = 0; side < 2; side++) {
      child.position.set(door.axis === 'x' ? door.width - .23 : (side ? -.1 : .1), door.height * .48,
        door.axis === 'z' ? door.width - .23 : (side ? -.1 : .1));
      child.rotation.set(0, door.axis === 'z' ? Math.PI / 2 : 0, 0);
      child.scale.set(1, 1, 1);
      pivot.updateMatrixWorld(true);
      handles.setMatrixAt(index * 2 + side, child.matrixWorld);
    }
    Object.assign(colliders[index], doorCollider(door));
    leaf.instanceMatrix.needsUpdate = bands.instanceMatrix.needsUpdate = handles.instanceMatrix.needsUpdate = true;
  };
  const syncNavigation = index => {
    const collider = colliders[index], door = doors[index], at = navigationObstacles.indexOf(collider);
    // Closed doors are traversable planning portals: AI must open them before walking through.
    if (door.state === 'open' && at < 0) navigationObstacles.push(collider);
    if (door.state === 'closed' && at >= 0) navigationObstacles.splice(at, 1);
    onNavigationChanged({ minX: door.x - door.width - 1, maxX: door.x + door.width + 1, minZ: door.z - door.width - 1, maxZ: door.z + door.width + 1 });
  };
  doors.forEach((door, index) => { draw(index); syncNavigation(index); });
  const cast = new THREE.Raycaster();
  const portal = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  return {
    doors, navigationObstacles,
    set onNavigationChanged(callback) { onNavigationChanged = callback; },
    set onRequested(callback) { onRequested = callback; },
    update(dt, occupants) {
      for (const [index, door] of doors.entries()) {
        const revision = door.revision;
        if (advanceDoor(door, dt, occupants)) draw(index);
        if (door.revision !== revision) syncNavigation(index);
      }
      leaf.computeBoundingSphere();
    },
    reset() {
      resetDoors(doors);
      doors.forEach((door, index) => { draw(index); syncNavigation(index); });
    },
    focus(camera) {
      const direction = camera.getWorldDirection(new THREE.Vector3());
      let selected = null, nearest = 2.5;
      for (const door of doors) {
        if (Math.hypot(camera.position.x - door.x, camera.position.z - door.z) > 3.5) continue;
        portal.setFromNormalAndCoplanarPoint(new THREE.Vector3(door.axis === 'z' ? 1 : 0, 0, door.axis === 'x' ? 1 : 0), new THREE.Vector3(door.x, 0, door.z));
        cast.set(camera.position, direction);
        if (!cast.ray.intersectPlane(portal, hitPoint)) continue;
        const distance = camera.position.distanceTo(hitPoint);
        if (distance > nearest || hitPoint.y < 0 || hitPoint.y > door.height || Math.abs(door.axis === 'z' ? hitPoint.z - door.z : hitPoint.x - door.x) > door.width / 2 + .15) continue;
        cast.far = distance - .03;
        const blocker = cast.intersectObjects(solids, false)[0];
        if (blocker && !(blocker.object === leaf && doors[blocker.instanceId]?.id === door.id)) continue;
        nearest = distance; selected = door;
      }
      return selected;
    },
    interact(door, actor) { return activate(door, actor); },
    openAhead(position, target) {
      for (const door of doors) {
        if (Math.abs(door.angle) > 1.48 || Math.hypot(position.x - door.x, position.z - door.z) > 2) continue;
        const dx = target.x - position.x, dz = target.z - position.z, length = Math.hypot(dx, dz);
        for (let distance = 0; distance <= Math.min(2.3, length); distance += .2) {
          const point = { x: position.x + dx / Math.max(length, .001) * distance, z: position.z + dz / Math.max(length, .001) * distance };
          if (circleBlocked(point.x, point.z, .43, [doorCollider(door)])) {
            activate(door, position, true);
            return door;
          }
        }
      }
      return null;
    },
  };
}
