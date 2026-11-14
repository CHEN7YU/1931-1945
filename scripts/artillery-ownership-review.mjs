import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [], errors = [];
try {
  for (const campaign of ['taierzhuang', 'nanjing', 'sihang']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', error => errors.push(`${campaign}: ${error.message}`));
    await page.route('**/src/main.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.artilleryOwnershipReview = {
          setup(kind) {
            const player = controlledSoldier(entities);
            if (player.emplacementId) releaseEmplacement(player);
            if (this.point) {
              emplacements.delete(this.point.id); entities.weapons.delete(this.point.weapon.id);
              scene.remove(this.point.view);
            }
            const builder = allForces.find(actor => actor.engineer && actor.team ===
              (kind === 'enemy' ? 'enemy' : 'friendly'));
            if (!builder) throw new Error('Missing fixture engineer');
            let site = null;
            for (let z = battleArea.minZ + 10; z < battleArea.maxZ - 10 && !site; z += 5)
              for (let x = battleArea.minX + 10; x < battleArea.maxX - 10 && !site; x += 5) {
                if (world.isDeepWater?.(x, z) || Math.abs(world.walkHeight(x, z, 0)) > .1 ||
                  circleBlocked(x, z, 3, movementObstacles(x, z), 0) ||
                  [...emplacements.values()].some(point => Math.hypot(point.x - x, point.z - z) < 6)) continue;
                site = { x, y: 0, z };
              }
            if (!site) throw new Error('No clear fixture position');
            const old = builder.engineer.selected;
            builder.engineer.selected = kind === 'machine-gun' ? 'maxim24' : 'bofors75';
            const spec = kind === 'preset'
              ? { id: 'review-preset', profile: 'bofors75', x: site.x, z: site.z, altitude: 0, heading: 0 }
              : { ...engineerBuiltSpec(builder, site, 0), id: 'review-' + kind };
            builder.engineer.selected = old;
            const point = createEmplacement(spec);
            point.view = createEmplacementModel(point); scene.add(point.view);
            registerWeapon(entities, point.weapon, point.id + ':weapon', point.id, point.weapon.type);
            emplacements.set(point.id, point);
            player.position.set(site.x, 0, site.z + 1.7);
            player.traversal.kind = 'grounded'; player.traversal.velocity = 0;
            stopLocomotion(player.locomotion); controlPose.yaw = player.heading = 0;
            missionBriefing.hide(); updateCamera(0);
            if (world.doorSystem.focus(camera)) throw new Error('Fixture unexpectedly focuses a door');
            updateDoorPrompt(); this.point = point;
            return { prompt: $('interaction-prompt').textContent, id: point.id,
              builderTeam: point.builderTeam ?? null };
          },
          result() {
            const player = controlledSoldier(entities);
            return { playerPoint: player.emplacementId ?? null, operator: this.point.operatorId,
              team: this.point.team, builderTeam: this.point.builderTeam ?? null };
          },
          aiDenied() {
            const actor = allForces.find(person => person.team === 'friendly' && !person.playerUnit &&
              person.health > 0 && !person.vehicleId && person.traversal.kind === 'grounded');
            if (!actor) throw new Error('Missing friendly AI');
            const direct = occupyEmplacement(this.point, actor);
            actor.tactics.stationId = this.point.id;
            const update = operateAIEmplacement(actor, .05);
            return { direct, update, stationId: actor.tactics.stationId ?? null, emplacementId: actor.emplacementId ?? null };
          }
        };` });
    });
    const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
    url.searchParams.set('character', 'procedural');
    url.searchParams.set('resources', 'low-memory');
    if (campaign !== 'taierzhuang') url.searchParams.set('campaign', campaign);
    await page.goto(url.href); await deployFromMenu(page);
    await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
    for (const kind of ['preset', 'enemy', 'friendly', 'machine-gun']) {
      const initial = await page.evaluate(kind => artilleryOwnershipReview.setup(kind), kind);
      if (['preset', 'enemy'].includes(kind)) {
        assert.match(initial.prompt, /只能操作我军工兵建造的火炮/);
        const ai = await page.evaluate(() => artilleryOwnershipReview.aiDenied());
        assert.equal(ai.direct, false); assert.equal(ai.update, false);
        assert.equal(ai.stationId, null); assert.equal(ai.emplacementId, null);
      }
      await page.keyboard.press('f');
      const result = await page.evaluate(() => artilleryOwnershipReview.result());
      assert.equal(result.playerPoint, ['preset', 'enemy'].includes(kind) ? null : initial.id);
      results.push({ campaign, kind, initial, result });
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'ownership.json'), JSON.stringify({ results, errors,
    limitation: 'Procedural characters on actual maps; fixture places a registered weapon and player on clear terrain. F and AI paths are real; construction and combat are isolated.' }, null, 2));
  console.log('Artillery ownership passed on all three maps.');
} finally {
  await browser.close();
}
