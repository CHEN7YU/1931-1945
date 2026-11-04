import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SIGNAL_CLIPS, SIGNAL_LIMITS, createBattleSignals, advancingSignalGroups, loadBattleSignals } from '../src/battle-signals.js';

const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 } };
const soldiers = team => [0, 1].map(index => ({ id: `${team}-${index}`, unitId: team, team,
  health: 100, vehicleId: null, groundType: 'infantry', position: { x: 5 + index, y: 0, z: 0 },
  locomotion: { speed: 2 }, tactics: { mode: 'advance' } }));
function context() {
  const sources = [], parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ gain: parameter(), pan: parameter(), connect(next) { return next; }, disconnect() {} });
  return { state: 'running', currentTime: 0, destination: {}, sources, createGain: node, createStereoPanner: node,
    createBufferSource() { const source = { connect: node().connect, disconnect() {}, start() {},
      stop() { this.onended?.(); } }; sources.push(source); return source; } };
}
test('only actual enemy advances produce whistles, with bounded overlap, cooldown and pause cleanup', () => {
  const buffers = Object.fromEntries(SIGNAL_CLIPS.map(clip => [clip.file, { duration: 1, numberOfChannels: 1 }]));
  const audio = createBattleSignals(buffers), ctx = context(), actors = [...soldiers('friendly'), ...soldiers('enemy')];
  assert.equal(audio.update(ctx, actors, listener, 3, true), null);
  assert.equal(audio.update(ctx, actors, listener, 4, true), null, 'friendly units never sound a bugle');
  assert.equal(audio.update(ctx, actors, listener, 7, true).file, 'enemy-whistle.wav');
  assert.equal(audio.update(ctx, actors, listener, 17, true), null, 'a playing signal cannot be overlapped');
  ctx.sources[0].onended();
  assert.equal(audio.update(ctx, actors, listener, 17, true).file, 'enemy-whistle.wav');
  audio.sync(false); assert.equal(audio.snapshot.active, false);
  assert.equal(audio.update(ctx, actors, listener, 20, false), null);
  for (const actor of actors) actor.health = 0;
  assert.equal(audio.update(ctx, actors, listener, 60, true), null);
  audio.reset(); assert.equal(audio.snapshot.history.length, 0);
});
test('retreats, isolated soldiers, vehicles, standing guards and distant advances do not invent attack signals', () => {
  assert.equal(advancingSignalGroups(soldiers('friendly'), listener).length, 0);
  const actors = soldiers('enemy');
  assert.equal(advancingSignalGroups(actors.slice(0, 1), listener).length, 0);
  for (const actor of actors) actor.tactics.mode = 'nanjing-retreat';
  assert.equal(advancingSignalGroups(actors, listener).length, 0);
  for (const actor of actors) { actor.tactics.mode = 'advance'; actor.position.x = 200; }
  assert.equal(advancingSignalGroups(actors, listener).length, 0);
});
test('enemy whistles recur more frequently during a sustained real advance, never overlap or leak into a retreat', () => {
  const buffers = Object.fromEntries(SIGNAL_CLIPS.map(clip => [clip.file, { duration: .82, numberOfChannels: 1 }]));
  const audio = createBattleSignals(buffers), ctx = context(), actors = soldiers('enemy'), times = [];
  for (let time = 0; time <= 40; time += .25) {
    const report = audio.update(ctx, actors, listener, time, true);
    if (report) { times.push(time); ctx.sources.at(-1).onended(); }
  }
  assert.equal(SIGNAL_LIMITS.enemyCooldown, 10);
  assert.equal(Object.hasOwn(SIGNAL_LIMITS, 'friendlyCooldown'), false);
  assert.ok(times.length >= 4, 'sustained nearby advance should produce four spaced whistles in 40 seconds');
  for (let index = 1; index < times.length; index++)
    assert.ok(times[index] - times[index - 1] >= 10 && times[index] - times[index - 1] < 11);
  for (const actor of actors) actor.tactics.mode = 'retreat';
  assert.equal(audio.update(ctx, actors, listener, 60, true), null);
});
test('signal recordings are real local PCM audio with checked licensed provenance', async () => {
  const root = new URL('../public/assets/audio/battle-signals/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(manifest.sources[0].license, 'CC0-1.0');
  assert.deepEqual((await readdir(root)).sort(), ['enemy-whistle.wav', 'source.json']);
  for (const record of manifest.files) {
    const bytes = await readFile(new URL(record.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.ok(bytes.length > 20000);
    let dataOffset = null, dataSize = 0, sampleRate = 0;
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.subarray(offset, offset + 4).toString(), size = bytes.readUInt32LE(offset + 4);
      if (kind === 'fmt ') sampleRate = bytes.readUInt32LE(offset + 12);
      if (kind === 'data') { dataOffset = offset + 8; dataSize = Math.min(size, bytes.length - dataOffset); break; }
      offset += 8 + size + size % 2;
    }
    assert.ok(dataOffset !== null && sampleRate === 24000);
    assert.ok(dataSize / (sampleRate * 2) >= 1.9 && dataSize / (sampleRate * 2) <= 2.2);
    let energy = 0, count = 0;
    for (let sample = Math.floor(sampleRate * 1.1); sample < Math.floor(sampleRate * 1.5); sample++) {
      energy += bytes.readInt16LE(dataOffset + sample * 2) ** 2; count++;
    }
    assert.ok(Math.sqrt(energy / count) > 1000, 'the longer whistle contains sustained sound, not padding or only a room-reverb tail');
  }
});
test('the loader downloads and decodes only the remaining enemy whistle', async t => {
  const original = globalThis.OfflineAudioContext, requests = [];
  globalThis.OfflineAudioContext = class {
    async decodeAudioData() { return { duration: .82, numberOfChannels: 1 }; }
  };
  t.after(() => {
    if (original === undefined) delete globalThis.OfflineAudioContext;
    else globalThis.OfflineAudioContext = original;
  });
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
  await loadBattleSignals();
  assert.deepEqual(requests, ['/assets/audio/battle-signals/enemy-whistle.wav']);
  assert.deepEqual(SIGNAL_CLIPS, [{ team: 'enemy', file: 'enemy-whistle.wav' }]);
});
