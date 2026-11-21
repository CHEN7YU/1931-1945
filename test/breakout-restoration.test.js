import test from 'node:test';
import assert from 'node:assert/strict';
import {breakoutRestorationPlan,hiddenBreakoutPositions,breakoutSpawnAttempts} from '../src/breakout-restoration.js';
import {RIVER,riverSectionAt} from '../src/ground.js';
import {PREVIEW_OBJECTIVES,makeTownPreviewLayout} from '../src/town-preview-layout.js';
import {circleBlocked,createNavigator} from '../src/core.js';

test('breakout restoration preserves living remnants and restores eight infantry, one tank and one air squad',()=>{
  const formations=Array.from({length:6},(_,index)=>({id:`enemy-${index}`,index,team:'enemy',type:'infantry',
    members:Array.from({length:index},()=>({health:100}))}));
  formations.push({id:'tank',team:'enemy',type:'tank',members:[{health:0}]},
    {id:'air',team:'enemy',type:'plane',members:[{health:100,vehicleId:'aircraft'}]});
  const before=JSON.stringify(formations),plan=breakoutRestorationPlan(formations);
  assert.equal(plan.filter(unit=>unit.type==='infantry').length,8);
  assert.equal(plan.filter(unit=>unit.type==='tank').length,1);
  assert.equal(plan.filter(unit=>unit.type==='plane').length,1);
  for(let index=0;index<6;index++)assert.equal(plan[index].required,11-index);
  assert.deepEqual(plan.slice(6,8).map(unit=>({id:unit.id,index:unit.index,required:unit.required})),
    [{id:'enemy-6',index:6,required:11},{id:'enemy-7',index:7,required:11}]);
  assert.equal(plan.find(unit=>unit.id==='air').required,0);
  assert.equal(JSON.stringify(formations),before);
});
test('hidden breakout candidates exclude close, visible and solid locations without replacing absent space with a visible spawn',()=>{
  const player={x:0,z:0};
  const points=hiddenBreakoutPositions(player,point=>point.x>0,point=>point.z<0);
  assert.ok(points.length);
  assert.ok(points.every(point=>point.x<=0&&point.z<0&&Math.hypot(point.x,point.z)>=28));
  assert.deepEqual(hiddenBreakoutPositions(player,()=>true,()=>true),[]);
});

test('ground reinforcements prefer the northwest of A beyond the north riverbank, falling back when the player is nearby',()=>{
  const a=PREVIEW_OBJECTIVES.find(point=>point.id==='A');
  const town=makeTownPreviewLayout(),navigate=createNavigator(town.obstacles,1,.46);
  const clear=point=>!circleBlocked(point.x,point.z,.46,town.obstacles);
  const points=hiddenBreakoutPositions({x:60,z:60},()=>false,clear);
  const isPreferred=point=>[-64,-52,-40].includes(point.x)&&[-50,-44,-32].includes(point.z);
  const preferred=points.filter(isPreferred);
  assert.ok(preferred.length>0);
  assert.deepEqual(points.slice(0,preferred.length),preferred);
  for(const point of preferred) {
    const river=riverSectionAt(point.x);
    assert.ok(point.x<a.x);
    assert.ok(point.z<river.centerZ-river.bankHalfWidth);
    assert.ok(navigate(point,{x:52,z:3}).length>0);
  }
  const near=hiddenBreakoutPositions({x:-52,z:-40},()=>false,()=>true);
  assert.ok(near.length>0);
  assert.ok(near.every(point=>Math.hypot(point.x+52,point.z+40)>=28));
  assert.ok(!near.some(isPreferred));
});

test('bounded retries exhaust eligible preferred points before falling back, even when candidates change',()=>{
  const candidates=hiddenBreakoutPositions({x:60,z:60},()=>false,()=>true),task={};
  const preferred=candidates.filter(point=>[-64,-52,-40].includes(point.x)&&[-50,-44,-32].includes(point.z));
  assert.equal(preferred.length,9);
  const first=breakoutSpawnAttempts(task,candidates);
  assert.deepEqual(first,preferred.slice(0,3));
  const changed=candidates.filter(point=>point!==first[0]);
  assert.deepEqual(breakoutSpawnAttempts(task,changed),preferred.slice(3,6));
  assert.deepEqual(breakoutSpawnAttempts(task,changed),preferred.slice(6,9));
  assert.deepEqual(breakoutSpawnAttempts(task,changed),changed.filter(point=>!preferred.includes(point)).slice(0,3));
  const isolated=[preferred[0]];
  assert.deepEqual(breakoutSpawnAttempts(task,isolated),isolated);
});
