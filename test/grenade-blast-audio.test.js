import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrenadeBlastAudio, grenadeBlastMix } from '../src/grenade-blast-audio.js';

const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 } };
test('grenade impact combines an audible crack and low-frequency body, uses spatial routing and caps overlapping voices', () => {
  const nodes = [], sources = [], parameter = () => ({ value: 0, setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => { const n = { disconnected: 0, gain: parameter(), frequency: parameter(), pan: parameter(),
    connect(next) { this.output = next; return next; }, disconnect() { this.disconnected++; } }; nodes.push(n); return n; };
  const context = { state: 'running', currentTime: 0, createGain: node, createBiquadFilter: node,
    createStereoPanner: node, createBufferSource() { const n = node(); Object.assign(n, { start() {}, stop(at) { if (at === undefined) this.onended?.(); } }); sources.push(n); return n; },
    createOscillator() { const n = node(); Object.assign(n, { start() {}, stop() {} }); return n; } };
  const output = {}, audio = createGrenadeBlastAudio(context, {}, output);
  for (let index = 0; index < 3; index++) assert.equal(audio.play({ x: 3, y: 0, z: 0 }, listener), true);
  assert.equal(audio.play({ x: 30, y: 0, z: 0 }, listener), false);
  assert.equal(audio.snapshot.active, 3); assert.equal(audio.snapshot.peak, 3);
  assert.ok(nodes.some(n => n.output === output));
  assert.ok(nodes.some(n => n.type === 'lowpass' && n.frequency.value === 1900));
  assert.ok(nodes.some(n => n.type === 'sine' && n.frequency.value === 105));
  audio.reset(); assert.equal(audio.snapshot.active, 0);
  assert.ok(nodes.every(n => n.disconnected === 1), 'reset releases all nodes exactly once');
  context.state = 'suspended'; assert.equal(audio.play({ x: 0, y: 0, z: 0 }, listener), false);
});
test('blast audio and the brief warm exposure fade with distance, never infer a warning for a remote explosion', () => {
  const close = grenadeBlastMix({ x: 2, y: 0, z: 0 }, listener), far = grenadeBlastMix({ x: 40, y: 0, z: 0 }, listener);
  assert.ok(close.gain > far.gain && close.flash > 0 && close.flash <= .24);
  assert.equal(far.flash, 0); assert.ok(close.pan > 0);
  assert.equal(grenadeBlastMix({ x: 160, y: 0, z: 0 }, listener).gain, 0);
});
