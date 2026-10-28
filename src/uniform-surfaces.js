import * as THREE from 'three';

export function createStudySurface(kind, size = 256) {
  if (!['cloth', 'leather', 'paint'].includes(kind)) throw new Error(`Unknown study surface: ${kind}`);
  const color = new Uint8Array(size * size * 4), normal = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4), height = new Float32Array(size * size);
  const period = Math.PI * 2 / size;
  let state = 1938;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const grain = (state >>> 24) / 255 - .5;
    const broad = Math.sin(x * period * 3 + .7 * Math.sin(y * period * 2)) * Math.cos(y * period * 5);
    const weave = Math.sin(x * Math.PI / 2) * Math.cos(y * Math.PI / 2);
    const pixel = y * size + x, offset = pixel * 4;
    const value = kind === 'cloth' ? 238 + broad * 4 + grain * 5 :
      kind === 'leather' ? 224 + broad * 12 + grain * 8 : 234 + broad * 5 + grain * 4;
    height[pixel] = kind === 'cloth' ? weave * .025 + grain * .012 :
      kind === 'leather' ? grain * .07 + broad * .018 : grain * .025;
    const r = kind === 'cloth' ? 240 + grain * 7 : kind === 'leather' ? 185 + broad * 22 : 220 + grain * 10;
    for (let channel = 0; channel < 3; channel++) {
      color[offset + channel] = Math.round(value); roughness[offset + channel] = Math.round(r);
    }
    color[offset + 3] = roughness[offset + 3] = 255;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = height[y * size + (x + 1) % size] - height[y * size + (x + size - 1) % size];
    const dy = height[((y + 1) % size) * size + x] - height[((y + size - 1) % size) * size + x];
    const vector = new THREE.Vector3(-dx * 3, -dy * 3, 1).normalize(), offset = (y * size + x) * 4;
    normal[offset] = Math.round((vector.x * .5 + .5) * 255);
    normal[offset + 1] = Math.round((vector.y * .5 + .5) * 255);
    normal[offset + 2] = Math.round((vector.z * .5 + .5) * 255); normal[offset + 3] = 255;
  }
  const texture = (bytes, colorSpace) => {
    const map = new THREE.DataTexture(bytes, size, size);
    map.colorSpace = colorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(kind === 'cloth' ? 3 : 1, kind === 'cloth' ? 3 : 1);
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true; return map;
  };
  return {
    map: texture(color, THREE.SRGBColorSpace),
    normalMap: texture(normal, THREE.NoColorSpace),
    roughnessMap: texture(roughness, THREE.NoColorSpace),
    normalScale: new THREE.Vector2(kind === 'cloth' ? .16 : .22, kind === 'cloth' ? .16 : .22),
  };
}
