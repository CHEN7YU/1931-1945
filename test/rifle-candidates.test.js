import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../audio-study/assets/', import.meta.url);
test('free rifle candidates retain source identity and do not claim historical cartridge authenticity', async () => {
  const metadata = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(metadata.license, 'CC0-1.0');
  assert.match(metadata.licenseEvidence, /CC0 NO RIGHTS RESERVED/);
  assert.equal(metadata.files.length, 3);
  assert.match(metadata.files[1].note, /\.30-06/);
  assert.match(metadata.files[2].note, /7.62×54/);
  assert.match(metadata.use, /not loaded by the game/);
  assert.equal(metadata.feedback.preferredReference, 'current.wav');
  assert.deepEqual(metadata.feedback.rejectedCandidates, ['arisaka-near.wav', 'mosin-near.wav']);
  assert.ok(metadata.limitations.some(item => item.includes('full-scale')));
  const license = await readFile(new URL('LICENSE.txt', root), 'utf8');
  assert.match(license, /Ben Jaszczak/);
  assert.match(license, /kurt/);
  assert.match(license, /personal or professional/);
});

test('all three excerpts have matched actual PCM RMS, bounded peaks and short downloads', async () => {
  const metadata = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  const levels = [];
  for (const entry of metadata.files) {
    const data = await readFile(new URL(entry.file, root));
    assert.equal(data.length, entry.bytes);
    assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
    assert.match(entry.original.sha256, /^[a-f0-9]{64}$/);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    assert.equal(data.readUInt16LE(20), 1);
    assert.equal(data.readUInt16LE(22), 1);
    assert.equal(data.readUInt32LE(24), 24000);
    assert.equal(data.readUInt16LE(34), 16);
    assert.equal(data.readUInt32LE(40), 28800);
    const samples = Array.from({ length: 14400 }, (_, i) => data.readInt16LE(44 + i * 2) / 32767);
    assert.ok(samples.every(value => Math.abs(value) <= .701));
    assert.ok(Math.abs(samples[0]) < .001);
    assert.ok(Math.abs(samples.at(-1)) < .001);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    assert.ok(Math.abs(20 * Math.log10(rms / metadata.targetRms)) < .01);
    levels.push(rms);
  }
  assert.ok(20 * Math.log10(Math.max(...levels) / Math.min(...levels)) < .01);
});
