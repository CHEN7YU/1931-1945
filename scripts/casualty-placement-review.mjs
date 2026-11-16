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
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.casualtyPlacementReview = async () => {
        setGameState('pause'); missionBriefing.hide(); keys.clear();
        const { legacyPlaceCasualty } = await import('/scripts/fixtures/casualty-placement-legacy.js');
        const actor = enemies.find(item => item.health > 0 && item.nativeMotion && !item.vehicleId);
        if (!actor || !ijaCharacter) throw new Error('Expected a real enemy character');
        const original = actor.position.clone(), originalHeading = actor.heading;
        const bounds = (variant, retain) => ijaCharacter.casualtyBounds(variant, retain);
        const locations = [{ x: original.x, y: original.y, z: original.z }];
        for (const obstacle of world.obstacles) {
          if (locations.length >= 13) break;
          if (![obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ].every(Number.isFinite) ||
            obstacle.height < 1 || obstacle.maxX - obstacle.minX > 25 || obstacle.maxZ - obstacle.minZ > 25) continue;
          const x = obstacle.maxX + .25, z = (obstacle.minZ + obstacle.maxZ) / 2;
          if (Math.abs(x) > 160 || Math.abs(z) > 160) continue;
          const y = world.walkHeight(x, z, 0);
          if (Number.isFinite(y)) locations.push({ x, y, z });
        }
        const cases = [];
        for (const [index, position] of locations.entries()) {
          actor.position.set(position.x, position.y, position.z);
          actor.heading = index % 2 ? .3 : 1.2;
          const template = { ...actor, health: 0 };
          const casualty = createCasualtyState(template, time, null, { retainGun: false });
          const at = movementCollision.snapshot();
          let oldCalls = 0, newCalls = 0;
          const query = count => (point, radius, height) => {
            count(); return circleBlocked(point.x, point.z, radius, at(point.x, point.z), point.y, height);
          };
          const ignored = query(() => {});
          for (let warmup = 0; warmup < 2; warmup++) {
            legacyPlaceCasualty(actor, casualty, bounds, ignored);
            placeCasualty(actor, casualty, bounds, ignored);
          }
          let before, after, oldMs = 0, newMs = 0;
          const sampleOld = () => {
            const start = performance.now();
            before = legacyPlaceCasualty(actor, casualty, bounds, query(() => oldCalls++));
            oldMs += performance.now() - start;
          };
          const sampleNew = () => {
            const start = performance.now();
            after = placeCasualty(actor, casualty, bounds, query(() => newCalls++));
            newMs += performance.now() - start;
          };
          for (let repeat = 0; repeat < 6; repeat++) {
            if (repeat % 2) { sampleNew(); sampleOld(); } else { sampleOld(); sampleNew(); }
          }
          const actual = placeActorCasualty(actor, casualty, ijaCharacter);
          cases.push({ position, before, after, actual, oldCalls: oldCalls / 6, newCalls: newCalls / 6,
            oldMs: oldMs / 6, newMs: newMs / 6 });
        }
        actor.position.copy(original); actor.heading = originalHeading;
        return { campaign: campaign.id, cases };
      };
      window.casualtyDeathReview = () => {
        const target = enemies.find(item => item.health > 0 && item.nativeMotion && !item.vehicleId && item !== controlledSoldier(entities));
        if (!target) throw new Error('Expected a live enemy outside a vehicle');
        const shooter = controlledSoldier(entities);
        if (!shooter?.rifle) throw new Error('Expected the controlled rifleman');
        const source = captureAttackSource(entities, shooter, shooter.rifle);
        setGameState('playing');
        hurt(target, 1000, source, 'rifle', 'torso');
        setGameState('pause');
        return { health: target.health, deathProcessed: target.deathProcessed,
          registered: corpses.has(target.id), casualty: Boolean(target.casualty) };
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', process.env.CAMPAIGN ?? 'sihang');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const result = await page.evaluate(() => window.casualtyPlacementReview());
  await writeFile(join(directory, 'casualty-placement.json'), JSON.stringify({ ...result, errors }, null, 2));
  assert.equal(result.campaign, process.env.CAMPAIGN ?? 'sihang');
  for (const item of result.cases) {
    assert.deepEqual(item.after, item.before);
    assert.deepEqual(item.actual, item.before);
  }
  const death = await page.evaluate(() => window.casualtyDeathReview());
  await writeFile(join(directory, 'casualty-placement.json'), JSON.stringify({ ...result, death, errors }, null, 2));
  assert.deepEqual(death, { health: 0, deathProcessed: true, registered: true, casualty: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cases: result.cases.length,
    oldCalls: result.cases.reduce((sum, item) => sum + item.oldCalls, 0),
    newCalls: result.cases.reduce((sum, item) => sum + item.newCalls, 0),
    oldMs: result.cases.reduce((sum, item) => sum + item.oldMs, 0),
    newMs: result.cases.reduce((sum, item) => sum + item.newMs, 0), death }));
} finally {
  await browser.close();
}
