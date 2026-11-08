import * as THREE from 'three';

export const DADAO_ART_ROOT = '/assets/materials/ai-dadao/';
export const DADAO_CLOTH_TILE_METERS = .08;
export const DADAO_ART_MAPS = Object.freeze({
  steel: Object.freeze(['color', 'normal', 'roughness', 'metalness']),
  cotton: Object.freeze(['color', 'normal', 'roughness']),
});
let pending, surfaces, snapshot;

export async function loadDadaoSurfaces(anisotropy, loader = new THREE.TextureLoader(), textureBudget = null) {
  if (!Number.isFinite(anisotropy) || anisotropy < 1) throw new RangeError('Dadao anisotropy must be positive and finite');
  if (!pending) pending = (async () => {
    const entries = await Promise.all(Object.entries(DADAO_ART_MAPS).map(async ([kind, names]) => {
      const maps = await Promise.all(names.map(async name => {
        const url = `${DADAO_ART_ROOT}${kind}/${name}.webp`;
        const map = await (textureBudget ? textureBudget.load(loader, url) : loader.loadAsync(url)).catch(error => {
          throw new Error(`Dadao material failed to load: ${url}`, { cause: error });
        });
        map.name = `dadao-${kind}-${name}`;
        map.userData.assetUrl = url;
        map.colorSpace = name === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        map.anisotropy = anisotropy;
        if (kind === 'cotton') map.wrapS = map.wrapT = THREE.RepeatWrapping;
        return [name === 'color' ? 'map' : `${name}Map`, map];
      }));
      return [kind, { ...Object.fromEntries(maps), normalScale: new THREE.Vector2(.2, .2) }];
    }));
    surfaces = Object.fromEntries(entries);
    snapshot = entries.flatMap(([kind, surface]) => Object.entries(surface).filter(([, map]) => map.isTexture)
      .map(([name, map]) => ({ kind, name, url: map.userData.assetUrl,
        width: map.image.width, height: map.image.height, colorSpace: map.colorSpace,
        imageType: map.image.constructor.name, dataTexture: Boolean(map.isDataTexture) })));
    return surfaces;
  })();
  return pending;
}

export function dadaoSurfaces() {
  if (!surfaces) throw new Error('Dadao material assets must finish loading before creating the weapon');
  return surfaces;
}

export function dadaoSurfaceSnapshot() {
  return snapshot;
}
