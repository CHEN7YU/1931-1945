import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const campaign = process.env.CAMPAIGN ?? 'sihang';
if (!['sihang', 'nanjing'].includes(campaign)) throw new Error('Unsupported melee regression campaign');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [], results = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.campaignMeleeReview = (mode) => {
        setGameState('pause');
        const player = controlledSoldier(entities);
        const actor = enemies.find(enemy => enemy.health > 0 && !enemy.formation.sihangDemolition &&
          !enemy.vehicleId && !enemy.discharger && enemy.groundType === 'infantry' &&
          (enemy.rifle.model ?? 'rifle') === 'rifle');
        if (!actor) throw new Error('Campaign ordinary enemy rifle fixture unavailable');
        for (const formation of formations) formation.respawnEnabled = false;
        for (const other of allForces) if (other !== actor && other !== player &&
          !other.formation.sihangDemolition) other.health = 0;
        let placement = null;
        for (const z of (nanjingCampaignMode ? [24, 27, 30] : [-85, -90, -95]))
        for (const x of (nanjingCampaignMode ? [22, 26, 30] : [-4, 0, 4])) {
          const to = { x, y: 0, z: z + 1.3 };
          if (!circleBlocked(x, z, .5, movementObstacles(x, z), 0) &&
            !circleBlocked(x, to.z, .5, movementObstacles(x, to.z), 0) &&
            hasLine(new THREE.Vector3(x, 1.4, z), new THREE.Vector3(x, 1.4, to.z), 8))
            placement ??= { x, z };
        }
        if (!placement) throw new Error('Campaign clear close-range placement unavailable');
        actor.position.set(placement.x, 0, placement.z);
        player.position.set(placement.x, 0, placement.z + 1.3);
        player.health = 100; player.dying = player.fatalFall = player.blastReaction = null;
        actor.health = 100; actor.heading = Math.PI; actor.stance = 'standing'; actor.firingPose = null;
        Object.assign(actor.bayonet, createBayonetState());
        actor.blastReaction = null; actor.grenades.ammo = actor.grenades.packs = 0;
        Object.assign(actor.rifle, { action: 'idle', ammo: 5, queuedReload: false, elapsed: 0 });
        stopLocomotion(actor.locomotion);
        for (const key of Object.keys(actor.nativeMotion.posture)) actor.nativeMotion.posture[key] = 0;
        Object.assign(actor.nativeMotion, { speed: 0, weight: 0, bodyLean: 0 });
        actor.traversal.kind = player.traversal.kind = 'grounded'; player.stance = controlPose.stance = 'standing';
        actor.target = player; actor.nextThink = time + 10;
        rememberThreat(actor.tactics, targetAimPoint(player), time, 'person', 'vision', player.id);
        assaultAssignmentAt = time + 10;
        if (mode === 'gate-guard') {
          nanjingCampaign.stage = 'withdrawal';
          updateNanjingMission(0);
          actor.tactics.nanjingRegroup = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
          actor.target = player;
          rememberThreat(actor.tactics, targetAimPoint(player), time, 'person', 'vision', player.id);
        } else if (mode === 'breach') {
          sihangCampaign.northWallBreached = true;
          actor.formation.sihangDemolition = false;
        } else sihangCampaign.northWallBreached = false;
        actor.tactics.sihangCover = null;
        const before = { shots: actor.rifle.shots, health: player.health };
        const samples = [];
        keys.clear(); setGameState('playing');
        for (let frame = 0; frame < 60 && !actor.bayonet.hits; frame++) {
          aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          samples.push({ time, mode: actor.tactics.mode, bayonet: { ...actor.bayonet },
            health: player.health, shots: actor.rifle.shots, distance: actor.position.distanceTo(player.position) });
        }
        setGameState('pause');
        return { mode, before, samples, covering: Boolean(sihangSupportContext),
          shots: actor.rifle.shots, hits: actor.bayonet.hits, health: player.health, fatal: fatalReporter.failed };
      };` });
  });
  await page.goto(new URL(`/?campaign=${campaign}&resources=low-memory`,
    process.env.GAME_URL ?? 'http://127.0.0.1:5353').href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__battle || !document.getElementById('fatal').hidden,
    null, { timeout: 300000 });
  assert.equal(await page.locator('#fatal').isVisible(), false, await page.locator('#fatal-message').textContent());
  await setQualityPreset(page, 'low'); await deployFromMenu(page);
  for (const mode of (campaign === 'sihang' ? ['support', 'breach'] : ['gate-guard'])) {
    const result = await page.evaluate(mode => window.campaignMeleeReview(mode), mode);
    results.push(result);
    await writeFile(join(directory, 'campaign-melee.json'), JSON.stringify({ results, errors }, null, 2));
    assert.ok(result.hits > 0, JSON.stringify({ ...result, samples: result.samples.slice(0, 8) }));
    assert.equal(result.shots, result.before.shots, 'campaign rifle branches cannot fire through melee');
    assert.equal(result.health, 35, 'actual owned bayonet hit applies 65 damage');
    assert.equal(result.fatal, false);
    if (mode === 'support') assert.equal(result.covering, true, 'exercise the sapper-cover campaign branch');
    console.log(`PASS: ${mode} campaign branch yields to a real close-range bayonet hit, without gunfire.`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
