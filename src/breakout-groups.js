import {EAST_BREAKOUT} from './encirclement.js';
import {PREVIEW_OBJECTIVES} from './town-preview-layout.js';

const supplyPoint=PREVIEW_OBJECTIVES.find(point=>point.id==='A');
export const BREAKOUT_REGROUP_POINTS=Object.freeze([
  Object.freeze({x:supplyPoint.x-14,z:supplyPoint.z-12}),
  Object.freeze({x:supplyPoint.x-20,z:supplyPoint.z-18}),
  Object.freeze({x:supplyPoint.x-8,z:supplyPoint.z-18}),
]);
export const BREAKOUT_COUNTERATTACK_POINT=Object.freeze({x:EAST_BREAKOUT.x-4,z:EAST_BREAKOUT.z});

export function breakoutGroupNumber(formation) {
  return Math.floor((formation.index??0)/2)%3;
}

export function breakoutGroupDestination(group) {
  if(!Number.isInteger(group)||group<0||group>2)throw new RangeError('Invalid eastern breakout group');
  return BREAKOUT_REGROUP_POINTS[group];
}

export function advanceBreakoutGroups(formations,match,now) {
  if(!Number.isFinite(now)||!match.breakout||match.phase!==2)throw new Error('Invalid breakout group state');
  const groups=match.breakout.groups??=Array.from({length:3},()=>({released:false,ready:0,alive:0}));
  for(let index=0;index<groups.length;index++){
    const goal=breakoutGroupDestination(index);
    const members=formations.filter(unit=>unit.team==='enemy'&&unit.type!=='plane'&&breakoutGroupNumber(unit)===index)
      .flatMap(unit=>unit.members).filter(actor=>actor.health>0&&
        match.breakout.initialIds.includes(actor.id)&&!match.breakout.escapedIds.includes(actor.id));
    const group=groups[index];
    group.alive=members.length;
    group.ready=members.filter(actor=>Math.hypot(actor.position.x-goal.x,actor.position.z-goal.z)<8).length;
    if(match.breakout.stage==='breakout'&&!group.released){
      group.startedAt??=now;
      if(!members.length||group.ready>=Math.ceil(members.length*.65)||now-group.startedAt>=15)group.released=true;
    }
  }
  return groups;
}
