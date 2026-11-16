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
      window.gunnerTakeoverReview = {
        setup() {
          missionBriefing.hide();
          simulationClock.setActive(false, performance.now());
          const actor = friendlyAI.find(item => item.health > 0 && !item.vehicleId && !item.grenades.action);
          const gun = [...emplacements.values()].find(point => point.profile === 'maxim24' && point.health > 0 &&
            !point.operatorId && !point.crewId && !point.retreatCover);
          if (!actor || !gun || !occupyEmplacement(gun, actor) || actor.emplacementId !== gun.id)
            throw new Error('Could not establish a real friendly gunner fixture');
          this.actor = actor; this.gun = gun;
          gun.weapon.nextShot = 0;
          for (const other of friendlyForces) if (other !== actor) other.health = 0;
          sihangCampaign.reserve = 0;
          showOverlay('dead');
          return this.snapshot();
        },
        snapshot() {
          return { state, actor: this.actor.id, controlled: entities.control.soldierId,
            gun: this.gun.id, operator: this.gun.operatorId, owner: this.gun.weapon.ownerId,
            ammo: this.gun.weapon.ammo, shots: this.gun.shots,
            emplacementId: this.actor.emplacementId,
            playerUnit: this.actor.playerUnit,
            disabled: $('takeover-sihang-squad').disabled,
            hidden: $('takeover-sihang-squad').hidden };
        },
        preferFoot() {
          const other = friendlyAI.find(item => item !== this.actor && item.formation !== this.actor.formation &&
            !item.vehicleId && !item.emplacementId && !item.grenades.action && !item.dying &&
            !item.fatalFall && !item.blastReaction);
          if (!other) throw new Error('Expected a separate unmounted friendly');
          other.health = 100;
          try { return { expected: other.id, selected: sihangTakeoverCandidate()?.selected.id }; }
          finally { other.health = 0; }
        },
        step() {
          for (const actor of enemies) actor.nextFire = time + 100000;
          aiDecisions.beginFrame();
          advanceBattleStep(.05, time + .05);
          return this.snapshot();
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const before = await page.evaluate(() => gunnerTakeoverReview.setup());
  assert.equal(before.state, 'dead');
  assert.equal(before.operator, before.actor);
  assert.equal(before.disabled, false, 'the last living friendly gunner must remain available for takeover');
  assert.equal(before.hidden, false);
  const preferred = await page.evaluate(() => gunnerTakeoverReview.preferFoot());
  assert.equal(preferred.selected, preferred.expected, 'an available foot soldier is preferred over a gunner');
  await page.locator('#takeover-sihang-squad').click();
  const taken = await page.evaluate(() => gunnerTakeoverReview.snapshot());
  assert.equal(taken.state, 'playing');
  assert.equal(taken.controlled, before.actor);
  assert.equal(taken.playerUnit, true);
  assert.equal(taken.emplacementId, before.gun);
  assert.equal(taken.operator, before.actor);
  assert.equal(taken.owner, before.actor);
  assert.equal(taken.ammo, before.ammo);
  assert.equal(taken.shots, before.shots);
  await page.mouse.down();
  const fired = await page.evaluate(() => gunnerTakeoverReview.step());
  await page.mouse.up();
  assert.equal(fired.shots, before.shots + 1, 'the controlled gunner must be able to fire the owned weapon');
  assert.equal(fired.ammo, before.ammo - 1);
  await page.keyboard.press('f');
  const left = await page.evaluate(() => gunnerTakeoverReview.snapshot());
  assert.equal(left.emplacementId, null);
  assert.equal(left.operator, null);
  assert.equal(left.owner, before.gun);
  assert.equal(left.ammo, fired.ammo);
  assert.deepEqual(errors, []);
  console.log('Artificial last-gunner fixture: takeover preserves the gun, fires once and F exits normally.');
} finally {
  await browser.close();
}
