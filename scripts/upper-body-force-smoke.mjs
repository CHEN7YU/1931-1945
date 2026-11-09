import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__force-shoulders', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__force-shoulders', process.env.GAME_URL ?? 'http://127.0.0.1:5353/').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraForceRendererAsync } = await import('/src/nra-force-renderer.js');
    const { createNraMotion, advanceNraMotion, nativeTravelLean } = await import('/src/nra-motion.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { prepareDistantGeometry } = await import('/src/distant-pose-lod.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    await prepareDistantGeometry();
    await loadDadaoSurfaces(1);
    await configureRifleMaterials(1);
    const scene = new T.Scene(); scene.background = new T.Color('#b6bebb');
    scene.add(new T.HemisphereLight(0xfff4e1, 0x424b40, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(3, 8, -4); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: '#787b6c' }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 720); document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(55, 1280 / 720, .05, 100);
    camera.position.set(2.5, 1.4, -3); camera.lookAt(0, .9, 0);
    const samples = [], images = [], videos = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0), reference = template.createView();
      const force = await createNraForceRendererAsync(scene, camera, template, 12, { team, lowMemory: true });
      await force.prepare(renderer);
      for (const [mode, speed, aiming] of [['walk', 1.75, false], ['jog', 2.7, false], ['sprint', 4.1, false], ['aim', 1.1, true]]) {
        const actor = { id: `force-${team}-${mode}`, team, index: 1, unitId: 'inspection',
          formation: { type: 'infantry', memberCount: 11 }, health: 100, groundType: 'infantry',
          position: new T.Vector3(), heading: 0, stance: 'standing', firingPose: null,
          rifleReady: aiming, tactics: {}, walkPhase: 0, locomotion: { speed, mode },
          rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        Object.assign(actor.nativeMotion, { weight: 1, speed, lowReady: aiming ? 0 : 1,
          gaitAim: aiming ? 1 : 0, gaitCharge: mode === 'sprint' ? 1 : 0 });
        actor.nativeMotion.bodyLean = nativeTravelLean(actor.nativeMotion);
        reference.bind(actor.id); reference.update(actor, 0, null);
        const joints = [reference.anatomy.LeftArm, reference.anatomy.RightArm];
        let body, indices;
        const frames = [];
        for (let frame = 0; frame < 48; frame++) {
          actor.nativeMotion.gaitCycles = frame / 48;
          force.update([actor], frame / 60, null, 'low', { detailLimit: 0 });
          if (!body) {
            body = force.root.children.find(mesh => mesh.isInstancedMesh && mesh.count === 1 &&
              mesh.geometry.attributes.nraSkinTint && mesh.geometry.morphAttributes.position?.length === 3);
            if (!body) throw new Error('Actual moving body did not use a continuous instanced travel bank');
            indices = joints.map(joint => {
              const p = body.geometry.attributes.position;
              let best = 0, closest = Infinity;
              for (let i = 0; i < p.count; i++) {
                const distance = new T.Vector3().fromBufferAttribute(p, i).distanceToSquared(joint);
                if (distance < closest) { closest = distance; best = i; }
              }
              return best;
            });
          }
          if (body.count !== 1) throw new Error('Walking phase changed discrete body banks');
          const control = { morphTargetInfluences: Array(body.geometry.morphAttributes.position.length).fill(0) };
          body.getMorphAt(0, control);
          const weights = control.morphTargetInfluences;
          const positions = indices.map(index => {
            const point = new T.Vector3().fromBufferAttribute(body.geometry.attributes.position, index)
              .multiplyScalar(1 - weights.reduce((sum, weight) => sum + weight, 0));
            body.geometry.morphAttributes.position.forEach((attribute, i) =>
              point.addScaledVector(new T.Vector3().fromBufferAttribute(attribute, index), weights[i]));
            return point.toArray();
          });
          frames.push({ weights: [...weights], left: positions[0], right: positions[1] });
          if ([12, 36].includes(frame)) {
            renderer.render(scene, camera);
            images.push({ name: `${team}-${mode}-instanced-${frame}.png`, data: renderer.domElement.toDataURL() });
          }
        }
        samples.push({ team, mode, frames, bankCount: force.snapshot.poseBanks,
          residentBytes: force.snapshot.residentResources.residentBodyBytes });
        if (mode === 'sprint') {
          const stream = renderer.domElement.captureStream(30), chunks = [];
          const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
          for (let frame = 0; frame < 75; frame++) {
            actor.position.z -= speed / 30;
            advanceNraMotion(actor, 1 / 30);
            camera.position.set(actor.position.x + 2.5, 1.4, actor.position.z - 3);
            camera.lookAt(actor.position.x, .9, actor.position.z); camera.updateMatrixWorld(true);
            force.update([actor], frame / 30, null, 'low', { detailLimit: 0 });
            renderer.render(scene, camera);
            await new Promise(resolve => setTimeout(resolve, 33));
          }
          recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
          const data = await new Promise(resolve => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
          });
          videos.push({ name: `${team}-instanced-running.webm`, data });
          camera.position.set(2.5, 1.4, -3); camera.lookAt(0, .9, 0); camera.updateMatrixWorld(true);
        }
      }
      scene.remove(force.root);
    }
    renderer.dispose();
    return { samples, images, videos };
  });
  await writeFile(join(directory, 'instanced-shoulders.json'), JSON.stringify({ samples: result.samples, errors }, null, 2));
  for (const sample of result.samples) {
    const depths = sample.frames.map(f => f.left[2] - f.right[2]);
    assert.ok(Math.max(...depths) - Math.min(...depths) > (sample.mode === 'aim' ? .003 : .02),
      `${sample.team} ${sample.mode}: actual shoulder garment vertices must move`);
    const jump = Math.max(...sample.frames.slice(1).map((f, i) =>
      Math.hypot(...f.left.map((v, axis) => v - sample.frames[i].left[axis]))));
    assert.ok(jump < .015, `${sample.team} ${sample.mode}: no discrete shoulder-pose jump`);
  }
  for (const image of result.images)
    await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  for (const video of result.videos)
    await writeFile(join(directory, video.name), Buffer.from(video.data.split(',')[1], 'base64'));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, actualInstancedShoulderCases: result.samples.length }));
} finally { await browser.close(); }
