import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CHI_HA, CHI_HA_MG_MOUNTS } from './chi-ha.js';

const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .88, metalness: .25 });
const steel = new THREE.MeshStandardMaterial({ color: 0x42453b, roughness: .78, metalness: .55 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x282923, roughness: .96 });
const dark = new THREE.MeshStandardMaterial({ color: 0x141915, roughness: .9 });
const glass = new THREE.MeshStandardMaterial({ color: 0xb9b295, roughness: .3, metalness: .35 });
const wreck = new THREE.MeshStandardMaterial({ color: 0x34312b, roughness: 1 });
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 16);
const sphere = new THREE.SphereGeometry(1, 8, 6);
const palette = [0x5c6240, 0x877449, 0x504b35].map(color => new THREE.Color(color));
const cache = new Map();
const dummy = new THREE.Object3D();

function part(parent, geometry, material, position, scale, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
  mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}
const plate = (parent, p, size, material = paint, rotation) => part(parent, box, material, p, size, rotation);
const tube = (parent, p, radius, length, material = steel, rotation = [Math.PI / 2, 0, 0]) =>
  part(parent, cylinder, material, p, [radius, length, radius], rotation);
function beam(parent, a, b, radius, material = steel) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const mesh = tube(parent, start.clone().add(end).multiplyScalar(.5).toArray(), radius, start.distanceTo(end), material, [0, 0, 0]);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
}
function rivets(parent, a, b, count) {
  for (let i = 0; i <= count; i++) {
    const p = a.map((v, axis) => v + (b[axis] - v) * i / count);
    part(parent, sphere, steel, p, [.016, .016, .016]);
  }
}
function sectionHull(parent) {
  const sections = [[-2.75, .52, .94, .80], [-2.18, .45, 1.13, .94], [-1.25, .48, 1.22, .97],
    [1.84, .48, 1.19, .97], [2.75, .63, 1.05, .83]];
  const positions = [], indices = [];
  for (const [z, bottom, top, halfWidth] of sections) {
    for (const [x, y] of [[-halfWidth, bottom], [halfWidth, bottom], [halfWidth, top], [-halfWidth, top]]) positions.push(x, y, z);
  }
  for (let i = 0; i < sections.length - 1; i++) for (let side = 0; side < 4; side++) {
    const a = i * 4 + side, b = i * 4 + (side + 1) % 4, c = b + 4, d = a + 4;
    indices.push(a, b, d, b, c, d);
  }
  indices.push(0, 3, 1, 1, 3, 2, 16, 17, 19, 17, 18, 19);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  part(parent, geometry, paint, [0, 0, 0], [1, 1, 1]);
}
function batch(group, key) {
  if (!cache.has(key)) {
    group.updateMatrixWorld(true);
    const materials = new Map();
    group.traverse(mesh => {
      if (!mesh.isMesh) return;
      const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      source.applyMatrix4(mesh.matrixWorld);
      source.deleteAttribute('uv');
      if (mesh.material === paint) {
        const colors = [], positions = source.getAttribute('position'), color = new THREE.Color();
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
          const pattern = Math.sin(x * 3.8 + z * 2.5 + Math.sin(y * 4)) + Math.cos(z * 3 - y * 4.3);
          color.copy(palette[pattern > .55 ? 1 : pattern < -.65 ? 2 : 0]);
          color.multiplyScalar(.94 + .06 * Math.sin(x * 85 + y * 71 + z * 97));
          colors.push(color.r, color.g, color.b);
        }
        source.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      }
      if (!materials.has(mesh.material)) materials.set(mesh.material, []);
      materials.get(mesh.material).push(source);
    });
    cache.set(key, [...materials].map(([material, geometries]) => {
      const geometry = mergeGeometries(geometries);
      geometries.forEach(item => item.dispose());
      return { geometry, material };
    }));
    const generated = new Set();
    group.traverse(mesh => { if (mesh.isMesh && ![box, cylinder, sphere].includes(mesh.geometry)) generated.add(mesh.geometry); });
    generated.forEach(geometry => geometry.dispose());
  }
  group.clear();
  for (const { geometry, material } of cache.get(key)) part(group, geometry, material, [0, 0, 0], [1, 1, 1]);
}
function hull() {
  const group = new THREE.Group();
  if (!cache.has('hull')) {
    sectionHull(group);
    plate(group, [0, 1.22, -.46], [1.77, .44, 2.35], paint);
    plate(group, [0, 1.29, -1.67], [1.8, .40, .12], paint, [-.23, 0, 0]);
    for (const side of [-1, 1]) {
      plate(group, [side * 1.01, 1.06, 0], [.31, .06, 5.42]);
      plate(group, [side * 1.01, 1.03, -2.52], [.31, .07, .42], paint, [-.28, 0, 0]);
      plate(group, [side * .89, 1.26, 1.6], [.13, .24, 1.1]);
      tube(group, [side * .94, 1.27, 1.8], .10, .78, steel);
      plate(group, [side * .95, 1.27, 1.8], [.05, .28, .9], steel);
      for (let z = 1.42; z < 2.22; z += .11) plate(group, [side * .985, 1.28, z], [.015, .18, .025], dark);
      tube(group, [side * .71, .98, -2.44], .083, .07, steel);
      tube(group, [side * .71, .98, -2.485], .063, .018, glass);
      rivets(group, [side * .88, 1.44, -1.6], [side * .88, 1.44, .6], 12);
      rivets(group, [side * .78, 1.15, -2.57], [side * .78, 1.15, -1.8], 5);
      beam(group, [side * .5, .67, -2.73], [side * .5, .52, -2.81], .035);
      part(group, new THREE.TorusGeometry(.075, .018, 6, 12), steel, [side * .5, .51, -2.81], [1, 1, 1]);
    }
    plate(group, [.43, 1.35, -1.75], [.44, .20, .04]);
    plate(group, [.43, 1.36, -1.779], [.27, .025, .014], dark);
    part(group, sphere, paint, [-.51, 1.28, -1.78], [.17, .15, .12]);
    for (let z = .85; z < 2.35; z += .13) plate(group, [0, 1.23, z], [1.18, .025, .042], dark);
    plate(group, [0, 1.25, .82], [1.32, .04, .06]);
    plate(group, [.34, 1.47, -.73], [.5, .035, .47]);
    rivets(group, [-.8, 1.49, -1.47], [.8, 1.49, -1.47], 12);
    rivets(group, [-.78, .87, -2.76], [.78, .87, -2.76], 10);
    for (const side of [-1, 1]) {
      for (const z of [-1.05, .30, 1.55]) tube(group, [side * .97, .86, z], .12, .13, steel, [0, 0, Math.PI / 2]);
      for (const z of [-.9, .45]) beam(group, [side * .95, .65, z], [side * .95, .35, z + .55], .047);
    }
  }
  batch(group, 'hull'); return group;
}
function turret() {
  const group = new THREE.Group();
  if (!cache.has('turret')) {
    part(group, new THREE.CylinderGeometry(.64, .79, .53, 12), paint, [0, .28, 0], [1, 1, 1.16]);
    tube(group, [0, .02, 0], .74, .06, steel, [0, 0, 0]);
    tube(group, [.17, .61, .14], .33, .18, paint, [0, 0, 0]);
    tube(group, [.17, .715, .14], .35, .045, paint, [0, 0, 0]);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 3) {
      plate(group, [.17 + Math.cos(angle) * .32, .63, .14 + Math.sin(angle) * .32], [.10, .04, .025], dark, [0, -angle + Math.PI / 2, 0]);
    }
    const ring = angle => [Math.cos(angle) * .98, .67, Math.sin(angle) * .93 + .04];
    for (let i = 0; i < 32; i++) beam(group, ring(i * Math.PI / 16), ring((i + 1) * Math.PI / 16), .016);
    for (const angle of [.25, 2.85, 4.1, 5.3]) {
      const end = ring(angle);
      beam(group, [end[0] * .64, .36, end[2] * .65], end, .013);
    }
    for (const angle of [.1, 1.1, 2.1, 3.1, 4.1, 5.1]) for (const y of [.12, .40]) {
      part(group, sphere, steel, [Math.cos(angle) * (.79 - y * .28), y, Math.sin(angle) * (.79 - y * .28) * 1.16], [.016, .016, .016]);
    }
    part(group, sphere, paint, [.32, .27, .79], [.13, .13, .13]);
    plate(group, [.48, .53, .05], [.18, .025, .25]);
  }
  batch(group, 'turret'); return group;
}
function gun() {
  const group = new THREE.Group();
  if (!cache.has('gun')) {
    plate(group, [0, 0, -.02], [.41, .32, .20]);
    tube(group, [0, 0, -.26], .11, .38, paint);
    tube(group, [0, 0, -.61], .059, .62);
    tube(group, [0, 0, -.925], .074, .03);
    tube(group, [0, 0, -.943], .043, .006, dark);
    rivets(group, [-.16, -.12, -.125], [.16, -.12, -.125], 4);
  }
  batch(group, 'gun'); return group;
}

