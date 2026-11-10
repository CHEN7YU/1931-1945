import test from 'node:test';
import assert from 'node:assert/strict';
import { BLAST_TINNITUS, blastTinnitusEnvelope, createBlastTinnitus } from '../src/blast-tinnitus.js';
import { TINNITUS_CANDIDATES } from '../src/tinnitus-candidates.js';
import { createAudioMixer, defaultAudioSettings } from '../src/audio-mixer.js';

function fixture() {
  const nodes = [], oscillators = [];
  const parameter = () => ({ value: 0, events: [], setValueAtTime(value, at) { this.value = value; this.events.push([value, at]); },
    linearRampToValueAtTime(value, at) { this.events.push([value, at]); },
    exponentialRampToValueAtTime(value, at) { this.events.push([value, at]); },
    setValueCurveAtTime(values, at, duration) { this.curve = { values, at, duration }; },
    cancelScheduledValues() {}, setTargetAtTime(value, at, smoothing) { this.events.push([value, at, smoothing]); } });
  const node = () => {
    const value = { gain: parameter(), frequency: parameter(), disconnected: 0,
      connect(next) { this.output = next; return next; }, disconnect() { this.disconnected++; } };
    nodes.push(value); return value;
  };
  const context = { currentTime: 0, state: 'running', destination: {}, createGain: node,
    createOscillator() {
      const value = node();
      Object.assign(value, { start() {}, stop(at) { this.stopAt = at; if (at === undefined) this.onended?.(); } });
      oscillators.push(value); return value;
    } };
  const mixer = createAudioMixer(context);
  return { context, mixer, nodes, oscillators, tinnitus: createBlastTinnitus(context, mixer.output('effects')) };
}
const point = { x: 0, y: 1, z: 0 }, listener = { position: point };
test('F tone is softly delayed, bounded, fixed-length and matches the selected listening candidate', () => {
  const f = TINNITUS_CANDIDATES.find(candidate => candidate.id === 'F');
  assert.equal(BLAST_TINNITUS.frequency, f.frequencies[0]);
  assert.ok(Math.abs(BLAST_TINNITUS.onset - (f.onset - .6)) < 1e-12);
  assert.equal(BLAST_TINNITUS.attack, f.attack);
  assert.equal(BLAST_TINNITUS.decay, f.decay);
  for (let t = 0; t <= .8; t += .001) assert.equal(blastTinnitusEnvelope(t), 0);
  assert.equal(blastTinnitusEnvelope(4.5), 0);
  assert.equal(blastTinnitusEnvelope(5), 0);
  let previous = 0, maximum = 0;
  for (let i = 0; i <= 4500; i++) {
    const value = blastTinnitusEnvelope(i / 1000);
    assert.ok(Math.abs(value - previous) < .00015, 'no abrupt attack or release');
    assert.ok(value >= 0 && value <= .035);
    maximum = Math.max(maximum, value); previous = value;
  }
  assert.ok(maximum > .02 && maximum < .028);
});
test('near blasts share one uninterrupted oscillator and cannot extend the episode', () => {
  const { context, nodes, oscillators, tinnitus } = fixture();
  assert.equal(tinnitus.play({ ...point, x: 150 }, listener, 'explosive-pack'), false);
  assert.equal(tinnitus.play({ ...point, x: 8 }, listener, 'grenade'), false);
  assert.equal(oscillators.length, 0);
  assert.equal(tinnitus.play(point, listener), true);
  const envelope = nodes.find(node => node.gain.curve);
  assert.equal(envelope.gain.curve.duration, 4.5);
  assert.equal(envelope.gain.curve.values[0], 0);
  assert.equal(envelope.gain.curve.values.at(-1), 0);
  assert.deepEqual(oscillators[0].frequency.events, [[2200, 0]]);
  for (let i = 1; i < 450; i++) {
    context.currentTime = i / 100;
    tinnitus.play(point, listener, i % 2 ? 'explosive-pack' : 'grenade');
    assert.equal(tinnitus.snapshot.active, 1);
    assert.equal(tinnitus.snapshot.endsAt, 4.5);
    assert.equal(oscillators.length, 1);
    assert.equal(oscillators[0].stopAt, 4.5);
  }
  const level = envelope.output;
  assert.deepEqual(level.gain.events, [[.42, 0], [1, .01, .12]]);
  assert.equal(tinnitus.snapshot.played, 1);
});
test('fixed recovery rejects blasts without queuing and cannot be bypassed by reset', () => {
  const { context, oscillators, tinnitus } = fixture();
  tinnitus.play(point, listener, 'explosive-pack');
  assert.equal(tinnitus.snapshot.nextAllowedAt, 20.5);
  for (let i = 45; i < 205; i++) {
    context.currentTime = i / 10;
    assert.equal(tinnitus.play(point, listener, 'explosive-pack'), false);
    assert.equal(tinnitus.snapshot.active, 0);
  }
  tinnitus.reset(); tinnitus.reset();
  context.currentTime = 20.49;
  assert.equal(tinnitus.play(point, listener), false);
  context.currentTime = 20.5;
  assert.equal(tinnitus.snapshot.active, 0, 'no deferred playback');
  assert.equal(tinnitus.play(point, listener), true);
  assert.equal(oscillators.length, 2);
  context.currentTime = 21;
  tinnitus.reset();
  assert.equal(tinnitus.play(point, listener), false, 'early reset preserves recovery deadline');
});
test('tinnitus stays mixer-routed and fully releases on pause/reset without bypassing recovery', () => {
  const { context, mixer, nodes, oscillators, tinnitus } = fixture();
  assert.equal(tinnitus.play(point, listener, 'explosive-pack'), true);
  assert.equal(tinnitus.snapshot.active, 1);
  assert.ok(nodes.some(node => node.output === mixer.output('effects')));
  const settings = defaultAudioSettings(); settings.master.muted = true; mixer.configure(settings);
  assert.equal(mixer.snapshot.channels.effects.effectiveGain, 0);
  settings.master.muted = false; settings.effects.muted = true; mixer.configure(settings);
  assert.equal(mixer.snapshot.channels.effects.effectiveGain, 0);
  context.state = 'suspended';
  assert.equal(tinnitus.play(point, listener, 'grenade'), false);
  assert.equal(tinnitus.snapshot.active, 0);
  assert.ok(oscillators.every(node => node.disconnected === 1));
  tinnitus.reset(); tinnitus.reset();
  context.state = 'running';
  assert.equal(tinnitus.play(point, listener, 'mortar'), false);
  context.currentTime = 20.5;
  tinnitus.play(point, listener, 'mortar');
  oscillators.at(-1).onended();
  assert.equal(tinnitus.snapshot.active, 0);
});
