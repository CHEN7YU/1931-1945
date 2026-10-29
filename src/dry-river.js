import * as THREE from 'three';
import { BRIDGE, RIVER, riverBedHeight, riverSectionAt } from './ground.js';
import { valueNoise2D } from './value-noise.js';

export function sedimentDepositAt(x, z) {
  return valueNoise2D(x * .27 + 73, z * .27 - 29) * .65 +
    valueNoise2D(x * .8 - 41, z * .8 + 53) * .35;
}

export function dryRiverGeometry() {
  const geometry = new THREE.PlaneGeometry(800, RIVER.bankHalfWidth * 2, 800, 56);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, RIVER.centerZ);
  const positions = geometry.attributes.position, colors = [];
  const sand = new THREE.Color(0xd2c3a6), silt = new THREE.Color(0x95836b);
  const bank = new THREE.Color(0x795b43), color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), section = riverSectionAt(x);
    const across = Math.abs(z - section.centerZ);
    const edge = Math.max(0, Math.min(1, (across - section.bedHalfWidth) / (section.bankHalfWidth - section.bedHalfWidth)));
    const deposit = sedimentDepositAt(x, z);
    color.copy(silt).lerp(sand, Math.max(0, Math.min(1, (deposit - .28) * 1.8))).lerp(bank, edge * edge);
    colors.push(color.r, color.g, color.b);
    positions.setY(i, riverBedHeight(x, z) - .035);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function dryRiverDetails() {
  let seed = 3918;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const stones = [], grass = [], silt = [];
  let barX = 0, barZ = 0;
  for (let i = 0; i < 600; i++) {
    if (i % 9 === 0) {
      barX = (random() - .5) * 216;
      const section = riverSectionAt(barX);
      barZ = section.centerZ + (random() - .5) * section.bankHalfWidth * 1.5;
    }
    const x = barX + (random() - .5) * 1.7, z = barZ + (random() - .5) * 1.1;
    const section = riverSectionAt(x), across = z - section.centerZ;
    if (x > BRIDGE.minX - 2 && x < BRIDGE.maxX + 2) continue;
    const y = riverBedHeight(x, z) - .035;
    const size = .025 + random() ** 2 * .13;
    stones.push({ x, y, z, size, stretch: 1 + random() * .55, angle: random() * Math.PI, shade: random() });
    if (i % 3 === 0 && Math.abs(across) > section.bedHalfWidth + .4) {
      grass.push({ x, y, z, height: .16 + random() * .35, angle: random() * Math.PI });
    }
    if (i % 7 === 0 && Math.abs(across) < section.bedHalfWidth) {
      silt.push({ x, z, width: .9 + random() * 1.7, depth: .8 + random() * 1.5, angle: random() * Math.PI });
    }
  }
  return { stones, grass, silt };
}

export function crackedSiltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  let seed = 1931;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const sites = Array.from({ length: 64 }, (_, i) => ({
    x: (i % 8 + .15 + random() * .7) * 32,
    y: (Math.floor(i / 8) + .15 + random() * .7) * 32,
  }));
  const image = context.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    let first = Infinity, second = Infinity;
    for (const site of sites) {
      const d = Math.hypot(x - site.x, y - site.y);
      if (d < first) { second = first; first = d; }
      else if (d < second) second = d;
    }
    const edge = Math.max(0, 1 - Math.hypot((x - 128) / 128, (y - 128) / 128));
    const index = (y * 256 + x) * 4;
    image.data[index] = 68; image.data[index + 1] = 55; image.data[index + 2] = 39;
    image.data[index + 3] = (10 + Math.max(0, 1 - (second - first) / 2.2) * 175) * Math.min(1, edge * 5);
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function siltPatchGeometry(patch) {
  const geometry = new THREE.PlaneGeometry(patch.width, patch.depth, 12, 8);
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(patch.angle);
  geometry.translate(patch.x, 0, patch.z);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, riverBedHeight(positions.getX(i), positions.getZ(i)) - .019);
  }
  geometry.computeVertexNormals();
  return geometry;
}
