import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 800 } }), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  await page.route('**/__weapon-poses', route => route.fulfill({
    contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
  }));
  await page.goto(new URL('/__weapon-poses', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const result = await page.evaluate(async movingReview => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createNraMotion, advanceNraMotion, nativeAimReady, sampleNraMotion, nativeMuzzleLocal } = await import('/src/nra-motion.js');
    const { createRifleState, shootRifle, advanceRifle, infantryWeaponProfile } = await import('/src/rifle-action.js');
    const { createNraForceRendererAsync } = await import('/src/nra-force-renderer.js');
    const { createLocomotion, advanceLocomotion } = await import('/src/locomotion.js');
    const { createAIRifleControl, automaticFireMovement, attemptAIRifleShot } = await import('/src/ai-rifle.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const scene = new T.Scene(); scene.background = new T.Color(0x9ca9a5);
    scene.add(new T.HemisphereLight(0xfff4dc, 0x53615a, 2));
    const sun = new T.DirectionalLight(0xffedcf, 2.5); sun.position.set(-5, 15, -8); scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0x767a68 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    if (movingReview) scene.add(new T.GridHelper(100, 100, 0x586459, 0x879180));
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1600, 760); renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const output = document.createElement('canvas'); output.width = 1600; output.height = 800;
    document.body.append(output);
    const context = output.getContext('2d'), camera = new T.PerspectiveCamera(38, 320 / 760, .05, 100);
    camera.position.set(2.3, 1.8, -3.4); camera.lookAt(0, 1, 0);
    await configureRifleMaterials(renderer.capabilities.getMaxAnisotropy());
    await loadDadaoSurfaces(renderer.capabilities.getMaxAnisotropy());
    const entries = [], samples = [], templates = new Map();
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0);
      templates.set(team, template);
      for (const [column, model] of ['rifle', 'sigm1920', 'sigm1920', 'zb26', 'type11'].entries()) {
        const actor = { id: `${team}-${model}-${column}`, team, friendly: team === 'friendly', unitId: 'pose-review',
          index: 1, health: 100, stance: 'standing', heading: 0, walkPhase: column === 2 ? .1 : 0, tactics: {},
          position: new T.Vector3(), rifle: createRifleState(model), rifleReady: true,
          locomotion: createLocomotion(), formation: { type: 'infantry', memberCount: 11 } };
        const view = template.createView(); view.bind(actor.id); scene.add(view.root);
        for (const stance of ['standing', 'crouched', 'prone']) for (const shoulderAiming of [false, true]) {
          actor.stance = stance; actor.shoulderAiming = shoulderAiming;
          actor.nativeMotion = createNraMotion(template.motionProfile, actor);
          for (let frame = 0; frame < 60; frame++) advanceNraMotion(actor, 1 / 60);
          for (const pitch of [-.5, -.2, 0, .35, .72]) {
            actor.aimPitch = pitch;
            for (let frame = 0; frame < 60; frame++) advanceNraMotion(actor, 1 / 60);
            view.update(actor, 0, null);
            const snapshot = view.snapshot, logical = snapshot.logicalMuzzle, muzzle = snapshot.riflePose.muzzle;
            samples.push({ team, model, stance, shoulderAiming, pitch, issue: view.issue,
              ready: nativeAimReady(actor), chest: sampleNraMotion(actor).chestFire,
              hip: sampleNraMotion(actor).hipFire, hipVariant: column === 2,
              right: snapshot.riflePose.right.palmError, left: snapshot.riflePose.left.palmError,
              muzzleError: Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z) });
          }
        }
        actor.stance = 'standing'; actor.shoulderAiming = false; actor.aimPitch = 0;
        if (movingReview) {
          actor.aiRifle = createAIRifleControl(); actor.nextFire = 0;
          if (infantryWeaponProfile(actor.rifle).automatic) {
            const desired = ['stand', 'step', 'jog', 'stand', 'step'][column];
            for (let seed = 0; seed < 1000; seed++) {
              actor.id = `${team}-${model}-${column}-${seed}`; actor.tactics.automaticFireMotion = null;
              if (automaticFireMovement(actor, 0, 'review-target', 20, { allowed: true }).mode === desired) break;
            }
          }
        }
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        entries.push({ actor, view });
      }
    }
    let activeTeam = 'friendly', time = 0;
    const render = () => {
      renderer.setScissorTest(true);
      for (let column = 0; column < 5; column++) {
        for (const [index, entry] of entries.entries())
          entry.view.root.visible = entry.actor.team === activeTeam && index % 5 === column;
        if (movingReview) {
          const entry = entries.find((entry, index) => entry.actor.team === activeTeam && index % 5 === column);
          camera.position.set(entry.actor.position.x + 2.3, 1.8, entry.actor.position.z - 3.4);
          camera.lookAt(entry.actor.position.x, 1, entry.actor.position.z);
        }
        renderer.setViewport(column * 320, 0, 320, 760); renderer.setScissor(column * 320, 0, 320, 760);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
      context.fillStyle = '#17201e'; context.fillRect(0, 0, 1600, 800);
      context.drawImage(renderer.domElement, 0, 40);
      context.fillStyle = '#fff'; context.font = '17px sans-serif';
      for (const [index, label] of ['RIFLE - SHOULDER', 'SMG - CHEST', 'SMG - HIP', 'ZB26 - FORWARD SUPPORT', 'TYPE11 - FORWARD SUPPORT'].entries()) {
        const actor = entries.find((entry, slot) => entry.actor.team === activeTeam && slot % 5 === index).actor;
        context.fillText(`${label} | ${movingReview ? actor.tactics.automaticFireMotion?.mode ?? 'stand' : actor.rifle.shots}`, index * 320 + 8, 26);
      }
    };
    const images = {};
    for (const team of ['friendly', 'enemy']) {
      activeTeam = team;
      for (const entry of entries) entry.view.update(entry.actor, 0, null);
      render(); images[team] = output.toDataURL('image/png').split(',')[1];
    }
    activeTeam = 'friendly';
    const chunks = [], stream = output.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6500000 });
    const ended = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.start();
    const movingShots = [], teamDuration = movingReview ? 8 : 4;
    for (let frame = 0; frame < teamDuration * 60; frame++) {
      time = frame / 30; activeTeam = time < teamDuration ? 'friendly' : 'enemy';
      for (const entry of entries) {
        if (entry.actor.team !== activeTeam) continue;
        advanceRifle(entry.actor.rifle, 1 / 30);
        if (movingReview) {
          const actor = entry.actor, actorTime = time - (activeTeam === 'enemy' ? teamDuration : 0);
          const plan = automaticFireMovement(actor, actorTime, 'review-target', 20, { allowed: true });
          const moving = plan && plan.mode !== 'stand';
          advanceLocomotion(actor.locomotion, actor.position, { type: 'infantry', stance: 'standing',
            yaw: 0, forward: Number(moving), aiming: plan?.mode === 'step' }, [], 1 / 30);
          actor.aimWalking = moving && plan.mode === 'step';
          actor.automaticFireMoving = Boolean(moving && actor.locomotion.speed > .06);
          actor.rifleReady = true;
          if (attemptAIRifleShot(actor, { now: actorTime, targetId: 'review-target', mayFire: true,
            postureSettled: nativeAimReady(actor), suppressed: false, confirmShot: () => 20 }) && actor.automaticFireMoving)
            movingShots.push({ team: actor.team, model: actor.rifle.model, speed: actor.locomotion.speed, time: actorTime });
        } else if (nativeAimReady(entry.actor)) shootRifle(entry.actor.rifle);
        advanceNraMotion(entry.actor, 1 / 30); entry.view.update(entry.actor, time, null);
        if (entry.view.issue) throw new Error(JSON.stringify({ id: entry.actor.id, issue: entry.view.issue, frame,
          rifle: entry.actor.rifle, motion: sampleNraMotion(entry.actor), pose: entry.view.snapshot.riflePose,
          earlierIssues: samples.filter(sample => sample.issue || !sample.ready || sample.muzzleError > .001) }));
      }
      render(); await new Promise(resolve => setTimeout(resolve, 34));
    }
    recorder.stop(); await ended; stream.getTracks().forEach(track => track.stop());
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    const shots = entries.map(entry => ({ id: entry.actor.id, shots: entry.actor.rifle.shots })), far = [];
    const invalid = samples.filter(sample => sample.issue || (!sample.ready && (sample.chest || sample.pitch <= .35)) ||
      sample.right >= .005 || sample.left >= .005);
    if (invalid.length) throw new Error(JSON.stringify(invalid));
    if (movingReview) return { samples, images, far, video: btoa(binary), shots, movingShots };
    entries.forEach(entry => { entry.view.root.visible = false; });
    camera.aspect = 1600 / 760; camera.position.set(3.2, 2.2, -5.8); camera.lookAt(0, .9, 0); camera.updateProjectionMatrix();
    renderer.setViewport(0, 0, 1600, 760);
    for (const team of ['friendly', 'enemy']) {
      const force = await createNraForceRendererAsync(scene, camera, templates.get(team), 12, { team, lowMemory: true });
      const actors = entries.filter(entry => entry.actor.team === team).map((entry, index) => {
        const actor = entry.actor; actor.position.set((index - 2) * 1.3, 0, 0);
        actor.rifle = createRifleState(actor.rifle.model); actor.rifleReady = true;
        actor.nativeMotion = createNraMotion(templates.get(team).motionProfile, actor); return actor;
      });
      for (const stance of ['standing', 'crouched', 'kneeling']) for (const pitch of [-.3, 0, .3]) {
        for (const actor of actors) {
          actor.stance = stance === 'kneeling' ? 'crouched' : stance; actor.firingPose = stance === 'kneeling' ? stance : null;
          actor.aimPitch = pitch; actor.nativeMotion = createNraMotion(templates.get(team).motionProfile, actor);
        }
        force.update(actors, 0, null, 'high', { detailLimit: 0 });
        for (const actor of actors.filter(actor => actor.rifle.model)) {
          const matching = actors.filter(other => other.rifle.model === actor.rifle.model);
          const mesh = force.root.children.find(mesh => mesh.name === `owned-weapon-${actor.rifle.model}` && mesh.count === matching.length);
          if (!mesh) throw new Error(`Missing far weapon ${actor.id}`);
          const matrix = new T.Matrix4(); mesh.getMatrixAt(matching.indexOf(actor), matrix);
          const profile = infantryWeaponProfile(actor.rifle);
          const actual = new T.Vector3(profile.muzzleX ?? 0, 0, profile.muzzleZ).applyMatrix4(matrix);
          const expected = new T.Vector3().copy(nativeMuzzleLocal(actor)).add(actor.position);
          far.push({ team, model: actor.rifle.model, stance, pitch, near: force.counts.near, far: force.counts.far,
            error: actual.distanceTo(expected) });
        }
        if (stance === 'standing' && pitch === 0) {
          renderer.render(scene, camera); context.clearRect(0, 0, 1600, 800); context.drawImage(renderer.domElement, 0, 40);
          context.fillStyle = '#17201e'; context.fillRect(0, 0, 1600, 40);
          context.fillStyle = '#fff'; context.fillText('SHARED DISTANT POSES - RIFLE / SMG CHEST / SMG HIP / ZB26 / TYPE11', 20, 26);
          images[`${team}-far`] = output.toDataURL('image/png').split(',')[1];
        }
      }
      const movingBodies = [];
      for (const cycle of [0, .25]) {
        for (const actor of actors) {
          actor.stance = 'standing'; actor.firingPose = null; actor.aimPitch = 0;
          actor.nativeMotion = createNraMotion(templates.get(team).motionProfile, actor);
          Object.assign(actor.nativeMotion, { weight: 1, speed: 2.7, gaitAim: 0, gaitCycles: cycle,
            distance: 0, phaseDistance: 0 });
        }
        force.update(actors, 0, null, 'high', { detailLimit: 0 });
        const bodies = force.root.children.filter(mesh => mesh.count > 0 &&
          mesh.geometry?.morphAttributes.position?.length >= 10 && mesh.geometry.boundingBox?.min.y < .3);
        if (bodies.length !== 2) throw new Error(`Missing automatic-weapon moving banks for ${team}`);
        movingBodies.push(bodies.map(mesh => {
          const influence = { morphTargetInfluences: Array(mesh.geometry.morphAttributes.position.length).fill(0) };
          mesh.getMorphAt(0, influence);
          if (!influence.morphTargetInfluences.slice(-8).some(weight => weight > .1))
            throw new Error('Distant automatic firing retained static legs');
          const base = mesh.geometry.attributes.position, morphs = mesh.geometry.morphAttributes.position;
          return Array.from({ length: base.count }, (_, index) => {
            if (base.getY(index) > .3) return null;
            const point = new T.Vector3().fromBufferAttribute(base, index);
            for (let frame = 0; frame < morphs.length; frame++) {
              const delta = new T.Vector3().fromBufferAttribute(morphs[frame], index)
                .sub(new T.Vector3().fromBufferAttribute(base, index));
              point.addScaledVector(delta, influence.morphTargetInfluences[frame]);
            }
            return point.toArray();
          });
        }));
      }
      for (let bank = 0; bank < movingBodies[0].length; bank++) {
        const movement = Math.max(...movingBodies[0][bank].map((point, index) => point
          ? Math.hypot(...point.map((value, axis) => value - movingBodies[1][bank][index][axis])) : 0));
        if (!(movement > .025)) throw new Error(`Distant foot motion too small: ${movement}`);
      }
      force.root.visible = false;
    }
    return { samples, images, far, video: btoa(binary), shots };
  }, process.env.MOVING_FIRE === '1');
  await writeFile(join(directory, 'firing-poses.webm'), Buffer.from(result.video, 'base64'));
  for (const [team, image] of Object.entries(result.images))
    await writeFile(join(directory, `${team}-firing.png`), Buffer.from(image, 'base64'));
  delete result.video; delete result.images;
  await writeFile(join(directory, 'firing-poses.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const sample of result.samples) {
    assert.equal(sample.issue, null, JSON.stringify(sample));
    if (sample.chest || sample.pitch <= .35) assert.equal(sample.ready, true, JSON.stringify(sample));
    assert.ok(sample.right < .005 && sample.left < .005 && sample.muzzleError < .0001, JSON.stringify(sample));
    if (sample.shoulderAiming || sample.stance === 'prone' || sample.model === 'rifle') assert.equal(sample.chest, 0);
    else assert.equal(sample.chest, 1);
    assert.equal(sample.hip, sample.chest && sample.hipVariant ? 1 : 0);
  }
  assert.ok(result.shots.every(sample => sample.shots > 0));
  if (process.env.MOVING_FIRE === '1') for (const team of ['friendly', 'enemy']) {
    assert.ok(result.movingShots.some(shot => shot.team === team && shot.model === 'sigm1920' && shot.speed > .1));
    assert.ok(result.movingShots.some(shot => shot.team === team && shot.model === 'type11' && shot.speed > .1));
  }
  for (const sample of result.far) {
    assert.equal(sample.near, 0); assert.equal(sample.far, 5);
    assert.ok(sample.error < .00001, JSON.stringify(sample));
  }
  console.log(JSON.stringify({ passed: true, samples: result.samples.length, far: result.far.length, shots: result.shots }));
} finally { await browser.close(); }
