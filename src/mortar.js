import { BLAST_PROFILES } from './blast-profiles.js';

export const MORTAR = Object.freeze({ minRange: 50, maxRange: 250, ammo: 12, setupSeconds: 1.5, reloadSeconds: 3.2,
  damage: BLAST_PROFILES.mortar.damage, radius: BLAST_PROFILES.mortar.radius, blastKind: 'mortar' });

export function createMortar() {
  return { ammo: MORTAR.ammo, phase: 'carrying', setupUntil: 0, nextShot: 0, distance: 100, anchor: null };
}

export function mortarPlacement(position, heading) {
  if (![position.x, position.y, position.z, heading].every(Number.isFinite)) throw new RangeError('Mortar placement requires a finite ground pose');
  return { x: position.x - Math.sin(heading) * .85, y: position.y, z: position.z - Math.cos(heading) * .85 };
}

export function mortarTarget(position, heading, distance, heightAt) {
  if (![position.x, position.z, heading, distance].every(Number.isFinite) || typeof heightAt !== 'function' ||
    distance < MORTAR.minRange || distance > MORTAR.maxRange) throw new RangeError('Mortar target requires a valid 50–250m range');
  const x = position.x - Math.sin(heading) * distance, z = position.z - Math.cos(heading) * distance;
  return { x, z, y: heightAt(x, z) + .15 };
}

export function stowMortar(state) {
  state.phase = 'carrying'; state.setupUntil = 0; state.anchor = null;
}

export function adjustMortarRange(state, mouseY) {
  if (!Number.isFinite(mouseY) || !Number.isFinite(state.distance)) throw new RangeError('Mortar range adjustment requires finite mouse input and distance');
  if (state.phase !== 'ready') return;
  state.distance = Math.max(MORTAR.minRange, Math.min(MORTAR.maxRange, state.distance - mouseY * .5));
}

export function mortarObjectiveRanges(position, heading, objectives) {
  if (![position?.x, position?.z, heading].every(Number.isFinite) ||
    objectives.some(point => ![point.x, point.z].every(Number.isFinite))) {
    throw new RangeError('Mortar objective distances require finite position and heading');
  }
  return objectives.map(point => {
    const dx = point.x - position.x, dz = point.z - position.z;
    const distance = Math.hypot(dx, dz);
    const bearing = Math.atan2(-dx, -dz);
    const angle = Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading));
    return { id: point.id, name: point.name, distance, angle,
      inRange: distance >= MORTAR.minRange && distance <= MORTAR.maxRange,
      centered: distance > 0 && Math.abs(angle) <= .06 };
  });
}
