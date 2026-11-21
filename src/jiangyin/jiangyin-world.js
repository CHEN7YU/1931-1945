// 江阴要塞阻击战 · 场景（写实版）：
// - 天空/环境光：复用项目 materials.js 载入的 sky.hdr（背景 + PMREM 环境反射）；无项目贴图时用程序天穹。
// - 地形：分形起伏的台地、带层理与冲沟的石崖、远处连绵山脊；按坡度/高度/田块着色，三平面投影项目 earth / dry-silt 贴图 + 凹凸。
// - 江水：含沙量大的黄褐色长江水，双层流动法线、浅滩变浅变亮、岸线白沫，PBR 反射天空。
// - 植被：近景复用项目 woodland.js 的落叶树枝干；远景十字面片树林（落叶树/马尾松/常绿阔叶）；成片枯草。
// - 烟：舰船烟囱煤烟、沉船燃烧烟柱（软粒子）。
import * as THREE from 'three';
import { JIANGYIN_RULES, JIANGYIN_POSTS, groundHeight, riverCenter, terrainFbm, RIVER_HALF, postFacing,
  jiangyinTrenches, naturalGroundHeight, TRENCH, jiangyinRoads, roadProbe, ROAD, roadFloorHeight } from './jiangyin-rules.js';
const SO = RIVER_HALF - 70;   // 岸线剖面外移量（与 jiangyin-rules 一致）
const FLOW = JIANGYIN_RULES.flowSpeed ?? 1.6;   // 江水向东（+x）流动
import { createWreckModel, mergeStatic, mat } from './jiangyin-models.js';
import { patchSurface, surfaceMap, hasSceneSurfaces, waterNormalTexture } from './jiangyin-surfaces.js';
import { createTreeCards, createWoodlandTrees, createGrass } from './jiangyin-vegetation.js';