const trackRadius = .43, trackHalf = 2.10;
const trackLength = 4 * trackHalf + 2 * Math.PI * trackRadius;
const linkCount = 92;
function trackPoint(distance) {
  let d = ((distance % trackLength) + trackLength) % trackLength;
  if (d < 2 * trackHalf) return { z: -trackHalf + d, y: .49 + trackRadius, angle: 0 };
  d -= 2 * trackHalf;
  if (d < Math.PI * trackRadius) {
    const a = d / trackRadius;
    return { z: trackHalf + Math.sin(a) * trackRadius, y: .49 + Math.cos(a) * trackRadius, angle: a };
  }
  d -= Math.PI * trackRadius;
  if (d < 2 * trackHalf) return { z: trackHalf - d, y: .49 - trackRadius, angle: Math.PI };
  const a = (d - 2 * trackHalf) / trackRadius + Math.PI;
  return { z: -trackHalf + Math.sin(a) * trackRadius, y: .49 + Math.cos(a) * trackRadius, angle: a };
}
function wheelGeometry() {
  const group = new THREE.Group();
  if (!cache.has('wheel')) {
    tube(group, [0, 0, 0], .285, .22, rubber, [0, 0, Math.PI / 2]);
    for (const side of [-1, 1]) {
      tube(group, [side * .115, 0, 0], .238, .024, paint, [0, 0, Math.PI / 2]);
      tube(group, [side * .14, 0, 0], .08, .045, steel, [0, 0, Math.PI / 2]);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        part(group, sphere, steel, [side * .132, Math.cos(a) * .17, Math.sin(a) * .17], [.016, .018, .018]);
      }
    }
  }
  batch(group, 'wheel'); return group;
}

