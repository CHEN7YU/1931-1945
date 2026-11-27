import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const preferences = defaultPreferences();
  preferences.quality.preset = 'low';
  for (const effect of Object.keys(preferences.quality.effects)) preferences.quality.effects[effect] = false;
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key,
    JSON.stringify({ version: 1, settings })), { key: PREFERENCES_KEY, settings: preferences });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.civilianPursuitReview = () => {
        const originalEnemies = enemies;
        const results = [];
        for (const kind of ['bayonet', 'gun']) {
          const actor = originalEnemies.find(item => item.health > 0 && !item.vehicleId &&
            item.formation.type === 'infantry' && item.index % 11 >= 2 && !item.discharger &&
            (kind === 'bayonet' ? hasBayonet(item) : !hasBayonet(item)));
          if (!actor) throw new Error('No real Japanese ' + kind + ' soldier in the roster');
          world.resetCampaign(); world.doorSystem.reset(); time = 50;
          nanjingCampaign = createNanjingCampaign(); aiDecisions.reset(); clearTransient();
          enemies = [actor]; rebuildForces(); friendlyForces = []; allForces = [actor];
          populationRefreshAt = time + 60;
          actor.position.set(-24, world.groundHeight(-24, 50), 50);
          actor.heading = 0; actor.target = null; actor.nextThink = 0;
          actor.tactics.civilianThinkAt = 0; actor.tactics.civilianTarget = null;
          const civilian = world.civilians.find(person => person.userData.openingWave);
          civilian.position.set(-24, world.groundHeight(-24, 43), 43);
          civilian.visible = true; civilian.userData.active = true;
          const initialHealth = civilian.userData.health;
          const modes = new Set();
          let minDistance = Infinity;
          for (let frame = 0; frame < 600; frame++) {
            time += .05; aiDecisions.beginFrame(); updateWeaponSimulation(.05);
            updateAI(.05); controlEvents.drain(() => {});
            if (actor.nativeMotion) { updateAIWeaponClearance(actor); advanceNraMotion(actor, .05); }
            modes.add(actor.tactics.mode);
            minDistance = Math.min(minDistance, actor.position.distanceTo(civilian.position));
            if (civilian.userData.dead || kind === 'gun' && nanjingCampaign.civilianShots > 0 ||
              kind === 'bayonet' && actor.bayonet.hits > 0) break;
          }
          results.push({ kind, role: actor.role, weapon: actor.rifle.model ?? 'rifle',
            bayonet: hasBayonet(actor), modes: [...modes], minDistance,
            shots: nanjingCampaign.civilianShots ?? 0, strikes: actor.bayonet.strikes,
            hits: actor.bayonet.hits, initialHealth, finalHealth: civilian.userData.health,
            dead: civilian.userData.dead, blocked: actor.aiRifle.blocked, position: actor.position.toArray(),
            heading: actor.heading, stance: actor.stance, traversal: actor.traversal.kind,
            locomotion: { speed: actor.locomotion.speed, mode: actor.locomotion.mode },
            nativeMotion: actor.nativeMotion && { speed: actor.nativeMotion.speed, weight: actor.nativeMotion.weight,
              posture: actor.nativeMotion.posture }, weaponBlocked: actor.weaponBlocked,
            ahead: movementObstacles(actor.position.x, actor.position.z).filter(obstacle =>
              circleBlocked(actor.position.x, actor.position.z - .1, .42, [obstacle], actor.position.y))
              .map(({ id, minX, maxX, minZ, maxZ, height, minY }) => ({ id, minX, maxX, minZ, maxZ, height, minY })),
            nearby: trafficGrid.near(actor.position.x, actor.position.z, 3.2).map(item =>
              ({ id: item.id, x: item.position.x, z: item.position.z })) });
        }
        return results;
      };
    ` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376');
  url.searchParams.set('campaign', 'nanjing');
  url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.campaign?.openingAssaultReleased, null, { timeout: 180000 });
  const results = await page.evaluate(() => civilianPursuitReview());
  console.log(JSON.stringify({ results, errors,
    limitation: 'Low-quality isolated game update with actual roster equipment, manually placed stationary civilians and no defenders.' }));
  const bayonet = results.find(result => result.kind === 'bayonet');
  const gun = results.find(result => result.kind === 'gun');
  assert.ok(bayonet.bayonet && bayonet.modes.includes('bayonet-charge') && bayonet.strikes > 0 && bayonet.hits > 0 &&
    bayonet.finalHealth < bayonet.initialHealth, 'the real bayonet soldier must pursue and hit');
  assert.ok(!gun.bayonet && gun.modes.includes('pursue-civilians') && gun.shots > 0,
    'the real non-bayonet soldier must follow, aim and fire');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
