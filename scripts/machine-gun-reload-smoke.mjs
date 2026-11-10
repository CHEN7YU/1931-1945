import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__machine-gun-reload', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
  }));
  await page.goto(new URL('/__machine-gun-reload', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { createLocomotion } = await import('/src/locomotion.js');
    const { createRifleState, reloadRifle, advanceRifle, infantryWeaponProfile } = await import('/src/rifle-action.js');
    const { machineGunReloadPose } = await import('/src/machine-gun-reload.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    await loadDadaoSurfaces(8);
    const friendly = await loadNraCharacter(); configureRifleMaterials(friendly.rifleMaterials);
    const enemy = await loadIjaCharacter(), entries = [], samples = [], images = {};
    const scene = new T.Scene(); scene.background = new T.Color(0x9ca9a5);
    scene.add(new T.HemisphereLight(0xfff4dc, 0x53615a, 2));
    const sun = new T.DirectionalLight(0xffedcf, 2.5); sun.position.set(-5, 15, -8); scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0x767a68 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    for (const [team, template] of [['friendly', friendly], ['enemy', enemy]]) for (const model of ['zb26', 'type11']) {
      const actor = { id: `${team}-${model}`, team, friendly: team === 'friendly', unitId: 'reload-review', index: 1,
        health: 100, stance: 'standing', heading: 0, walkPhase: 0, position: new T.Vector3(), aimPitch: 0,
        rifle: createRifleState(model), locomotion: createLocomotion(), rifleReady: false, tactics: {} };
      const view = template.createView(); view.bind(actor.id); scene.add(view.root);
      for (const stance of ['standing', 'crouched', 'prone']) {
        actor.stance = stance; actor.rifle = createRifleState(model); actor.rifle.ammo = 0; reloadRifle(actor.rifle);
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        for (let frame = 0; frame <= 240; frame++) {
          actor.rifle.elapsed = infantryWeaponProfile(actor.rifle).reloadSeconds * frame / 240;
          advanceNraMotion(actor, 1 / 60); view.update(actor, actor.rifle.elapsed, null);
          const pose = machineGunReloadPose(actor.rifle, { prone: actor.nativeMotion.posture.prone ?? 0, supported: 1 });
          const snapshot = view.snapshot.riflePose;
          const gun = view.root.children.find(child => child.userData.personalWeapon);
          const contact = new T.Vector3(...snapshot.leftPalm);
          gun.worldToLocal(contact);
          const error = contact.distanceTo(new T.Vector3(...pose.palm));
          const sample = { team, model, stance, frame, stage: pose.stage, issue: view.issue,
            leftError: snapshot.left.palmError, rightError: snapshot.right.palmError,
            contactError: error, handWeight: pose.handWeight, ammo: actor.rifle.ammo };
          if (pose.supportWeight > .999 && stance !== 'prone' &&
            (stance === 'standing' || actor.nativeMotion.posture[stance] > .999)) {
            const point = name => view.root.getObjectByName(name).getWorldPosition(new T.Vector3());
            const support = stance === 'standing' ? point('Hips').add(new T.Vector3(.12, .11, -.03))
              : point('LeftUpLeg').lerp(point('LeftLeg'), .1).add(new T.Vector3(0, .055, 0));
            sample.supportError = support.distanceTo(new T.Vector3(...snapshot.stock));
            if (sample.supportError > .035) throw new Error(`LMG lost its body/thigh support: ${JSON.stringify(sample)}`);
          }
          if (sample.issue || sample.leftError >= .005 || sample.rightError >= .005 ||
            pose.handWeight > .999 && error >= .005) throw new Error(JSON.stringify({ ...sample,
              pose: snapshot, upperArm: view.root.getObjectByName('LeftArm').getWorldPosition(new T.Vector3()).toArray() }));
          samples.push(sample);
        }
      }
      view.root.visible = false; entries.push({ actor, view, template });
    }
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1600, 760); renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const output = document.createElement('canvas'); output.width = 1600; output.height = 800;
    document.body.append(output);
    const context = output.getContext('2d'), camera = new T.PerspectiveCamera(36, 400 / 760, .05, 100);
    camera.position.set(-1.9, 1.8, -2.6); camera.lookAt(0, 1.05, 0);
    const chunks = [], stream = output.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 7000000 });
    const ended = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    for (const { actor, template } of entries) {
      actor.stance = 'standing'; actor.rifle = createRifleState(actor.rifle.model);
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
    }
    recorder.start();
    for (let frame = 0; frame < 195; frame++) {
      renderer.setScissorTest(true);
      for (const [column, entry] of entries.entries()) {
        for (const other of entries) other.view.root.visible = other === entry;
        if (frame === 15) { entry.actor.rifle.ammo = 0; reloadRifle(entry.actor.rifle); }
        advanceRifle(entry.actor.rifle, 1 / 30); advanceNraMotion(entry.actor, 1 / 30);
        entry.view.update(entry.actor, frame / 30, null);
        if (entry.view.issue) throw new Error(`Recorded ${entry.actor.id}/${frame}: ${entry.view.issue}`);
        renderer.setViewport(column * 400, 0, 400, 760); renderer.setScissor(column * 400, 0, 400, 760);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
      context.fillStyle = '#17201e'; context.fillRect(0, 0, 1600, 800);
      context.drawImage(renderer.domElement, 0, 40);
      context.fillStyle = '#fff'; context.font = '17px sans-serif';
      for (const [column, entry] of entries.entries())
        context.fillText(`${entry.actor.id.toUpperCase()} | ${machineGunReloadPose(entry.actor.rifle).stage}`, column * 400 + 8, 26);
      if ([50, 90, 130].includes(frame)) images[frame] = output.toDataURL('image/png').split(',')[1];
      await new Promise(resolve => setTimeout(resolve, 34));
    }
    recorder.stop(); await ended; stream.getTracks().forEach(track => track.stop());
    for (const stance of ['crouched', 'prone']) {
      camera.position.set(-1.9, stance === 'prone' ? .8 : 1.4, -2.6);
      camera.lookAt(0, stance === 'prone' ? .25 : .55, 0);
      renderer.setScissorTest(true);
      for (const [column, entry] of entries.entries()) {
        for (const other of entries) other.view.root.visible = other === entry;
        entry.actor.stance = stance; entry.actor.rifle = createRifleState(entry.actor.rifle.model);
        entry.actor.rifle.ammo = 0; reloadRifle(entry.actor.rifle);
        entry.actor.rifle.elapsed = infantryWeaponProfile(entry.actor.rifle).reloadSeconds * .55;
        entry.actor.nativeMotion = createNraMotion(entry.template.motionProfile, entry.actor);
        for (let frame = 0; frame < 60; frame++) advanceNraMotion(entry.actor, 1 / 60);
        entry.view.update(entry.actor, 0, null);
        if (entry.view.issue) throw new Error(`${stance} support preview: ${entry.view.issue}`);
        renderer.setViewport(column * 400, 0, 400, 760); renderer.setScissor(column * 400, 0, 400, 760);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
      context.fillStyle = '#17201e'; context.fillRect(0, 0, 1600, 800);
      context.drawImage(renderer.domElement, 0, 40);
      context.fillStyle = '#fff'; context.fillText(`${stance.toUpperCase()} - SUPPORTED RELOAD`, 12, 26);
      images[stance] = output.toDataURL('image/png').split(',')[1];
    }
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { samples, images, video: btoa(binary) };
  });
  await writeFile(join(directory, 'machine-gun-reload.webm'), Buffer.from(result.video, 'base64'));
  for (const [frame, image] of Object.entries(result.images))
    await writeFile(join(directory, `reload-${frame}.png`), Buffer.from(image, 'base64'));
  delete result.video; delete result.images;
  await writeFile(join(directory, 'reload-observations.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, samples: result.samples.length }));
} finally { await browser.close(); }
