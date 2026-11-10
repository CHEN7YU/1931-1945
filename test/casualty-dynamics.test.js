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

test('both arms lose support ahead of the chest without a prolonged symmetric brace',()=>{
  for (const fold of [.35, .5, .74]) {
    const state = { time: 0, duration: 1.4, variant: 3, fold };
    const early = casualtyJointDynamics(state, .2), falling = casualtyJointDynamics(state, .45);
    assert.ok(early.leftArm > early.chest && early.rightArm > early.chest);
    assert.ok(falling.leftArm > .8 && falling.rightArm > .8);
    assert.notEqual(early.leftArm, early.rightArm);
    const start = casualtyJointDynamics(state, 0);
    assert.equal(start.leftArm, 0); assert.equal(start.rightArm, 0);
  }
});
