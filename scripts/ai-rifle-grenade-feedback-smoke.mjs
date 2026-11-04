import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    window.actionFeedbackReview = {
      hands() {
        setGameState('pause');
        const observations=[];
        for(const [actors,force] of [[friendlyAI,nraCharacter],[enemies,ijaCharacter]]) {
          const actor=actors.find(person=>person.health>0&&!person.vehicleId&&(person.rifle.model??'rifle')==='rifle');
          const original={...actor.rifle},cameraPosition=camera.position.clone(),cameraRotation=camera.quaternion.clone();
          const cases=[['idle',0],['cycle',.2],['cycle',.34],['reload',rifleReloadSeconds({...actor.rifle,ammo:0})*.9/2.7],
            ['reload',rifleReloadSeconds({...actor.rifle,ammo:0})*1.65/2.7]];
          const poses=[];
          for(const [action,elapsed] of cases) {
            Object.assign(actor.rifle,{action,elapsed,ammo:0});
            const bones=force.sampleAnatomy(actor,time);
            camera.position.copy(actor.position).add(new THREE.Vector3(0,1.5,40));camera.lookAt(actor.position.clone().add(new THREE.Vector3(0,1,0)));
            force.update([actor],time,null,'low');
            poses.push({action,elapsed,right:bones.RightHand.toArray(),left:bones.LeftHand.toArray(),
              upper:bones.RightArm.distanceTo(bones.RightForeArm),lower:bones.RightForeArm.distanceTo(bones.RightHand),
              morphs:force.root.children.filter(mesh=>mesh.isInstancedMesh&&mesh.count>0&&mesh.geometry.morphAttributes.position?.length===5)
                .map(mesh=>Array.from(mesh.morphTexture.image.data.slice(0,6)))});
          }
          Object.assign(actor.rifle,original);camera.position.copy(cameraPosition);camera.quaternion.copy(cameraRotation);
          observations.push({team:actor.team,poses,unchanged:JSON.stringify(actor.rifle)===JSON.stringify(original)});
        }
        return observations;
      },
      explosion() {
        setGameState('playing');
        const enemy=enemies.find(actor=>actor.health>0&&!actor.vehicleId);
        const source=captureAttackSource(entities,enemy,enemy.grenades),actor=controlledSoldier(entities);
        const point=actor.position.clone().add(new THREE.Vector3(0,.4,0));
        explode(point,1000,GRENADE.radius,source,'grenade');presentCombatEvents(time);
        return {health:actor.health,state,last:combatEffects.snapshot.lastExplosion,
          audio:grenadeBlastAudio.snapshot,flash:grenadeFlashUntil>performance.now(),
          pauseCopyRemoved:!document.getElementById('force-status')};
      }
    };` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.locator('#confirm-campaign').click();
  await page.locator('#confirm-identity').click();
  await page.waitForFunction(() => document.getElementById('overlay').dataset.deploymentStep === 'squad' ||
    !document.getElementById('fatal').hidden, null, { timeout: 180000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').textContent());
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' && window.actionFeedbackReview);
  await page.locator('#world').click({ position: { x: 700, y: 450 } });
  await page.waitForFunction(() => window.__battle.audioMix.contextState === 'running');
  const hands = await page.evaluate(() => actionFeedbackReview.hands());
  for (const { poses, unchanged, team } of hands) {
    assert.ok(unchanged, `${team}: posing must not change actual ammunition/action timing`);
    const length = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
    assert.ok(length(poses[0].right, poses[2].right) > .07, `${team}: right hand must follow bolt extraction`);
    assert.ok(length(poses[0].right, poses[3].right) > .1, `${team}: right hand must move to the charger/receiver`);
    for (const pose of poses) {
      assert.ok(Math.abs(pose.upper - poses[0].upper) < .001 && Math.abs(pose.lower - poses[0].lower) < .001,
        `${team}: arm bones must not stretch`);
      assert.ok(length(pose.left, poses[0].left) < .015, `${team}: the support hand must keep supporting the gun`);
    }
    assert.ok(poses[2].morphs.length > 0 && poses[3].morphs.length > 0, `${team}: distant bodies must also animate`);
    assert.notDeepEqual(poses[2].morphs, poses[3].morphs);
  }
  const explosion = await page.evaluate(() => actionFeedbackReview.explosion());
  assert.equal(explosion.health, 0);
  assert.ok(['transferring', 'dead'].includes(explosion.state));
  assert.equal(explosion.last.style, 'grenade'); assert.equal(explosion.last.rendered, true);
  assert.ok(explosion.audio.played > 0 && explosion.flash && explosion.pauseCopyRemoved);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'action-feedback.json'), JSON.stringify({ hands, explosion, errors,
      note: 'Controlled original-rig anatomical samples and a registered-source lethal grenade fixture; not a natural battle.' }, null, 2));
    await page.screenshot({ path: join(process.env.ARTIFACT_DIR, 'lethal-grenade-feedback.png') });
  }
  console.log(JSON.stringify({ passed: true, teams: hands.map(item => item.team), lethalGrenadeFeedback: true }));
} finally { await browser.close(); }
