import { craterHeight } from './war-damage-layout.js';
import { createWalkSupport } from './multistory.js';

let support = createWalkSupport([], groundHeight);

export function configureWalkSupport(pieces) {
  support = createWalkSupport(pieces, groundHeight);
  return support;
}

export function walkHeight(x, z, referenceY) {
  return support.heightAt(x, z, referenceY);
}

export const BRIDGE = Object.freeze({ minX: 0, maxX: 16, minZ: -22.5, maxZ: -9.5, height: .45, rampLength: 4 });
export const RIVER = Object.freeze({ centerZ: -16, bankHalfWidth: 7, bedHalfWidth: 3,
  bedHeight: -.85, waterHeight: -.35, infantrySpeed: .65, tankSpeed: .7 });

export function riverBedHeight(z) {
  const distance = Math.abs(z - RIVER.centerZ);
  if (distance >= RIVER.bankHalfWidth) return 0;
  if (distance <= RIVER.bedHalfWidth) return RIVER.bedHeight;
  return RIVER.bedHeight * (RIVER.bankHalfWidth - distance) / (RIVER.bankHalfWidth - RIVER.bedHalfWidth);
}

export function waterDepth(x, z, feetY = groundHeight(x, z)) {
  return Math.abs(z - RIVER.centerZ) < RIVER.bankHalfWidth ? Math.max(0, RIVER.waterHeight - feetY) : 0;
}

export function groundHeight(x, z) {
  const terrain = riverBedHeight(z) + craterHeight(x, z);
  if (x < BRIDGE.minX || x > BRIDGE.maxX) return terrain;
  if (z >= BRIDGE.minZ && z <= BRIDGE.maxZ) return BRIDGE.height;
  if (z > BRIDGE.maxZ && z < BRIDGE.maxZ + BRIDGE.rampLength) {
    return BRIDGE.height * (BRIDGE.maxZ + BRIDGE.rampLength - z) / BRIDGE.rampLength;
  }
  if (z < BRIDGE.minZ && z > BRIDGE.minZ - BRIDGE.rampLength) {
    return BRIDGE.height * (z - BRIDGE.minZ + BRIDGE.rampLength) / BRIDGE.rampLength;
  }
  return terrain;
}
