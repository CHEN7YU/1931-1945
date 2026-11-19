// 江阴要塞阻击战 · 植被：远景树林用程序绘制的十字面片树（冬季落叶树 / 马尾松 / 樟树等常绿阔叶），
// 近景用项目 woodland.js 的真实枝干几何（榆、杨、柳，冬季落叶），地面用成片枯草丛。
// 贴图全部在内存里光栅化（DataTexture），不依赖 DOM，可在 node 模拟中运行。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodlandTreeGeometry } from '../woodland.js';
import { projectSurface } from './jiangyin-surfaces.js';

function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- 软件光栅：在 RGBA 浮点缓冲上叠圆盘 ----------
function createRaster(w, h) {
  const rgb = new Float32Array(w * h * 3), alpha = new Float32Array(w * h);
  function disc(cx, cy, r, color, opacity = 1) {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cover = Math.max(0, Math.min(1, r + .5 - Math.hypot(x + .5 - cx, y + .5 - cy))) * opacity;
      if (cover <= 0) continue;
      const i = y * w + x, a = alpha[i], out = cover + a * (1 - cover);
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = (color[c] * cover + rgb[i * 3 + c] * a * (1 - cover)) / out;
      alpha[i] = out;
    }
  }
  function line(x0, y0, x1, y1, r0, r1, color, opacity = 1) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5));
    for (let s = 0; s <= steps; s++) { const t = s / steps; disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, color, opacity); }
  }
  function texture() {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // 透明处颜色向邻近树冠色外扩，避免 mipmap 黑边
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(Math.max(0, Math.min(1, rgb[i * 3 + c])) * 255);
      data[i * 4 + 3] = Math.round(alpha[i] * 255);
    }
    for (let pass = 0; pass < 4; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 8) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4; if (data[j + 3] > 8) { data[i] = data[j]; data[i + 1] = data[j + 1]; data[i + 2] = data[j + 2]; break; }
      }
    }
    const flipped = new Uint8Array(data.length);   // 画布 y 向下，纹理 v 向上
    for (let y = 0; y < h; y++) flipped.set(data.subarray(y * w * 4, (y + 1) * w * 4), (h - 1 - y) * w * 4);
    const texture = new THREE.DataTexture(flipped, w, h);
    texture.flipY = false; texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }
  return { w, h, disc, line, texture };
}
const tone = (hex, k = 1) => [(hex >> 16 & 255) / 255 * k, (hex >> 8 & 255) / 255 * k, (hex & 255) / 255 * k];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// 冬季落叶树（榆/朴/乌桕）：分叉枝干 + 细密小枝形成的灰紫色树冠
function paintBareTree(seed) {
  const R = createRaster(256, 512), random = rng(seed);
  const bark = tone(0x4b4239), twig = tone(0x6e655e), tip = tone(0x8a7f78);
  function branch(x, y, angle, length, width, depth) {
    const x1 = x + Math.sin(angle) * length, y1 = y - Math.cos(angle) * length;
    const color = depth > 3 ? bark : mix(twig, tip, (3 - depth) / 3);
    R.line(x, y, x1, y1, width, width * .7, color, depth > 1 ? 1 : .7);
    if (depth <= 0) return;
    const children = depth > 4 ? 2 + (random() > .5 ? 1 : 0) : 2 + (random() > .3 ? 1 : 0);
    for (let c = 0; c < children; c++) {
      const spread = (c - (children - 1) / 2) * (.5 + random() * .35) + (random() - .5) * .25;
      branch(x1, y1, angle * .75 + spread, length * (.68 + random() * .14), Math.max(.45, width * .64), depth - 1);
    }
  }
  const lean = (random() - .5) * .12;
  R.line(128, 511, 128 + lean * 120, 300, 9, 6, bark);
  branch(128 + lean * 120, 300, lean - .35, 95, 5.5, 7);
  branch(128 + lean * 120, 300, lean + .32, 100, 5.5, 7);
  branch(128 + lean * 120, 330, lean + .05, 120, 5, 7);
  return R.texture();
}
// 马尾松：细高红褐色树干，伞形不规则的墨绿针叶团
function paintPine(seed) {
  const R = createRaster(256, 512), random = rng(seed);
  const trunk = tone(0x6a4a35), dark = tone(0x26301f), mid = tone(0x3a4a2c), light = tone(0x5c6b43);
  const topX = 128 + (random() - .5) * 30;
  R.line(128, 511, topX, 60, 7, 3, trunk);
  const tiers = 7 + Math.floor(random() * 4);
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1), y = 70 + k * 270, x = 128 + (topX - 128) * (1 - y / 511);
    const width = (40 + 70 * Math.sin(Math.min(1, k * 1.3) * Math.PI * .8)) * (.7 + random() * .5);
    for (const side of [-1, 1]) {
      const reach = width * (.6 + random() * .5), bx = x + side * reach, by = y + 10 + random() * 25;
      R.line(x, y + 8, bx, by, 2.5, 1, trunk);
      const blobs = 40 + Math.floor(random() * 30);
      for (let b = 0; b < blobs; b++) {
        const u = random(), px = x + (bx - x) * (.3 + u * .8) + (random() - .5) * 26, py = by - 12 + (random() - .6) * 26 * (1 - u * .3);
        const shade = Math.max(0, Math.min(1, .55 - (py - by + 12) / 40 + (random() - .5) * .5));
        R.disc(px, py, 3 + random() * 5, shade > .6 ? mix(mid, light, shade - .4) : mix(dark, mid, shade / .6));
      }
    }
  }
  for (let b = 0; b < 60; b++) R.disc(topX + (random() - .5) * 40, 50 + random() * 40, 3 + random() * 5, mix(mid, light, random() * .6));
  return R.texture();
}
// 樟树/青冈等常绿阔叶：短干，团状浓密树冠，顶部受光偏亮
function paintBroadleaf(seed) {
  const R = createRaster(256, 512), random = rng(seed);
  const trunk = tone(0x4a3d31), dark = tone(0x2c3522), mid = tone(0x485534), light = tone(0x6d7a4c);
  R.line(128, 511, 124, 300, 10, 6, trunk);
  for (let i = 0; i < 6; i++) R.line(124, 330, 128 + (random() - .5) * 170, 200 + random() * 70, 4, 1.5, trunk);
  const cx = 128, cy = 220, rx = 104, ry = 150;
  for (let b = 0; b < 900; b++) {
    const a = random() * Math.PI * 2, r = Math.sqrt(random());
    const px = cx + Math.cos(a) * r * rx * (.85 + random() * .3), py = cy + Math.sin(a) * r * ry * (.8 + random() * .25);
    const light01 = Math.max(0, Math.min(1, .55 - (py - cy) / ry * .45 - (px - cx) / rx * .15 + (random() - .5) * .45));
    R.disc(px, py, 2.5 + random() * 5.5, light01 > .55 ? mix(mid, light, (light01 - .55) / .45) : mix(dark, mid, light01 / .55));
  }
  return R.texture();
}

