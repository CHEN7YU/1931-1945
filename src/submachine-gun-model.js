import * as THREE from 'three';
import { RIFLE_STOCK_SECTIONS } from './rifle-contacts.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SMG_MAGAZINE = Object.freeze({
  center: Object.freeze([-.175, -.014, -.15]),
  size: Object.freeze([.25, .044, .035]),
});

const templates = new Map();
export function submachineGunModel(detail = 'near', materials = {}) {
  if (!['near', 'far'].includes(detail)) throw new RangeError('Invalid submachine-gun detail');
  if (!templates.has(detail)) {
    const root = new THREE.Group(), steel = materials.steel ?? new THREE.MeshStandardMaterial({ color: 0x48504b, metalness: .7, roughness: .5 }),
      wood = materials.wood ?? new THREE.MeshStandardMaterial({ color: 0x76553a, roughness: .8 }),
      dark = materials.black ?? new THREE.MeshStandardMaterial({ color: 0x252923, roughness: .7 });
    const box = (parent, size, position, material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.position.fromArray(position); parent.add(mesh); return mesh;
    };
    const tube = (radius, length, z) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, detail === 'far' ? 8 : 16), steel);
      mesh.rotation.x = Math.PI / 2; mesh.position.z = z; root.add(mesh);
    };
    const sections = RIFLE_STOCK_SECTIONS.filter(section => section[0] >= -.44), vertices = [], indices = [];
    for (const [z, y, width, depth] of sections) for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4; vertices.push(Math.sin(angle) * width, y + Math.cos(angle) * depth, z);
    }
    for (let row = 0; row < sections.length - 1; row++) for (let i = 0; i < 8; i++) {
      const a = row * 8 + i, b = row * 8 + (i + 1) % 8;
      indices.push(a, b, a + 8, b, b + 8, a + 8);
    }
    for (let i = 1; i < 7; i++) indices.push(0, i + 1, i,
      (sections.length - 1) * 8, (sections.length - 1) * 8 + i, (sections.length - 1) * 8 + i + 1);
    const stock = new THREE.BufferGeometry();
    stock.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); stock.setIndex(indices); stock.computeVertexNormals();
    stock.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.flatMap((_, i) => i % 3 === 0 ? [i / vertices.length, .5] : []), 2));
    root.add(new THREE.Mesh(stock, wood));
    tube(.032, .30, -.11); tube(.012, .34, -.42);
    for (let i = 0; i < 10; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.032, .004, 4, detail === 'far' ? 8 : 12), steel);
      ring.position.z = -.275 - i * .034; root.add(ring);
    }
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      box(root, [.005, .005, .32], [Math.sin(angle) * .032, Math.cos(angle) * .032, -.425], steel);
    }
    box(root, [.010, .030, .018], [0, .035, -.555], dark);
    box(root, [.035, .015, .025], [0, .038, -.065], dark);
    const guard = new THREE.Mesh(new THREE.TorusGeometry(.026, .003, 4, 12), steel);
    guard.rotation.y = Math.PI / 2; guard.position.set(0, -.076, -.055); root.add(guard);
    box(root, [.005, .025, .005], [0, -.063, -.051], dark);
    const feed = new THREE.Group(); feed.name = 'feed'; root.add(feed);
    box(feed, SMG_MAGAZINE.size, SMG_MAGAZINE.center, dark);
    const spareMagazine = new THREE.Group(); spareMagazine.name = 'spare-magazine'; spareMagazine.visible = false;
    box(spareMagazine, SMG_MAGAZINE.size, SMG_MAGAZINE.center, dark); root.add(spareMagazine);
    box(root, [.06, .047, .055], [-.05, -.004, -.15], steel);
    const batches = new Map();
    for (const mesh of [...root.children].filter(child => child.isMesh)) {
      mesh.updateMatrix();
      if (!batches.has(mesh.material)) batches.set(mesh.material, []);
      batches.get(mesh.material).push(mesh.geometry.clone().applyMatrix4(mesh.matrix)); root.remove(mesh); mesh.geometry.dispose();
    }
    for (const [material, parts] of batches) {
      root.add(new THREE.Mesh(mergeGeometries(parts), material)); parts.forEach(part => part.dispose());
    }
    root.userData = { model: 'sigm1920', detail, referenceLength: .81, construction: 'original-vented-shroud-and-side-box-magazine' };
    root.traverse(node => { if (node.isMesh) node.receiveShadow = true; });
    templates.set(detail, root);
  }
  return templates.get(detail).clone(true);
}
