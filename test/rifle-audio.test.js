import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rifleMix, createRifleAudio } from '../src/rifle-audio.js';

const listener = () => ({ position: { x: 0, y: 1.6, z: 0 }, right: { x: 1, y: 0, z: 0 },
  soldierId: 'player', weaponId: 'player:rifle' });
function event(id, x = 4, soldierId = 'ally') {
  return { id, start: { x, y: 1.39, z: -5 }, source: { soldierId, weaponId: `${soldierId}:rifle`, credit: soldierId === 'player' ? 'player' : 'ally' } };
}
function fakeContext() {
  const sources = [], nodes = [];
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = kind => {
    const value = { kind, connect(other) { return other; }, disconnect() {}, gain: parameter(), frequency: parameter(), pan: parameter() };
    nodes.push(value); return value;
  };
  return { state: 'running', currentTime: 0, destination: {}, sources, nodes,
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createStereoPanner: () => node('panner'),
    createBufferSource() {
      const source = { ...node('source'), playbackRate: parameter(), start() {}, stop() { this.onended?.(); } };
      sources.push(source); return source;
    } };
}
const buffer = { duration: .6, sampleRate: 24000 };

test('rifle stereo placement follows camera orientation and range reduces volume/high frequencies', () => {
  const ears = listener(), right = rifleMix({ x: 10, y: 1.39, z: 0 }, ears), left = rifleMix({ x: -10, y: 1.39, z: 0 }, ears);
  assert.ok(right.pan > .9 && left.pan < -.9);
  const far = rifleMix({ x: 80, y: 1.39, z: 0 }, ears);
  assert.ok(far.gain < right.gain && far.cutoff < right.cutoff);
  ears.right.x = -1;
  assert.ok(rifleMix({ x: 10, y: 1.39, z: 0 }, ears).pan < -.9);
  assert.equal(rifleMix({ x: 101, y: 1.6, z: 0 }, ears).audible, false);
  assert.equal(rifleMix({ x: 1, y: 1.39, z: 0 }, ears, true).pan, 0);
});

test('remote rifle voices and per-batch work are capped while owned fire is prioritized', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  for (let id = 1; id <= 3; id++) assert.equal(audio.play(context, event(id), ears, false), true);
  assert.equal(audio.play(context, event(4), ears, false), false);
  audio.beginBatch();
  for (let id = 5; id <= 7; id++) assert.equal(audio.play(context, event(id), ears, false), true);
  audio.beginBatch();
  assert.equal(audio.play(context, event(8), ears, false), true);
  assert.equal(audio.play(context, event(9), ears, false), true);
  assert.equal(audio.play(context, event(10), ears, false), false);
  assert.equal(audio.play(context, event(11, 0, 'player'), ears, true), true);
  assert.equal(audio.snapshot.active, 9);
  assert.equal(audio.snapshot.counts.budget, 1);
  assert.equal(audio.snapshot.counts.polyphony, 1);
  audio.play(context, event(12, 0, 'player'), ears, true);
  assert.equal(audio.snapshot.active, 9, 'new own fire replaces its old tail rather than creating an unbounded channel');
  for (const source of context.sources) source.onended();
  assert.equal(audio.snapshot.active, 0);
});

test('personal rifle gains exactly 3 dB without changing remote levels or the shared bus', () => {
  const ears = listener(), audio = createRifleAudio(buffer), context = fakeContext();
  const personal = rifleMix({ x: 0, y: 1.6, z: 0 }, ears, true);
  assert.ok(Math.abs(20 * Math.log10(personal.gain / .65) - 3) < 1e-12);
  for (const distance of [0, 10, 40, 80]) {
    const remote = rifleMix({ x: distance, y: 1.6, z: 0 }, ears);
    assert.equal(remote.gain, .12 / (1 + (distance / 14) ** 2));
  }
  audio.play(context, event(1, 0, 'player'), ears, true);
  const gains = context.nodes.filter(node => node.kind === 'gain');
  assert.equal(gains[0].gain.value, .7, 'remote channels must not be boosted via the shared bus');
  assert.equal(gains[1].gain.value, personal.gain);
  audio.update(ears);
  assert.equal(gains[1].gain.value, personal.gain, 'per-frame mixing retains the boost');
  ears.soldierId = 'other'; ears.weaponId = 'other:rifle';
  audio.update(ears);
  assert.equal(gains[1].gain.value, rifleMix(event(1, 0, 'player').start, ears).gain,
    'Y transfer removes the old personal boost');
});

test('active shot tails pan with listener turns and a Y transfer removes old personal centering', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  audio.play(context, event(1, 4, 'player'), ears, true);
  const panner = context.nodes.find(node => node.kind === 'panner');
  assert.ok(panner);
  ears.soldierId = 'other'; ears.weaponId = 'other:rifle';
  audio.update(ears);
  const initialPan = panner.pan.value;
  assert.ok(initialPan > 0);
  ears.right.x = -1; audio.update(ears);
  assert.ok(panner.pan.value < 0);
});

test('invalid audio geometry or identity fails explicitly and snapshots do not expose mutable counters', () => {
  assert.throws(() => rifleMix({ x: NaN, y: 0, z: 0 }, listener()), /finite/);
  assert.throws(() => rifleMix({ x: 0, y: 0, z: 0 }, { ...listener(), right: { x: 0, y: 0, z: 0 } }), /degenerate/);
  assert.throws(() => createRifleAudio({ duration: 10 }), /short audio/);
  const audio = createRifleAudio(buffer);
  assert.throws(() => audio.play(fakeContext(), { id: 1 }, listener(), true), /identity/);
  audio.snapshot.counts.played = 999;
  assert.equal(audio.snapshot.counts.played, 0);
});

test('recorded report file matches source hash, is short mono PCM, and has faded head/tail below full scale', () => {
  const base = new URL('../public/assets/audio/recorded-rifle/', import.meta.url);
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  const data = readFileSync(new URL('report.wav', base));
  assert.equal(source.license, 'CC0-1.0'); assert.equal(source.author, 'kurt');
  assert.equal(createHash('sha256').update(data).digest('hex'), source.files[0].sha256);
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.readUInt16LE(22), 1); assert.equal(data.readUInt32LE(24), 24000);
  assert.equal(data.readUInt16LE(34), 16); assert.equal(data.length, 28844);
  assert.equal(data.readInt16LE(44), 0); assert.equal(data.readInt16LE(data.length - 2), 0);
  let peak = 0;
  for (let offset = 44; offset < data.length; offset += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
  assert.ok(peak > 15000 && peak <= 23200);
});
