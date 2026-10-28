import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rifleMix, createRifleAudio } from '../src/rifle-audio.js';
import { createRifleState, shootRifle, advanceRifle, infantryWeaponProfile } from '../src/rifle-action.js';
import { createCombatEvents } from '../src/combat-events.js';

const listener = () => ({ position: { x: 0, y: 1.6, z: 0 }, right: { x: 1, y: 0, z: 0 },
  soldierId: 'player', weaponId: 'player:rifle' });
function event(id, x = 4, soldierId = 'ally') {
  return { id, start: { x, y: 1.39, z: -5 }, source: { soldierId, weaponId: `${soldierId}:rifle`,
    credit: soldierId === 'player' ? 'player' : soldierId === 'enemy' ? 'enemy' : 'ally' } };
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
    createWaveShaper: () => node('safety'),
    createBufferSource() {
      const source = { ...node('source'), playbackRate: parameter(), start() {}, stop() { this.stopped = true; this.onended?.(); } };
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
  assert.equal(rifleMix({ x: 101, y: 1.6, z: 0 }, ears).audible, true);
  assert.equal(rifleMix({ x: 240, y: 1.6, z: 0 }, ears).audible, false);
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
  assert.equal(audio.play(context, event(10, 80), ears, false), false);
  assert.equal(audio.play(context, event(11, 0, 'player'), ears, true), true);
  assert.equal(audio.snapshot.active, 9);
  assert.equal(audio.snapshot.counts.budget, 1);
  assert.equal(audio.snapshot.counts.polyphony, 1);
  audio.play(context, event(12, 0, 'player'), ears, true);
  assert.equal(audio.snapshot.active, 9, 'new own fire replaces its old tail rather than creating an unbounded channel');
  for (const source of context.sources) source.onended();
  assert.equal(audio.snapshot.active, 0);
});

test('personal rifle gains another 2 dB while the shared bus remains unchanged', () => {
  const ears = listener(), audio = createRifleAudio(buffer), context = fakeContext();
  const personal = rifleMix({ x: 0, y: 1.6, z: 0 }, ears, true);
  assert.ok(Math.abs(20 * Math.log10(personal.gain / (.65 * 10 ** (3 / 20))) - 2) < 1e-12);
  audio.play(context, event(1, 0, 'player'), ears, true);
  const gains = context.nodes.filter(node => node.kind === 'gain');
  assert.equal(gains[0].gain.value, .7, 'distance balance is adjusted per voice, not by raising the shared bus');
  assert.equal(gains[1].gain.value, personal.gain);
  audio.update(ears);
  assert.equal(gains[1].gain.value, personal.gain, 'per-frame mixing retains the boost');
  ears.soldierId = 'other'; ears.weaponId = 'other:rifle';
  audio.update(ears);
  assert.equal(gains[1].gain.value, rifleMix(event(1, 0, 'player').start, ears).gain,
    'Y transfer removes the old personal boost');
});

test('nearby rifles are prominent and the inverse-distance mix fades continuously beyond 180m', () => {
  const ears = listener(), own = rifleMix({ x: 0, y: 1.6, z: 0 }, ears, true);
  const levels = [[3, -4.5, -3.5], [5, -6, -5], [10, -9, -7], [25, -14, -12], [50, -19, -17], [100, -25, -22], [180, -30, -27]];
  let previous = Infinity, cutoff = Infinity;
  for (const [distance, minimumDb, maximumDb] of levels) {
    const mix = rifleMix({ x: distance, y: 1.6, z: 0 }, ears);
    const relativeDb = 20 * Math.log10(mix.gain / own.gain);
    assert.ok(relativeDb >= minimumDb && relativeDb <= maximumDb, `${distance}m: ${relativeDb}dB`);
    assert.ok(mix.gain < previous); assert.ok(mix.cutoff <= cutoff);
    assert.equal(mix.audible, true);
    previous = mix.gain; cutoff = mix.cutoff;
  }
  assert.equal(rifleMix({ x: 0, y: 1.6, z: 0 }, ears).gain, rifleMix({ x: 3, y: 1.6, z: 0 }, ears).gain);
  const at180 = rifleMix({ x: 180, y: 1.6, z: 0 }, ears), after180 = rifleMix({ x: 180.001, y: 1.6, z: 0 }, ears);
  assert.ok(Math.abs(after180.gain - at180.gain) < .000001);
  const at239 = rifleMix({ x: 239.99, y: 1.6, z: 0 }, ears);
  assert.ok(at239.gain > 0 && at239.gain < 1e-8);
  assert.equal(rifleMix({ x: 240, y: 1.6, z: 0 }, ears).gain, 0);
});

