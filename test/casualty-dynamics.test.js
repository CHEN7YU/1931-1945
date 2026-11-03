import test from 'node:test';
import assert from 'node:assert/strict';
import {dampedJointResponse,casualtyJointDynamics} from '../src/casualty-dynamics.js';

test('loss of support leads the chest, head and asymmetric arms instead of rotating all joints together',()=>{
  const state={time:1,duration:1.5,variant:0,fold:.65};
  const response=casualtyJointDynamics(state,1.2);
  assert.ok(response.leftKnee>response.chest&&response.pelvis>response.head);
  assert.notEqual(response.leftArm,response.rightArm);
  assert.deepEqual(casualtyJointDynamics(state,1.2),response,'joint physics sampling is pause-stable');
  const settled=casualtyJointDynamics(state,4);
  for(const key of ['pelvis','chest','head','leftArm','rightArm','leftKnee','rightKnee'])assert.equal(settled[key],1);
  for(let time=0;time<3;time+=.01)assert.ok(dampedJointResponse(time)>=0&&dampedJointResponse(time)<=1.08);
  assert.throws(()=>dampedJointResponse(-1),/finite/);
});
