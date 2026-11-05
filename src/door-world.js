import * as THREE from 'three';
import { makeDoors, doorCollider, requestDoor, advanceDoor, resetDoors } from './doors.js';
import { circleBlocked } from './core.js';

export function createDoorWorld(scene, town, obstacles, solids, wood, iron, leafMaterial = wood) {
  const doors = makeDoors(town), navigationObstacles = [...obstacles];
  const leaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), leafMaterial, doors.length);
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
  const proxy = new THREE.Mesh(leaf.geometry, leaf.material), instance = new THREE.Matrix4(), identity = new THREE.Matrix4();
  const bounds = new THREE.Box3(), intersection = new THREE.Vector3(), doorHits = [];
  const raycastStats = { queries: 0, bounds: 0, meshTests: 0 };
  leaf.raycast = (raycaster, hits) => {
    raycastStats.queries++;
    const localWorld = leaf.matrixWorld.equals(identity);
    for (let index = 0; index < doors.length; index++) {
      const box = colliders[index]; raycastStats.bounds++;
      bounds.min.set(box.minX, 0, box.minZ); bounds.max.set(box.maxX, box.height + .02, box.maxZ);
      if (!localWorld) bounds.applyMatrix4(leaf.matrixWorld);
      if (!bounds.containsPoint(raycaster.ray.origin) && (!raycaster.ray.intersectBox(bounds, intersection) ||
        intersection.distanceToSquared(raycaster.ray.origin) > raycaster.far ** 2)) continue;
      raycastStats.meshTests++;
      leaf.getMatrixAt(index, instance);
      proxy.matrixWorld.multiplyMatrices(leaf.matrixWorld, instance);
      doorHits.length = 0; proxy.raycast(raycaster, doorHits);
      for (const hit of doorHits) { hit.object = leaf; hit.instanceId = index; hits.push(hit); }
    }
  };
  let onNavigationChanged = () => {};
  let onRequested = () => {};
  let blockedDoors = [];
  const updateStats = { navigationBatches: 0, changedDoors: 0, sphereUpdates: 0 };
  const notifyRegions = regions => {
    if (!regions.length) return;
    updateStats.navigationBatches++; updateStats.changedDoors += regions.length;
    onNavigationChanged({ minX: Math.min(...regions.map(region => region.minX)),
      maxX: Math.max(...regions.map(region => region.maxX)), minZ: Math.min(...regions.map(region => region.minZ)),
      maxZ: Math.max(...regions.map(region => region.maxZ)) }, regions);
  };
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
  const syncNavigation = (index, notify = true) => {
    const collider = colliders[index], door = doors[index], at = navigationObstacles.indexOf(collider);
    // Closed doors are traversable planning portals: AI must open them before walking through.
    if (door.state === 'open' && at < 0) navigationObstacles.push(collider);
    if (door.state === 'closed' && at >= 0) navigationObstacles.splice(at, 1);
    const bounds = { minX: door.x - door.width - 1, maxX: door.x + door.width + 1,
      minZ: door.z - door.width - 1, maxZ: door.z + door.width + 1 };
    if (notify) onNavigationChanged(bounds, [bounds]);
    return bounds;
  };
  doors.forEach((door, index) => { draw(index); syncNavigation(index); });
  leaf.computeBoundingSphere(); updateStats.sphereUpdates++;
  const cast = new THREE.Raycaster();
  const portal = new THREE.Plane();
  const hitPoint = new THREE.Vector3();
  return {
    doors, navigationObstacles, raycastStats, updateStats,
    set onNavigationChanged(callback) { onNavigationChanged = callback; },
    set onRequested(callback) { onRequested = callback; },
    update(dt, occupants) {
      const regions = [];
      let moved = false;
      for (const [index, door] of doors.entries()) {
        const revision = door.revision;
        if (advanceDoor(door, dt, occupants)) { draw(index); moved = true; }
        if (door.revision !== revision) regions.push(syncNavigation(index, false));
      }
      blockedDoors = doors.filter(door => door.blocked);
      if (moved) { leaf.computeBoundingSphere(); updateStats.sphereUpdates++; }
      notifyRegions(regions);
    },
    reset() {
      resetDoors(doors);
      blockedDoors = [];
      const regions = doors.map((door, index) => { draw(index); return syncNavigation(index, false); });
      leaf.computeBoundingSphere(); updateStats.sphereUpdates++;
      notifyRegions(regions);
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
    swingEscape(position, radius = .42) {
      for (const door of blockedDoors) {
        if (Math.hypot(position.x - door.x, position.z - door.z) > door.width + 1) continue;
        const travel = Math.sign(door.targetAngle - door.angle) * Math.min(.025, Math.abs(door.targetAngle - door.angle));
        if (!travel || !circleBlocked(position.x, position.z, radius, [doorCollider(door, door.angle + travel)])) continue;
        const hx = door.x - (door.axis === 'x' ? door.width / 2 : 0);
        const hz = door.z - (door.axis === 'z' ? door.width / 2 : 0);
        const dx = position.x - hx, dz = position.z - hz, length = Math.max(.01, Math.hypot(dx, dz));
        const candidates = [
          { x: position.x + dx / length * .9, z: position.z + dz / length * .9 },
          { x: position.x - dz / length * .9, z: position.z + dx / length * .9 },
          { x: position.x + dz / length * .9, z: position.z - dx / length * .9 },
        ];
        return candidates.find(point => !circleBlocked(point.x, point.z, radius, obstacles) &&
          !circleBlocked(point.x, point.z, radius, [doorCollider(door, door.angle + travel)]) &&
          [0.25, .5, .75].every(t => !circleBlocked(position.x + (point.x - position.x) * t, position.z + (point.z - position.z) * t, radius, obstacles))) || null;
      }
      return null;
    },
    openAhead(position, target) {
      for (const door of doors) {
        if (door.state === 'open' || Math.hypot(position.x - door.x, position.z - door.z) > 2) continue;
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
