export const TINNITUS_CANDIDATES = Object.freeze([
  Object.freeze({ id: 'A', title: 'Soft single ring', frequencies: [1800], levels: [1], attack: .18, decay: 2.2 }),
  Object.freeze({ id: 'B', title: 'Thin high ring', frequencies: [2900, 2940], levels: [.75, .25], attack: .24, decay: 2 }),
  Object.freeze({ id: 'C', title: 'Low muted ring', frequencies: [1050, 2100], levels: [.85, .15], attack: .28, decay: 2.6 }),
]);

export function tinnitusCandidateSamples(id, sampleRate = 48000, seconds = 7) {
  const preset = TINNITUS_CANDIDATES.find(candidate => candidate.id === id);
  if (!preset || !Number.isInteger(sampleRate) || sampleRate < 8000 || !Number.isFinite(seconds) || seconds < 1)
    throw new RangeError('Tinnitus preview requires a known candidate, sample rate and duration');
  const result = new Float32Array(Math.ceil(sampleRate * seconds));
  for (let index = 0; index < result.length; index++) {
    const time = index / sampleRate - .6;
    if (time <= 0) continue;
    const onset = Math.min(1, time / preset.attack);
    const end = Math.min(1, (seconds - index / sampleRate) / .4);
    const envelope = onset * onset * (3 - 2 * onset) * Math.exp(-time / preset.decay) * end * end;
    let value = 0;
    for (let tone = 0; tone < preset.frequencies.length; tone++)
      value += Math.sin(2 * Math.PI * preset.frequencies[tone] * time) * preset.levels[tone];
    result[index] = value * envelope * .035;
  }
  return result;
}
