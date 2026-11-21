import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceBreakoutGroups,breakoutGroupNumber,breakoutGroupDestination,
  BREAKOUT_REGROUP_POINTS,BREAKOUT_COUNTERATTACK_POINT} from '../src/breakout-groups.js';
import {EAST_BREAKOUT} from '../src/encirclement.js';
import {PREVIEW_OBJECTIVES,makeTownPreviewLayout} from '../src/town-preview-layout.js';
import {circleBlocked,createNavigator} from '../src/core.js';

test('Japanese regroup northwest of A, then counterattack toward C instead of meeting defenders on the same route',()=>{
  const a=PREVIEW_OBJECTIVES.find(point=>point.id==='A'),c=PREVIEW_OBJECTIVES.find(point=>point.id==='C');
  const town=makeTownPreviewLayout(),navigate=createNavigator(town.obstacles,1,.46);
  assert.equal(BREAKOUT_REGROUP_POINTS.length,3);
  for(const [index,point] of BREAKOUT_REGROUP_POINTS.entries()){
    assert.deepEqual(breakoutGroupDestination(index),point);
    assert.ok(point.x<a.x&&point.z<a.z,'every rally point is northwest of A');
    assert.ok(Math.hypot(point.x-a.x,point.z-a.z)<30,'rallies remain beside A rather than near C');
    assert.equal(circleBlocked(point.x,point.z,.46,town.obstacles),false,'rally point has physical clearance');
    const path=navigate({x:-28,z:-46},point);
    assert.ok(path.length>0,`Japanese base can reach rally ${index}`);
    assert.deepEqual(path.at(-1),point);
  }
  assert.deepEqual(BREAKOUT_COUNTERATTACK_POINT,{x:EAST_BREAKOUT.x-4,z:EAST_BREAKOUT.z});
  assert.ok(BREAKOUT_COUNTERATTACK_POINT.x<c.x+EAST_BREAKOUT.halfWidth);
});

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
