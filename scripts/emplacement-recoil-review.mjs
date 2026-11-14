import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const campaign = process.env.CAMPAIGN ?? 'nanjing';
if (!['nanjing', 'sihang', 'taierzhuang-streets'].includes(campaign))
  throw new RangeError('Unsupported machine-gun review campaign');
const pointId = campaign === 'sihang' ? 'sihang-north-gate-west'
  : campaign === 'nanjing' ? 'gate-wall-mg' : null;
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: directory, size: { width: 1280, height: 720 } } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.recoilReview = {
        setup() {
          setGameState('pause'); missionBriefing.hide();
          for (const enemy of enemies) enemy.health = 0;
          const actor = controlledSoldier(entities);
          let point = emplacements.get(${JSON.stringify(pointId)});
          if (!point && ${JSON.stringify(campaign === 'taierzhuang-streets')}) {
            const builder = friendlyForces.find(member => member !== actor && member.health > 0 && member.engineer);
            if (!builder) throw new Error('Review requires an AI engineer');
            builder.engineer.heading = builder.heading = 0;
            let site = null;
            for (let z = battleArea.minZ + 8; z < battleArea.maxZ - 8 && !site; z += 5)
              for (let x = battleArea.minX + 8; x < battleArea.maxX - 8 && !site; x += 5) {
                const origin = { x, y: 0, z }, candidate = engineerPlacement(origin, 0);
                if (Math.abs(world.walkHeight(x, z, 0)) > .025 ||
                  circleBlocked(x, z, .45, movementObstacles(x, z), 0) ||
                  engineerPlacementReason(builder, candidate)) continue;
                site = { origin, candidate };
              }
            if (!site) throw new Error('Review cannot find a valid construction site');
            builder.position.set(site.origin.x, 0, site.origin.z);
            selectConstructionBlueprint(builder.engineer.construction, builder.id);
            for (let i = 0; i < 450 && builder.engineer.materials.maxim24; i++)
              updateEngineerConstruction(builder, .05, true, site.candidate);
            point = engineerWorks.find(work => work.builderId === builder.id)?.point;
            if (!point) throw new Error('Engineer failed to build the review machine gun');
            point.playerOnly = true;
          }
          if (!point) throw new Error('Review machine gun is missing');
          this.pointId = point.id;
          const pose = emplacementPose(point, point.altitude);
          actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
          if (actor.nativeMotion) actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
          controlPose.yaw = point.heading; controlPose.pitch = -.15;
          setGameState('playing'); bindControlInput(); updateCamera(0);
          const update = point.view.userData.update;
          point.view.userData.update = () => {
            if (this.baseline) point.recoil = 0;
            update();
          };
          return point.id;
        },
        baseline: false,
        sample() {
          const actor = controlledSoldier(entities), point = emplacements.get(this.pointId);
          const pose = emplacementPose(point, point.altitude);
          const barrel = point.view.children[0].children[0];
          const tip = barrel.localToWorld(new THREE.Vector3(0, 0, -point.weapon.settings.barrel));
          return { time, mounted: actor.emplacementId, shots: point.shots, recoil: point.recoil,
            muzzle: [pose.muzzle.x, pose.muzzle.y, pose.muzzle.z], tip: tip.toArray(),
            eye: [pose.eye.x, pose.eye.y, pose.eye.z], lastShot: point.weapon.lastShot ?? null };
        },
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', campaign); url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const actualPointId = await page.evaluate(() => recoilReview.setup());
  if (pointId) assert.equal(actualPointId, pointId);
  await page.locator('#world').click();
  await page.keyboard.press('f');
  await page.waitForFunction(id => recoilReview.sample().mounted === id, actualPointId, { timeout: 10000 });
  const samples = [];
  for (const baseline of [true, false]) {
    await page.evaluate(value => { recoilReview.baseline = value; }, baseline);
    await page.mouse.down();
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(40);
      samples.push({ baseline, ...await page.evaluate(() => recoilReview.sample()) });
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  const old = samples.filter(sample => sample.baseline), current = samples.filter(sample => !sample.baseline);
  assert.ok(old.at(-1).shots > old[0].shots && current.at(-1).shots > current[0].shots, 'both cases use actual held fire');
  assert.ok(old.every(sample => sample.recoil === 0), 'baseline disables only presentation recoil');
  assert.ok(current.some(sample => sample.recoil > .01), 'successful held shots produce visible recoil');
  for (const sample of current) {
    assert.ok(Math.hypot(...sample.muzzle.map((value, i) => value - sample.tip[i])) < 1e-5,
      'rendered muzzle and simulation muzzle remain aligned');
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'recoil.json'), JSON.stringify({
    fixture: `Real F and held mouse fire at ${campaign} machine gun ${actualPointId}; player manually placed and enemies disabled. ${pointId ? '' : 'AI engineer and construction site manually placed; point reserved for player. '}Baseline suppresses only the new recoil presentation.`,
    samples, errors }, null, 2));
  const video = page.video();
  await page.close();
  await video.saveAs(join(directory, 'fixed-machine-gun-recoil.webm'));
  await context.close();
  console.log('Fixed machine-gun recoil gameplay review captured.');
} finally {
  await browser.close();
}
