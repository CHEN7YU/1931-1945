import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [], directory = process.env.ARTIFACT_DIR;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
async function waitSeconds(seconds) {
  const before = (await snapshot()).time;
  await page.waitForFunction(({ before, seconds }) => window.__battle.time >= before + seconds, { before, seconds });
}
async function lookAt(x, z) {
  await page.mouse.down({ button: 'right' });
  await page.evaluate(({ x, z }) => {
    const data = window.__battle, yaw = Math.atan2(data.position.x - x, data.position.z - z);
    const delta = Math.atan2(Math.sin(yaw - data.look.yaw), Math.cos(yaw - data.look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .0022, movementY: data.look.pitch / .0022 }));
  }, { x, z });
  await page.mouse.up({ button: 'right' });
}
async function load(scenario, squad = null) {
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5187');
  url.searchParams.set('benchmark', scenario); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  if (squad) await page.locator(`#squad-choices [data-type="${squad}"]`).click();
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.state === 'playing');
}
try {
  if (directory) await mkdir(directory, { recursive: true });
  await load('interior');
  assert.ok((await snapshot()).allies.every(actor => actor.dadao?.id === `${actor.id}:dadao`));
  await page.keyboard.press('3'); await waitSeconds(.5);
  let data = await snapshot();
  assert.equal(data.dadao.phase, 'ready'); assert.equal(data.dadao.viewVisible, true);
  assert.equal(data.dadao.handSource, 'nra-authorized-skinned-hand');
  assert.ok(data.dadao.arm.reachable && data.dadao.arm.error < 1e-6);
  assert.equal(data.rifle.model, null);
  assert.equal(await page.locator('[data-equipment-slot="3"]').getAttribute('aria-current'), 'true');
  if (directory) await page.screenshot({ path: join(directory, 'dadao-ready.png') });
  const rifle = { ammo: data.rifle.ammo, shots: data.rifle.shots };
  await page.mouse.click(720, 450);
  await page.waitForFunction(() => window.__battle.dadao.phase === 'windup');
  if (directory) await page.screenshot({ path: join(directory, 'dadao-windup.png') });
  await waitSeconds(1);
  data = await snapshot();
  assert.equal(data.dadao.swings, 1); assert.equal(data.dadao.hits, 0);
  assert.deepEqual({ ammo: data.rifle.ammo, shots: data.rifle.shots }, rifle);
  await page.mouse.down(); await waitSeconds(1.3); await page.mouse.up();
  assert.equal((await snapshot()).dadao.swings, 2, 'holding the button does not auto-repeat or fire the rifle');
  await page.keyboard.press('6'); assert.equal((await snapshot()).controlSimulation.dadaoEquipped, true);
  assert.match(await page.locator('#toast').textContent(), /TNT/);
  await page.keyboard.press('5');
  assert.equal((await snapshot()).grenades.selected, 'grenade');
  assert.equal((await snapshot()).dadao.equipped, false);
  await page.keyboard.press('5');
  assert.equal((await snapshot()).grenades.selected, 'explosive-pack');
  assert.equal(await page.locator('[data-equipment-slot="5"]').getAttribute('aria-current'), 'true');
  await page.keyboard.press('3'); await waitSeconds(.5);
  await page.mouse.click(720, 450);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__battle.state === 'pause' && !window.__battle.dadao.viewVisible);
  const paused = await snapshot(); await page.waitForTimeout(300);
  assert.deepEqual((await snapshot()).dadao, paused.dadao);
  await page.locator('#resume').click();
  await page.keyboard.press('y');
  assert.equal((await snapshot()).dadao.equipped, false);
  assert.equal((await snapshot()).dadao.startedAt, null);
  await page.keyboard.press('3'); await waitSeconds(.5);
  assert.equal((await snapshot()).dadao.viewVisible, true);
  await page.keyboard.press('1');
  assert.ok((await snapshot()).rifle.model);
  await waitSeconds(.4);
  const shotsBefore = (await snapshot()).rifle.shots;
  await page.mouse.down();
  await page.waitForFunction(shots => window.__battle.rifle.shots > shots, shotsBefore);
  await page.mouse.up();
  await page.keyboard.press('r');
  await page.keyboard.press('3'); await waitSeconds(.5);
  const stowedRifle = (await snapshot()).rifle;
  await waitSeconds(.5);
  assert.equal((await snapshot()).rifle.elapsed, stowedRifle.elapsed, 'drawing the sword freezes the owned rifle action without refilling ammunition');
  assert.equal((await snapshot()).rifle.ammo, stowedRifle.ammo);
  await page.keyboard.press('1');
  await page.waitForFunction(() => window.__battle.rifle.action === 'idle');
  await page.keyboard.press('Escape'); await page.locator('#back-menu').click(); await page.locator('#deploy').click();
  assert.ok((await snapshot()).allies.every(actor => actor.dadao.swings === 0 && !actor.dadao.equipped));
  observations.push({ stage: 'equipment, animation, no gunfire, single-click, pause, takeover, restart', passed: true });

  await load('control', 'tank');
  // 3 must not draw a sword in a closed vehicle.
  assert.ok((await snapshot()).controlInput.owner.vehicleId);
  await page.keyboard.press('3');
  assert.equal((await snapshot()).dadao.equipped, false);
  await page.keyboard.press('f');
  assert.equal((await snapshot()).controlInput.owner.vehicleId, null);
  await page.keyboard.press('3'); await waitSeconds(.5);
  assert.equal((await snapshot()).dadao.viewVisible, true);
  await page.keyboard.press('y');
  assert.equal((await snapshot()).dadao.equipped, false);
  observations.push({ stage: 'closed armor blocks sword use; dismounted crew can draw; seat takeover clears the old equipment', passed: true });

  await load('duel');
  await page.keyboard.press('3'); await waitSeconds(.5);
  const deadline = Date.now() + 45000;
  let landed = false, swungAt = -10, rifleShotsAtDraw = (await snapshot()).rifle.shots;
  while (Date.now() < deadline) {
    data = await snapshot();
    if (data.state === 'transferring') {
      await page.keyboard.up('w'); await page.keyboard.up('Shift');
      await page.waitForFunction(() => window.__battle.state !== 'transferring');
      if ((await snapshot()).state !== 'playing') break;
      await page.keyboard.press('3'); await waitSeconds(.5);
      rifleShotsAtDraw = (await snapshot()).rifle.shots;
      swungAt = -10;
      continue;
    }
    if (data.state !== 'playing') break;
    const enemies = data.enemyPositions.filter(actor => actor.health > 0)
      .sort((a, b) => Math.hypot(a.x - data.position.x, a.z - data.position.z) - Math.hypot(b.x - data.position.x, b.z - data.position.z));
    const target = enemies[0];
    if (!target) break;
    // Keep to the open main street before turning toward an enemy, not straight through shop walls.
    const approaching = data.position.z > 27;
    await lookAt(approaching ? 0 : target.x, approaching ? 20 : target.z);
    const distance = Math.hypot(target.x - data.position.x, target.z - data.position.z);
    if (distance > 1.4) await page.keyboard.down('w');
    else await page.keyboard.up('w');
    if (approaching) await page.keyboard.down('Shift');
    else await page.keyboard.up('Shift');
    if (distance < 3.2 && data.time - swungAt > 1) {
      await page.mouse.click(720, 450); swungAt = data.time;
    }
    data = await snapshot();
    observations.push({ time: data.time, position: data.position, target: { id: target.soldierId, x: target.x, z: target.z, distance },
      dadao: data.dadao, health: data.health });
    const kill = data.combatEvents.history.find(event => event.type === 'casualty' && event.source.weaponClass === 'melee');
    if (kill) {
      landed = true;
      assert.equal(kill.source.weaponId, `${kill.source.soldierId}:dadao`);
      assert.ok(!data.enemyPositions.some(actor => actor.soldierId === kill.target.id), 'the casualty is absent from the living enemy list');
      assert.ok(data.squadScores.some(row => row.kills.melee > 0));
      assert.equal(data.rifle.shots, rifleShotsAtDraw);
      if (directory) await page.screenshot({ path: join(directory, 'dadao-combat.png') });
      break;
    }
    await page.waitForTimeout(40);
  }
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  assert.ok(landed, `an actual player swing must kill a real enemy through ordinary inputs; final state ${data.state}`);
  assert.deepEqual(errors, []);
  console.log('PASS: default owned swords, actual 3/5/6 controls, visible draw/swing, no gunfire, pause, Y, restart, real enemy melee casualty and separate kill credit.');
} finally {
  try {
    const final = await snapshot();
    observations.push({ stage: 'final', state: final.state, rifle: final.rifle, dadao: final.dadao,
      toast: await page.locator('#toast').textContent() });
    if (directory) await writeFile(join(directory, 'dadao-observations.json'), JSON.stringify({ errors, observations }, null, 2));
  } finally { await browser.close(); }
}
