export const SQUAD_BOUND = Object.freeze({ metres: 4, maximumSeconds: 6, regroupSeconds: 1.5, observationSeconds: 2 });

export function squadBoundDecision(actor, now, controlledId = null) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Squad coordination requires simulation time');
  const formation = actor.formation;
  const people = (formation?.members ?? []).filter(person => person.health > 0 && person.id !== controlledId &&
    !person.vehicleId && !person.emplacementId && !person.formation?.sihangDemolition &&
    !person.supportWeaponPose?.active).sort((a, b) => a.index - b.index);
  const observed = people.filter(person => person.tactics?.threatSense === 'vision' &&
    Number.isFinite(person.tactics.observedAt) && now - person.tactics.observedAt <= SQUAD_BOUND.observationSeconds);
  if (!formation || formation.type !== 'infantry' || people.length < 4 || !observed.length)
    return { hold: false, role: 'independent' };
  const membership = people.map(person => person.id).join('|');
  let state = formation.coordination;
  if (!state || state.membership !== membership) {
    state = formation.coordination = { membership, movingElement: 1, startedAt: now, cooldownUntil: 0,
      completedBounds: state?.completedBounds ?? 0, regroupings: (state?.regroupings ?? 0) + 1,
      origins: Object.fromEntries(people.map(person => [person.id, { x: person.position.x, z: person.position.z }])) };
  }
  if (now < state.cooldownUntil) return { hold: false, role: 'regroup', completedBounds: state.completedBounds };
  const element = person => people.indexOf(person) % 2;
  const moving = people.filter(person => element(person) === state.movingElement);
  const arrived = person => Math.hypot(person.position.x - state.origins[person.id].x,
    person.position.z - state.origins[person.id].z) >= SQUAD_BOUND.metres ||
    person.tactics?.enteredCover && person.locomotion?.speed <= .1 && person.rifleReady;
  if (now - state.startedAt > .5 && moving.every(arrived)) {
    state.movingElement = 1 - state.movingElement;
    state.startedAt = now; state.completedBounds++;
    state.origins = Object.fromEntries(people.map(person => [person.id, { x: person.position.x, z: person.position.z }]));
  } else if (now - state.startedAt >= SQUAD_BOUND.maximumSeconds) {
    state.startedAt = now;
    state.cooldownUntil = now + SQUAD_BOUND.regroupSeconds;
    state.origins = Object.fromEntries(people.map(person => [person.id, { x: person.position.x, z: person.position.z }]));
    return { hold: false, role: 'regroup', completedBounds: state.completedBounds };
  }
  const covering = people.filter(person => element(person) !== state.movingElement);
  const guardReady = covering.some(person => person.rifleReady && person.locomotion?.speed <= .1 && observed.includes(person));
  const origin = state.origins[actor.id];
  if (!origin) return { hold: false, role: 'independent' };
  const isMoving = element(actor) === state.movingElement, distance = Math.hypot(actor.position.x - origin.x, actor.position.z - origin.z);
  return { hold: !isMoving || !guardReady || distance >= SQUAD_BOUND.metres,
    role: isMoving ? guardReady ? 'bound' : 'await-cover' : 'cover',
    distance, element: element(actor), movingElement: state.movingElement, completedBounds: state.completedBounds };
}