// 十字面片：两张竖直面片，法线朝上偏外（让树冠受天光照明而不是按面片朝向明暗突变）
function cardGeometry() {
  const geometries = [0, Math.PI / 2].map(angle => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, .5, 0); g.rotateY(angle);
    const normals = g.attributes.normal;
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, normals.getX(i) * .35, .94, normals.getZ(i) * .35);
    return g;
  });
  return mergeGeometries(geometries);
}

export const CARD_KINDS = Object.freeze(['bare', 'pine', 'broadleaf']);
// spots：[{ x, y, z, kind, height, width, tint }]
export function createTreeCards(scene, spots) {
  const geometry = cardGeometry(), painters = { bare: paintBareTree, pine: paintPine, broadleaf: paintBroadleaf };
  const meshes = [];
  for (const kind of CARD_KINDS) {
    const list = spots.filter(spot => spot.kind === kind);
    if (!list.length) continue;
    // 每种树两个变体，避免一片林子都是同一棵
    for (const variant of [0, 1]) {
      const subset = list.filter((_, index) => index % 2 === variant);
      if (!subset.length) continue;
      const material = new THREE.MeshStandardMaterial({ map: painters[kind](101 + variant * 57 + kind.length * 13), alphaTest: .45,
        side: THREE.DoubleSide, roughness: .95, metalness: 0 });
      const mesh = new THREE.InstancedMesh(geometry, material, subset.length), matrix = new THREE.Matrix4(),
        rotation = new THREE.Quaternion(), color = new THREE.Color();
      subset.forEach((spot, index) => {
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spot.heading ?? 0);
        matrix.compose(new THREE.Vector3(spot.x, spot.y - .3, spot.z), rotation, new THREE.Vector3(spot.width, spot.height, spot.width));
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, color.setScalar(spot.tint ?? 1));
      });
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.treeKind = kind;
      scene.add(mesh); meshes.push(mesh);
    }
  }
  return meshes;
}

// 近景：项目 woodland.js 的枝干几何（冬季落叶），按树种合批
export function createWoodlandTrees(scene, trees) {
  const bySpecies = new Map();
  for (const tree of trees) {
    const geometry = woodlandTreeGeometry(tree);
    geometry.bark.translate(tree.x, tree.y, tree.z);
    if (!bySpecies.has(tree.species)) bySpecies.set(tree.species, []);
    bySpecies.get(tree.species).push(geometry.bark);
    if (geometry.foliage) { geometry.foliage.translate(tree.x, tree.y, tree.z); (bySpecies.get(`${tree.species}:leaf`) ?? bySpecies.set(`${tree.species}:leaf`, []).get(`${tree.species}:leaf`)).push(geometry.foliage); }
  }
  const meshes = [];
  for (const [key, geometries] of bySpecies) {
    const leaf = key.endsWith(':leaf');
    const material = leaf ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: .9 })
      : projectSurface(`bark-${key}`);
    if (!leaf) material.vertexColors = true;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh); meshes.push(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  return meshes;
}

// 枯草丛：每丛 7 片草叶，底暗梢亮；按密度场实例化
export function createGrass(scene, spots) {
  const positions = [], colors = [], random = rng(77);
  for (let b = 0; b < 7; b++) {
    const a = b / 7 * Math.PI * 2 + random() * .5, lean = .25 + random() * .35, h = .55 + random() * .5, w = .035;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz * w, pz = dx * w;
    positions.push(-px, 0, -pz, px, 0, pz, dx * lean, h, dz * lean);
    colors.push(.42, .37, .27, .42, .37, .27, 1, .93, .74);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, normals.getX(i) * .3, .95, normals.getZ(i) * .3);
  const material = new THREE.MeshStandardMaterial({ color: 0x9a8a62, vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
  const mesh = new THREE.InstancedMesh(geometry, material, spots.length), matrix = new THREE.Matrix4(),
    rotation = new THREE.Quaternion(), color = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  spots.forEach((spot, index) => {
    rotation.setFromAxisAngle(up, spot.heading);
    matrix.compose(new THREE.Vector3(spot.x, spot.y - .05, spot.z), rotation, new THREE.Vector3(spot.scale, spot.scale * spot.tall, spot.scale));
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color.setRGB(spot.tint[0], spot.tint[1], spot.tint[2]));
  });
  mesh.receiveShadow = true; mesh.castShadow = false;
  scene.add(mesh);
  return mesh;
}