test('a render batch selects the nearest reports regardless of event order or faction', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  const shots = [event(1, 200), event(2, 150), event(3, 100), event(4, 80), event(5, 50),
    event(6, 25), event(7, 5), event(8, 10, 'enemy'), event(9, 20), event(10, 0, 'player')];
  assert.equal(audio.playBatch(context, shots, ears), 4);
  assert.deepEqual(audio.snapshot.history.map(item => item.eventId), [10, 7, 8, 9]);
  assert.equal(audio.snapshot.counts.budget, 6);
  const balanced = createRifleAudio(buffer);
  balanced.playBatch(fakeContext(), [event(1, 5, 'ally'), event(2, 5, 'enemy')], ears);
  assert.equal(balanced.snapshot.history[0].gain, balanced.snapshot.history[1].gain);
  assert.equal(balanced.snapshot.history[0].pan, balanced.snapshot.history[1].pan);
  assert.equal(shots[0].id, 1, 'priority selection does not reorder the caller event list');
  assert.equal(audio.playBatch(context, [], ears), 0);
  assert.throws(() => audio.playBatch(context, [event(11), { id: 12 }], ears), /identity/);
  assert.equal(audio.snapshot.counts.played, 4, 'invalid batches must not play a partial success');
  assert.throws(() => audio.playBatch(context, new Array(5121), ears), /bounded/);
});

test('new close reports replace the least audible tail without displacing personal fire', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  for (let id = 1; id <= 8; id++) {
    audio.beginBatch(); audio.play(context, event(id, 80 + id * 10), ears, false);
  }
  audio.play(context, event(9, 0, 'player'), ears, true);
  const personalSource = context.sources.at(-1), weakestSource = context.sources[7];
  audio.beginBatch();
  assert.equal(audio.play(context, event(10, 5), ears, false), true);
  assert.equal(audio.snapshot.active, 9); assert.equal(audio.snapshot.counts.replaced, 1);
  assert.equal(weakestSource.stopped, true); assert.notEqual(personalSource.stopped, true);
  assert.equal(audio.play(context, event(11, 200), ears, false), false);
  audio.reset();
  assert.equal(audio.snapshot.active, 0); assert.equal(audio.snapshot.counts.played, 0);
  assert.equal(audio.snapshot.history.length, 0);
});

