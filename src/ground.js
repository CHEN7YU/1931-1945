import { craterHeight } from './war-damage-layout.js';
import { createWalkSupport } from './multistory.js';
import { valueNoise2D } from './value-noise.js';

let support = createWalkSupport([], groundHeight);

export function configureWalkSupport(pieces, terrain = groundHeight) {
  support = createWalkSupport(pieces, terrain);
  return support;
}

export function walkHeight(x, z, referenceY) {
  return support.heightAt(x, z, referenceY);
}

export const BRIDGE = Object.freeze({ minX: 0, maxX: 16, minZ: -22.5, maxZ: -9.5, height: .45, rampLength: 4 });
export const RIVER = Object.freeze({ centerZ: -16, bankHalfWidth: 7, bedHalfWidth: 3,
  bedHeight: -.85, dry: true });

const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function riverSectionAt(x) {
  // Keep the bridge abutments fixed and all erosion inside the existing quay streets.
  const natural = smooth((Math.abs(x - 8) - 12) / 22);
  return {
    centerZ: RIVER.centerZ + natural * (.38 * Math.sin(x * .071) + .21 * Math.sin(x * .173 + 1.4)),
    bankHalfWidth: RIVER.bankHalfWidth - natural * (.85 + .22 * Math.sin(x * .093 + .8)),
    bedHalfWidth: RIVER.bedHalfWidth - natural * (.55 + .3 * Math.sin(x * .12)),
    bedHeight: RIVER.bedHeight + natural * .045 * Math.sin(x * .19 + .7),
  };
}

export function riverBedHeight(x, z) {
  const section = riverSectionAt(x);
  const across = z - section.centerZ, distance = Math.abs(across);
  if (distance >= section.bankHalfWidth) return 0;
  const bank = smooth((distance - section.bedHalfWidth) / (section.bankHalfWidth - section.bedHalfWidth));
  const channel = .045 * (valueNoise2D(x * .7 + 31, z * .7 - 17) - .5) *
    Math.sin(distance / section.bankHalfWidth * Math.PI) ** 2;
  return section.bedHeight * (1 - bank) + channel * (1 - bank);
}

export function groundHeight(x, z) {
  return bridgeGroundHeight(x, z, BRIDGE);
}

export function bridgeGroundHeight(x, z, bridge) {
  const terrain = riverBedHeight(x, z) + craterHeight(x, z);
  if (x < bridge.minX || x > bridge.maxX) return terrain;
  if (z >= bridge.minZ && z <= bridge.maxZ) return bridge.height;
  if (z > bridge.maxZ && z < bridge.maxZ + bridge.rampLength) {
    return bridge.height * (bridge.maxZ + bridge.rampLength - z) / bridge.rampLength;
  }
  if (z < bridge.minZ && z > bridge.minZ - bridge.rampLength) {
    return bridge.height * (z - bridge.minZ + bridge.rampLength) / bridge.rampLength;
  }
  return terrain;
}