const smoothstep = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
const cellHash = (x, z) => { let h = Math.imul(x | 0, 73856093) ^ Math.imul(z | 0, 19349663); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// quality：'high'（默认）或 'low'（低配机器 / 软件渲染：地形与水面网格减半，树与草减量）
export function createJiangyinWorld(scene, { quality = 'high' } = {}) {
  const low = quality === 'low';
  const area = JIANGYIN_RULES.playArea;
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const nearPost = (x, z, r) => JIANGYIN_POSTS.some(p => Math.hypot(p.x - x, p.z - z) < r);
  const R = RIVER_HALF;
  // 村镇：南岸江阴城（上游）、黄山与长山之间的沿江村落；北岸靖江八圩港、天生港一带的圩田村庄
  const villages = [[-1050, R + 330, 60, 110], [-700, R + 160, 14, 60], [140, R + 110, 10, 50], [860, R + 150, 12, 60], [1250, R + 120, 8, 50],
    [-300, -(R + 90), 16, 60], [-900, -(R + 160), 14, 70], [300, -(R + 140), 12, 60], [900, -(R + 130), 12, 60], [-80, -(R + 420), 10, 60], [600, -(R + 450), 9, 60]];
  const nearVillage = (x, z, r) => villages.some(([cx, cz, , spread]) => Math.hypot(cx - x, cz - z) < r + (spread ?? 40) * .4);

  // ---------- 天空、雾与光照（12 月江南：低角度冷白日光、江面薄雾） ----------
  const fogColor = new THREE.Color(0xb3bcc0);   // 略带冷蓝的江面水汽：远处山体与树林按距离褪成灰蓝（空气透视）
  let skyDome = null;
  scene.fog = new THREE.FogExp2(fogColor, .00028);   // 江面薄雾：1.5 公里外对岸清晰可辨，3–4 公里外渐隐
  if (!hasSceneSurfaces() || !scene.background?.isTexture) {
    scene.background = fogColor.clone();
    // 程序天穹：九月江南多云天——低层层积云（成团、底部发暗）、高层薄卷云、近地平线被江面水汽冲淡
    const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uSun: { value: new THREE.Vector3(-170, 150, 125).normalize() }, uHaze: { value: fogColor.clone() }, uTime: { value: 0 } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: `varying vec3 vDir; uniform vec3 uSun; uniform vec3 uHaze; uniform float uTime;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
        float fbm(vec2 p) { float v = 0., a = .5; for (int k = 0; k < 6; k++) { v += a * n(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
        void main() {
          vec3 d = normalize(vDir); float up = max(d.y, 0.);
          vec3 zenith = vec3(.47, .56, .66), horizon = vec3(.80, .82, .81);
          vec3 col = mix(horizon, zenith, pow(up, .55));
          float sunAmt = max(dot(d, uSun), 0.);
          col += vec3(1., .93, .8) * (pow(sunAmt, 8.) * .25 + pow(sunAmt, 300.) * 1.5);
          // 云层投影到平面：越近地平线越扁、越密
          vec2 uv = d.xz / max(.06, d.y + .04) * .35 + vec2(uTime * .002, 0.);
          float base = fbm(uv * .9), detail = fbm(uv * 3.1 + 5.);
          float cover = smoothstep(.42, .72, base * .75 + detail * .35);
          float thick = smoothstep(.5, .95, base * .8 + detail * .3);
          vec3 lit = vec3(.93, .92, .89) + vec3(.08, .06, .02) * pow(sunAmt, 4.);
          vec3 cloud = mix(lit, vec3(.55, .57, .6), thick * .75);
          float cirrus = smoothstep(.55, .85, fbm(uv * vec2(.6, 4.) + 31.)) * .35;
          col = mix(col, vec3(.9, .91, .92), cirrus * smoothstep(.0, .25, up));
          col = mix(col, cloud, cover * smoothstep(.0, .12, up));
          // 地平线水汽：与雾同色，使远山、江面与天空自然衔接
          col = mix(col, uHaze, pow(1. - up, 9.) * .9);
          if (d.y < 0.) col = uHaze;
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` }));
    skyDome = sky;
    sky.renderOrder = -1; scene.add(sky);
  }
  const hemi = new THREE.HemisphereLight(0xcdd6de, 0x6b6250, hasSceneSurfaces() ? .45 : .85);
  const sun = new THREE.DirectionalLight(0xfbeedb, 2.6);
  sun.position.set(-170, 150, 125); sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 2048 : 4096, low ? 2048 : 4096); sun.shadow.bias = -.0003; sun.shadow.normalBias = .35; sun.shadow.radius = 2;
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 1200 });   // 阴影范围随镜头移动（见 update）
  const sunOffset = sun.position.clone();
  scene.add(hemi, sun, sun.target);

  // ---------- 地形 ----------
  // 非均匀网格：两岸滩头—石崖—台地一带（玩家阵位所在）最密，江心与远郊逐渐变疏，远处延伸到地平线
  const span = (from, to, step) => { const out = []; for (let v = from; v < to; v += step(v)) out.push(v); out.push(to); return out; };
  const k = low ? 1.7 : 1;
  // 可活动范围（约 x −1400…1900、两岸纵深约 500 米）内网格间距不超过约 5 米：粗网格在山谷处会高出真实地面，走进去会看到头顶悬着地形
  const fine = (excess, slope = .008, cap = 5.2) => excess <= 0 ? 0 : excess < 400 ? Math.min(cap, excess * slope) : cap - 3 + Math.min(60, 3 + (excess - 400) * .03);
  const xs = span(-5000, 5500, x => k * Math.min(60, 3 + fine(x < 0 ? -1100 - x : x - 1500, .006, 2.4)));
  const zs = span(-4500, 5000, z => { const d = Math.abs(Math.abs(z) - R - 60);
    return k * (d < 110 ? 2.6 : Math.abs(z) < R ? Math.min(16, 2.6 + (R - 50 - Math.abs(z)) * .06) : Math.min(60, 2.6 + fine(d - 110, .008, 2.6))); });
  const cx = 0, width = 10500, depth = 9500;
  const terrainGeometry = new THREE.BufferGeometry();
  { const pos = new Float32Array(xs.length * zs.length * 3), index = [];
    let o = 0;
    // 战壕一带由高精度地形块单独绘制（见下），主地形网格在此处压低，避免粗网格盖住壕沟
    const sunken = jiangyinTrenches().map(t => t.bounds);
    const under = (x, z) => sunken.some(b => x > b.minX - 1.5 && x < b.maxX + 1.5 && z > b.minZ - 1.5 && z < b.maxZ + 1.5);
    // 公路附近的顶点取保守（不高于真实地面）的高度，路带本身由下面的高精度路带网格绘制
    const gap = (arr, i) => Math.max(arr[Math.min(i + 1, arr.length - 1)] - arr[i], arr[i] - arr[Math.max(i - 1, 0)]);
    zs.forEach((z, j) => xs.forEach((x, i) => {
      pos[o++] = x; pos[o++] = roadFloorHeight(x, z, Math.hypot(gap(xs, i), gap(zs, j))) - (under(x, z) ? 6 : 0); pos[o++] = z;
    }));
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < xs.length - 1; i++) {
      const a0 = j * xs.length + i, b0 = a0 + 1, c0 = a0 + xs.length, d0 = c0 + 1;
      index.push(a0, c0, b0, b0, c0, d0);
    }
    terrainGeometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    terrainGeometry.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : index);
  }
  const C = hex => new THREE.Color(hex);
  const P = {   // 冬季江南色板（线性空间由 THREE.Color 自动换算）
    mudWet: C(0x4f4636), mud: C(0x6e6149), silt: C(0x9a8a6c), scree: C(0x7f7464), loess: C(0x977f60), rock: C(0x77706a), rockDark: C(0x5c5750),
    straw: C(0x9a8a5c), strawDark: C(0x7b6f4b), turf: C(0x6c6e45), wheat: C(0x56663a), fallow: C(0x7a6249), scrub: C(0x535637),
    litter: C(0x5d4e3a), farHill: C(0x5d6049), path: C(0x8c7a5d),
  };
  const fieldCell = (x, z) => { // 稻麦田：旋转网格田块
    const u = x * .96 + z * .28, v = -x * .28 + z * .96, ix = Math.floor(u / 34), iz = Math.floor(v / 21);
    const fu = u / 34 - ix, fv = v / 21 - iz, edge = Math.min(fu, 1 - fu, fv * 1.6, (1 - fv) * 1.6);
    return { id: cellHash(ix, iz), edge };
  };
  const forestMask = (x, z) => smoothstep(.52, .66, terrainFbm(x * .012 + 50, z * .012 - 20, 3));
  const color = new THREE.Color();
  function paintTerrain(geometry) {
    const positions = geometry.attributes.position;
    geometry.computeVertexNormals();
    const normals = geometry.attributes.normal, colors = [], splat = [];
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), ny = normals.getY(i);
      const a = Math.abs(z - riverCenter(x)) - SO, n1 = terrainFbm(x * .015, z * .015, 3), n2 = terrainFbm(x * .07 + 9, z * .07, 3);
      let s = 0;
      if (y < .15) { color.copy(P.mudWet).lerp(P.mud, smoothstep(-1.2, .15, y)); s = 1; }
      else if (y < 2.8 && ny > .84) { color.copy(P.mud).lerp(P.silt, smoothstep(.15, 1.2, y)).lerp(P.scree, n2 * .35); s = .85; }
      else if (ny < .78) {
        const band = Math.abs(Math.sin(y * 1.3 + n2 * 4));
        color.copy(P.loess).lerp(P.rock, n1).lerp(P.rockDark, band * .35 + smoothstep(.6, .3, ny) * .25);
        if (ny > .62) color.lerp(P.scree, .35).lerp(P.scrub, smoothstep(.62, .78, ny) * .4);
        s = .3;
      } else if (a > 420) {
        color.copy(P.farHill).lerp(P.scrub, n1).lerp(P.straw, smoothstep(.65, .9, n2) * .3);
      } else {
        color.copy(P.straw).lerp(P.strawDark, n2 * .6).lerp(P.turf, smoothstep(.45, .75, n1) * .55);
        const field = fieldCell(x, z), farm = y < 34 && a > 112 && (nearVillage(x, z, 150) || n1 > .5 || z < 0);
        if (farm && field.edge > .03) color.lerp(field.id < .38 ? P.wheat : field.id < .7 ? P.fallow : P.strawDark, .78);
        else if (farm) color.lerp(P.path, .5);
        color.lerp(P.litter, forestMask(x, z) * smoothstep(26, 40, y) * .55);
        if (y > 36) color.lerp(P.scrub, smoothstep(36, 55, y) * .6);
      }
      const road = y > .5 ? roadProbe(x, z) : null;   // 公路两侧的路肩与路堑边坡：压实的黄土色
      if (road && road.d < ROAD.half + ROAD.shoulder) color.lerp(P.path, (1 - smoothstep(ROAD.half, ROAD.half + ROAD.shoulder, road.d)) * .7);
      colors.push(color.r, color.g, color.b); splat.push(s);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('surfSplat', new THREE.Float32BufferAttribute(splat, 1));
  }
  paintTerrain(terrainGeometry);
  const makeTerrainMaterial = (extra = {}) => patchSurface(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0, ...extra }),
    { map: surfaceMap('earth'), map2: surfaceMap('dry-silt'), splatAttribute: true, tile: 3.2, macro: .45, detail: .85, mottle: .08, bump: 1.1, rough: .1 });
  const terrainMaterial = makeTerrainMaterial();
  // 战壕地形块与主地形在边缘重叠：略向镜头偏移，避免两层网格闪烁
  const patchMaterial = makeTerrainMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true; terrain.castShadow = true;
  scene.add(terrain);
  // 公路高精度路带地形：沿路中线每 4 米一排、横向约 1.2 米一列，覆盖路面、路肩与路堑/路堤边坡及两侧 14 米，
  // 真实挖出路堑（粗网格在这里已被压低到真实地面以下，不会再悬在头顶）
  for (const road of jiangyinRoads()) {
    const W = ROAD.half + ROAD.shoulder + 14, step = low ? 2 : 1.2, cols = Math.ceil(2 * W / step) + 1, n = road.points.length;
    const pos = new Float32Array(n * cols * 3), index = [];
    let o = 0;
    road.points.forEach(([x, z], i) => {
      const [ax, az] = road.points[Math.max(i - 1, 0)], [bx, bz] = road.points[Math.min(i + 1, n - 1)];
      const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      // 弯道内侧收窄，避免横向网格线在小半径弯道内侧交叉翻折
      let inner = 1, side = 0;
      if (i > 0 && i < n - 1) {
        const t1 = Math.atan2(z - az, x - ax), t2 = Math.atan2(bz - z, bx - x), turn = Math.atan2(Math.sin(t2 - t1), Math.cos(t2 - t1));
        const radius = Math.abs(turn) > 1e-3 ? ROAD.sample / Math.abs(turn) : Infinity;
        inner = Math.min(1, radius * .8 / W); side = Math.sign(turn);
      }
      for (let c = 0; c < cols; c++) {
        let u = -W + c * 2 * W / (cols - 1);
        if (side && Math.sign(u) === side) u *= inner;   // 左转时内侧为 +u（法线 n 指向左侧）
        const px = x + nx * u, pz = z + nz * u;
        pos[o++] = px; pos[o++] = groundHeight(px, pz); pos[o++] = pz;
      }
    });
    for (let i = 0; i < n - 1; i++) for (let c = 0; c < cols - 1; c++) {
      const a0 = i * cols + c, b0 = a0 + 1, c0 = a0 + cols, d0 = c0 + 1;
      index.push(a0, b0, c0, b0, d0, c0);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(index, 1));
    paintTerrain(geometry);
    const patch = new THREE.Mesh(geometry, patchMaterial);
    patch.receiveShadow = patch.castShadow = true;
    scene.add(patch);
  }
  // 战壕高精度地形块：0.3 米网格，壕壁、壕底、胸墙都在地形里真实挖出（士兵可下到壕里，壕沟能挡子弹）
  const trenchPatches = [];
  for (const trench of jiangyinTrenches()) {
    const b = trench.bounds, m = 8, step = low ? .45 : .3;
    const px = span(b.minX - m, b.maxX + m, () => step), pz = span(b.minZ - m, b.maxZ + m, () => step);
    const geometry = new THREE.BufferGeometry(), pos = new Float32Array(px.length * pz.length * 3), index = [];
    let o = 0;
    for (const z of pz) for (const x of px) { pos[o++] = x; pos[o++] = groundHeight(x, z); pos[o++] = z; }
    for (let j = 0; j < pz.length - 1; j++) for (let i = 0; i < px.length - 1; i++) {
      const a0 = j * px.length + i, b0 = a0 + 1, c0 = a0 + px.length, d0 = c0 + 1;
      index.push(a0, c0, b0, b0, c0, d0);
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(index, 1));
    paintTerrain(geometry);
    // 壕内与新翻出的土：深褐湿土；胸墙：黄褐翻土
    const col = geometry.attributes.color, c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], dug = naturalGroundHeight(x, z) - y;
      if (dug > .15) c.setHex(0x4a3f31).lerp(new THREE.Color(0x3a3127), Math.min(1, dug / TRENCH.depth));
      else if (dug < -.08) c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).lerp(new THREE.Color(0x7c6a4e), Math.min(.85, -dug * 2.2));
      else continue;
      col.setXYZ(i, c.r, c.g, c.b);
    }
    const patch = new THREE.Mesh(geometry, patchMaterial);
    patch.receiveShadow = patch.castShadow = true;
    scene.add(patch); trenchPatches.push(patch);
  }

  // ---------- 江水 ----------
  const waterGeometry = new THREE.PlaneGeometry(9000, 2600, low ? 450 : 750, low ? 130 : 220);   // 东西 9 公里、覆盖弯道
  waterGeometry.rotateX(-Math.PI / 2);
  waterGeometry.translate(500, 0, 350);
  const wp = waterGeometry.attributes.position, waterDepth = [];
  for (let i = 0; i < wp.count; i++) waterDepth.push(-groundHeight(wp.getX(i), wp.getZ(i)));
  waterGeometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(waterDepth, 1));
  const MAX_WAKES = 32;
  const waterUniforms = { uTime: { value: 0 }, uWaterNormals: { value: waterNormalTexture() }, uFlow: { value: FLOW },
    uWakes: { value: Array.from({ length: MAX_WAKES }, () => new THREE.Vector4()) },
    uWakeSize: { value: Array.from({ length: MAX_WAKES }, () => new THREE.Vector3()) }, uWakeCount: { value: 0 },
    // 无 HDR 环境贴图时，手动补上天空与云的菲涅耳倒影；有项目 sky.hdr 时由 PBR 环境反射负责，只留少量补充
    uSkyReflect: { value: hasSceneSurfaces() && scene.environment ? .25 : 1 }, uHaze: { value: fogColor } };
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4e35, roughness: .26, metalness: 0, envMapIntensity: .9 });
  waterMaterial.customProgramCacheKey = () => 'jiangyin-water';
  waterMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float waterDepth; varying float vWaterDepth; varying vec3 vWaterWorld; uniform float uTime; uniform float uFlow;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vWaterDepth = waterDepth;
  // 涛涛江水：几组沿 +x（向东）推进的长波与横向涌浪，深水处起伏大，近岸渐平
  float swell = smoothstep(.2, 2.5, waterDepth);
  float px = position.x - uTime * uFlow * 2.2;
  transformed.y += swell * (sin(px * .085 + position.z * .021) * .28 + sin(px * .19 - position.z * .07 + 1.7) * .14
    + sin((position.x - uTime * uFlow * 3.5) * .33 + position.z * .16) * .06);
  vWaterWorld = (modelMatrix * vec4(transformed, 1.)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vWaterDepth; varying vec3 vWaterWorld; uniform float uTime; uniform float uFlow; uniform sampler2D uWaterNormals;
uniform vec4 uWakes[${MAX_WAKES}]; uniform vec3 uWakeSize[${MAX_WAKES}]; uniform int uWakeCount; uniform float uSkyReflect; uniform vec3 uHaze;
float wakeFoam = 0.;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), u.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), u.x), u.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
  float shallow = smoothstep(2.4, .0, vWaterDepth);
  // 泥沙浑流团与顺流拉长的水纹，整体随江水向东漂移
  vec2 drift = vec2(uTime * uFlow, 0.);
  float plume = wNoise((vWaterWorld.xz - drift) * vec2(.006, .014)) * .6 + wNoise((vWaterWorld.xz - drift * 1.2) * vec2(.03, .07)) * .4;
  float streak = smoothstep(.62, .9, wNoise((vWaterWorld.xz - drift * 1.4) * vec2(.02, .55)));
  diffuseColor.rgb *= .86 + plume * .28;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .35, .23), shallow * .55);
  float foamBand = smoothstep(.55, .05, vWaterDepth) * smoothstep(-.35, .05, vWaterDepth);
  float foam = foamBand * smoothstep(.45, .8, wNoise((vWaterWorld.xz - drift * 1.3) * vec2(.6, 1.8)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.62, .58, .5), foam * .8);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + .03, streak * .35 * (1. - shallow));
  // 航迹：船艏浪、贴船身的白沫、船尾翻滚的螺旋桨尾流与向两侧张开的开尔文波（约 19.5°），随航速增强、随距离消散
  for (int i = 0; i < ${MAX_WAKES}; i++) {
    if (i >= uWakeCount) break;
    vec4 w = uWakes[i]; vec3 sz = uWakeSize[i];
    vec2 fwd = vec2(cos(w.z), sin(w.z)), right = vec2(-fwd.y, fwd.x), rel = vWaterWorld.xz - w.xy;
    float along = dot(rel, fwd), side = dot(rel, right), halfLen = sz.x * .5, halfBeam = sz.y * .5;
    float speedK = clamp(w.w / 8., 0., 1.);
    float hull = length(vec2(along / (halfLen + 1.5), side / (halfBeam + 1.2)));
    float contact = smoothstep(1.25, 1., hull) * smoothstep(.75, 1., hull) * (.35 + speedK * .65);
    float bow = smoothstep(halfLen * .55, halfLen * .95, along) * smoothstep(halfLen + 8. * speedK + 2., halfLen, along)
      * smoothstep(halfBeam * (1.6 + speedK), halfBeam * .5, abs(side)) * speedK;
    float behind = -along - halfLen;
    float trail = 0., kelvin = 0.;
    if (behind > 0.) {
      float reach = sz.x * (1.5 + speedK * 4.5);
      float fade = pow(smoothstep(reach, 0., behind), 1.6);
      trail = smoothstep(halfBeam * (1. + behind * .018), halfBeam * .2, abs(side)) * fade * speedK;
      float arm = abs(abs(side) - (halfBeam + behind * .354));
      kelvin = smoothstep(2.5 + behind * .02, 0., arm) * fade * speedK * .8;
    }
    float breakup = wNoise((vWaterWorld.xz - drift * .5) * .9 + float(i) * 7.3) * .6 + wNoise(vWaterWorld.xz * 3.1) * .4;
    wakeFoam = max(wakeFoam, max(contact, max(bow, trail * .9)) * smoothstep(.25, .6, breakup) + kelvin * smoothstep(.45, .75, breakup));
  }
  wakeFoam = clamp(wakeFoam, 0., 1.);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.78, .76, .7), wakeFoam * .85);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, .55, shallow * .6 + foam);
  // 远处水面更“镜面”：避免细碎法线在远处闪烁，并让远江映出天光
  float viewDist = length(vWaterWorld - cameraPosition);
  roughnessFactor = mix(roughnessFactor, .1, smoothstep(250., 1800., viewDist) * (1. - shallow));
  roughnessFactor = mix(roughnessFactor, .8, wakeFoam);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  vec2 wuv = vWaterWorld.xz;
  // 三层法线都顺流（+x）平移，速度不同：近看细碎波纹，远看成片向东推进的浪
  vec3 n1 = texture2D(uWaterNormals, (wuv - vec2(uTime * uFlow * 1.0, 0.)) * vec2(.03, .05)).xyz * 2. - 1.;
  vec3 n2 = texture2D(uWaterNormals, (wuv - vec2(uTime * uFlow * 1.6, uTime * .15)) * vec2(.08, .12)).xyz * 2. - 1.;
  vec3 n3 = texture2D(uWaterNormals, (wuv - vec2(uTime * uFlow * .6, 0.)) * .006).xyz * 2. - 1.;
  vec2 slope = n1.xy * .6 + n2.xy * .35 + n3.xy * .6;
  // 顶点长波的解析斜率
  float swellN = smoothstep(.2, 2.5, vWaterDepth), px = vWaterWorld.x - uTime * uFlow * 2.2;
  slope.x += swellN * (cos(px * .085 + vWaterWorld.z * .021) * .085 * .28 + cos(px * .19 - vWaterWorld.z * .07 + 1.7) * .19 * .14) * 3.;
  vec3 wn = normalize(vec3(slope.x * .25, 1., slope.y * .25));
  normal = normalize((viewMatrix * vec4(wn, 0.)).xyz);`)
      .replace('#include <opaque_fragment>', `
  // 菲涅耳天空倒影：掠射角看江面时映出天光与云的亮度（远处江面发亮、近处透出泥沙本色）
  vec3 viewDir = normalize(vWaterWorld - cameraPosition);
  vec3 wnWorld = normalize(inverseTransformDirection(normal, viewMatrix));
  vec3 refl = reflect(viewDir, wnWorld);
  float fres = .02 + .98 * pow(1. - clamp(dot(-viewDir, wnWorld), 0., 1.), 5.);
  float ry = max(refl.y, 0.);
  vec3 skyRefl = mix(uHaze * 1.04, vec3(.6, .67, .74), pow(ry, .6));
  skyRefl = mix(skyRefl, vec3(.86, .86, .84), smoothstep(.45, .75, wNoise(refl.xz / max(.08, ry) * .6 + uTime * .002)) * smoothstep(.02, .2, ry) * .6);
  outgoingLight = mix(outgoingLight, skyRefl, fres * uSkyReflect * (1. - wakeFoam) * .85);
  #include <opaque_fragment>`);
  };
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.receiveShadow = true;
  scene.add(water);

  seed = 11;   // 开战前江面无沉船；堵塞线由第一、二阶段之间的自沉演出逐艘形成

  // ---------- 植被 ----------
  // 远景树林：按林地噪声成片分布；崖面、阵位、村落中心、田块内不长树
  const cards = [];
  for (let i = 0; i < 160000 && cards.length < (low ? 6000 : 14000); i++) {
    // 近处（阵地周边 2 公里内）密、远处疏
    const far = rand() < .3, x = far ? -4000 + rand() * 9000 : -1800 + rand() * 3700, z = far ? -3500 + rand() * 7500 : -2000 + rand() * 4200;
    const y = groundHeight(x, z), a = Math.abs(z - riverCenter(x)) - SO;
    if (y < 22 && a < 420 && z > 0 || a < 104 || nearPost(x, z, 30) || nearVillage(x, z, 16)) continue;
    const e = 2.5, slope = Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
    if (slope > .7) continue;
    const density = forestMask(x, z) * .9 + (y > 38 ? .45 : 0) + (z < 0 ? -.3 : 0) + .04;
    if (rand() > density) continue;
    const r = rand(), kind = y > 40 ? (r < .62 ? 'pine' : r < .85 ? 'broadleaf' : 'bare') : (r < .55 ? 'bare' : r < .8 ? 'pine' : 'broadleaf');
    const height = kind === 'pine' ? 9 + rand() * 7 : kind === 'broadleaf' ? 8 + rand() * 6 : 7 + rand() * 7;
    cards.push({ x, y, z, kind, height, width: height * (kind === 'pine' ? .62 : .58) * (.85 + rand() * .3), heading: rand() * Math.PI, tint: .8 + rand() * .35 });
  }
  // 村旁竹林/樟树、坟头树等零星散树
  for (const [vx, vz, , spread] of villages) for (let n = 0; n < 24; n++) {
    const x = vx + (rand() - .5) * spread * 2.2, z = vz + (rand() - .5) * spread * 1.6, y = groundHeight(x, z);
    if (y < 3 || nearPost(x, z, 20) || nearVillage(x, z, 10)) continue;
    const kind = rand() < .5 ? 'broadleaf' : 'bare', height = 8 + rand() * 6;
    cards.push({ x, y, z, kind, height, width: height * .6, heading: rand() * Math.PI, tint: .85 + rand() * .3 });
  }
  const treeCards = createTreeCards(scene, cards);
  // 近景：崖顶与滩头的真实枝干树（项目 woodland.js；冬季全为落叶状态）
  const woodland = [];
  for (let i = 0; i < 2000 && woodland.length < 110; i++) {
    const side = rand() > .5 ? 1 : -1, x = -900 + rand() * 1700;
    const beach = rand() < .3, z = riverCenter(x) + side * (SO + (beach ? 80 + rand() * 3 : 108 + rand() * 40)), y = groundHeight(x, z);
    if (y < .8 || nearPost(x, z, 15) || woodland.some(t => Math.hypot(t.x - x, t.z - z) < 7)) continue;
    const species = beach ? 'willow' : rand() < .55 ? 'elm' : 'poplar';
    const height = species === 'poplar' ? 10 + rand() * 4 : species === 'elm' ? 7 + rand() * 4 : 5.5 + rand() * 3;
    woodland.push({ x, y: y - .05, z, seed: 2000 + i, species, age: rand() < .2 ? 'old' : 'adult', height,
      radius: height * (species === 'poplar' ? .022 : species === 'elm' ? .035 : .042), dead: true, sparse: false, heading: rand() * Math.PI * 2 });
  }
  const woodlandMeshes = createWoodlandTrees(scene, woodland);
  // 枯草丛：阵位与滩头附近密，远处稀
  const grassSpots = [];
  for (let i = 0; i < 260000 && grassSpots.length < (low ? 22000 : 70000); i++) {
    const anchor = JIANGYIN_POSTS.filter(p => p.kind === 'battery')[Math.floor(rand() * 5)], ang = rand() * 6.283, rr = Math.sqrt(rand()) * 320;
    const x = anchor.x + Math.cos(ang) * rr, z = anchor.z + Math.sin(ang) * rr, y = groundHeight(x, z);
    if (y < .6) continue;
    const e = 1.2, slope = Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
    if (slope > .55) continue;
    const near = Math.max(...JIANGYIN_POSTS.map(p => smoothstep(320, 30, Math.hypot(p.x - x, p.z - z))));
    const field = fieldCell(x, z);
    if (rand() > .1 + near * .9 || (field.edge > .05 && rand() < .7 && y > 15)) continue;
    const k = .8 + rand() * .45;
    grassSpots.push({ x, y, z, heading: rand() * 6.3, scale: .7 + rand() * .7, tall: .7 + rand() * .7,
      tint: [k * (.95 + rand() * .1), k * (.9 + rand() * .12), k * (.78 + rand() * .15)] });
  }
  const grass = createGrass(scene, grassSpots);
  // 芦苇荡：两岸浅滩与泥滩成片生长（九月仍青中带黄），近水处密、成丛分布
  const reedSpots = [];
  for (let i = 0; i < 400000 && reedSpots.length < (low ? 9000 : 26000); i++) {
    const side = rand() < .5 ? 1 : -1, x = -1500 + rand() * 3000, z = riverCenter(x) + side * (SO + 40 + rand() * 45), y = groundHeight(x, z);
    if (y < -.5 || y > 1.4 || nearPost(x, z, 25)) continue;
    if (rand() > smoothstep(.35, .6, terrainFbm(x * .02 + 40, z * .02, 3)) * smoothstep(1.4, .2, y)) continue;
    const k = .85 + rand() * .25, green = rand();
    reedSpots.push({ x, y: Math.max(y, -.35), z, heading: rand() * 6.3, scale: .9 + rand() * .5, tall: 2.2 + rand() * 1.2,
      tint: [k * (.78 + green * .1), k * (.82 + green * .12), k * (.55 + green * .05)] });
  }
  const reeds = createGrass(scene, reedSpots);

  // ---------- 阵地痕迹：弹坑、伪装网 ----------
  const battlefield = new THREE.Group();
  const scorch = mat('scorch', 0x2e2a24, 1, 0), spoil = mat('crater-spoil', 0x6e5f47, 1, 0);
  for (const post of JIANGYIN_POSTS.filter(p => p.kind === 'battery')) {
    for (let n = 0; n < 22; n++) {
      const ang = rand() * 6.283, rr = 14 + rand() * 85, x = post.x + Math.cos(ang) * rr, z = post.z + Math.sin(ang) * rr, y = groundHeight(x, z);
      const e = 2, slope = Math.hypot(groundHeight(x + e, z) - groundHeight(x - e, z), groundHeight(x, z + e) - groundHeight(x, z - e)) / (2 * e);
      if (y < 1.5 || slope > .35) continue;
      const r = 1.2 + rand() * 2.6;
      const pit = new THREE.Mesh(new THREE.CircleGeometry(r, 18), scorch);
      pit.rotation.x = -Math.PI / 2; pit.position.set(x, y + .06, z); battlefield.add(pit);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 1.05, r * .28, 5, 18), spoil);
      rim.rotation.x = -Math.PI / 2; rim.scale.set(1, 1, .35); rim.position.set(x, y + .02, z); battlefield.add(rim);
    }
  }
  // 伪装网：罩在炮位后方的弹药掩体与炮班位置上方（不挡炮手视线），网上缀着枯草与布条
  const netTexture = (() => {
    const size = 128, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, cord = (x % 8 < 1 || y % 8 < 1) ? 1 : 0;
      const tuft = terrainFbm(x * .09, y * .09, 3), garnish = tuft > .5 ? 1 : 0;
      const c = garnish ? (tuft > .62 ? [92, 88, 58] : [122, 108, 74]) : [58, 54, 42];
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = garnish || cord ? 255 : 0;
    }
    const texture = new THREE.DataTexture(data, size, size); texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.needsUpdate = true; return texture;
  })();
  const netMaterial = new THREE.MeshStandardMaterial({ map: netTexture, alphaTest: .5, side: THREE.DoubleSide, roughness: 1 });
  const poleMaterial = mat('net-pole', 0x4d3f2e, 1, 0);
  for (const post of JIANGYIN_POSTS.filter(p => p.kind === 'battery' && p.mount !== 'nest')) {
    const h = postFacing(post), fx = -Math.sin(h), fz = -Math.cos(h);
    const cx = post.x - fx * 13, cz = post.z - fz * 13, w = 14, d = 10;
    const geometry = new THREE.PlaneGeometry(w, d, 28, 20); geometry.rotateX(-Math.PI / 2);
    const gp = geometry.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const u = gp.getX(i) / (w / 2), v = gp.getZ(i) / (d / 2), wx = cx + gp.getX(i) * Math.cos(h) + gp.getZ(i) * Math.sin(h), wz = cz - gp.getX(i) * Math.sin(h) + gp.getZ(i) * Math.cos(h);
      const sag = (1 - u * u) * (1 - v * v) * .9 + terrainFbm(wx * .4, wz * .4, 2) * .35;
      const edge = Math.max(Math.abs(u), Math.abs(v)) > .9 ? (Math.max(Math.abs(u), Math.abs(v)) - .9) * 14 : 0;   // 网边垂到地面
      gp.setY(i, groundHeight(wx, wz) + Math.max(.3, 3.4 - sag - edge));
      gp.setX(i, wx); gp.setZ(i, wz);
    }
    geometry.computeVertexNormals(); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from(geometry.attributes.uv.array, a => a * 3), 2));
    const net = new THREE.Mesh(geometry, netMaterial); net.castShadow = net.receiveShadow = true; net.userData.keep = true; battlefield.add(net);
    for (const [a, b] of [[-.6, -.55], [.6, -.55], [-.6, .55], [.6, .55], [0, 0]]) {
      const px = cx + a * w * .5 * Math.cos(h) + b * d * .5 * Math.sin(h), pz = cz - a * w * .5 * Math.sin(h) + b * d * .5 * Math.cos(h);
      const top = a === 0 ? 3.4 : 2.7, pole = new THREE.Mesh(new THREE.CylinderGeometry(.05, .07, top, 5), poleMaterial);
      pole.position.set(px, groundHeight(px, pz) + top / 2, pz); battlefield.add(pole);
    }
  }
  mergeStatic(battlefield);
  scene.add(battlefield);

  // ---------- 江南村落：白墙（粉墙）黛瓦，三平面投影项目 plaster / tiles 贴图 ----------
  const houseSpots = [];
  for (const [vx, vz, count, spread] of villages) for (let i = 0; i < count; i++) {
    const x = vx + (rand() - .5) * spread * 2, z = vz + (rand() - .5) * spread * 1.4;
    if (nearPost(x, z, 22) || groundHeight(x, z) < 3) continue;
    houseSpots.push([x, groundHeight(x, z), z, (rand() - .5) * .5 + (rand() > .5 ? 0 : Math.PI / 2), 7 + rand() * 6, 4.6 + rand() * 1.6]);
  }
  const wallGeo = new THREE.BoxGeometry(1, 1, 1), roofGeo = new THREE.CylinderGeometry(.62, .62, 1, 3);
  roofGeo.rotateZ(Math.PI / 2); roofGeo.rotateX(Math.PI / 2 - Math.PI / 6);
  const wallMaterial = patchSurface(new THREE.MeshStandardMaterial({ color: 0xd3cdbd, roughness: .95 }),
    { map: surfaceMap('weathered-plaster'), world: true, tile: 2.4, detail: .9, streaks: .8, mottle: .14, bump: .4 });
  const roofMaterial = patchSurface(new THREE.MeshStandardMaterial({ color: 0x4a4d4c, roughness: .9 }),
    { map: surfaceMap('tiles'), world: true, tile: 1.4, detail: .9, mottle: .18, bump: .8 });
  const plinthMaterial = patchSurface(new THREE.MeshStandardMaterial({ color: 0x6e6a62, roughness: .95 }),
    { map: surfaceMap('paving'), world: true, tile: 1.6, detail: .8, bump: .6 });
  const walls = new THREE.InstancedMesh(wallGeo, wallMaterial, houseSpots.length);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMaterial, houseSpots.length);
  const plinths = new THREE.InstancedMesh(wallGeo, plinthMaterial, houseSpots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  houseSpots.forEach(([x, h, z, r, len, deep], i) => {
    q.setFromEuler(new THREE.Euler(0, r, 0));
    walls.setMatrixAt(i, m4.compose(new THREE.Vector3(x, h + 1.7, z), q, new THREE.Vector3(len, 3.8, deep)));
    plinths.setMatrixAt(i, m4.compose(new THREE.Vector3(x, h + .2, z), q, new THREE.Vector3(len + .25, .9, deep + .25)));
    roofs.setMatrixAt(i, m4.compose(new THREE.Vector3(x, h + 4.25, z), q, new THREE.Vector3(deep + 1.2, len + .8, 2.6)));
  });
  for (const mesh of [walls, roofs, plinths]) { mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh); }

  // ---------- 烟（煤烟、沉船燃烧） ----------
  const smoke = createSmoke(scene);
  const decor = new THREE.Group(), wood = mat('stake', 0x5b4a36, 1, 0), wire = [];
  for (const sign of [1, -1]) {
    for (let x = -900; x < 1000; x += 3.2 + rand() * 1.5) {
      const z = sign * (SO + 75.5 + rand() * 1.5), y = groundHeight(x, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 1.4, 5), wood);
      post.position.set(x, y + .6, z); post.rotation.z = (rand() - .5) * .2; decor.add(post);
      wire.push(x, y + 1.1, z, x + 3.6, groundHeight(x + 3.6, z) + .9, z, x, y + .5, z, x + 3.6, groundHeight(x + 3.6, z) + 1.2, z);
    }
    for (let x = -800; x < 950; x += 9 + rand() * 6) { // 浅水中的反登陆木桩
      const z = sign * (SO + 66 + rand() * 4);
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, 3.4, 5), wood);
      stake.position.set(x, groundHeight(x, z) + 1.2, z); stake.rotation.set((rand() - .5) * .4, 0, sign * -.35); decor.add(stake);
    }
  }
  // ---------- 军用公路路面：沿中心线铺一条带车辙的土路网格（略高于地形，避免粗网格穿插），路边立里程木桩 ----------
  {
    const roadMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    patchSurface(roadMaterial, { map: surfaceMap('dry-silt'), detail: .8, tile: 3, mottle: .14, bump: .5, world: true });
    for (const road of jiangyinRoads()) {
      const across = [-1, -.62, -.38, -.14, .14, .38, .62, 1], positions = [], colors = [], index = [];
      const dirt = new THREE.Color(0x8a7656), rut = new THREE.Color(0x5e4e3a), verge = new THREE.Color(0x7b7350);
      road.points.forEach(([x, z], i) => {
        const [x2, z2] = road.points[Math.min(i + 1, road.points.length - 1)], [x0, z0] = road.points[Math.max(i - 1, 0)];
        const tx = x2 - x0, tz = z2 - z0, len = Math.hypot(tx, tz) || 1, nx = -tz / len, nz = tx / len;
        across.forEach(u => {
          const w = u * (ROAD.half + .4), px = x + nx * w, pz = z + nz * w;
          positions.push(px, Math.max(road.heights[i], groundHeight(px, pz)) + .14 - Math.abs(u) * .06, pz);
          const c = Math.abs(Math.abs(u) - .5) < .14 ? rut : Math.abs(u) > .9 ? verge : dirt;
          const n = terrainFbm(px * .2, pz * .2, 2); colors.push(c.r * (.86 + n * .28), c.g * (.86 + n * .28), c.b * (.86 + n * .28));
        });
        if (i) { const a = (i - 1) * across.length, b = i * across.length;
          for (let k = 0; k < across.length - 1; k++) index.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1); }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(index); geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, roadMaterial); mesh.receiveShadow = true; mesh.userData.keep = true; decor.add(mesh);
      for (let s = 50; s < road.lengths.at(-1); s += 100) {   // 每百米一根里程桩
        const i = road.lengths.findIndex(l => l >= s), [x, z] = road.points[i], [x2, z2] = road.points[Math.min(i + 1, road.points.length - 1)];
        const len = Math.hypot(x2 - x, z2 - z) || 1, px = x - (z2 - z) / len * (ROAD.half + 1), pz = z + (x2 - x) / len * (ROAD.half + 1);
        const post = new THREE.Mesh(new THREE.BoxGeometry(.18, 1, .18), mat('stake', 0x5b4a36, 1, 0)); post.position.set(px, groundHeight(px, pz) + .5, pz); decor.add(post);
      }
    }
  }
  // 战壕细部（壕沟本身已挖进地形）：木板护壁与立柱、壕底踏板、江面一侧胸墙上的沙袋射击位
  const plank = mat('stake', 0x5b4a36, 1, 0), duck = mat('wood', 0x7a6347, .95, 0), sandbag = mat('sandbag', 0x9a8763, 1, 0);
  for (const trench of jiangyinTrenches()) {
    const p = trench.points;
    for (let i = 0; i < p.length - 1; i++) {
      const [x0, z0] = p[i], [x1, z1] = p[i + 1], len = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const nx = -uz, nz = ux, yaw = Math.atan2(-uz, ux), frontSign = Math.sign(nx * trench.fx + nz * trench.fz) || 1;
      const mainLine = i >= 2 && i < p.length - 3;
      for (let t = .4; t < len - .2; t += .8) {
        const x = x0 + ux * t, z = z0 + uz * t, floor = groundHeight(x, z), lip = naturalGroundHeight(x, z), deep = lip - floor;
        if (deep < .3) continue;
        for (const side of [-1, 1]) {   // 护壁木板（竖直贴壕壁）
          const wall = new THREE.Mesh(new THREE.BoxGeometry(.82, deep + .1, .05), plank);
          wall.position.set(x + nx * side * (TRENCH.floorHalf + .05), floor + (deep + .1) / 2, z + nz * side * (TRENCH.floorHalf + .05));
          wall.rotation.y = yaw; decor.add(wall);
          if (Math.round(t / .8) % 2) {
            const stake = new THREE.Mesh(new THREE.CylinderGeometry(.05, .06, deep + .35, 5), plank);
            stake.position.set(x + nx * side * (TRENCH.floorHalf + .02), floor + (deep + .35) / 2, z + nz * side * (TRENCH.floorHalf + .02)); decor.add(stake);
          }
        }
        const board = new THREE.Mesh(new THREE.BoxGeometry(.75, .05, .6), duck);   // 壕底踏板
        board.position.set(x, floor + .04, z); board.rotation.y = yaw; decor.add(board);
        if (mainLine && Math.round(t / .8) % 3 !== 1) {   // 胸墙沙袋，留出射击缺口
          const bag = new THREE.Mesh(new THREE.BoxGeometry(.78, .3, .5), sandbag);
          const bx = x + nx * frontSign * 1.05, bz = z + nz * frontSign * 1.05;
          bag.position.set(bx, naturalGroundHeight(bx, bz) + .2 + (rand() - .5) * .04, bz); bag.rotation.set(0, yaw + (rand() - .5) * .12, (rand() - .5) * .06);
          decor.add(bag);
        }
      }
    }
  }
  // 要塞指挥所与旗杆（黄山顶）
  const hqX = -430, hqZ = R + 300, hqY = groundHeight(hqX, hqZ);   // 黄山炮台后方约 70 米的山脊上（不与炮位重叠）
  const hq = new THREE.Mesh(new THREE.BoxGeometry(10, 3.4, 7), mat('concrete', 0x99958a, .97, 0)); hq.position.set(hqX, hqY + 1.2, hqZ); decor.add(hq);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 12, 6), mat('dark', 0x232526, .65, .4)); pole.position.set(hqX + 7, hqY + 6, hqZ); decor.add(pole);
  mergeStatic(decor);
  const wireGeometry = new THREE.BufferGeometry(); wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  decor.add(new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: 0x3a3530 })));
  scene.add(decor);
  const vesselTrack = new WeakMap();
  return {
    terrain, water, sun, treeCards, woodland: woodlandMeshes, grass,
    groundHeight,
    surfaceHeight: (x, z) => Math.max(0, groundHeight(x, z)),
    stats: { cards: cards.length, woodland: woodland.length, grass: grassSpots.length, reeds: reedSpots.length, houses: houseSpots.length },
    // sources：[{ object, points: [[x, y, z, r]], rate, shade }]，点为 object 本地坐标
    puff: (at, options) => smoke.puff(at, options),
    // vessels：[{ object, length, beam }]，按模型位移求航速与航向，写入江水航迹
    update(time, dt = 0, sources = [], camera = null, vessels = []) {
      waterUniforms.uTime.value = time;
      if (skyDome) skyDome.material.uniforms.uTime.value = time;
      let count = 0;
      const wakes = waterUniforms.uWakes.value, sizes = waterUniforms.uWakeSize.value;
      for (const vessel of vessels) {
        if (count >= MAX_WAKES || !vessel.object) break;
        const o = vessel.object, x = o.position.x, z = o.position.z, last = vesselTrack.get(o);
        let speed = last?.speed ?? 0, angle = last?.angle ?? -o.rotation.y - Math.PI / 2;
        if (last && dt > 0) {
          const dx = x - last.x, dz = z - last.z, d = Math.hypot(dx, dz);
          if (d > 1e-4) angle = Math.atan2(dz, dx);
          speed += (Math.min(20, d / dt) - speed) * Math.min(1, dt * 1.5);
        }
        vesselTrack.set(o, { x, z, speed, angle });
        if (o.position.y < -(vessel.beam ?? 6) || !o.visible) continue;
        wakes[count].set(x, z, angle, speed); sizes[count].set(vessel.length ?? 40, vessel.beam ?? 8, 0); count++;
      }
      waterUniforms.uWakeCount.value = count;
      if (camera) {   // 阴影跟随镜头：以镜头前方约 150 米为中心，按 8 米网格取整避免阴影抖动
        const dir = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const fx = Math.round((camera.position.x + dir.x * 150) / 8) * 8, fz = Math.round((camera.position.z + dir.z * 150) / 8) * 8;
        sun.target.position.set(fx, 0, fz); sun.position.set(fx + sunOffset.x, sunOffset.y, fz + sunOffset.z);
        sun.target.updateMatrixWorld();
      }
      smoke.update(time, dt, sources);
    },
  };
}

