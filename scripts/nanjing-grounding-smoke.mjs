import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `
      import * as THREE from '/node_modules/three/build/three.module.js';
      import { loadNraCharacter } from '/src/nra-character.js';
      import { createNraMotion, syncNativeAimGoal } from '/src/nra-motion.js';
      import { createRifleState } from '/src/rifle-action.js';
      import { makeNanjingBattlefield } from '/src/nanjing-battlefield.js';
      import { NANJING_WALL_RAMPS } from '/src/nanjing-layout.js';
      import { walkHeight as defaultHeight } from '/src/ground.js';
      const world = makeNanjingBattlefield(new THREE.Scene(), () => new THREE.MeshStandardMaterial());
      const probes = [];
      const template = await loadNraCharacter((x, z, y) => {
        const height = world.walkHeight(x, z, y);
        probes.push({ x, z, y, height });
        return height;
      });
      const actor = { id: 'grounding', team: 'friendly', unitId: 'grounding-unit', heading: 0,
        position: new THREE.Vector3(), walkPhase: 0, health: 100, deathTime: 0, vehicleId: null,
        groundType: 'infantry', locomotion: { speed: 1.75 }, rifle: createRifleState() };
      actor.nativeMotion = createNraMotion(template.motionProfile, actor);
      Object.assign(actor.nativeMotion, { weight: 1, speed: 1.75, gaitCharge: 0, gaitAim: 0,
        aim: 0, bodyLean: 0, cheekWeight: 0 });
      const samples = [];
      const ramp = NANJING_WALL_RAMPS[0];
      const rampX = (ramp.minX + ramp.maxX) / 2, rampZ = (ramp.minZ + ramp.maxZ) / 2;
      for (const [x, z, referenceY] of [[8, -12, 0], [4, -10, 0], [8, -18, 0],
        [-6.2, 0, 0], [2, -.16, 0], [21.5, 0, 8.58], [rampX, rampZ, 8.58]]) {
        actor.position.set(x, world.walkHeight(x, z, referenceY), z);
        template.bind(actor.id);
        for (let frame = 0; frame < 12; frame++) {
          actor.nativeMotion.distance = frame / 12 * 1.25;
          syncNativeAimGoal(actor);
          const before = probes.length;
          template.update(actor, frame / 12, null);
          const view = template.snapshot;
          samples.push({ position: actor.position.toArray(), defaultHeight: defaultHeight(x, z, actor.position.y),
            probes: probes.slice(before), legs: view.gait.legPose, issue: view.issue });
        }
      }
      window.groundingReview = samples;
    `,
  }));
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/?campaign=nanjing`);
  await page.waitForFunction(() => window.groundingReview, null, { timeout: 90000 });
  const samples = await page.evaluate(() => window.groundingReview);
  assert.equal(samples.length, 84);
  assert.ok(samples.some(sample => Math.abs(sample.defaultHeight - sample.position[1]) > .3),
    'fixture must include positions where the other map has a raised bridge');
  for (const sample of samples) {
    assert.equal(sample.issue, null);
    assert.equal(sample.probes.length, 2, 'both feet must query the active battlefield');
    for (const [index, side] of ['left', 'right'].entries()) {
      assert.equal(sample.legs[side].floor, sample.probes[index].height);
      assert.ok(sample.legs[side].error < .01);
      if (sample.position[1] === 0) {
        assert.equal(sample.legs[side].floor, 0, 'flat Nanjing ground cannot inherit Taierzhuang bridge height');
        assert.ok(sample.legs[side].lift < .15, 'walking feet must stay close to the actual floor');
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ samples: samples.length, activeMapFootQueries: samples.length * 2, errors }));
} finally {
  await browser.close();
}
