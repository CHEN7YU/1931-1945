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
    const worldBones = new Map();
    worldView.root.traverse(node => { if (node.isBone) worldBones.set(node.name, node); });
    const point = name => worldBones.get(name).getWorldPosition(new T.Vector3());
    const bodyClearance = () => {
      const head = point('Head'), chest = point('LeftArm').add(point('RightArm')).multiplyScalar(.5);
      const volumes = [
        { a: head.clone().add(new T.Vector3(0, .04, 0)), b: head.clone().add(new T.Vector3(0, .13, 0)), radius: .105 },
        { a: point('Neck'), b: head, radius: .085 },
        { a: point('Spine').lerp(chest, .65), b: chest, radius: .115 },
      ];
      let minimum = Infinity;
      for (const side of ['Left', 'Right']) for (const [a, b] of [
        ['Arm', 'ForeArm'], ['ForeArm', 'Hand'], ['Hand', 'HandMiddle1'],
      ]) for (const volume of volumes) {
        const start = point(side + a), end = point(side + b), onArm = new T.Vector3(), onBody = new T.Vector3();
        const ray = new T.Ray(start, end.clone().sub(start).normalize());
        ray.distanceSqToSegment(volume.a, volume.b, onArm, onBody);
        if (onArm.clone().sub(start).dot(ray.direction) > start.distanceTo(end)) onArm.copy(end);
        new T.Line3(volume.a, volume.b).closestPointToPoint(onArm, true, onBody);
        minimum = Math.min(minimum, onArm.distanceTo(onBody) - volume.radius - .035);
      }
      return minimum;
    };
    const actor = { id: 'anatomy-review', team: 'friendly', unitId: 'anatomy-review',
      position: new T.Vector3(), heading: 0, walkPhase: 0, health: 100, stance: 'standing',
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), dadao: {} };
    actor.nativeMotion = createNraMotion(worldView.motionProfile, actor); worldView.bind(actor.id);
    for (const idleTime of [0, 2.1, 5.9]) for (const style of [0, 1])
    for (const phase of ['ready', 'windup', 'cut', 'recover'])
    for (let frame = 0; frame <= 100; frame++) {
      Object.assign(actor.dadao, { equipped: true, style, mode: phase, pose: { phase, progress: frame / 100 } });
      actor.nativeMotion.idleTime = idleTime;
      worldView.update(actor, 0, null);
      worldSamples.push({ style, phase, idleTime, sampleFrame: frame, clearance: bodyClearance(),
        issue: worldView.snapshot.issue, ...worldView.snapshot.dadao });
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
    for (const [phase, progress] of [['windup', 1], ['cut', 1], ['recover', .35], ['recover', .65]]) {
      updateDadaoView(view, { phase, progress }, { weaponX: 0, weaponY: 0 }, camera);
      renderer.render(scene, camera);
      ctx.fillStyle = '#17201e'; ctx.fillRect(0, 0, 1440, 850); ctx.drawImage(renderer.domElement, 0, 40);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
      ctx.fillText(`FIRST PERSON | EXACT ${phase} ${progress} | MODEL REVIEW`, 15, 27);
      images[`first-person-key-${phase}-${progress}`] = output.toDataURL('image/png').split(',')[1];
    }
    const chunks = [], stream = output.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    const length = DADAO.windup + DADAO.active + DADAO.recovery;
    const cycle = length + .35;
    recorder.start();
    for (const section of [{ name: 'FIRST PERSON', speed: 1, camera }, { name: 'FIRST PERSON', speed: .5, camera },
      { name: 'SIDE OBSERVER', speed: .5, camera: side }]) {
      const start = performance.now(), seconds = 2 * cycle / section.speed;
      while ((performance.now() - start) / 1000 < seconds) {
        const time = ((performance.now() - start) / 1000 * section.speed) % cycle;
        const pose = dadaoPhase({ equipped: true, readyAt: 0, startedAt: time < length ? 0 : null }, time);
        updateDadaoView(view, pose, { weaponX: 0, weaponY: 0 }, camera);
        renderer.render(scene, section.camera);
        ctx.fillStyle = '#17201e'; ctx.fillRect(0, 0, 1440, 850); ctx.drawImage(renderer.domElement, 0, 40);
        ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif';
        ctx.fillText(`${section.name} | ${pose.phase} | ${section.speed === 1 ? 'NORMAL 1x' : 'SLOW 0.5x'} | CONTROLLED MODEL REVIEW`, 15, 27);
        const key = `${section.name.replaceAll(' ', '-')}-${section.speed}-${pose.phase}`;
        if (!images[key] && pose.progress > .45) images[key] = output.toDataURL('image/png').split(',')[1];
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    }
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const encode = async chunks => {
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    };
    scene.remove(view); scene.add(worldView.root);
    const ground = new T.Mesh(new T.PlaneGeometry(8, 8), new T.MeshStandardMaterial({ color: 0x4b5851, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -.015; scene.add(ground);
    scene.add(new T.GridHelper(8, 16, 0x9ca99e, 0x65746a));
    const angles = [
      { name: 'FRONT', position: [0, 1.35, -4.4] },
      { name: 'PROFILE', position: [4.4, 1.35, 0] },
      { name: 'THREE-QUARTER', position: [3.1, 1.35, -3.1] },
    ].map(angle => {
      const camera = new T.PerspectiveCamera(42, 480 / 810, .03, 30);
      camera.position.fromArray(angle.position); camera.lookAt(0, 1.02, 0);
      return { ...angle, camera };
    });
    const renderWorld = label => {
      ctx.fillStyle = '#17201e'; ctx.fillRect(0, 0, 1440, 850);
      renderer.setScissorTest(true);
      for (const [index, angle] of angles.entries()) {
        renderer.setViewport(index * 480, 0, 480, 810); renderer.setScissor(index * 480, 0, 480, 810);
        renderer.render(scene, angle.camera);
      }
      renderer.setScissorTest(false);
      ctx.drawImage(renderer.domElement, 0, 40);
      ctx.fillStyle = '#fff'; ctx.font = '20px sans-serif'; ctx.fillText(label, 15, 27);
      angles.forEach((angle, index) => ctx.fillText(angle.name, index * 480 + 15, 70));
    };
    for (const style of [0, 1]) for (const [phase, progress] of [
      ['windup', 1], ['cut', .25], ['cut', .4], ['cut', .65], ['cut', 1], ['recover', .35], ['recover', .65],
    ]) {
      actor.dadao = { equipped: true, style, pose: { phase, progress } };
      worldView.update(actor, 0, null);
      renderWorld(`THIRD PERSON | ${style ? 'OVERHEAD' : 'SHOULDER'} | EXACT ${phase} ${progress} | MODEL REVIEW`);
      images[`world-key-${style}-${phase}-${progress}`] = output.toDataURL('image/png').split(',')[1];
    }
    const worldChunks = [], worldStream = output.captureStream(30);
    const worldRecorder = new MediaRecorder(worldStream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 5000000 });
    worldRecorder.ondataavailable = event => { if (event.data.size) worldChunks.push(event.data); };
    const worldStopped = new Promise(resolve => { worldRecorder.onstop = resolve; });
    worldRecorder.start();
    for (const style of [0, 1]) for (const speed of [1, .5]) {
      const start = performance.now(), seconds = 2 * cycle / speed;
      while ((performance.now() - start) / 1000 < seconds) {
        const time = ((performance.now() - start) / 1000 * speed) % cycle;
        actor.dadao = { equipped: true, style, pose: dadaoPhase({
          equipped: true, readyAt: 0, startedAt: time < length ? 0 : null }, time) };
        worldView.update(actor, 0, null);
        renderWorld(`THIRD PERSON | ${style ? 'OVERHEAD' : 'SHOULDER'} | ${actor.dadao.pose.phase} | ${speed}x | MODEL REVIEW`);
        const key = `world-${style}-${speed}-${actor.dadao.pose.phase}`;
        if (!images[key] && actor.dadao.pose.progress > .45)
          images[key] = output.toDataURL('image/png').split(',')[1];
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
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
    assert.ok(sample.clearance > .003, `actual animated character penetrates head/neck/chest: ${JSON.stringify(sample)}`);
  }
  console.log(JSON.stringify({ passed: true, samples: result.samples.length }));
} finally { await browser.close(); }
