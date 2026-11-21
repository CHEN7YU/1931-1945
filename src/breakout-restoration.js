import { RIVER } from './ground.js';
import { PREVIEW_OBJECTIVES } from './town-preview-layout.js';

export const BREAKOUT_FORCE = Object.freeze({ originalInfantrySquads: 6, infantrySquads: 8, infantryMembers: 11,
  tankSquads: 1, aircraftSquads: 1, spawnInterval: .35, minimumPlayerDistance: 28 });

const supplyPoint = PREVIEW_OBJECTIVES.find(point => point.id === 'A');
const preferredPositions = [-28, -16, -4].flatMap(dx =>
  [-28, -16, -34].map(dz => ({ x: supplyPoint.x + dx, z: RIVER.centerZ + dz })));

export function breakoutRestorationPlan(formations) {
  const infantry = formations.filter(unit => unit.team === 'enemy' && unit.type === 'infantry')
    .sort((a,b)=>a.index-b.index).slice(0,BREAKOUT_FORCE.infantrySquads);
  const tank = formations.find(unit => unit.team === 'enemy' && unit.type === 'tank');
  const aircraft = formations.filter(unit => unit.team === 'enemy' && unit.type === 'plane');
  if(infantry.length < BREAKOUT_FORCE.originalInfantrySquads || !tank)
    throw new Error('Second-stage breakout requires six original infantry formations and one tank formation');
  const plan=infantry.slice(0,BREAKOUT_FORCE.originalInfantrySquads).map(unit=>({id:unit.id,type:'infantry',required:Math.max(0,
    BREAKOUT_FORCE.infantryMembers-unit.members.filter(actor=>actor.health>0).length)}));
  for(let index=BREAKOUT_FORCE.originalInfantrySquads;index<BREAKOUT_FORCE.infantrySquads;index++){
    const unit=formations.find(candidate=>candidate.team==='enemy'&&candidate.type==='infantry'&&candidate.index===index);
    plan.push({id:unit?.id??`enemy-${index}`,index,type:'infantry',
      required:unit?Math.max(0,BREAKOUT_FORCE.infantryMembers-unit.members.filter(actor=>actor.health>0).length):
        BREAKOUT_FORCE.infantryMembers});
  }
  plan.push({id:tank.id,type:'tank',required:tank.members.some(actor=>actor.health>0)?0:1});
  for(let index=0;index<BREAKOUT_FORCE.aircraftSquads;index++){
    const unit=aircraft[index];
    plan.push({id:unit?.id??`east-breakout-air-${index}`,type:'plane',
      required:unit?.members.some(actor=>actor.health>0&&actor.vehicleId)?0:1});
  }
  return plan;
}

export function hiddenBreakoutPositions(playerPosition, visible, groundClear) {
  if(![playerPosition.x,playerPosition.z].every(Number.isFinite)||
    typeof visible!=='function'||typeof groundClear!=='function')throw new TypeError('Invalid breakout spawn queries');
  const points=[];
  for(const point of preferredPositions){
    if(Math.hypot(point.x-playerPosition.x,point.z-playerPosition.z)<BREAKOUT_FORCE.minimumPlayerDistance||
      visible(point)||!groundClear(point))continue;
    points.push(point);
  }
  const fallback=[];
  for(const z of [-72,-48,-24,0,24,48,72])for(const x of [-72,-48,-24,0,24,36]){
    const point={x,z};
    if(Math.hypot(x-playerPosition.x,z-playerPosition.z)<BREAKOUT_FORCE.minimumPlayerDistance||
      visible(point)||!groundClear(point))continue;
    fallback.push(point);
  }
  fallback.sort((a,b)=>Math.hypot(a.x-36,a.z-3)-Math.hypot(b.x-36,b.z-3));
  return points.concat(fallback);
}

export function breakoutSpawnAttempts(task, candidates, limit = 3) {
  const key = point => `${point.x},${point.z}`;
  task.attemptedSpawns ??= [];
  let remaining = candidates.filter(point => !task.attemptedSpawns.includes(key(point)));
  if (!remaining.length) {
    task.attemptedSpawns = [];
    remaining = candidates;
  }
  const attempts = remaining.slice(0, limit);
  task.attemptedSpawns.push(...attempts.map(key));
  return attempts;
}
