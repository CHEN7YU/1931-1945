export const POSTURE_TRANSITION = Object.freeze({ lowerSeconds: 1, riseSeconds: 1.3, kneeFraction: .42 });
const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

export function advancePostureBlend(motion, target, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Posture transitions require finite non-negative time');
  if (dt === 0) return;
  const weights = motion.posture, prone = weights.prone ?? 0;
  let transition = motion.postureTransition;
  if (transition?.target !== target && (transition || target === 'prone' && prone < .999 || prone > .001 && target !== 'prone')) {
    transition = motion.postureTransition = { target, elapsed: 0, from: { ...weights },
      duration: target === 'prone' ? POSTURE_TRANSITION.lowerSeconds : POSTURE_TRANSITION.riseSeconds,
      knee: motion.profile.kneeling ? 'kneeling' : motion.profile.crouched ? 'crouched' : null,
      viaKnee: target === 'prone' ? prone < .001 : prone > .001 };
  } else if (transition && transition.target !== target) {
    transition = motion.postureTransition = null;
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
  const t = transition.elapsed / transition.duration;
  const viaKnee = transition.viaKnee && transition.knee;
  const split = target === 'prone' ? POSTURE_TRANSITION.kneeFraction : 1 - POSTURE_TRANSITION.kneeFraction;
  const first = viaKnee && t < split;
  const blend = smooth(viaKnee ? first ? t / split : (t - split) / (1 - split) : t);
  for (const pose of Object.keys(weights)) {
    const from = !viaKnee || first ? transition.from[pose] : Number(pose === transition.knee);
    const to = first ? Number(pose === transition.knee) : Number(pose === target && Boolean(motion.profile[pose]));
    weights[pose] = from + (to - from) * blend;
  }
  if (t === 1) motion.postureTransition = null;
}
