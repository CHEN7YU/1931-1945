import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.crouchReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const player = controlledSoldier(entities);
          const actor = allies.find(item => item !== player && item.health > 0 && !item.vehicleId &&
            item.nativeMotion && item.hasFirearm !== false);
          if (!actor || !nraCharacter) throw new Error('A loaded friendly character is required');
          let point = null, cameraPoint = null;
          for (const post of sihangEnemyRegroupPosts(world.obstacles)) {
            const x = post.x, z = post.z, y = world.walkHeight(x, z, 0);
            if (sihangSouthBank({ x, z }) || Math.abs(y) > .1 ||
              circleBlocked(x, z, .6, movementObstacles(x, z), y)) continue;
            for (const [dx, dz] of [[2.5, -3], [-2.5, -3], [2.5, 3], [-2.5, 3]]) {
              const cx = x + dx, cz = z + dz;
              if (circleBlocked(cx, cz, .4, movementObstacles(cx, cz), y)) continue;
              const eye = new THREE.Vector3(cx, y + 1.8, cz);
              if (hasLine(eye, new THREE.Vector3(x, y + .3, z), 10) &&
                hasLine(eye, new THREE.Vector3(x, y + 1, z), 10)) {
                point = { x, y, z }; cameraPoint = eye; break;
              }
            }
            if (point) break;
          }
          if (!point) throw new Error('No clear view of open ground');
          actor.position.set(point.x, point.y, point.z);
          actor.nativeMotion.position = { x: point.x, z: point.z };
          actor.heading = 0; actor.stance = 'crouched'; actor.firingPose = 'crouched';
          actor.rifleReady = true; actor.target = null; stopLocomotion(actor.locomotion);
          for (let i = 0; i < 80; i++) advanceNraMotion(actor, .05);
          camera.position.copy(cameraPoint);
          for (const child of camera.children) child.visible = false;
          camera.lookAt(point.x, actor.position.y + .7, point.z); camera.updateMatrixWorld(true);
          this.actor = actor;
          return this.capture();
        },
        hit() {
          setGameState('playing');
          const enemy = enemies.find(actor => actor.health > 0 && !actor.vehicleId && actor.rifle);
          if (!enemy) throw new Error('An original enemy attack source is required');
          const source = captureAttackSource(entities, enemy, enemy.rifle);
          hurt(this.actor, 1000, source, 'rifle', 'torso', { x: 0, z: -1 });
          setGameState('pause');
          if (!this.actor.casualty) throw new Error('Actual hurt path did not create a casualty');
          return { casualty: this.actor.casualty, ...this.capture() };
        },
        advance(delta) { time += delta; return this.capture(); },
        capture() {
          nraCharacter.update([this.actor], time, entities.control.soldierId, 'high');
          ijaCharacter?.update([], time, entities.control.soldierId, 'high');
          soldierRenderer.update([this.actor], 'high', time, entities.control.soldierId,
            nraCharacter.excludedIds, true);
          renderer.render(scene, camera);
          const view = nraCharacter.snapshot.views.find(item => item.actorId === this.actor.id);
          if (!view) throw new Error('Expected the actual near character view');
          return { time, view, image: renderer.domElement.toDataURL('image/png').split(',')[1] };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const frames = [await page.evaluate(() => crouchReview.setup())];
  frames.push(await page.evaluate(() => crouchReview.hit()));
  for (let i = 0; i < 24; i++) frames.push(await page.evaluate(() => crouchReview.advance(.05)));
  assert.ok(frames[0].view.motion.crouched > .95);
  assert.equal(frames[1].view.soldier.health, 0);
  for (const [index, frame] of frames.entries()) {
    await writeFile(join(directory, `frame-${String(index).padStart(2, '0')}.png`), Buffer.from(frame.image, 'base64'));
    delete frame.image;
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'review.json'), JSON.stringify({
    fixture: 'Actual hurt and near-character rendering; manually posed actor, fixed camera and isolated presentation clock.',
    frames, errors,
  }, null, 2));
  console.log(JSON.stringify({ variant: frames[1].casualty.variant, duration: frames[1].casualty.duration,
    initialHips: frames[0].view.hips[1], maximumHips: Math.max(...frames.map(frame => frame.view.hips[1])),
    initialHead: frames[0].view.head[1], maximumHead: Math.max(...frames.map(frame => frame.view.head[1])) }));
} finally {
  await browser.close();
}
