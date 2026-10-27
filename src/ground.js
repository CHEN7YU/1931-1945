import { craterHeight } from './war-damage-layout.js';

export const BRIDGE = Object.freeze({ minX: 0, maxX: 16, minZ: -22.5, maxZ: -9.5, height: .45, rampLength: 4 });

export function groundHeight(x, z) {
  if (x < BRIDGE.minX || x > BRIDGE.maxX) return craterHeight(x, z);
  if (z >= BRIDGE.minZ && z <= BRIDGE.maxZ) return BRIDGE.height;
  if (z > BRIDGE.maxZ && z < BRIDGE.maxZ + BRIDGE.rampLength) {
    return BRIDGE.height * (BRIDGE.maxZ + BRIDGE.rampLength - z) / BRIDGE.rampLength;
  }
  if (z < BRIDGE.minZ && z > BRIDGE.minZ - BRIDGE.rampLength) {
    return BRIDGE.height * (z - BRIDGE.minZ + BRIDGE.rampLength) / BRIDGE.rampLength;
  }
  return craterHeight(x, z);
}
