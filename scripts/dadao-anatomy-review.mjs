import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__sword-review', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__sword-review', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const { dadaoViewModel, updateDadaoView } = await import('/src/dadao-model.js');
    const { DADAO, dadaoPhase } = await import('/src/dadao.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    await loadDadaoSurfaces(8);
    const factory = await loadNraCharacter(), view = dadaoViewModel(factory.createGrenadeHand);
    const worldView = factory.createView(), worldSamples = [];
    const actor = { id: 'anatomy-review', team: 'friendly', unitId: 'anatomy-review',
      position: new T.Vector3(), heading: 0, walkPhase: 0, health: 100, stance: 'standing',
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), dadao: {} };
    actor.nativeMotion = createNraMotion(worldView.motionProfile, actor); worldView.bind(actor.id);
    for (const style of [0, 1]) for (const phase of ['ready', 'windup', 'cut', 'recover'])
    for (let frame = 0; frame <= 100; frame++) {
      Object.assign(actor.dadao, { equipped: true, style, mode: phase, pose: { phase, progress: frame / 100 } });
      worldView.update(actor, 0, null);
      worldSamples.push({ style, phase, sampleFrame: frame, issue: worldView.snapshot.issue, ...worldView.snapshot.dadao });
    }
    const scene = new T.Scene(); scene.background = new T.Color('#71817b');
    scene.add(new T.HemisphereLight(0xfff1dc, 0x586153, 2.4));
    const sun = new T.DirectionalLight(0xffe6ca, 2.2); sun.position.set(-2, 4, 1); scene.add(sun, view);
    const camera = new T.PerspectiveCamera(72, 16 / 9, .03, 30);
    const side = new T.PerspectiveCamera(55, 16 / 9, .03, 30);
    side.position.set(.9, .18, .45); side.lookAt(0, -.10, -.25);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1440, 810); renderer.toneMapping = T.ACESFilmicToneMapping;
    const output = document.createElement('canvas'); output.width = 1440; output.height = 850; document.body.append(output);
    const ctx = output.getContext('2d'), samples = [], images = {};
    for (const aspect of [16 / 9, .45, .36]) for (const phase of ['ready', 'windup', 'cut', 'recover'])
    for (let frame = 0; frame <= 60; frame++) {
      camera.aspect = aspect;
      updateDadaoView(view, { phase, progress: frame / 60 }, { weaponX: 0, weaponY: 0 }, camera);
      for (const [name, hand] of [['right', view.userData.dadaoArm], ['left', view.userData.dadaoLeftArm]]) {
        const arm = hand.armSnapshot;
        if (!arm.reachable || arm.error > .001) throw new Error(JSON.stringify({ aspect, phase, frame, name, arm }));
        const wrist = new T.Vector3(...arm.wrist), elbow = new T.Vector3(...arm.elbow), shoulder = new T.Vector3(...arm.shoulder);
        samples.push({ aspect, phase, sampleFrame: frame, name, ...arm,
          upper: shoulder.distanceTo(elbow), lower: elbow.distanceTo(wrist) });
      }
    }
    camera.aspect = 16 / 9; camera.updateProjectionMatrix();
    const chunks = [], stream = output.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    const length = DADAO.windup + DADAO.active + DADAO.recovery;
    recorder.start();
    for (let frame = 0; frame < 360; frame++) {
      const time = (frame % 120) / 120 * (length + .35);
      const pose = dadaoPhase({ equipped: true, readyAt: 0, startedAt: time < length ? 0 : null }, time);
      updateDadaoView(view, pose, { weaponX: 0, weaponY: 0 }, camera);
      renderer.render(scene, frame < 240 ? camera : side);
      ctx.fillStyle = '#17201e'; ctx.fillRect(0, 0, 1440, 850); ctx.drawImage(renderer.domElement, 0, 40);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
      ctx.fillText(`${frame < 240 ? 'FIRST PERSON' : 'SIDE OBSERVER'} | TWO-HAND CHOP | ${pose.phase} | ${frame < 120 ? 'NORMAL' : 'SLOW REVIEW'}`, 15, 27);
      if ([0, 22, 38, 55, 78, 265, 280, 300].includes(frame)) images[frame] = output.toDataURL('image/png').split(',')[1];
      await new Promise(resolve => setTimeout(resolve, frame < 120 ? 12 : 34));
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const encode = async chunks => {
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    };
    scene.remove(view); scene.add(worldView.root);
    camera.fov = 40; camera.updateProjectionMatrix();
    camera.position.set(2, 1.7, -3.4); camera.lookAt(0, 1.05, 0);
    const worldChunks = [], worldStream = output.captureStream(30);
    const worldRecorder = new MediaRecorder(worldStream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    worldRecorder.ondataavailable = event => { if (event.data.size) worldChunks.push(event.data); };
    const worldStopped = new Promise(resolve => { worldRecorder.onstop = resolve; });
    worldRecorder.start();
    for (let frame = 0; frame < 300; frame++) {
      const style = Number(frame >= 150), time = frame % 75 / 75 * (length + .35);
      actor.dadao = { equipped: true, style, pose: dadaoPhase({
        equipped: true, readyAt: 0, startedAt: time < length ? 0 : null }, time) };
      worldView.update(actor, 0, null); renderer.render(scene, camera);
      ctx.fillStyle = '#17201e'; ctx.fillRect(0, 0, 1440, 850); ctx.drawImage(renderer.domElement, 0, 40);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
      ctx.fillText(`THIRD PERSON | ${style ? 'OVERHEAD' : 'SHOULDER'} | ${actor.dadao.pose.phase} | CONTROLLED MODEL REVIEW`, 15, 27);
      if ([0, 22, 38, 150, 172, 188].includes(frame)) images[`world-${frame}`] = output.toDataURL('image/png').split(',')[1];
      await new Promise(resolve => setTimeout(resolve, 34));
    }
    worldRecorder.stop(); await worldStopped; worldStream.getTracks().forEach(track => track.stop());
    return { samples, worldSamples, images, video: await encode(chunks), worldVideo: await encode(worldChunks) };
  });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'dadao-anatomy.webm'), Buffer.from(result.video, 'base64'));
  await writeFile(join(directory, 'dadao-third-person.webm'), Buffer.from(result.worldVideo, 'base64'));
  for (const [name, image] of Object.entries(result.images))
    await writeFile(join(directory, `sword-${name}.png`), Buffer.from(image, 'base64'));
  delete result.video; delete result.worldVideo; delete result.images;
  await writeFile(join(directory, 'anatomy.json'), JSON.stringify(result, null, 2));
  for (const sample of result.worldSamples) {
    assert.equal(sample.issue, null, JSON.stringify(sample));
    assert.ok(sample.wristAlignment > .65 && sample.leftWristAlignment > .65, JSON.stringify(sample));
  }
  console.log(JSON.stringify({ passed: true, samples: result.samples.length }));
} finally { await browser.close(); }
