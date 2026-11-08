export const PERFORMANCE_SCHEMA_VERSION = 1;
export const FRAME_BUCKETS_MS = Object.freeze([8, 12, 16.7, 20, 25, 33.4, 50, 66.7, 100, 150, 250, 500, 1000, 5000, 60000]);
export const PERFORMANCE_SCOPES = Object.freeze([
  'doors', 'vehicles', 'player', 'ai', 'motion', 'objectives', 'projectiles', 'grenades',
  'effects', 'hud', 'presentation', 'render', 'audio', 'steering', 'routes', 'posture', 'tankEvasion', 'civilians',
]);
export const PERFORMANCE_SCOPE_SAMPLE_EVERY = Object.freeze({ steering: 32, routes: 32, posture: 32, tankEvasion: 32 });
export const PERFORMANCE_STATES = Object.freeze(['menu', 'playing', 'transferring', 'pause', 'dead', 'victory', 'defeat', 'draw', 'loading']);
export const PERFORMANCE_MAPS = Object.freeze(['taierzhuang-fort', 'taierzhuang-streets', 'taierzhuang', 'nanjing', 'sihang']);
export const PERFORMANCE_LOADING_STAGES = Object.freeze([
  'scene-materials', 'friendly-model', 'friendly-poses', 'enemy-model', 'enemy-poses',
  'friendly-rendering', 'enemy-rendering', 'ready',
]);
export const RUNTIME_ERROR_CODES = Object.freeze(['native-gait-reach', 'equipment-view-metadata', 'unclassified-runtime']);

export function sanitizedRuntimeError(error, { recovered, stage, position = null, side = null, team = null } = {}) {
  if (!(error instanceof Error) || typeof recovered !== 'boolean') throw new TypeError('Runtime logging requires an Error and recovery status');
  const code = error.code === 'equipment-view-metadata' ? 'equipment-view-metadata'
    : error.name === 'NativeGaitReachError' ? 'native-gait-reach'
    : error instanceof TypeError && /reading '(bolt|rifle)'/.test(error.message) ? 'equipment-view-metadata' : 'unclassified-runtime';
  const frames = [...(error.stack ?? '').matchAll(/([A-Za-z0-9_.-]+\.js:\d+(?::\d+)?)/g)]
    .map(match => match[1]).slice(0, 4);
  const coordinate = Array.isArray(position) && position.length === 3 &&
    position.every(value => Number.isFinite(value) && Math.abs(value) <= 10000)
    ? position.map(value => Math.round(value * 10) / 10) : null;
  return { code, name: ['Error', 'TypeError', 'RangeError', 'NativeGaitReachError'].includes(error.name) ? error.name : 'Error',
    recovered, stage: ['native-gait', 'battle', 'initialization'].includes(stage) ? stage : 'battle',
    side: ['Left', 'Right'].includes(side) ? side : null,
    team: ['friendly', 'enemy'].includes(team) ? team : null,
    position: coordinate, frames, count: 1 };
}

function runtimeErrors(value) {
  return Array.isArray(value) && value.length <= 8 && value.every(entry =>
    keys(entry, ['code', 'name', 'recovered', 'stage', 'side', 'team', 'position', 'frames', 'count']) &&
    RUNTIME_ERROR_CODES.includes(entry.code) && ['Error', 'TypeError', 'RangeError', 'NativeGaitReachError'].includes(entry.name) &&
    typeof entry.recovered === 'boolean' && ['native-gait', 'battle', 'initialization'].includes(entry.stage) &&
    [null, 'Left', 'Right'].includes(entry.side) && [null, 'friendly', 'enemy'].includes(entry.team) &&
    (entry.position === null || Array.isArray(entry.position) && entry.position.length === 3 &&
      entry.position.every(number => Number.isFinite(number) && Math.abs(number) <= 10000)) &&
    integer(entry.count, 10000) && entry.count > 0 && Array.isArray(entry.frames) && entry.frames.length <= 4 &&
    entry.frames.every(frame => typeof frame === 'string' && frame.length <= 90 && /^[A-Za-z0-9_.-]+\.js:\d+(?::\d+)?$/.test(frame)));
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).every(key => names.includes(key));
const number = (value, max = 1e9) => Number.isFinite(value) && value >= 0 && value <= max;
const integer = (value, max = 1e9) => Number.isInteger(value) && number(value, max);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const contextNames = ['map', 'state', 'time', 'quality', 'adaptiveLevel', 'allies', 'enemies', 'corpses', 'vehicles',
  'reinforcementWaves', 'drawCalls', 'triangles', 'backlogSeconds', 'simulationSteps', 'unit', 'stage',
  'civilianCasualties','civilianShots','civilianAircraftHits', 'automaticLoad'];
