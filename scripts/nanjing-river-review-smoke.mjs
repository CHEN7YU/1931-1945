import { deployFromMenu } from './game-entry.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.riverReview = {
        stats(){
          const target=allies.find(actor=>actor.role==='sniper');
          const enemy=enemies.find(actor=>actor.health>0&&!actor.vehicleId);
          const source=captureAttackSource(entities,enemy,enemy.rifle);
          hurt(target,10000,source,'rifle','torso');
          setGameState('pause');
          $('scoreboard').hidden=false;updateHUD();renderSquadScores();
          return {players:battleStats.snapshot.filter(row=>row.player),
            ai:formations.filter(unit=>unit.team==='friendly'&&!unit.player).map(unit=>unit.historicalName),
            text:$('squad-score-table').textContent,
            dead:[...$('members').querySelectorAll('.dead [data-role-icon]')].map(icon=>icon.dataset.roleIcon),
            casualtyTables:$('scoreboard').querySelectorAll('.casualty-table').length};
        },
        retention(){
          const enemy=enemies.find(actor=>actor.health>0&&!actor.vehicleId);
          const source=captureAttackSource(entities,enemy,enemy.rifle);
          const person=world.civilians[0];person.visible=true;
          applyCivilianDamage(person,10000,source);
          const start=time;time+=11;updateNanjingCivilians(.05);cleanupBattleCorpses();
          const after11=person.visible;
          for(const civilian of world.civilians.slice(1,121)){
            civilian.visible=true;applyCivilianDamage(civilian,10000,source);
          }
          time=start+179;cleanupBattleCorpses();const beforeMinimum=person.visible;
          time=start+180;cleanupBattleCorpses();const afterMinimum=person.visible;
          return {after11,beforeMinimum,afterMinimum,retained:civilianCorpses.size};
        },
        pose(progress,far=false){
          fatal=true;setGameState('pause');
          if(!this.poseActors){
            this.poseActors=[friendlyAI.find(actor=>actor.health>0),enemies.find(actor=>actor.health>0&&!actor.vehicleId)];
            this.poseActors.forEach((actor,index)=>{
              actor.position.set(-64+index*2,.36,-80);actor.heading=0;actor.rifleReady=true;
              actor.stance='prone';actor.firingPose=null;actor.locomotion.speed=0;
              actor.nativeMotion.position={x:actor.position.x,z:actor.position.z};
              actor.nativeMotion.postureTransition=null;
              for(const key of Object.keys(actor.nativeMotion.posture))actor.nativeMotion.posture[key]=0;
            });
            this.poseTime=0;
          }
          const dt=progress-this.poseTime;
          for(const actor of this.poseActors)advanceNraMotion(actor,dt);
          this.poseTime=progress;
          for(const id of ['menu','hud','overlay','loading'])$(id).hidden=true;
          for(const child of camera.children)child.visible=false;
          camera.fov=far?30:55;camera.updateProjectionMatrix();
          camera.position.set(-58,far?3:2.4,far?-43:-74);camera.lookAt(-63,1,-80);camera.updateMatrixWorld(true);
          nraCharacter.update([this.poseActors[0]],time,null,'low');
          ijaCharacter.update([this.poseActors[1]],time,null,'low');
          nraCharacter.root.visible=ijaCharacter.root.visible=true;
          renderer.render(scene,camera);
          return this.poseActors.map(actor=>({team:actor.team,weights:{...actor.nativeMotion.posture},
            eye:soldierPostureHeight(actor),body:soldierPostureHeight(actor,'body'),
            morph:far?[...(actor.team==='friendly'?nraCharacter:ijaCharacter).root.children
              .find(mesh=>mesh.isInstancedMesh&&mesh.count>0&&mesh.geometry.morphAttributes.position?.length===2)
              .morphTexture.image.data.slice(0,3)]:null,
            issue:(actor.team==='friendly'?nraCharacter:ijaCharacter).focusedSnapshot?.issue??null}));
        },
        hand(){
          const actor=controlledSoldier(entities);actor.rifle.action='cycle';actor.rifle.elapsed=.33;
          camera.fov=65;camera.updateProjectionMatrix();
          weapon.visible=true;weapon.position.set(0,-.05,-.2);weapon.rotation.set(0,0,0);
          updateRifleModel(weapon,actor.rifle);weaponHands.update(weapon,actor.rifle);
          renderer.render(scene,camera);
          return weaponHands.snapshot;
        },
        river(state){
          for(const id of ['menu','hud','overlay','loading'])$(id).hidden=true;
          document.querySelector('.grain').hidden=true;
          for(const child of camera.children)child.visible=false;
          if(nraCharacter)nraCharacter.root.visible=false;
          if(ijaCharacter)ijaCharacter.root.visible=false;
          for(const civilian of world.civilians)civilian.visible=false;
          for(const ferry of world.ferries){
            ferry.userData.state=state;updateNanjingFerryRower(ferry,2.1);
          }
          camera.fov=55;camera.updateProjectionMatrix();
          camera.position.set(-83,3.6,-92);camera.lookAt(-75.8,.7,-84);
          renderer.render(scene,camera);
          const reeds=scene.children.find(child=>child.userData.nanjingFeature==='shore-reeds');
          return {rowers:world.ferryRowers.length,civilians:world.civilians.length,
            moving:world.ferries.every(ferry=>ferry.userData.oar.visible),
            reedsTriangles:reeds.geometry.attributes.position.count/3};
        }
      };` });
  });
  const response = await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=nanjing');
  assert.ok(response.ok());
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 180000 });
  await page.locator('#player-nickname').fill('渡江测试员');
  await page.locator('input[name="player-unit"][value="88"]').check();
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const stats = await page.evaluate(() => riverReview.stats());
  assert.equal(stats.players.length, 1); assert.equal(stats.players[0].unitName, '国民革命军第88师');
  assert.ok(stats.ai.every(name => name !== '国民革命军第88师'));
  assert.match(stats.text, /渡江测试员 · 国民革命军第88师/);
  assert.equal(stats.casualtyTables, 0); assert.deepEqual(stats.dead, ['sniper']);
  const out = process.env.ARTIFACT_DIR;
  if (out) { await mkdir(out, { recursive: true }); await page.screenshot({ path: join(out, 'tab-and-original-dead-role.png') }); }
  const retention = await page.evaluate(() => riverReview.retention());
  assert.ok(retention.after11); assert.ok(retention.beforeMinimum); assert.equal(retention.afterMinimum, false);
  const river = await page.evaluate(() => riverReview.river('inbound'));
  assert.equal(river.rowers, 5); assert.equal(river.civilians, 180); assert.ok(river.moving);
  assert.ok(river.reedsTriangles > 0 && river.reedsTriangles < 30000);
  if (out) {
    await page.screenshot({ path: join(out, 'returning-wooden-ferries.png') });
    await writeFile(join(out, 'river-review.json'), JSON.stringify({ stats, retention, river, errors }, null, 2));
  }
  const poses=[];
  for(const progress of [0,.3,.7,1]){
    const pose=await page.evaluate(progress=>riverReview.pose(progress),progress);
    assert.ok(pose.every(actor=>actor.issue===null));
    if(progress===.3)assert.ok(pose.every(actor=>actor.weights.kneeling>.7&&actor.weights.prone===0));
    if(progress===1)assert.ok(pose.every(actor=>actor.weights.prone===1));
    poses.push({progress,pose});
    if(out)await page.screenshot({path:join(out,'pose-'+progress+'.png')});
    if(progress===.3){
      const far=await page.evaluate(()=>riverReview.pose(.3,true));
      assert.ok(far.every(actor=>actor.morph[2]>.7&&actor.morph[1]>0));
      if(out)await page.screenshot({path:join(out,'far-pose-transition.png')});
    }
  }
  const hand=await page.evaluate(()=>riverReview.hand());
  assert.ok(hand.visible&&!hand.reachLimited);assert.equal(hand.right.grip.weights.bolt,1);
  assert.ok(hand.right.grip.curls.Middle[0]>.8);
  if(out){
    await page.screenshot({path:join(out,'native-bolt-wrap.png')});
    await writeFile(join(out,'posture-and-hand.json'),JSON.stringify({poses,hand},null,2));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, stats, retention, river, errors }));
} catch (error) {
  console.error(JSON.stringify({ errors, loading: await page.locator('#loading-message').textContent() }));
  throw error;
} finally { await browser.close(); }
