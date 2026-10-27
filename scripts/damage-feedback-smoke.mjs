import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(20000);
const errors = [], observations = [];
let stage = 'loading';
const watchdog = setTimeout(() => { console.error(`Damage feedback test timed out at ${stage}`); void browser.close(); }, 90000);
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
try {
  const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
  url.searchParams.set('benchmark', 'duel'); url.searchParams.set('seed', '1938');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  assert.equal((await snapshot()).benchmark?.scenario, 'duel');
  await page.locator('#deploy').click();
  await page.mouse.down({ button: 'right' });
  await page.waitForFunction(() => window.__battle.fov < 49);
  stage = 'owned rifle hit through normal input';
  const hit = await page.evaluate(() => new Promise((resolve, reject) => {
    const before = window.__battle;
    const target = [...before.enemyPositions].sort((a, b) => Math.abs(a.x) - Math.abs(b.x))[0];
    if (!target) { reject(new Error('No living enemy in the registered firefight')); return; }
    const dx = before.position.x - target.x, dz = before.position.z - target.z;
    const yaw = Math.atan2(dx, dz), pitch = Math.atan2(1.2 - before.locomotion.cameraHeight, Math.hypot(dx, dz));
    const delta = Math.atan2(Math.sin(yaw - before.look.yaw), Math.cos(yaw - before.look.yaw));
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: -delta / .00132, movementY: -(pitch - before.look.pitch) / .00132 }));
    const deadline = setTimeout(() => reject(new Error('No actual rifle damage within 10s')), 10000);
    const observe = () => {
      const data = window.__battle;
      const event = data.combatEvents.history.find(event => event.type === 'damage' &&
        event.source.soldierId === before.control.soldierId && event.target.team === 'enemy');
      if (event) {
        clearTimeout(deadline);
        document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
        document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
        document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
        resolve({ before: { control: before.control, weaponId: before.rifle.id, target, targets: before.enemyPositions }, damage: event, data });
      } else requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
    document.querySelector('#world').dispatchEvent(new MouseEvent('mousedown', { button: 0 }));
  }));
  assert.equal(hit.damage.target.id, hit.data.rifle.trace.targetId, 'the nearest actual body intersection, not an intended target behind it, owns the damage');
  assert.equal(hit.damage.hitZone, hit.data.rifle.trace.hitZone);
  const victim = hit.before.targets.find(actor => `soldier-${actor.id}` === hit.damage.target.id);
  assert.ok(victim);
  assert.ok(['head', 'torso', 'limb'].includes(hit.damage.hitZone));
  assert.equal(hit.damage.amount, Math.min(victim.health, hit.damage.hitZone === 'limb' ? 40 : 100));
  assert.equal(hit.damage.health, Math.max(0, victim.health - hit.damage.amount));
  assert.equal(hit.data.ammo, 4);
  assert.equal(hit.data.combatFeedback.markerVisible, true);
  assert.deepEqual(hit.data.combatFeedback.markerSource, { soldierId: hit.before.control.soldierId, weaponId: hit.before.weaponId });
  assert.equal(await page.locator('#hit-marker').evaluate(element => element.style.opacity), '1');
  const paused = await snapshot();
  await page.waitForTimeout(200);
  assert.equal((await snapshot()).time, paused.time);
  assert.deepEqual((await snapshot()).combatFeedback, paused.combatFeedback);
  observations.push({ stage, damage: hit.damage, control: hit.before.control, feedback: hit.data.combatFeedback });

  stage = 'takeover clears the previous soldier hit feedback';
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => {
    document.querySelector('#resume').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyY' }));
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyY' }));
  });
  let data = await snapshot();
  assert.notEqual(data.control.soldierId, hit.before.control.soldierId);
  assert.equal(data.combatFeedback.markerVisible, false);
  assert.equal(data.combatFeedback.markerSource, null);
  assert.equal(await page.locator('#hit-marker').evaluate(element => element.style.opacity), '0');

  stage = 'real casualty preserves immediate simulation score and original feed credit';
  const casualtyHandle = await page.waitForFunction(() => {
    const data = window.__battle, event = data.combatEvents.history.find(event => event.type === 'casualty');
    if (!event) return false;
    if (['playing', 'transferring'].includes(data.state)) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Escape' }));
    }
    return { data, event };
  });
  const casualty = await casualtyHandle.jsonValue(); await casualtyHandle.dispose();
  const enemyDeaths = casualty.data.combatEvents.history.filter(event => event.type === 'casualty' && event.target.team === 'enemy');
  assert.equal(casualty.data.kills, hit.damage.health === 0 ? 1 : 0, 'HUD consumption cannot add kills beyond the one actual player shot');
  assert.equal(casualty.data.teamKills, enemyDeaths.filter(event => event.source.credit === 'ally').length);
  assert.equal(casualty.data.combatFeedback.markerVisible, false, 'a new controller does not claim the previous shot or an AI kill');
  if (casualty.event.target.team === 'enemy') {
    assert.ok(casualty.data.combatFeedback.feed.some(entry => entry.targetId === casualty.event.target.id));
  }
  observations.push({ stage, event: casualty.event, kills: casualty.data.kills, teamKills: casualty.data.teamKills,
    control: casualty.data.control, feedback: casualty.data.combatFeedback });
  await page.locator('#back-menu').click();
  data = await snapshot();
  assert.equal(data.combatFeedback.flash, 0);
  assert.equal(data.combatFeedback.markerVisible, false);
  assert.deepEqual(data.combatFeedback.feed, []);
  assert.deepEqual(data.combatEvents.history, []);
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) {
    await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
    await writeFile(join(process.env.ARTIFACT_DIR, 'damage-feedback-observations.json'), JSON.stringify(observations, null, 2));
  }
  console.log('PASS: actual owned rifle damage, current-gun hit marker, pause freeze, immediate Y cleanup, real casualty/score credit and cross-battle HUD cleanup.');
} catch (error) {
  const data = await snapshot();
  console.error(JSON.stringify({ stage, state: data?.state, control: data?.control, health: data?.health,
    feedback: data?.combatFeedback, events: data?.combatEvents, errors }));
  throw error;
} finally {
  clearTimeout(watchdog);
  await browser.close();
}
