import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
let result;
try {
  await page.route('**/__movement-casualties', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__movement-casualties', process.env.GAME_URL ?? 'http://127.0.0.1:5196/').href);
  result = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion, sampleNraMotion, syncNativeAimGoal } = await import('/src/nra-motion.js');
    const { createCasualtyState } = await import('/src/casualties.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { hasIjaRifleFlag } = await import('/src/ija-rifle-flag.js');
    const { groundHeight } = await import('/src/ground.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials();
    const factories = { friendly: await loadNraCharacter(), enemy: await loadIjaCharacter() };
    const scene = new T.Scene(); scene.background = new T.Color('#b5beb6');
    scene.add(new T.HemisphereLight(0xfff6df, 0x4c5c50, 2));
    const light = new T.DirectionalLight(0xffffff, 3); light.position.set(-4, 7, -5); scene.add(light);
    const floor = new T.Mesh(new T.PlaneGeometry(30, 30), new T.MeshStandardMaterial({ color: '#818675', roughness: 1 }));
    floor.rotation.x = -Math.PI / 2; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1400, 900); renderer.toneMapping = T.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(38, 1400 / 900, .05, 200);
    const gaits = [], casualties = [], images = [], videos = [];
    function image(name, label) {
      renderer.render(scene, camera);
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 900;
      const ctx = canvas.getContext('2d'); ctx.drawImage(renderer.domElement, 0, 0);
      ctx.fillStyle = '#ffffffdf'; ctx.fillRect(12, 12, 1350, 42);
      ctx.fillStyle = '#142118'; ctx.font = '17px sans-serif'; ctx.fillText(label, 22, 39);
      images.push({ name, data: canvas.toDataURL() });
    }
    function actorFor(team, factory, id) {
      const actor = { id, team, unitId: 'inspection', health: 100, vehicleId: null, position: new T.Vector3(),
        heading: 0, stance: 'standing', walkPhase: 1.2, rifleReady: false, rifle: createRifleState(),
        deathTime: 0, locomotion: { speed: 0, mode: 'idle' } };
      actor.nativeMotion = createNraMotion(factory.motionProfile, actor);
      return actor;
    }
    async function recordMovement(team, entries) {
      const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 900;
      const ctx = canvas.getContext('2d'); document.body.append(canvas); renderer.domElement.style.display = 'none';
      const stream = canvas.captureStream(30), chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
      for (let frame = 0; frame < 120; frame++) {
        for (const { actor, view } of entries) {
          actor.position.z -= actor.locomotion.speed / 30;
          actor.position.y = groundHeight(actor.position.x, actor.position.z);
          advanceNraMotion(actor, 1 / 30); view.update(actor, frame / 30, null);
        }
        const center = entries.reduce((sum, entry) => sum + entry.actor.position.z, 0) / entries.length;
        camera.position.set(8, 4, center - 12); camera.lookAt(0, .8, center);
        renderer.render(scene, camera); ctx.drawImage(renderer.domElement, 0, 0);
        ctx.fillStyle = '#ffffffdf'; ctx.fillRect(12, 12, 1350, 42);
        ctx.fillStyle = '#142118'; ctx.font = '17px sans-serif';
        ctx.fillText(`${team}: charge / short quick steps / aimed slow movement — movement inspection, not gameplay`, 22, 39);
        await new Promise(resolve => setTimeout(resolve, 33));
      }
      recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      videos.push({ name: `${team}-movement.webm`, data });
      canvas.remove(); renderer.domElement.style.display = '';
    }
    for (const [team, factory] of Object.entries(factories)) {
      const displayed = [], entries = [];
      for (const [column, [mode, speed, aim]] of [['sprint', 4.8, false], ['jog', 3.15, false], ['aim', 1.5, true]].entries()) {
        const view = factory.createView(), actor = actorFor(team, factory, `${team}-${mode}`);
        actor.locomotion = { speed, mode }; actor.aimWalking = aim; actor.rifleReady = aim;
        for (let frame = 0; frame < 150; frame++) { actor.position.z -= speed / 60; advanceNraMotion(actor, 1 / 60); }
        actor.position.set((1 - column) * 1.4, 0, 0); actor.nativeMotion.position = { x: actor.position.x, z: 0 };
        view.bind(actor.id);
        for (let phase = 0; phase < 24; phase++) {
          actor.nativeMotion.gaitCycles = phase / 24;
          view.update(actor, 0, null);
          const before = JSON.stringify(actor.nativeMotion), anatomy = view.anatomy;
          view.update(actor, 0, null);
          const drift = Math.max(...Object.keys(anatomy).map(name => anatomy[name].distanceTo(view.anatomy[name])));
          const snapshot = view.snapshot;
          gaits.push({ team, mode, phase, issue: view.issue, drift, preserved: JSON.stringify(actor.nativeMotion) === before,
            gait: snapshot.gait, head: snapshot.headAim, barrelY: snapshot.riflePose.direction[1] });
        }
        actor.nativeMotion.gaitCycles = .45; view.update(actor, 0, null);
        scene.add(view.root); displayed.push(view.root); entries.push({ actor, view });
      }
      camera.position.set(4.5, 2.3, -5.3); camera.lookAt(0, .9, 0);
      image(`${team}-gaits.png`, `${team}: charge / short quick steps / aimed slow movement — pose inspection, not gameplay`);
      await recordMovement(team, entries);
      displayed.forEach(root => scene.remove(root));
      for (const level of factory.createFarView ? ['near', 'far'] : ['near']) {
        const view = level === 'far' ? factory.createFarView() : factory.createView();
        const gallery = [];
        for (const stance of ['standing', 'kneeling', 'prone']) for (let variant = 0; variant < 4; variant++) for (const retainGun of [false, true]) {
          const actor = actorFor(team, factory, `${team}-${stance}-${variant}-${retainGun}`);
          actor.rifleReady = true; actor.nativeMotion.lowReady = 0; actor.nativeMotion.cheekWeight = 1;
          actor.nativeMotion.posture[stance] = stance === 'standing' ? 0 : 1;
          syncNativeAimGoal(actor);
          actor.health = 0; actor.casualty = createCasualtyState(actor, 1, sampleNraMotion(actor), { variant, retainGun });
          view.bind(actor.id);
          for (const time of [1, 1.2, 1.6, 3, 20]) {
            const before = JSON.stringify(actor.casualty);
            view.update(actor, time, null);
            const anatomy = view.anatomy, snapshot = view.snapshot;
            view.update(actor, time, null);
            const drift = Math.max(...Object.keys(anatomy).map(name => anatomy[name].distanceTo(view.anatomy[name])));
            const lengths = ['Left', 'Right'].flatMap(side => [
              anatomy[side + 'Arm'].distanceTo(anatomy[side + 'ForeArm']),
              anatomy[side + 'ForeArm'].distanceTo(anatomy[side + 'Hand']),
              anatomy[side + 'UpLeg'].distanceTo(anatomy[side + 'Leg']),
              anatomy[side + 'Leg'].distanceTo(anatomy[side + 'Foot'])]);
            casualties.push({ team, level, stance, variant, retainGun, time, drift, lengths,
              head: anatomy.Head.toArray(), hip: anatomy.Hips.toArray(), rightHand: anatomy.RightHand.toArray(),
              casualty: snapshot.casualty, flag: snapshot.rifleFlag, expectedFlag: team === 'enemy' ? hasIjaRifleFlag(actor) : false,
              preserved: JSON.stringify(actor.casualty) === before, visible: view.root.visible });
          }
          if (level === 'near' && stance === 'standing') {
            const display = factory.createView();
            actor.position.set((variant - 1.5) * 2.4, 0, retainGun ? 2.8 : 0);
            display.bind(actor.id); display.update(actor, 3, null); scene.add(display.root); gallery.push(display.root);
          }
        }
        if (gallery.length) {
          camera.position.set(6, 7.5, -8); camera.lookAt(0, 0, 1);
          image(`${team}-casualties.png`, `${team}: four fall directions / dropped gun (front), retained gun (back) — procedural pose inspection`);
          gallery.forEach(root => scene.remove(root));
        }
      }
    }
    return { gaits, casualties, images, videos };
  });
  for (const image of result.images) await writeFile(join(directory, image.name), Buffer.from(image.data.split(',')[1], 'base64'));
  for (const video of result.videos) await writeFile(join(directory, video.name), Buffer.from(video.data.split(',')[1], 'base64'));
  for (const sample of result.gaits) {
    assert.equal(sample.issue, null, JSON.stringify(sample));
    assert.ok(sample.preserved && sample.drift < 1e-6, JSON.stringify(sample));
    assert.equal(sample.gait.style, sample.mode === 'sprint' ? 'charge' : sample.mode === 'jog' ? 'short' : 'aim');
    if (sample.mode === 'aim') assert.ok(sample.head.actualSightError < .004, JSON.stringify(sample));
    else assert.ok(sample.barrelY < -.5, JSON.stringify(sample));
  }
  for (const sample of result.casualties) {
    assert.ok(sample.preserved && sample.visible && sample.drift < 1e-6, JSON.stringify(sample));
    assert.ok(sample.lengths.every(length => length > .20 && length < .55), JSON.stringify(sample));
    if (sample.team === 'enemy') assert.equal(sample.flag, sample.expectedFlag);
    if (sample.time >= 3) assert.ok(sample.head[1] < .6 && sample.hip[1] < .6, JSON.stringify(sample));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, gaits: result.gaits.length, casualties: result.casualties.length }));
} finally {
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ gaits: result?.gaits, casualties: result?.casualties, errors }, null, 2));
  await browser.close();
}
