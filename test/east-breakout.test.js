import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceEncirclement, createEncirclement, recordEncirclementEscape, EAST_BREAKOUT,registerBreakoutStrength,crossedEastGate } from '../src/encirclement.js';

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
test('only an eastward crossing through the C gate aperture qualifies for a later escape',()=>{
  assert.equal(crossedEastGate({x:55,y:0,z:3},{x:57,y:0,z:3}),true);
  assert.equal(crossedEastGate({x:55,y:0,z:12},{x:57,y:0,z:12}),false);
  assert.equal(crossedEastGate({x:57,y:0,z:3},{x:55,y:0,z:3}),false);
  assert.equal(crossedEastGate({x:60,y:0,z:3},{x:63,y:0,z:3}),false);
  assert.equal(crossedEastGate({x:55,y:8,z:3},{x:57,y:8,z:3}),false);
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

test('second-stage restoration cannot win on the old small denominator and retains kills made during assembly',()=>{
  const f=fixture(3);f.match=createEncirclement();
  advanceEncirclement(f.match,f.points,f.formations,0,{restoreForces:true});
  f.members[0].health=0;
  assert.equal(advanceEncirclement(f.match,f.points,f.formations,100),null);
  assert.equal(f.match.breakout.elapsed,0);
  const added=Array.from({length:67},(_,index)=>({id:`new-${index}`,health:100}));
  f.members.push(...added);
  registerBreakoutStrength(f.match,added.map(actor=>actor.id),true);
  assert.equal(f.match.breakout.strength,70);
  assert.equal(f.match.breakout.requiredKills,47);
  advanceEncirclement(f.match,f.points,f.formations,0);
  assert.equal(f.match.breakout.killed,1);
});
