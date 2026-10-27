import test from 'node:test';
import assert from 'node:assert/strict';
import { createFootstepAudio, prepareFootstep } from '../src/footstep-audio.js';
import { createControlEvents } from '../src/control-events.js';

function fakeContext() {
  const sources = [], nodes = [];
  const node = () => {
    const value = { gain: { value: 0 }, frequency: { value: 0 }, playbackRate: { value: 0 }, disconnected: false,
      connect(other) { return other; }, disconnect() { this.disconnected = true; } };
    nodes.push(value); return value;
  };
  return { state: 'running', currentTime: 0, destination: {}, sources, nodes,
    createGain: node, createBiquadFilter: node,
    createBufferSource() {
      const value = { ...node(), start() {}, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(value); return value;
    } };
}
const buffers = () => Object.fromEntries(['stone', 'wood', 'earth'].map(surface =>
  [surface, { duration: .14, sampleRate: 24000, numberOfChannels: 1 }]));
const event = (id, extra = {}) => ({ id, soldierId: 'player', surface: 'stone', speed: 3.15,
  stance: 'standing', landing: false, ...extra });

test('recorded contact preparation trims the long tail, fades endpoints and bounds peak without altering input', () => {
  const input = Float32Array.from({ length: 24000 }, (_, i) => .2 + Math.sin(i * .05) * .6);
  const copy = input.slice(), prepared = prepareFootstep(input, 24000, .16);
  assert.equal(prepared.length, 3840);
  assert.equal(Math.abs(prepared[0]), 0);
  assert.equal(Math.abs(prepared.at(-1)), 0);
  assert.ok(Math.max(...prepared.map(Math.abs)) <= .700001);
  assert.deepEqual(input, copy);
  assert.throws(() => prepareFootstep(new Float32Array(4000), 24000, .1), /silent/);
  assert.throws(() => prepareFootstep(new Float32Array([NaN, 1]), 24000, .1), /Non-finite/);
  assert.throws(() => prepareFootstep(input, 24000, 5), /Invalid/);
});

test('surface recordings are distinct, quieter than the rifle mix, and cadence remains event-driven', () => {
  const bank = buffers(), audio = createFootstepAudio(bank), context = fakeContext();
  for (const [index, surface] of ['stone', 'wood', 'earth'].entries()) {
    audio.beginBatch('player', true);
    assert.equal(audio.play(context, event(index + 1, { surface })), true);
    assert.equal(context.sources.at(-1).buffer, bank[surface]);
  }
  assert.deepEqual(audio.snapshot.history.map(item => item.sample), ['concrete.ogg', 'wood.ogg', 'grass.ogg']);
  assert.ok(audio.snapshot.history.every(item => item.volume < .25));
  assert.equal(context.sources.length, 3, 'no independent footstep timer or extra thud');
  for (const source of context.sources) source.onended();
  assert.equal(audio.snapshot.active, 0);
});

test('catch-up bursts are bounded and pause, owner change, vehicle entry and new battle stop old tails', () => {
  const audio = createFootstepAudio(buffers()), context = fakeContext();
  audio.beginBatch('player', true);
  assert.equal(audio.play(context, event(1)), true);
  assert.equal(audio.play(context, event(2)), true);
  audio.sync('player', true);
  assert.equal(audio.play(context, event(3)), false);
  assert.equal(audio.snapshot.counts.budget, 1);
  for (let batch = 0; batch < 4; batch++) {
    audio.beginBatch('player', true);
    audio.play(context, event(4 + batch));
  }
  assert.equal(audio.snapshot.active, 4);
  assert.equal(audio.snapshot.peakVoices, 4);
  assert.equal(audio.snapshot.counts.replaced, 2);
  audio.beginBatch('next', true);
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.play(context, event(10)), false);
  audio.play(context, event(11, { soldierId: 'next', landing: true }));
  audio.beginBatch('next', false);
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.play(context, event(12, { soldierId: 'next' })), false);
  audio.beginBatch(null, false);
  assert.ok(context.sources.every(source => source.stopped));
});

test('captured feedback chooses its own ground, speed and owner; invalid data and crawling do not become stomps', () => {
  const events = createControlEvents(), audio = createFootstepAudio(buffers()), context = fakeContext();
  events.publish('movement.footstep', { ...event(1, { surface: 'wood', speed: 1.75, stance: 'crouched' }),
    unitId: 'squad', position: { x: 0, y: 0, z: 0 } }, 1);
  audio.beginBatch('player', true);
  events.drain(event => audio.play(context, event));
  assert.equal(audio.snapshot.history[0].surface, 'wood');
  assert.equal(audio.snapshot.history[0].speed, 1.75);
  assert.throws(() => audio.play(context, event(2, { surface: 'unknown' })), /Invalid/);
  assert.throws(() => audio.play(context, event(2, { stance: 'prone' })), /crawling/);
  assert.throws(() => createFootstepAudio({}), /short mono/);
  const snapshot = audio.snapshot;
  snapshot.counts.played = 999; snapshot.history[0].surface = 'earth';
  assert.equal(audio.snapshot.counts.played, 1);
  assert.equal(audio.snapshot.history[0].surface, 'wood');
});
