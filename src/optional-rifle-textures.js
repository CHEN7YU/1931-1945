import * as THREE from 'three';

const channels = { color: 'map', normal: 'normalMap', roughness: 'roughnessMap', metalness: 'metalnessMap' };
export function planRifleTextures(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('步枪材质配置必须是对象');
  const plan = [];
  for (const part of Object.keys(config)) {
    if (!['wood', 'steel'].includes(part)) throw new Error(`Unknown rifle material: ${part}`);
    const asset = config[part];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error(`步枪材质配置无效：${part}`);
    for (const key of Object.keys(asset)) if (![...Object.keys(channels), 'license', 'source', 'normalFormat'].includes(key)) throw new Error(`Unknown rifle texture field: ${part}.${key}`);
    for (const channel of Object.keys(channels)) {
      const url = asset[channel];
      if (url === null || url === undefined) continue;
      if (asset.license !== 'CC0-1.0' || typeof asset.source !== 'string' || !asset.source.trim()) throw new Error(`步枪材质 ${part} 必须记录CC0-1.0授权和原始来源`);
      if (typeof url !== 'string' || !url.startsWith('/assets/') || url.split('/').includes('..') || url.includes('\\')) throw new Error(`步枪贴图必须使用本地 /assets/ 路径：${part}.${channel}`);
      if (part === 'wood' && channel === 'metalness') throw new Error('木托保持非金属材质，不能配置金属度贴图');
      if (channel === 'normal' && asset.normalFormat !== 'OpenGL') throw new Error(`步枪法线必须明确为OpenGL方向：${part}`);
      plan.push({ part, channel, property: channels[channel], url, colorSpace: channel === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    }
  }
  return plan;
}

export async function applyRifleTextures(materials, config, maxAnisotropy = 8) {
  const plan = planRifleTextures(config);
  if (!plan.length) return;
  const loader = new THREE.TextureLoader();
  const requests = [...new Map(plan.map(item => [`${item.url}|${item.colorSpace}`, item])).entries()];
  const results = await Promise.allSettled(requests.map(([, item]) => loader.loadAsync(item.url)));
  const failed = results.findIndex(result => result.status === 'rejected');
  if (failed >= 0) {
    for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
    const item = requests[failed][1];
    throw new Error(`无法加载步枪材质 ${item.part}.${item.channel}：${item.url}`, { cause: results[failed].reason });
  }
  const loaded = new Map();
  results.forEach((result, index) => {
    const [key, item] = requests[index], map = result.value;
    map.colorSpace = item.colorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = Math.min(8, maxAnisotropy);
    map.userData.assetUrl = item.url;
    loaded.set(key, map);
  });
  for (const item of plan) {
    const material = materials[item.part];
    material[item.property]?.dispose();
    material[item.property] = loaded.get(`${item.url}|${item.colorSpace}`);
    if (item.channel === 'color' && item.part === 'wood') {
      material.bumpMap?.dispose(); material.bumpMap = null;
    }
    if (item.channel === 'normal') {
      material.normalScale.set(.45, .45);
      material.bumpMap?.dispose(); material.bumpMap = null;
    }
    if (item.channel === 'roughness') material.roughness = 1;
    if (item.channel === 'metalness') material.metalness = 1;
    material.needsUpdate = true;
  }
  if (plan.some(item => item.part === 'steel')) {
    for (const property of Object.values(channels)) materials.edge[property] = materials.steel[property];
    materials.edge.roughness = materials.steel.roughness;
    materials.edge.metalness = materials.steel.metalness;
    materials.edge.normalScale.copy(materials.steel.normalScale);
    materials.edge.needsUpdate = true;
  }
}
// ---模块结束---
