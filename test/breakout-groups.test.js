import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceBreakoutGroups,breakoutGroupNumber,breakoutGroupDestination} from '../src/breakout-groups.js';

test('paired infantry squads form three physical groups and cannot release during the defense countdown',()=>{
  const formations=Array.from({length:6},(_,index)=>({team:'enemy',type:'infantry',index,
    members:Array.from({length:11},(_,member)=>({id:`${index}:${member}`,health:100,
      position:{...breakoutGroupDestination(breakoutGroupNumber({index}))}}))}));
  const match={phase:2,breakout:{stage:'regroup',initialIds:formations.flatMap(unit=>unit.members.map(actor=>actor.id)),escapedIds:[]}};
  const groups=advanceBreakoutGroups(formations,match,10);
  assert.ok(groups.every(group=>!group.released&&group.ready===22));
  match.breakout.stage='breakout';
  advanceBreakoutGroups(formations,match,20);
  assert.ok(groups.every(group=>group.released));
  assert.equal(new Set(formations.map(breakoutGroupNumber)).size,3);
});

test('a late isolated member cannot hold a whole group indefinitely but the group waits briefly to gather',()=>{
  const unit={team:'enemy',type:'infantry',index:0,members:[{id:'one',health:100,position:{x:-70,z:60}}]};
  const match={phase:2,breakout:{stage:'breakout',initialIds:['one'],escapedIds:[]}};
  const groups=advanceBreakoutGroups([unit],match,20);
  assert.equal(groups[0].released,false);
  advanceBreakoutGroups([unit],match,34.9);assert.equal(groups[0].released,false);
  advanceBreakoutGroups([unit],match,35);assert.equal(groups[0].released,true);
});
