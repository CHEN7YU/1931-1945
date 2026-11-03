import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {moveCivilianInCrowd,createCivilianCrowdPlanner} from '../src/civilian-crowd.js';

const moduleUrl=new URL('../src/civilian-crowd.js',import.meta.url);
const original=execFileSync('git',['show','c979120:src/civilian-crowd.js'],{encoding:'utf8'})
  .replace(/from '([^']+)'/g,(_,specifier)=>`from '${new URL(specifier,moduleUrl).href}'`);
const baseline=await import(`data:text/javascript;base64,${Buffer.from(original).toString('base64')}`);
const wall={minX:-30,maxX:-29,minZ:-80,maxZ:80,height:4};
const result=[];
for(const[name,move]of [['committed',baseline.moveCivilianInCrowd],['bounded',moveCivilianInCrowd]]){
  const people=Array.from({length:6},(_,index)=>({position:{x:index*2,y:0,z:0},userData:{civilianId:index,
    crowdTarget:{x:-60,z:-60},crowdBestDistance:0,crowdStalled:2}}));
  const planner=name==='bounded'?createCivilianCrowdPlanner():null;
  planner?.beginStep();
  const began=performance.now();
  for(const person of people)move(person,{x:-60,z:-60},.1,people,[wall],[wall],null,planner);
  result.push({name,stepMs:performance.now()-began,searches:planner?.stats.searches,deferred:planner?.stats.deferred});
}
console.log(JSON.stringify(result));
