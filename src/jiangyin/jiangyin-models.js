// 江阴要塞阻击战 · 程序化模型（无外部资源）
// - 舰船：放样船体（艏部前倾、舷弧、艉封板、水线/防污漆分色）+ 上层建筑、可转动炮塔、桅杆、救生艇、栏杆、旗帜
// - 岸防：钢筋混凝土圆形炮台 + 装甲防盾炮塔；滩头钢筋混凝土机枪掩体；炮艇艇首炮
// - 人物：日军/国军步兵；开场：九六式舰爆（双翼机）
// 约定：模型前向为本地 -Z，与 emplacements.js 的 heading/yaw 一致（前向 = (-sin h, -cos h)）。
// 静态零件按材质合并为少量网格（mergeStatic），动态部件（炮塔/炮管/登陆艇跳板）挂在 userData.dynamic 组里。
import * as THREE from 'three';
import { patchSurface, surfaceMap } from './jiangyin-surfaces.js';

const TAU = Math.PI * 2;
// 炮手/装填手：页面层通过 setCrewFactory 注入项目 world.js 的 soldierModel（国军），node 模拟时退化为内置简模
let crewFactory = null;
export function setCrewFactory(factory) { crewFactory = typeof factory === 'function' ? factory : null; }
const crewMember = (rifle = false) => crewFactory ? crewFactory(rifle) : createDefenderModel(rifle);
const materials = new Map();
// 写实表面：按材质键套用项目 PBR 贴图（三平面投影）+ 漆面斑驳、锈水痕、水线污渍与凹凸
const SURFACE_STYLES = {
  paint: { map: 'plaster', detail: .14, tile: 2.2, mottle: .09, streaks: .85, bump: .1, rough: .35 },
  hull: { map: 'plaster', detail: .14, tile: 2.2, mottle: .1, streaks: 1, waterline: .6, bump: .18, rough: .35 },
  rust: { map: 'earth', detail: .6, tile: 1.8, mottle: .18, streaks: .5, bump: .5 },
  deck: { map: 'timber', detail: .85, tile: 1.6, mottle: .12, bump: .35 },
  concrete: { map: 'weathered-plaster', detail: .9, tile: 2.6, mottle: .16, streaks: .55, bump: .6, macro: .4 },
  sandbag: { map: 'burlap', detail: .9, tile: .55, mottle: .12, bump: .9 },
  earth: { map: 'earth', detail: .9, tile: 3, mottle: .15, bump: .7, macro: .4 },
  gun: { map: 'plaster', detail: .1, tile: 1.4, mottle: .12, streaks: .35, bump: .1, rough: .3 },
  steel: { detail: 0, tile: 1.4, mottle: .04, streaks: .12, bump: .03, rough: .15 },   // 涂装钢板：无石材纹理，仅轻微斑驳与雨痕
  roof: { map: 'tiles', detail: .9, tile: 1.3, mottle: .15, bump: .8 },
  plaster: { map: 'weathered-plaster', detail: .9, tile: 2.4, mottle: .14, streaks: .6, bump: .4 },
};
const STYLE_OF = { 'ijn-hull': 'paint', 'ijn-light': 'paint', 'roc-hull': 'paint', 'roc-light': 'paint', 'hull-vc': 'hull',
  daihatsu: 'paint', rust: 'rust', rust2: 'rust', 'ijn-deck': 'deck', 'roc-deck': 'deck', wood: 'deck', 'daihatsu-floor': 'deck',
  stake: 'deck', trunk: 'deck', concrete: 'concrete', 'concrete-dark': 'concrete', sandbag: 'sandbag', earth: 'earth',
  'earth-bank': 'earth', trench: 'earth', 'gun-green': 'gun', 'gun-dark': 'gun', dark: 'gun', 'house-wall': 'plaster', 'house-roof': 'roof',
  masonry: 'concrete', 'turret-grey': 'steel', 'flak-grey': 'steel' };
export function mat(key, color, roughness = .8, metalness = .15, extra = {}) {
  if (!materials.has(key)) {
    const material = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
    const style = SURFACE_STYLES[STYLE_OF[key]];
    if (style) patchSurface(material, { ...style, map: style.map ? surfaceMap(style.map) : null });
    materials.set(key, material);
  }
  return materials.get(key);
}
const M = {
  ijnHull: () => mat('ijn-hull', 0x666c6e, .62, .35), ijnLight: () => mat('ijn-light', 0x7b8183, .6, .3),
  ijnDeck: () => mat('ijn-deck', 0x6a5a48, .92, .02), dark: () => mat('dark', 0x232526, .65, .4),
  black: () => mat('black', 0x151617, .7, .2), canvas: () => mat('canvas', 0xb8ae94, 1, 0),
  wood: () => mat('wood', 0x7a6347, .95, 0), brass: () => mat('brass', 0x9e8655, .45, .7),
  glass: () => mat('glass', 0x1d2a30, .15, .6), rocHull: () => mat('roc-hull', 0x737975, .55, .3),
  rocLight: () => mat('roc-light', 0x858a86, .55, .25), rust: () => mat('rust', 0x5a3d2c, .95, .1),
  rust2: () => mat('rust2', 0x3e3a33, .9, .2), white: () => mat('white', 0xd8d6cc, .8, 0),
  concrete: () => mat('concrete', 0x99958a, .97, 0), concreteDark: () => mat('concrete-dark', 0x7d796f, .97, 0),
  gunGreen: () => mat('gun-green', 0x4d5643, .7, .35), gunDark: () => mat('gun-dark', 0x2b2f29, .6, .45),
  earth: () => mat('earth', 0x6b5e45, 1, 0), sand: () => mat('sandbag', 0x9a8763, 1, 0),
  hullColored: () => mat('hull-vc', 0xffffff, .62, .3, { vertexColors: true }),
};

// ---------- 基础几何助手 ----------
function add(parent, geometry, material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
const box = (p, w, h, d, x, y, z, m) => add(p, new THREE.BoxGeometry(w, h, d), m, x, y, z);
const cyl = (p, rt, rb, h, x, y, z, m, seg = 12) => add(p, new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
function tubeZ(p, r1, r2, length, x, y, z, m, seg = 12) { // 沿 -Z 方向的管（r1 为前端半径）
  const mesh = add(p, new THREE.CylinderGeometry(r1, r2, length, seg), m, x, y, z - length / 2);
  mesh.rotation.x = -Math.PI / 2; return mesh;
}
function rod(p, from, to, r, m, seg = 6) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), d = b.clone().sub(a);
  const mesh = add(p, new THREE.CylinderGeometry(r, r, d.length(), seg), m);
  mesh.position.copy(a).lerp(b, .5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return mesh;
}
const group = (p, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };

// 合并静态零件：同材质合并成一个网格，大幅减少 draw call。跳过 userData.dynamic 子树与 userData.keep 网格。
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(), buckets = new Map(), victims = [];
  root.traverse(object => {
    if (!object.isMesh || object.userData.keep) return;
    for (let p = object; p && p !== root; p = p.parent) if (p.userData.dynamic) return;
    let geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(inverse.clone().multiply(object.matrixWorld));
    const key = object.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { material: object.material, parts: [] });
    buckets.get(key).parts.push(geometry); victims.push(object);
  });
  for (const v of victims) v.removeFromParent();
  for (const { material, parts } of buckets.values()) {
    const color = material.vertexColors, count = parts.reduce((n, g) => n + g.attributes.position.count, 0);
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = color ? new Float32Array(count * 3) : null;
    let o = 0;
    for (const g of parts) {
      if (!g.attributes.normal) g.computeVertexNormals();
      pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o);
      if (col) col.set(g.attributes.color ? g.attributes.color.array : new Float32Array(g.attributes.position.count * 3).fill(1), o);
      o += g.attributes.position.count * 3; g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (col) merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(merged, material); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
  }
  return root;
}

// ---------- 旗帜（浏览器里用 Canvas 画；node 无画布时退化为纯色） ----------
const flagCache = new Map();
function flagMaterial(type) {
  if (flagCache.has(type)) return flagCache.get(type);
  let material;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = 192; c.height = 128;
    const g = c.getContext('2d');
    if (type === 'ijn') { // 旭日旗（海军旗）
      g.fillStyle = '#f2efe6'; g.fillRect(0, 0, 192, 128);
      const cx = 86, cy = 64; g.fillStyle = '#b8282d';
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU, w = TAU / 64;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a - w) * 260, cy + Math.sin(a - w) * 260);
        g.lineTo(cx + Math.cos(a + w) * 260, cy + Math.sin(a + w) * 260); g.fill();
      }
      g.beginPath(); g.arc(cx, cy, 24, 0, TAU); g.fill();
    } else { // 青天白日满地红
      g.fillStyle = '#c0282d'; g.fillRect(0, 0, 192, 128);
      g.fillStyle = '#123c8c'; g.fillRect(0, 0, 96, 64);
      g.fillStyle = '#f5f5f0'; const cx = 48, cy = 32;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU; g.beginPath();
        g.moveTo(cx + Math.cos(a) * 25, cy + Math.sin(a) * 25);
        g.lineTo(cx + Math.cos(a + .26) * 13, cy + Math.sin(a + .26) * 13);
        g.lineTo(cx + Math.cos(a - .26) * 13, cy + Math.sin(a - .26) * 13); g.fill();
      }
      g.fillStyle = '#123c8c'; g.beginPath(); g.arc(cx, cy, 12.5, 0, TAU); g.fill();
      g.fillStyle = '#f5f5f0'; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.fill();
    }
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 1 });
  } else material = new THREE.MeshStandardMaterial({ color: type === 'ijn' ? 0xeeeeee : 0xc0282d, side: THREE.DoubleSide });
  flagCache.set(type, material); return material;
}
function flag(parent, type, x, y, z, width = 2.4) {
  const geometry = new THREE.PlaneGeometry(width, width * 2 / 3, 6, 1);
  const p = geometry.attributes.position; // 轻微飘动的弧度
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / width + .5) * Math.PI * 1.4) * .12 * (p.getX(i) / width + .5));
  geometry.computeVertexNormals();
  const mesh = add(parent, geometry, flagMaterial(type), x, y, z);
  mesh.rotation.y = Math.PI / 2; mesh.position.z += width / 2; mesh.castShadow = false; mesh.userData.keep = true;
  return mesh;
}

