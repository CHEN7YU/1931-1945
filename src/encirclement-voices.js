export function createEncirclementVoiceTracker() {
  let briefed = false, interrupted = false, phase = 1;
  const arrived = new Set();
  return {
    update(match, points, formations) {
      if (match.winner) return [];
      const supply = points.find(point => point.id === 'A');
      if (!supply) throw new Error('Encirclement voice requires the supply objective');
      const cues = [];
      if (!briefed && match.phase === 1 && supply.owner !== 'friendly') {
        cues.push('supply-brief'); briefed = true;
      }
      if (match.phase === 1 && match.supplyInterrupted !== interrupted) {
        cues.push(match.supplyInterrupted ? 'supply-cut' : 'supply-restored');
      }
      interrupted = match.supplyInterrupted;
      const newArrivals = formations.filter(unit => unit.team === 'friendly' && unit.reinforcement &&
        unit.active && unit.generation > 0 && !arrived.has(unit.id));
      for (const unit of newArrivals) arrived.add(unit.id);
      if (newArrivals.length) cues.push(match.supplyInterrupted ? 'supply-reinforced' : 'reinforcements');
      if (phase === 1 && match.phase === 2) cues.push('encircled', 'reinforcements-blocked', 'cleanup-orders');
      phase = match.phase;
      return cues;
    },
    reset() { briefed = interrupted = false; phase = 1; arrived.clear(); },
  };
}
