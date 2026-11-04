import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createTacticalFeedbackAudio, FEEDBACK_SOUNDS, shotNearPass, loadTacticalFeedbackAudio } from '../src/tactical-feedback-audio.js';
import { createVehicleAudio, vehicleEngineMix, VEHICLE_ENGINE_FILES } from '../src/vehicle-audio.js';

const listener = { position: { x: 0, y: 1.67, z: 0 }, right: { x: 1, y: 0, z: 0 },
  soldierId: 'player', weaponId: 'player-rifle', vehicleId: null };
function fakeContext() {
  const sources = [], nodes = [];
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => {
    const result = { gain: parameter(), pan: parameter(), frequency: parameter(), Q: parameter(), playbackRate: parameter(),
      connect(next) { this.connected = next; return next; }, disconnect() { this.disconnected = true; } };
    nodes.push(result); return result;
  };
  return { sources, nodes, currentTime: 0, state: 'running', destination: {},
    createGain: node, createStereoPanner: node, createBiquadFilter: node,
    createBufferSource() { const source = Object.assign(node(), {
      start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); },
    }); sources.push(source); return source; } };
}
const feedbackBuffers = () => Object.fromEntries(Object.values(FEEDBACK_SOUNDS)
  .map(definition => [definition.file, { numberOfChannels: 1, duration: .2 }]));
const engineBuffers = () => Object.fromEntries(Object.values(VEHICLE_ENGINE_FILES)
  .map(file => [file, { numberOfChannels: 1, duration: 4 }]));
const shot = (overrides = {}) => ({ type: 'shot', id: 1, time: 1, weaponType: 'infantry',
  source: { soldierId: 'enemy', weaponId: 'enemy-rifle' },
  start: { x: -10, y: 1.67, z: .7 }, end: { x: 10, y: 1.67, z: .7 }, ...overrides });

test('flybys require a real segment passing near and beyond the listener, not a blocked line, endpoint or own shot', () => {
  assert.ok(shotNearPass(shot().start, shot().end, listener.position));
  assert.equal(shotNearPass(shot().start, { x: -2, y: 1.67, z: .7 }, listener.position), null);
  assert.equal(shotNearPass(shot().start, { x: .1, y: 1.67, z: .7 }, listener.position), null);
  assert.equal(shotNearPass({ x: -10, y: 1.67, z: 4 }, { x: 10, y: 1.67, z: 4 }, listener.position), null);
  const audio = createTacticalFeedbackAudio(feedbackBuffers()), context = fakeContext();
  audio.sync(true); audio.beginFrame();
  audio.consume(shot({ source: { soldierId: 'player', weaponId: 'player-rifle' } }), listener);
  audio.flush(context, listener, 1, []);
  assert.equal(context.sources.length, 0);
  audio.consume(shot(), listener); audio.flush(context, listener, 1, []);
  assert.equal(audio.snapshot.history[0].kind, 'flyby');
});

test('observer damage suppresses the matching whiz, takeover drops old-body cues and flesh does not become a material hit', () => {
  const audio = createTacticalFeedbackAudio(feedbackBuffers()), context = fakeContext();
  audio.sync(true); audio.beginFrame(); audio.consume(shot(), listener);
  audio.consume({ type: 'damage', source: shot().source, time: 1, target: { kind: 'soldier', id: 'player' } }, listener);
  audio.consume({ type: 'impact', kind: null }, listener);
  audio.flush(context, listener, 1, []);
  assert.equal(context.sources.length, 0); assert.equal(audio.snapshot.counts.observerHits, 1);
  audio.beginFrame(); audio.consume(shot(), listener);
  audio.flush(context, { ...listener, soldierId: 'next-member' }, 1, []);
  assert.equal(context.sources.length, 0);
});

test('material and river feedback use bounded voices, group routing and immediate pause/reset cleanup', () => {
  const audio = createTacticalFeedbackAudio(feedbackBuffers()), context = fakeContext();
  audio.sync(true);
  for (let frame = 0; frame < 3; frame++) {
    audio.beginFrame();
    for (let index = 0; index < 30; index++) audio.emit('hit-wood', { x: 2, y: 1, z: 0 }, frame * .1, `${frame}-${index}`);
    audio.flush(context, listener, frame * .1, []);
    assert.ok(audio.snapshot.active <= 8);
  }
  assert.ok(audio.snapshot.counts.budget > 0);
  assert.equal(audio.snapshot.history[0].group, 'weapons');
  audio.sync(false);
  assert.equal(audio.snapshot.active, 0); assert.equal(audio.snapshot.queued, 0);
  audio.reset(); assert.equal(audio.snapshot.history.length, 0);
  assert.ok(context.sources.every(source => source.stopped && source.disconnected));
});

test('only actual deep-water contact creates a splash and depth-limited sinking sounds', () => {
  const audio = createTacticalFeedbackAudio(feedbackBuffers()), context = fakeContext();
  audio.sync(true);
  const plane = { id: 'plane', position: { x: 4, y: .1, z: 0 }, fall: { sinking: true, waterLevel: 0, sunk: false } };
  assert.equal(audio.waterCrash({ ...plane, fall: { grounded: true } }, 1), false);
  assert.equal(audio.waterCrash(plane, 1), true); assert.equal(audio.waterCrash(plane, 1), false);
  audio.flush(context, listener, 1, [plane]);
  plane.position.y = -1;
  audio.flush(context, listener, 1.5, [plane]);
  assert.ok(audio.snapshot.history.some(event => event.kind === 'water-crash'));
  assert.ok(audio.snapshot.history.some(event => event.kind === 'bubbles'));
  const before = audio.snapshot.counts.played;
  plane.fall.sunk = true; audio.flush(context, listener, 2, [plane]);
  assert.equal(audio.snapshot.counts.played, before);
});