const civilianCounters=['civilianCasualties','civilianShots','civilianAircraftHits'];
function context(value) {
  return keys(value, contextNames) && PERFORMANCE_MAPS.includes(value.map) && PERFORMANCE_STATES.includes(value.state) &&
    ['high', 'low'].includes(value.quality) && ['infantry', 'tank', 'plane', 'mortar', 'none'].includes(value.unit) &&
    (value.stage === undefined || ['gate-defense', 'withdrawal', 'dock-defense', 'withdrawal-to-boats',
      'encirclement', 'east-breakout', 'conquest', 'sihang-defense', 'sihang-retreat'].includes(value.stage) ||
      value.state === 'loading' && PERFORMANCE_LOADING_STAGES.includes(value.stage)) &&
    civilianCounters.every(name=>value[name]===undefined||integer(value[name],1e7))&&
    (value.automaticLoad === undefined || automaticLoad(value.automaticLoad)) &&
    contextNames.filter(name => !['map', 'state', 'quality', 'unit', 'stage', 'automaticLoad',...civilianCounters].includes(name))
      .every(name => number(value[name])) && integer(value.adaptiveLevel, 2) &&
    integer(value.allies, 1000) && integer(value.enemies, 1000) && integer(value.corpses, 10000) &&
    integer(value.vehicles, 100) && integer(value.reinforcementWaves, 100);
}
function automaticLoad(value) {
  return keys(value, ['level', 'peak', 'activations', 'reductions', 'recoveries', 'activeSeconds', 'aiReductions', 'aiRecoveries']) &&
    integer(value.level, 3) && integer(value.peak, 3) && value.peak >= value.level &&
    ['activations', 'reductions', 'recoveries', 'aiReductions', 'aiRecoveries'].every(name => integer(value[name], 1e6)) &&
    value.activations <= value.reductions && number(value.activeSeconds);
}
function scopes(value) {
  return keys(value, PERFORMANCE_SCOPES) && Object.entries(value).every(([name, item]) =>
    keys(item, ['calls', 'totalMs', 'maxMs', 'sampleEvery']) && integer(item.calls, 1e7) &&
    item.sampleEvery === (PERFORMANCE_SCOPE_SAMPLE_EVERY[name] ?? 1) &&
    number(item.totalMs, 1e8) && number(item.maxMs, item.totalMs));
}
export function validatePerformanceBatch(value) {
  if (!keys(value, ['schemaVersion', 'id', 'sessionId', 'build', 'environment', 'delivery', 'windows']) ||
    value.schemaVersion !== PERFORMANCE_SCHEMA_VERSION || !uuid(value.id) || !uuid(value.sessionId)) return 'Invalid performance batch identity or schema';
  if (!keys(value.delivery, ['droppedFrames', 'failedBatches']) ||
    !integer(value.delivery.droppedFrames) || !integer(value.delivery.failedBatches)) return 'Invalid delivery counters';
  if (!keys(value.build, ['commit', 'dirty', 'builtAt']) ||
    typeof value.build.commit !== 'string' || !/^[a-f0-9]{7,40}$/.test(value.build.commit) ||
    typeof value.build.dirty !== 'boolean' || typeof value.build.builtAt !== 'string' ||
    value.build.builtAt.length > 40 || !Number.isFinite(Date.parse(value.build.builtAt))) return 'Invalid build metadata';
  const env = value.environment;
  if (!keys(env, ['browser', 'major', 'platform', 'width', 'height', 'dpr']) ||
    !['Chrome', 'Edge', 'Firefox', 'Safari', 'Other'].includes(env.browser) || !integer(env.major, 999) ||
    !['Windows', 'macOS', 'Linux', 'Android', 'iOS', 'Other'].includes(env.platform) ||
    !integer(env.width, 32768) || env.width < 1 || !integer(env.height, 32768) || env.height < 1 ||
    !number(env.dpr, 8) || env.dpr === 0) return 'Invalid coarse environment';
  if (!Array.isArray(value.windows) || value.windows.length < 1 || value.windows.length > 6) return 'Invalid window count';
  const sequences = new Set();
  for (const window of value.windows) {
    if (!keys(window, ['sequence', 'durationMs', 'reason', 'frames', 'frameMs', 'maxFrameMs', 'longFrames',
      'scopes', 'context', 'slowFrames', 'errors', 'runtimeErrors']) ||
      !integer(window.sequence, 1e6) || sequences.has(window.sequence) || !number(window.durationMs, 120000) ||
      !['interval', 'hidden', 'pagehide', 'pause', 'ended', 'manual'].includes(window.reason) ||
      !integer(window.frames, 100000) || !Array.isArray(window.frameMs) || window.frameMs.length !== FRAME_BUCKETS_MS.length ||
      !window.frameMs.every(count => integer(count, 100000)) ||
      window.frameMs.reduce((sum, count) => sum + count, 0) !== window.frames ||
      !number(window.maxFrameMs, 60000) || !integer(window.longFrames, window.frames) ||
      !context(window.context) || !scopes(window.scopes) ||
      !keys(window.errors, ['error', 'unhandledrejection', 'webglcontextlost', 'pose-recovered']) ||
      !Object.values(window.errors).every(count => integer(count, 10000)) ||
      window.runtimeErrors !== undefined && !runtimeErrors(window.runtimeErrors) ||
      !Array.isArray(window.slowFrames) || window.slowFrames.length > 3 ||
      !window.slowFrames.every(frame => keys(frame, ['frameMs', 'callbackMs', 'scopes']) &&
        number(frame.frameMs, 60000) && number(frame.callbackMs, 60000) && scopes(frame.scopes))) return 'Invalid performance window';
    sequences.add(window.sequence);
  }
  return null;
}

export function histogramPercentile(histogram, percentile) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const rank = Math.ceil(total * percentile);
  let count = 0;
  for (let index = 0; index < histogram.length; index++) {
    count += histogram[index];
    if (count >= rank) return FRAME_BUCKETS_MS[index];
  }
  return null;
}