test('rifle bus applies a bounded symmetric safety curve without attenuating normal signals', () => {
  const audio = createRifleAudio(buffer), context = fakeContext();
  audio.play(context, event(1), listener(), false);
  const safety = context.nodes.find(node => node.kind === 'safety');
  assert.equal(safety.oversample, 'none'); assert.equal(safety.curve.length, 2049);
  assert.equal(safety.curve[1024], 0);
  for (let i = 0; i < safety.curve.length; i++) {
    assert.ok(Math.abs(safety.curve[i]) < .95);
    assert.ok(Math.abs(safety.curve[i] + safety.curve[2048 - i]) < 1e-7);
    if (i > 0) assert.ok(safety.curve[i] >= safety.curve[i - 1]);
  }
  assert.ok(Math.abs(safety.curve[1536] - .5) < 1e-7, 'normal signals are not saturated');
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

test('a Y transfer reclassifies the old personal tail without exceeding eight remote voices', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  for (let id = 1; id <= 8; id++) {
    audio.beginBatch(); audio.play(context, event(id, 80 + id * 10), ears, false);
  }
  audio.play(context, event(9, 0, 'player'), ears, true);
  assert.equal(audio.snapshot.active, 9);
  ears.soldierId = 'other'; ears.weaponId = 'other:rifle';
  audio.playBatch(context, [], ears);
  assert.equal(audio.snapshot.active, 8);
  assert.equal(audio.playBatch(context, [event(10, 0, 'other')], ears), 1);
  assert.equal(audio.snapshot.active, 9);
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

test('faction and automatic flags select the correct recording without changing cadence or pitch', () => {
  const enemyBuffer = { duration: 3.074 }, machine = [0, 1, 2].map(take => ({ duration: .095, take }));
  const audio = createRifleAudio(buffer, enemyBuffer, machine), context = fakeContext(), ears = listener();
  const shots = [
    { ...event(1), source: { ...event(1).source, team: 'friendly' } },
    { ...event(2, 4, 'enemy'), source: { ...event(2, 4, 'enemy').source, team: 'enemy' } },
    { ...event(3, 4, 'enemy'), weaponType: 'tank', source: { ...event(3, 4, 'enemy').source, team: 'enemy' } },
    { ...event(4), automatic: true },
    { ...event(5, 4, 'enemy'), automatic: true, source: { ...event(5, 4, 'enemy').source, team: 'enemy' } },
  ];
  for (const shot of shots) { audio.beginBatch(); audio.play(context, shot, ears, false); }
  assert.deepEqual(context.sources.map(source => source.buffer), [buffer, enemyBuffer, buffer, machine[1], machine[2]]);
  assert.deepEqual(audio.snapshot.history.map(item => item.report),
    ['recorded-rifle', 'enemy-rifle', 'recorded-rifle', 'machine-gun', 'machine-gun']);
  assert.equal(context.sources[1].playbackRate.value, 1);
  assert.equal(context.sources[3].playbackRate.value, 1);
  assert.equal(context.sources[4].playbackRate.value, 1);
});

test('both machine guns play exactly once per real shot at their weapon cycle, without a looping burst', () => {
  for (const model of ['zb26', 'type11']) {
    const gun = createRifleState(model), audio = createRifleAudio(buffer, buffer, [{ duration: .095 }]);
    const context = fakeContext(), bus = createCombatEvents(), times = [];
    for (let i = 0; i < 10; i++) {
      const now = i * infantryWeaponProfile(gun).cycleSeconds;
      assert.equal(shootRifle(gun), true);
      bus.publish('shot', { source: { unitId: 'unit', soldierId: 'player', weaponId: 'player:rifle',
        team: 'friendly', credit: 'player' }, weaponType: 'infantry', automatic: true, start: { x: 0, y: 1.6, z: 0 } }, now);
      context.currentTime = now;
      bus.drain(shot => { times.push(shot.time); audio.playBatch(context, [shot], listener()); });
      advanceRifle(gun, infantryWeaponProfile(gun).cycleSeconds);
    }
    assert.equal(context.sources.length, 10); assert.equal(gun.shots, 10);
    assert.ok(context.sources.every(source => source.buffer.duration < .12 && !source.loop));
    assert.ok(times.every((time, i) => i === 0 || Math.abs(time - times[i - 1] - .12) < 1e-10));
    assert.equal(audio.snapshot.counts.played, 10);
    assert.equal(audio.playBatch(context, [], listener()), 0);
  }
});

test('user-selected recordings have exact hashes, short isolated machine shots and separate licenses', () => {
  for (const directory of ['enemy-rifle', 'machine-gun']) {
    const base = new URL(`../public/assets/audio/${directory}/`, import.meta.url);
    const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
    assert.equal(source.license, directory === 'enemy-rifle' ? 'CC0-1.0' : 'Pixabay-Content-License');
    for (const record of source.files) {
      const bytes = readFileSync(new URL(record.file, base));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      assert.equal(bytes.length, record.bytes);
      assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 24000);
      const dataOffset = bytes.indexOf(Buffer.from('data')) + 8;
      let peak = 0;
      for (let offset = dataOffset; offset < bytes.length; offset += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset)));
      assert.ok(peak >= 15000 && peak <= 21400, 'new gunshots are normalized before integer PCM conversion');
      if (directory === 'machine-gun') {
        assert.equal(record.duration, .095);
        assert.equal(bytes.length, 44 + 2280 * 2);
        assert.equal(bytes.readInt16LE(44), 0); assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
        let onset = 0;
        while (onset < 2280 && Math.abs(bytes.readInt16LE(44 + onset * 2)) < 2000) onset++;
        assert.ok(onset < 240, 'each shot attacks within 10ms, with no imported burst pause');
      }
    }
  }
});
