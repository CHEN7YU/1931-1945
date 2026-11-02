export const CIVILIAN_PANIC_RADIUS = 26;
export const CIVILIAN_PANIC_MEMORY = 1.5;
export const CIVILIAN_ESCAPE_SPEED = Object.freeze({
  adult: Object.freeze({ urgent: 2.7, panicked: 4 }),
  child: Object.freeze({ urgent: 2.35, panicked: 3.4 }),
  elderly: Object.freeze({ urgent: 2.1, panicked: 2.9 }),
});

export function civilianEscapeSpeed(ageGroup, panicked) {
  const pace = CIVILIAN_ESCAPE_SPEED[ageGroup];
  if (!pace || typeof panicked !== 'boolean') throw new TypeError('Civilian speed requires an age group and panic state');
  return panicked ? pace.panicked : pace.urgent;
}

export function isCivilianNearCombat(position, sounds, now) {
  if (!position || ![position.x, position.y, position.z].every(Number.isFinite) ||
    !Number.isFinite(now) || !Array.isArray(sounds)) {
    throw new TypeError('Civilian fear requires a finite position, time and sound history');
  }
  return sounds.some(sound => sound && Number.isFinite(sound.time) &&
    now >= sound.time && now - sound.time <= CIVILIAN_PANIC_MEMORY &&
    [sound.x, sound.y, sound.z].every(Number.isFinite) &&
    Math.hypot(sound.x - position.x, sound.y - position.y, sound.z - position.z) <= CIVILIAN_PANIC_RADIUS);
}

export function frightenCivilian(civilian, position, sounds, now) {
  if (!civilian) throw new TypeError('Civilian panic requires an actor');
  if (civilian.panicked || !isCivilianNearCombat(position, sounds, now)) return false;
  civilian.panicked = true;
  civilian.panicStartedAt = now;
  return true;
}