// ---------- 放样船体 ----------
// deck(s) 给出 s∈[0,1]（0=艏、1=艉）处的甲板高度；返回船体网格与查询函数（便于在舷侧贴舷窗、放锚等）。
export function loftHull(parent, { length, beam, draft = 1.8, deck, stations = 30, bowFine = .3, sternTaper = .76, transom = .5,
  rake = 1.4, flare = .22, hullColor = 0x666c6e, bootColor = 0x1c1d1e, bottomColor = 0x5e2b24, deckMaterial, breaks = [] }) {
  const hbMax = beam / 2;
  const halfBeam = s => s < bowFine ? hbMax * Math.pow(Math.sin(s / bowFine * Math.PI / 2), .8)
    : s > sternTaper ? hbMax * (1 - (1 - transom) * ((s - sternTaper) / (1 - sternTaper)) ** 2) : hbMax;
  const keel = s => -draft + (s < .12 ? (1 - s / .12) ** 2 * draft * .8 : 0) + (s > .88 ? ((s - .88) / .12) ** 2 * draft * .45 : 0);
  const zAt = (s, u) => -length / 2 + s * length - (s < .14 ? (1 - s / .14) * u * rake : 0);
  const shape = (s, u) => Math.pow(Math.sin(Math.min(1, u * 1.7) * Math.PI / 2), .55) * (1 + (s < .35 ? (1 - s / .35) : 0) * flare * u * u);
  const ss = [];
  for (let i = 0; i <= stations; i++) ss.push(i / stations);
  for (const b of breaks) ss.push(b - .004, b + .004);
  ss.sort((a, b) => a - b);
  const rowsAt = s => { const k = keel(s), d = deck(s); return [k, k * .5, -.03, .03, .55, .6, (d + .6) / 2, d]; };
  const R = 8, colorOf = y => new THREE.Color(y < 0 ? bottomColor : y < .58 ? bootColor : hullColor);
  const positions = [], colors = [], index = [], edge = { s: [], p: [] };
  const vid = (side, i, r) => (side * ss.length + i) * R + r;
  for (const side of [1, -1]) ss.forEach((s, i) => {
    const ys = rowsAt(s), k = ys[0], d = ys[R - 1];
    ys.forEach((y, r) => {
      const u = (y - k) / (d - k), x = halfBeam(s) * shape(s, u) * side;
      positions.push(x, y, zAt(s, u)); const c = colorOf(y); colors.push(c.r, c.g, c.b);
    });
  });
  const S = 0, P = 1;
  for (let i = 0; i < ss.length - 1; i++) for (let r = 0; r < R - 1; r++) {
    const a = vid(S, i, r), b = vid(S, i + 1, r), c = vid(S, i + 1, r + 1), d = vid(S, i, r + 1);
    index.push(a, c, b, a, d, c);
    const e = vid(P, i, r), f = vid(P, i + 1, r), g = vid(P, i + 1, r + 1), h = vid(P, i, r + 1);
    index.push(e, f, g, e, g, h);
  }
  const last = ss.length - 1; // 艉封板
  for (let r = 0; r < R - 1; r++) index.push(vid(S, last, r), vid(S, last, r + 1), vid(P, last, r + 1), vid(S, last, r), vid(P, last, r + 1), vid(P, last, r));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(index); geometry.computeVertexNormals();
  const hull = add(parent, geometry, M.hullColored());
  // 甲板
  const dp = [], di = [];
  ss.forEach((s, i) => {
    const ys = rowsAt(s), d = ys[R - 1], hb = halfBeam(s) * shape(s, 1) * .985, z = zAt(s, 1);
    dp.push(hb, d + .02, z, -hb, d + .02, z);
    if (i) { const a = (i - 1) * 2, b = a + 1, c = i * 2, e = c + 1; di.push(a, b, e, a, e, c); }
  });
  const deckGeometry = new THREE.BufferGeometry();
  deckGeometry.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deckGeometry.setIndex(di); deckGeometry.computeVertexNormals();
  add(parent, deckGeometry, deckMaterial ?? M.ijnDeck());
  return {
    hull, deck: s => deck(s), zOf: s => zAt(s, 1), sOf: z => (z + length / 2) / length,
    halfWidth: (s, y) => { const ys = rowsAt(s); return halfBeam(s) * shape(s, (y - ys[0]) / (ys[R - 1] - ys[0])); },
    rails(points) { // 甲板边缘栏杆（线段）
      ss.forEach((s, i) => { if (i % 2 || s < .03 || s > .985) return;
        const d = deck(s), hb = halfBeam(s) * shape(s, 1), z = zAt(s, 1);
        for (const sign of [1, -1]) points.push(sign * hb, d, z, sign * hb, d + .9, z); });
      for (const sign of [1, -1]) for (let i = 0; i < ss.length - 1; i++) {
        const s0 = ss[i], s1 = ss[i + 1]; if (s0 < .03 || s1 > .985) continue;
        points.push(sign * halfBeam(s0) * shape(s0, 1), deck(s0) + .9, zAt(s0, 1), sign * halfBeam(s1) * shape(s1, 1), deck(s1) + .9, zAt(s1, 1));
      }
    },
  };
}
function railLines(parent, points, color = 0x2a2c2d) {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 }));
  parent.add(lines); return lines;
}
function portholes(parent, hull, s0, s1, count, y, material = M.black()) {
  for (let i = 0; i < count; i++) {
    const s = s0 + (s1 - s0) * (i + .5) / count, z = hull.zOf(s), x = hull.halfWidth(s, y) + .02;
    for (const sign of [1, -1]) { const disc = add(parent, new THREE.CircleGeometry(.13, 8), material, sign * x, y, z); disc.rotation.y = sign * Math.PI / 2; disc.castShadow = false; }
  }
}

// ---------- 舰船零件 ----------
function navalGun(parent, x, y, z, { size = 1, base = 0, shield = 'open', barrel = 3.4, twin = false, material = M.ijnHull() } = {}) {
  const turret = group(parent, x, y, z); turret.rotation.y = base;
  turret.userData = { dynamic: true, base, arc: 2.5 };
  if (shield === 'turret') { // 双联炮塔（宁海/平海）
    box(turret, 2.6 * size, 1.3 * size, 3 * size, 0, .65 * size, .2 * size, material);
    box(turret, 2.3 * size, .12, 2.6 * size, 0, 1.36 * size, .2 * size, material);
    box(turret, .5, .4, .7, -.8 * size, 1.4 * size, .6 * size, material);
  } else {
    cyl(turret, .45 * size, .6 * size, .9 * size, 0, .45 * size, 0, M.dark());
    if (shield) { // 前弧形防盾 + 顶板
      const g = new THREE.CylinderGeometry(1.15 * size, 1.15 * size, 1.5 * size, 14, 1, true, Math.PI - 1.15, 2.3);
      const s = add(turret, g, material, 0, .95 * size, .25 * size); s.material = material;
      box(turret, 1.9 * size, .08, 1.0 * size, 0, 1.72 * size, -.35 * size, material);
      const mat2 = M.dark(); box(turret, .3 * size, .26 * size, .1, -.45 * size, 1.25 * size, -.86 * size, mat2);
    }
  }
  const elev = group(turret, 0, (shield === 'turret' ? .7 : 1) * size, (shield === 'turret' ? -1 : -.2) * size);
  elev.userData.dynamic = true;
  for (const off of twin ? [-.45 * size, .45 * size] : [0]) {
    tubeZ(elev, .07 * size, .12 * size, barrel * size, off, 0, 0, M.dark(), 10);
    cyl(elev, .1 * size, .1 * size, .12 * size, off, 0, -barrel * size, M.dark()).rotation.x = Math.PI / 2;
  }
  if (shield !== 'turret') box(elev, .45 * size, .4 * size, 1.1 * size, 0, 0, .4 * size, material);
  turret.userData.elevation = elev; turret.userData.muzzle = barrel * size;
  return turret;
}
function funnel(parent, x, y, z, { r = .9, h = 5, rake = .12, oval = .75, color = M.ijnHull(), cap = M.black(), bands = [] } = {}) {
  (parent.userData.funnels ??= []).push([x, y + Math.cos(rake) * h + .3, z + Math.sin(rake) * h, r]);   // 供烟囱冒烟
  const g = group(parent, x, y, z); g.rotation.x = rake;
  const body = cyl(g, r, r * 1.05, h, 0, h / 2, 0, color, 16); body.scale.z = 1 / oval;
  const top = cyl(g, r * 1.02, r * 1.02, .7, 0, h - .35, 0, cap, 16); top.scale.z = 1 / oval;
  for (const [yy, m] of bands) { const b = cyl(g, r * 1.03, r * 1.03, .22, 0, yy, 0, m, 16); b.scale.z = 1 / oval; }
  const hole = add(g, new THREE.CircleGeometry(r * .92, 16), M.black(), 0, h + .01, 0); hole.rotation.x = -Math.PI / 2; hole.scale.y = 1 / oval;
  rod(g, [r * .7, 0, r * .2], [r * .7, h + .5, r * .2], .07, M.dark());
  return g;
}
function pole(parent, x, y, z, h, { yard = 4, top = 3, tripod = false, rake = .05, material = M.dark() } = {}) {
  const g = group(parent, x, y, z); g.rotation.x = rake;
  rod(g, [0, 0, 0], [0, h, 0], .14, material);
  rod(g, [0, h, 0], [0, h + top, 0], .06, material);
  rod(g, [-yard / 2, h * .82, 0], [yard / 2, h * .82, 0], .05, material);
  if (tripod) for (const sign of [1, -1]) rod(g, [sign * 1.4, 0, 1.6], [0, h * .62, 0], .1, material);
  return g;
}
function vent(parent, x, y, z, facing = 0, s = 1) {
  const g = group(parent, x, y, z); g.rotation.y = facing;
  cyl(g, .18 * s, .2 * s, 1.1 * s, 0, .55 * s, 0, M.ijnLight());
  const head = add(g, new THREE.SphereGeometry(.3 * s, 10, 8), M.ijnLight(), 0, 1.15 * s, -.08 * s);
  head.scale.set(1, .9, 1.1);
  add(g, new THREE.CircleGeometry(.2 * s, 10), M.black(), 0, 1.18 * s, -.42 * s).rotation.y = Math.PI;
}
function lifeboat(parent, x, y, z, length = 4, side = 1) {
  const boat = add(parent, new THREE.SphereGeometry(1, 14, 8, 0, TAU, Math.PI / 2, Math.PI / 2), M.white(), x, y, z);
  boat.scale.set(.7, .6, length / 2); boat.rotation.z = Math.PI;
  box(parent, 1.2, .08, length * .9, x, y + .02, z, M.wood());
  for (const dz of [-length * .38, length * .38]) {
    rod(parent, [x - side * .9, y - 1.6, z + dz], [x - side * .5, y + 1.2, z + dz], .05, M.dark());
    rod(parent, [x - side * .5, y + 1.2, z + dz], [x, y + 1.1, z + dz], .05, M.dark());
  }
}
function searchlight(parent, x, y, z) {
  cyl(parent, .1, .14, .5, x, y + .25, z, M.dark());
  const lamp = tubeZ(parent, .32, .3, .6, x, y + .7, z + .3, M.dark()); lamp.rotation.x = -Math.PI / 2;
  add(parent, new THREE.CircleGeometry(.28, 12), M.glass(), x, y + .7, z - .31).rotation.y = Math.PI;
}
function wheelhouse(parent, w, h, d, x, y, z, material) {
  box(parent, w, h, d, x, y + h / 2, z, material);
  box(parent, w * 1.02, .22, d * .9, x, y + h * .72, z - d * .05, M.glass()); // 窗带
  box(parent, w + .4, .1, d + .4, x, y + h + .05, z, material); // 顶板
}
function crest(parent, z, y, x = 0) { // 菊纹（舰艏）
  const disc = add(parent, new THREE.CircleGeometry(.28, 16), M.brass(), x, y, z); disc.rotation.y = 0; disc.castShadow = false;
}
function addWake(root, length, beam, scale = 1) {
  const material = new THREE.MeshBasicMaterial({ color: 0xe8ece6, transparent: true, opacity: .55, depthWrite: false });
  const bow = add(root, new THREE.RingGeometry(beam * .5, beam * .9 * scale, 12, 1, Math.PI * 1.15, Math.PI * .7), material, 0, .06, -length * .46);
  bow.rotation.x = -Math.PI / 2; bow.scale.y = 2.2; bow.castShadow = bow.receiveShadow = false;
  const wake = add(root, new THREE.PlaneGeometry(beam * 1.1, length * .9 * scale), material, 0, .05, length * .5 + length * .45 * scale);
  wake.rotation.x = -Math.PI / 2; wake.castShadow = wake.receiveShadow = false;
  bow.userData.keep = wake.userData.keep = true;
  root.userData.wake = [bow, wake];
}
function torpedoMount(parent, x, y, z, tubes = 3) {
  const g = group(parent, x, y, z); g.userData.dynamic = true;
  cyl(g, .5, .6, .4, 0, .2, 0, M.dark());
  for (let i = 0; i < tubes; i++) tubeZ(g, .2, .22, 6, (i - (tubes - 1) / 2) * .45, .65, 3, M.ijnLight(), 10);
  box(g, 1.6, .7, 1, 0, .7, 2.6, M.ijnHull());
  g.rotation.y = Math.PI / 2 * .9; return g;
}

