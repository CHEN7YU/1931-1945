import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/\/src\/main\.js(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}
window.__tankInfantryFixture = {
  dodge(team, vehicleTeam) {
    const tank = [...entities.vehicles.values()].find(vehicle => vehicle.team === vehicleTeam && vehicle.type === 'tank' && vehicle.health > 0);
    const actor = allForces.find(person => person.team === team && person.health > 0 && !person.vehicleId &&
      person.groundType === 'infantry' && person !== controlledSoldier(entities));
    const tankPosition = tank.position.clone(), position = actor.position.clone();
    let staging = null;
    for (let z = -64; z <= 64 && !staging; z += 8) for (let x = -80; x <= 80 && !staging; x += 8) {
      if (!circleBlocked(x, z, 3.3, world.obstacles) &&
        !circleBlocked(x, z - 5, 4, world.obstacles)) staging = { x, z };
    }
    if (!staging) throw new Error('No safe evasion fixture location exists');
    tank.position.set(staging.x, world.groundHeight(staging.x, staging.z), staging.z); tank.heading = 0;
    tank.groundMotion = { x: 0, z: -4, turn: 0 };
    actor.position.set(staging.x, world.groundHeight(staging.x, staging.z - 5), staging.z - 5);
    actor.stance = 'standing'; actor.firingPose = null;
    time += .05; setGameState('playing');
    movementCollision.beginStablePass();
    try { updateAI(.05); } finally { movementCollision.endStablePass(); }
    const result = { team, vehicleTeam, mode: actor.tactics.mode, moved: Math.hypot(
      actor.position.x - staging.x, actor.position.z - (staging.z - 5)) };
    actor.position.copy(position); tank.position.copy(tankPosition);
    tank.groundMotion = { x: 0, z: 0, turn: 0 };
    setGameState('pause');
    return result;
  },
  crush(enabled) {
    const tank = [...entities.vehicles.values()].find(vehicle => vehicle.team === 'friendly' && vehicle.type === 'tank');
    const targets = ['friendly', 'enemy'].map(team => allForces.find(actor => actor.team === team &&
      actor.health > 0 && !actor.vehicleId && actor !== controlledSoldier(entities)));
    const saved = tank.position.clone();
    for (let index = 0; index < targets.length; index++) targets[index].position.set(-88, 0, 76 - index);
    tank.heading = 0; tank.position.set(-88, 0, 73);
    setGameState('playing');
    updateTankContacts(new Map([[tank.id, { x: -88, y: 0, z: 80, heading: 0 }]]), 1);
    setGameState('pause');
    const result = targets.map(actor => ({ team: actor.team, health: actor.health,
      cause: actor.deathSource?.cause, sourceTeam: actor.deathSource?.team }));
    tank.position.copy(saved);
    return { enabled: preferenceValues.tankCrushing, result };
  },
  pack(team) {
    const tank = [...entities.vehicles.values()].find(vehicle => vehicle.team !== team && vehicle.type === 'tank' && vehicle.health > 0);
    const actor = allForces.find(person => person.team === team && person.health > 0 && !person.vehicleId &&
      person.groundType === 'infantry' && person.grenades.packs && person !== controlledSoldier(entities));
    if (!tank || !actor) throw new Error('Anti-tank integration requires a registered opposing tank and infantryman');
    let staging = null;
    for (let z = -88; z <= 76 && !staging; z += 8) for (let x = -88; x <= 88 && !staging; x += 8) {
      if (circleBlocked(x, z, 3.3, world.obstacles) || circleBlocked(x, z + 12, .5, world.obstacles) ||
        circleBlocked(x, z + 24, .5, world.obstacles)) continue;
      if (allForces.some(other => other !== actor && !other.vehicleId && other.health > 0 &&
        Math.hypot(other.position.x - x, other.position.z - z) < 10)) continue;
      const start = new THREE.Vector3(x, world.groundHeight(x, z + 12) + 1.5, z + 12);
      if (!hasLine(start, new THREE.Vector3(x, world.groundHeight(x, z) + 1, z), 30, tank.id)) continue;
      const far = new THREE.Vector3(x, world.groundHeight(x, z + 24) + 1.5, z + 24);
      if (!hasLine(far, new THREE.Vector3(x, world.groundHeight(x, z) + 1, z), 30, tank.id)) continue;
      staging = { x, z };
    }
    if (!staging) throw new Error('No safe isolated physical throw fixture location exists');
    tank.position.set(staging.x, world.groundHeight(staging.x, staging.z), staging.z); tank.heading = 0;
    actor.position.set(staging.x, world.groundHeight(staging.x, staging.z + 12), staging.z + 12);
    actor.heading = 0; actor.stance = 'standing'; actor.firingPose = null; actor.weaponBlocked = false;
    Object.assign(actor.nativeMotion, { bodyLean: 0, weight: 0, speed: 0, cheekWeight: 0, lowReady: 1,
      posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, 0])),
      position: { x: actor.position.x, z: actor.position.z } });
    actor.bayonet.mode = 'idle'; if (actor.dadao) stowDadao(actor.dadao);
    actor.tactics.throwIntent = null; actor.tactics.throwDecisionAt = 0; actor.tactics.seenArmor = null;
    setGameState('playing');
    const nearPosition = actor.position.clone();
    actor.position.z = tank.position.z + 24;
    actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
    const approaching = tryAIThrowable(actor, null, .05) && actor.tactics.mode === 'approach-armor-pack';
    const approachGoal = actor.tactics.packApproach;
    actor.position.copy(nearPosition); actor.nativeMotion.position = { x: actor.position.x, z: actor.position.z };
    actor.tactics.packApproach = null; actor.tactics.throwDecisionAt = 0;
    const started = tryAIThrowable(actor, null, .05);
    const action = actor.grenades.action;
    const scheduled = action?.aiTargetId === tank.id && action.kind === 'explosive-pack';
    const before = tank.health, sourceId = actor.id;
    for (let frame = 0; frame < 750; frame++) { time += 1 / 120; updateGrenades(1 / 120); }
    setGameState('pause');
    return { team, approaching, approachGoal, started, scheduled, stock: actor.grenades.packs, tankBefore: before, tankAfter: tank.health,
      sourceId, throws: grenades.history.filter(event => event.type === 'throw' && event.source?.soldierId === sourceId) };
  }
};` });
  });
  await page.goto(process.env.GAME_URL ?? 'http://127.0.0.1:5203', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('#confirm-campaign').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('#confirm-campaign').click();
  await page.locator('#redeploy-choices [data-type="tank"]').click();
  await page.waitForFunction(() => !document.getElementById('confirm-deploy').disabled);
  await page.locator('#confirm-deploy').click();
  await page.waitForFunction(() => window.__battle?.state === 'playing' || !document.getElementById('fatal').hidden,
    null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__battle?.state), 'playing', errors.join('\n'));
  await page.keyboard.press('Escape');
  await page.locator('#pause-settings > summary').click();
  assert.equal(await page.locator('#tank-crushing').isChecked(), true);
  await page.locator('#tank-crushing').uncheck();
  const disabled = await page.evaluate(() => window.__tankInfantryFixture.crush(false));
  assert.equal(disabled.enabled, false);
  assert.ok(disabled.result.every(actor => actor.health === 100));
  await page.locator('#tank-crushing').check();
  const enabled = await page.evaluate(() => window.__tankInfantryFixture.crush(true));
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.result.every(actor => actor.health === 0 && actor.cause === 'tank-crush' && actor.sourceTeam === 'friendly'));
  const packs = [];
  const evasions = [];
  for (const team of ['friendly', 'enemy']) for (const vehicleTeam of ['friendly', 'enemy']) {
    const result = await page.evaluate(({ team, vehicleTeam }) => window.__tankInfantryFixture.dodge(team, vehicleTeam),
      { team, vehicleTeam });
    assert.equal(result.mode, 'evade-tank', JSON.stringify(result));
    assert.ok(result.moved > 0);
    evasions.push(result);
  }
  for (const team of ['friendly', 'enemy']) {
    const result = await page.evaluate(team => window.__tankInfantryFixture.pack(team), team);
    assert.equal(result.started, true, JSON.stringify(result));
    assert.equal(result.approaching, true, JSON.stringify(result));
    assert.equal(result.scheduled, true, JSON.stringify(result));
    assert.equal(result.stock, 0);
    assert.ok(result.tankAfter < result.tankBefore, JSON.stringify(result));
    assert.equal(result.throws.length, 1);
    packs.push(result);
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'tank-infantry.json'), JSON.stringify({ passed: true, disabled, enabled, evasions, packs, errors,
    fixture: 'Browser-only controlled tank movement and registered soldier placement. Damage, owned stock, timed flight/blast and new settings use production code. Not natural battlefield survival or performance acceptance.' }, null, 2));
  console.log(JSON.stringify({ passed: true, crushingBothTeams: true, evasions: evasions.length, toggle: true,
    actualTimedPackHits: packs.map(item => ({ team: item.team, damage: item.tankBefore - item.tankAfter })) }));
} finally { await browser.close(); }
