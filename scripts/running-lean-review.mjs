import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const team = process.env.REVIEW_TEAM ?? 'friendly';
if (!['friendly', 'enemy'].includes(team)) throw new Error('Unknown review team');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [], errors = [];
try {
  for (const variant of process.env.REVIEW_VARIANT ? [process.env.REVIEW_VARIANT] : ['current', 'candidate']) {
    if (!['current', 'candidate', 'larger'].includes(variant)) throw new Error('Unknown review variant');
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', error => errors.push(`${variant}: ${error.message}`));
    if (variant !== 'current') await page.route('**/src/nra-motion.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const previous = 'Math.min(.74, .045 + (.6108652382 - .045) * smoothSpeed(motion.speed, 1.5, 2.7) +\n' +
        '    (.7330382858 - .6108652382) * smoothSpeed(motion.speed, 2.7, 4.1) + .055 * acceleration)';
      const jog = variant === 'larger' ? '.6108652382' : '.3490658504';
      const sprint = variant === 'larger' ? '.7330382858' : '.5235987756';
      const proposal = `Math.min(.74, .045 + (${jog} - .045) * smoothSpeed(motion.speed, 1.5, 2.7) + ` +
        `(${sprint} - ${jog}) * smoothSpeed(motion.speed, 2.7, 4.1) + .055 * acceleration)`;
      if (!source.includes(previous)) throw new Error('Expected running lean expression was not found');
      await route.fulfill({ response, body: source.replace(previous,
        `(window.__runningLeanCandidate ? ${proposal} : ${previous})`) });
    });
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.runningLeanReview = {
          setup(speed) {
            setGameState('pause'); missionBriefing.hide(); keys.clear();
            window.__runningLeanCandidate = ${JSON.stringify(variant !== 'current')};
            const actor = allForces.find(item => item.team === ${JSON.stringify(team)} && item.id !== entities.control.soldierId &&
              item.health > 0 && item.nativeMotion && !item.vehicleId &&
              !item.engineer && item.rifle && !item.discharger);
            if (!actor) throw new Error('Missing native rifleman');
            this.actor = actor;
            this.force = ${JSON.stringify(team)} === 'friendly' ? nraCharacter : ijaCharacter;
            actor.position.set(45, world.groundHeight(45, 50), 50);
            actor.heading = 0; actor.stance = 'standing'; actor.firingPose = null; actor.rifleReady = false;
            actor.aimWalking = false; stopLocomotion(actor.locomotion);
            actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
            actor.locomotion.speed = speed; actor.locomotion.mode = speed > 3 ? 'sprint' : 'jog';
            this.speed = speed; this.clock = 0;
            for (let i = 0; i < 80; i++) this.advance(.05);
          },
          advance(dt) {
            const actor = this.actor;
            actor.position.z -= this.speed * dt;
            actor.position.y = world.groundHeight(actor.position.x, actor.position.z);
            this.clock += dt; advanceNraMotion(actor, dt);
          },
          capture() {
            const actor = this.actor;
            this.advance(1 / 30);
            camera.position.set(actor.position.x + 3.2, actor.position.y + 1.3, actor.position.z);
            camera.lookAt(actor.position.x, actor.position.y + .95, actor.position.z);
            camera.updateMatrixWorld(true);
            this.force.update([actor], this.clock, entities.control.soldierId, graphics.snapshot.preset);
            uniformExcludedIds.clear();
            for (const id of this.force.excludedIds) uniformExcludedIds.add(id);
            soldierRenderer.update([actor], graphics.snapshot.preset, this.clock, entities.control.soldierId, uniformExcludedIds, true);
            renderer.render(scene, camera);
            const view = this.force.snapshot.views.find(item => item.actorId === actor.id);
            const visibleRoot = this.force.root.children.find(item => item.visible &&
              item.getObjectByName('Spine') && item.getObjectByName('Neck'));
            const spine = visibleRoot?.getObjectByName('Spine').getWorldPosition(new THREE.Vector3());
            const neck = visibleRoot?.getObjectByName('Neck').getWorldPosition(new THREE.Vector3());
            return { image: renderer.domElement.toDataURL('image/png'), lean: actor.nativeMotion.bodyLean,
              speed: actor.nativeMotion.speed, issue: view?.issue, muzzle: view?.riflePose?.muzzle,
              logical: view?.logicalMuzzle, torsoAngle: spine && neck
                ? Math.atan2(-(neck.z - spine.z), neck.y - spine.y) : null,
              error: renderer.getContext().getError() };
          }
        };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
    url.searchParams.set('resources', 'low-memory');
    await page.goto(url.href); await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    for (const [mode, speed] of [['jog', 2.7], ['sprint', 4.1]]) {
      const path = join(directory, variant, mode);
      await mkdir(path, { recursive: true });
      await page.evaluate(speed => window.runningLeanReview.setup(speed), speed);
      const samples = [];
      for (let frame = 0; frame < (process.env.MEASURE_ONLY === '1' ? 1 : 60); frame++) {
        const { image, ...sample } = await page.evaluate(() => window.runningLeanReview.capture());
        if (process.env.MEASURE_ONLY !== '1')
          await writeFile(join(path, `${String(frame).padStart(3, '0')}.png`), Buffer.from(image.split(',')[1], 'base64'));
        samples.push(sample);
      }
      results.push({ team, variant, mode, samples });
      assert.ok(samples.every(sample => sample.error === 0 && Number.isFinite(sample.lean) &&
        !sample.issue && sample.muzzle && sample.logical &&
        Math.hypot(sample.muzzle[0] - sample.logical.x, sample.muzzle[1] - sample.logical.y,
          sample.muzzle[2] - sample.logical.z) < .0001),
        `${variant} ${mode} missing pose or WebGL error`);
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await writeFile(join(directory, `observations-${process.env.MEASURE_ONLY === '1' ? 'measure-' : ''}${process.env.REVIEW_VARIANT ?? 'all'}.json`), JSON.stringify({ results, errors,
    limitation: 'Actual game renderer and native characters, manually moved at fixed 1/30-second steps with a following diagnostic camera; no game-input recording, no audio. Candidate modes are injected after startup; current mode uses the actual game code. Lean is the bodyLean parameter, not a measured torso angle.' }, null, 2));
  await browser.close();
}
