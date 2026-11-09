import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { SCENE_ART_MATERIALS, SCENE_GRIME_ATLAS } from './scene-art.js';

export async function loadSceneMaterials(renderer, scene, { textureBudget = null, lowMemory = false } = {}) {
  const loader = new THREE.TextureLoader();
  const load = url => textureBudget ? textureBudget.load(loader, url) : loader.loadAsync(url);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const surfaces = {};
  await Promise.all(['brick', 'plaster', 'tiles', 'paving', 'earth', 'timber'].map(async name => {
    const [map, normalMap, arm] = await Promise.all(
      ['color', 'normal', 'arm'].map(kind => load(`/assets/materials/${name}/${kind}.jpg`)),
    );
    for (const texture of [map, normalMap, arm]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    surfaces[name] = { map, normalMap, aoMap: arm, roughnessMap: arm, metalnessMap: arm };
  }));
  await Promise.all(Object.keys(SCENE_ART_MATERIALS).map(async name => {
    const [map, normalMap, roughnessMap] = await Promise.all(
      ['color', 'normal', 'roughness'].map(kind => load(`/assets/materials/ai-scene/${name}/${kind}.webp`)),
    );
    for (const texture of [map, normalMap, roughnessMap]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    surfaces[name] = { map, normalMap, roughnessMap };
  }));
  const grime = await load(SCENE_GRIME_ATLAS);
  grime.colorSpace = THREE.SRGBColorSpace;
  grime.anisotropy = anisotropy;
  surfaces['wall-grime'] = {
    map: grime, transparent: true, depthWrite: false, alphaTest: .015,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  };
  const sky = await new HDRLoader().loadAsync('/assets/sky.hdr');
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  scene.backgroundIntensity = .65;
  scene.backgroundRotation.y = 1.1;
  if (lowMemory) {
    scene.environment = null;
  } else {
    scene.environmentRotation.y = 1.1;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromEquirectangular(sky);
    scene.environment = environment.texture;
    scene.environmentIntensity = .8;
    pmrem.dispose();
  }

  return (name, color = 0xffffff, metersPerTile = SCENE_ART_MATERIALS[name]?.metersPerTile ?? 3) => {
    if (!surfaces[name]) throw new RangeError(`Unknown scene surface: ${name}`);
    const normalStrength = SCENE_ART_MATERIALS[name]?.normalStrength ?? .65;
    const material = new THREE.MeshStandardMaterial({
      ...surfaces[name], color, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(normalStrength, normalStrength), aoMapIntensity: .8,
    });
    material.userData.metersPerTile = metersPerTile;
    material.userData.surface = SCENE_ART_MATERIALS[name]?.surface ?? name;
    material.userData.source = name;
    return material;
  };
}
