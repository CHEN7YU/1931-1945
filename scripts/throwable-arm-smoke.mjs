import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const output = process.env.ARTIFACT_DIR || 'artifacts/throwable-arm-v2/enlisted-v4';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.route('**/throwable-arm-fixture', route => route.fulfill({
  contentType: 'text/html',
  body: '<!doctype html><html><body style="margin:0;overflow:hidden"><div id="phase" style="position:fixed;left:24px;top:24px;color:white;font:18px monospace"></div><script type="module">window.ready=true</script></body></html>',
}));
try {
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5214'}/throwable-arm-fixture`);
  await page.evaluate(async () => {
    const T = await import('/node_modules/three/build/three.module.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { createGrenadeRenderer } = await import('/src/grenade-renderer.js');
    const { grenadePose, throwableProfile } = await import('/src/grenades.js');
    const { createNativePosturePoses } = await import('/src/nra-posture-pose.js');
    const { createNraRiflePose } = await import('/src/nra-rifle-pose.js');
    const { FIRING_POSES } = await import('/src/combat-posture.js');
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(75, 1440 / 900, .025, 20);
    scene.background = new T.Color(0x63717b); scene.add(camera);
    scene.add(new T.HemisphereLight(0xe4efff, 0x4c4231, 2.5));
    const sun = new T.DirectionalLight(0xffefd7, 3.2); sun.position.set(-2, 4, 3); scene.add(sun);
    const gl = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    gl.setSize(1440, 900); gl.setPixelRatio(1); gl.toneMapping = T.ACESFilmicToneMapping;
    document.body.appendChild(gl.domElement);
    const character = await loadNraCharacter(), hands = [];
    const native = createGrenadeRenderer(scene, camera, side => {
      const hand = character.createGrenadeHand(side); hands.push(hand); return hand;
    });
    const diagnostic = createGrenadeRenderer(scene, camera);
    const actor = { id: 'fixture', health: 100, grenades: { ammo: 1, packs: 1, action: null } };
    const observer = new T.PerspectiveCamera(50, 1440 / 900, .025, 20);
    observer.position.set(1.25, .48, .85); observer.lookAt(.16, -.16, -.02);
    const reference = new T.Group(); reference.visible = false; scene.add(reference);
    const head = new T.Mesh(new T.SphereGeometry(.10, 20, 12), new T.MeshBasicMaterial({ color: 0x8ac9ff, wireframe: true }));
    head.position.set(0, -.01, .01); reference.add(head);
    const shoulder = new T.AxesHelper(.12); shoulder.position.set(.2, -.25, -.03); reference.add(shoulder);
    const body = character.createView().root, avatar = body.children[0], bones = new Map(), skins = [];
    for (const child of body.children) if (child !== avatar) child.visible = false;
    avatar.traverse(node => { if (node.isBone) bones.set(node.name, node); if (node.isSkinnedMesh) skins.push(node); });
    const postures = createNativePosturePoses(avatar, bones), mixer = new T.AnimationMixer(skins[0]);
    const bodyRest = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
    const bodyPose = createNraRiflePose(body, bones, new T.Group()); scene.add(body);
    window.fixture = {
      sample(kind, phase, progress, fallback = false) {
        reference.visible = false; body.visible = false;
        native.clear(); diagnostic.clear();
        const duration = throwableProfile(kind)[phase === 'drawing' ? 'draw' : phase === 'throwing' ? 'windup' : 'recovery'];
        actor.grenades.action = phase === 'idle' ? null : { kind, phase, elapsed: progress * duration };
        const view = fallback ? diagnostic : native;
        view.update([], actor, true, true, kind); scene.updateMatrixWorld(true); gl.render(scene, camera);
        document.querySelector('#phase').textContent = `${kind} | ${phase} ${Math.round(progress * 100)}%${fallback ? ' | diagnostic' : ''}`;
        const contacts = {};
        if (!fallback && phase === 'drawing' && progress === .3) {
          const held = hands[1].parent.children.find(node => node.visible && node.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle'));
          const handle = held.getObjectByName(kind === 'grenade' ? 'safety-ring' : 'pull-handle');
          const target = kind === 'grenade' ? handle.localToWorld(new T.Vector3(.009, .067, .011)) : handle.getWorldPosition(new T.Vector3());
          for (const finger of ['Index', 'Thumb']) {
            contacts[finger] = hands[0].getObjectByName(`LeftHand${finger}4`).getWorldPosition(new T.Vector3()).distanceTo(target);
          }
        }
        let readability = null;
        if (!fallback) {
          const frame = hands[1].attachmentFrame, wrist = frame.getWorldPosition(new T.Vector3());
          const palm = new T.Vector3(0, 0, 1).applyQuaternion(frame.getWorldQuaternion(new T.Quaternion()));
          const tips = ['Index', 'Middle', 'Ring', 'Pinky'].map(finger =>
            hands[1].getObjectByName(`RightHand${finger}4`).getWorldPosition(new T.Vector3()).project(camera).toArray());
          readability = { wrist: wrist.toArray(), projectedWrist: wrist.clone().project(camera).toArray(),
            palmFacingCamera: palm.dot(camera.position.clone().sub(wrist).normalize()), tips,
            armVisible: hands[1].visible, closure: view.snapshot.grip.closure };
          const guide = hands[0].attachmentFrame, guideWrist = guide.getWorldPosition(new T.Vector3());
          const guidePalm = new T.Vector3(0, 0, hands[0].userData.palmFacingAxis ?? 1).applyQuaternion(guide.getWorldQuaternion(new T.Quaternion()));
          readability.guide = { wrist: guideWrist.toArray(), projectedWrist: guideWrist.clone().project(camera).toArray(),
            palmFacingCamera: guidePalm.dot(camera.position.clone().sub(guideWrist).normalize()),
            armVisible: hands[0].visible, closure: view.snapshot.guideGrip.closure };
        }
        return { kind, phase, progress, fallback, contacts, readability, snapshot: view.snapshot };
      },
      side(kind, phase, progress) {
        const result = this.sample(kind, phase, progress);
        reference.visible = true; gl.render(scene, observer);
        document.querySelector('#phase').textContent += ' | external rig diagnostic (blue = head clearance)';
        return { ...result, externalRigDiagnostic: true };
      },
      world(stance, kind, phase, progress) {
        native.clear(); diagnostic.clear(); reference.visible = false; body.visible = true;
        mixer.stopAllAction();
        for (const [bone, position, rotation] of bodyRest) { bone.position.copy(position); bone.quaternion.copy(rotation); }
        if (stance !== 'standing') { const action = mixer.clipAction(postures[stance].clip); action.play(); action.paused = true; action.time = 0; mixer.update(0); }
        body.updateMatrixWorld(true);
        const eye = FIRING_POSES[stance]?.eye ?? 1.67, profile = throwableProfile(kind);
        const duration = phase === 'drawing' ? profile.draw : phase === 'throwing' ? profile.windup : profile.recovery;
        const grenade = grenadePose({ kind, phase, elapsed: progress * duration }, eye);
        bodyPose.update({ weaponPosition: postures[stance]?.carry.positions.slice(0, 3) ?? [.1, 1.3, -.25],
          weaponQuaternion: [0, 0, 0, 1], grenade });
        const worldCamera = new T.PerspectiveCamera(50, 1440 / 900, .025, 20);
        worldCamera.position.set(1.65, eye + .50, .95); worldCamera.lookAt(.02, Math.max(.22, eye - .40), -.05);
        scene.updateMatrixWorld(true); gl.render(scene, worldCamera);
        document.querySelector('#phase').textContent = `${kind} | ${stance} | ${phase} ${Math.round(progress * 100)}% | actual native body`;
        const point = name => bones.get(name).getWorldPosition(new T.Vector3());
        return { stance, kind, phase, progress, actualNativeBody: true,
          wristError: point('RightHand').distanceTo(new T.Vector3(...grenade.hand)),
          guideError: grenade.view.guiding === 1 ? point('LeftHand').distanceTo(new T.Vector3(...grenade.guideHand)) : null,
          rightElbow: point('RightForeArm').toArray(), leftElbow: point('LeftForeArm').toArray(),
          rightWrist: point('RightHand').toArray(), leftWrist: point('LeftHand').toArray(),
          head: point('Head').toArray(), terminalLaunch: grenadePose({ kind, phase: 'throwing', elapsed: profile.windup }, eye).position };
      },
      async play(kind) {
        const profile = throwableProfile(kind);
        for (const [phase, duration] of [['idle', .25], ['drawing', profile.draw], ['cooking', .8],
          ['throwing', profile.windup], ['recovering', profile.recovery]]) {
          await new Promise(resolve => {
            const start = performance.now();
            const frame = now => {
              const progress = Math.min(1, (now - start) / (duration * 1000));
              this.sample(kind, phase, progress);
              if (progress === 1) resolve(); else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        }
      },
    };
  });
  const stages = [['idle', 0], ['drawing', .3], ['drawing', .6], ['drawing', 1], ['cooking', 0], ['cooking', 1],
    ['throwing', 0], ['throwing', .35], ['throwing', .9], ['throwing', .98],
    ['throwing', 1], ['recovering', 0], ['recovering', .18], ['recovering', .5], ['recovering', .95]];
  for (const kind of ['grenade', 'explosive-pack']) {
    await page.evaluate(kind => window.fixture.play(kind), kind);
    for (const [phase, progress] of stages) {
      const result = await page.evaluate(({ kind, phase, progress }) => window.fixture.sample(kind, phase, progress), { kind, phase, progress });
      observations.push(result);
      assert.equal(result.snapshot.handSource, 'nra-authorized-skinned-hand');
      assert.equal(result.snapshot.armSource, 'nra-authorized-skinned-sleeve');
      assert.ok(result.snapshot.arms.every(arm => arm.reachable && arm.error < .00001), JSON.stringify(result));
      assert.equal(result.readability.armVisible, true, 'trajectory is not faked by hiding the native arm');
      if (['idle', 'recovering'].includes(phase)) assert.ok(result.readability.palmFacingCamera < .1, JSON.stringify(result));
      if (phase === 'cooking') {
        assert.ok(result.readability.wrist[2] > .1, 'right hand is already cocked during cooking');
        const guide = result.readability.guide, [x, y] = guide.projectedWrist;
        assert.ok(guide.armVisible && x > -1 && x < 0 && y > -1 && y < 0, 'left guide remains in lower-left view while waiting');
        assert.ok(guide.palmFacingCamera < .1 && guide.closure === .60);
      }
      if (phase === 'recovering') {
        assert.ok(result.readability.closure >= .4 && result.readability.closure <= .6);
        const [x, y] = result.readability.projectedWrist;
        assert.ok(Math.abs(x) > .72 || Math.abs(y) > 1, 'recovery does not occupy central view');
        if (progress >= .48) assert.ok(result.readability.tips.every(([x, y]) => Math.abs(x) > 1 || Math.abs(y) > 1));
      }
      for (const error of Object.values(result.contacts)) assert.ok(error < .003, `actual preparation contact ${error}`);
      await page.screenshot({ path: join(output, `${kind}-${phase}-${progress}.png`) });
    }
    const fallback = await page.evaluate(kind => window.fixture.sample(kind, 'cooking', 0, true), kind);
    observations.push(fallback);
    assert.equal(fallback.snapshot.armSource, 'continuous-diagnostic-sleeve');
    await page.screenshot({ path: join(output, `${kind}-diagnostic.png`) });
    for (const [phase, progress] of [['cooking', 0], ['throwing', 1], ['recovering', .5]]) {
      observations.push(await page.evaluate(({ kind, phase, progress }) => window.fixture.side(kind, phase, progress), { kind, phase, progress }));
      await page.screenshot({ path: join(output, `${kind}-side-${phase}-${progress}.png`) });
    }
    for (const stance of ['crouched', 'prone']) for (const [phase, progress] of [['cooking', 0], ['throwing', 1]]) {
      const result = await page.evaluate(({ stance, kind, phase, progress }) => window.fixture.world(stance, kind, phase, progress), { stance, kind, phase, progress });
      assert.ok(result.wristError < 1e-5 && (result.guideError === null || result.guideError < 1e-5));
      assert.ok(result.rightElbow[1] > .025 && result.rightWrist[1] >= .09);
      observations.push(result);
      await page.screenshot({ path: join(output, `${kind}-${stance}-${phase}-${progress}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'observations.json'), JSON.stringify({ errors, observations }, null, 2));
  console.log(`PASS: ${observations.length} isolated native/diagnostic stages; both actual preparation contacts; ${output}`);
} finally {
  const video = page.video();
  await page.close();
  if (video) {
    await video.saveAs(join(output, 'throwable-native-motion.webm'));
    await unlink(await video.path());
  }
  await browser.close();
}
