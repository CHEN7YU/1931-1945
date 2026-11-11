import assert from 'node:assert/strict';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';
import { SIHANG_RULES } from '../src/sihang-campaign.js';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'chrome', headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  await page.addInitScript(() => {
    const report = console.error;
    window.__nanGeometries = [];
    console.error = (...args) => {
      report(...args);
      if (String(args[0]).includes('Computed radius is NaN')) {
        window.__nanGeometries.push(args[1]?.uuid);
        report(new Error('NaN geometry call path').stack);
      }
    };
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => {
    if (message.type() === 'error' && /THREE|shader|WebGL|Uncaught|ReferenceError|TypeError/.test(message.text())) {
      errors.push(message.text()); console.error(message.text().slice(0, 1000));
    }
  });
  await page.route('**/api/performance', route => route.abort());
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.retreatReview = {
        restart() { setGameState('menu'); beginMatch(); },
        defenseStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          const formation = formations.find(f => f.id === 'enemy-0');
          const previous = new Set(formation.members.map(a => a.id));
          for (const actor of formation.members) actor.health = 0;
          clearActors(formation.members); enemies = enemies.filter(a => !previous.has(a.id)); rebuildForces();
          const forward = {id:'diagnostic-forward-rally',team:'enemy',kind:'base',permanent:true,
            allowNearbyEnemies:true,x:0,z:-46,altitude:0};
          spawnPoints.push(forward);
          const spawned = spawnFormation(formation);
          spawnPoints = spawnPoints.filter(p => p !== forward);
          const origin = sihangSpawns().find(p => p.id === formation.spawnId);
          if (!spawned || formation.members.some(a => Math.hypot(a.position.x-origin.x,a.position.z-origin.z)>20))
            throw new Error('Japanese reinforcements must ignore a forward rally and use their assigned original spawn');
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of allForces) actor.health = 100000;
          this.originalSappers = enemies.filter(actor => actor.formation.sihangDemolition);
          return this.defenseSnapshot();
        },
        defenseStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && sihangCampaign.stage === 'sihang-defense'; i++) {
            for (const actor of allForces) {
              actor.nextFire = time + 1000000; actor.grenades.ammo = actor.grenades.packs = 0;
            }
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause'); return this.defenseSnapshot();
        },
        defenseSnapshot() {
          return { time, stage: sihangCampaign.stage, breached: sihangCampaign.northWallBreached,
            demolition: sihangCombat.snapshot, charge: {...sihangCampaign.demolition},
            returned: enemies.filter(a => a.tactics.sihangDemolitionReturned).length,
            originalSappers: this.originalSappers?.map(actor => ({ id: actor.id, health: actor.health,
              returned: actor.tactics.sihangDemolitionReturned, position: actor.position.toArray(),
              lastHit: actor.lastHit, registered: entities.soldiers.has(actor.id) })),
            defenders: friendlyAI.filter(a => a.health > 0).map(a => ({ id: a.id, index: a.index,
              formation: a.formation.index, position: a.position.toArray(), duty: a.tactics.sihangDuty,
              mode: a.tactics.mode, mounted: a.emplacementId })),
            sappers: enemies.filter(a => a.formation.sihangDemolition).map(a => ({id:a.id,
              position: a.position.toArray(), heading: a.heading, goal: sihangCombat.goalFor(a, sihangCampaign),
              mode: a.tactics.mode, health:a.health, shield:a.sihangShield?.role,
              path: a.path?.slice(0,3), blocked: a.tactics.blockedBy })),
            spawns: spawnPoints.filter(p => p.team === 'enemy').map(p => ({id:p.id,x:p.x,z:p.z})) };
        },
        assaultStart() {
          for (const actor of enemies) actor.nextFire = time;
          return this.assaultSnapshot();
        },
        assaultStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05) && sihangCampaign.stage === 'sihang-defense'; i++) {
            for (const actor of friendlyForces) actor.nextFire = time + 1000000;
            for (const weapon of entities.weapons.values()) weapon.nextShot = time + 1000000;
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause'); return this.assaultSnapshot();
        },
        assaultSnapshot() {
          return { time, stage: sihangCampaign.stage, point: { owner: objectives[0].owner },
            attackers: enemies.filter(actor => actor.health > 0 && !actor.vehicleId &&
              actor.hasFirearm !== false && !actor.tactics.sihangDemolitionReturned).map(actor => ({
                id: actor.id, position: actor.position.toArray(), mode: actor.tactics.mode,
                shots: actor.rifle.shots, targetFriendly: actor.target?.friendly === true,
                inCapture: objectiveContainsPosition(objectives[0], actor.position) })) };
        },
        geometryErrors() {
          const invalid = [];
          scene.traverse(mesh => {
            if (window.__nanGeometries.includes(mesh.geometry?.uuid))
              invalid.push({ name: mesh.name, parent: mesh.parent?.name,
                geometry: mesh.geometry.type, userData: mesh.userData,
                invalidAttributes: Object.entries(mesh.geometry.attributes).filter(([, attribute]) =>
                  attribute.array.some(value => !Number.isFinite(value))).map(([name]) => name) });
          });
          return invalid;
        },
        engineerStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of enemies) actor.health = 0;
          const engineer = friendlyForces.find(a => a.engineer && !a.playerUnit);
          if (!engineer) throw new Error('Expected an original AI engineer');
          engineer.position.set(18, SIHANG_WAREHOUSE.floorHeight, -31);
          if (!engineerPlacementReason(engineer, { ...engineer.position }))
            throw new Error('Upper-floor engineering was not rejected');
          this.engineerId = engineer.id;
          this.engineerMaterials = JSON.stringify(engineer.engineer.materials);
          operateAIEngineer(engineer, .05);
          if (engineer.tactics.mode !== 'engineer-descend' ||
            pathRequests.get(engineer.tactics.id)?.target.y !== 0 ||
            JSON.stringify(engineer.engineer.materials) !== this.engineerMaterials)
            throw new Error('Upper-floor engineer must request a real descent without spending materials');
          return this.engineerSnapshot();
        },
        engineerStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
            if (engineerWorks.filter(work => work.builderId === this.engineerId).length === 2) break;
          }
          setGameState('pause'); return this.engineerSnapshot();
        },
        engineerSnapshot() {
          const actor = entities.soldiers.get(this.engineerId);
          return { time, id: actor.id, p: actor.position.toArray(), mode: actor.tactics.mode,
            materials: actor.engineer.materials, site: actor.engineer.site, path: actor.path?.slice(0, 3),
            works: engineerWorks.filter(work => work.builderId === actor.id)
              .map(work => ({ id: work.point.id, y: work.point.view.position.y })) };
        },
        capture(eye, target) {
          sihangNight.update(sihangCampaign); world.setNightLighting(sihangNight.snapshot.transition);
          camera.position.set(...eye); camera.lookAt(...target); camera.updateMatrixWorld(true);
          const displayed = allForces.filter(actor => actor.health > 0);
          nraCharacter?.update(displayed.filter(actor => actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          ijaCharacter?.update(displayed.filter(actor => !actor.friendly), time,
            entities.control.soldierId, graphics.snapshot.preset);
          uniformExcludedIds.clear();
          for (const force of [nraCharacter, ijaCharacter])
            for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
          soldierRenderer.update(displayed, graphics.snapshot.preset, time,
            entities.control.soldierId, uniformExcludedIds, true);
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png').split(',')[1];
        },
        boundaryStart() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of friendlyForces) actor.health = 100000;
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return this.boundaryPlace('sihang-cover-gun');
        },
        boundaryPlace(id) {
          const actor = controlledSoldier(entities);
          setGameState('playing');
          releaseEmplacement(actor); keys.clear(); playerInput.clearFire();
          held.primary = held.secondary = held.aiming = false;
          const point = emplacements.get(id);
          const position = point ? emplacementPose(point, 0).operator : { x: 90, y: 0, z: 35 };
          actor.position.set(position.x, position.y, position.z);
          actor.stance = 'standing'; actor.firingPose = null;
          stopLocomotion(actor.locomotion);
          setGameState('playing');
          return this.boundarySnapshot();
        },
        boundaryStep(seconds) {
          for (let i = 0; i < Math.round(seconds / .05); i++) {
            setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          }
          setGameState('pause');
          return this.boundarySnapshot();
        },
        boundaryCrossing() {
          const player = controlledSoldier(entities);
          if (player.sihangEvacuated || sihangCampaign.assemblyReleased)
            throw new Error('Premature crossing must not lock the player out of the assembly');
          player.position.set(56, 0, -25);
          for (const actor of friendlyForces.filter(actor => actor !== player && actor.health > 0)) {
            const goal = sihangActorAssemblyGoal(actor);
            actor.position.set(goal.x, goal.y, goal.z);
            actor.stance = 'crouched';
          }
          updateSihangMission(0);
          const waitedForPlayer = !sihangCampaign.assemblyReleased;
          player.position.set(8, 0, -4);
          setGameState('playing'); aiDecisions.beginFrame(); advanceBattleStep(.05, time);
          if (!sihangCampaign.assemblyReleased) throw new Error('All present soldiers and the returned player must release the assembly');
          const release = { elapsed: sihangCampaign.elapsed, stageElapsed: sihangCampaign.stageElapsed,
            departures: formations.filter(formation => formation.team === 'friendly' && !formation.player)
              .map(formation => ({ slot: formation.sihangSlot, delay: formation.withdrawAt - sihangCampaign.elapsed })) };
          const actor = friendlyAI.find(actor => actor.health > 0 && !actor.sihangEvacuated);
          actor.position.set(90, 0, 35);
          updateSihangMission(.05);
          return { ...this.boundarySnapshot(), waitedForPlayer, release };
        },
        boundarySnapshot() {
          const actor = controlledSoldier(entities);
          sihangNight.update(sihangCampaign);
          return { time, state, controlled: actor.id, position: actor.position.toArray(), traversal: actor.traversal.kind,
            focus: focusEmplacement(actor)?.id ?? null, door: world.doorSystem.focus(camera)?.id ?? null,
            pointerLock: Boolean(document.pointerLockElement), toast: document.getElementById('toast')?.textContent,
            ammo: actor.rifle.ammo,
            grenades: { ammo: actor.grenades.ammo, packs: actor.grenades.packs, action: actor.grenades.action?.phase ?? null },
            mounted: actor.emplacementId ?? null, counterattack: sihangCampaign.counterattack,
            evacuated: Boolean(actor.sihangEvacuated), released: sihangCampaign.assemblyReleased,
            night: sihangNight.snapshot, shells: shells.length, activeGrenades: grenades.active.length,
            enemyAmmo: enemies.filter(actor => actor.health > 0 && !actor.vehicleId).map(actor => [actor.id, actor.rifle.ammo]),
            planes: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.health > 0).length,
            positions: [...emplacements.values()].filter(point => point.retreatCover).map(point =>
              ({ id: point.id, health: point.health, ammo: point.weapon.ammo, operator: point.operatorId,
                position: [point.x, point.altitude, point.z] })) };
        },
        start() {
          setGameState('pause'); missionBriefing.hide(); keys.clear();
          this.exitedIds = new Set(); this.exitRecords = []; this.maximumStatic = 0; this.fadeImage = null;
          for (const formation of formations) formation.respawnEnabled = false;
          for (const actor of enemies) actor.health = 0;
          for (const actor of friendlyForces) actor.health = 100000;
          const player = controlledSoldier(entities);
          player.position.set(8, 0, -4);
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return this.snapshot();
        },
        step(seconds) {
          const started = performance.now(), peaks = [];
          for (let i = 0; i < Math.round(seconds / .05) && !sihangCampaign.outcome; i++) {
            setGameState('playing'); aiDecisions.beginFrame();
            const player = controlledSoldier(entities);
            if (sihangCampaign.assemblyReleased && !player.sihangEvacuated) {
              const goal = sihangRetreatGoal(player);
              if (!player.path?.length) {
                player.path = world.elevatedPath(player.position, goal);
                player.pathGoal = goal;
              }
              walkActor(player, goal, 3.5, .05, true);
            }
            const before = performance.now(); advanceBattleStep(.05, time);
            this.maximumStatic = Math.max(this.maximumStatic, sihangParade.count);
            for (const actor of friendlyForces) if (actor.sihangEvacuationOpacity < 1) {
              if (!this.exitedIds.has(actor.id)) {
                this.exitedIds.add(actor.id);
                this.exitRecords.push({ id: actor.id, position: actor.position.toArray(),
                  slot: actor.sihangParadeSlot, goal: actor.sihangParadeGoal });
              }
              if (!this.fadeImage && actor.sihangEvacuationOpacity >= .35 && actor.sihangEvacuationOpacity <= .6)
                this.fadeImage = this.capture([75, 8, 79], [61, 1, 66]);
            }
            if (performance.now() - before > 50) peaks.push({ time, ms: performance.now() - before });
          }
          setGameState('pause');
          return { ...this.snapshot(), wallMs: performance.now() - started, peaks };
        },
        snapshot() {
          return { fixture: 'full-finite-roster-real-walking-no-enemy-interference', time, stage: sihangCampaign.stage, outcome: sihangCampaign.outcome,
            open: sihangCampaign.playerRetreatOpen, evacuated: sihangCampaign.evacuatedIds.length,
            total: sihangCampaign.retreatTotal, reserve: sihangCampaign.reserve, released: sihangCampaign.assemblyReleased,
            counterattack: sihangCampaign.counterattack, static: sihangParade.count,
            maximumStatic: this.maximumStatic, faded: this.exitedIds?.size ?? 0,
            player: controlledSoldier(entities)?.position.toArray(),
            formations: formations.filter(f => f.team === 'friendly').map(f => ({
              id: f.id, size: f.members.filter(a => a.health > 0 && !a.sihangEvacuated).length,
              generation: f.generation, assembled: f.retreatAssembled, blocked: f.blockedReason,
              respawnAt: f.respawnAt, withdrawAt: f.withdrawAt })),
            navigation: world.navigationStats,
            remaining: friendlyForces.filter(a => a.health > 0 && a.id !== entities.control.soldierId)
              .map(a => ({ id: a.id, index: a.index, p: a.position.toArray(), mode: a.tactics.mode,
                goal: a.pathGoal, path: a.path?.slice(0, 3), reason: a.tactics.pathReason,
                preferredStair: a.tactics.preferredStair, blocked: a.tactics.blockedBy,
                stuck: a.stuckTime, progress: a.tactics.pathProgress,
                assemblyRoute: a.sihangAssemblyRoute, nextPath: a.nextPath,
                request: pathRequests.get(a.tactics.id)?.target, heading: a.heading,
                traffic: a.tactics.traffic, turning: a.turningToPath, stance: a.stance,
                locomotion: a.locomotion, postureReady: postureReady(a), posture: a.nativeMotion?.posture,
                emplacement: a.emplacementId, grounded: a.traversal.kind, paradeGoal: a.sihangParadeGoal,
                assembly: sihangActorAssemblyGoal(a) }))
          };
        }
      };` });
  });
  const url = new URL('/?campaign=sihang&resources=low-memory', process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await (async () => {
    await page.waitForFunction(() => window.retreatReview || !document.getElementById('fatal').hidden,
      null, { timeout: 300000 });
    await deployFromMenu(page);
  })().catch(async error => {
    await writeFile(join(directory, 'deployment-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent(),
      loading: await page.locator('#loading').textContent(),
      body: (await page.locator('body').innerText()).slice(-8000),
      battle: await page.evaluate(() => window.__battle?.state ?? null) }, null, 2));
    throw error;
  });
  await page.waitForFunction(() => window.retreatReview && window.__battle?.state === 'playing' ||
    !document.querySelector('#fatal').hidden,
    null, { timeout: 180000 }).catch(async error => {
    await writeFile(join(directory, 'startup-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent(),
      loading: await page.locator('#loading').textContent(),
      battle: await page.evaluate(() => window.__battle?.state ?? null) }, null, 2));
    throw error;
  });
  if (await page.locator('#fatal').isVisible()) {
    await writeFile(join(directory, 'startup-error.json'), JSON.stringify({ errors,
      fatal: await page.locator('#fatal-message').textContent() }, null, 2));
    throw new Error(await page.locator('#fatal-message').textContent());
  }
  await page.waitForFunction(() => !document.querySelector('#loading') ||
    document.querySelector('#loading').hidden, null, { timeout: 180000 });
  if (process.env.NIGHT_BOUNDARY_REVIEW_ONLY === '1' || process.env.ALL_REVISION_REVIEW === '1') {
    const records = [];
    const image = async (name, eye, target) => {
      const png = await page.evaluate(({eye,target}) => retreatReview.capture(eye,target), {eye,target});
      await writeFile(join(directory, name + '.png'), Buffer.from(png, 'base64'));
    };
    const record = async () => {
      const state = await page.evaluate(() => retreatReview.boundarySnapshot());
      records.push(state);
      await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, records, errors }, null, 2));
      return state;
    };
    const initial = await page.evaluate(() => retreatReview.boundaryStart());
    await image('native-nightfall-start', [15, 5, 5], [-5, 1, -5]);
    const halfway = await page.evaluate(() => retreatReview.boundaryStep(10));
    assert.ok(halfway.night.transition > .4 && halfway.night.transition < .6);
    await image('native-nightfall-halfway', [15, 5, 5], [-5, 1, -5]);
    const regrouped = await page.evaluate(() => retreatReview.boundaryStep(110));
    await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, errors }, null, 2));
    assert.equal(regrouped.counterattack, false);
    assert.deepEqual(regrouped.enemyAmmo, initial.enemyAmmo, 'living ground enemies must hold fire during assembly');
    assert.equal(regrouped.planes, 0, 'surviving aircraft must really leave instead of attacking at night');
    for (const point of initial.positions) {
      await page.evaluate(id => retreatReview.boundaryPlace(id), point.id);
      await page.keyboard.press('f');
      const mounted = await record();
      assert.equal(mounted.mounted, point.id, 'F must enter the actual prepared cover position');
      await page.mouse.move(640, 360);
      await page.mouse.down();
      await page.evaluate(() => retreatReview.boundaryStep(.5));
      await page.mouse.up();
      const fired = await record();
      assert.ok(fired.positions.find(item => item.id === point.id).ammo < point.ammo, 'the real input must fire owned ammunition');
    }
    await page.evaluate(() => retreatReview.boundaryPlace('south'));
    const south = await record();
    await page.keyboard.press('1'); await page.mouse.down();
    await page.evaluate(() => retreatReview.boundaryStep(1)); await page.mouse.up();
    await page.evaluate(() => retreatReview.boundaryPlace('south'));
    await page.keyboard.press('g'); await page.mouse.down();
    await page.evaluate(() => retreatReview.boundaryStep(.5)); await page.mouse.up();
    const held = await record();
    assert.equal(held.ammo, south.ammo); assert.deepEqual(held.grenades, south.grenades);
    assert.equal(held.activeGrenades, south.activeGrenades);
    assert.equal(held.counterattack, false, 'player crossing alone must not start the counterattack');
    const crossing = await page.evaluate(() => retreatReview.boundaryCrossing());
    assert.equal(crossing.counterattack, true);
    assert.equal(crossing.waitedForPlayer, true, 'the assembled survivors must wait for the player to join them');
    assert.equal(crossing.release.departures.length, 5);
    for (const { slot, delay } of crossing.release.departures)
      assert.ok(Math.abs(delay - Math.max(0, SIHANG_RULES.nightfallSeconds - crossing.release.stageElapsed) -
        slot * SIHANG_RULES.waveSpacing) < .001, 'AI departure must wait for full nightfall, then keep the eight-second spacing');
    await page.evaluate(() => retreatReview.boundaryStep(4));
    const lit = await record(); assert.equal(lit.night.visible, 3);
    await image('native-flare-lit', [98, 15, 23], [58, 4, -26]);
    await page.evaluate(() => retreatReview.boundaryStep(23));
    assert.equal((await record()).night.visible, 0);
    await image('native-moonlit-assembly', [15, 5, 5], [-5, 1, -5]);
    await image('native-moonlit-south-bank', [105, 16, 30], [45, 3, 48]);
    await page.evaluate(() => retreatReview.boundaryStep(10));
    assert.equal((await record()).night.visible, 3);
    await writeFile(join(directory, 'boundaries.json'), JSON.stringify({ initial, halfway, regrouped, records, errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log('Native night ceasefire, three cover weapons, aircraft exit and flare cycles passed.');
  }
  if (process.env.NIGHT_BOUNDARY_REVIEW_ONLY !== '1') {
  const restart = async () => {
    await page.evaluate(() => retreatReview.restart());
    await page.waitForFunction(() => document.querySelector('#loading').hidden &&
      window.__battle?.state === 'playing', null, {timeout:180000});
  };
  if (process.env.ALL_REVISION_REVIEW === '1') await restart();
  if (process.env.BATTLE_REVISION_REVIEW === '1') {
    const records = [await page.evaluate(() => retreatReview.defenseStart())];
    for (let i = 0; i < 44 && !records.at(-1).breached; i++) {
      records.push(await page.evaluate(() => retreatReview.defenseStep(5)));
      await writeFile(join(directory, 'defense.json'), JSON.stringify({ fixture: 'native-production-movement-firing-disabled-health-raised',
        records, errors }, null, 2));
      if (i % 5 === 0) console.log(JSON.stringify({time:records.at(-1).time, demolition:records.at(-1).demolition}));
      if (i === 8 || records.at(-1).charge.state === 'installing') {
        const eye = [records.at(-1).demolition.anchor.x + 8, 5, records.at(-1).demolition.anchor.z + 7];
        const target = [records.at(-1).demolition.anchor.x, 1, records.at(-1).demolition.anchor.z];
        const png = await page.evaluate(({eye,target}) => retreatReview.capture(eye,target), {eye,target});
        await writeFile(join(directory, records.at(-1).charge.state === 'installing' ? 'turtle-installing.png' : 'turtle-advance.png'),
          Buffer.from(png, 'base64'));
      }
    }
    assert.ok(records.some(record => record.charge.state === 'installing'), 'actual sappers must reach and install at the wall');
    assert.ok(records.at(-1).breached, 'the real demolition path must complete');
    const roof = records.at(-1).defenders.filter(actor => actor.position[1] > 21);
    assert.ok(roof.some(actor => actor.mounted === 'sihang-roof-aa'), 'assigned gunner must reach and operate rooftop AA');
    for (const seconds of [5, 5, 5, 5, 5, 5, 2]) {
      records.push(await page.evaluate(seconds => retreatReview.defenseStep(seconds), seconds));
    }
    await writeFile(join(directory, 'defense.json'), JSON.stringify({fixture:'native-production-movement-firing-disabled-health-raised',
      records, errors}, null, 2));
    assert.equal(records.at(-1).returned, 20, 'all original sappers must really return instead of being deleted on breach');
    if (process.env.ASSAULT_REVIEW === '1') {
      const assault = [await page.evaluate(() => retreatReview.assaultStart())];
      for (let step = 0; step < 20 && !(assault.at(-1).attackers.some(actor => actor.inCapture) &&
        assault.some(frame => frame.attackers.some(actor => actor.shots > 0 && actor.targetFriendly))); step++) {
        assault.push(await page.evaluate(() => retreatReview.assaultStep(5)));
        await writeFile(join(directory, 'assault.json'), JSON.stringify({
          fixture: 'native-production-assault-defender-and-vehicle-fire-disabled-health-raised', assault, errors }, null, 2));
      }
      assert.ok(assault.some(frame => frame.attackers.some(actor => actor.inCapture)),
        'original rear-spawn infantry must really enter the ground-floor capture area');
      assert.ok(assault.some(frame => frame.attackers.some(actor => actor.shots > 0 && actor.targetFriendly)),
        'assaulting infantry must observe and shoot actual Chinese defenders');
    }
    if (process.env.BATTLE_REVISION_REVIEW_ONLY !== '1') await restart();
  }
  if (process.env.BATTLE_REVISION_REVIEW_ONLY !== '1' && process.env.RETREAT_REVIEW_ONLY !== '1') {
    const frames = [await page.evaluate(() => retreatReview.engineerStart())];
    for (let step = 0; step < 48 && frames.at(-1).works.length < 2; step++) {
      frames.push(await page.evaluate(() => retreatReview.engineerStep(5)));
      await writeFile(join(directory, 'engineer.json'), JSON.stringify({ frames, errors }, null, 2));
    }
    console.log(JSON.stringify(frames.at(-1), null, 2));
    assert.equal(frames.at(-1).works.length, 2, 'the original upstairs engineer must really descend and finish both positions');
    assert.ok(frames.at(-1).works.every(work => Math.abs(work.y) <= .025));
    assert.deepEqual(frames.at(-1).materials, { maxim24: 0, bofors75: 0 });
    assert.deepEqual(errors, []);
  }
  if (process.env.ENGINEER_REVIEW_ONLY !== '1' && process.env.BATTLE_REVISION_REVIEW_ONLY !== '1') {
  const capture = async (name, eye, target) => {
    const png = await page.evaluate(({ eye, target }) => retreatReview.capture(eye, target), { eye, target });
    await writeFile(join(directory, `${name}.png`), Buffer.from(png, 'base64'));
  };
  const frames = [await page.evaluate(() => retreatReview.start())];
  await writeFile(join(directory, 'geometry-errors.json'), JSON.stringify(
    await page.evaluate(() => retreatReview.geometryErrors()), null, 2));
  await capture('night-regroup', [35, 18, 8], [-3, 0, -6]);
  let assemblyCaptured = false, flareCaptured = false;
  const save = async () => {
    await writeFile(join(directory, 'retreat.pending.json'), JSON.stringify({ frames, errors }, null, 2));
    await rename(join(directory, 'retreat.pending.json'), join(directory, 'retreat.json'));
  };
  for (let step = 0; step < 360 && !frames.at(-1).outcome; step++) {
    frames.push(await page.evaluate(() => retreatReview.step(5)));
    if (!assemblyCaptured && frames.at(-1).released) {
      await capture('assembled-withdrawal', [15, 5, 5], [-5, 1, -5]);
      assemblyCaptured = true;
    }
    if (!flareCaptured && frames.at(-1).counterattack) {
      await capture('counterattack-flares', [98, 15, 23], [58, 4, -26]);
      flareCaptured = true;
    }
    await save();
    assert.ok(frames.at(-1).released || step < 60,
      'assembly made no complete progress within the diagnostic window; inspect actual remaining paths');
    if (step % 5 === 0) console.log(JSON.stringify({ time: frames.at(-1).time, remaining: frames.at(-1).remaining.length,
      released: frames.at(-1).released, evacuated: frames.at(-1).evacuated, static: frames.at(-1).static,
      ms: Math.round(frames.at(-1).wallMs) }));
  }
  const last = frames.at(-1);
  await save();
  console.log(JSON.stringify(last, null, 2));
  assert.equal(last.outcome, 'evacuated', 'every original identity must physically reach safety and the parade ground');
  assert.equal(last.evacuated, last.total);
  assert.equal(last.static, Math.min(40, last.total - 1), 'only forty evacuees remain in the environmental formation');
  assert.equal(last.reserve, 0);
  assert.equal(last.remaining.length, 0);
  assert.equal(last.maximumStatic, Math.min(40, last.total - 1));
  assert.equal(last.faded, Math.max(0, last.total - 41));
  const exits = await page.evaluate(() => ({ records: retreatReview.exitRecords, image: retreatReview.fadeImage }));
  assert.ok(exits.records.every(actor => actor.position[2] > 72 && actor.slot >= 40 && actor.goal.exit));
  await writeFile(join(directory, 'exits.json'), JSON.stringify(exits.records, null, 2));
  assert.ok(exits.image, 'the real renderer must display an evacuee during the two-second fade');
  await writeFile(join(directory, 'native-evacuee-fade.png'), Buffer.from(exits.image, 'base64'));
  assert.deepEqual(errors, []);
  await capture('south-bank-formation', [91, 13, 30], [67, 1, 53]);
  }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