// ---------- 日军炮舰（长江内河炮舰，参照“势多/安宅”级外形简化） ----------
// ---------- 日军驱逐舰（参照“神风/睦月”级：凸起艏楼、前倾双烟囱、四门单装炮、三联鱼雷管） ----------
export function createWarshipModel(kind = 'gunboat') {
  if (kind === 'cruiser') return createArmoredCruiserModel();
  const destroyer = kind === 'destroyer', root = new THREE.Group(), rails = [];
  const L = destroyer ? 111 : 69, B = destroyer ? 9.9 : 9.7;   // 真实主尺度（白露型 111×9.9 米；安宅 水线长 71.7、宽 9.75 米）
  const W = B / (destroyer ? 6.4 : 5.2), FR = Math.min(W, 1.45), HD = destroyer ? 1.35 : 1.15; // 上层建筑横向按舰宽放大；干舷按实舰略增
  const hull = loftHull(root, destroyer
    ? { length: L, beam: B, draft: 2, rake: 2.2, bowFine: .28, transom: .45, breaks: [.27],
        deck: s => HD * (s < .27 ? 3.3 + (1 - s / .27) ** 2 * 1.1 : 2.3 + (s > .9 ? (s - .9) * 2 : 0)) }
    : { length: L, beam: B, draft: 1.3, rake: .25, bowFine: .3, transom: .6, breaks: [.3], flare: .1,
        deck: s => HD * (s < .3 ? 2.7 + (1 - s / .3) ** 2 * .7 : 2.05 + (s > .85 ? (s - .85) * 1.5 : 0)) });
  hull.rails(rails);
  const turrets = [], hullM = M.ijnHull();
  crest(root, -L / 2 - (destroyer ? 2 : 1.05), destroyer ? 3.6 : 2.8);
  box(root, .25, .25, .9, B * .32, (destroyer ? 3.8 : 3), -L * .42, M.dark()); box(root, .25, .25, .9, -B * .32, (destroyer ? 3.8 : 3), -L * .42, M.dark()); // 锚
  if (destroyer) { // 白露型（改白露型：山风/江风/海风/凉风）：前一座双联炮塔，后部一座单装（高位）+一座双联；两组四联装鱼雷管；前粗后细两烟囱
    const fc = hull.deck(.1);
    turrets.push(navalGun(root, 0, fc, -L * .35, { shield: 'turret', twin: true, size: .85, barrel: 3.6, material: hullM }));
    // 塔式舰桥：下层舱室 + 驾驶室 + 罗经平台 + 测距仪
    box(root, (3.8) * W, 2.4, 4.2, 0, hull.deck(.29) + 1.2, -L * .21, hullM);
    wheelhouse(root, (3.2) * W, 1.9, 3.0, 0, hull.deck(.29) + 2.4, -L * .21 + .2, hullM);
    box(root, (4.4) * W, .12, 3.2, 0, hull.deck(.29) + 4.4, -L * .21 + .2, hullM);
    box(root, (4.2) * W, .7, .08, 0, hull.deck(.29) + 4.8, -L * .21 - 1.3, M.canvas());
    tubeZ(root, .14, .14, 2.6, 0, hull.deck(.29) + 5.1, -L * .21 + 1.2, M.dark()).rotation.z = Math.PI / 2;
    pole(root, 0, hull.deck(.29) + 4.4, -L * .21 + 1.4, 8.5, { yard: 5 * W, tripod: true });
    funnel(root, 0, hull.deck(.36), -L * .08, { r: 1.25 * FR, h: 5.6, rake: .14, oval: .62 });
    funnel(root, 0, hull.deck(.5), L * .04, { r: .85 * FR, h: 5, rake: .14 });
    for (const [vx, vz] of [[1.6, -.14], [-1.6, -.14], [1.4, .0], [-1.4, .0]]) vent(root, (vx) * W, hull.deck(.4), L * vz, vx > 0 ? -Math.PI / 2 : Math.PI / 2);
    torpedoMount(root, 0, hull.deck(.45), -L * .02, 4); torpedoMount(root, 0, hull.deck(.62), L * .14, 4);
    box(root, (1.6) * W, 2.4, 1.6, 0, hull.deck(.55) + 1.2, L * .08, hullM); searchlight(root, 0, hull.deck(.55) + 2.4, L * .08);
    for (const sign of [1, -1]) { box(root, (1) * W, .9, 1, (sign * 1.4) * W, hull.deck(.3) + 2.85, -L * .19, hullM);
      for (const dx of [-.15, .15]) tubeZ(root, .04, .05, 1.4, (sign * 1.4 + dx) * W, hull.deck(.3) + 3.4, -L * .19 + .4, M.dark(), 6); } // 13毫米连装机枪
    box(root, (2.2) * W, 1.6, 2.4, 0, hull.deck(.76) + .8, L * .27, hullM);
    turrets.push(navalGun(root, 0, hull.deck(.76) + 1.6, L * .27, { shield: 'turret', size: .75, base: Math.PI, barrel: 3.4, material: hullM }));
    turrets.push(navalGun(root, 0, hull.deck(.9), L * .4, { shield: 'turret', twin: true, size: .85, base: Math.PI, barrel: 3.6, material: hullM }));
    pole(root, 0, hull.deck(.7), L * .2, 6, { yard: 3 * W });
    for (const sign of [1, -1]) for (let i = 0; i < 3; i++) cyl(root, .3, .3, .6, (sign * 2.2) * W, hull.deck(.96) + .3, L * (.46 - i * .02), M.dark(), 8); // 深水炸弹
    lifeboat(root, (2.7) * W, hull.deck(.42) + 1.8, -L * .05, 4.2, 1); lifeboat(root, (-2.7) * W, hull.deck(.42) + 1.8, -L * .05, 4.2, -1);
    flag(root, 'ijn', 0, hull.deck(.98) + 3.2, L * .49, 2.6); rod(root, [0, hull.deck(.98), L * .49], [0, hull.deck(.98) + 4.2, L * .49], .05, M.dark());
    portholes(root, hull, .05, .26, 9, 2.4);
  } else {
    const fc = hull.deck(.12);
    turrets.push(navalGun(root, 0, fc, -L * .36, { size: .85, barrel: 3 }));
    box(root, (3.6) * W, 1.8, 6.5, 0, hull.deck(.35) + .9, -L * .12, hullM);           // 前部舱室
    wheelhouse(root, (3) * W, 1.6, 2.8, 0, hull.deck(.35) + 1.8, -L * .15, hullM);     // 驾驶室
    box(root, (5.4) * W, .1, 3.4, 0, hull.deck(.35) + 3.45, -L * .15, hullM);          // 罗经平台（两翼）
    box(root, (5.2) * W, .7, .07, 0, hull.deck(.35) + 3.8, -L * .15 - 1.7, M.canvas());
    searchlight(root, (1.8) * W, hull.deck(.35) + 3.5, -L * .15 + .8);
    pole(root, 0, hull.deck(.35) + 3.5, -L * .15 + 1, 11, { yard: 4.2 * W, rake: 0 });          // 安宅：高大的直立桅（通信需要）
    funnel(root, 0, hull.deck(.5), -L * .02, { r: .9 * FR, h: 6.4, rake: 0, bands: [[5.2, M.white()]] }); // 单根直立烟囱
    turrets.push(navalGun(root, 0, hull.deck(.62) + 1.7, L * .06, { size: .6, barrel: 2.2 }));   // 烟囱后 8厘米高角炮
    for (const [vx, vz] of [[1.4, .05], [-1.4, .05]]) vent(root, (vx) * W, hull.deck(.52), L * vz, vx > 0 ? -Math.PI / 2 : Math.PI / 2, .9);
    box(root, (3.4) * W, 1.7, 7, 0, hull.deck(.62) + .85, L * .13, hullM);             // 后部舱室
    for (const sign of [1, -1]) { cyl(root, .05, .05, .9, (sign * 1.2) * W, hull.deck(.62) + 2.2, L * .1, M.dark(), 6);
      tubeZ(root, .04, .05, 1.3, (sign * 1.2) * W, hull.deck(.62) + 2.6, L * .1 + .4, M.dark(), 6); }       // 高射机枪
    lifeboat(root, (2.4) * W, hull.deck(.6) + 1.6, L * .12, 3.6, 1); lifeboat(root, (-2.4) * W, hull.deck(.6) + 1.6, L * .12, 3.6, -1);
    turrets.push(navalGun(root, 0, hull.deck(.86), L * .36, { size: .85, base: Math.PI, barrel: 3 }));
    pole(root, 0, hull.deck(.7), L * .24, 7.5, { yard: 2.6 * W, tripod: true, rake: 0 });          // 1937 年改装后的三脚主桅
    rod(root, [0, hull.deck(.7) + 5, L * .24], [0, hull.deck(.7) + 4, L * .24 + 2.8], .05, M.dark()); // 斜桁
    flag(root, 'ijn', 0, hull.deck(.7) + 3.6, L * .24 + 2.2, 2.2);
    flag(root, 'ijn', 0, hull.deck(.99) + 2.5, L * .49, 1.6); rod(root, [0, hull.deck(.99), L * .49], [0, hull.deck(.99) + 3.3, L * .49], .05, M.dark());
    portholes(root, hull, .06, .29, 7, 2.1); portholes(root, hull, .32, .9, 14, 1.4);
  }
  railLines(root, rails);
  addWake(root, L, B);
  mergeStatic(root);
  root.userData = { ...root.userData, kind, turrets, length: L, beam: B };
  return root;
}

