import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceEncirclement, createEncirclement, recordEncirclementEscape, EAST_BREAKOUT } from '../src/encirclement.js';

function fixture(count) {
  const unit = { id: 'enemy', team: 'enemy', type: 'infantry', active: true,
    members: Array.from({ length: count }, (_, index) => ({ id: `soldier-${index}`, health: 100 })) };
  const points = ['A', 'B', 'C'].map(id => ({ id, owner: 'friendly' }));
  const match = createEncirclement(), formations = [unit];
  advanceEncirclement(match, points, formations);
  return { match, formations, points, members: unit.members };
}
test('the phase-entry denominator is fixed and integer thresholds allow at most one third to escape', () => {
  for (let count = 1; count <= 40; count++) {
    const f = fixture(count), required = Math.ceil(count * 2 / 3), allowed = Math.floor(count / 3);
    assert.equal(f.match.breakout.strength, count);
    assert.equal(f.match.breakout.requiredKills, required);
    assert.equal(f.match.breakout.escapeLimit, allowed);
    for (const member of f.members.slice(0, required - 1)) member.health = 0;
    assert.equal(advanceEncirclement(f.match, f.points, f.formations), null);
    f.members[required - 1].health = 0;
    assert.equal(advanceEncirclement(f.match, f.points, f.formations), 'friendly');
    assert.equal(f.match.breakout.strength, count);
  }
});
test('escaped enemies are never counted as killed and passing the allowed escape count loses the blocking mission', () => {
  const f = fixture(30);
  for (const member of f.members.slice(0, 10)) assert.equal(recordEncirclementEscape(f.match, member.id), true);
  assert.equal(advanceEncirclement(f.match, f.points, f.formations), null);
  assert.equal(f.match.breakout.killed, 0);
  assert.equal(recordEncirclementEscape(f.match, f.members[0].id), false);
  assert.equal(recordEncirclementEscape(f.match, 'untracked-aircraft'), false);
  assert.equal(recordEncirclementEscape(f.match, f.members[10].id), true);
  assert.equal(advanceEncirclement(f.match, f.points, f.formations), 'enemy');
  const victory = fixture(30);
  for (const member of victory.members.slice(0, 10)) recordEncirclementEscape(victory.match, member.id);
  for (const member of victory.members.slice(10)) member.health = 0;
  assert.equal(advanceEncirclement(victory.match, victory.points, victory.formations), 'friendly');
  assert.equal(victory.match.breakout.killed, 20);
});
test('ground crews count but airborne pilots do not; stale point ownership never starts phase-two recapture defeat', () => {
  const f = fixture(3);
  f.match = createEncirclement();
  f.formations.push({ id: 'armor', team: 'enemy', type: 'tank', members: [{ id: 'crew', health: 100, vehicleId: 'tank' }] },
    { id: 'air', team: 'enemy', type: 'plane', members: [{ id: 'pilot', health: 100, vehicleId: 'plane' }] });
  advanceEncirclement(f.match, f.points, f.formations);
  assert.equal(f.match.breakout.strength, 4);
  for (const point of f.points) point.owner = 'enemy';
  assert.equal(advanceEncirclement(f.match, f.points, f.formations, 100), null);
  assert.equal(f.match.enemyControlSeconds, 0);
  assert.equal(f.match.breakout.stage, 'breakout');
  assert.ok(EAST_BREAKOUT.regroupSeconds > 0);
});
