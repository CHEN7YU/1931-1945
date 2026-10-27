import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRifleMechanicalAudio, loadRifleMechanicalAudio, RIFLE_MECHANICAL_SAMPLES } from '../src/rifle-mechanical-audio.js';
import { createControlEvents } from '../src/control-events.js';
import { createRifleState, shootRifle, reloadRifle, advanceRifle } from '../src/rifle-action.js';

const owner = { soldierId: 'soldier-a', weaponId: 'soldier-a:rifle' };
const buffers = () => Object.fromEntries(Object.keys(RIFLE_MECHANICAL_SAMPLES).map(cue =>
  [cue, { duration: .29, numberOfChannels: 1, sampleRate: 24000 }]));
const event = (id, cue = 'unlock', source = owner) => ({ id, type: 'weapon.mechanical', time: id / 10, cue, ...source });
function fakeContext() {
  const sources = [], nodes = [];
  return { state: 'running', currentTime: 123, destination: {}, sources, nodes,
    createGain() {
      const gain = { gain: { value: 0 }, connected: null, disconnected: false,
        connect(node) { this.connected = node; return node; }, disconnect() { this.disconnected = true; } };
      nodes.push(gain); return gain;
    },
    createBufferSource() {
      const source = { started: null, stopped: false, disconnected: false, connected: null,
        connect(node) { this.connected = node; return node; }, disconnect() { this.disconnected = true; },
        start(at) { this.started = at; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source;
    } };
}

test('existing action cues, not trigger pulls, select the four recordings', () => {
  const sounds = buffers(), audio = createRifleMechanicalAudio(sounds), context = fakeContext();
  const rifle = createRifleState(), events = createControlEvents();
  audio.beginBatch(owner, true);
  assert.equal(shootRifle(rifle), true);
  assert.equal(audio.snapshot.counts.played, 0);
  for (const [dt, cue] of [[.13, 'unlock'], [.17, 'extract'], [.24, 'close']]) {
    const cues = advanceRifle(rifle, dt);
    assert.deepEqual(cues, [cue]);
    for (const value of cues) audio.play(context, events.publish('weapon.mechanical', { ...owner, cue: value }, rifle.elapsed));
    assert.equal(context.sources.at(-1).buffer, sounds[cue]);
    assert.equal(context.sources.at(-1).started, 123, 'no independent delayed timeline');
  }
  advanceRifle(rifle, .2);
  assert.equal(reloadRifle(rifle), true);
  audio.beginBatch(owner, true);
  for (const cue of advanceRifle(rifle, 2)) {
    audio.play(context, events.publish('weapon.mechanical', { ...owner, cue }, 2));
  }
  assert.equal(context.sources.at(-1).buffer, sounds.load);
  assert.deepEqual(audio.snapshot.history.map(item => item.cue), ['unlock', 'extract', 'close', 'unlock', 'extract', 'load']);
});

test('soldier and weapon changes immediately stop old tails and reject stale identities', () => {
  const audio = createRifleMechanicalAudio(buffers()), context = fakeContext(), source = { ...owner };
  audio.beginBatch(source, true);
  source.soldierId = 'mutated';
  assert.equal(audio.play(context, event(1)), true, 'caller cannot mutate captured ownership');
  audio.sync({ ...owner, weaponId: 'other-rifle' }, true);
  assert.equal(context.sources[0].stopped, true);
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.play(context, event(2)), false);
  audio.sync({ soldierId: 'other', weaponId: owner.weaponId }, true);
  assert.equal(audio.play(context, event(3)), false, 'matching a weapon alone is not sufficient');
  audio.sync(owner, true);
  assert.equal(audio.play(context, event(3)), false, 'returning with Y cannot replay an already consumed event');
  assert.equal(audio.snapshot.counts.stale, 2);
});

test('pause/stow, suspension and new-match reset do not replay deferred sounds', () => {
  const audio = createRifleMechanicalAudio(buffers()), context = fakeContext();
  audio.beginBatch(owner, true);
  audio.play(context, event(1));
  audio.sync(owner, false);
  assert.equal(context.sources[0].stopped, true);
  assert.equal(audio.play(context, event(2)), false);
  audio.beginBatch(owner, true);
  assert.equal(audio.play(context, event(2)), false);
  context.state = 'suspended';
  assert.equal(audio.play(context, event(3)), false);
  context.state = 'running';
  assert.equal(audio.play(context, event(3)), false);
  assert.equal(audio.play(context, event(4)), true);
  audio.sync(null, false);
  assert.equal(audio.snapshot.active, 0);
  audio.reset();
  assert.equal(audio.snapshot.history.length, 0);
  assert.equal(audio.snapshot.counts.played, 0);
  audio.beginBatch(owner, true);
  assert.equal(audio.play(context, event(1)), true, 'event serial may restart only after explicit new-match reset');
});

test('catch-up work, simultaneous voices and history are bounded and nodes are released', () => {
  const audio = createRifleMechanicalAudio(buffers()), context = fakeContext();
  audio.beginBatch(owner, true);
  for (let id = 1; id <= 3; id++) assert.equal(audio.play(context, event(id)), true);
  assert.equal(audio.play(context, event(4)), false);
  assert.equal(context.sources.length, 3);
  audio.beginBatch(owner, true);
  audio.play(context, event(5)); audio.play(context, event(6));
  assert.equal(audio.snapshot.active, 4);
  assert.equal(audio.snapshot.peakVoices, 4);
  assert.equal(audio.snapshot.counts.replaced, 1);
  assert.equal(context.sources[0].stopped, true);
  for (let id = 7; id <= 50; id++) {
    audio.beginBatch(owner, true); audio.play(context, event(id));
  }
  assert.equal(audio.snapshot.history.length, 32);
  for (const source of context.sources) { source.onended(); source.onended(); }
  assert.equal(audio.snapshot.active, 0);
  assert.ok(context.sources.every(source => source.disconnected));
  assert.ok(context.nodes.every(node => node.disconnected));
  const snapshot = audio.snapshot;
  snapshot.counts.played = -1; snapshot.owner.soldierId = 'wrong'; snapshot.history[0].cue = 'wrong';
  assert.ok(audio.snapshot.counts.played > 0);
  assert.equal(audio.snapshot.owner.soldierId, owner.soldierId);
  assert.equal(audio.snapshot.history[0].cue, 'unlock');
});

test('changing AudioContext releases the old graph without replacing supplied buffers', () => {
  const sounds = buffers(), original = sounds.unlock, audio = createRifleMechanicalAudio(sounds);
  sounds.unlock = null;
  const first = fakeContext(), second = fakeContext();
  audio.beginBatch(owner, true);
  audio.play(first, event(1));
  assert.equal(first.sources[0].buffer, original);
  audio.play(second, event(2));
  assert.equal(first.sources[0].stopped, true);
  assert.equal(audio.snapshot.active, 1);
  audio.reset();
  assert.equal(second.sources[0].stopped, true);
});

test('invalid buffers, ownership, events and cue names fail explicitly', () => {
  for (const changed of [{ duration: 1 }, { duration: NaN }, { sampleRate: 48000 }, { numberOfChannels: 2 }]) {
    const sounds = buffers(); sounds.load = { ...sounds.load, ...changed };
    assert.throws(() => createRifleMechanicalAudio(sounds), /short mono/);
  }
  assert.throws(() => createRifleMechanicalAudio({}), /short mono/);
  const audio = createRifleMechanicalAudio(buffers());
  for (const next of [undefined, {}, { soldierId: '', weaponId: 'rifle' }]) {
    assert.throws(() => audio.sync(next, true), /ownership/);
  }
  assert.throws(() => audio.sync(null, true), /ownership/);
  assert.throws(() => audio.sync(owner, 1), /ownership/);
  for (const changed of [{ type: 'weapon.shot' }, { id: 0 }, { time: NaN }, { weaponId: '' }, { cue: 'ready' }, { cue: '__proto__' }]) {
    assert.throws(() => audio.play(fakeContext(), { ...event(1), ...changed }), /original/);
  }
  assert.equal(audio.snapshot.counts.played, 0);
});

test('candidate files retain CC0 evidence, exact hashes, short mono format and bounded faded samples', () => {
  const base = new URL('../public/assets/audio/rifle-mechanical/', import.meta.url);
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  assert.equal(source.license, 'CC0-1.0');
  assert.equal(source.originals.length, 2);
  assert.ok(source.originals.every(original => original.evidence.includes('CC0')));
  assert.equal(source.files.length, 4);
  assert.match(source.limitations.join(' '), /object producing each excerpt is not verified/);
  let total = 0;
  for (const record of source.files) {
    const data = readFileSync(new URL(record.file, base));
    total += data.length;
    assert.equal(data.length, record.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 16), 'WAVEfmt ');
    assert.equal(data.readUInt32LE(4), data.length - 8);
    assert.equal(data.readUInt16LE(20), 1); assert.equal(data.readUInt16LE(22), 1);
    assert.equal(data.readUInt32LE(24), 24000); assert.equal(data.readUInt16LE(34), 16);
    assert.equal(data.readUInt32LE(40), data.length - 44);
    const duration = (data.length - 44) / 48000;
    assert.ok(duration > .05 && duration <= .35);
    assert.equal(duration, record.duration);
    assert.equal(data.readInt16LE(44), 0); assert.equal(data.readInt16LE(data.length - 2), 0);
    let peak = 0, squares = 0;
    for (let offset = 44; offset < data.length; offset += 2) {
      const value = data.readInt16LE(offset);
      peak = Math.max(peak, Math.abs(value)); squares += value * value;
    }
    assert.ok(peak >= 3000 && peak <= 21300);
    assert.ok(Math.sqrt(squares / ((data.length - 44) / 2)) > 100, 'recording is not silent');
  }
  assert.ok(total <= 60000, 'candidate has a measured 60kB upper bound, not an entire source library');
});

test('loader propagates unsupported decoding, HTTP and corrupt-file errors without a success-shaped fallback', async t => {
  const previous = { Audio: globalThis.OfflineAudioContext, webkit: globalThis.webkitOfflineAudioContext, fetch: globalThis.fetch };
  t.after(() => {
    globalThis.OfflineAudioContext = previous.Audio; globalThis.webkitOfflineAudioContext = previous.webkit; globalThis.fetch = previous.fetch;
  });
  delete globalThis.OfflineAudioContext; delete globalThis.webkitOfflineAudioContext;
  await assert.rejects(loadRifleMechanicalAudio(), /does not provide/);
  globalThis.OfflineAudioContext = class { async decodeAudioData() { throw new Error('corrupt wave'); } };
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(loadRifleMechanicalAudio(), /HTTP 404/);
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(loadRifleMechanicalAudio(), /corrupt wave/);
  globalThis.fetch = async () => { throw new Error('network offline'); };
  await assert.rejects(loadRifleMechanicalAudio(), /network offline/);
});
