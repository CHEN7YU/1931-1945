import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleBattleWindow, installFrameObserver, activeWindowStatus } from '../scripts/benchmark-window.mjs';
import { booleanOption } from '../scripts/benchmark.mjs';

function pageClock() {
  let now = 0, pending, serial = 0, reads = 0, telemetryReads = 0;
  const frames = [];
  const target = {
    performance: { now: () => now },
    setTimeout, clearTimeout,
    requestAnimationFrame(callback) { pending = callback; return 1; },
    cancelAnimationFrame() { pending = null; },
    get __battle() {
      reads++;
      return { time: serial * .05, simulationClock: { pendingSeconds: 0 },
        combatStats: { aiRifleShots: serial }, corpses: { count: 0 }, population: {} };
    },
    get __battleTelemetry() {
      telemetryReads++;
      return { totalFrames: serial, frames: frames.map(frame => ({ ...frame })) };
    },
    advance(interval) {
      now += interval; serial++;
      frames.push({ serial, now, intervalMs: interval });
      const callback = pending; pending = null;
      callback?.(now);
    },
    get reads() { return reads; },
    get telemetryReads() { return telemetryReads; },
  };
  return target;
}

test('sample boundaries are page-local, after settling, with only two state snapshots', async () => {
  const page = pageClock(), resultPromise = sampleBattleWindow({ seconds: 1, settleSeconds: 1 }, page);
  page.advance(500);
  assert.equal(page.reads, 0);
  page.advance(500);
  assert.equal(page.reads, 1);
  page.advance(16);
  page.advance(1200);
  const result = await resultPromise;
  assert.equal(page.reads, 2);
  assert.equal(page.telemetryReads, 2);
  assert.equal(result.sampleStart.serial, 2);
  assert.equal(result.sampleStart.now, 1000);
  assert.equal(result.now, 2216);
  assert.equal(result.boundaries.startRafTimestamp, 1000);
  assert.equal(result.boundaries.endRafTimestamp, 2216);
  const selected = result.frames.filter(frame => frame.serial > result.sampleStart.serial && frame.now <= result.now);
  assert.deepEqual(selected.map(frame => frame.intervalMs), [16, 1200], 'do not trim in-window long frames');
  page.advance = () => { throw new Error('not used'); };
  assert.equal(result.final.time, .2);
});

test('missing telemetry fails explicitly instead of producing an empty successful measurement', async () => {
  const page = pageClock();
  Object.defineProperty(page, '__battleTelemetry', { value: undefined });
  const pending = sampleBattleWindow({ seconds: 1, settleSeconds: 0 }, page);
  page.advance(16);
  await assert.rejects(pending, /telemetry is unavailable/);
});

test('a stalled page rejects and cancels its pending animation callback', async () => {
  const page = pageClock();
  let expire, cancelled = false;
  page.setTimeout = callback => { expire = callback; return 1; };
  page.clearTimeout = () => {};
  page.cancelAnimationFrame = () => { cancelled = true; };
  const pending = sampleBattleWindow({ seconds: 1, settleSeconds: 0 }, page);
  expire();
  await assert.rejects(pending, /did not finish/);
  assert.equal(cancelled, true);
  assert.equal(page.reads, 0);
});

test('invalid sampling options and ambiguous boolean values are rejected', () => {
  for (const [seconds, settleSeconds] of [[0, 0], [1, -1], [Infinity, 1], [1, NaN]]) {
    assert.throws(() => sampleBattleWindow({ seconds, settleSeconds }), RangeError);
  }
  assert.equal(booleanOption('profile', undefined, true), true);
  assert.equal(booleanOption('profile', '0', true), false);
  assert.equal(booleanOption('profile', '1', false), true);
  for (const value of ['', 'false', 'true', '2']) assert.throws(() => booleanOption('profile', value, true), RangeError);
});

test('external production observer keeps raw intervals but never invents game tick CPU data', () => {
  const page = pageClock();
  delete page.__battleTelemetry;
  installFrameObserver(page);
  page.advance(16); page.advance(20); page.advance(1200);
  const snapshot = page.__battleTelemetry;
  assert.equal(snapshot.totalFrames, 2);
  assert.deepEqual(snapshot.frames.map(frame => frame.intervalMs), [20, 1200]);
  assert.ok(snapshot.frames.every(frame => !Object.hasOwn(frame, 'cpuMs')));
  snapshot.frames[0].intervalMs = 0;
  assert.equal(page.__battleTelemetry.frames[0].intervalMs, 20);
  assert.throws(() => installFrameObserver(page), /already exists/);
});

test('active-window validation rejects pauses and resumed windows with missing active time', () => {
  const start = { state: 'playing', clock: { active: true, activeSeconds: 30 } };
  const result = { boundaries: { startRafTimestamp: 10000, endRafTimestamp: 100000 },
    final: { state: 'playing', simulationClock: { active: true, activeSeconds: 120 } } };
  assert.equal(activeWindowStatus(start, result).valid, true);
  result.final.simulationClock.activeSeconds = 120.02;
  assert.equal(activeWindowStatus(start, result).valid, true, 'rAF and clock entry need not be exactly identical');
  result.final.simulationClock.activeSeconds = 35;
  assert.equal(activeWindowStatus(start, result).valid, false, 'firing a few shots does not prove a whole active window');
  result.final.simulationClock.activeSeconds = 120;
  result.final.state = 'pause';
  assert.equal(activeWindowStatus(start, result).valid, false);
  result.final.state = 'playing'; result.final.simulationClock.active = false;
  assert.equal(activeWindowStatus(start, result).valid, false);
});
