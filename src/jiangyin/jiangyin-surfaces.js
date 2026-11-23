// 江阴要塞阻击战 · 写实表面：复用项目 materials.js 的 PBR 贴图（Poly Haven earth/plaster/timber/burlap/bark/dry-silt），
// 以三平面投影贴到没有 UV 的程序化模型上（船体、炮台、地形），并叠加锈迹/水渍/斑驳与凹凸。
// 只用 three 本体；不依赖 DOM（node 模拟时自动退化为程序化噪声贴图），可被 jiangyin-game 在无浏览器环境下引用。
import * as THREE from 'three';
import { createWaterNormalTexture } from '../water-waves.js';

// ---------- 程序化贴图（DataTexture，无需画布） ----------
function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tileNoise(x, y, period, seed) {   // 可平铺值噪声
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash2(((a % period) + period) % period, ((b % period) + period) % period, seed);
  return (h(ix, iy) * (1 - u) + h(ix + 1, iy) * u) * (1 - v) + (h(ix, iy + 1) * (1 - u) + h(ix + 1, iy + 1) * u) * v;
}
function tileFbm(x, y, period, seed, octaves = 5) {
  let sum = 0, amp = .5, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += tileNoise(x, y, period, seed + o) * amp; norm += amp; x *= 2; y *= 2; period *= 2; amp *= .5; }
  return sum / norm;
}
const textureCache = new Map();
export function noiseTexture(seed = 1, size = 128, { base = [150, 140, 125], spread = 70 } = {}) {
  const key = `noise:${seed}:${size}:${base}:${spread}`;
  if (textureCache.has(key)) return textureCache.get(key);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = tileFbm(x / size * 8, y / size * 8, 8, seed) - .5, g = hash2(x, y, seed + 9) - .5, i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, base[c] + n * spread + g * 18));
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}
export function waterNormalTexture(size = 256) { return createWaterNormalTexture(size); }

