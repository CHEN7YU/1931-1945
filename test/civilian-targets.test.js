import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {civilianCombatTargets,civilianEngagementPreferred} from '../src/civilian-targets.js';
import {traceCivilianBullet} from '../src/civilian-hits.js';

test('indiscriminate engagement ranks exposed civilians by distance without a protected close-soldier exclusion',()=>{
  const actor={position:{x:0,z:0}},soldier={health:100,position:{x:15,z:0}};
  assert.equal(civilianEngagementPreferred(actor,soldier,{position:{x:8,z:0}}),true);
  assert.equal(civilianEngagementPreferred(actor,soldier,{position:{x:20,z:0}}),false);
  assert.equal(civilianEngagementPreferred(actor,null,{position:{x:20,z:0}}),true);
});
test('onshore and visible boat passengers are targets at their real world positions, but hidden and evacuated people are not',()=>{
  const scene=new THREE.Scene(),boat=new THREE.Group(),person=new THREE.Group();
  scene.add(boat);boat.position.set(-80,0,-80);boat.add(person);person.position.set(1,1.08,0);
  Object.assign(person.userData,{civilianId:1,active:true,health:100});
  const [target]=civilianCombatTargets([person]);
  assert.deepEqual(target.position.toArray(),[-79,1.08,-80]);
  const start={x:-79,y:2,z:-75},direction={x:0,y:0,z:-1};
  const hit=traceCivilianBullet([person],start,direction,10,person=>person.getWorldPosition(new THREE.Vector3()));
  assert.equal(hit?.civilian,person);
  boat.visible=false;assert.equal(civilianCombatTargets([person]).length,0);
  boat.visible=true;person.userData.evacuated=true;assert.equal(civilianCombatTargets([person]).length,0);
});