test('returning oars splash only on blade entry into actual water, never while hovering or docked', () => {
  const audio = createTacticalFeedbackAudio(feedbackBuffers()), context = fakeContext();
  const ferry = new THREE.Group(), oar = new THREE.Group(); ferry.add(oar);
  ferry.userData = { state: 'inbound', ferryId: 0, oar }; oar.userData.bladeTip = [0, 0, 0];
  audio.sync(true); oar.position.y = .3;
  audio.rower(ferry, 1, () => 0, () => true); audio.flush(context, listener, 1, []);
  assert.equal(audio.snapshot.counts.played, 0);
  oar.position.y = -.1;
  audio.rower(ferry, 2, () => 0, () => true); audio.flush(context, listener, 2, []);
  assert.equal(audio.snapshot.history[0].kind, 'oar');
  audio.rower(ferry, 2.1, () => 0, () => true); audio.flush(context, listener, 2.1, []);
  assert.equal(audio.snapshot.counts.played, 1);
  ferry.userData.state = 'docked';
  audio.rower(ferry, 3, () => 0, () => true); audio.flush(context, listener, 3, []);
  assert.equal(audio.snapshot.counts.played, 1);
});

test('maps without boats or deep water fetch only common feedback clips', async () => {
  const previousAudio = globalThis.OfflineAudioContext, previousFetch = globalThis.fetch, requested = [];
  globalThis.OfflineAudioContext = class { async decodeAudioData() { return { numberOfChannels: 1, duration: .2 }; } };
  globalThis.fetch = async path => {
    requested.push(path);
    return { ok: true, async arrayBuffer() { return new ArrayBuffer(8); } };
  };
  try {
    const dry = await loadTacticalFeedbackAudio();
    assert.equal(dry.snapshot.available.length, 5);
    assert.ok(requested.every(path => !/oar|water-crash|bubbles|deck-step|submerged-metal/.test(path)));
    const river = await loadTacticalFeedbackAudio({ water: true, ferries: true });
    assert.equal(river.snapshot.available.length, 10);
  } finally { globalThis.OfflineAudioContext = previousAudio; globalThis.fetch = previousFetch; }
});

const vehicle = (id = 'tank', type = 'tank', x = 5) => ({ id, type, health: 100, engineOn: true,
  position: { x, y: 0, z: 0 }, speed: 0, throttle: .65 });
test('engine load follows real motion, steering and throttle while occupancy centres and muffles the source', () => {
  const tank = vehicle(), idle = vehicleEngineMix(tank, listener, null, 0);
  tank.groundMotion = { x: 4, z: 0, turn: 0 };
  assert.ok(vehicleEngineMix(tank, listener, null, 0).rate > idle.rate);
  tank.groundMotion = { x: 0, z: 0, turn: 1 };
  assert.ok(vehicleEngineMix(tank, listener, null, 0).rate > idle.rate);
  const owned = vehicleEngineMix(tank, { ...listener, vehicleId: 'tank' }, null, 0);
  assert.equal(owned.pan, 0); assert.equal(owned.cutoff, 1000);
  const plane = vehicle('plane', 'plane'); plane.speed = 48; plane.throttle = .2;
  const low = vehicleEngineMix(plane, listener, null, 0);
  plane.throttle = 1;
  assert.ok(vehicleEngineMix(plane, listener, null, 0).rate > low.rate);
});

test('only three engine loops play, owned vehicles win priority and Y/F never recreates or mutates a surviving vehicle', () => {
  const context = fakeContext(), audio = createVehicleAudio(engineBuffers());
  const effects = { name: 'effects-bus' }; audio.setOutput(effects);
  const vehicles = Array.from({ length: 5 }, (_, index) => vehicle(`tank-${index}`, 'tank', 4 + index));
  const before = JSON.stringify(vehicles), ownListener = { ...listener, vehicleId: 'tank-4' };
  audio.update(context, vehicles, ownListener, 0, true);
  assert.equal(audio.snapshot.active, 3); assert.ok(audio.snapshot.voices.some(voice => voice.owned));
  const ownedSource = context.sources.find(source => source.loop);
  assert.equal(ownedSource.connected.connected.connected.connected, effects);
  audio.update(context, vehicles, { ...ownListener, soldierId: 'gunner' }, .05, true);
  assert.equal(context.sources.length, 3); assert.equal(ownedSource.stopped, undefined);
  assert.equal(JSON.stringify(vehicles), before);
  vehicles.forEach(record => record.health = 0);
  audio.update(context, vehicles, ownListener, .1, true);
  assert.equal(audio.snapshot.active, 0);
  assert.ok(context.sources.every(source => source.stopped && source.disconnected));
  audio.reset(); assert.equal(audio.snapshot.history.length, 0);
});

test('new assets have exact hashes, small mono buffers and explicit per-engine attribution/share-alike licenses', async () => {
  for (const directory of ['tactical-feedback', 'vehicle-engines']) {
    const root = new URL(`../public/assets/audio/${directory}/`, import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
    for (const record of manifest.files) {
      const bytes = await readFile(new URL(record.file, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      if (record.file.endsWith('.wav')) {
        assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
        assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 24000);
      }
    }
    if (directory === 'vehicle-engines') {
      const credits = await readFile(new URL('ATTRIBUTION.txt', root), 'utf8');
      assert.match(credits, /CC BY-SA 4.0/); assert.match(credits, /Nayckron/); assert.match(credits, /Versatile Virtuoso/);
    }
  }
});
