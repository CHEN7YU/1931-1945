import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack));
  await page.route('**/__blast-poses', route => route.fulfill({ contentType: 'text/html',
    body: '<html><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__blast-poses', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const result = await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const { createNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createLocomotion, advanceLocomotion } = await import('/src/locomotion.js');
    const { advanceNraMotion } = await import('/src/nra-motion.js');
    const { createDadaoState, drawDadao, startDadaoSwing, advanceDadao } = await import('/src/dadao.js');
    const { beginBlastReaction, sampleBlastReaction, advanceBlastReaction, BLAST_REACTION } = await import('/src/blast-reaction.js');
    const scene = new T.Scene(); scene.background = new T.Color(0x9ca9a5);
    scene.add(new T.HemisphereLight(0xfff4dc, 0x53615a, 2));
    const sun = new T.DirectionalLight(0xffedcf, 2.5); sun.position.set(-5, 15, -8); scene.add(sun);
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0x767a68 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 800); renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    document.body.append(renderer.domElement);
    const camera = new T.PerspectiveCamera(42, 1.5, .05, 100);
    camera.position.set(3.2, 2.1, -3.8); camera.lookAt(0, .8, 0);
    await configureRifleMaterials(renderer.capabilities.getMaxAnisotropy());
    await loadDadaoSurfaces(renderer.capabilities.getMaxAnisotropy());
    const observations = [], entries = []; let swordEntry;
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0);
      if (team === 'friendly') {
        const actor = { id: 'two-handed-dadao', team, health: 100, stance: 'standing',
          heading: 0, walkPhase: 0, position: new T.Vector3(), rifle: createRifleState(),
          locomotion: createLocomotion(), tactics: {}, dadao: { ...createDadaoState(), equipped: true } };
        const view = template.createView(); view.bind(actor.id); scene.add(view.root);
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        for (const style of [0, 1]) for (const phase of ['draw', 'ready', 'windup', 'cut', 'recover']) {
          for (let frame = 0; frame <= 20; frame++) {
            actor.dadao.style = style; actor.dadao.pose = { phase, progress: frame / 20 };
            view.update(actor, 0, null);
            if (view.issue) throw new Error(`Sword ${style}/${phase}/${frame}: ${view.issue} ${JSON.stringify(view.snapshot.dadao)}`);
            if (view.snapshot.dadao.leftPalmError > .015) throw new Error('Second fist missed the handle');
          }
        }
        view.root.visible = false;
        swordEntry = { actor, view };
      }
      for (const stance of ['standing', 'crouched']) for (const [index, [x, z]] of [[-1, 0], [1, 0], [0, -1], [0, 1]].entries()) {
        const actor = { id: `${team}-${stance}-${index}`, team, friendly: team === 'friendly',
          unitId: 'blast-review', index: 1, health: 50, stance, heading: 0, walkPhase: 0, tactics: {},
          groundType: 'infantry', position: new T.Vector3(), rifle: createRifleState(), rifleReady: false,
          locomotion: createLocomotion(), formation: { type: 'infantry', memberCount: 11 } };
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        const view = template.createView(); view.bind(actor.id); scene.add(view.root);
        beginBlastReaction(actor, { x: -x, z: -z }, 45, 0, sampleNraMotion(actor), { force: true });
        for (let frame = 0; frame <= 204; frame++) {
          actor.blastReaction.elapsed = Math.min(BLAST_REACTION.duration, frame / 60);
          view.update(actor, frame / 60, null);
          if (view.issue) throw new Error(`${actor.id}/${frame}: ${view.issue}`);
          const anatomy = view.anatomy;
          if (JSON.stringify(anatomy).includes('null')) throw new Error(`Non-finite anatomy: ${actor.id}/${frame}`);
          if (frame % 12 === 0) observations.push({ id: actor.id, frame,
            phase: sampleBlastReaction(actor).phase, root: view.root.position.toArray() });
        }
        actor.blastReaction.elapsed = 0; view.root.visible = false;
        entries.push({ actor, view });
      }
    }
    const output = document.createElement('canvas'); output.width = 1200; output.height = 840;
    document.body.append(output); renderer.domElement.style.display = 'none';
    const context = output.getContext('2d'), images = {};
    async function record(sequences, sword) {
      const chunks = [], stream = output.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 6500000 });
      const ended = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      for (const [sequence, entry] of sequences.entries()) {
        const { actor, view } = entry;
        for (const other of [...entries, swordEntry]) other.view.root.visible = false;
        actor.position.set(0, 0, 0); actor.blastReaction = null; actor.blastRecoveryUntil = 0;
        actor.locomotion = createLocomotion(); actor.nativeMotion = createNraMotion(view.motionProfile, actor);
        if (sword) {
          actor.dadao = createDadaoState(); actor.dadao.style = sequence;
          drawDadao(actor.dadao, 0);
        }
        for (let frame = 0; frame < 150; frame++) {
          const now = frame / 30;
          if (sword) {
            const moving = now > .4 && now < 1.7;
            advanceLocomotion(actor.locomotion, actor.position, { type: 'infantry', stance: 'standing',
              yaw: 0, forward: Number(moving), sprint: true }, [], 1 / 30);
            if (frame === 60) startDadaoSwing(actor.dadao, now);
            actor.dadao.pose = advanceDadao(actor.dadao, now);
            actor.dadao.mode = actor.dadao.startedAt !== null ? actor.dadao.pose.phase : moving ? 'charge' : 'ready';
            advanceNraMotion(actor, 1 / 30);
          } else {
            if (frame === 15) beginBlastReaction(actor, { x: sequence ? 0 : -1, z: sequence ? 1 : 0 }, 45,
              now, sampleNraMotion(actor), { force: true });
            advanceBlastReaction(actor, 1 / 30, (x, z) => { actor.position.x += x; actor.position.z += z; });
          }
          view.update(actor, now, null);
          if (view.issue) throw new Error(`Recorded ${actor.id}/${now}: ${view.issue}`);
          camera.position.set(actor.position.x + 3.2, 2.1, actor.position.z - 3.8);
          camera.lookAt(actor.position.x, .85, actor.position.z);
          renderer.render(scene, camera);
          context.fillStyle = '#17201e'; context.fillRect(0, 0, 1200, 840);
          context.drawImage(renderer.domElement, 0, 40);
          context.fillStyle = '#fff'; context.font = '20px sans-serif';
          const label = sword ? `TWO-HANDED SWORD - ${sequence ? 'OVERHEAD' : 'OVER SHOULDER'}`
            : `${actor.team.toUpperCase()} - BLAST / ${sampleBlastReaction(actor)?.phase ?? 'STABLE'}`;
          context.fillText(`${label} | REAL RIG MOTION REVIEW | ${now.toFixed(2)}s`, 16, 27);
          if (frame === 40 || frame === 70 || frame === 85)
            images[`${sword ? 'sword' : 'blast'}-${sequence}-${frame}`] = output.toDataURL('image/png').split(',')[1];
          await new Promise(resolve => setTimeout(resolve, 34));
        }
        view.root.visible = false;
      }
      recorder.stop(); await ended; stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return btoa(binary);
    }
    const videos = { 'blast-recovery': await record([entries[0], entries[10]], false),
      'two-handed-dadao': await record([swordEntry, swordEntry], true) };
    return { observations, actors: entries.length, videos, images };
  });
  for (const [name, video] of Object.entries(result.videos))
    await writeFile(join(directory, `${name}.webm`), Buffer.from(video, 'base64'));
  for (const [name, image] of Object.entries(result.images))
    await writeFile(join(directory, `${name}.png`), Buffer.from(image, 'base64'));
  delete result.videos; delete result.images;
  await writeFile(join(directory, 'blast-rig-observations.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(result.actors, 16);
  console.log(`Checked ${result.actors} real rigs over 205 recovery frames each`);
} finally {
  await browser.close();
}
