import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlastTinnitus } from '../src/blast-tinnitus.js';
import { createAudioMixer, defaultAudioSettings } from '../src/audio-mixer.js';

function fixture() {
  const nodes = [], oscillators = [];
  const parameter = () => ({ value: 0, events: [], setValueAtTime(value, at) { this.value = value; this.events.push([value, at]); },
    linearRampToValueAtTime(value, at) { this.events.push([value, at]); },
    exponentialRampToValueAtTime(value, at) { this.events.push([value, at]); },
    cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } });
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
test('fading tinnitus is single-voice, bounded in amplitude, mixer-routed, distant-safe and fully released on pause/reset', () => {
  const { context, mixer, nodes, oscillators, tinnitus } = fixture();
  assert.equal(tinnitus.play({ ...point, x: 150 }, listener, 'explosive-pack'), false);
  assert.equal(oscillators.length, 0);
  assert.equal(tinnitus.play(point, listener, 'explosive-pack'), true);
  const envelope = nodes.find(node => node.output === mixer.output('effects'));
  assert.deepEqual(envelope.gain.events, [[.0001, 0], [.045, .025], [.0001, 4]]);
  assert.equal(tinnitus.snapshot.active, 1);
  for (let i = 0; i < 80; i++) {
    context.currentTime += .01;
    tinnitus.play(point, listener, 'grenade');
    assert.equal(tinnitus.snapshot.active, 1);
    assert.equal(oscillators.filter(node => !node.disconnected).length, 1);
  }
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
  tinnitus.play(point, listener, 'mortar');
  oscillators.at(-1).onended();
  assert.equal(tinnitus.snapshot.active, 0);
});
