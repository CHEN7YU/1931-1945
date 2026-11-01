export const AI_TURN = Object.freeze({ standingRate: 4.2, movingRate: 3.3, brakeAngle: .65, resumeAngle: .12, fireAngle: .07 });
export const headingError = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function advanceAITurn(actor, desired, dt, moving = false) {
  if (![actor?.heading, desired, dt].every(Number.isFinite) || dt < 0 || typeof moving !== 'boolean') {
    throw new RangeError('AI turning requires finite owned heading, destination and timestep');
  }
  const delta = headingError(actor.heading, desired), rate = moving ? AI_TURN.movingRate : AI_TURN.standingRate;
  if (dt === 0) return { step: 0, remaining: Math.abs(delta), facing: Math.abs(delta) <= AI_TURN.fireAngle, mayMove: !actor.turningToPath,
    moveScale: Math.max(.35, Math.cos(delta)), direction: { x: -Math.sin(actor.heading), z: -Math.cos(actor.heading) } };
  const step = Math.max(-rate * dt, Math.min(rate * dt, delta));
  actor.heading = headingError(0, actor.heading + step);
  const remaining = Math.abs(headingError(actor.heading, desired));
  if (moving) actor.turningToPath = actor.turningToPath ? remaining > AI_TURN.resumeAngle : Math.abs(delta) > AI_TURN.brakeAngle;
  else actor.turningToPath = false;
  return { step, remaining, facing: remaining <= AI_TURN.fireAngle, mayMove: !actor.turningToPath,
    moveScale: Math.max(.35, Math.cos(remaining)), direction: { x: -Math.sin(actor.heading), z: -Math.cos(actor.heading) } };
}
