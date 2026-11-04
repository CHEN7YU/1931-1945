export const POSTURE_TRANSITION = Object.freeze({
  lowerSeconds: 1, riseSeconds: 1.6, kneeFraction: .42, crouchRiseSeconds: .95, crouchLowerSeconds: .55,
});
const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function advancePostureBlend(motion, target, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Posture transitions require finite non-negative time');
  if (dt === 0) return;
  const weights = motion.posture, prone = weights.prone ?? 0;
  let transition = motion.postureTransition;
  const lowered = (weights.crouched ?? 0) + (weights.kneeling ?? 0);
  const changingHeight = target === 'prone' && prone < .999 || prone > .001 && target !== 'prone' ||
    target === 'standing' && lowered > .001 ||
    ['crouched', 'kneeling'].includes(target) && weights[target] < .999;
  if (transition?.target !== target && (transition || changingHeight)) {
    const from = { ...weights }, pose = name => Object.fromEntries(Object.keys(weights)
      .map(key => [key, Number(key === name && Boolean(motion.profile[key]))]));
    const destination = pose(target), knee = pose(motion.profile.kneeling ? 'kneeling' : 'crouched');
    let duration, frames;
    if (target === 'prone') {
      duration = POSTURE_TRANSITION.lowerSeconds;
      frames = prone < .001 ? [[0, from], [.42, knee], [.50, knee], [1, destination]] : [[0, from], [1, destination]];
    } else if (prone > .001) {
      duration = POSTURE_TRANSITION.riseSeconds;
      const half = Object.fromEntries(Object.keys(weights).map(key => [key, knee[key] * .42 + destination[key] * .58]));
      frames = [[0, from], [.45, knee], [.54, knee], [.78, half], [.87, half], [1, destination]];
    } else if (target === 'standing') {
      duration = POSTURE_TRANSITION.crouchRiseSeconds;
      const half = Object.fromEntries(Object.entries(from).map(([key, weight]) => [key, weight * .42]));
      frames = [[0, from], [.48, half], [.62, half], [1, destination]];
    } else {
      duration = POSTURE_TRANSITION.crouchLowerSeconds;
      frames = [[0, from], [.82, destination], [1, destination]];
    }
    transition = motion.postureTransition = { target, elapsed: 0, duration, frames };
  }
  if (!transition) {
    for (const pose of Object.keys(weights)) {
      const desired = pose === target && motion.profile[pose] ? 1 : 0;
      weights[pose] += (desired - weights[pose]) * (1 - Math.exp(-dt / .10));
      if (weights[pose] < .001) weights[pose] = 0;
      if (weights[pose] > .999) weights[pose] = 1;
    }
    return;
  }
  transition.elapsed = Math.min(transition.duration, transition.elapsed + dt);
  const t = transition.elapsed / transition.duration, frames = transition.frames;
  const index = Math.max(0, frames.findIndex((frame, index) => index < frames.length - 1 && t <= frames[index + 1][0]));
  const [start, from] = frames[index], [end, to] = frames[index + 1];
  const blend = smooth((t - start) / (end - start));
  for (const pose of Object.keys(weights)) weights[pose] = from[pose] + (to[pose] - from[pose]) * blend;
  if (t === 1) motion.postureTransition = null;
}
