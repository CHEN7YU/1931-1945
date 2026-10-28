import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { rifleMix, createRifleAudio, loadRifleAudio } from '../src/rifle-audio.js';
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
const friendlyReports = { rifle: { duration: .42, sampleRate: 24000 }, sniper: { duration: .28, sampleRate: 24000 } };

test('selected operators own only their primary and explicitly listed current secondary weapons', () => {
  const audio = createRifleAudio(buffer, buffer, [buffer], friendlyReports), context = fakeContext();
  const ears = { ...listener(), weaponId: 'tank-current:cannon', ownedWeaponIds: ['tank-current:mg-coax'] };
  const coax = (id, soldierId = 'player', weaponId = 'tank-current:mg-coax') => {
    const shot = event(id, 20, soldierId);
    Object.assign(shot.source, { weaponId, team: 'friendly', weaponClass: 'tank-machine-gun' });
    return shot;
  };
  const ownShot = coax(5);
  const shots = [coax(1, 'other'), coax(2, 'player', 'tank-old:mg-coax'),
    event(3, 1, 'ally'), event(4, 2, 'enemy'), ownShot];
  assert.equal(audio.playBatch(context, shots, ears), 4, 'secondary is prioritized outside the three-remote batch budget');
  const history = audio.snapshot.history;
  assert.equal(history[0].eventId, 5);
  assert.equal(history[0].owned, true);
  assert.equal(history[0].pan, 0);
  assert.equal(history[0].gain, rifleMix(ownShot.start, ears, true).gain);
  assert.equal(history[0].report, 'machine-gun', 'owned tank MG does not inherit friendly rifle samples');
  assert.ok(history.slice(1).every(item => !item.owned));
  assert.equal(audio.snapshot.counts.owned, 1);
  assert.equal(audio.snapshot.counts.remote, 3);
  const ownSource = context.sources[0];
  const ownGain = context.nodes.filter(node => node.kind === 'gain')[1];
  const ownPan = context.nodes.find(node => node.kind === 'panner');
  audio.update(ears);
  assert.equal(ownGain.gain.value, rifleMix(ownShot.start, ears, true).gain);
  assert.equal(ownPan.pan.value, 0);
  ears.ownedWeaponIds = ['tank-new:mg-coax'];
  audio.update(ears);
  assert.equal(ownGain.gain.value, rifleMix(ownShot.start, ears, false).gain);
  assert.ok(ownPan.pan.value > 0, 'old vehicle tail becomes remote immediately');
  assert.notEqual(ownSource.stopped, true);
  audio.reset();
  audio.playBatch(context, [coax(6, 'other')], ears);
  assert.equal(audio.snapshot.history[0].owned, false, 'listing a weapon never relaxes selected soldier matching');
});

test('additional weapon ownership remains one personal tail and eight shared remote voices', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  const primary = event(1, 4, 'player'), secondary = event(2, 5, 'player');
  secondary.source.weaponId = 'tank-current:mg-coax';
  audio.playBatch(context, [primary, secondary], ears);
  assert.equal(audio.snapshot.active, 2);
  ears.ownedWeaponIds = ['tank-current:mg-coax'];
  audio.update(ears);
  assert.equal(audio.snapshot.active, 1, 'reclassifying existing tails cannot open another personal voice');
  assert.equal(context.sources[0].stopped, true);
  for (let id = 3; id <= 11; id++) {
    audio.beginBatch(); audio.playBatch(context, [event(id)], ears);
  }
  assert.equal(audio.snapshot.active, 9);
  assert.equal(audio.snapshot.peakVoices, 9);
  audio.playBatch(context, [primary, secondary], ears);
  assert.equal(audio.snapshot.active, 9, 'primary and secondary replace the same personal channel');
  assert.equal(audio.snapshot.counts.owned, 3);
});

test('optional owned weapon IDs reject malformed lists before changing mixer state', () => {
  const audio = createRifleAudio(buffer), context = fakeContext(), ears = listener();
  for (const ids of [null, 'tank:mg-coax', {}, [null], [''], [12], new Array(1)]) {
    const invalid = { ...ears, ownedWeaponIds: ids };
    assert.throws(() => audio.playBatch(context, [], invalid), /ownedWeaponIds/);
    assert.throws(() => audio.update(invalid), /ownedWeaponIds/);
    assert.throws(() => audio.play(context, event(1), invalid, false), /ownedWeaponIds/);
  }
  assert.equal(audio.snapshot.counts.played, 0);
  assert.equal(context.sources.length, 0);
  assert.equal(audio.playBatch(context, [event(1, 0, 'player')], { ...ears, ownedWeaponIds: [] }), 1);
  assert.equal(audio.snapshot.history[0].owned, true, 'empty additional list preserves primary ownership');
});