// ---------- 日军大发登陆艇（“大発動艇”：艏跳板、双龙骨、艉部操舵位） ----------
export function createLandingCraftModel() {
  const root = new THREE.Group(), steel = mat('daihatsu', 0x5f5e52, .85, .3), khaki = mat('ija-khaki', 0x857a52, .95, 0);
  const hull = loftHull(root, { length: 14.9, beam: 3.35, draft: .7, bowFine: .08, sternTaper: .8, transom: .8, rake: 0, flare: 0,
    hullColor: 0x5f5e52, bootColor: 0x2a2a26, deck: s => 1.3 + (s < .1 ? .1 : 0), deckMaterial: mat('daihatsu-floor', 0x3e3c34, 1, 0) });
  box(root, 3.25, .16, 12.8, 0, 1.36, .6, steel); // 舷墙顶
  for (const sign of [1, -1]) box(root, .12, .9, 12.6, sign * 1.6, 1.75, .6, steel);
  box(root, 1.6, 1.3, 1.3, 0, 2.0, 6.5, steel); box(root, 1.5, .25, .05, 0, 2.4, 5.84, M.glass()); // 艉部装甲操舵室
  const ramp = group(root, 0, .6, -6.85); ramp.userData.dynamic = true;
  box(ramp, 3.2, 1.9, .14, 0, .95, 0, steel);
  for (let i = 0; i < 5; i++) box(ramp, 3, .06, .1, 0, .3 + i * .35, -.1, steel);
  const passengers = group(root, 0, 1.3, .4); passengers.userData.dynamic = true; // 艇内士兵（只露钢盔和肩）
  for (let i = 0; i < 14; i++) {
    const x = (i % 2 ? .6 : -.6), z = -4.8 + Math.floor(i / 2) * 1.45;
    box(passengers, .45, .5, .3, x, .35, z, khaki);
    add(passengers, new THREE.SphereGeometry(.17, 8, 6, 0, TAU, 0, Math.PI / 2), mat('ija-helmet', 0x55573f, .7, .2), x, .72, z);
    rod(passengers, [x + .2, .4, z], [x + .25, 1.3, z - .1], .025, M.wood());
  }
  flag(root, 'ijn', 0, 3.4, 7, 1); rod(root, [0, 2.6, 7], [0, 4.2, 7], .04, M.dark());
  addWake(root, 14.9, 3.35, .8);
  mergeStatic(root);
  root.userData.ramp = ramp; root.userData.unload = () => { passengers.visible = false; };
  return root;
}

// ---------- 我方残存炮艇（小型内河炮艇；艇首炮由 createDeckGunModel 单独生成） ----------
export function createFriendlyGunboatModel() {
  const root = new THREE.Group(), rails = [], hullM = M.rocHull();
  const L = 46, B = 7.2, W = B / 4.6, FR = 1.4, HD = 1.15;   // 小型江防炮艇（约 46×7 米）
  const hull = loftHull(root, { length: L, beam: B, draft: 1.2, rake: .9, transom: .6, hullColor: 0x8b918d,
    deck: s => HD * (2.4 + (s < .25 ? (1 - s / .25) ** 2 * .5 : 0)), deckMaterial: mat('roc-deck', 0x6f6352, .95, 0) });
  hull.rails(rails);
  const Z = L / 26;   // 原 26 米艇型的纵向布置按比例展开
  box(root, (3.2) * W, 1.9, 6 * Z, 0, hull.deck(.5) + .95, 1.2 * Z, hullM);
  wheelhouse(root, (2.6) * W, 1.6, 2.4 * 1.4, 0, hull.deck(.5) + 1.9, -.6 * Z - 1.2, hullM);
  box(root, (4.2) * W, .08, 2.6 * 1.4, 0, hull.deck(.5) + 3.6, -.6 * Z - 1.2, hullM);
  funnel(root, 0, hull.deck(.6), 3.2 * Z, { r: .65 * FR, h: 4.2, rake: .08, color: M.rocLight(), bands: [[3.2, mat('roc-band', 0x223e7a, .8, 0)]] });
  pole(root, 0, hull.deck(.5) + 3.6, -.2 * Z - 1, 6.5, { yard: 3 * W });
  vent(root, (1.2) * W, hull.deck(.6), 5 * Z, -Math.PI / 2, .8); vent(root, (-1.2) * W, hull.deck(.6), 5 * Z, Math.PI / 2, .8);
  for (const sign of [1, -1]) { box(root, (.5) * W, .5, 1.6, (sign * 1.5) * W, hull.deck(.8) + .25, 7.5 * Z, mat('sandbag', 0x9a8763, 1, 0)); }
  flag(root, 'roc', 0, hull.deck(.99) + 2.4, L / 2, 1.8); rod(root, [0, hull.deck(.99), L / 2], [0, hull.deck(.99) + 3.2, L / 2], .05, M.dark());
  portholes(root, hull, .1, .9, 20, 1.6);
  railLines(root, rails);
  mergeStatic(root);
  return root;
}

// ---------- 我军轻巡洋舰（参照“平海/宁海”照片：塔式舰桥+火控顶、单根粗烟囱、三脚后桅、双联炮塔 2 前 1 后） ----------
// length/beam 默认宁海级（全长 109.7、宽 11.9 米）；逸仙传 82/10.4。omitBowTurret：艏炮塔由玩家可操作的 createShipTurretModel 代替
export function createCruiserModel(name, { length = 109, beam = 11.9, omitBowTurret = false } = {}) {
  const root = new THREE.Group(), rails = [], hullM = M.rocHull(), light = M.rocLight();
  const L = length, B = beam, W = B / 6.6, FR = 1.5 * B / 11.9, HD = 1.25;
  const hull = loftHull(root, { length: L, beam: B, draft: 2.4, rake: 2.6, transom: .45, hullColor: 0x8b918d, breaks: [.56],
    deck: s => HD * (s < .56 ? 4 + (1 - Math.min(1, s / .3)) ** 2 * 1.1 : 3.1), deckMaterial: mat('roc-deck', 0x6f6352, .95, 0) });
  hull.rails(rails);
  crest(root, -L / 2 - 2.4, 4.6);
  if (!omitBowTurret) navalGun(root, 0, hull.deck(.16), -L * .32, { shield: 'turret', twin: true, size: 1, barrel: 4.4, material: hullM });
  root.userData.bow = { z: -L * .32, deck: hull.deck(.16) };
  box(root, (3.2) * W, 1.2, 3.4, 0, hull.deck(.25) + .6, -L * .22, hullM);
  navalGun(root, 0, hull.deck(.25) + 1.2, -L * .22, { shield: 'turret', twin: true, size: 1, barrel: 4.4, material: hullM });
  // 塔式舰桥：多层圆角塔身 + 驾驶室窗带 + 顶部火控指挥仪
  const by = hull.deck(.33), bz = -L * .13;
  box(root, (4.4) * W, 2.4, 5, 0, by + 1.2, bz + .6, hullM);
  cyl(root, 1.7, 2.1, 3.2, 0, by + 3.9, bz, hullM, 18);
  wheelhouse(root, (4.2) * W, 1.6, 3.4, 0, by + 5.5, bz, light);
  box(root, (5.4) * W, .12, 3.8, 0, by + 7.15, bz, hullM);
  cyl(root, .9, 1.2, 2.2, 0, by + 8.3, bz + .2, hullM, 14);
  box(root, (2.4) * W, 1.4, 2.2, 0, by + 10, bz + .2, light); box(root, (2.2) * W, .18, .06, 0, by + 10.2, bz - .92, M.black());
  tubeZ(root, .12, .12, 3.4, 0, by + 9.4, bz + .3, M.dark()).rotation.z = Math.PI / 2;
  pole(root, 0, by + 10.7, bz + .6, 5, { yard: 3.6 * W, top: 2 });
  // 单根粗烟囱（前倾，顶部黑色）
  funnel(root, 0, hull.deck(.45), -L * .01, { r: 1.5 * FR, h: 6.4, rake: .1, oval: .65, color: light });
  lifeboat(root, (3) * W, hull.deck(.48) + 2.1, L * .06, 5, 1); lifeboat(root, (-3) * W, hull.deck(.48) + 2.1, L * .06, 5, -1);
  box(root, (4.2) * W, 3, 5, 0, hull.deck(.58) + 1.5, L * .12, hullM);                // 后部上层建筑（机库/探照灯台）
  searchlight(root, (1.4) * W, hull.deck(.58) + 3, L * .11); searchlight(root, (-1.4) * W, hull.deck(.58) + 3, L * .11);
  pole(root, 0, hull.deck(.58) + 3, L * .14, 9, { tripod: true, yard: 4.4 * W, top: 3 });
  navalGun(root, 0, hull.deck(.82), L * .3, { shield: 'turret', twin: true, size: 1, base: Math.PI, barrel: 4.4, material: hullM });
  for (const sign of [1, -1]) navalGun(root, (sign * 2.4) * W, hull.deck(.62), L * .2, { size: .6, barrel: 2.4, material: hullM }).rotation.y = sign * 1.3;
  flag(root, 'roc', 0, hull.deck(.98) + 3.4, L * .49, 2.6); rod(root, [0, hull.deck(.98), L * .49], [0, hull.deck(.98) + 4.4, L * .49], .06, M.dark());
  portholes(root, hull, .06, .55, 18, 3.3); portholes(root, hull, .1, .9, 26, 1.9);
  railLines(root, rails);
  mergeStatic(root);
  root.name = name;
  root.userData.length = L; root.userData.beam = B;
  return root;
}

