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
      window.reserveReview = {
        start() {
          missionBriefing.hide();
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          sihangCampaign.reserve = sihangCampaign.retreatReserve = 1;
          for (const actor of allies) actor.health = 0;
          showOverlay('dead');
          return this.snapshot();
        },
        consume() {
          const formation = formations.find(item => item.team === 'friendly' && !item.player && !item.members.length);
          if (!formation || !spawnFormation(formation)) throw new Error('Could not spawn the last AI soldier: ' + formation?.blockedReason);
          return { reserve: sihangCampaign.reserve, ids: formation.members.map(actor => actor.id) };
        },
        prepareTakeover() {
          if (!sihangCampaign.withdrawalWave) {
            sihangCampaign.assemblyReleased = true;
            const units = formations.filter(unit => unit.team === 'friendly' && !unit.player)
              .sort((a, b) => a.sihangSlot - b.sihangSlot);
            startSihangWithdrawalWave(sihangCampaign, units.map(unit => unit.members
              .filter(actor => actor.health > 0).map(actor => actor.id)));
          }
          const initial = sihangTakeoverCandidate();
          if (!initial || initial.members.length < 2) throw new Error('Expected an AI squad with another rifleman');
          const child = initial.members.find(member => member.role === 'rifleman' && member !== initial.selected);
          if (!child) throw new Error('Expected a separate ordinary rifleman for the takeover boundary');
          child.youngSoldier = true; this.child = child;
          const throwing = initial.members.find(member => member !== child && member !== initial.selected &&
            !member.grenades.action && member.grenades.ammo > 0);
          if (!throwing) throw new Error('Expected a separate soldier with a grenade');
          const reason = grenades.begin(throwing.id, throwing.grenades,
            captureAttackSource(entities, throwing, throwing.rifle), time);
          if (reason) throw new Error('Could not start real grenade action: ' + reason);
          this.throwing = throwing; this.throwingAction = throwing.grenades.action;
          const candidate = sihangTakeoverCandidate();
          if (!candidate) throw new Error('Expected living AI takeover candidate');
          const actor = candidate.selected;
          actor.rifle.ammo = 2; actor.rifle.reserve = 13;
          actor.grenades.ammo = 0; actor.grenades.packs = 0;
          this.candidate = candidate;
          return { id: actor.id, childId: child.id, throwingId: throwing.id, members: candidate.members.map(member => member.id),
            position: actor.position.toArray(), reserve: sihangCampaign.reserve,
            deployed: sihangCampaign.deployed, retreatIds: [...sihangCampaign.retreatIds],
            ammo: actor.rifle.ammo, rifleReserve: actor.rifle.reserve, grenades: actor.grenades.ammo,
            packs: actor.grenades.packs, wave: structuredClone(sihangCampaign.withdrawalWave) };
        },
        afterTakeover() {
          const actor = controlledSoldier(entities), candidate = this.candidate;
          return { state, id: actor.id, members: allies.map(member => member.id),
            position: actor.position.toArray(), reserve: sihangCampaign.reserve,
            deployed: sihangCampaign.deployed, retreatIds: [...sihangCampaign.retreatIds],
            aiRetreatIds: [...sihangCampaign.aiRetreatIds],
            ammo: actor.rifle.ammo, rifleReserve: actor.rifle.reserve, grenades: actor.grenades.ammo,
            packs: actor.grenades.packs,
            retained: candidate.members.every(member => entities.soldiers.get(member.id) === member &&
              member.playerUnit && member.formation === formations.find(unit => unit.player) &&
              !friendlyAI.includes(member)),
            sourceEmpty: candidate.members.every(member => !candidate.formation.members.includes(member)),
            childRetained: friendlyAI.includes(this.child) && candidate.formation.members.includes(this.child) &&
              !this.child.playerUnit && sihangCampaign.aiRetreatIds.includes(this.child.id),
            throwerRetained: friendlyAI.includes(this.throwing) && candidate.formation.members.includes(this.throwing) &&
              !this.throwing.playerUnit && sihangCampaign.aiRetreatIds.includes(this.throwing.id) &&
              this.throwing.grenades.action === this.throwingAction && !this.throwingAction.releaseRequested,
            wave: structuredClone(sihangCampaign.withdrawalWave) };
        },
        endThrowFixture() { grenades.interrupt(this.throwing.id); this.throwing.health = 0; },
        step() {
          for (const actor of enemies) actor.nextFire = time + 100000;
          for (let i = 0; i < 10; i++) { aiDecisions.beginFrame(); advanceBattleStep(.05, time + .05); }
          return { state, id: controlledSoldier(entities).id, ids: allies.map(actor => actor.id) };
        },
        blockCandidates() {
          this.blocked = friendlyAI.filter(actor => actor.health > 0).map(actor => [actor, actor.vehicleId]);
          for (const [actor] of this.blocked) actor.vehicleId = 'review-unavailable';
          refreshDeployment();
          return this.snapshot();
        },
        unblockCandidates() {
          for (const [actor, vehicleId] of this.blocked) actor.vehicleId = vehicleId;
          refreshDeployment();
        },
        selectedDuringThrow() {
          const candidate = sihangTakeoverCandidate(), actor = candidate.selected, action = actor.grenades.action;
          actor.grenades.action = { phase: 'preparing' };
          try {
            const next = sihangTakeoverCandidate();
            return { throwing: actor.id, selected: next?.selected.id, members: next?.members.map(member => member.id) };
          }
          finally { actor.grenades.action = action; }
        },
        killTransferred() {
          for (const actor of allies) actor.health = 0;
          updateSihangMission(.05);
          showOverlay('dead');
          return this.prepareTakeover();
        },
        finish() {
          const player = controlledSoldier(entities), child = this.child;
          if (!friendlyAI.includes(child) || !sihangCampaign.aiRetreatIds.includes(child.id))
            throw new Error('Expected the excluded child to remain in the AI retreat');
          for (const actor of friendlyForces) if (actor !== player && actor !== child) actor.health = 0;
          sihangCampaign.retreatTotal = sihangCampaign.retreatIds.length + sihangCampaign.retreatReserve;
          player.position.set(80, 0, 15);
          updateSihangMission(.05);
          const playerCrossing = { saved: sihangCampaign.evacuatedIds.includes(player.id),
            counterattack: sihangCampaign.counterattack, outcome: sihangCampaign.outcome };
          child.position.set(80, 0, 15);
          updateSihangMission(.05);
          const aiCrossing = { saved: sihangCampaign.evacuatedIds.includes(child.id),
            counterattack: sihangCampaign.counterattack, outcome: sihangCampaign.outcome,
            goal: child.sihangParadeGoal && { ...child.sihangParadeGoal } };
          if (!child.sihangParadeGoal) throw new Error('Expected a real evacuation parade goal');
          child.position.set(child.sihangParadeGoal.x, 0, child.sihangParadeGoal.z);
          updateSihangMission(.05);
          updateSihangMission(.05);
          return { playerCrossing, aiCrossing, childRemoved: !friendlyAI.includes(child),
            outcome: sihangCampaign.outcome, unresolved: sihangRetreatStatus(sihangCampaign).unresolved };
        },
        snapshot() {
          const card = document.querySelector('#redeploy-choices [data-type="infantry"]');
          return { reserve: sihangCampaign.reserve, stage: sihangCampaign.stage, state,
            title: $('overlay-title').textContent, description: $('overlay-description').textContent,
            summary: $('battle-summary').textContent, card: card.querySelector('small').textContent,
            disabled: card.disabled, selection: $('deployment-selection').textContent,
            markerCount: $('spawn-choices').children.length, confirmDisabled: $('confirm-deploy').disabled,
            takeoverHidden: $('takeover-sihang-squad').hidden, takeoverDisabled: $('takeover-sihang-squad').disabled };
        }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang');
  url.searchParams.set('resources', 'low-memory');
  url.searchParams.set('character', 'procedural');
  await page.goto(url.href);
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const before = await page.evaluate(() => reserveReview.start());
  assert.equal(before.stage, 'sihang-retreat');
  assert.equal(before.state, 'dead');
  assert.equal(before.reserve, 1);
  assert.equal(before.disabled, false);
  assert.match(before.card, /1 人 · 新小队可出击/);
  const consumed = await page.evaluate(() => reserveReview.consume());
  assert.equal(consumed.reserve, 0);
  assert.equal(consumed.ids.length, 1);
  await page.waitForFunction(() => document.querySelector('#overlay-title').textContent === '后备兵力已耗尽。',
    null, { timeout: 30000 });
  const after = await page.evaluate(() => reserveReview.snapshot());
  assert.equal(after.state, 'dead');
  assert.equal(after.disabled, true);
  assert.match(after.card, /后备兵力已耗尽/);
  assert.match(after.description, /可接管战场上的存活友军小队/);
  assert.match(after.selection, /没有可部署/);
  assert.equal(after.markerCount, 0);
  assert.equal(after.confirmDisabled, true);
  assert.equal(after.takeoverHidden, false);
  assert.equal(after.takeoverDisabled, false);
  const throwing = await page.evaluate(() => reserveReview.selectedDuringThrow());
  assert.ok(throwing.selected && throwing.selected !== throwing.throwing,
    'taking control must not automatically release a soldier’s active throwable');
  assert.ok(!throwing.members.includes(throwing.throwing),
    'a throwing soldier must remain in AI control rather than be released by a later Y switch');
  const original = await page.evaluate(() => reserveReview.prepareTakeover());
  await page.locator('#takeover-sihang-squad').click();
  const transferred = await page.evaluate(() => reserveReview.afterTakeover());
  assert.equal(transferred.state, 'playing');
  assert.equal(transferred.id, original.id);
  assert.deepEqual(transferred.members, original.members);
  assert.ok(!transferred.members.includes(original.childId) && transferred.childRetained);
  assert.ok(!transferred.members.includes(original.throwingId) && transferred.throwerRetained);
  assert.equal(transferred.reserve, original.reserve);
  assert.equal(transferred.deployed, original.deployed);
  assert.deepEqual(transferred.retreatIds, original.retreatIds);
  assert.deepEqual(transferred.wave, original.wave);
  assert.ok(original.members.every(id => !transferred.aiRetreatIds.includes(id)));
  assert.deepEqual([transferred.ammo, transferred.rifleReserve, transferred.grenades, transferred.packs],
    [original.ammo, original.rifleReserve, original.grenades, original.packs]);
  assert.ok(transferred.retained && transferred.sourceEmpty);
  assert.ok(Math.hypot(...transferred.position.map((value, i) => value - original.position[i])) < 2,
    'taking control must not teleport the original soldier');
  await page.keyboard.press('y');
  assert.ok((await page.evaluate(() => reserveReview.afterTakeover())).throwerRetained,
    'switching within the new player squad must not release the original AI throwable');
  await page.evaluate(() => reserveReview.endThrowFixture());
  const stepped = await page.evaluate(() => reserveReview.step());
  assert.equal(stepped.state, 'playing');
  assert.notEqual(stepped.id, original.id);
  assert.ok(original.members.includes(stepped.id));
  const secondOriginal = await page.evaluate(() => reserveReview.killTransferred());
  const unavailable = await page.evaluate(() => reserveReview.blockCandidates());
  assert.equal(unavailable.takeoverHidden, false);
  assert.equal(unavailable.takeoverDisabled, true);
  await page.evaluate(() => reserveReview.unblockCandidates());
  await page.locator('#takeover-sihang-squad').click();
  const second = await page.evaluate(() => reserveReview.afterTakeover());
  assert.equal(second.state, 'playing');
  assert.equal(second.id, secondOriginal.id);
  assert.ok(!original.members.includes(second.id));
  assert.deepEqual(second.members, secondOriginal.members);
  assert.ok(!second.members.includes(secondOriginal.childId) && second.childRetained);
  assert.ok(!second.members.includes(secondOriginal.throwingId) && second.throwerRetained);
  await page.evaluate(() => reserveReview.endThrowFixture());
  assert.equal(second.reserve, 0);
  assert.equal(second.deployed, original.deployed);
  assert.deepEqual(second.wave, secondOriginal.wave);
  const finish = await page.evaluate(() => reserveReview.finish());
  assert.equal(finish.playerCrossing.saved, true);
  assert.equal(finish.playerCrossing.counterattack, false);
  assert.equal(finish.playerCrossing.outcome, null);
  assert.equal(finish.aiCrossing.saved, true);
  assert.equal(finish.aiCrossing.counterattack, true);
  assert.equal(finish.aiCrossing.outcome, null);
  assert.equal(finish.childRemoved, true);
  assert.equal(finish.unresolved, 0);
  assert.equal(finish.outcome, 'withdrawal-ended');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ fixture: 'artificial-reserve-and-player-deaths-actual-ai-spawn-and-deployment-refresh',
    before, consumed, after, original, transferred, stepped, unavailable, second, finish }));
} finally {
  await browser.close();
}
