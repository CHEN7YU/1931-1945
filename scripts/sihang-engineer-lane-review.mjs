import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.engineerLaneReview = {
        run() {
          setGameState('pause'); missionBriefing.hide();
          const actor = friendlyForces.find(item => item.engineer && !item.playerUnit && item.health > 0);
          const threat = enemies.find(item => item.health > 0 && !item.vehicleId);
          if (!threat) throw new Error('Expected a living opposing soldier');
          const actorPosition = actor.position.clone(), threatPosition = threat.position.clone();
          actor.position.set(0, 0, 0); threat.position.set(0, 0, -10);
          actorGrid.rebuild(allForces);
          actor.tactics.idleThreatHeadingUntil = 0;
          const idleFacing = idleThreatHeading(actor);
          actor.position.copy(actorPosition); threat.position.copy(threatPosition);
          actorGrid.rebuild(allForces);
          if (!actor) throw new Error('Expected a living AI engineer');
          actor.engineer.heading = 0;
          let candidate = null;
          for (let z = -7; z <= -1 && !candidate; z += 1)
            for (let x = -34; x <= 26; x += 1) {
              const point = { x, y: 0, z };
              if (!engineerPlacementReason(actor, point)) { candidate = point; break; }
            }
          if (!candidate) throw new Error('No physically valid construction position in the south quay');
          const defenseReason = engineerPlacementReason(actor, candidate);
          sihangCampaign.stage = 'sihang-retreat';
          const retreatReason = engineerPlacementReason(actor, candidate);
          const retreatLanes = ['sihang-defense', 'sihang-retreat'].flatMap(stage => {
            sihangCampaign.stage = stage;
            return ['maxim24', 'bofors75'].flatMap(profile => {
              actor.engineer.selected = profile;
              return SIHANG_RESERVED_LANES.filter(lane => lane.id.startsWith('retreat-')).map(lane => {
                const reasons = new Set(); let valid = 0;
                for (let z = lane.minZ + .5; z < lane.maxZ; z += 1)
                  for (let x = lane.minX + .5; x < lane.maxX; x += 1) {
                    const reason = engineerPlacementReason(actor, { x, y: world.walkHeight(x, z, 0), z });
                    if (reason) reasons.add(reason); else valid++;
                  }
                return { stage, profile, id: lane.id, valid, reasons: [...reasons] };
              });
            });
          });
          actor.engineer.selected = 'maxim24';
          const armorReason = engineerPlacementReason(actor, { x: -70, y: 0, z: -60 });
          const bridgeHeading = Math.atan2(SIHANG_BRIDGE.northX - SIHANG_BRIDGE.southX,
            SIHANG_BRIDGE.northZ - SIHANG_BRIDGE.southZ);
          actor.engineer.heading = bridgeHeading;
          const bridgePoint = sihangBridgePoint(.5);
          const bridgeCandidate = { ...bridgePoint, y: world.walkHeight(bridgePoint.x, bridgePoint.z, 0) };
          const bridgeReason = engineerPlacementReason(actor, bridgeCandidate);
          const elevatedReason = engineerPlacementReason(actor, { ...bridgeCandidate, y: bridgeCandidate.y + 7.2 });
          actor.engineer.selected = 'bofors75';
          const artilleryBridgeReason = engineerPlacementReason(actor, bridgeCandidate);
          actor.engineer.selected = 'maxim24';
          actor.engineer.heading = 0;
          actor.position.set(candidate.x, 0, candidate.z - 3);
          selectConstructionBlueprint(actor.engineer.construction, actor.id);
          const before = engineerWorks.length;
          for (let step = 0; step < 1000 && engineerWorks.length === before; step++)
            updateEngineerConstruction(actor, .05, true, { ...candidate });
          actor.playerUnit = true;
          actor.engineer.selected = 'bofors75';
          let playerEastCandidate = null;
          for (let z = -28.5; z <= -21 && !playerEastCandidate; z += .75)
            for (let x = 30.5; x <= 74 && !playerEastCandidate; x += .75) {
              const point = { x, y: world.walkHeight(x, z, 0), z };
              if (!engineerPlacementReason(actor, point)) playerEastCandidate = point;
            }
          if (!playerEastCandidate) throw new Error('No physically valid player construction position in the warehouse east flank');
          const playerEastReason = engineerPlacementReason(actor, playerEastCandidate);
          actor.position.set(playerEastCandidate.x, playerEastCandidate.y, playerEastCandidate.z - 3);
          selectConstructionBlueprint(actor.engineer.construction, actor.id);
          const beforePlayerEast = engineerWorks.length;
          for (let step = 0; step < 1000 && engineerWorks.length === beforePlayerEast; step++)
            updateEngineerConstruction(actor, .05, true, { ...playerEastCandidate });
          const playerEastBuilt = engineerWorks.length === beforePlayerEast + 1;
          const eastWork = playerEastBuilt ? engineerWorks.at(-1).point : null;
          const playerEastSpec = eastWork ? { x: eastWork.x, y: eastWork.altitude, z: eastWork.z, id: eastWork.id } : null;
          actor.playerUnit = false;
          const built = engineerWorks.length === before + 1;
          const bridgeActor = friendlyForces.find(item => item !== actor && item.engineer &&
            !item.playerUnit && item.health > 0 && item.engineer.materials.maxim24);
          if (!bridgeActor) throw new Error('Expected a second living AI engineer');
          bridgeActor.engineer.heading = bridgeHeading;
          const bx = bridgeCandidate.x + Math.sin(bridgeHeading) * ENGINEER.reach;
          const bz = bridgeCandidate.z + Math.cos(bridgeHeading) * ENGINEER.reach;
          bridgeActor.position.set(bx, world.walkHeight(bx, bz, 0), bz);
          selectConstructionBlueprint(bridgeActor.engineer.construction, bridgeActor.id);
          const beforeBridge = engineerWorks.length;
          for (let step = 0; step < 1000 && engineerWorks.length === beforeBridge; step++)
            updateEngineerConstruction(bridgeActor, .05, true);
          const bridgeBuilt = engineerWorks.length === beforeBridge + 1;
          const point = bridgeBuilt ? engineerWorks.at(-1).point : null;
          const bridgeSpec = point ? { x: point.x, y: point.altitude, z: point.z, id: point.id } : null;
          return { candidate, defenseReason, retreatReason, retreatLanes, armorReason, bridgeCandidate, bridgeReason,
            elevatedReason, artilleryBridgeReason, built, playerEastCandidate, playerEastReason, playerEastBuilt, bridgeBuilt, bridgeSpec,
            playerEastSpec, idleFacing,
            blocked: bridgeActor.engineer.construction.blockedReason };
        },
        viewBridge() {
          camera.position.set(88, 7, -13);
          camera.lookAt(83, 1, -22);
          camera.updateMatrixWorld(true);
        },
        viewEast() {
          const point = engineerWorks.find(work => work.point.x >= 30 && work.point.z >= -29 && work.point.z <= -21)?.point;
          if (!point) throw new Error('Missing built player emplacement on the east flank');
          camera.position.set(point.x + 12, point.altitude + 8, point.z - 14);
          camera.lookAt(point.x, point.altitude + 1, point.z);
          camera.updateMatrixWorld(true);
          renderer.render(scene, camera);
          renderer.render(scene, camera);
        }
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
  const result = await page.evaluate(() => engineerLaneReview.run());
  assert.equal(result.defenseReason, null);
  assert.equal(result.retreatReason, null);
  assert.match(result.armorReason, /装甲或爆破通路/);
  assert.equal(result.bridgeReason, null, JSON.stringify(result.bridgeCandidate));
  assert.match(result.elevatedReason, /只能在一楼或室外地面/);
  assert.equal(result.artilleryBridgeReason, null);
  assert.ok(result.retreatLanes.filter(lane => lane.id !== 'retreat-bridge').every(lane => lane.valid > 0),
    `exit and approach need physically valid build locations: ${JSON.stringify(result.retreatLanes)}`);
  assert.ok(result.retreatLanes.every(lane => lane.reasons.every(reason => !reason.includes('撤退、'))));
  assert.ok(result.playerEastCandidate.x >= 30 && result.playerEastCandidate.x <= 74);
  assert.ok(result.playerEastCandidate.z >= -29 && result.playerEastCandidate.z <= -21);
  assert.equal(result.playerEastReason, null, JSON.stringify(result.playerEastCandidate));
  assert.equal(result.playerEastBuilt, true, JSON.stringify(result));
  assert.ok(Math.abs(result.idleFacing) < .001, `a soldier north of the actor should face north: ${result.idleFacing}`);
  assert.equal(result.built, true, JSON.stringify(result));
  assert.equal(result.bridgeBuilt, true, JSON.stringify(result));
  assert.ok(Math.abs(result.bridgeSpec.y - result.bridgeCandidate.y) < .001);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await page.evaluate(() => engineerLaneReview.viewEast());
    await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, 'east-player-emplacement.png') });
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await page.evaluate(() => engineerLaneReview.viewBridge());
    await page.screenshot({ path: path.join(process.env.ARTIFACT_DIR, 'bridge-built.png') });
  }
  console.log(JSON.stringify({ labels, ...result }));
} finally {
  await browser.close();
}
