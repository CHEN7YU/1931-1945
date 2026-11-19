import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.engineerLaneReview = () => {
        const ai = friendlyForces.find(actor => actor.engineer && !actor.playerUnit && actor.health > 0);
        const playerIndex = allies.findIndex(actor => actor.engineer && actor.health > 0);
        if (!ai || playerIndex < 0) throw new Error('Expected player and AI engineers');
        changeMember(playerIndex);
        const player = controlledSoldier(entities);
        if (player !== allies[playerIndex]) throw new Error('Could not take control of the engineer');
        equipTool(true);
        const at = (x, z) => ({ x, y: world.walkHeight(x, z, 0), z });
        const candidate = at(-36.016, -3.919);
        const bridge = sihangBridgePoint(.5);
        const points = [candidate, at(-23, -4), at(35, -21), at(60, sihangRiverBounds(60).northZ - 3),
          at(bridge.x, bridge.z)];
        const reasons = ['sihang-defense', 'sihang-retreat'].map(stage => {
          sihangCampaign.stage = stage;
          return ENGINEER.profiles.map(profile => {
            ai.engineer.selected = profile;
            ai.engineer.heading = 0;
            return points.map(point => engineerPlacementReason(ai, point));
          });
        });
        const edgeReason = engineerPlacementReason(ai, at(-49, -4));
        ai.engineer.selected = 'maxim24';
        const armorReason = engineerPlacementReason(ai, at(-70, -60));
        const build = (actor, point) => {
          actor.position.set(point.x, point.y, point.z + ENGINEER.reach);
          actor.engineer.heading = 0;
          selectConstructionBlueprint(actor.engineer.construction, actor.id);
          const before = engineerWorks.length;
          for (let step = 0; step < 450 && engineerWorks.length === before; step++)
            updateEngineerConstruction(actor, .05, true, { ...point });
          return { built: engineerWorks.length > before, reason: actor.engineer.construction.blockedReason,
            material: actor.engineer.materials[actor.engineer.selected] };
        };
        const teammate = allies.find(actor => actor !== player && actor.engineer);
        const attached = teammate ?? allies.find(actor => actor !== player && actor.health > 0);
        attached.engineer ??= createEngineerState();
        const teammateBuild = build(attached, candidate);
        const aiBuild = build(ai, candidate);
        const clearSite = (actor, minX, maxX, minZ, maxZ) => {
          actor.engineer.heading = 0;
          for (let z = minZ; z <= maxZ; z += .5) for (let x = minX; x <= maxX; x += .5) {
            const point = at(x, z);
            if (!engineerPlacementReason(actor, point)) return point;
          }
          throw new Error('No valid construction site in the fixture');
        };
        const playerBuild = build(player, clearSite(player, -39, -31, -7, -2));
        player.engineer.selected = 'bofors75';
        const eastBuild = build(player, clearSite(player, 31, 74, -28, -21));
        sihangCampaign.stage = 'sihang-defense';
        const offRouteBuild = build(ai, clearSite(ai, -65, -38, -52, -30));
        setGameState('pause');
        return { reasons, edgeReason, armorReason, aiBuild, teammateBuild, playerBuild, eastBuild, offRouteBuild };
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  await page.keyboard.down('Tab');
  const labels = await page.locator('#squad-score-table .score-team.enemy tbody th').allTextContents();
  await page.keyboard.up('Tab');
  assert.ok(labels.some(label => label.includes('上海海军陆战队')));
  assert.ok(labels.every(label => !label.includes('游戏')));
  const result = await page.evaluate(() => engineerLaneReview());
  const prohibited = '撤离通道仅限玩家手动建造';
  for (const stage of result.reasons) for (const profile of stage)
    for (const reason of profile) assert.equal(reason, prohibited);
  assert.equal(result.edgeReason, prohibited);
  assert.match(result.armorReason, /装甲或爆破通路/);
  for (const attempt of [result.aiBuild, result.teammateBuild])
    assert.deepEqual(attempt, { built: false, reason: prohibited, material: 1 });
  for (const attempt of [result.playerBuild, result.eastBuild, result.offRouteBuild])
    assert.deepEqual(attempt, { built: true, reason: null, material: 0 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