// ---------- 着色器补丁：三平面贴图 + 斑驳/锈迹/水渍 + 凹凸 ----------
const NOISE_GLSL = /* glsl */`
float surfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float surfNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(surfHash(i), surfHash(i + vec2(1, 0)), u.x), mix(surfHash(i + vec2(0, 1)), surfHash(i + vec2(1, 1)), u.x), u.y); }
float surfFbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += surfNoise(p) * a; p = p * 2.03 + 11.7; a *= .5; } return s / .9375; }
`;
// options：map/map2（三平面贴图，map2 由 surfSplat 顶点属性或 splat 参数混合）、tile（米/张）、macro（大尺度去重复）、
// mottle（斑驳）、streaks（竖向锈水痕）、waterline（舷侧近水线污渍高度）、bump（凹凸强度）、world（按世界坐标投影）
// v24：全局共享的云影参数（页面每帧更新 uCloudTime；画质自动减负时 uCloudAmount 降为 0 即关闭）
export const SURF_GLOBALS = { uCloudTime: { value: 0 }, uCloudAmount: { value: 1 } };
export function patchSurface(material, options = {}) {
  const o = { tile: 3, detail: 1, macro: 0, mottle: .12, streaks: 0, waterline: null, bump: 0, world: false, splat: 0, rough: .2, plates: 0, planks: 0, ...options };
  const uniforms = { uSurfMap: { value: o.map ?? null }, uSurfMap2: { value: o.map2 ?? null }, uSurfTile: { value: o.tile }, uSurfDetail: { value: o.detail },
    uSurfMacro: { value: o.macro }, uSurfMottle: { value: o.mottle }, uSurfStreaks: { value: o.streaks },
    uSurfWaterline: { value: o.waterline ?? -999 }, uSurfBump: { value: o.bump }, uSurfSplat: { value: o.splat }, uSurfRough: { value: o.rough },
    uSurfPlates: { value: o.plates }, uSurfPlanks: { value: o.planks } };
  material.userData.surfaceUniforms = uniforms;
  const defines = [o.map ? '#define SURF_MAP' : '', o.map2 ? '#define SURF_MAP2' : '', o.world ? '#define SURF_WORLD' : '',
    o.splatAttribute ? '#define SURF_SPLAT_ATTR' : '', o.clouds ? '#define SURF_CLOUDS' : ''].join('\n');
  material.customProgramCacheKey = () => `surf:${defines}`;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, SURF_GLOBALS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${defines}\nvarying vec3 vSurfPos; varying vec3 vSurfNormal;\n#ifdef SURF_SPLAT_ATTR\nattribute float surfSplat; varying float vSurfSplat;\n#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vec4 surfP = vec4(position, 1.); vec3 surfN = normal;
  #ifdef USE_INSTANCING
    surfP = instanceMatrix * surfP; surfN = mat3(instanceMatrix) * surfN;
  #endif
  #ifdef SURF_WORLD
    surfP = modelMatrix * surfP; surfN = mat3(modelMatrix) * surfN;
  #endif
  vSurfPos = surfP.xyz; vSurfNormal = surfN;
  #ifdef SURF_SPLAT_ATTR
    vSurfSplat = surfSplat;
  #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defines}\nvarying vec3 vSurfPos; varying vec3 vSurfNormal;
#ifdef SURF_SPLAT_ATTR
varying float vSurfSplat;
#endif
uniform sampler2D uSurfMap; uniform sampler2D uSurfMap2; uniform float uSurfTile, uSurfDetail, uSurfMacro, uSurfMottle, uSurfStreaks, uSurfWaterline, uSurfBump, uSurfSplat, uSurfRough, uSurfPlates, uSurfPlanks;
${NOISE_GLSL}
uniform float uCloudTime, uCloudAmount;
vec4 surfTri(sampler2D tex, vec3 p, vec3 w) { return texture2D(tex, p.zy) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z; }
vec3 surfAvg(sampler2D tex) { return max(textureLod(tex, vec2(.5), 12.).rgb, vec3(.02)); }
float surfLuma = .5;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  vec3 surfW = pow(abs(normalize(vSurfNormal)), vec3(4.)); surfW /= (surfW.x + surfW.y + surfW.z);
  vec3 surfP = vSurfPos / uSurfTile;
  float surfSplatK = uSurfSplat;
  #ifdef SURF_SPLAT_ATTR
    surfSplatK = vSurfSplat;
  #endif
  #ifdef SURF_MAP
    // 贴图除以自身均值 → 只取纹理细节，整体色调仍由材质颜色/顶点色决定
    vec3 surfTex = surfTri(uSurfMap, surfP, surfW).rgb / surfAvg(uSurfMap);
    #ifdef SURF_MAP2
      surfTex = mix(surfTex, surfTri(uSurfMap2, surfP * 1.3, surfW).rgb / surfAvg(uSurfMap2), surfSplatK);
    #endif
    if (uSurfMacro > 0.) { vec3 far = surfTri(uSurfMap, surfP * .137, surfW).rgb / surfAvg(uSurfMap); surfTex *= mix(vec3(1.), far, uSurfMacro); }
    surfTex = clamp(surfTex, 0., 2.6);
    diffuseColor.rgb *= mix(vec3(1.), surfTex, uSurfDetail);
    surfLuma = clamp(dot(surfTex, vec3(.3, .59, .11)) * .5, 0., 1.);
  #endif
  float surfN1 = surfFbm(vSurfPos.xz * .35 + vSurfPos.y * .21);
  diffuseColor.rgb *= 1. + (surfN1 - .5) * 2. * uSurfMottle;
  #ifdef SURF_CLOUDS
    // v24 云影：几百米大小的积云阴影随风（向东偏南）缓缓掠过地面，阴影里失去大部分直射阳光
    vec2 cloudUv = (vSurfPos.xz + vec2(-uCloudTime * 9., -uCloudTime * 3.)) * .0016;
    float cloudShade = smoothstep(.5, .72, surfFbm(cloudUv) * .8 + surfNoise(cloudUv * 3.7) * .25);
    diffuseColor.rgb *= 1. - cloudShade * .36 * uCloudAmount;
  #endif
  float surfSide = 1. - abs(normalize(vSurfNormal).y);
  vec3 surfAN = abs(normalize(vSurfNormal));
  if (uSurfPlates > 0.) {
    // 钢板接缝：水平面 1.6×2.4 米、竖直面 2.4×1.1 米一块；接缝两侧一排铆钉；每块钢板色调略有差别。远处按像素尺度淡出，避免闪烁
    vec2 q = surfAN.y > .7 ? vSurfPos.xz / vec2(1.6, 2.4) : (surfAN.x > surfAN.z ? vSurfPos.zy / vec2(2.4, 1.1) : vSurfPos.xy / vec2(1.6, 1.1));
    vec2 fw = fwidth(q), d = min(fract(q), 1. - fract(q));
    vec2 line = 1. - smoothstep(vec2(0.), fw * 1.2 + .006, d);
    float fade = clamp(1. - max(fw.x, fw.y) * 6., 0., 1.);
    float seam = max(line.x, line.y) * fade;
    vec2 rq = vec2(q.x * 12., q.y * 18.);
    float rivet = (1. - smoothstep(.12, .22, length(fract(rq) - .5))) * (1. - smoothstep(.03, .06, d.y)) * fade * step(.008, d.y);
    diffuseColor.rgb *= 1. - seam * .28 * uSurfPlates;
    diffuseColor.rgb *= 1. + rivet * .16 * uSurfPlates;
    diffuseColor.rgb *= 1. + (surfHash(floor(q) + 7.3) - .5) * .07 * uSurfPlates;
  }
  if (uSurfPlanks > 0. && surfAN.y > .7) {
    // 柚木甲板：沿舰长方向铺设，板宽 15 厘米，黑色填缝；接头错开；每条木板深浅不一
    float px = vSurfPos.x / .15, row = floor(px);
    float pz = vSurfPos.z / 4.8 + surfHash(vec2(row, 1.7)), col = floor(pz);
    float fx = fwidth(px), fz = fwidth(pz);
    float dx = min(fract(px), 1. - fract(px)), dz = min(fract(pz), 1. - fract(pz));
    float fade = clamp(1. - fx * 3.5, 0., 1.);
    float caulk = max(1. - smoothstep(0., fx * 1.2 + .05, dx), (1. - smoothstep(0., fz * 1.2 + .004, dz)) * .7) * fade;
    diffuseColor.rgb *= 1. + (surfHash(vec2(row, col)) - .5) * .2 * uSurfPlanks * fade;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.07, .06, .05), caulk * .75 * uSurfPlanks);
  }
  if (uSurfStreaks > 0.) {
    float lane = (vSurfPos.z + vSurfPos.x * .37) * 2.2;
    float col = surfHash(vec2(floor(lane), 3.1)), drip = surfNoise(vec2(lane * 1.7, vSurfPos.y * .55));
    float streak = smoothstep(.62, .95, col) * smoothstep(.35, .8, drip) * surfSide;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.52, .4, .32), streak * uSurfStreaks);
    float grime = smoothstep(.55, .0, surfFbm(vSurfPos.zy * 1.3)) * surfSide;
    diffuseColor.rgb *= 1. - grime * .18 * uSurfStreaks;
  }
  if (uSurfWaterline > -900.) {
    float wl = smoothstep(uSurfWaterline + 1.6, uSurfWaterline, vSurfPos.y) * surfSide;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.62, .58, .46), wl * (.6 + .4 * surfNoise(vSurfPos.zx * 3.)));
  }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = clamp(roughnessFactor * (1. + (surfN1 - .5) * 2. * uSurfRough) + (1. - surfLuma) * .08, .04, 1.);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (uSurfBump > 0.) {
    float surfH = surfLuma + surfNoise(vSurfPos.xz * 6.) * .15;
    vec3 sdx = dFdx(-vViewPosition), sdy = dFdy(-vViewPosition);
    float hdx = dFdx(surfH), hdy = dFdy(surfH);
    vec3 r1 = cross(sdy, normal), r2 = cross(normal, sdx);
    float det = dot(sdx, r1);
    vec3 grad = sign(det) * (hdx * r1 + hdy * r2);
    normal = normalize(abs(det) * normal - grad * uSurfBump);
  }`);
  };
  material.needsUpdate = true;
  return material;
}

// ---------- 项目贴图桥接 ----------
// surface：项目 materials.js 的 loadSceneMaterials() 返回的工厂；为空时（node 模拟或 ?surfaces=procedural）用程序化噪声代替。
let sceneSurface = null;
export function setSceneSurfaces(surface) { sceneSurface = typeof surface === 'function' ? surface : null; }
export const hasSceneSurfaces = () => Boolean(sceneSurface);
const FALLBACK_TONES = { earth: [128, 112, 88], 'dry-silt': [142, 128, 104], plaster: [190, 186, 176], timber: [120, 104, 84],
  burlap: [170, 150, 112], 'bark-elm': [110, 100, 88], 'bark-poplar': [150, 146, 136], 'bark-willow': [104, 96, 84],
  'root-litter': [110, 96, 74], 'weathered-plaster': [182, 176, 162], paving: [150, 146, 136], tiles: [80, 84, 86] };
// 只取贴图（颜色贴图），交给 patchSurface 做三平面投影
export function surfaceMap(name) {
  if (sceneSurface) {
    try { const material = sceneSurface(name); return material.map; } catch (error) { console.warn(`surface ${name} unavailable`, error); }
  }
  return noiseTexture(Object.keys(FALLBACK_TONES).indexOf(name) + 3, 128, { base: FALLBACK_TONES[name] ?? [140, 130, 115], spread: 80 });
}
// 项目原材质（带法线/AO/粗糙度贴图与 UV），用于有 UV 的几何（如 woodland.js 的树皮）
export function projectSurface(name, color = 0xffffff) {
  if (sceneSurface) { try { return sceneSurface(name, color); } catch (error) { console.warn(`surface ${name} unavailable`, error); } }
  return new THREE.MeshStandardMaterial({ color, map: surfaceMap(name), roughness: 1, metalness: 0 });
}
