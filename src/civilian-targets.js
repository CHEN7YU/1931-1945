import { Vector3 } from 'three';

export function civilianAimHeight(person) {
  const scale=person.civilianSkin?.profile.height??1;
  return scale*(1.72-(person.userData.escapeMotion?.crouch??0)*.65)*.53;
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
