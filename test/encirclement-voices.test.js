import test from 'node:test';
import assert from 'node:assert/strict';
import { createEncirclementVoiceTracker } from '../src/encirclement-voices.js';
import { battleVoiceClips } from '../src/battle-voice-lines.js';

const setup = () => ({ tracker: createEncirclementVoiceTracker(),
  match: { phase: 1, supplyInterrupted: false, winner: null },
  points: [{ id: 'A', owner: 'enemy' }], units: [] });
test('supply brief, cut, restoration and encirclement announcements follow actual transitions only', () => {
  const { tracker, match, points, units } = setup();
  assert.deepEqual(tracker.update(match, points, units), ['supply-brief']);
  assert.deepEqual(tracker.update(match, points, units), []);
  points[0].owner = null;
  assert.deepEqual(tracker.update(match, points, units), []);
  points[0].owner = 'friendly'; match.supplyInterrupted = true;
  assert.deepEqual(tracker.update(match, points, units), ['supply-cut']);
  assert.deepEqual(tracker.update(match, points, units), []);
  points[0].owner = 'enemy'; match.supplyInterrupted = false;
  assert.deepEqual(tracker.update(match, points, units), ['supply-restored']);
  match.phase = 2;
  assert.deepEqual(tracker.update(match, points, units), ['encircled', 'reinforcements-blocked', 'cleanup-orders']);
  assert.deepEqual(tracker.update(match, points, units), []);
  match.supplyInterrupted = true;
  assert.deepEqual(tracker.update(match, points, units), [], 'cleanup cannot announce restored enemy reinforcements');
  tracker.reset(); match.phase = 1; match.supplyInterrupted = false;
  assert.deepEqual(tracker.update(match, points, units), ['supply-brief']);
});
test('reinforcement speech waits for actual spawn, handles delayed arrivals once, and never lies about supply', () => {
  const { tracker, match, points, units } = setup();
  tracker.update(match, points, units);
  const unit = { id: 'friendly-6', team: 'friendly', active: true, reinforcement: true, generation: 0 };
  units.push(unit);
  assert.deepEqual(tracker.update(match, points, units), []);
  unit.generation = 1;
  assert.deepEqual(tracker.update(match, points, units), ['reinforcements']);
  unit.generation = 2;
  assert.deepEqual(tracker.update(match, points, units), [], 'ordinary replacement is not a new wave');
  units.push({ ...unit, id: 'friendly-7', generation: 0 });
  match.supplyInterrupted = true; points[0].owner = 'friendly';
  assert.deepEqual(tracker.update(match, points, units), ['supply-cut']);
  units[1].generation = 1;
  assert.deepEqual(tracker.update(match, points, units), ['supply-reinforced']);
  match.winner = 'friendly'; units.push({ ...unit, id: 'friendly-8' });
  assert.deepEqual(tracker.update(match, points, units), []);
});
test('all strategic cues have short friendly stock-male variants without changing Japanese dialogue', () => {
  for (const cue of ['supply-brief', 'supply-cut', 'supply-restored', 'reinforcements', 'supply-reinforced', 'encircled', 'reinforcements-blocked', 'cleanup-orders']) {
    const clips = battleVoiceClips().filter(clip => clip.cue === cue);
    assert.equal(clips.length, 3);
    assert.ok(clips.every(clip => clip.team === 'friendly' && clip.text.length < 50 && clip.locale === 'zh-CN'));
  }
});
