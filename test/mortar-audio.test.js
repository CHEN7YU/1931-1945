import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MORTAR } from '../src/mortar.js';
import { EXPLOSIVE_PACK } from '../src/grenades.js';
import { playMortarLaunch } from '../src/mortar-audio.js';

test('mortar blast uses the explosive-pack damage and radius, with exact CC0 sound provenance', () => {
  assert.equal(MORTAR.damage, EXPLOSIVE_PACK.damage);
  assert.equal(MORTAR.radius, EXPLOSIVE_PACK.radius);
  assert.equal(MORTAR.blastKind, 'explosive-pack');
  const root = new URL('../public/assets/audio/mortar/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('source.json', root)));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.equal(manifest.author, 'Thimras');
  for (const record of manifest.files) {
    const bytes = readFileSync(new URL(record.file, root));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
  }
});
test('mortar launch uses the weapons volume group and plays a decoded buffer, not an empty event', () => {
  const calls = [], buffer = {};
  const source = { connect() { return this; }, start() { calls.push('start'); } };
  const gain = { gain: { value: 0 }, connect() { return this; } };
  const context = { state: 'running', createBufferSource: () => source, createGain: () => gain };
  const mixer = { output(group) { calls.push(group); return {}; }, track(actual, nodes, group) {
    assert.equal(actual, source); assert.deepEqual(nodes, [gain]); assert.equal(group, 'weapons');
  } };
  assert.equal(playMortarLaunch(context, buffer, mixer), true);
  assert.equal(source.buffer, buffer);
  assert.deepEqual(calls, ['weapons', 'start']);
  assert.equal(playMortarLaunch({ ...context, state: 'suspended' }, buffer, mixer), false);
});
