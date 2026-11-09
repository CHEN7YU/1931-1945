import * as THREE from 'three';
import { SIHANG_WAREHOUSE as W, SIHANG_NORTH_APERTURES } from './sihang-layout.js';

export function northApertureSpan(hole, y) {
  const crossings = [];
  for (let i = 0; i < hole.outline.length; i++) {
    const a = hole.outline[i], b = hole.outline[(i + 1) % hole.outline.length];
    if (y >= Math.min(a[1], b[1]) && y < Math.max(a[1], b[1]))
      crossings.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
  }
  return crossings.length ? { left: Math.min(...crossings), right: Math.max(...crossings) } : null;
}

export function createNorthWallGeometry(openings, minY, maxY) {
  const shape = new THREE.Shape();
  shape.moveTo(W.minX, minY); shape.lineTo(W.maxX, minY);
  shape.lineTo(W.maxX, maxY); shape.lineTo(W.minX, maxY); shape.closePath();
  for (const hole of openings) {
    if (!hole.outline || hole.top <= minY || hole.bottom >= maxY) continue;
    if (hole.bottom < minY || hole.top > maxY) throw new RangeError('North aperture crosses a facade boundary');
    const path = new THREE.Path();
    hole.outline.forEach(([x, y], index) => index ? path.lineTo(x, y) : path.moveTo(x, y));
    path.closePath(); shape.holes.push(path);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .5, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, W.minZ - .25);
  return geometry;
}

export function createNorthWallMaterial() {
  const width = 1024, height = 512, pixels = new Uint8Array(width * height * 4);
  let seed = 19371027;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const scars = Array.from({ length: 720 }, (_, index) => {
    const cluster = index % 4;
    return { x: [.27, .49, .63, .83][cluster] + (random() - .5) * .19,
      y: .54 + random() * .36, r: .0008 + random() * .0023 };
  });
  const patches = [[.17,.9,.025,.02],[.22,.81,.018,.035],[.39,.84,.022,.03],
    [.66,.96,.027,.02],[.71,.89,.06,.065],[.79,.78,.045,.04],[.85,.64,.035,.035],[.93,.89,.024,.025]];
  const edgeDistance = (x, y, outline) => {
    let distance = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = THREE.MathUtils.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0, 1);
      distance = Math.min(distance, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
    }
    return distance;
  };
  for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
    const u = column / (width - 1), v = row / (height - 1), x = W.maxX - u * W.width, y = v * W.roofY;
    const grain = random() * 9, streak = Math.sin(u * 19 + v * 5) * 3 +
      Math.sin(u * 37 - v * 13) * 2 + Math.sin(column * .12) * .6;
    let color = [164 - grain + streak, 158 - grain + streak, 141 - grain + streak];
    const top = 9.8 + .6 * Math.sin(u * 29) + .4 * Math.sin(u * 71);
    const bottom = 1.8 + .35 * Math.sin(u * 35);
    const field = u > .15 + .012 * Math.sin(v * 73) && u < .86 + .012 * Math.sin(v * 89) && y > bottom && y < top;
    const pier = Math.abs(((u - .2) % .1 + .1) % .1 - .05) > .044;
    const beam = Math.abs(y - 4.5) < .22 || Math.abs(y - 8.4) < .2;
    let spall = false;
    for (const [px, py, rx, ry] of patches) {
      if (((u - px) / rx) ** 2 + ((v - py) / ry) ** 2 <
        .85 + .15 * Math.sin(column * .13) + .1 * Math.sin(row * .31)) spall = true;
    }
    for (const hole of SIHANG_NORTH_APERTURES) {
      if (Math.abs(x - hole.u) > hole.width / 2 + 1 || y < hole.bottom - 1 || y > hole.top + 1) continue;
      if (edgeDistance(x, y, hole.outline) < .28 + .15 * Math.sin(column * .2 + row * .4)) spall = true;
    }
    if (field && !pier && !beam || spall) {
      const course = Math.floor(y / .115), horizontal = ((y / .115) % 1) < .12;
      const vertical = (((x / .32 + course % 2 * .5) % 1 + 1) % 1) < .08;
      color = horizontal || vertical ? [134 - grain, 126 - grain, 109 - grain]
        : [136 - grain, 99 - grain, 77 - grain];
    }
    const damp = Math.max(0, 1 - y / 1.5) * 22;
    pixels.set([color[0] - damp, color[1] - damp, color[2] - damp, 255], (row * width + column) * 4);
  }
  for (const scar of scars) {
    const x = Math.round(scar.x * width), y = Math.round(scar.y * height), radius = Math.max(1, Math.round(scar.r * width));
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
      const coverage = THREE.MathUtils.clamp(radius + .5 - Math.hypot(dx, dy), 0, 1);
      const color = dx * dx + dy * dy > radius * radius * .5 ? [122, 113, 96] : [59, 56, 48];
      const offset = ((y + dy) * width + x + dx) * 4;
      for (let channel = 0; channel < 3; channel++)
        pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - coverage) + color[channel] * coverage);
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  texture.anisotropy = 4; texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: .98 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vNorthWall;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvNorthWall=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vNorthWall;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
        diffuseColor *= texture2D(map, vec2((${W.maxX.toFixed(1)}-vNorthWall.x)/${W.width.toFixed(1)},
          vNorthWall.y/${W.roofY.toFixed(1)}));
      #endif`);
  };
  material.customProgramCacheKey = () => 'sihang-reference-north-wall-v1';
  return material;
}
