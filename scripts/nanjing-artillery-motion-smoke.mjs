import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const actualBattleStep = advanceBattleStep;
      const artillerySamples = [];
      const muzzleObservations = [];
      const actualFieldGunMuzzle = combatEffects.fieldGunMuzzle.bind(combatEffects);
      combatEffects.fieldGunMuzzle = (position, direction, base, bornAt) => {
        const point = emplacements.get('bridge-gun');
        if (artilleryRecording && point) {
          const eye = camera.getWorldPosition(new THREE.Vector3());
          const toMuzzle = position.clone().sub(eye);
          const sight = new THREE.Raycaster(eye, toMuzzle.clone().normalize(), 0, toMuzzle.length() - .01);
          muzzleObservations.push({ time, camera: eye.toArray(), muzzle: position.toArray(),
            projected: position.clone().project(camera).toArray(),
            gunHits: sight.intersectObject(point.view, true).slice(0, 3)
              .map(hit => ({ distance: hit.distance, name: hit.object.name, material: hit.object.material?.type })) });
        }
        actualFieldGunMuzzle(position, direction, base, bornAt);
      };
      let artilleryRecording = null;
      const actualRender = renderer.render.bind(renderer);
      const observer = new THREE.PerspectiveCamera(55, 1280 / 720, .07, 650);
      renderer.render = (renderScene, renderCamera) => {
        const point = emplacements.get('bridge-gun');
        if (${process.env.ARTILLERY_OBSERVER === '1' ? 'true' : 'false'} && artilleryRecording && point) {
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          observer.position.set(point.x + Math.cos(point.yaw) * 4 + Math.sin(point.yaw) * 2,
            floor + 2.6, point.z - Math.sin(point.yaw) * 4 + Math.cos(point.yaw) * 2);
          observer.lookAt(point.x, floor + .7, point.z);
          actualRender(renderScene, observer);
        } else actualRender(renderScene, renderCamera);
      };
      advanceBattleStep = function(dt, presentationTime) {
        actualBattleStep(dt, presentationTime);
        const point = emplacements.get('bridge-gun');
        if (artilleryRecording && point) artillerySamples.push({
          time, shots: point.shots, recoil: point.recoil,
          clouds: combatEffects.snapshot.clouds, renderedClouds: combatEffects.snapshot.renderedClouds,
          fieldGunClouds: combatEffects.snapshot.fieldGunClouds,
          renderedFieldGunClouds: combatEffects.snapshot.renderedFieldGunClouds,
          ammo: point.weapon.ammo, reloadUntil: point.weapon.reloadUntil,
        });
      };
      window.artilleryMotionReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities), point = emplacements.get('bridge-gun');
          if (!point) throw new Error('Missing field gun');
          if (point.operatorId) {
            const operator = entities.soldiers.get(point.operatorId);
            if (!operator) throw new Error('Missing existing operator');
            releaseEmplacement(operator, false);
          }
          point.playerOnly = true;
          const floor = point.altitude ?? world.groundHeight(point.x, point.z);
          const pose = emplacementPose(point, floor);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          stopLocomotion(actor.locomotion);
          controlPose.yaw = point.heading; controlPose.pitch = -.15;
          setGameState('playing'); bindControlInput(); updateCamera(0);
          return this.sample();
        },
        sample() {
          const point = emplacements.get('bridge-gun'), actor = controlledSoldier(entities);
          return { time, state, mounted: actor.emplacementId, shots: point.shots,
            ammo: point.weapon.ammo, reloadUntil: point.weapon.reloadUntil, recoil: point.recoil };
        },
        start() {
          const stream = renderer.domElement.captureStream(30);
          const chunks = [];
          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          recorder.start();
          artilleryRecording = { recorder, stream, chunks };
        },
        async stop() {
          const recording = artilleryRecording;
          if (!recording) throw new Error('No artillery recording');
          await new Promise(resolve => { recording.recorder.onstop = resolve; recording.recorder.stop(); });
          recording.stream.getTracks().forEach(track => track.stop());
          artilleryRecording = null;
          const blob = new Blob(recording.chunks, { type: 'video/webm' });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (let i = 0; i < bytes.length; i += 32768)
            binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return { video: btoa(binary), samples: artillerySamples, muzzleObservations };
        },
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await setQualityPreset(page, 'low');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const before = await page.evaluate(() => artilleryMotionReview.setup());
  await page.locator('#world').click();
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => artilleryMotionReview.sample().mounted === 'bridge-gun', null, { timeout: 10000 });
  await page.evaluate(() => artilleryMotionReview.start());
  await page.waitForTimeout(500);
  await page.mouse.click(640, 360);
  await page.waitForFunction(shots => artilleryMotionReview.sample().shots > shots, before.shots, { timeout: 15000 });
  const first = await page.evaluate(() => artilleryMotionReview.sample());
  await page.waitForFunction(() => artilleryMotionReview.sample().reloadUntil === 0, null, { timeout: 60000 });
  await page.mouse.click(640, 360);
  await page.waitForFunction(shots => artilleryMotionReview.sample().shots > shots, first.shots, { timeout: 15000 });
  await page.waitForFunction(() => artilleryMotionReview.sample().recoil === 0, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const recording = await page.evaluate(() => artilleryMotionReview.stop());
  const samples = recording.samples;
  const result = { before, first, after: await page.evaluate(() => artilleryMotionReview.sample()),
    samples, muzzleObservations: recording.muzzleObservations, errors,
    limitation: `Low-quality local gameplay; player placed at the gun, enemies disabled, F and mouse use actual inputs. ${process.env.ARTILLERY_OBSERVER === '1' ? 'An artificial external camera observes the real gun during recording. ' : ''}Canvas recording has no audio and follows actual render timing.` };
  await writeFile(join(directory, 'artillery.webm'), Buffer.from(recording.video, 'base64'));
  await writeFile(join(directory, 'artillery.json'), JSON.stringify(result, null, 2));
  assert.equal(result.after.shots, before.shots + 2);
  assert.ok(samples.some(sample => sample.recoil > .05), 'recoil must occur during firing');
  assert.ok(samples.some(sample => sample.renderedClouds > 0), 'firing must render smoke');
  for (const observation of result.muzzleObservations) {
    assert.ok(samples.some(sample => sample.time >= observation.time + .5 &&
      sample.time < observation.time + 1 && sample.fieldGunClouds > 0),
    'field gun smoke must survive the immediate shell impact');
  }
  assert.equal(result.muzzleObservations.length, 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ shots: result.after.shots - before.shots, samples: samples.length,
    maxRecoil: Math.max(...samples.map(sample => sample.recoil)),
    maxRenderedClouds: Math.max(...samples.map(sample => sample.renderedClouds)), errors }));
} finally {
  await browser.close();
}
