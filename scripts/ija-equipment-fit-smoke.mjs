import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.GAME_URL || 'http://127.0.0.1:5187';
const out = process.env.ARTIFACT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__ija-equipment-fit', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body style="margin:0"></body></html>' }));
  await page.goto(new URL('/__ija-equipment-fit', origin).href);
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion, sampleNraMotion } = await import('/src/nra-motion.js');
    const { createUniformStudy, disposeUniformStudy } = await import('/uniform-study/model.js');
    const { loadStudyAppearance } = await import('/uniform-study/skin.js');
    const { configureRifleMaterials } = await import('/src/rifle-model.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    await configureRifleMaterials();
    const [template, appearance] = await Promise.all([loadIjaCharacter(), loadStudyAppearance()]);
    const study = createUniformStudy({ upperBody: appearance.upperBody });
    study.root.updateMatrixWorld(true);
    const key = point => point.toArray().map(value => Math.round(value * 10000)).join(',');
    const garment = study.root.getObjectByName('standing-collar-tunic').geometry, panelKeys = new Set(), sleeveKeys = new Set(), tunicKeys = new Set();
    for (let index = 0; index < garment.attributes.position.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(garment.attributes.position, index);
      tunicKeys.add(key(point));
      if (index < garment.userData.bodyTriangleCount * 3) panelKeys.add(key(point));
      else if (index < (garment.userData.bodyTriangleCount + garment.userData.sleeveTriangleCount) * 3) sleeveKeys.add(key(point));
    }
    const cases = [
      { name: 'standing-fire', ready: true, speed: 0, mode: 'walk', stance: 'standing' },
      { name: 'standing-low', ready: false, speed: 0, mode: 'walk', stance: 'standing' },
      { name: 'kneeling-fire', ready: true, speed: 0, mode: 'walk', stance: 'crouched', pose: 'kneeling' },
      { name: 'walking-low', ready: false, speed: 1.75, mode: 'walk', stance: 'standing' },
      { name: 'running-low', ready: false, speed: 3.15, mode: 'sprint', stance: 'standing' },
    ];
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#a8aba5');
    scene.add(new THREE.HemisphereLight(0xf7f4e9, 0x49463c, 2));
    const light = new THREE.DirectionalLight(0xfff7e6, 3);
    light.position.set(-4, 7, -5); scene.add(light);
    const camera = new THREE.PerspectiveCamera(32, 4 / 3, .05, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 900); renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.append(renderer.domElement);
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;top:16px;left:20px;font:16px sans-serif;color:#20251e';
    document.body.append(label);
    const measurements = [], images = [];

    function clothStrain(mesh) {
      const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index;
      const rest = [], posed = [], worst = [];
      for (let index = 0; index < positions.count; index++) {
        rest.push(new THREE.Vector3().fromBufferAttribute(positions, index));
        posed.push(mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3())));
      }
      const description = index => ({ point: rest[index].toArray(),
        influences: [0, 1, 2, 3].map(slot => ({
          bone: mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(index, slot)].name,
          weight: mesh.geometry.attributes.skinWeight.getComponent(index, slot),
        })).filter(item => item.weight > 0) });
      for (let at = 0; at < indices.count; at += 3) for (let edge = 0; edge < 3; edge++) {
        const a = indices.getX(at + edge), b = indices.getX(at + (edge + 1) % 3);
        if (!tunicKeys.has(key(rest[a])) || !tunicKeys.has(key(rest[b]))) continue;
        const restLength = rest[a].distanceTo(rest[b]), growth = posed[a].distanceTo(posed[b]) - restLength;
        if (growth < .04) continue;
        worst.push({ growth, restLength, a, b });
      }
      return { maxGrowth: Math.max(0, ...worst.map(item => item.growth)),
        spikes: worst.filter(item => item.restLength < .012).sort((a, b) => b.growth - a.growth).slice(0, 3)
          .map(item => ({ growth: item.growth, restLength: item.restLength, a: description(item.a), b: description(item.b) })) };
    }

    function clothSurface(mesh) {
      const positions = mesh.geometry.attributes.position, indices = mesh.geometry.index, vertices = [];
      for (let index = 0; index < positions.count; index++) vertices.push(mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3())));
      const triangles = [], cells = new Map(), cellSize = .04;
      const extent = new THREE.Box3();
      for (let at = 0; at < indices.count; at += 3) {
        const triangle = new THREE.Triangle(...[0, 1, 2].map(corner => vertices[indices.getX(at + corner)]));
        if (triangle.getArea() < 1e-10) continue;
        const id = triangles.length;
        triangles.push(triangle);
        extent.setFromPoints([triangle.a, triangle.b, triangle.c]);
        const low = extent.min.toArray().map(value => Math.floor(value / cellSize));
        const high = extent.max.toArray().map(value => Math.floor(value / cellSize));
        for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) for (let z = low[2]; z <= high[2]; z++) {
          const bucket = `${x},${y},${z}`;
          if (!cells.has(bucket)) cells.set(bucket, []);
          cells.get(bucket).push(id);
        }
      }
      return point => {
        const center = point.toArray().map(value => Math.floor(value / cellSize)), candidates = new Set();
        for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
          for (const id of cells.get(`${center[0] + x},${center[1] + y},${center[2] + z}`) ?? []) candidates.add(id);
        }
        let distance = Infinity, signed = Infinity;
        const closest = new THREE.Vector3(), normal = new THREE.Vector3();
        for (const id of candidates) {
          const triangle = triangles[id];
          triangle.closestPointToPoint(point, closest);
          const next = point.distanceTo(closest);
          if (next >= distance) continue;
          distance = next;
          signed = point.clone().sub(closest).dot(triangle.getNormal(normal));
        }
        return { distance, signed };
      };
    }

    for (const level of ['near', 'far']) {
      const view = level === 'near' ? template.createView() : template.createFarView(), meshes = [], lookup = new Map();
      view.root.getObjectByName(level).traverse(mesh => {
        if (!mesh.isSkinnedMesh) return;
        meshes.push(mesh);
        for (let index = 0; index < mesh.geometry.attributes.position.count; index++) {
          const point = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index), id = key(point);
          if (!lookup.has(id)) lookup.set(id, []);
          lookup.get(id).push({ mesh, index, point });
        }
      });
      const samples = [], missing = [];
      study.groups.equipment.traverse(node => {
        if (!node.isMesh || node.geometry.type === 'TubeGeometry' ||
          level === 'far' && /button|branch-position|fastener|buckle-opening/.test(node.name)) return;
        const strap = /shoulder-strap|sling/.test(node.name), positions = node.geometry.attributes.position;
        const step = strap ? 8 : Math.max(1, Math.floor(positions.count / 20));
        for (let index = 0; index < positions.count; index += step) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld);
          if (strap && (point.y < 1.15 || point.y > 1.44)) continue;
          const center = point.toArray().map(value => Math.round(value * 10000));
          let entry;
          for (let x = -1; x <= 1 && !entry; x++) for (let y = -1; y <= 1 && !entry; y++) for (let z = -1; z <= 1 && !entry; z++) {
            entry = lookup.get(`${center[0] + x},${center[1] + y},${center[2] + z}`)?.find(item =>
              item.mesh.material.color.getHex() === node.material.color.getHex() && item.point.distanceTo(point) < .00002);
          }
          if (!entry) { missing.push(node.name); continue; }
          samples.push({ ...entry, name: node.name, strap });
        }
      });
      if (missing.length) throw new Error(`Missing production equipment vertices: ${[...new Set(missing)]}`);
      const cloth = meshes.find(mesh => mesh.material.sheen > 0), bones = meshes[0].skeleton.bones;
      const hips = bones.findIndex(bone => bone.name === 'Hips');
      if (!cloth || hips < 0) throw new Error('Production cloth or pelvis bone is missing');
      const clothOwnership = { panelVertices: 0, cuffVertices: 0, wrongPanelWeight: 0, wrongCuffWeight: 0 };
      for (let index = 0; index < cloth.geometry.attributes.position.count; index++) {
        const point = new THREE.Vector3().fromBufferAttribute(cloth.geometry.attributes.position, index), id = key(point);
        const panel = panelKeys.has(id), cuff = !panel && sleeveKeys.has(id) && point.y < 1.10;
        if (!panel && !cuff) continue;
        clothOwnership[panel ? 'panelVertices' : 'cuffVertices']++;
        const side = point.x > 0 ? 'Left' : 'Right';
        for (let slot = 0; slot < 4; slot++) {
          const bone = bones[cloth.geometry.attributes.skinIndex.getComponent(index, slot)].name;
          const allowed = panel ? ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'].includes(bone) :
            ['Shoulder', 'Arm', 'ForeArm', 'Hand'].some(part => bone === `${side}${part}`);
          if (!allowed) {
            const field = panel ? 'wrongPanelWeight' : 'wrongCuffWeight';
            clothOwnership[field] = Math.max(clothOwnership[field], cloth.geometry.attributes.skinWeight.getComponent(index, slot));
          }
        }
      }
      const ownership = samples.filter(sample => !sample.strap).map(sample => {
        const indices = sample.mesh.geometry.attributes.skinIndex, weights = sample.mesh.geometry.attributes.skinWeight;
        let pelvisWeight = 0;
        for (let slot = 0; slot < 4; slot++) if (indices.getComponent(sample.index, slot) === hips) pelvisWeight += weights.getComponent(sample.index, slot);
        return { name: sample.name, pelvisWeight };
      });
      scene.add(view.root);
      for (const state of cases) for (const phase of [0, .35, .7]) {
        const actor = { id: `${level}-${state.name}`, team: 'enemy', unitId: 'equipment-fit', heading: 0,
          position: new THREE.Vector3(), walkPhase: 0, health: 100, vehicleId: null, deathTime: 0,
          stance: state.stance, firingPose: state.pose ?? null, rifleReady: state.ready,
          locomotion: { speed: state.speed, mode: state.mode }, rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(view.motionProfile, actor);
        for (let tick = 0; tick < 120; tick++) {
          actor.position.z -= state.speed / 60;
          advanceNraMotion(actor, 1 / 60);
        }
        actor.nativeMotion.distance += phase * (state.speed < 2.1 ? view.motionProfile.walkStrideMeters : view.motionProfile.strideMeters);
        actor.position.set(0, 0, 0); actor.nativeMotion.position = { x: 0, z: 0 };
        view.bind(actor.id); view.update(actor, 2 + phase, null); view.root.updateMatrixWorld(true);
        for (const mesh of meshes) mesh.skeleton.update();
        const surface = clothSurface(cloth), strapDistances = [];
        for (const sample of samples.filter(item => item.strap)) {
          const point = sample.mesh.localToWorld(sample.mesh.getVertexPosition(sample.index, new THREE.Vector3()));
          strapDistances.push({ name: sample.name, ...surface(point) });
        }
        let rigidError = 0;
        for (const sample of samples.filter(item => !item.strap)) {
          const expected = sample.point.clone().applyMatrix4(sample.mesh.bindMatrix)
            .applyMatrix4(sample.mesh.skeleton.boneInverses[hips]).applyMatrix4(bones[hips].matrixWorld)
            .applyMatrix4(sample.mesh.bindMatrixInverse).applyMatrix4(sample.mesh.matrixWorld);
          const actual = sample.mesh.localToWorld(sample.mesh.getVertexPosition(sample.index, new THREE.Vector3()));
          rigidError = Math.max(rigidError, expected.distanceTo(actual));
        }
        const motion = sampleNraMotion(actor);
        measurements.push({ level, state: state.name, phase, torsoYaw: motion.torsoYaw, lowReady: motion.lowReady,
          issue: view.issue, ownership, clothOwnership, rigidError, strapDistances, clothStrain: clothStrain(cloth) });
        if (phase === 0 && ['standing-fire', 'standing-low'].includes(state.name)) {
          view.root.traverse(node => { if (node.isMesh && !node.isSkinnedMesh) node.visible = false; });
          for (const [direction, z] of [['front', -2.35], ['back', 2.35]]) {
            camera.position.set(.9, 1.25, z); camera.lookAt(0, 1.12, 0);
            label.textContent = `${level} / ${state.name} / ${direction} / equipment inspection, weapon hidden`;
            renderer.render(scene, camera);
            images.push({ name: `${level}-${state.name}-${direction}`, data: renderer.domElement.toDataURL('image/png') });
          }
        }
      }
      scene.remove(view.root);
    }
    disposeUniformStudy(study.root); disposeUniformStudy(appearance.skin);
    return { measurements, images };
  });
  assert.deepEqual(errors, []);
  if (out) {
    await writeFile(join(out, 'ija-equipment-fit.json'), JSON.stringify(result.measurements, null, 2));
    for (const image of result.images) await writeFile(join(out, `ija-equipment-${image.name}.png`), Buffer.from(image.data.split(',')[1], 'base64'));
  }
  for (const sample of result.measurements) {
    const context = `${sample.level} ${sample.state} phase ${sample.phase}`;
    assert.equal(sample.issue, null, `${context}: real shared rifle pose must remain reachable`);
    assert.ok(sample.ownership.length > 100 && sample.ownership.every(item => Math.abs(item.pelvisWeight - 1) < 1e-6),
      `${context}: waist equipment must belong to the pelvis, not the upper chest`);
    assert.ok(sample.clothOwnership.panelVertices > 100 && sample.clothOwnership.cuffVertices > 20);
    assert.equal(sample.clothOwnership.wrongPanelWeight, 0, `${context}: torso panels cannot inherit nearby arm/hand bones`);
    assert.equal(sample.clothOwnership.wrongCuffWeight, 0, `${context}: sleeves cannot inherit nearby leg/pelvis/finger bones`);
    assert.ok(sample.rigidError < 1e-6, `${context}: belt, pouches and bag must follow the actual pelvis rigidly`);
    assert.ok(sample.strapDistances.length > 20);
    assert.deepEqual(sample.clothStrain.spikes, [], `${context}: short tunic/sleeve edges must not stretch into hanging sheets`);
    for (const strap of sample.strapDistances) {
      assert.ok(Number.isFinite(strap.distance) && Number.isFinite(strap.signed), `${context}: ${strap.name} has no nearby cloth`);
      assert.ok(strap.distance < (sample.level === 'near' ? .02 : .025),
        `${context}: ${strap.name} floats ${strap.distance.toFixed(4)}m from the cloth`);
      assert.ok(strap.signed > -.006, `${context}: ${strap.name} cuts ${strap.signed.toFixed(4)}m into the cloth`);
    }
  }
  for (const level of ['near', 'far']) {
    const firing = result.measurements.find(item => item.level === level && item.state === 'standing-fire');
    const low = result.measurements.find(item => item.level === level && item.state === 'standing-low');
    assert.ok(Math.abs(firing.torsoYaw * 180 / Math.PI) > 31 && Math.abs(firing.torsoYaw * 180 / Math.PI) < 32 && firing.lowReady === 0);
    assert.ok(low.torsoYaw === 0 && low.lowReady === 1);
  }
  console.log('PASS: actual shared 31-degree firing turn and low-carry/walk/run/kneeling poses; pelvis equipment ownership, strap surface contact and both production LODs.');
} finally {
  await browser.close();
}
