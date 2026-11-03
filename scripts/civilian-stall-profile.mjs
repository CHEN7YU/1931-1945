import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {defaultPreferences,PREFERENCES_KEY} from '../src/player-preferences.js';

const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
try{
  const settings=defaultPreferences();settings.quality.preset='low';
  Object.keys(settings.quality.effects).forEach(key=>settings.quality.effects[key]=false);
  await page.addInitScript(({key,settings})=>localStorage.setItem(key,JSON.stringify({version:1,settings})),
    {key:PREFERENCES_KEY,settings});
  if(process.env.STALL_BASELINE==='1'){
    for(const file of ['civilian-crowd','civilian-threat']){
      const source=execFileSync('git',['show',`c979120:src/${file}.js`],{encoding:'utf8'});
      await page.route(`**/src/${file}.js*`,async route=>{
        let body=source;
        if(file==='civilian-crowd')body+='\nexport function createCivilianCrowdPlanner(){return{beginStep(){},invalidate(){},stats:{}}}\nexport function rejoinCivilianRoute(position,target,navigate){return navigate(position,target);}';
        await route.fulfill({contentType:'text/javascript',body});
      });
    }
  }
  await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();
    const source=(await response.text()).replaceAll('rejoinCivilianRoute(','profileRejoin(')
      .replaceAll('moveCivilianInCrowd(','profileMove(');
    await route.fulfill({response,body:source+`
      const civilianProfile={rejoin:{calls:0,total:0,max:0},move:{calls:0,total:0,max:0}};
      function profileOperation(key,operation,args){
        const start=performance.now();try{return operation(...args);}
        finally{const elapsed=performance.now()-start,item=civilianProfile[key];item.calls++;item.total+=elapsed;item.max=Math.max(item.max,elapsed);}
      }
      function profileRejoin(...args){return profileOperation('rejoin',rejoinCivilianRoute,args);}
      function profileMove(...args){return profileOperation('move',moveCivilianInCrowd,args);}
      window.stallReview=()=>{
        setGameState('menu');beginMatch();enemies=[];rebuildForces();combatSounds.length=0;
        const samples=[],step=(count,label)=>{
          const timings=[];
          for(let frame=0;frame<count;frame++){
            time+=.05;
            world.doorSystem.update(.05,world.civilians.filter(person=>person.visible&&person.parent===scene)
              .map(person=>({x:person.position.x,z:person.position.z,radius:.36})));
            const start=performance.now();updateNanjingCivilians(.05);timings.push(performance.now()-start);
            controlEvents.drain(()=>{});combatEvents.drain(()=>{});
          }
          timings.sort((a,b)=>a-b);
          samples.push({label,frames:count,total:timings.reduce((a,b)=>a+b,0),
            p95:timings[Math.floor(count*.95)],max:timings.at(-1),arrived:nanjingCampaign.civiliansArrived,
            evacuated:nanjingCampaign.civiliansEvacuated});
        };
        step(1200,'opening-60s');
        nanjingCampaign.stage='withdrawal';updateNanjingMission(0);
        step(4800,'residential-wave-240s');
        nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;
        step(600,'dock-boarding-30s');
        setGameState('pause');
        return {samples,planner:civilianCrowdPlanner.stats,operations:civilianProfile};
      };`});
  });
  await page.goto(process.env.GAME_URL??'http://127.0.0.1:5203/?campaign=nanjing');
  await page.waitForFunction(()=>window.__battle?.state==='menu',null,{timeout:180000});
  await page.locator('#deploy').click();
  await page.waitForFunction(()=>window.__battle?.state==='playing',null,{timeout:180000});
  const result=await page.evaluate(()=>stallReview());
  console.log(JSON.stringify({result,errors}));
  if(process.env.STALL_RESULT)await writeFile(process.env.STALL_RESULT,JSON.stringify({result,errors},null,2));
  assert.deepEqual(errors,[]);
  assert.equal(result.samples[1].arrived,180);
  if(process.env.STALL_BASELINE!=='1')assert.ok(result.samples.every(sample=>sample.max<150),
    'civilian-only simulation updates must not contain multi-second synchronous searches');
}finally{await browser.close();}
