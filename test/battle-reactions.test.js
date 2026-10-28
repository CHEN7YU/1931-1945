import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createBattleReactions, battleReactionCue, reactionClips } from '../src/battle-reactions.js';

const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 }, soldierId: 'player' };
const actor = (id = 'ally', team = 'friendly') => ({ id, team, health: 100, groundType: 'infantry', vehicleId: null,
  position: { x: 3, y: 0, z: 0 }, locomotion: { speed: 3 },
  tactics: { mode: 'assault', lastSeen: { x: 10, y: 0, z: 0 }, forgetAt: 50, suppressedUntil: 0 } });
const damage = soldier => ({ type: 'damage', time: 1, amount: 10, health: soldier.health,
  target: { kind: 'soldier', id: soldier.id }, source: { credit: 'enemy' } });
function setup(occluded = () => false) {
  const nodes = [], sources = [];
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => {
    const result = { gain: param(), frequency: param(), pan: param(), disconnected: false,
      connect(next) { return next; }, disconnect() { this.disconnected = true; } };
    nodes.push(result); return result;
  };
  const context = { state: 'running', currentTime: 0, destination: {},
    createGain: node, createBiquadFilter: node, createStereoPanner: node,
    createBufferSource() {
      const source = Object.assign(node(), { start() {}, stop() { this.stopped = true; this.onended?.(); } });
      sources.push(source); return source;
    } };
  const buffers = Object.fromEntries(reactionClips().map(clip => [clip.file, { duration: .5, numberOfChannels: 1 }]));
  const audio = createBattleReactions(buffers, () => 0, occluded); audio.sync(true);
  return { audio, context, nodes, sources };
}

test('real reactions have 18 hash-verified short mono recordings and explicit CC0 provenance', async () => {
  const base = new URL('../public/assets/audio/battle-reactions/', import.meta.url);
  const source = JSON.parse(await readFile(new URL('source.json', base), 'utf8'));
  assert.equal(source.license, 'CC0-1.0');
  assert.equal(source.author, 'HaelDB');
  assert.equal(source.files.length, 18);
  assert.match(source.limitations.join(' '), /not Chinese\/Japanese/);
  for (const clip of reactionClips()) {
    const record = source.files.find(item => item.file === clip.file);
    const bytes = await readFile(new URL(clip.file, base));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(bytes.length, record.bytes);
    assert.equal(bytes.readUInt16LE(22), 1); assert.equal(bytes.readUInt32LE(24), 24000);
    assert.ok(record.duration >= .08 && record.duration <= 2);
    assert.equal(bytes.readInt16LE(44), 0); assert.equal(bytes.readInt16LE(bytes.length - 2), 0);
  }
});

test('charge requires actual close combat movement, not routine marching; suppression takes priority', () => {
  const soldier = actor();
  assert.equal(battleReactionCue(soldier, 2), 'charge');
  assert.equal(battleReactionCue({ ...soldier, tactics: { ...soldier.tactics, mode: 'formation-advance' } }, 2), null);
  assert.equal(battleReactionCue({ ...soldier, locomotion: { speed: 0 } }, 2), null);
  assert.equal(battleReactionCue({ ...soldier, tactics: { ...soldier.tactics, forgetAt: 1 } }, 2), null);
  soldier.tactics.suppressedUntil = 5;
  assert.equal(battleReactionCue(soldier, 2), 'cover');
  assert.equal(battleReactionCue({ ...soldier, vehicleId: 'tank' }, 2), null);
  assert.equal(battleReactionCue({ ...soldier, health: 0 }, 2), null);
});

test('damage is immediate, bounded, not queued, and gives priority speech the channel', () => {
  const { audio, context, sources } = setup(), soldier = actor();
  assert.equal(audio.damage(context, damage(soldier), soldier, listener, true), false);
  assert.equal(audio.damage(context, damage(soldier), soldier, listener), true);
  assert.equal(audio.snapshot.counts.hurt, 1);
  assert.equal(audio.damage(context, damage(soldier), soldier, listener), false);
  audio.update(context, [soldier], listener, 1, true);
  assert.equal(audio.snapshot.active, 0); assert.ok(sources[0].stopped);
  audio.update(context, [soldier], listener, 2);
  assert.equal(audio.snapshot.active, 0, 'dropped damage never replays');
  assert.equal(audio.damage(context, { ...damage(soldier), time: 10 }, soldier, listener), true);
  assert.notEqual(audio.snapshot.history[0].file, audio.snapshot.history.at(-1).file, 'takes alternate');
});

test('only new state transitions trigger short calls; no continuing-state spam or deferred queue', () => {
  const { audio, context, sources } = setup(), soldier = actor('enemy', 'enemy');
  audio.update(context, [soldier], listener, 1);
  assert.equal(audio.snapshot.counts.charge, 1);
  sources[0].onended();
  audio.update(context, [soldier], listener, 20);
  assert.equal(audio.snapshot.counts.charge, 1);
  soldier.tactics.suppressedUntil = 30;
  audio.update(context, [soldier], listener, 20.1);
  assert.equal(audio.snapshot.counts.cover, 1);
  audio.sync(false); assert.equal(audio.snapshot.active, 0);
  audio.reset(); assert.equal(audio.snapshot.history.length, 0);
  assert.equal(audio.snapshot.counts.cover, 0);
});

test('player damage can react but routine player movement, boundary damage, vehicle crew and distant actors cannot', () => {
  const { audio, context } = setup(), player = actor('player');
  audio.update(context, [player], listener, 1);
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.damage(context, { ...damage(player), source: { credit: 'environment' } }, player, listener), false);
  assert.equal(audio.damage(context, damage(player), { ...player, vehicleId: 'tank' }, listener), false);
  assert.equal(audio.damage(context, damage(player), { ...player, position: { x: 36, y: 0, z: 0 } }, listener), false);
  assert.equal(audio.damage(context, damage(player), player, listener), true);
});

test('occlusion muffles reactions and active spatial mixing follows listener turns', () => {
  let blocked = true;
  const { audio, context, nodes } = setup(() => blocked), soldier = actor();
  audio.damage(context, damage(soldier), soldier, listener);
  const filter = nodes.find(node => node.frequency.value === 1200);
  assert.ok(filter);
  blocked = false;
  audio.update(context, [soldier], { ...listener, right: { x: -1, y: 0, z: 0 } }, 1.1);
  assert.ok(filter.frequency.value > 1200);
  assert.ok(nodes.some(node => node.pan.value < 0));
  audio.sync(false);
  assert.ok(nodes.every(node => node.disconnected));
});
