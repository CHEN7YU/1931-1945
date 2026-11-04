import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { SIGNAL_CLIPS, createBattleSignals, advancingSignalGroups } from '../src/battle-signals.js';

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
test('actual advancing units produce distinct recorded signals, with bounded overlap, cooldown and pause cleanup', () => {
  const buffers = Object.fromEntries(SIGNAL_CLIPS.map(clip => [clip.file, { duration: 1, numberOfChannels: 1 }]));
  const audio = createBattleSignals(buffers), ctx = context(), actors = [...soldiers('friendly'), ...soldiers('enemy')];
  assert.equal(audio.update(ctx, actors, listener, 3, true), null);
  assert.equal(audio.update(ctx, actors, listener, 4, true).file, 'friendly-bugle.wav');
  assert.equal(audio.update(ctx, actors, listener, 10, true), null, 'a playing signal cannot be overlapped');
  ctx.sources[0].onended();
  assert.equal(audio.update(ctx, actors, listener, 10, true).file, 'enemy-whistle.wav');
  audio.sync(false); assert.equal(audio.snapshot.active, false);
  assert.equal(audio.update(ctx, actors, listener, 20, false), null);
  for (const actor of actors) actor.health = 0;
  assert.equal(audio.update(ctx, actors, listener, 60, true), null);
  audio.reset(); assert.equal(audio.snapshot.history.length, 0);
});
test('retreats, isolated soldiers, vehicles, standing guards and distant advances do not invent attack signals', () => {
  const actors = soldiers('enemy');
  assert.equal(advancingSignalGroups(actors.slice(0, 1), listener).length, 0);
  for (const actor of actors) actor.tactics.mode = 'nanjing-retreat';
  assert.equal(advancingSignalGroups(actors, listener).length, 0);
  for (const actor of actors) { actor.tactics.mode = 'advance'; actor.position.x = 200; }
  assert.equal(advancingSignalGroups(actors, listener).length, 0);
});
test('signal recordings are real local PCM audio with checked licensed provenance', async () => {
  const root = new URL('../public/assets/audio/battle-signals/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(manifest.sources[1].license, 'CC0-1.0');
  assert.match(manifest.sources[0].license, /Public-Domain/);
  for (const record of manifest.files) {
    const bytes = await readFile(new URL(record.file, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.ok(bytes.length > 20000);
  }
});
