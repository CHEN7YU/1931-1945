import test from 'node:test';
import assert from 'node:assert/strict';
import {breakoutRestorationPlan,hiddenBreakoutPositions} from '../src/breakout-restoration.js';

test('breakout restoration preserves living remnants and restores exactly six infantry, one tank and three air units',()=>{
  const formations=Array.from({length:6},(_,index)=>({id:`enemy-${index}`,index,team:'enemy',type:'infantry',
    members:Array.from({length:index},()=>({health:100}))}));
  formations.push({id:'tank',team:'enemy',type:'tank',members:[{health:0}]},
    {id:'air',team:'enemy',type:'plane',members:[{health:100,vehicleId:'aircraft'}]});
  const before=JSON.stringify(formations),plan=breakoutRestorationPlan(formations);
  assert.equal(plan.filter(unit=>unit.type==='infantry').length,6);
  assert.equal(plan.filter(unit=>unit.type==='tank').length,1);
  assert.equal(plan.filter(unit=>unit.type==='plane').length,3);
  for(let index=0;index<6;index++)assert.equal(plan[index].required,11-index);
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
