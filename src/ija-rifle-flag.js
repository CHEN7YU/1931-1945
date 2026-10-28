import * as THREE from 'three';

export function hasIjaRifleFlag(actor) {
  if (actor.team !== 'enemy') return false;
  if (!actor.id || !actor.unitId) throw new Error('Rifle flag assignment requires an owned soldier identity');
  let seed = 2166136261;
  for (const letter of `${actor.unitId}:${actor.id}`) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  return seed % 5 === 0;
}

let geometry, material;
export function createIjaRifleFlag() {
  if (!geometry) {
    geometry = new THREE.PlaneGeometry(.27, .18, 12, 8);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index++) {
      const u = uv.getX(index), v = uv.getY(index);
      positions.setXYZ(index, .022 + u * .27, -.014 - (1 - v) * .18 - .035 * u,
        -.705 + .016 * Math.sin(u * Math.PI * 3 + v * 2) * u);
    }
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const width = 96, height = 64, pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const red = Math.hypot(x + .5 - width / 2, y + .5 - height / 2) <= height * .3;
      pixels.set(red ? [167, 28, 36, 255] : [226, 218, 196, 255], (y * width + x) * 4);
    }
    const map = new THREE.DataTexture(pixels, width, height);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true;
    material = new THREE.MeshStandardMaterial({ map, roughness: 1, side: THREE.DoubleSide });
  }
  const flag = new THREE.Mesh(geometry, material);
  flag.name = 'ija-rifle-flag'; flag.castShadow = flag.receiveShadow = true;
  flag.userData.rifleAttachment = true;
  return flag;
}