test('only explicit friendly ordinary/scoped rifle metadata selects the supplied reports', () => {
  const enemyBuffer = { duration: 3.074 }, machine = { duration: .095 };
  const audio = createRifleAudio(buffer, enemyBuffer, [machine], friendlyReports), context = fakeContext(), ears = listener();
  const cases = [
    ['friendly', 'rifle', 'friendly-rifle'],
    ['friendly', 'sniper', 'friendly-sniper'],
    ['enemy', 'rifle', 'enemy-rifle'],
    ['enemy', 'sniper', 'enemy-rifle'],
    ['friendly', 'machine-gun', 'machine-gun'], ['friendly', 'tank-machine-gun', 'machine-gun'],
    ...['tank-cannon', 'grenade', 'unknown'].map(kind => ['friendly', kind, 'recorded-rifle']),
    [undefined, 'rifle', 'recorded-rifle'], ['friendly', undefined, 'recorded-rifle'], [undefined, undefined, 'recorded-rifle'],
    ['ally', 'rifle', 'recorded-rifle'],
  ];
  for (const [index, [team, weaponClass, expected]] of cases.entries()) {
    const shot = event(index + 1, 0, 'player');
    Object.assign(shot.source, { team, weaponClass });
    audio.play(context, shot, ears, true);
    assert.equal(audio.snapshot.history.at(-1).report, expected);
    assert.equal(context.sources.at(-1).buffer, {
      'recorded-rifle': buffer, 'enemy-rifle': enemyBuffer, 'machine-gun': machine,
      'friendly-rifle': friendlyReports.rifle, 'friendly-sniper': friendlyReports.sniper,
    }[expected]);
    assert.equal(audio.snapshot.active, 1, 'sample changes share the personal-tail replacement policy');
  }
  const legacy = createRifleAudio(buffer);
  const shot = event(50);
  Object.assign(shot.source, { team: 'friendly', weaponClass: 'sniper' });
  legacy.play(fakeContext(), shot, ears, false);
  assert.equal(legacy.snapshot.history[0].report, 'recorded-rifle', 'single-buffer API stays compatible');
  assert.throws(() => createRifleAudio(buffer, buffer, [buffer], { rifle: { duration: 2 } }), /short audio/);
});

test('all sample types share batch, range, replacement, ownership-transfer and reset budgets', () => {
  const audio = createRifleAudio(buffer, buffer, [buffer], friendlyReports), context = fakeContext(), ears = listener();
  const shot = (id, x = 10, soldierId = 'ally') => {
    const value = event(id, x, soldierId);
    Object.assign(value.source, { team: id % 3 === 0 ? 'enemy' : 'friendly',
      weaponClass: id % 3 === 1 ? 'rifle' : 'sniper' });
    return value;
  };
  assert.equal(audio.playBatch(context, [shot(1), shot(2), shot(3), shot(4)], ears), 3);
  assert.deepEqual(audio.snapshot.history.map(item => item.report), ['friendly-rifle', 'friendly-sniper', 'enemy-rifle']);
  assert.equal(audio.snapshot.counts.budget, 1);
  for (let id = 5; id <= 9; id++) {
    audio.beginBatch(); audio.play(context, shot(id, 80 + id), ears, false);
  }
  assert.equal(audio.snapshot.active, 8);
  audio.beginBatch();
  audio.play(context, shot(10, 4), ears, false);
  assert.equal(audio.snapshot.counts.replaced, 1);
  audio.play(context, shot(11, 0, 'player'), ears, true);
  assert.equal(audio.snapshot.active, 9);
  ears.soldierId = 'other'; ears.weaponId = 'other:rifle';
  audio.update(ears);
  assert.equal(audio.snapshot.active, 8);
  assert.equal(audio.snapshot.counts.replaced, 2);
  audio.beginBatch();
  assert.equal(audio.play(context, shot(12, 300), ears, false), false);
  assert.equal(audio.snapshot.counts.range, 1);
  assert.equal(audio.snapshot.peakVoices, 9);
  assert.equal(context.nodes.filter(node => node.kind === 'safety').length, 1, 'one shared bus across samples');
  audio.reset();
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.snapshot.history.length, 0);
  assert.ok(context.sources.every(source => source.stopped));
});

