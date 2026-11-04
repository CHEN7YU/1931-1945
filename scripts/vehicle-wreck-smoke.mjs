import { deployFromMenu, continueIdentitySelection } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width:1280,height:800 } });
const errors=[],results=[];
page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});
page.setDefaultTimeout(180000);
try {
  const settings=defaultPreferences();settings.quality.preset='low';
  for(const key of Object.keys(settings.quality.effects))settings.quality.effects[key]=false;
  await page.addInitScript(({key,settings})=>localStorage.setItem(key,JSON.stringify({version:1,settings})),
    {key:PREFERENCES_KEY,settings});
  await page.route('**/src/main.js*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
      window.wreckReview=()=>{
        setGameState('menu');beginMatch();
        const source=captureAttackSource(entities,controlledSoldier(entities));
        const plane=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='plane'&&vehicle.team==='enemy'&&vehicle.health>0);
        const tank=[...entities.vehicles.values()].find(vehicle=>vehicle.type==='tank'&&vehicle.team==='enemy'&&vehicle.health>0);
        if(!plane||!tank)throw Error('Missing live aircraft/tank for wreck regression');
        const airFormation=formations.find(formation=>formation.id===plane.unitId);
        for(const other of entities.vehicles.values())if(other.type==='plane')other.position.set(-400,200,-400);
        plane.position.set(-45,20,52);plane.speed=0;plane.pitch=plane.roll=0;
        vehicleRenderer.update(entities.vehicles.values(),time);
        damageVehicle(plane,plane.health,source,'aircraft-gun');
        const falling=!plane.fall.grounded;
        for(let step=0;step<600&&!plane.fall.grounded;step++){time+=.05;updateVehicles(.05);}
        if(!plane.fall.grounded)throw Error('Aircraft did not reach a real impact');
        damageVehicle(tank,tank.health,source,'cannon');
        vehicleRenderer.update(entities.vehicles.values(),time);
        const landing={grounded:plane.fall.grounded,y:plane.position.y,
          planeBlack:vehicleRenderer.model(plane.id).userData.wreck===true,
          tankBlack:vehicleRenderer.model(tank.id).userData.wreck===true,
          impacts:combatEvents.snapshot.history.filter(event=>event.type==='explosion'&&
            event.source.cause==='crash'&&event.source.vehicleId===plane.id).length};
        presentCombatEvents();updateEffects(.01);
        if(!spawnJapaneseAircraft(airFormation))throw Error('Normal aircraft replacement was blocked');
        if(nanjingCampaignMode){
          nanjingCampaign.stage='dock-defense';nanjingCampaign.dockActivated=true;
          nanjingCampaign.presentedStage='withdrawal';updateNanjingMission(0);
        }
        time+=3600;updateVehicles(0);vehicleRenderer.update(entities.vehicles.values(),time);
        const retained={plane:entities.vehicles.get(plane.id)===plane,tank:entities.vehicles.get(tank.id)===tank,
          planeView:vehicleRenderer.snapshot.ids.includes(plane.id),
          tankView:vehicleRenderer.snapshot.ids.includes(tank.id)};
        setGameState('pause');$('hud').hidden=true;
        for(const child of camera.children)child.visible=false;
        camera.position.set(plane.position.x+7,plane.position.y+6,plane.position.z-7);
        camera.lookAt(plane.position.x,plane.position.y,plane.position.z);renderer.render(scene,camera);
        return {falling,landing,retained,views:vehicleRenderer.snapshot};
      };
    `});
  });
  for(const map of ['taierzhuang','nanjing']) {
    const url=new URL(process.env.GAME_URL??'http://127.0.0.1:5203');
    if(map==='nanjing')url.searchParams.set('campaign','nanjing');
    await page.goto(url.href,{waitUntil:'domcontentloaded'});
    if(map==='nanjing') {
      await page.waitForFunction(()=>window.__battle?.state==='menu',null,{timeout:180000});
      await deployFromMenu(page);
    }else{
      await page.locator('#confirm-campaign').click();
  await continueIdentitySelection(page);
      await page.locator('#redeploy-choices [data-type="infantry"]').click();
      await page.locator('#confirm-deploy').click();
    }
    await page.waitForFunction(()=>window.__battle?.state==='playing',null,{timeout:180000});
    const result=await page.evaluate(()=>wreckReview());
    results.push({map,...result});
    assert.ok(result.falling&&result.landing.grounded&&result.landing.planeBlack&&result.landing.tankBlack);
    assert.equal(result.landing.impacts,1,'landing must publish exactly one impact explosion');
    assert.ok(Object.values(result.retained).every(Boolean),'old wrecks must survive replacement, stage changes and an hour of simulation');
    if(map==='nanjing')assert.ok(result.landing.y<0,'river impact must not leave the plane floating above invisible ground');
    if(process.env.ARTIFACT_DIR){
      await mkdir(process.env.ARTIFACT_DIR,{recursive:true});
      await page.screenshot({path:join(process.env.ARTIFACT_DIR,`${map}-aircraft-wreck.png`)});
    }
    assert.deepEqual(errors,[]);
  }
  console.log(JSON.stringify({results,errors}));
} finally {
  if(process.env.ARTIFACT_DIR){
    await mkdir(process.env.ARTIFACT_DIR,{recursive:true});
    await writeFile(join(process.env.ARTIFACT_DIR,'wrecks.json'),JSON.stringify({results,errors},null,2));
  }
  await browser.close();
}
