export function benchmarkConfig(search, development) {
  if (!development) return null;
  const params = new URLSearchParams(search);
  if (!params.has('benchmark')) return null;
  const scenario = params.get('benchmark');
  if (!['duel', 'full', 'bridge', 'interior', 'control', 'ford'].includes(scenario)) throw new RangeError('Unknown development benchmark scenario');
  const value = params.get('seed') ?? '1938';
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 0xffffffff) throw new RangeError('Benchmark seed must be an unsigned 32-bit integer');
  return Object.freeze({ scenario, seed: Number(value), diagnostic: scenario !== 'full' });
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function diagnosticRoster(scenario = 'duel') {
  if (!['duel', 'bridge', 'interior', 'control', 'ford'].includes(scenario)) throw new RangeError('Unknown diagnostic roster');
  if (scenario === 'ford') return [
    { id: 'friendly-0', team: 'friendly', index: 0, type: 'tank', player: true, members: [], memberCount: 3,
      generation: 0, respawnAt: null, spawnId: 'diagnostic-ford' },
  ];
  if (scenario === 'control') return [
    { id: 'friendly-0', team: 'friendly', index: 0, type: 'tank', player: true, members: [], memberCount: 3, generation: 0, respawnAt: null, spawnId: 'diagnostic-tank' },
    ...[1, 2].map(index => ({ id: `friendly-${index}`, team: 'friendly', index, type: 'infantry', player: false, members: [], memberCount: 2, generation: 0, respawnAt: null, spawnId: `diagnostic-friendly-${index}` })),
    { id: 'enemy-0', team: 'enemy', index: 0, type: 'infantry', player: false, members: [], memberCount: 3, generation: 0, respawnAt: null, spawnId: 'diagnostic-enemy' },
  ];
  const teams = ['bridge', 'interior'].includes(scenario) ? ['friendly'] : ['friendly', 'enemy'];
  return teams.map(team => ({ id: `${team}-0`, team, index: 0, type: 'infantry',
    player: team === 'friendly', members: [], memberCount: 5, generation: 0, respawnAt: null,
    spawnId: `diagnostic-${team}` }));
}

export function diagnosticSpawns(scenario = 'duel') {
  if (scenario === 'ford') return [
    { id: 'diagnostic-ford', name: '浅河坦克通行诊断点', team: 'friendly', kind: 'garage', x: -48, z: -6, altitude: 0 },
  ];
  if (scenario === 'interior') return [
    { id: 'diagnostic-friendly', name: '门与室内几何诊断点', team: 'friendly', kind: 'base', x: 0, z: 78, altitude: 0 },
  ];
  if (scenario === 'control') return [
    // The existing east shop covers the exit during extended crew-control checks.
    { id: 'diagnostic-tank', name: 'G2坦克集结点', team: 'friendly', kind: 'garage', x: 10, z: 83, altitude: 0 },
    { id: 'diagnostic-friendly-1', name: 'G2独立友军一', team: 'friendly', kind: 'base', x: -20, z: 78, altitude: 0, aiOnly: true },
    { id: 'diagnostic-friendly-2', name: 'G2独立友军二', team: 'friendly', kind: 'base', x: 20, z: 78, altitude: 0, aiOnly: true },
    { id: 'diagnostic-enemy', name: 'G2敌军集结点', team: 'enemy', kind: 'base', x: 0, z: 16, altitude: 0 },
  ];
  if (scenario === 'bridge') return [
    { id: 'diagnostic-friendly', name: '桥面支撑诊断集结点', team: 'friendly', kind: 'base', x: 8, z: -3, altitude: 0 },
  ];
  if (scenario !== 'duel') throw new RangeError('Unknown diagnostic spawn layout');
  return [
    { id: 'diagnostic-friendly', name: '诊断南侧集结点', team: 'friendly', kind: 'base', x: 0, z: 46, altitude: 0 },
    { id: 'diagnostic-enemy', name: '诊断北侧集结点', team: 'enemy', kind: 'base', x: 0, z: 16, altitude: 0 },
  ];
}

export function createFrameTelemetry(enabled, capacity = 8192) {
  const frames = new Array(capacity);
  let serial = 0, frame = null;
  return {
    enabled,
    begin(now, intervalMs, simulatedDt) {
      if (!enabled) return;
      frame = { serial: ++serial, now, intervalMs, simulatedDt, aiMs: 0, pathMs: 0, coverMs: 0, sensingMs: 0,
        playerMs: 0, doorsMs: 0, effectsMs: 0, hudMs: 0, instancesMs: 0, renderMs: 0, cpuMs: 0 };
    },
    add(name, duration) { if (frame) frame[name] = (frame[name] || 0) + duration; },
    end(details) {
      if (!frame) return;
      Object.assign(frame, details);
      frames[(serial - 1) % capacity] = frame;
      frame = null;
    },
    reset() { frames.fill(undefined); serial = 0; frame = null; },
    get snapshot() {
      const count = Math.min(serial, capacity);
      return { totalFrames: serial, capacity, frames: Array.from({ length: count }, (_, i) => ({ ...frames[(serial - count + i) % capacity] })) };
    },
  };
}
// ---模块结束---