// ---------- 软粒子烟 ----------
function smokeTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1, r = Math.hypot(u, v);
    const n = terrainFbm(x * .15, y * .15, 3), a = Math.max(0, 1 - r) ** 1.6 * (.55 + n * .7);
    const i = (y * size + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.min(255, a * 255);
  }
  const texture = new THREE.DataTexture(data, size, size); texture.needsUpdate = true;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  return texture;
}
const sunWorld = new THREE.Vector3(-170, 150, 125).normalize();
function createSmoke(scene, capacity = 1800) {
  const position = new Float32Array(capacity * 3), size = new Float32Array(capacity), alpha = new Float32Array(capacity), shade = new Float32Array(capacity), fire = new Float32Array(capacity);
  const particles = Array.from({ length: capacity }, () => ({ life: 0, age: 1, vx: 0, vy: 0, vz: 0, grow: 0, base: 0, shade: 0, fire: 0, drag: 0 }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(shade, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aFire', new THREE.BufferAttribute(fire, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uMap: { value: smokeTexture() }, uScale: { value: 600 }, uSunView: { value: new THREE.Vector3(0, 1, 0) } }]),
    vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aShade; attribute float aFire; uniform float uScale;
      varying float vAlpha; varying float vShade; varying float vFire;
      #include <fog_pars_vertex>
      void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = min(512., aSize * uScale / max(1., -mvPosition.z)); vAlpha = aAlpha; vShade = aShade; vFire = aFire;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uSunView; varying float vAlpha; varying float vShade; varying float vFire;
      #include <fog_pars_fragment>
      void main() { vec4 t = texture2D(uMap, gl_PointCoord);
        // 体积感：把粒子当作小球体，向阳面亮、背阳面暗；浓烟底部受火光映红
        vec2 q = gl_PointCoord * 2. - 1.; vec3 n = normalize(vec3(q.x, -q.y, sqrt(max(0., 1. - dot(q, q))) + .25));
        float lit = .58 + .38 * max(dot(n, uSunView), 0.) + .08 * q.y;
        vec3 col = vec3(vShade) * lit * vec3(1., .99, .96) + vec3(.05, .055, .06);
        col = mix(col, vec3(1., .55, .18) * (1.4 - length(q) * .6), vFire);
        gl_FragColor = vec4(col, t.a * vAlpha);
        if (gl_FragColor.a < .01) discard;
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.renderOrder = 2;
  points.onBeforeRender = (renderer, _scene, camera) => {
    const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    material.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad((camera.fov ?? 60) / 2)));
    material.uniforms.uSunView.value.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
  };
  scene.add(points);
  let cursor = 0, lastTime = null;
  const local = new THREE.Vector3(), wind = new THREE.Vector3(1.5, 0, .6);   // 冬季西北风，烟向东南飘
  return {
    // 一次性烟团：炮口硝烟（灰白、缓慢飘散）、落地爆炸的尘土（黄褐）
    puff(at, { count = 8, radius = 1, shade = .7, life = 6, rise = .8, grow = 1.4, dir = null, speed = 0, fire = 0, spread = 1 } = {}) {
      for (let n = 0; n < count; n++) {
        const p = particles[cursor], k = n / Math.max(1, count - 1);
        position.set([at.x + (Math.random() - .5) * radius, at.y + (Math.random() - .5) * radius * .5, at.z + (Math.random() - .5) * radius], cursor * 3);
        const v = speed * (.3 + k * .9);
        Object.assign(p, { age: 0, life: life * (.7 + Math.random() * .6), vx: (dir?.x ?? 0) * v + (Math.random() - .5) * radius * spread,
          vy: rise * (.5 + Math.random()) + (dir?.y ?? 0) * v, vz: (dir?.z ?? 0) * v + (Math.random() - .5) * radius * spread,
          base: radius * (1.2 + Math.random()), grow, shade: shade * (.85 + Math.random() * .3), fire: fire * (1 - k * .7), drag: speed ? 1.6 : 0 });
        cursor = (cursor + 1) % capacity;
      }
    },
    update(time, dt, sources) {
      const step = lastTime === null ? 0 : Math.max(0, Math.min(.1, time - lastTime)); lastTime = time;
      if (step <= 0 && dt <= 0) return;
      for (const source of sources) {
        if (!source.object) continue;
        source.object.updateMatrixWorld();
        for (const point of source.points ?? []) {
          let count = (source.rate ?? 4) * step + Math.random();
          while (count-- >= 1) {
            const p = particles[cursor];
            local.set(point[0] + (Math.random() - .5) * point[3], point[1], point[2] + (Math.random() - .5) * point[3]).applyMatrix4(source.object.matrixWorld);
            position.set([local.x, local.y, local.z], cursor * 3);
            Object.assign(p, { age: 0, life: (source.life ?? 9) * (.7 + Math.random() * .6), vx: (Math.random() - .5) * .8, vy: (source.rise ?? 2.4) * (.7 + Math.random() * .6),
              vz: (Math.random() - .5) * .8, base: (point[3] ?? 1) * 1.6, grow: source.grow ?? 1.6, shade: (source.shade ?? .25) * (.8 + Math.random() * .4),
              fire: source.fire ? .9 * Math.random() : 0, drag: 0 });
            cursor = (cursor + 1) % capacity;
          }
        }
      }
      for (let i = 0; i < capacity; i++) {
        const p = particles[i];
        if (p.age >= p.life) { alpha[i] = 0; continue; }
        p.age += step;
        const k = p.age / p.life;
        if (p.drag) { const d = Math.exp(-p.drag * step); p.vx *= d; p.vz *= d; p.vy = p.vy * d + .4 * (1 - d); }
        position[i * 3] += (p.vx + wind.x * k) * step; position[i * 3 + 1] += p.vy * (1 - k * .6) * step; position[i * 3 + 2] += (p.vz + wind.z * k) * step;
        size[i] = p.base + p.age * p.grow * 1.8; alpha[i] = Math.min(1, p.age * 3) * (1 - k) ** 1.4 * .62; shade[i] = p.shade + k * .25;
        fire[i] = p.fire * Math.max(0, 1 - k * 6);
      }
      geometry.attributes.position.needsUpdate = geometry.attributes.aSize.needsUpdate = geometry.attributes.aAlpha.needsUpdate = geometry.attributes.aShade.needsUpdate = geometry.attributes.aFire.needsUpdate = true;
    },
  };
}
