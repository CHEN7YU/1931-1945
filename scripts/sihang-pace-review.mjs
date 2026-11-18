import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const baseline = process.env.PACE_BASELINE === '1';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.paceReview = {
        start() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const player = controlledSoldier(entities);
          const actor = friendlyAI.find(item => item.health > 0 && item.nativeMotion && !item.vehicleId);
          if (!actor) throw new Error('Expected a friendly AI soldier');
          for (const other of allForces) if (other !== player && other !== actor) other.health = 0;
          sihangCampaign.stage = 'sihang-retreat';
          let selected = null;
          for (let z = -38; z <= -2 && !selected; z += 1)
            for (let x = -24; x <= 24 && !selected; x += 1)
              for (let angle = 0; angle < Math.PI * 2 && !selected; angle += Math.PI / 4) {
                const dx = Math.cos(angle), dz = Math.sin(angle), position = { x, y: 0, z };
                const target = { x: x + dx * 6, y: 0, z: z + dz * 6, transit: true };
                if (Math.hypot(player.position.x - x, player.position.z - z) < 12 ||
                  Math.abs(world.walkHeight(x, z, 0)) > .05 ||
                  circleBlocked(x, z, .46, movementObstacles(x, z), 0)) continue;
                const constrained = [-1, 1].some(side => infantryNavigationBlocked(
                  { x: x - dz * side, z: z + dx * side }, position, .42, actor));
                const clear = sampledRouteClear(position, target, (px, pz) =>
                  !infantryNavigationBlocked({ x: px, z: pz }, position, .46, actor) &&
                  Math.abs(world.walkHeight(px, pz, 0)) < .05);
                if (constrained && clear)
                  selected = { position, target, heading: Math.atan2(-dx, -dz) };
              }
          if (!selected) throw new Error('No constrained but clear retreat route');
          actor.position.set(selected.position.x, 0, selected.position.z);
          actor.heading = selected.heading + Math.PI / 4; actor.turningToPath = false;
          actor.stance = 'standing'; actor.firingPose = null;
          actor.tactics.lastSeen = null; actor.tactics.movementSpace = null;
          actor.locomotion.stamina = 1; actor.locomotion.exhausted = false;
          actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          actor.path = [{ ...selected.target }]; actor.pathGoal = { ...selected.target };
          actor.nextPath = Infinity; actor.stuckTime = 0;
          stopLocomotion(actor.locomotion); actorGrid.rebuild(allForces); trafficGrid.rebuild([]);
          this.actor = actor; this.selected = selected; this.samples = [];
          return selected;
        },
        step() {
          for (let i = 0; i < 10; i++) {
            time += .05; trafficReservations.clear();
            walkActor(this.actor, this.selected.target, 3.5, .05, true, ${!baseline});
            advanceNraMotion(this.actor, .05);
              heading: this.actor.heading, turning: this.actor.turningToPath,
              distance: Math.hypot(this.actor.position.x - this.selected.position.x,
                this.actor.position.z - this.selected.position.z),
            this.samples.push({ speed: this.actor.locomotion.speed, pace: this.actor.locomotion.mode,
              constrained: this.actor.tactics.movementSpace?.constrained,
              position: this.actor.position.toArray() });
          }
          camera.position.set(this.actor.position.x + Math.sin(this.actor.heading) * 2.8,
            1.4, this.actor.position.z + Math.cos(this.actor.heading) * 2.8);
          camera.lookAt(this.actor.position.x, 1, this.actor.position.z); camera.updateMatrixWorld(true);
          nraCharacter.update([this.actor], time, entities.control.soldierId, graphics.snapshot.preset);
          uniformExcludedIds.clear();
          for (const id of nraCharacter.excludedIds) uniformExcludedIds.add(id);
          soldierRenderer.update([this.actor], graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return { samples: this.samples, motion: sampleNraMotion(this.actor),
            image: renderer.domElement.toDataURL('image/png').split(',')[1] };
        }
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const fixture = await page.evaluate(() => paceReview.start());
  const { image, ...result } = await page.evaluate(() => paceReview.step());
  await writeFile(join(directory, 'retreat-pace.png'), Buffer.from(image, 'base64'));
  await writeFile(join(directory, 'retreat-pace.json'), JSON.stringify({
    fixture: 'single-manually-placed-soldier-constrained-real-map-route-direct-walkActor', baseline,
    setup: fixture, ...result, errors,
  }, null, 2));
  assert.ok(result.samples.some(sample => sample.constrained && (baseline
    ? sample.pace === 'walk' && sample.speed > 1.6 && sample.speed < 1.9
  if (!baseline) assert.ok(result.samples[0].turning && result.samples[0].distance > .01,
    'a soldier must keep moving while turning along a clear path');
    : sample.pace === 'jog' && sample.speed > 2.4)));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ setup: fixture, samples: result.samples.filter(sample => sample.constrained).length,
    maxSpeed: Math.max(...result.samples.map(sample => sample.speed)),
    gait: result.motion.gait }));
} finally {
  await browser.close();
}
