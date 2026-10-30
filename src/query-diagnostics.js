const fields = ['scopeCalls', 'circleCalls', 'candidates', 'checked', 'blocked', 'boundaryHits',
  'returns', 'returnedCandidates', 'dynamicCandidates', 'timingSamples', 'sampledMs'];
const capacity = 32;

export function createQueryDiagnostics(enabled, now = () => performance.now()) {
  if (!enabled) return null;
  const rows = [];
  function register(name) {
    if (rows.some(row => row.name === name) || rows.length >= capacity) throw new RangeError('Query scopes must be unique and bounded');
    const row = { name, index: rows.length, callers: new Float64Array(capacity),
      candidateHistogram: new Float64Array(6), timingHistogram: new Float64Array(6) };
    for (const field of fields) row[field] = 0;
    rows.push(row);
    return row;
  }
  const root = register('unscoped');
  const diagnostics = {
    current: root,
    wrap(name, fn) {
      const row = register(name);
      // All instrumented functions have at most six arguments; no rest-array allocation per call.
      return function(a, b, c, d, e, f) {
        const previous = diagnostics.current;
        diagnostics.current = row;
        row.scopeCalls++; row.callers[previous.index]++;
        const sampled = row.scopeCalls % 64 === 1;
        const started = sampled ? now() : 0;
        try { return fn.call(this, a, b, c, d, e, f); }
        finally {
          if (sampled) {
            const duration = now() - started;
            row.timingSamples++; row.sampledMs += duration;
            row.timingHistogram[duration <= .01 ? 0 : duration <= .1 ? 1 : duration <= 1 ? 2 : duration <= 5 ? 3 : duration <= 20 ? 4 : 5]++;
          }
          diagnostics.current = previous;
        }
      };
    },
    candidates(length, dynamic = 0) {
      const row = diagnostics.current;
      row.returns++; row.returnedCandidates += length; row.dynamicCandidates += dynamic;
    },
    reset() {
      diagnostics.current = root;
      for (const row of rows) {
        for (const field of fields) row[field] = 0;
        row.callers.fill(0); row.candidateHistogram.fill(0); row.timingHistogram.fill(0);
      }
    },
    get snapshot() {
      return { sampleEvery: 64, candidateBounds: [0, 8, 32, 128, 512, null],
        timingBoundsMs: [.01, .1, 1, 5, 20, null],
        rows: rows.map(row => ({ name: row.name,
          ...Object.fromEntries(fields.map(field => [field, row[field]])),
          callers: Object.fromEntries(rows.map(caller => [caller.name, row.callers[caller.index]])),
          candidateHistogram: Array.from(row.candidateHistogram), timingHistogram: Array.from(row.timingHistogram) })) };
    },
  };
  return diagnostics;
}

export function queryDiagnosticsDelta(before, after) {
  if (!before && !after) return null;
  if (!before || !after || before.rows.length !== after.rows.length) throw new Error('Query diagnostics changed during the sample');
  const difference = (a, b) => {
    const result = b - a;
    if (!Number.isFinite(result) || result < 0) throw new Error('Query counters reset during the sample');
    return result;
  };
  return { sampleEvery: after.sampleEvery, candidateBounds: after.candidateBounds, timingBoundsMs: after.timingBoundsMs,
    rows: after.rows.map((row, index) => {
      const initial = before.rows[index];
      if (initial.name !== row.name) throw new Error('Query scope changed during the sample');
      return { name: row.name, ...Object.fromEntries(fields.map(field => [field, difference(initial[field], row[field])])),
        callers: Object.fromEntries(Object.keys(row.callers).map(name => [name, difference(initial.callers[name], row.callers[name])])),
        candidateHistogram: row.candidateHistogram.map((count, i) => difference(initial.candidateHistogram[i], count)),
        timingHistogram: row.timingHistogram.map((count, i) => difference(initial.timingHistogram[i], count)) };
    }) };
}
