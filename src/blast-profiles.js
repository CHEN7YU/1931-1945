// Prototype gameplay/presentation balance, not historical explosive specifications.
export const BLAST_PROFILES = Object.freeze(Object.fromEntries(Object.entries({
  grenade: { damage: 180, radius: 7, scale: 1.65, impulse: .42, reach: 25, duration: .65, flash: .24, ringing: 1.8 },
  mortar: { damage: 210, radius: 8, scale: 2.15, impulse: .7, reach: 36, duration: .95, flash: .32, ringing: 2.8 },
  'grenade-discharger': { damage: 210, radius: 8, scale: 2.15, impulse: .7, reach: 36, duration: .95, flash: .32, ringing: 2.8 },
  'explosive-pack': { damage: 240, radius: 9, scale: 2.8, impulse: 1, reach: 48, duration: 1.3, flash: .42, ringing: 4 },
  'aircraft-bomb': { damage: 320, radius: 17, scale: 6.5, impulse: 1.4, reach: 78, duration: 1.65, flash: .65, ringing: 4 },
}).map(([kind, profile]) => [kind, Object.freeze(profile)])));

export function blastProfile(style) { return BLAST_PROFILES[style] ?? null; }

export function blastExposure(position, listener, style = 'grenade') {
  const profile = blastProfile(style);
  if (!profile) return { strength: 0, flash: 0, duration: 0, ringing: 0 };
  if (![position, listener].every(point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis])))) {
    throw new RangeError('Blast exposure requires finite world positions');
  }
  const distance = Math.hypot(position.x - listener.x, position.y - listener.y, position.z - listener.z);
  const attenuation = Math.max(0, 1 - distance / profile.reach) ** 2;
  return { strength: profile.impulse * attenuation, flash: profile.flash * attenuation,
    duration: profile.duration, ringing: profile.ringing, distance };
}
