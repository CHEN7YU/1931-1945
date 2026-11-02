import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.route(new URL('/__bayonet-pose', base).href, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#202520"></body>',
  }));
  await page.goto(new URL('/__bayonet-pose', base).href);
  const poses = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createBayonetState } = await import('/src/bayonet.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    await configureRifleMaterials(1);
    const view = await loadIjaCharacter(), scene = new T.Scene();
    scene.add(view.root, new T.HemisphereLight(0xffffff, 0x444444, 2));
    const camera = new T.PerspectiveCamera(50, 1100 / 800, .05, 30);
    camera.position.set(2.2, 1.7, -2.5); camera.lookAt(0, 1, 0);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x202520); renderer.setSize(1100, 800); document.body.append(renderer.domElement);
    const actor = { id: 'bayonet-pose', unitId: 'pose-unit', team: 'enemy', groundType: 'infantry',
      health: 100, heading: .4, walkPhase: 0, position: new T.Vector3(), stance: 'standing',
      locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), bayonet: createBayonetState() };
    actor.nativeMotion = createNraMotion(view.motionProfile, actor); view.bind(actor.id);
    const results = [];
    for (const speed of [0, 1.75, 3.15, 4.8]) for (let phase = 0; phase < 6; phase++) {
      for (const extension of [0, .25, .5, .75, 1]) {
        Object.assign(actor.nativeMotion, { speed, weight: speed ? 1 : 0, distance: phase / 6 * 2.55,
          gaitCharge: speed === 4.8 ? 1 : 0, gaitAim: 0, aim: 0,
          bodyLean: speed === 4.8 ? .34 : speed ? .21 : 0 });
        Object.assign(actor.bayonet, { mode: speed ? 'charge' : 'thrust', extension });
        view.update(actor, 0, null);
        const snapshot = view.snapshot;
        results.push({ speed, phase, extension, issue: snapshot.issue, head: snapshot.head,
          rifle: snapshot.riflePose, carry: sampleNraMotion(actor).weaponPosition,
          muzzleError: Math.hypot(...snapshot.riflePose.muzzle.map((value, index) =>
            value - [snapshot.logicalMuzzle.x, snapshot.logicalMuzzle.y, snapshot.logicalMuzzle.z][index])) });
      }
    }
    window.renderBayonetPose = extension => {
      actor.weaponBlocked = false;
      Object.assign(actor.nativeMotion, { speed: 0, weight: 0, bodyLean: 0, distance: 0, gaitCharge: 0 });
      Object.assign(actor.bayonet, { mode: 'thrust', extension });
      view.update(actor, 0, null); renderer.render(scene, camera);
      return view.snapshot;
    };
    window.renderWallCarry = () => {
      actor.weaponBlocked = true; actor.heading = 0;
      Object.assign(actor.nativeMotion, { speed: 0, weight: 0, bodyLean: 0, distance: 0, gaitCharge: 0 });
      Object.assign(actor.bayonet, { mode: 'idle', extension: 0 });
      view.update(actor, 0, null);
      let penetrating = 0;
      view.root.traverse(mesh => {
        if (!mesh.isMesh) return;
        let weapon = false;
        for (let node = mesh; node; node = node.parent) if (node.userData.personalWeapon) weapon = true;
        if (!weapon) return;
        const points = mesh.geometry.attributes.position;
        for (let index = 0; index < points.count; index++) {
          const point = new T.Vector3().fromBufferAttribute(points, index).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(point.x) <= 1 && point.y >= 0 && point.y <= 3.2 &&
            point.z >= -.9 && point.z <= -.6) penetrating++;
        }
      });
      const wall = new T.Mesh(new T.BoxGeometry(2, 3.2, .3), new T.MeshStandardMaterial({ color: 0x777866 }));
      wall.position.set(0, 1.6, -.75); scene.add(wall); renderer.render(scene, camera);
      return { issue: view.snapshot.issue, penetrating, pose: view.snapshot.riflePose };
    };
    window.checkCorpseWall = async () => {
      const { createIjaForceRenderer } = await import('/src/ija-character.js');
      const { createCasualtyState, placeCasualty } = await import('/src/casualties.js');
      const { circleBlocked } = await import('/src/core.js');
      const factory = createIjaForceRenderer(new T.Scene(), camera, await loadIjaCharacter());
      const wall = { minX: -2, maxX: 2, minZ: -.9, maxZ: -.6, height: 3.2 };
      const results = [];
      actor.weaponBlocked = false; actor.health = 0;
      for (const variant of [0, 1, 2, 3]) {
        const original = createCasualtyState(actor, 0, sampleNraMotion(actor), { variant, retainGun: true });
        actor.casualty = placeCasualty(actor, original, (v, retained) => factory.casualtyBounds(v, retained),
          (point, radius, height) => circleBlocked(point.x, point.z, radius, [wall], point.y, height));
        view.update(actor, 2, null);
        let penetrating = 0;
        view.root.traverse(mesh => {
          if (!mesh.isMesh) return;
          let weapon = false;
          for (let node = mesh; node; node = node.parent) if (node.userData.personalWeapon) weapon = true;
          if (!weapon) return;
          const points = mesh.geometry.attributes.position;
          for (let index = 0; index < points.count; index++) {
            const point = new T.Vector3().fromBufferAttribute(points, index).applyMatrix4(mesh.matrixWorld);
            if (Math.abs(point.x) <= 2 && point.y >= 0 && point.y <= 3.2 &&
              point.z >= -.9 && point.z <= -.6) penetrating++;
          }
        });
        results.push({ variant, chosen: actor.casualty.variant, penetrating });
      }
      actor.health = 100; delete actor.casualty;
      return results;
    };
    return results;
  });
  for (const pose of poses) {
    assert.equal(pose.issue, null, JSON.stringify(pose));
    assert.ok(pose.muzzleError < 1e-4, 'the visible thrust and logical weapon geometry must agree');
    assert.ok(pose.carry[1] <= 1.2 + 1e-8, 'the receiver stays below shoulder-level rifle carry');
    assert.ok(pose.rifle.muzzle[1] < pose.head[1], 'the gun cannot be raised over the head');
  }
  const stationary = poses.filter(pose => pose.speed === 0 && pose.phase === 0);
  const gripSpacing = pose => Math.hypot(...pose.rifle.leftPalmTarget.map((value, axis) =>
    value - pose.rifle.rightPalmTarget[axis]));
  const spacing = gripSpacing(stationary[0]);
  const close = await page.evaluate(() => window.renderWallCarry());
  assert.equal(close.issue, null, JSON.stringify(close));
  assert.equal(close.penetrating, 0, 'the actual skinned weapon geometry must stay on the soldier side of the wall');
  const corpses = await page.evaluate(() => window.checkCorpseWall());
  assert.ok(corpses.every(corpse => corpse.penetrating === 0), JSON.stringify(corpses));
  for (const pose of stationary) assert.ok(Math.abs(gripSpacing(pose) - spacing) < 1e-8,
    'both hands stay at fixed grip locations instead of sliding up the rifle during the thrust');
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    for (const extension of [0, .5, 1]) {
      await page.evaluate(extension => window.renderBayonetPose(extension), extension);
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `thrust-${extension}.png`) });
    }
    await writeFile(join(process.env.ARTIFACT_DIR, 'poses.json'), JSON.stringify(poses, null, 2));
  }
  console.log(JSON.stringify({ passed: true, checkedPoses: poses.length }));
} finally {
  await browser.close();
}