// ---------- 日军装甲巡洋舰“出云”（出云型：冲角艏、三根等距烟囱、两侧通风筒、首尾椭圆形双联炮塔、舷侧 15 厘米炮廓；参照照片：冲角式直艏、三根细高烟囱、两根带战斗桅盘的高桅、首尾双联炮塔、舷侧炮廓） ----------
function createArmoredCruiserModel() {
  const root = new THREE.Group(), rails = [], hullM = M.ijnLight();
  const L = 122, B = 20.9;   // 出云型：全长 123、宽 20.9 米
  const W = B / 7.4 * .8, FR = 1.6, HD = 1.3;
  const hull = loftHull(root, { length: L, beam: B, draft: 2.8, rake: -1.6, bowFine: .2, transom: .55, flare: .05, hullColor: 0x7b8183,
    deck: s => HD * (4.4 + (s < .15 ? (1 - s / .15) * .5 : 0) - (s > .7 ? (s - .7) * 2.2 : 0)) });
  hull.rails(rails);
  crest(root, -L / 2 + .3, 3.9);
  for (const sign of [1, -1]) { // 锚链孔
    const hawse = add(root, new THREE.CircleGeometry(.35, 12), M.black(), sign * (hull.halfWidth(.05, 3.6 * HD) + .03), 3.6 * HD, hull.zOf(.05));
    hawse.rotation.y = sign * Math.PI / 2; hawse.castShadow = false;
  }
  const turrets = [];
  const fore = navalGun(root, 0, hull.deck(.17), -L * .32, { shield: 'turret', twin: true, size: 1.25, barrel: 5, material: hullM });
  turrets.push(fore);
  box(root, (6) * W, 2.2, 6, 0, hull.deck(.27) + 1.1, -L * .2, hullM);
  wheelhouse(root, (5) * W, 1.8, 3.2, 0, hull.deck(.27) + 2.2, -L * .21, hullM);
  box(root, (6.6) * W, .12, 4, 0, hull.deck(.27) + 4.1, -L * .21, hullM);
  // 前桅：粗下桅 + 战斗桅盘 + 两道横桁 + 顶桅
  const fy = hull.deck(.27) + 4.1, fz = -L * .17;
  cyl(root, .45, .55, 8, 0, fy + 4, fz, hullM, 12);
  cyl(root, 1.4, 1.2, 1.4, 0, fy + 8.4, fz, hullM, 14);
  pole(root, 0, fy + 9, fz, 9, { yard: 8 * W, top: 4, rake: .03 });
  rod(root, [(-3.5) * W, fy + 6, fz], [(3.5) * W, fy + 6, fz], .07, M.dark());
  for (const z of [-.08, .02, .12]) funnel(root, 0, hull.deck(.45), L * z, { r: 1 * FR, h: 9, rake: .04, oval: .9, color: hullM, cap: M.black() });
  for (const sign of [1, -1]) { // 舷侧炮廓（每舷 4 门）
    for (let i = 0; i < 4; i++) {
      const sx = .3 + i * .13, z = hull.zOf(sx), x = hull.halfWidth(sx, 3 * HD) * sign;
      const port = box(root, .2, .9, 1.4, x, 3 * HD, z, M.black()); port.castShadow = false;
      const g = tubeZ(root, .08, .1, 2.2, x + sign * .5, 3 * HD, z + 1.1, M.dark()); g.rotation.z = 0;
    }
    lifeboat(root, (sign * 3.5) * W, hull.deck(.5) + 2.3, L * .06, 5.4, sign);
    lifeboat(root, (sign * 3.5) * W, hull.deck(.6) + 2.3, L * .16, 4.6, sign);
  }
  for (const [vx, vz] of [[2.2, -.03], [-2.2, -.03], [2, .17], [-2, .17]]) vent(root, (vx) * W, hull.deck(.48), L * vz, vx > 0 ? -Math.PI / 2 : Math.PI / 2, 1.3);
  box(root, (4.6) * W, 2, 6, 0, hull.deck(.68) + 1, L * .23, hullM);
  const my = hull.deck(.68) + 2, mz = L * .24;
  cyl(root, .4, .5, 7, 0, my + 3.5, mz, hullM, 12); cyl(root, 1.1, 1, 1.1, 0, my + 7.4, mz, hullM, 12);
  pole(root, 0, my + 8, mz, 8, { yard: 6.5 * W, top: 3.5 });
  rod(root, [0, my + 11, mz], [0, my + 9, mz + 4], .06, M.dark());
  flag(root, 'ijn', 0, my + 8.6, mz + 3.4, 2.8);
  turrets.push(navalGun(root, 0, hull.deck(.84), L * .33, { shield: 'turret', twin: true, size: 1.25, base: Math.PI, barrel: 5, material: hullM }));
  portholes(root, hull, .05, .95, 30, 2.1);
  railLines(root, rails);
  addWake(root, L, B, 1.1);
  mergeStatic(root);
  root.userData = { ...root.userData, kind: 'cruiser', turrets, length: L, beam: B };
  return root;
}

// ---------- 江心沉船（堵塞线用的商船/旧舰） ----------
export function createWreckModel(seed = 1, { length = null, beam = null } = {}) {
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const root = new THREE.Group(), L = length ?? 30 + r() * 16, B = beam ?? 6.4 + r() * 2.4;   // 堵塞线商船/旧舰（约 30–46 米）
  loftHull(root, { length: L, beam: B, draft: 2.2, rake: .6 + r(), transom: .7, hullColor: 0x4c3a2e, bootColor: 0x2a2420, bottomColor: 0x3a2a22,
    deck: s2 => 3 + (s2 < .2 ? .5 : 0), deckMaterial: M.rust2() });
  box(root, B * .6, 2.2, L * .22, 0, 4.1, L * .05, M.rust());
  box(root, B * .4, .9, L * .12, 0, 5.6, L * .03, M.rust2());
  if (r() > .3) funnel(root, 0, 4.8, -L * .05, { r: .7, h: 3.8, rake: .1, color: M.rust2(), cap: M.black() });
  pole(root, 0, 3, -L * .3, 7 + r() * 4, { yard: 2.4, rake: (r() - .5) * .5, material: M.rust2() });
  if (r() > .5) pole(root, 0, 3, L * .3, 6, { yard: 2, rake: (r() - .5) * .6, material: M.rust2() });
  mergeStatic(root);
  return root;
}

// ---------- 人物 ----------
function soldier({ uniform, helmet, skin = 0xb48a64, leg = uniform, japanese = true, rifle = true }) {
  const root = new THREE.Group(), legs = [];
  const u = mat(`uniform-${uniform}`, uniform, .95, 0), h = mat(`helmet-${helmet}`, helmet, .6, .25), sk = mat('skin', skin, .9, 0);
  const lg = mat(`leg-${leg}`, leg, .95, 0);
  for (const sign of [1, -1]) {
    const g = group(root, sign * .12, .9, 0); g.userData.dynamic = true;
    box(g, .17, .5, .19, 0, -.25, 0, u); box(g, .15, .42, .17, 0, -.68, .01, lg); box(g, .17, .1, .28, 0, -.88, -.04, M.black());
    legs.push(g);
  }
  box(root, .44, .58, .26, 0, 1.2, 0, u); box(root, .46, .1, .28, 0, .94, 0, M.wood());
  box(root, .32, .36, .16, 0, 1.25, .2, mat('pack', japanese ? 0x6f6a4c : 0x5c5a4a, 1, 0));
  for (const sign of [1, -1]) rod(root, [sign * .27, 1.45, 0], [sign * .2, 1.0, -.22], .065, u);
  add(root, new THREE.SphereGeometry(.12, 10, 8), sk, 0, 1.63, 0);
  if (japanese) { add(root, new THREE.SphereGeometry(.15, 10, 6, 0, TAU, 0, Math.PI / 2), h, 0, 1.67, 0); cyl(root, .165, .165, .02, 0, 1.67, 0, h); }
  else { // 国军 M35 式钢盔（帽檐外撇）
    add(root, new THREE.SphereGeometry(.15, 10, 6, 0, TAU, 0, Math.PI / 2), h, 0, 1.68, 0);
    add(root, new THREE.CylinderGeometry(.155, .19, .09, 12, 1, true), h, 0, 1.64, 0);
  }
  if (rifle) { rod(root, [.12, 1.05, -.3], [.06, 1.25, -1.15], .028, M.wood()); rod(root, [.06, 1.25, -1.15], [.04, 1.29, -1.45], .01, M.dark()); }
  mergeStatic(root);
  root.userData.stride = t => { legs[0].rotation.x = Math.sin(t * 9) * .55; legs[1].rotation.x = -Math.sin(t * 9) * .55; };
  return root;
}
export const createInfantryModel = () => soldier({ uniform: 0x857a52, helmet: 0x55573f, leg: 0x9a8f68, japanese: true });
export const createDefenderModel = (rifle = false) => soldier({ uniform: 0x5f6458, helmet: 0x4d544b, leg: 0x55594d, japanese: false, rifle });

// ---------- 开场：日军舰载双翼轰炸机（九四/九六式舰爆简化） ----------
export function createAircraftModel() {
  const root = new THREE.Group(), skin = mat('ija-plane', 0xa8ab9a, .55, .35), dark = M.dark();
  const red = mat('hinomaru', 0xb8282d, .7, 0);
  const body = add(root, new THREE.CylinderGeometry(.62, .25, 8.4, 12), skin, 0, 0, .4); body.rotation.x = -Math.PI / 2;
  cyl(root, .78, .72, .9, 0, 0, -3.9, dark, 14).rotation.x = Math.PI / 2;                 // 星形发动机整流罩
  const prop = add(root, new THREE.CircleGeometry(1.5, 20), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: .18, side: THREE.DoubleSide }), 0, 0, -4.4);
  prop.castShadow = false; prop.userData.keep = true;
  for (const [y, span] of [[1.15, 11.4], [-.55, 10.6]]) {
    box(root, span, .14, 1.9, 0, y, -1.1, skin);
    for (const sign of [1, -1]) { const d = add(root, new THREE.CircleGeometry(.55, 16), red, sign * span * .36, y + (y > 0 ? .08 : -.08), -1.1); d.rotation.x = y > 0 ? -Math.PI / 2 : Math.PI / 2; d.castShadow = false; }
  }
  for (const sign of [1, -1]) for (const z of [-1.7, -.5]) rod(root, [sign * 3.6, -.5, z], [sign * 3.6, 1.1, z], .05, dark);
  for (const sign of [1, -1]) { rod(root, [sign * .5, -.4, -2.2], [sign * .9, -1.6, -2.2], .07, dark); const spat = add(root, new THREE.SphereGeometry(.28, 8, 6), skin, sign * .9, -1.75, -2.2); spat.scale.z = 1.8; }
  box(root, 3.6, .1, 1.1, 0, .25, 4.2, skin); box(root, .1, 1.3, 1.1, 0, .9, 4.3, skin);
  box(root, .7, .4, 2.2, 0, .65, .4, M.glass());
  mergeStatic(root);
  return root;
}

