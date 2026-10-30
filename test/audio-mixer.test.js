import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_GROUPS, createAudioMixer, defaultAudioSettings, validateAudioSettings } from '../src/audio-mixer.js';

function fixture() {
  const nodes = [], context = { currentTime: 3, state: 'running', destination: { name: 'speaker' },
    createGain() {
      const gain = { value: 1, target: 1, cancelled: 0,
        cancelScheduledValues() { this.cancelled++; },
        setValueAtTime(value) { this.value = this.target = value; },
        setTargetAtTime(value) { this.value = this.target = value; } };
      const node = { gain, output: null, connect(output) { this.output = output; return output; }, disconnect() { this.output = null; } };
      nodes.push(node); return node;
    } };
  return { nodes, context };
}
test('all four groups flow through one master, preserve original default gain, and update already-connected nodes', () => {
  const f = fixture(), settings = defaultAudioSettings(), mix = createAudioMixer(f.context, settings);
  assert.equal(f.nodes.length, 5);
  assert.equal(f.nodes[0].output, f.context.destination);
  for (const [index, group] of AUDIO_GROUPS.entries()) {
    assert.equal(mix.output(group), f.nodes[index + 1]);
    assert.equal(f.nodes[index + 1].output, f.nodes[0]);
    assert.equal(f.nodes[index + 1].gain.value, 1);
  }
  settings.master.volume = .5; settings.weapons.volume = .4; settings.voices.muted = true;
  mix.configure(settings);
  assert.equal(f.nodes.length, 5, 'editing controls never creates another bus or AudioContext');
  assert.equal(mix.snapshot.channels.weapons.effectiveGain, .2);
  assert.equal(mix.output('weapons').gain.value, .4);
  assert.equal(mix.output('voices').gain.value, 0);
  assert.equal(mix.output('footsteps').gain.value, 1, 'muting speech does not mute footsteps');
  settings.master.muted = true; mix.configure(settings);
  assert.ok(Object.values(mix.snapshot.channels).every(channel => channel.effectiveGain === 0));
  assert.equal(f.nodes[0].gain.value, 0);
  settings.master.muted = false; settings.voices.muted = false; mix.configure(settings);
  assert.equal(mix.snapshot.channels.weapons.effectiveGain, .2, 'unmute restores the prior volume, not full scale');
  assert.equal(mix.snapshot.channels.voices.effectiveGain, .5);
});

test('synthetic sources disconnect exactly once on natural end or match reset', () => {
  const f = fixture(), mix = createAudioMixer(f.context);
  const node = () => ({ disconnected: 0, disconnect() { this.disconnected++; } });
  const source = () => ({ ...node(), stops: 0, stop() { this.stops++; this.onended(); } });
  const first = source(), filter = node(), gain = node();
  mix.track(first, [filter, gain], 'weapons');
  assert.equal(mix.snapshot.activeSynthetic, 1);
  first.onended(); first.onended();
  assert.equal(mix.snapshot.activeSynthetic, 0);
  assert.equal(first.disconnected, 1); assert.equal(filter.disconnected, 1); assert.equal(gain.disconnected, 1);
  const second = source(), third = source();
  mix.track(second, [], 'effects'); mix.track(third, [], 'footsteps');
  mix.reset(); mix.reset();
  assert.equal(second.stops, 1); assert.equal(third.stops, 1);
  assert.equal(mix.snapshot.activeSynthetic, 0);
  assert.equal(f.nodes.length, 5, 'match resets reuse the existing mixer buses');
});

test('invalid channel/volume/mute flags cannot corrupt live gains or snapshots', () => {
  const f = fixture(), mix = createAudioMixer(f.context);
  assert.throws(() => mix.output('unknown'), RangeError);
  for (const patch of [{ volume: 1.01, muted: false }, { volume: NaN, muted: false }, { volume: .5, muted: 'yes' }]) {
    const invalid = defaultAudioSettings(); invalid.master = patch;
    assert.throws(() => mix.configure(invalid), RangeError);
    assert.equal(mix.snapshot.channels.master.effectiveGain, 1);
  }
  assert.throws(() => validateAudioSettings(null), RangeError);
  const copy = mix.snapshot; copy.settings.master.volume = 0;
  assert.equal(mix.snapshot.settings.master.volume, 1);
});
