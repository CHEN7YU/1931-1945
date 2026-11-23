import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'ai-emplacement-angle');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.aiAngleReview = {
        setup(profile) {
          showOverlay('pause'); missionBriefing.hide();
          nanjingCampaign.stage='gate-defense';
          const point=[...emplacements.values()].find(p=>p.profile===profile&&!p.playerOnly);
          const player=controlledSoldier(entities), actor=allies.find(a=>a!==player&&a.health>0);
          if(!point||!actor)throw new Error('Missing fixture operator or emplacement');
          releaseEmplacement(player,false); releaseEmplacement(actor,false);
          if(point.weapon.settings.antiAircraft){point.engineerBuilt=true;point.builderTeam=actor.team;}
          player.traversal.kind=actor.traversal.kind='grounded';
          if(!occupyEmplacement(point,player)||point.operatorId!==player.id)throw new Error('Player mount failed');
          emplacementLook(point,point.yaw,point.weapon.settings.maxPitch);
          const playerPitch=point.pitch;
          releaseEmplacement(player,false);
          if(!occupyEmplacement(point,actor)||point.operatorId!==actor.id)throw new Error('AI mount failed');
          window.__anglePoint=point;window.__angleActor=actor;
          const originalTargets=[...enemies,...entities.vehicles.values()].map(target=>[target,target.health]);
          for(const [target] of originalTargets)target.health=0;
          const samples=[];
          try {
            for(let i=0;i<100;i++){
              const prior=point.pitch, operated=operateAIEmplacement(actor,.02);
              if(actor.nativeMotion)advanceNraMotion(actor,.02);
              samples.push({prior,pitch:point.pitch,operated});
            }
          } finally {for(const [target,health] of originalTargets)target.health=health;}
          point.view.userData.update(); updateSupportGripMarkers();
          const forward=new THREE.Vector3(-Math.sin(actor.heading),0,-Math.cos(actor.heading));
          camera.position.copy(actor.position).addScaledVector(forward,-.8)
            .add(new THREE.Vector3(-forward.z*2.7,1.4,forward.x*2.7));
          camera.lookAt(actor.position.clone().add(new THREE.Vector3(0,1.05,0)));
          camera.updateMatrixWorld(true); $('overlay').hidden=true;
          return {playerPitch,samples,actor:actor.id};
        },
        snapshot() {
          const view=nraCharacter.snapshot.views.find(v=>v.actorId===window.__angleActor.id);
          return {pitch:window.__anglePoint.pitch,grip:view?.supportGrip};
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5334/');
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await setQualityPreset(page, 'high'); await deployFromMenu(page);
  await page.waitForFunction(() => window.aiAngleReview && __battle.state === 'playing', null, { timeout: 180000 });
  for (const profile of ['maxim24', 'maxim24aa']) {
    const result = await page.evaluate(profile => aiAngleReview.setup(profile), profile);
    assert.ok(result.playerPitch > .5);
    for (const sample of result.samples) {
      assert.equal(sample.operated, true, profile);
      assert.ok(sample.pitch <= sample.prior && sample.prior - sample.pitch <= .016 + 1e-10);
    }
    assert.ok(Math.abs(result.samples.at(-1).pitch - .5) < 1e-10);
    await page.waitForFunction(() => Boolean(aiAngleReview.snapshot().grip), null, { timeout: 30000 });
    const snapshot = await page.evaluate(() => aiAngleReview.snapshot());
    assert.equal(snapshot.grip.contactLimited, false, JSON.stringify(snapshot));
    await page.screenshot({ path: join(directory, `${profile}-ai-max-pitch.png`) });
    console.log(JSON.stringify({ profile, playerPitch: result.playerPitch, aiPitch: snapshot.pitch }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