// ---------- 岸防：钢筋混凝土圆形炮台 + 装甲防盾炮塔 ----------
// 规格以 point.weapon.settings 为准：muzzleHeight=炮耳轴高，barrel=炮口距耳轴长度。
export function createCoastalGunModel(point) {
  const s = point.weapon.settings, mh = s.muzzleHeight, root = new THREE.Group(), flak = s.variant === 'flak88';
  const base = group(root);                  // 随 heading 的静态混凝土工事
  const swivel = group(root, 0, mh, 0); swivel.userData.dynamic = true;   // 随 yaw 转动的防盾炮塔
  const barrel = group(swivel); barrel.userData.dynamic = true;           // 随 pitch 俯仰的炮身
  const C = M.concrete(), CD = M.concreteDark(), G = mat(`coastal-green-${point.id}`, 0x4f5944, .7, .35), GD = M.gunDark();
  // 圆形炮台：前 240° 胸墙（外侧斜坡护坡）、炮台底板、座圈、待发弹壁龛
  add(base, new THREE.CylinderGeometry(6.2, 6.6, .8, 40), C, 0, -.38, 0);
  // 胸墙：全封闭炮塔自带装甲，按照片只做低矮的混凝土炮台边沿（约 0.4 米），让炮塔整体露出；开放式高射炮仍用高胸墙
  const wall = flak ? new THREE.LatheGeometry([new THREE.Vector2(8.6, -1.6), new THREE.Vector2(7.6, .2), new THREE.Vector2(6.5, 1.25),
    new THREE.Vector2(5.55, 1.3), new THREE.Vector2(5.3, 1.05), new THREE.Vector2(5.3, -.1)], 40, Math.PI - 2.15, 4.3)
    : new THREE.LatheGeometry([new THREE.Vector2(8.2, -1.6), new THREE.Vector2(7.2, .1), new THREE.Vector2(6.6, .4),
      new THREE.Vector2(5.9, .42), new THREE.Vector2(5.7, -.1)], 40, Math.PI - 2.15, 4.3);
  add(base, wall, C);
  const earth = new THREE.LatheGeometry(flak ? [new THREE.Vector2(12, -2.6), new THREE.Vector2(9.8, -.6), new THREE.Vector2(7.4, .3)]
    : [new THREE.Vector2(11, -2.6), new THREE.Vector2(9, -.8), new THREE.Vector2(7.1, .05)], 32, Math.PI - 2.05, 4.1);
  add(base, earth, mat('battery-turf', 0x5d6844, 1, 0));
  add(base, new THREE.TorusGeometry(3.4, .07, 4, 48), GD, 0, .02, 0).rotation.x = Math.PI / 2;
  cyl(base, 1.5, 1.8, .9, 0, .45, 0, CD, 24);
  if (flak) for (const a of [-1.3, -.45, .45, 1.3]) {
    const x = Math.sin(Math.PI + a) * 5.25, z = Math.cos(Math.PI + a) * 5.25;
    const niche = box(base, 1.1, .8, .35, x, .55, z, M.black()); niche.rotation.y = a;
    for (let k = 0; k < 3; k++) { const shell = cyl(base, .09, .09, .62, x + Math.cos(a) * (k - 1) * .25, .55, z - Math.sin(a) * (k - 1) * .25 + .05, M.brass(), 8); shell.userData.keep = false; }
  }
  if (!flak) {   // 炮位两侧与后方的块石护墙（参照照片中的毛石挡土墙）
    const stone = mat('masonry', 0xa79a82, .98, 0);
    let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // 后半圈（炮塔两侧后方至后方）弧形毛石墙，半径约 7.6 米、高约 1.5 米，正面射界不受遮挡
    for (let row = 0; row < 4; row++) for (let a = 1.75; a < TAU - 1.75; a += .075 + rnd() * .04) {
      const r = 7.6 + (rnd() - .5) * .1, b = box(base, .55 + rnd() * .3, .34 + rnd() * .1, .5, Math.sin(Math.PI + a) * r, .2 + row * .38, Math.cos(Math.PI + a) * r, stone);
      b.rotation.y = a + (rnd() - .5) * .1;
    }
  }
  // 炮台后方：通往弹药库的台阶与掩蔽部入口（半埋混凝土，覆土）
  box(base, 3.6, .2, 3, 0, -.1, 6.9, CD);
  for (let i = 0; i < 4; i++) box(base, 2.4, .2, .5, 0, -.3 - i * .35, 8.2 + i * .5, C);
  box(base, 5.4, 2.6, 4.4, 0, -.2, 11.4, C); box(base, 2, 1.8, .2, 0, -.6, 9.15, M.black());
  const mound = add(base, new THREE.SphereGeometry(4.2, 18, 10, 0, TAU, 0, Math.PI / 2), mat('battery-turf', 0x5d6844, 1, 0), 0, .9, 12.2);
  mound.scale.set(1.3, .55, 1.1);
  for (const [x, z] of [[-4.8, 4.6], [4.8, 4.6]]) for (let k = 0; k < 3; k++) box(base, 1, .34, .6, x, .17 + k * .34, z, M.sand());
  // 测距/观察哨（炮台侧后方）
  box(base, 2.4, 1.6, 2.4, -8.5, .3, 5.5, C); box(base, 1.8, .2, .1, -8.5, 1.0, 4.29, M.black());
  tubeZ(base, .1, .1, 2.6, -7.2, 1.35, 5.5, GD).rotation.z = Math.PI / 2;
  if (flak) { // 德制 88 毫米炮：十字形炮座 + 中央炮架 + 单块前防盾 + 细长身管（无顶盖，开放式炮位）
    const GD2 = GD;
    for (const r of [0, Math.PI / 2]) { const arm = box(base, 5.2, .3, .5, 0, .2, 0, GD2); arm.rotation.y = r + Math.PI / 4; }
    for (const [x, z] of [[1.9, 1.9], [-1.9, 1.9], [1.9, -1.9], [-1.9, -1.9]]) cyl(base, .25, .3, .2, x, .1, z, GD2, 8);
    cyl(swivel, .7, .9, 1.2, 0, -mh + .9, 0, G, 16);                                    // 上架
    box(swivel, 1.4, .9, 1.6, 0, -.45, .2, G);
    for (const sign of [1, -1]) box(swivel, .12, 1.5, 1.6, sign * .55, -.1, .1, G);      // 摇架侧板
    const shield = box(swivel, 2.6, 1.6, .12, 0, .1, -1.0, G); shield.rotation.x = -.1;   // 前防盾
    box(swivel, .5, .3, .14, -.6, .55, -1.02, M.black());                                // 瞄准窗
    tubeZ(barrel, .08, .13, s.barrel, 0, 0, .3, GD, 14);
    tubeZ(barrel, .1, .1, .5, 0, 0, -s.barrel + .5, GD, 12);
    tubeZ(barrel, .11, .11, 2.6, 0, .24, 1.1, G, 10);                                   // 复进机
    box(barrel, .45, .45, 1, 0, 0, 1.3, GD);                                             // 炮闩
    for (const sign of [1, -1]) { rod(barrel, [sign * .35, -.2, .7], [sign * .35, .6, -.4], .07, G); }   // 平衡机
    rod(barrel, [-.6, 0, 0], [.6, 0, 0], .12, GD);
  } else {
  // 全封闭装甲炮塔（参照江阴要塞遗存岸防炮照片）：圆角箱形炮室，正面近乎竖直，中央竖向炮门，左前方拱形观瞄窗，表面铆接吊耳
  const T = mat('turret-grey', 0x3f4443, .72, .18);   // 哑光深灰涂装钢板（金属度低，避免映出天空发白）
  const profile = new THREE.Shape();   // 侧视轮廓：x = 向前距离，y = 高度（相对耳轴）
  profile.moveTo(-2.15, -1.95); profile.lineTo(1.75, -1.95); profile.lineTo(1.95, -.6); profile.lineTo(1.85, .75);
  profile.quadraticCurveTo(1.7, 1.25, 1.1, 1.3); profile.lineTo(-1.5, 1.3); profile.quadraticCurveTo(-2.2, 1.25, -2.25, .5); profile.lineTo(-2.15, -1.95);
  const width = 3.0, house = new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: true, bevelThickness: .28, bevelSize: .28, bevelSegments: 4, curveSegments: 10 });
  house.translate(0, 0, -width / 2); house.rotateY(Math.PI / 2);   // 轮廓 x（向前）→ 世界 -z；挤出方向 → 世界 x
  add(swivel, house, T);
  const front = -2.2;                                              // 炮室正面（-z）
  box(swivel, .62, 1.55, .5, 0, .05, front - .02, M.black());       // 竖向炮门
  for (const sign of [1, -1]) box(swivel, .14, 1.75, .3, sign * .42, .05, front - .1, T);   // 炮门两侧加强框
  // 左前方拱形观瞄窗（窗框 + 黑色窗洞）
  const arch = new THREE.Shape(); arch.moveTo(-.28, -.55); arch.lineTo(.28, -.55); arch.lineTo(.28, .25); arch.absarc(0, .25, .28, 0, Math.PI, false); arch.lineTo(-.28, -.55);
  const archGeo = new THREE.ExtrudeGeometry(arch, { depth: .3, bevelEnabled: true, bevelThickness: .06, bevelSize: .06, bevelSegments: 2 });
  add(swivel, archGeo, T, -.95, .35, front - .28);
  const hole = new THREE.Shape(); hole.moveTo(-.18, -.42); hole.lineTo(.18, -.42); hole.lineTo(.18, .22); hole.absarc(0, .22, .18, 0, Math.PI, false); hole.lineTo(-.18, -.42);
  add(swivel, new THREE.ShapeGeometry(hole), M.black(), -.95, .35, front - .3).rotation.y = Math.PI;
  // 吊耳、铰链与铆接压条（正面与侧面）
  for (const [x, y] of [[-1.25, .95], [1.15, .95], [-1.25, -.2], [1.15, -.2], [-1.25, -1.2], [1.15, -1.2], [-.5, -1.25], [.5, -1.25]]) {
    box(swivel, .22, .1, .12, x, y, front - .06, T); box(swivel, .06, .16, .14, x, y - .1, front - .07, T);
  }
  for (const sign of [1, -1]) {
    for (const y of [.9, -.1, -1.1]) box(swivel, .12, .1, 2.6, sign * (width / 2 + .3), y, -.1, T);       // 侧面压条
    box(swivel, .1, 1.5, .9, sign * (width / 2 + .32), -.25, .9, M.black());                            // 侧门缝
    box(swivel, .12, .14, .3, sign * (width / 2 + .38), -.2, .55, T);                                   // 门把手
  }
  for (let i = 0; i < 7; i++) { const r = cyl(swivel, .045, .045, .04, -1.3 + i * .43, 1.62, -1.6 + (i % 2) * .2, GD, 6); }   // 顶部铆钉
  box(swivel, .9, .22, .5, .7, 1.66, .5, T);                                                            // 顶部通风罩
  // 炮身：炮门内的防盾套箍 + 细长身管（炮口略加厚）
  tubeZ(barrel, .3, .3, .45, 0, 0, -2.05, T, 18);                   // 炮门处套箍
  tubeZ(barrel, .17, .24, 1.6, 0, 0, -2.45, GD, 18);                 // 身管加粗段
  tubeZ(barrel, .12, .17, s.barrel - 4.4, 0, 0, -4.05, GD, 18);      // 细长身管（照片中约为炮塔长度的 2.5 倍）
  tubeZ(barrel, .155, .155, .35, 0, 0, -s.barrel + .35, GD, 18);     // 炮口加厚环
  rod(barrel, [-.5, 0, 0], [.5, 0, 0], .14, GD);                    // 耳轴
  }
  // 炮手（随炮塔转动）：装填手抱弹、瞄准手
  for (const [x, z, rifle] of [[.9, 2.4, false], [-1.2, 1.9, false]]) {
    const man = crewMember(rifle); man.position.set(x, -mh, z); man.rotation.y = Math.PI * .92; swivel.add(man);
  }
  const shell = cyl(swivel, .1, .1, .7, .9, -mh + 1.2, 2.0, M.brass(), 8); shell.rotation.x = 1.2;
  mergeStatic(base); mergeStatic(swivel); mergeStatic(barrel);
  // mergeStatic 会把 dynamic 子树跳过 —— 对 swivel/barrel 单独合并时它们自身就是 root，所以能合并。
  root.userData.update = () => {
    root.position.x = point.x; root.position.z = point.z; root.rotation.y = point.heading;
    swivel.rotation.y = point.yaw - point.heading; barrel.rotation.x = point.pitch;
    barrel.position.z = (point.recoil ?? 0) * 1.4;
    root.updateMatrixWorld(true);
  };
  root.userData.destroy = () => {
    swivel.rotation.z = .18; barrel.rotation.x = -.22; swivel.position.y = mh - .35;
    G.color.setHex(0x2a2924);
    root.userData.update = () => { root.position.x = point.x; root.position.z = point.z; root.updateMatrixWorld(true); };
  };
  root.userData.update();
  return root;
}