test('loader decodes seven reports and rejects a missing supplied asset instead of pretending it loaded', async t => {
  const originalFetch = globalThis.fetch, originalOffline = globalThis.OfflineAudioContext;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.OfflineAudioContext = originalOffline; });
  const paths = [], decoded = [];
  const wavHeader = () => {
    const bytes = new Uint8Array(16);
    bytes.set([82, 73, 70, 70], 0);
    bytes.set([87, 65, 86, 69], 8);
    return bytes.buffer;
  };
  globalThis.OfflineAudioContext = class {
    async decodeAudioData(bytes) { decoded.push(bytes); return buffer; }
  };
  globalThis.fetch = async path => {
    paths.push(path);
    return { ok: true, arrayBuffer: async () => wavHeader() };
  };
  const audio = await loadRifleAudio();
  assert.equal(decoded.length, 7);
  assert.deepEqual(Object.keys(audio.snapshot.reports), ['fallback', 'friendly-rifle', 'friendly-sniper']);
  assert.ok(paths.some(path => path.endsWith('friendly-rifle-generated/rifle-report.wav')));
  for (const name of ['rifle-report.wav', 'sniper-report.wav']) {
    globalThis.fetch = async path => ({ ok: !path.endsWith(name), status: 404, arrayBuffer: async () => wavHeader() });
    await assert.rejects(loadRifleAudio(), new RegExp(`${name}: HTTP 404`));
  }
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => wavHeader() });
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() { throw new Error('Invalid supplied audio'); }
  };
  await assert.rejects(loadRifleAudio(), /Invalid supplied audio/);
  assert.equal(decoded.length, 19, 'HTTP errors do not reach decoding');
  for (const body of [new TextEncoder().encode('<!doctype html><html>SPA fallback</html>'), new Uint8Array(0)]) {
    globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => body.buffer.slice(0) });
    await assert.rejects(loadRifleAudio(), /report\.wav: expected RIFF\/WAVE audio, received text\/html.*restart the development server/);
  }
});

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

test('supplied report excerpts match provenance, short mono PCM format, gain and mechanical-safe trims', () => {
  const base = new URL('../public/assets/audio/friendly-rifle-generated/', import.meta.url);
  const source = JSON.parse(readFileSync(new URL('source.json', base), 'utf8'));
  assert.equal(source.permission.isCC0, false);
  assert.equal(source.permission.request, '这两个声音 作为我军步枪和狙击枪的声音');
  assert.equal(source.processing.gainDb, -7);
  assert.deepEqual(source.originals.map(item => item.bytes), [40585, 33061]);
  assert.deepEqual(source.originals.map(item => item.sha256), [
    '849703e11808ba5222ed3595c3f2e40de4265ab35eff126e53438d349369b3c7',
    'e7e21ed28abf42b083db7090dfaddbef88e0c5582e65ef4588f7727291aa1b22',
  ]);
  for (const record of source.files) {
    const data = readFileSync(new URL(record.file, base));
    assert.equal(data.length, record.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256);
    if (!record.file.endsWith('.wav')) continue;
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.toString('ascii', 8, 12), 'WAVE');
    assert.equal(data.readUInt16LE(20), 1);
    assert.equal(data.readUInt16LE(22), 1);
    assert.equal(data.readUInt32LE(24), 24000);
    assert.equal(data.readUInt16LE(34), 16);
    assert.equal((data.length - 44) / 2, record.frames);
    assert.equal(record.frames / 24000, record.durationSeconds);
    assert.equal(record.startSeconds, 0);
    assert.equal(data.readInt16LE(44), 0);
    assert.ok(Math.abs(data.readInt16LE(data.length - 2)) <= 2);
    let peak = 0;
    for (let offset = 44; offset < data.length; offset += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(offset)));
    assert.equal(peak / 32768, record.runtimePeak);
    assert.ok(peak > 15000 && peak < 23200);
    const secondaryTransient = record.originalRole === 'friendly-rifle' ? .45 : .30;
    assert.ok(record.durationSeconds < secondaryTransient);
    assert.ok(Math.abs(record.tailFadeStartSeconds + source.processing.tailFadeSeconds - record.durationSeconds) < 1e-12);
  }
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
