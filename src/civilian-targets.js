import { Vector3 } from 'three';
import { civilianBodyHeight } from './civilian-refugees.js';

export function civilianAimHeight(person) {
  return civilianBodyHeight(person)*.53;
}

export function civilianCombatTargets(civilians) {
  const targets=[];
  for(const person of civilians){
    const data=person.userData;
    if(!data.active||data.dead||data.evacuated||!person.parent)continue;
    let visible=true;
    for(let parent=person;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}
    if(!visible)continue;
    targets.push({id:`civilian:${data.civilianId}`,unitId:'nanjing-civilians',team:'friendly',
      health:data.health??100,targetKind:'person',position:person.getWorldPosition(new Vector3()),
      aimHeight:civilianAimHeight(person),civilian:person});
  }
  return targets;
}

export function civilianEngagementPreferred(actor, military, civilian) {
  if(!civilian)return false;
  if(!military||military.health<=0)return true;
  const distance=target=>Math.hypot(target.position.x-actor.position.x,target.position.z-actor.position.z);
  return distance(civilian)<=distance(military);
}
