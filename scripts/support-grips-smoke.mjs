import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR ?? 'asset-research', 'support-grips');
const reviewPoint = process.env.GRIP_REVIEW_POINT ?? null;
const reviewSoldier = process.env.GRIP_REVIEW_SOLDIER ?? 'officer';
if (!['officer', 'rifleman'].includes(reviewSoldier)) throw new RangeError('Unsupported review soldier');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
    let __gripObserver=false;
    const __gripNativeUpdate=nraCharacter.update;
    nraCharacter.update=function(actors,now,controlled,...args){
      return __gripNativeUpdate.call(this,actors,now,__gripObserver?null:controlled,...args);
    };
    const __gripViewUpdate=supportViewHands.update;
    supportViewHands.update=function(...args){
      if(__gripObserver){this.reset();return null;}
      return __gripViewUpdate.apply(this,args);
    };
    window.gripReview={
      mount(profile){
        const actor=controlledSoldier(entities);
        const point=${JSON.stringify(reviewPoint)} ? emplacements.get(${JSON.stringify(reviewPoint)})
          : [...emplacements.values()].find(point=>point.profile===profile);
        if(point && point.profile!==profile)throw new Error('Review point profile does not match');
        if(!point)throw new Error('Missing real emplacement '+profile);
        showOverlay('pause');missionBriefing.hide();releaseEmplacement(actor,false);
        actor.traversal.kind='grounded';actor.rifleReady=false;
        const pose=emplacementPose(point,point.altitude??world.groundHeight(point.x,point.z));
        actor.position.set(pose.operator.x,pose.operator.y,pose.operator.z);
        actor.stance=pose.stance;actor.firingPose=pose.firingPose;
        for(const stance of Object.keys(actor.nativeMotion.posture))
          actor.nativeMotion.posture[stance]=Number(stance===(pose.firingPose??'standing'));
        actor.nativeMotion.postureTransition=null;
        occupyEmplacement(point,actor);
        if(point.operatorId!==actor.id)throw new Error('Real occupancy rejected '+profile);
        $('overlay').hidden=true;__gripObserver=false;
        point.view.userData.update();updateSupportGripMarkers();updateCamera(0);updateHUD();
        return {actor:actor.id,index:actor.index,officer:isNativeOfficer(actor),point:point.id};
      },
      aim(yaw,pitch,zoom=false){
        const actor=controlledSoldier(entities),point=emplacements.get(actor.emplacementId);
        held.aiming=zoom;
        emplacementLook(point,point.heading+yaw,pitch);
        const pose=emplacementPose(point,point.altitude??world.groundHeight(point.x,point.z));
        actor.position.set(pose.operator.x,pose.operator.y,pose.operator.z);
        actor.heading=point.yaw;actor.lookPitch=point.pitch;
        point.view.userData.update();updateSupportGripMarkers();updateCamera(0);
      },
      observe(){
        const actor=controlledSoldier(entities);
        __gripObserver=true;if(weapon)weapon.visible=false;
        const forward=new THREE.Vector3(-Math.sin(actor.heading),0,-Math.cos(actor.heading));
        camera.position.copy(actor.position).addScaledVector(forward,-.8)
          .add(new THREE.Vector3(-forward.z*2.7,1.4,forward.x*2.7));
        camera.lookAt(actor.position.clone().add(new THREE.Vector3(0,1.05,0)));
        camera.updateMatrixWorld(true);
      },
      snapshot(){
        const actor=controlledSoldier(entities);
        const view=nraCharacter.snapshot.views.find(view=>view.actorId===actor.id);
        const point=emplacements.get(actor.emplacementId),targets=supportWeaponTargets(point.view,supportViewHands.root);
        const fingers=Object.fromEntries(['left','right'].map(side=>{
          const hand=supportViewHands.root.getObjectByName(side+'-grenade-hand');
          const prefix=side==='left'?'Left':'Right',target=targets[side];
          const center=new THREE.Vector3(...target.center),axis=new THREE.Vector3(...target.axis).normalize();
          const eye=supportViewHands.root.worldToLocal(camera.getWorldPosition(new THREE.Vector3())).sub(center);
          eye.addScaledVector(axis,-eye.dot(axis)).normalize();
          const joints=Object.fromEntries(['Index','Middle','Ring','Pinky','Thumb'].map(finger=>{
            const bone=hand.getObjectByName(prefix+'Hand'+finger+'4');
            const tip=supportViewHands.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
            const delta=tip.clone().sub(center),axial=delta.dot(axis);
            const radial=delta.addScaledVector(axis,-axial);
            return [finger,{position:tip.toArray(),axial,radial:radial.length(),towardViewer:radial.dot(eye)}];
          }));
          const wrist=hand.getObjectByName(prefix+'Hand').getWorldPosition(new THREE.Vector3());
          const elbow=hand.getObjectByName(prefix+'ForeArm').getWorldPosition(new THREE.Vector3());
          const knuckle=hand.getObjectByName(prefix+'HandMiddle1').getWorldPosition(new THREE.Vector3());
          const wristBend=THREE.MathUtils.radToDeg(wrist.clone().sub(elbow).angleTo(knuckle.sub(wrist)));
          const attachment=hand.attachmentFrame;
          const palmNormal=new THREE.Vector3(0,0,hand.userData.palmFacingAxis)
            .applyQuaternion(attachment.getWorldQuaternion(new THREE.Quaternion()))
            .applyQuaternion(supportViewHands.root.getWorldQuaternion(new THREE.Quaternion()).invert());
          return [side,{joints,wristBend,palmNormal:palmNormal.toArray(),normal:target.normal,radius:target.radius}];
        }));
        const gloves=[],gloveShaders=[];supportViewHands.root.traverse(node=>{
          if(node.setOfficerAppearance)gloves.push(node.userData.officerGloves);
          if(node.isMesh&&node.geometry.attributes.nativeOfficerGlove)
            gloveShaders.push(node.material.customProgramCacheKey());
        });
        return {state,actor:actor.id,index:actor.index,stance:actor.stance,firingPose:actor.firingPose,first:supportViewHands.snapshot,
          camera:{position:camera.position.toArray(),fov:camera.fov},
          third:view?.supportGrip,fingers,gloves,gloveShaders,observer:__gripObserver};
      }
    };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5334/');
  url.searchParams.set('campaign', 'nanjing');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.gripReview && __battle.state === 'playing', null, { timeout: 180000 });
  if (reviewSoldier === 'officer') { await page.keyboard.press('y'); await page.keyboard.press('y'); }
  const cases = [];
  for (const profile of reviewPoint ? ['maxim24'] : ['maxim24', 'maxim24aa', 'bofors75']) {
    const owner = await page.evaluate(profile => gripReview.mount(profile), profile);
    if (reviewPoint) assert.equal(owner.point, reviewPoint);
    assert.equal(owner.index, reviewSoldier === 'officer' ? 2 : 0);
    assert.equal(owner.officer, reviewSoldier === 'officer');
    await setQualityPreset(page, 'high');
    for (const [yaw, pitch] of [[0, .1], [.4, .45], [-.4, .15]]) {
      await page.evaluate(({ yaw, pitch }) => gripReview.aim(yaw, pitch), { yaw, pitch });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(profile => {
        const first = gripReview.snapshot().first;
        return first?.visible && first.kind === profile;
      }, profile, { timeout: 10000 });
      const state = await page.evaluate(() => gripReview.snapshot());
      if (profile === 'bofors75') {
        assert.equal(state.stance, 'crouched'); assert.equal(state.firingPose, 'kneeling');
      }
      assert.equal(state.first.contactLimited, false, JSON.stringify(state.first));
      for (const hand of Object.values(state.first.hands)) {
        assert.ok(hand.wristError < .04); assert.ok(hand.palmError < .008);
      }
      if (profile === 'maxim24' || profile === 'maxim24aa') for (const [side, grip] of Object.entries(state.fingers)) {
        assert.ok(grip.joints.Index.axial > grip.joints.Pinky.axial &&
          grip.joints.Thumb.axial > grip.joints.Pinky.axial, `${profile} ${side}: web must face up`);
        assert.ok(grip.wristBend < 30, `${profile} ${side}: wrist bent ${grip.wristBend} degrees`);
        for (const [finger, tip] of Object.entries(grip.joints)) {
          assert.ok(Math.abs(tip.axial) <= .09 && tip.radial >= grip.radius - .008 &&
            tip.radial <= grip.radius + .012, `${profile} ${side} ${finger}: ${JSON.stringify(tip)}`);
          if (finger !== 'Thumb') assert.ok(tip.towardViewer > 0,
            `${profile} ${side} ${finger}: fingertip must face the viewer`);
        }
      }
      assert.deepEqual(state.gloves, [owner.officer, owner.officer]);
      assert.deepEqual(state.gloveShaders, ['native-bone-weight-officer-gloves-v1', 'native-bone-weight-officer-gloves-v1']);
      cases.push({ profile, yaw, pitch, owner, ...state });
    }
    await page.evaluate(pitch => gripReview.aim(0, pitch, false), reviewPoint ? -.2 : .1);
    await page.waitForTimeout(100);
    const normal = await page.evaluate(() => gripReview.snapshot().camera);
    await page.screenshot({ path: join(directory, `${profile}-${reviewSoldier}-first-person.png`) });
    await page.evaluate(pitch => gripReview.aim(0, pitch, true), reviewPoint ? -.2 : .1);
    await page.waitForTimeout(100);
    const zoom = await page.evaluate(() => gripReview.snapshot().camera);
    assert.deepEqual(zoom.position, normal.position, 'right-button zoom must not move the eye to escape weapon obstruction');
    assert.equal(normal.fov, 65); assert.equal(zoom.fov, 42);
    await page.screenshot({ path: join(directory, `${profile}-${reviewSoldier}-first-person-zoom.png`) });
    cases.push({ profile, zoomOnly: true, normal, zoom });
    await page.evaluate(() => gripReview.observe());
    await page.waitForFunction(() => Boolean(gripReview.snapshot().third), null, { timeout: 10000 });
    const third = await page.evaluate(() => gripReview.snapshot());
    assert.equal(third.third.contactLimited, false, JSON.stringify(third.third));
    if (profile === 'bofors75') assert.ok(third.third.headRearDistance >= 0,
      'The actual native gunner head must stay behind the moving breech-rear plane');
    for (const hand of Object.values(third.third.hands)) {
      assert.ok(hand.wristError < .04); assert.ok(hand.palmError < .008);
    }
    cases.push({ profile, observer: true, ...third });
    await page.screenshot({ path: join(directory, `${profile}-native-gunner.png`) });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'contacts.json'), JSON.stringify({
    fixture: `Paused real occupied weapons and ${reviewSoldier}; no natural-combat performance claim`,
    cases, errors,
  }, null, 2));
  console.log(JSON.stringify({ passed: true, profiles: cases.filter(item => item.observer).length,
    firstPersonAimCases: cases.filter(item => !item.observer && !item.zoomOnly).length,
    nativeGunners: cases.filter(item => item.observer).length }));
} finally { await browser.close(); }
