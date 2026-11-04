export function missionTargets({ map, stage, phase, objectives, player, eastGate }) {
  if (!Array.isArray(objectives)) throw new TypeError('Mission targets require objective data');
  if (map === 'nanjing') {
    const gate = stage === 'gate-defense', point = objectives.find(point => point.id === (gate ? 'gate' : 'dock'));
    return point ? [{ ...point, primary: true, label: gate ? '门' : '渡',
      shortName: gate ? '中华门' : '上新河渡口', color: gate || stage === 'dock-defense' ? '#8bd5ff' : '#ffdc7f' }] : [];
  }
  if (map === 'taierzhuang-fort' && phase === 2) {
    if (!eastGate) throw new Error('Breakout mission requires its actual gate');
    return [{ id: 'east-gate', x: eastGate.x, z: eastGate.z, primary: true,
      label: '东门', shortName: '东门阻击', color: '#8bd5ff' }];
  }
  const pending = objectives.filter(point => point.owner !== 'friendly');
  const distance = point => player ? Math.hypot(point.x - player.x, point.z - player.z) : 0;
  const primary = pending.find(point => point.id === 'A') ??
    [...pending].sort((a, b) => distance(a) - distance(b))[0];
  return pending.map(point => ({ ...point, primary: point === primary, label: point.id,
    shortName: `夺取 ${point.id}`, color: '#ffdc7f' }));
}
