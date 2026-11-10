import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR, archive = process.env.TRIAL_ARCHIVE;
if (!directory || !archive) throw new Error('ARTIFACT_DIR and TRIAL_ARCHIVE are required');
const humanAnimation = await readFile(join(archive, 'src', 'human-animation.js'), 'utf8');
await mkdir(directory, { recursive: true });
const replace = (source, before, after) => {
  assert.ok(source.includes(before), `Archived B integration anchor missing: ${before}`);
  return source.replace(before, after);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const observations = {};
  for (const variant of ['A', 'B']) {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__animation-actions', route => route.fulfill({
      contentType: 'text/html', body: '<html><body style="margin:0"></body></html>',
    }));
    if (variant === 'B') {
      await page.route('**/src/human-animation.js', route => route.fulfill({
        contentType: 'text/javascript', body: humanAnimation,
      }));
      await page.route(/\/src\/(?:nra-motion|foot-contact|nra-gait)\.js(?:\?|$)/, async route => {
        const response = await route.fetch(); let source = await response.text();
        const file = new URL(route.request().url()).pathname;
        if (file.endsWith('nra-motion.js')) {
          source += "\nimport { createHumanAnimation, advanceHumanAnimation, humanBodyLayer } from './human-animation.js';\n";
          source = replace(source, 'const motion = { profile, aim: 0,', "const motion = { human: createHumanAnimation(actor), animationVariant: 'hybrid', profile, aim: 0,");
          source = replace(source, 'const measuredSpeed = traveled / dt;', `const measuredSpeed = traveled / dt;
            advanceHumanAnimation(motion.human, { actor, dx: actor.position.x - motion.position.x,
              dz: actor.position.z - motion.position.z, dt, intent: nativePoseIntent(actor) });`);
          source = replace(source, 'motion.bodyLean += (leanTarget - motion.bodyLean)',
            'motion.bodyLean += (Math.max(0, leanTarget + motion.human.lean) - motion.bodyLean)');
          source = replace(source, 'return { travelWeight, upperBody };',
            'return { travelWeight, upperBody: humanBodyLayer(motion.human, upperBody, travelWeight) };');
          source = replace(source, 'travelCarryBlend: motion.travelCarryBlend,', `travelCarryBlend: motion.travelCarryBlend,
            animationVariant: 'hybrid', travelDirection: { x: motion.human.directionX, z: motion.human.directionZ },`);
        } else if (file.endsWith('foot-contact.js')) {
          source = replace(source, 'const foot = feet[side], z = foot.z + walk.z + (run.z - walk.z) * gait.jog;',
            `const foot = feet[side], travel = walk.z + (run.z - walk.z) * gait.jog;
             const x = foot.x - travel * motion.human.directionX, z = foot.z - travel * motion.human.directionZ;`);
          source = replace(source, 'actor.position.x + foot.x * c + z * s', 'actor.position.x + x * c + z * s');
          source = replace(source, 'actor.position.z - foot.x * s + z * c', 'actor.position.z - x * s + z * c');
        } else {
          source = replace(source, 'local.z += travelZ * (1 - turning);',
            `const direction = motion.travelDirection ?? { x: 0, z: -1 };
             local.x -= travelZ * direction.x * (1 - turning);
             local.z -= travelZ * direction.z * (1 - turning);`);
          source = replace(source, 'const solved = solveArm(upper, knee, foot, target,',
            `if (motion.animationVariant === 'hybrid')
               limitFootReach(origin, bend, source, target, side === 'Left' ? -1 : 1, facing);
             const solved = solveArm(upper, knee, foot, target,`);
        }
        await route.fulfill({ response, body: source });
      });
    }
    await page.goto(new URL('/__animation-actions', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
    const result = await page.evaluate(async variant => {
      const T = await import('/node_modules/three/build/three.module.js');
      const { loadNraCharacter } = await import('/src/nra-character.js');
      const { configureRifleMaterials } = await import('/src/rifle-model.js');
      const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
      const { createLocomotion } = await import('/src/locomotion.js');
      const { createRifleState, advanceRifle, shootRifle, reloadRifle } = await import('/src/rifle-action.js');
      const template = await loadNraCharacter(); configureRifleMaterials(template.rifleMaterials);
      const actor = { id: 'paired-actions', team: 'friendly', unitId: 'paired-actions', index: 1, health: 100,
        position: new T.Vector3(), heading: 0, walkPhase: 0, stance: 'standing', rifleReady: true,
        rifle: createRifleState('sigm1920'), locomotion: createLocomotion(), tactics: {} };
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      const view = template.createView(); view.bind(actor.id);
      const scene = new T.Scene(); scene.background = new T.Color(0x9ca9a5); scene.add(view.root);
      scene.add(new T.HemisphereLight(0xfff4dc, 0x53615a, 2));
      const sun = new T.DirectionalLight(0xffedcf, 2.5); sun.position.set(-5, 15, -8); scene.add(sun);
      const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial({ color: 0x767a68 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.01; scene.add(floor);
      const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(800, 800); renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      const camera = new T.PerspectiveCamera(36, 1, .05, 100);
      camera.position.set(2.2, 1.8, -3.5); camera.lookAt(0, .9, 0);
      const output = document.createElement('canvas'); output.width = 800; output.height = 840;
      document.body.append(output); const context = output.getContext('2d');
      const chunks = [], images = {}, cpu = [], poses = [];
      const stream = output.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4500000 });
      const ended = new Promise(resolve => { recorder.onstop = resolve; });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.start();
      for (let frame = 0; frame < 420; frame++) {
        const now = frame / 30;
        actor.stance = now >= 6 && now < 7 ? 'crouched' : now >= 10 && now < 11.2 ? 'prone' : 'standing';
        actor.heading = now >= 8 && now < 10 ? Math.sin((now - 8) * Math.PI) * 1.2 : 0;
        actor.rifleReady = true;
        if (frame === 60) { actor.rifle.ammo = 0; reloadRifle(actor.rifle); }
        if (now < 2 && frame % 12 === 0) shootRifle(actor.rifle);
        advanceRifle(actor.rifle, 1 / 30);
        const start = performance.now();
        advanceNraMotion(actor, 1 / 30); view.update(actor, now, null);
        if (frame > 30) cpu.push(performance.now() - start);
        if (view.issue) throw new Error(`${variant}/${now}: ${view.issue}`);
        renderer.render(scene, camera);
        context.fillStyle = '#17201e'; context.fillRect(0, 0, 800, 840); context.drawImage(renderer.domElement, 0, 40);
        context.fillStyle = '#fff'; context.font = '17px sans-serif';
        const action = now < 2 ? 'SHOOT' : now < 6 ? 'RELOAD' : now < 8 ? 'CROUCH / STAND'
          : now < 10 ? 'STATIONARY TURN' : now < 12.5 ? 'PRONE / STAND' : 'STAND';
        context.fillText(`${variant === 'A' ? 'A - CURRENT' : 'B - ARCHIVED INERTIA'} | ${action} | ${now.toFixed(2)}s`, 12, 27);
        if ([30, 90, 195, 255, 321, 375].includes(frame)) {
          images[frame] = output.toDataURL('image/png').split(',')[1];
          poses.push({ time: now, stance: actor.stance, rifle: actor.rifle.action, head: view.snapshot.head,
            leftHand: view.snapshot.leftHand, rightHand: view.snapshot.rightHand });
        }
        await new Promise(resolve => setTimeout(resolve, 34));
      }
      recorder.stop(); await ended; stream.getTracks().forEach(track => track.stop());
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      cpu.sort((a, b) => a - b);
      return { video: btoa(binary), images, poses, cpuBoneUpdateMs: { p50: cpu[Math.floor(cpu.length * .5)],
        p95: cpu[Math.floor(cpu.length * .95)] } };
    }, variant);
    await writeFile(join(directory, `${variant}-actions.webm`), Buffer.from(result.video, 'base64'));
    for (const [frame, image] of Object.entries(result.images))
      await writeFile(join(directory, `${variant}-${frame}.png`), Buffer.from(image, 'base64'));
    delete result.video; delete result.images;
    assert.deepEqual(errors, []); observations[variant] = result;
    await page.close();
  }
  await writeFile(join(directory, 'action-comparison.json'), JSON.stringify({ ...observations,
    scope: 'Archived B inertia only; no new shooting, reload or posture clips; CPU bone updates are not whole-game FPS.' }, null, 2));
  console.log(JSON.stringify({ passed: true, variants: ['current-A', 'archived-B'], actions: 5 }));
} finally { await browser.close(); }