export function chiHaModel() {
  const model = hull(), tower = turret(), barrel = gun();
  tower.position.copy(CHI_HA.turret); barrel.position.copy(CHI_HA.gun);
  tower.add(barrel); model.add(tower);
  const machineGuns = CHI_HA_MG_MOUNTS.map(mount => {
    const group = new THREE.Group();
    group.position.set(mount.x, mount.y, mount.z);
    group.rotation.order = 'YXZ';
    tube(group, [0, 0, -mount.length / 2], .025, mount.length);
    tube(group, [0, 0, -mount.length - .003], .015, .006, dark);
    (mount.id === 'rear' ? tower : model).add(group);
    return group;
  });
  model.name = CHI_HA.name;
  const links = new THREE.InstancedMesh(box, steel, linkCount * 2);
  links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  links.castShadow = links.receiveShadow = true;
  links.frustumCulled = false; model.add(links);
  const wheels = wheelGeometry(), centers = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) centers.push([side * .96, .43, -1.68 + i * .672, 1]);
    for (const z of [-2.10, 2.10]) centers.push([side * .96, .49, z, 1.37]);
    for (const z of [-1.15, 0, 1.15]) centers.push([side * .96, .79, z, .40]);
  }
  const wheelMeshes = wheels.children.map(mesh => {
    const instances = new THREE.InstancedMesh(mesh.geometry, mesh.material, centers.length);
    instances.castShadow = instances.receiveShadow = true; instances.frustumCulled = false;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage); model.add(instances);
    return instances;
  });
  Object.assign(model.userData, { model: CHI_HA.id, turret: tower, gun: barrel, machineGuns, links, wheelMeshes, centers });
  animateChiHa(model, 0, 0, false);
  return model;
}

export function animateChiHa(model, distance, pitch, destroyed, guns = []) {
  const { links, wheelMeshes, centers, gun: barrel, machineGuns } = model.userData;
  barrel.rotation.x = pitch;
  machineGuns.forEach((group, index) => {
    const gun = guns.find(item => item.mount === CHI_HA_MG_MOUNTS[index].id);
    group.rotation.set(gun?.pitch ?? 0, (index === 1 ? Math.PI : 0) + (gun?.yaw ?? 0), 0);
  });
  for (let side = 0; side < 2; side++) for (let i = 0; i < linkCount; i++) {
    const p = trackPoint(i * trackLength / linkCount + distance);
    dummy.position.set((side ? 1 : -1) * .98, p.y, p.z);
    dummy.rotation.set(p.angle, 0, 0); dummy.scale.set(.36, .055, .105); dummy.updateMatrix();
    links.setMatrixAt(side * linkCount + i, dummy.matrix);
  }
  links.instanceMatrix.needsUpdate = true;
  centers.forEach(([x, y, z, scale], index) => {
    dummy.position.set(x, y, z); dummy.rotation.set(distance / (.285 * scale), 0, 0);
    dummy.scale.setScalar(scale); dummy.updateMatrix();
    for (const mesh of wheelMeshes) mesh.setMatrixAt(index, dummy.matrix);
  });
  for (const mesh of wheelMeshes) mesh.instanceMatrix.needsUpdate = true;
  model.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.userData.liveMaterial ??= mesh.material;
    mesh.material = destroyed ? wreck : mesh.userData.liveMaterial;
  });
}
