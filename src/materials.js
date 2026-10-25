import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export async function loadSceneMaterials(renderer, scene) {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const surfaces = {};
  await Promise.all(['brick', 'plaster', 'tiles', 'paving', 'earth', 'timber'].map(async name => {
    const [map, normalMap, arm] = await Promise.all(
      ['color', 'normal', 'arm'].map(kind => loader.loadAsync(`/assets/materials/${name}/${kind}.jpg`)),
    );
    for (const texture of [map, normalMap, arm]) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = anisotropy;
    }
    map.colorSpace = THREE.SRGBColorSpace;
    surfaces[name] = { map, normalMap, aoMap: arm, roughnessMap: arm, metalnessMap: arm };
  }));
  const sky = await new HDRLoader().loadAsync('/assets/sky.hdr');
  sky.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = sky;
  scene.backgroundIntensity = .65;
  scene.backgroundRotation.y = 1.1;
  scene.environmentRotation.y = 1.1;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(sky);
  scene.environment = environment.texture;
  scene.environmentIntensity = .8;
  pmrem.dispose();

  return (name, color = 0xffffff, metersPerTile = 3) => {
    const material = new THREE.MeshStandardMaterial({
      ...surfaces[name], color, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(.65, .65), aoMapIntensity: .8,
    });
    material.userData.metersPerTile = metersPerTile;
    return material;
  };
}