// 德制 8.8 cm Flak 18/36 高射炮：十字形炮座（Kreuzlafette）+ 四个调平支脚、中央立柱、上架两侧板、
// 摇架与细长身管（L/56）、身管上方的驻退复进机、两侧平衡机、方向/高低手轮与引信测合机，开放式（无防盾）。外围为圆形土石掩体与沙袋。
export function createFlak88Model(point) {
  const s = point.weapon.settings, mh = s.muzzleHeight, root = new THREE.Group();
  const base = group(root), swivel = group(root, 0, mh, 0), barrel = group(swivel);
  swivel.userData.dynamic = true; barrel.userData.dynamic = true;
  const F = mat('flak-grey', 0x55594f, .66, .25), FD = M.gunDark(), E = mat('battery-turf', 0x5d6844, 1, 0);
  // 掩体：圆形土墙 + 沙袋胸墙，后方留出入口
  const ring = new THREE.LatheGeometry([new THREE.Vector2(9.5, -.8), new THREE.Vector2(7.6, .9), new THREE.Vector2(6.6, 1.0), new THREE.Vector2(6.3, -.2)], 32, .5, TAU - 1);
  add(base, ring, E).rotation.y = Math.PI;
  for (let k = 0; k < 26; k++) { const a = Math.PI + .3 + k / 26 * (TAU - .9), r = 6.5;
    const bag = box(base, 1, .34, .55, Math.sin(a) * r, 1.15, Math.cos(a) * r, M.sand()); bag.rotation.y = a; }
  // 十字形炮座（Kreuzlafette）：前后主梁较长、左右支腿较短，梁身为向外收窄的箱形梁；四端为带调平丝杠的圆形座盘
  const beam = (length, angle) => {
    const shape = new THREE.Shape(); shape.moveTo(0, -.28); shape.lineTo(length, -.16); shape.lineTo(length, .16); shape.lineTo(0, .28); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: .32, bevelEnabled: true, bevelThickness: .03, bevelSize: .03, bevelSegments: 1 });
    geometry.rotateX(Math.PI / 2); geometry.translate(0, .16, 0);
    const mesh = add(base, geometry, F, 0, .42, 0); mesh.rotation.y = angle; return mesh;
  };
  for (const [length, angle] of [[3.4, 0], [3.4, Math.PI], [2.7, Math.PI / 2], [2.7, -Math.PI / 2]]) {
    beam(length, angle);
    const x = Math.cos(angle) * (length - .1), z = -Math.sin(angle) * (length - .1);
    cyl(base, .34, .4, .12, x, .06, z, FD, 14);                          // 座盘
    cyl(base, .06, .06, .55, x, .38, z, FD, 8);                          // 调平丝杠
    cyl(base, .14, .14, .22, x, .5, z, F, 10);                           // 丝杠套筒
    const crank = add(base, new THREE.TorusGeometry(.12, .02, 4, 12), FD, x, .68, z); crank.rotation.x = Math.PI / 2;
  }
  cyl(base, .55, .62, .3, 0, .55, 0, F, 20);                            // 底座板
  cyl(base, .42, .55, mh - 1.15, 0, .7 + (mh - 1.15) / 2, 0, F, 20);     // 中央立柱（锥形）
  // 上架：转盘、两块高大的耳轴支板、炮手座椅、方向/高低手轮、引信测合机、两侧平衡机
  cyl(swivel, .85, .85, .16, 0, -mh + 1.2, 0, FD, 24);
  const bracket = new THREE.Shape(); bracket.moveTo(-.75, 0); bracket.lineTo(.65, 0); bracket.lineTo(.3, mh - .95); bracket.lineTo(-.35, mh - .95); bracket.closePath();
  for (const sign of [1, -1]) {
    const geometry = new THREE.ExtrudeGeometry(bracket, { depth: .1, bevelEnabled: false }); geometry.rotateY(Math.PI / 2);
    add(swivel, geometry, F, sign * .42 - .05, -mh + 1.25, 0);
    // 平衡机：上架前下方斜向摇架的粗圆筒（照片中最显眼的两根竖筒）
    rod(swivel, [sign * .62, -mh + 1.35, -.55], [sign * .5, -.15, -.85], .14, F, 12);
    rod(swivel, [sign * .5, -.15, -.85], [sign * .45, .02, -1.0], .07, FD, 8);
  }
  for (const [x, z] of [[.95, .55], [-.95, .55]]) { cyl(swivel, .2, .2, .06, x, -.6, z, FD, 10); rod(swivel, [x * .55, -.75, z], [x, -.6, z], .035, FD); }
  for (const [x, y, z] of [[.78, -.35, .1], [-.78, -.35, .1]]) {
    const wheel = add(swivel, new THREE.TorusGeometry(.2, .025, 4, 18), FD, x, y, z); wheel.rotation.y = Math.PI / 2;
    for (let k = 0; k < 3; k++) { const spoke = rod(swivel, [x, y, z], [x, y + Math.sin(k * 2.1) * .19, z + Math.cos(k * 2.1) * .19], .012, FD, 4); }
  }
  box(swivel, .42, .75, .5, -.95, -.55, -.35, F); box(swivel, .3, .12, .3, -.95, -.12, -.35, FD);   // 引信测合机
  // 身管：L/56 细长炮管（略带锥度）、炮口、炮尾/炮闩、方形摇架、身管上方两根驻退复进筒
  box(barrel, .5, .46, 2.1, 0, 0, .25, F);                              // 摇架
  tubeZ(barrel, .085, .12, s.barrel - .3, 0, 0, -.8, FD, 16);
  tubeZ(barrel, .1, .1, .3, 0, 0, -s.barrel - .25, FD, 14);             // 炮口
  tubeZ(barrel, .16, .16, .7, 0, 0, -.6, FD, 16);                       // 身管根部
  box(barrel, .46, .5, .75, 0, 0, 1.45, FD);                            // 炮尾
  box(barrel, .56, .14, .5, 0, -.3, 1.45, F);                           // 闩座
  tubeZ(barrel, .11, .11, 2.7, 0, .33, 1.2, F, 12);                     // 驻退机
  tubeZ(barrel, .085, .085, 2.3, 0, .52, 1.0, F, 12);                   // 复进机
  for (const z of [-.6, .3, 1.0]) box(barrel, .24, .5, .1, 0, .32, z, F);   // 箍带
  rod(barrel, [-.5, 0, 0], [.5, 0, 0], .1, FD);                         // 耳轴
  for (const [x, z] of [[1.1, 1.4], [-1.2, 1.2]]) { const man = crewMember(false); man.position.set(x, -mh, z); man.rotation.y = Math.PI * .92; swivel.add(man); }
  mergeStatic(base); mergeStatic(swivel); mergeStatic(barrel);
  root.userData.update = () => {
    root.position.x = point.x; root.position.z = point.z; root.rotation.y = point.heading;
    swivel.rotation.y = point.yaw - point.heading; barrel.rotation.x = point.pitch;
    barrel.position.z = (point.recoil ?? 0) * 1.2;
    root.updateMatrixWorld(true);
  };
  root.userData.destroy = () => {
    swivel.rotation.z = .25; barrel.rotation.x = -.3; F.color.setHex(0x2b2a26);
    root.userData.update = () => { root.position.x = point.x; root.position.z = point.z; root.updateMatrixWorld(true); };
  };
  root.userData.update();
  return root;
}

// 炮艇艇首速射炮（带弧形防盾）
export function createDeckGunModel(point) {
  const s = point.weapon.settings, mh = s.muzzleHeight, root = new THREE.Group();
  const swivel = group(root, 0, mh, 0), barrel = group(swivel);
  const G = mat('deckgun-grey', 0x7d827d, .6, .35), GD = M.gunDark();
  cyl(root, .5, .7, mh - .3, 0, (mh - .3) / 2, 0, GD, 16);
  const shield = add(swivel, new THREE.CylinderGeometry(1.15, 1.15, 1.5, 18, 1, true, Math.PI - 1.05, 2.1), G, 0, .05, .45);
  shield.material = G;
  box(swivel, .32, .22, .06, -.4, .3, -.68, M.black());
  box(swivel, .7, .6, 1, 0, -.2, .1, GD);
  tubeZ(barrel, .07, .11, s.barrel, 0, 0, .2, GD, 12);
  tubeZ(barrel, .14, .14, .9, 0, 0, .7, G, 12); box(barrel, .3, .3, .45, 0, 0, .9, GD);
  for (const y of [.2]) tubeZ(barrel, .06, .06, 1.2, 0, y, .6, G, 8);
  const man = crewMember(false); man.position.set(.7, -mh, 1.4); man.rotation.y = Math.PI; swivel.add(man);
  mergeStatic(swivel); mergeStatic(barrel); mergeStatic(root);
  root.userData.update = () => {
    root.position.x = point.x; root.position.z = point.z; root.rotation.y = point.heading;
    swivel.rotation.y = point.yaw - point.heading; barrel.rotation.x = point.pitch;
    barrel.position.z = (point.recoil ?? 0) * .8; root.updateMatrixWorld(true);
  };
  root.userData.update();
  return root;
}

