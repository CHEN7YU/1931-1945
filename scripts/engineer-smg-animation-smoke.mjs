import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

if (!process.env.ARTIFACT_DIR) throw new Error('ARTIFACT_DIR is required');
const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(180000);

try {
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.__animationPlace = () => {
        const actor = controlledSoldier(entities);
        for (const other of allies) if (other !== actor) {
          other.order = 'hold'; other.personalHold = true; other.orderPoint = { ...other.position };
        }
        controlPose.yaw = actor.heading = 0;
        controlPose.pitch = -.08;
        for (const z of [90, 70, -90]) for (const x of [-90, -70, -50, 50, 70, 90]) {
          if (circleBlocked(x, z, .5, world.obstacles) || Math.abs(world.walkHeight(x, z, 0)) > .1) continue;
          if (actor.engineer && engineerPlacementReason(actor, engineerPlacement({ x, y: 0, z }, 0))) continue;
          actor.position.set(x, 0, z); stopLocomotion(actor.locomotion);
          if (actor.nativeMotion) actor.nativeMotion.position = { x, z };
          let index = 0;
          for (const other of allies) if (other !== actor) {
            other.position.set(x + 8 + index++ * .8, 0, z + 8);
            stopLocomotion(other.locomotion);
            if (other.nativeMotion) other.nativeMotion.position = { x: other.position.x, z: other.position.z };
            other.orderPoint = { ...other.position };
          }
          updateCamera(0); return;
        }
        throw new Error('No clear fixture ground');
      };
      window.__beginAnimationVideo = () => {
        const stream = renderer.domElement.captureStream(30), chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
        const ended = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.start();
        window.__animationVideo = { stream, recorder, chunks, ended };
      };
      window.__endAnimationVideo = async () => {
        const { stream, recorder, chunks, ended } = window.__animationVideo;
        recorder.stop(); await ended;
        stream.getTracks().forEach(track => track.stop());
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
        });
      };
      window.__animationCapture = (thirdPerson) => {
        const actor = controlledSoldier(entities);
        if (state !== 'playing') throw new Error('Capture requires a running battle');
        setGameState('pause');
        updateCamera(0);
        const pixelRatio = renderer.getPixelRatio();
        renderer.setPixelRatio(1);
        const result = { time, role: actor.role, rifle: { ...actor.rifle },
          construction: actor.engineer ? { ...actor.engineer.construction } : null,
          nativeHands: weaponHands?.snapshot ?? null,
          hammerArm: weapon?.userData.engineerTool?.hand.armSnapshot ?? null,
          weaponPosition: weapon?.position.toArray() ?? null,
          weaponRotation: weapon?.quaternion.toArray() ?? null,
          fov: camera.fov };
        const feed = weapon?.getObjectByName('feed');
        if (actor.rifle.model === 'sigm1920' && feed) {
          weapon.updateMatrixWorld(true);
          const spare = weapon.getObjectByName('spare-magazine');
          const magazine = spare?.visible ? spare : feed;
          result.magazineScreen = magazine.localToWorld(new THREE.Vector3(-.175, -.014, -.15)).project(camera).toArray();
          result.feedVisible = feed.visible;
          result.spareVisible = spare?.visible ?? false;
          result.reloadStage = weapon.userData.reloadContact?.stage;
          const hand = weapon.getObjectByName('left-grenade-hand');
          if (!hand) throw new Error('SMG capture requires the actual native left hand');
          result.handScreen = Object.fromEntries(['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map(finger => {
            const tip = hand.getObjectByName('LeftHand' + finger + '4');
            if (!tip) throw new Error('SMG capture lacks ' + finger + ' fingertip');
            return [finger, tip.getWorldPosition(new THREE.Vector3()).project(camera).toArray()];
          }));
        }
        if (thirdPerson) {
          const position = camera.position.clone(), rotation = camera.quaternion.clone(), fov = camera.fov;
          const visibility = camera.children.map(child => child.visible);
          camera.position.set(actor.position.x - 1.05, actor.position.y + 1.55, actor.position.z - 1.05);
          camera.lookAt(actor.position.x, actor.position.y + 1.2, actor.position.z);
          camera.fov = 52; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
          for (const child of camera.children) child.visible = false;
          nraCharacter.update([actor], time, null, 'high', { detailLimit: 1 });
          renderer.render(scene, camera);
          result.force = nraCharacter.snapshot;
          result.image = renderer.domElement.toDataURL('image/png');
          camera.position.copy(position); camera.quaternion.copy(rotation); camera.fov = fov;
          camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
          camera.children.forEach((child, index) => { child.visible = visibility[index]; });
        } else {
          renderer.render(scene, camera);
          result.image = renderer.domElement.toDataURL('image/png');
        }
        renderer.setPixelRatio(pixelRatio);
        setGameState('playing');
        return result;
      };
      window.__reloadStage = () => weapon?.userData.reloadContact?.stage;
      window.__observeReloadExchange = () => {
        const samples = [];
        let running = true;
        const tick = () => {
          if (!running) return;
          const actor = controlledSoldier(entities);
          const fraction = actor.rifle.action === 'reload' ? actor.rifle.elapsed / 3.2 : -1;
          if (fraction >= .35 && fraction <= .45) {
            const feed = weapon.getObjectByName('feed'), spare = weapon.getObjectByName('spare-magazine');
            const magazine = spare.visible ? spare : feed;
            const hand = weapon.getObjectByName('left-grenade-hand');
            weapon.updateMatrixWorld(true); camera.updateMatrixWorld(true);
            const points = [];
            for (const finger of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
              for (let joint = 1; joint <= 4; joint++)
                points.push(hand.getObjectByName('LeftHand' + finger + joint)
                  .getWorldPosition(new THREE.Vector3()).project(camera).y);
            }
            const box = new THREE.Box3().setFromObject(magazine);
            for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y])
              for (const z of [box.min.z, box.max.z])
                points.push(new THREE.Vector3(x, y, z).project(camera).y);
            samples.push({ fraction, maxY: Math.max(...points), feedVisible: feed.visible,
              spareVisible: spare.visible, handsVisible: weaponHands.snapshot?.visible,
              reachLimited: weaponHands.snapshot?.reachLimited });
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        return () => { running = false; return samples; };
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Only local game servers are supported');
  url.searchParams.set('benchmark', 'cover');
  url.searchParams.set('resources', 'low-memory');
  url.searchParams.set('seed', '1938');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await setQualityPreset(page, 'low');
  await page.locator('#squad-choices [data-type="infantry"]').click();
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  await page.keyboard.press('y');
  await page.waitForFunction(() => window.__battle?.allies[window.__battle.current]?.role === 'engineer');
  await page.evaluate(() => window.__animationPlace());
  await page.keyboard.press('2');
  await page.waitForFunction(() => window.__battle.controlSimulation.toolEquipped);
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.engineers.some(engineer =>
    engineer.id === window.__battle.control.soldierId && engineer.mode === 'building' && engineer.progress > .15));
  await page.evaluate(() => window.__beginAnimationVideo());
  await page.waitForTimeout(3000);
  const hammerVideo = await page.evaluate(() => window.__endAnimationVideo());
  await writeFile(join(directory, 'engineer.webm'), Buffer.from(hammerVideo.split(',')[1], 'base64'));

  async function capture(name, thirdPerson = false) {
    const result = await page.evaluate(value => window.__animationCapture(value), thirdPerson);
    await writeFile(join(directory, `${name}.png`), Buffer.from(result.image.split(',')[1], 'base64'));
    delete result.image;
    observations.push({ name, thirdPerson, ...result });
    return result;
  }

  const waitForHammerPhase = (start, end) => page.waitForFunction(([from, to]) => {
    const phase = window.__battle.time * 9 / (2 * Math.PI) % 1;
    return phase >= from && phase <= to;
  }, [start, end]);
  await waitForHammerPhase(.24, .32);
  const raised = await capture('hammer-first-raised');
  await capture('hammer-third-raised', true);
  await waitForHammerPhase(.53, .62);
  const impact = await capture('hammer-first-impact');
  await capture('hammer-third-impact', true);
  assert.ok(raised.hammerArm.reachable && impact.hammerArm.reachable);
  assert.ok(impact.hammerArm.wrist[2] < raised.hammerArm.wrist[2] - .15 &&
    impact.hammerArm.wrist[1] < raised.hammerArm.wrist[1] - .15,
    'the game must drive the native wrist forward and down from the raised pose');
  await page.mouse.up();
  await page.keyboard.press('1');
  await page.keyboard.press('y');
  await page.waitForFunction(() => window.__battle?.allies[window.__battle.current]?.role === 'assault');
  await page.evaluate(() => window.__animationPlace());
  const initial = await page.evaluate(() => window.__battle.rifle);
  assert.equal(initial.model.nativeHands?.visible, true);
  assert.equal(initial.model.nativeHands?.officer, true);
  assert.equal(initial.ammo, 50);
  await capture('smg-first-ready');
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.rifle.ammo < 50);
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.rifle.action === 'idle');
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__battle.rifle.action === 'reload' && window.__battle.rifle.elapsed >= .96);
  const removing = await capture('smg-first-remove');
  assert.equal(removing.rifle.action, 'reload');
  assert.equal(removing.rifle.ammo < 50, true);
  assert.equal(removing.reloadStage, 'remove');
  assert.equal(removing.feedVisible, true);
  await capture('smg-third-remove', true);
  await page.waitForFunction(() => window.__reloadStage() === 'seat');
  const inserting = await capture('smg-first-insert');
  assert.equal(inserting.rifle.action, 'reload');
  assert.equal(inserting.reloadStage, 'seat');
  assert.equal(inserting.feedVisible, false);
  assert.equal(inserting.spareVisible, true);
  for (const frame of [removing, inserting]) for (const point of [frame.magazineScreen, ...Object.values(frame.handScreen)]) {
    assert.ok(point.every(Number.isFinite) && Math.abs(point[0]) < 1 && Math.abs(point[1]) < 1 && Math.abs(point[2]) < 1,
      `magazine or fingertip outside viewport: ${point}`);
  }
  await capture('smg-third-insert', true);
  await page.waitForFunction(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 50);
  await page.mouse.down();
  await page.waitForFunction(() => window.__battle.rifle.ammo < 50);
  await page.mouse.up();
  await page.waitForFunction(() => window.__battle.rifle.action === 'idle');
  await page.evaluate(() => window.__beginAnimationVideo());
  await page.evaluate(() => { window.__finishExchangeObservation = window.__observeReloadExchange(); });
  await page.keyboard.press('r');
  await page.waitForFunction(() => window.__battle.rifle.action === 'reload');
  await page.waitForFunction(() => window.__battle.rifle.action === 'idle' && window.__battle.rifle.ammo === 50);
  await page.waitForTimeout(300);
  const reloadVideo = await page.evaluate(() => window.__endAnimationVideo());
  const exchange = await page.evaluate(() => window.__finishExchangeObservation());
  assert.ok(exchange.some(sample => sample.feedVisible) && exchange.some(sample => sample.spareVisible),
    `both magazines must be observed during the exchange: ${JSON.stringify(exchange)}`);
  for (const sample of exchange) {
    assert.ok(sample.maxY < -1 && sample.handsVisible && !sample.reachLimited,
      `exchange must remain below view with reachable hands: ${JSON.stringify(sample)}`);
  }
  await writeFile(join(directory, 'smg-reload.webm'), Buffer.from(reloadVideo.split(',')[1], 'base64'));
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ observations, exchange, errors,
    limitation: 'Actual Y/2/primary and Y/fire/R inputs in the low-quality cover benchmark; actor was manually positioned on clear ground. Screenshots freeze the current game frame and temporarily render at full viewport resolution; third-person camera and FOV are manually positioned.' }, null, 2));
  console.log(JSON.stringify({ passed: true, frames: observations.map(item => item.name), errors }));
} catch (error) {
  await writeFile(join(directory, 'failure.json'), JSON.stringify({ error: error.message, errors, observations }, null, 2));
  await page.screenshot({ path: join(directory, 'failure.png') });
  throw error;
} finally {
  await page.mouse.up().catch(() => {});
  await browser.close();
}
