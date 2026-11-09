import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__posture-bayonet', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto(new URL('/__posture-bayonet', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraForceRendererAsync } = await import('/src/nra-force-renderer.js');
    const { createNraMotion, advanceNraMotion, nativeEyeLocal } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const { createBayonetState, advanceBayonet } = await import('/src/bayonet.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    await loadDadaoSurfaces(1);
    const results = [], point = new T.Vector3(), matrix = new T.Matrix4();
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      let floor = 0, slope = 0;
      const recoveries = [];
      const groundAt = (x, _z) => floor + slope * x;
      const template = await load(groundAt, { onPoseRecovery: error => recoveries.push(error.message) });
      const view = template.createView(), shoeVertices = [];
      view.root.traverse(mesh => {
        if (!mesh.isSkinnedMesh || !mesh.geometry.attributes.skinIndex) return;
        const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
        const indices = [];
        for (let vertex = 0; vertex < position.count; vertex++) {
          let weight = 0;
          for (let slot = 0; slot < 4; slot++)
            if (/(?:Left|Right)(?:Foot|ToeBase)$/.test(mesh.skeleton.bones[skinIndex.getComponent(vertex, slot)].name))
              weight += skinWeight.getComponent(vertex, slot);
          if (weight > .5) indices.push(vertex);
        }
        if (indices.length) shoeVertices.push({ mesh, indices });
      });
      if (!shoeVertices.length) throw new Error(`${team}: missing real shoe vertices`);
      const actor = { id: `${team}-posture`, team, index: 1, groundType: 'infantry', health: 100,
        formation: { type: 'infantry', memberCount: 11 }, unitId: 'posture-review',
        position: new T.Vector3(), heading: 0, walkPhase: 0, stance: 'standing', tactics: {},
        locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState(), bayonet: createBayonetState() };
      const reset = () => {
        actor.stance = 'standing'; actor.firingPose = null; actor.bayonet = createBayonetState();
        actor.nativeMotion = createNraMotion(template.motionProfile, actor); view.bind(actor.id);
      };
      const observe = time => {
        view.update(actor, time, null);
        const snapshot = view.snapshot;
        let sole = Infinity;
        for (const { mesh, indices } of shoeVertices) for (const vertex of indices) {
          point.fromBufferAttribute(mesh.geometry.attributes.position, vertex);
          mesh.applyBoneTransform(vertex, point).applyMatrix4(mesh.matrixWorld);
          sole = Math.min(sole, point.y - groundAt(point.x, point.z));
        }
        const logical = snapshot.logicalMuzzle, muzzle = snapshot.riflePose.muzzle;
        const eye = new T.Vector3().fromArray(nativeEyeLocal(actor)).applyAxisAngle(new T.Vector3(0, 1, 0), actor.heading).add(actor.position);
        return { sole, issue: view.issue, palm: Math.max(snapshot.riflePose.left.palmError, snapshot.riflePose.right.palmError),
          muzzleError: Math.hypot(muzzle[0] - logical.x, muzzle[1] - logical.y, muzzle[2] - logical.z),
          eyeError: eye.distanceTo(new T.Vector3().fromArray(snapshot.headAim.actualEye)),
          hips: snapshot.hips, chest: view.anatomy.Spine2.toArray(), leftFoot: snapshot.leftFoot,
          rightKnee: snapshot.rightKnee, recovered: Boolean(snapshot.gait.legPose?.recovered) };
      };
      for (const fps of [30, 60, 144]) for (const name of ['crouched', 'kneeling'])
        for (const terrain of ['flat', 'raised-slope']) {
          floor = terrain === 'flat' ? 0 : .36; slope = terrain === 'flat' ? 0 : .05;
          actor.position.set(0, floor, 0); actor.heading = terrain === 'flat' ? 0 : 1.3;
          reset();
          const samples = [], planted = [];
          for (const direction of ['lower', 'rise', 'reverse']) {
            actor.stance = direction === 'rise' ? 'standing' : 'crouched';
            actor.firingPose = direction === 'rise' ? null : name;
            for (let frame = 0; frame < Math.ceil(fps * 1.1); frame++) {
              if (direction === 'reverse' && frame === Math.floor(fps * .25)) {
                actor.stance = 'standing'; actor.firingPose = null;
              }
              advanceNraMotion(actor, 1 / fps);
              const sample = observe(frame / fps); samples.push(sample);
              const weight = actor.nativeMotion.posture[name];
              if (direction === 'rise' && weight >= .3) planted.push(sample.leftFoot);
            }
          }
          const maxPlantSlip = Math.max(0, ...planted.map(foot => Math.hypot(foot[0] - planted[0][0], foot[2] - planted[0][2])));
          results.push({ team, kind: 'posture', fps, name, terrain, minSole: Math.min(...samples.map(s => s.sole)),
            maxPlantSlip, maxEyeError: Math.max(...samples.map(s => s.eyeError)),
            maxPalm: Math.max(...samples.map(s => s.palm)), issues: samples.filter(s => s.issue || s.recovered).length });
        }
      floor = slope = 0; actor.position.set(0, 0, 0); actor.heading = 0;
      if (team === 'enemy') {
        reset();
        const target = { id: 'target', team: 'friendly', targetKind: 'person', health: 100, position: new T.Vector3(0, 0, -1.3) };
        const samples = [];
        let hits = 0;
        for (let frame = 0; frame <= 66; frame++) {
          if (advanceBayonet(actor, target, { now: frame / 150, visible: true, facing: true, settled: true }).hit) hits++;
          samples.push(observe(frame / 150));
        }
        const range = key => Math.max(...samples.map(s => s[key][1])) - Math.min(...samples.map(s => s[key][1]));
        results.push({ team, kind: 'thrust', hits, hipsRange: range('hips'), chestRange: range('chest'),
          maxPalm: Math.max(...samples.map(s => s.palm)), maxEyeError: Math.max(...samples.map(s => s.eyeError)),
          maxMuzzleError: Math.max(...samples.map(s => s.muzzleError)), issues: samples.filter(s => s.issue).length });
      }
      for (const lowMemory of [false, true]) {
        const camera = new T.PerspectiveCamera(72, 1, .07, 650); camera.position.set(0, 1.67, 0);
        const force = await createNraForceRendererAsync(new T.Scene(), camera, template, 2, { team, lowMemory });
        actor.position.set(0, 0, -40); reset();
        const sample = (value, kind) => {
          actor.nativeMotion.posture.crouched = kind === 'posture' ? value : 0;
          actor.bayonet.mode = kind === 'thrust' ? 'thrust' : 'idle'; actor.bayonet.extension = value;
          const before = JSON.stringify(actor);
          force.update([actor], value, null, 'high', { detailLimit: 0 });
          if (JSON.stringify(actor) !== before) throw new Error('Distant action sampling mutated simulation state');
          const mesh = force.root.children.find(child => child.geometry?.attributes.nraSkinTint && child.count > 0);
          const weights = mesh.morphTexture?.image.data.slice(1, 1 + mesh.geometry.morphAttributes.position.length) ?? [];
          const positions = [];
          let minY = Infinity;
          mesh.getMatrixAt(0, matrix);
          for (let vertex = 0; vertex < mesh.geometry.attributes.position.count; vertex++) {
            point.fromBufferAttribute(mesh.geometry.attributes.position, vertex).multiplyScalar(1 - weights.reduce((sum, w) => sum + w, 0));
            for (let frame = 0; frame < weights.length; frame++) if (weights[frame])
              point.addScaledVector(new T.Vector3().fromBufferAttribute(mesh.geometry.morphAttributes.position[frame], vertex), weights[frame]);
            point.applyMatrix4(matrix); positions.push(...point.toArray()); minY = Math.min(minY, point.y);
          }
          const weapon = force.root.children.find(child => child.name === 'owned-weapon-rifle' && child.count);
          const transform = new T.Matrix4(); weapon.getMatrixAt(0, transform);
          return { mesh, positions, weapon: transform.elements.slice(), minY };
        };
        for (const kind of team === 'enemy' ? ['posture', 'thrust'] : ['posture']) {
          let minimum = Infinity, maxJump = 0, maxWeaponJump = 0, sameMesh = true, previous;
          for (let frame = 0; frame <= 100; frame++) {
            const current = sample(frame / 100, kind); minimum = Math.min(minimum, current.minY);
            if (previous && frame > 1) {
              sameMesh &&= current.mesh === previous.mesh;
              for (let i = 0; i < current.positions.length; i += 3)
                maxJump = Math.max(maxJump, Math.hypot(...current.positions.slice(i, i + 3).map((v, axis) => v - previous.positions[i + axis])));
              maxWeaponJump = Math.max(maxWeaponJump, Math.hypot(...[12, 13, 14].map(i => current.weapon[i] - previous.weapon[i])));
            }
            previous = current;
          }
          results.push({ team, kind: `far-${kind}`, lowMemory, minY: minimum, maxJump, maxWeaponJump, sameMesh,
            banks: force.snapshot.poseBanks });
        }
        for (const mesh of force.root.children) if (mesh.isInstancedMesh) { mesh.geometry.dispose(); mesh.dispose(); }
      }
      if (recoveries.length) throw new Error(JSON.stringify(recoveries));
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.issues ?? 0, 0, JSON.stringify(result));
    if (result.kind === 'posture') {
      assert.ok(result.minSole > -.015 && result.maxPlantSlip < .001, JSON.stringify(result));
      assert.ok(result.maxEyeError < .001 && result.maxPalm < .005, JSON.stringify(result));
    } else if (result.kind === 'thrust') {
      assert.equal(result.hits, 1);
      assert.ok(result.hipsRange > .01 && result.chestRange > .015, JSON.stringify(result));
      assert.ok(result.maxPalm < .005 && result.maxMuzzleError < .0001 && result.maxEyeError < .001, JSON.stringify(result));
    } else {
      assert.ok(result.sameMesh && result.maxJump < .05 && result.maxWeaponJump < .03, JSON.stringify(result));
      assert.ok(result.minY > -.025, JSON.stringify(result));
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results, errors }));
} finally { await browser.close(); }