// 滩头钢筋混凝土机枪掩体（马蹄形胸墙 + 顶部沙袋 + 射孔），内部复用项目的民二四式重机枪模型
export function createMgNestModel(point, createGun) {
  const wrapper = new THREE.Group(), nest = group(wrapper), gun = createGun(point);
  gun.traverse(o => { if (o.isMesh && o.userData.emplacementCover) o.visible = false; }); // 去掉原模型自带沙袋，由掩体代替
  wrapper.add(gun);
  const C = M.concrete();
  add(nest, new THREE.LatheGeometry([new THREE.Vector2(2.9, -.4), new THREE.Vector2(2.35, .85), new THREE.Vector2(1.85, .88),
    new THREE.Vector2(1.7, .78), new THREE.Vector2(1.7, -.2)], 28, Math.PI - 1.9, 3.8), C);
  add(nest, new THREE.CylinderGeometry(1.75, 1.75, .2, 24), M.concreteDark(), 0, -.1, 0);
  for (let i = -3; i <= 3; i++) { const a = Math.PI + i * .42, b = box(nest, .8, .3, .45, Math.sin(a) * 2.05, 1.03, Math.cos(a) * 2.05, M.sand()); b.rotation.y = a; }
  const loader = crewMember(false); loader.position.set(-.9, 0, .9); loader.rotation.y = Math.PI * .8; nest.add(loader);
  mergeStatic(nest);
  wrapper.userData.update = () => {
    gun.userData.update?.();
    wrapper.position.x = point.x; wrapper.position.z = point.z;
    gun.position.x = 0; gun.position.z = 0; gun.rotation.y = point.heading;
    nest.rotation.y = point.heading;
    wrapper.updateMatrixWorld(true);
  };
  wrapper.userData.update();
  return wrapper;
}

// ---------- 我舰艏主炮塔（玩家可操作）：封闭式双联炮塔，炮塔随 yaw 旋转、炮管随 pitch 俯仰 ----------
export function createShipTurretModel(point) {
  const s = point.weapon.settings, root = new THREE.Group(), hullM = M.rocHull(), dark = M.gunDark();
  cyl(root, 2.1, 2.3, .5, 0, .25, 0, hullM, 24);                          // 座圈
  const swivel = group(root, 0, .5, 0), barrel = group(swivel, 0, s.muzzleHeight - .5, -1.2);
  barrel.userData.dynamic = true;
  // 炮塔：前低后高的斜面装甲罩 + 顶部测距仪耳 + 观察镜
  const shape = new THREE.Shape([[-2.6, -1.9], [2.6, -1.9], [2.3, 2.3], [-2.3, 2.3]].map(([x, y]) => new THREE.Vector2(x, y)));
  const house = new THREE.ExtrudeGeometry(shape, { depth: 2.1, bevelEnabled: true, bevelSize: .12, bevelThickness: .12, bevelSegments: 2 });
  house.rotateX(-Math.PI / 2); house.translate(0, 0, 0);
  const houseMesh = add(swivel, house, hullM, 0, 0, .2);
  houseMesh.scale.set(1, 1, 1);
  box(swivel, 4.4, .14, 3.6, 0, 2.25, .5, hullM);
  for (const side of [-1, 1]) { cyl(swivel, .32, .32, .7, side * 2.7, 1.6, 1.2, hullM, 10).rotation.z = Math.PI / 2; }
  box(swivel, .34, .26, .42, -1.2, 2.42, -.4, dark); box(swivel, .34, .26, .42, 1.2, 2.42, -.4, dark);   // 观瞄潜望镜罩
  for (const off of [-.85, .85]) {
    tubeZ(barrel, .14, .22, s.barrel, off, 0, 0, dark, 14);
    cyl(barrel, .26, .26, .7, off, 0, -.1, dark, 12).rotation.x = Math.PI / 2;      // 炮盾套筒
    cyl(barrel, .17, .17, .25, off, 0, -s.barrel, dark, 12).rotation.x = Math.PI / 2;
  }
  mergeStatic(swivel); mergeStatic(barrel); mergeStatic(root);
  root.userData.update = () => {
    root.position.x = point.x; root.position.z = point.z; root.rotation.y = point.heading;
    swivel.rotation.y = point.yaw - point.heading; barrel.rotation.x = point.pitch;
    barrel.position.z = -1.2 + (point.recoil ?? 0) * .9; root.updateMatrixWorld(true);
  };
  root.userData.update();
  return root;
}

// ---------- 自沉阻塞船：旧式军舰（通济练习舰、大同/自强/德胜/威胜/武胜）与征用商轮 ----------
// kind：'flagship' 通济（三桅帆装练习舰）、'gunboat' 旧式炮舰、'merchant' 商轮
export function createBlockshipModel({ kind = 'merchant', length = 46, beam = 8, seed = 1, name = '' } = {}) {
  let r0 = seed; const r = () => (r0 = (r0 * 16807) % 2147483647) / 2147483647;
  const root = new THREE.Group(), rails = [], L = length, B = beam;
  const merchant = kind === 'merchant', flagship = kind === 'flagship';
  const hullColor = merchant ? [0x2f2c29, 0x3b3631, 0x433a30][Math.floor(r() * 3)] : flagship ? 0x8d918c : 0x7f847f;
  const top = merchant ? mat('merchant-house', 0xc9c1ad, .8, .1) : M.rocLight(), hullM = merchant ? mat('merchant-hull', hullColor, .7, .25) : M.rocHull();
  const hull = loftHull(root, { length: L, beam: B, draft: merchant ? 2.6 : 2.2, rake: merchant ? .8 : flagship ? 3.4 : 1.2, transom: .55,
    hullColor, bootColor: 0x1d1d1c, bottomColor: 0x6a2c22, breaks: merchant ? [.22, .78] : [],
    deck: s => merchant ? (s < .22 ? 4.6 : s > .78 ? 4.4 : 3.6) : 3.4 + (s < .2 ? (1 - s / .2) * .8 : 0),
    deckMaterial: mat('roc-deck', 0x6f6352, .95, 0) });
  hull.rails(rails);
  if (merchant) {
    box(root, B * .7, 2.6, L * .16, 0, hull.deck(.5) + 1.3, 0, top);                   // 中部船楼
    wheelhouse(root, B * .55, 1.8, L * .07, 0, hull.deck(.5) + 2.6, -L * .03, top);
    funnel(root, 0, hull.deck(.5) + 2.6, L * .05, { r: .9 + r() * .4, h: 6 + r() * 3, rake: .06, color: M.black(), cap: M.black(),
      bands: [[3.2, mat('funnel-band', [0xb23a2a, 0xd0c8b0, 0x2e4f86][Math.floor(r() * 3)], .7, 0)]] });
    for (const z of [-.32, .32]) {
      pole(root, 0, hull.deck(.5), L * z, 9 + r() * 3, { yard: 3, rake: z * .1 });
      rod(root, [0, hull.deck(.5) + 2, L * z], [0, hull.deck(.5) + .8, L * (z * 1.45)], .09, M.dark());   // 吊杆
      box(root, B * .45, .6, L * .12, 0, hull.deck(.5) + .3, L * z * 1.45, mat('hatch', 0x4a3f33, .9, 0));   // 货舱口
    }
    lifeboat(root, B * .42, hull.deck(.5) + 2.9, L * .02, 4, 1); lifeboat(root, -B * .42, hull.deck(.5) + 2.9, L * .02, 4, -1);
  } else if (flagship) {   // 通济：一根烟囱、三根带横桁的桅杆（练习舰帆装）、舷侧小炮
    box(root, B * .6, 2.2, L * .14, 0, hull.deck(.4) + 1.1, -L * .1, top);
    wheelhouse(root, B * .5, 1.7, L * .06, 0, hull.deck(.4) + 2.2, -L * .12, top);
    funnel(root, 0, hull.deck(.5), L * .02, { r: 1.2, h: 7, rake: .1, color: M.rocLight() });
    for (const [z, h] of [[-.3, 24], [.05, 26], [.33, 21]]) {
      const mast = pole(root, 0, hull.deck(.5), L * z, h, { yard: B * 1.4, top: 4, rake: .06 });
      for (const k of [.45, .65]) rod(mast, [-B * .6 * (1.2 - k), h * k, 0], [B * .6 * (1.2 - k), h * k, 0], .07, M.dark());
    }
    rod(root, [0, hull.deck(.05) + 1, -L / 2 - 2], [0, hull.deck(.05) + 6, -L / 2 - 9], .14, M.dark());   // 艏斜桅
    for (const sign of [1, -1]) for (let i = 0; i < 3; i++) navalGun(root, sign * B * .38, hull.deck(.3 + i * .15), L * (-.2 + i * .15), { size: .55, barrel: 2 });
    flag(root, 'roc', 0, hull.deck(.98) + 3, L * .49, 2.4); rod(root, [0, hull.deck(.98), L * .49], [0, hull.deck(.98) + 4, L * .49], .06, M.dark());
  } else {               // 旧式炮舰
    navalGun(root, 0, hull.deck(.12), -L * .36, { size: .8, barrel: 2.6 });
    box(root, B * .55, 1.8, L * .14, 0, hull.deck(.35) + .9, -L * .12, top);
    wheelhouse(root, B * .45, 1.5, L * .07, 0, hull.deck(.35) + 1.8, -L * .14, top);
    funnel(root, 0, hull.deck(.5), L * .02, { r: .9, h: 5.5, rake: .1, color: M.rocLight() });
    pole(root, 0, hull.deck(.35) + 3.3, -L * .1, 10, { yard: 3.4 });
    pole(root, 0, hull.deck(.7), L * .25, 7, { yard: 2.4 });
    flag(root, 'roc', 0, hull.deck(.98) + 2.4, L * .49, 1.8); rod(root, [0, hull.deck(.98), L * .49], [0, hull.deck(.98) + 3.2, L * .49], .05, M.dark());
  }
  portholes(root, hull, .08, .9, Math.round(L / 3), 1.9);
  railLines(root, rails);
  addWake(root, L, B, .8);
  mergeStatic(root);
  root.name = name;
  root.userData = { ...root.userData, length: L, beam: B, kind };
  return root;
}

// 统一入口：按点位 mount 选择模型（coastal / deck / nest），其余交给项目原有模型
export function createJiangyinGunModel(point, createProjectModel) {
  const mount = point.weapon.settings.mount;
  if (mount === 'coastal' && point.weapon.settings.variant === 'flak88') return createFlak88Model(point);
  if (mount === 'coastal') return createCoastalGunModel(point);
  if (mount === 'deck') return createDeckGunModel(point);
  if (mount === 'shipTurret') return createShipTurretModel(point);
  if (mount === 'nest') return createMgNestModel(point, createProjectModel);
  return createProjectModel(point);
}
