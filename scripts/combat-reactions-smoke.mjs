import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    recordVideo: { dir: directory, size: { width: 1280, height: 720 } } });
  const recordingStarted = Date.now(), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
  // This mutation seam exists only in this test's intercepted module, never in the shipped game.
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    const fixture = `
      let reactionTestActor;
      window.__reactionTest = {
        blast(lethal) {
          const actor = controlledSoldier(entities);
          reactionTestActor = actor;
          const source = captureAttackSource(entities, actor);
          explode(actor.position.clone().add(new THREE.Vector3(.4, 1, 0)), lethal ? 1000 : 55, 2, source);
          return this.snapshot();
        },
        snapshot() {
          const actor = reactionTestActor;
          return { time, state, controlledId: entities.control.soldierId,
            actorId: actor?.id, health: actor?.health, shots: actor?.rifle.shots,
            dying: actor?.dying ? { ...actor.dying } : null,
            blast: actor?.blastReaction ? { ...sampleBlastReaction(actor),
              direction: { ...actor.blastReaction.direction } } : null,
            throwable: actor?.grenades.action ? { ...actor.grenades.action } : null,
            active: grenades.active.map(item => ({ id: item.id, holderId: item.holderId,
              detonateAt: item.detonateAt, source: { ...item.source }, kind: item.kind })),
            deathProcessed: actor?.deathProcessed === true,
            corpses: [...corpses.values()].filter(item => item.id === actor?.id).length };
        }
      };`;
    await route.fulfill({ response, body: await response.text() + fixture });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu' ||
    document.getElementById('fatal') && !document.getElementById('fatal').hidden);
  if (await page.locator('#fatal').isVisible()) throw new Error(await page.locator('#fatal-message').textContent());
  await page.locator('#qualityToggle').selectOption('low', { force: true });
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  console.log('Combat reaction fixture deployed');
  const videoStartSeconds = (Date.now() - recordingStarted) / 1000;
  const first = await page.evaluate(() => window.__reactionTest.blast(false));
  console.log(JSON.stringify({ phase: 'injured', health: first.health, reaction: first.blast?.phase }));
  assert.ok(first.health > 0 && first.health < 100);
  assert.ok(first.blast); assert.ok(first.blast.direction.x < -.99);
  await page.waitForFunction(() => window.__reactionTest.snapshot().blast?.phase === 'brace');
  await page.screenshot({ path: join(directory, 'blast-grounded.png') });
  await page.waitForFunction(() => !window.__reactionTest.snapshot().blast);
  const recovered = await page.evaluate(() => window.__reactionTest.snapshot());
  console.log('Blast recovery completed');
  assert.equal(recovered.health, first.health);
  assert.equal(recovered.controlledId, first.actorId);
  assert.ok(recovered.time - first.time >= 3.4);
  const dying = await page.evaluate(() => window.__reactionTest.blast(true));
  assert.equal(dying.health, 1); assert.ok(dying.dying); assert.ok(dying.blast);
  assert.ok(Math.abs(dying.dying.deadline - dying.dying.startedAt - 1.5) < 1e-10);
  await page.mouse.down();
  await page.waitForFunction(shots => window.__reactionTest.snapshot().shots > shots, dying.shots);
  await page.keyboard.press('y');
  const lastShot = await page.evaluate(() => window.__reactionTest.snapshot());
  console.log('Dying soldier fired final shot');
  assert.equal(lastShot.controlledId, dying.actorId, 'manual switching cannot escape the dying window');
  assert.equal(lastShot.shots, dying.shots + 1);
  await page.screenshot({ path: join(directory, 'dying-last-shot.png') });
  await page.mouse.up();
  await page.waitForFunction(id => window.__battle.control.soldierId !== id, dying.actorId);
  const dead = await page.evaluate(() => window.__reactionTest.snapshot());
  console.log('Final-shot soldier transferred');
  assert.equal(dead.health, 0); assert.equal(dead.deathProcessed, true); assert.equal(dead.corpses, 1);
  assert.equal(dead.shots, dying.shots + 1);
  await page.waitForFunction(() => window.__battle.state === 'playing');
  await page.keyboard.press('6');
  const packDying = await page.evaluate(() => window.__reactionTest.blast(true));
  await page.mouse.down();
  await page.waitForFunction(() => window.__reactionTest.snapshot().throwable !== null);
  const packStarted = await page.evaluate(() => window.__reactionTest.snapshot());
  assert.equal(packStarted.dying.action, 'throw');
  await page.waitForFunction(id => window.__battle.control.soldierId !== id, packDying.actorId);
  await page.mouse.up();
  const packDead = await page.evaluate(() => window.__reactionTest.snapshot());
  assert.equal(packDead.health, 0); assert.equal(packDead.corpses, 1);
  const dropped = packDead.active.find(item => item.source.soldierId === packDying.actorId && item.kind === 'explosive-pack');
  assert.ok(dropped && dropped.holderId === null && dropped.detonateAt !== null,
    'a primed final explosive pack must retain its live fuse after death');
  await page.screenshot({ path: join(directory, 'transferred-after-last-pack.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'combat-reactions.json'), JSON.stringify({ first, recovered, dying, lastShot, dead,
    packStarted, packDead, errors, videoStartSeconds,
    videoDurationSeconds: (Date.now() - recordingStarted) / 1000 - videoStartSeconds }, null, 2));
  const video = page.video(); await page.close();
  await video.saveAs(join(directory, 'combat-reactions-gameplay.webm'));
  await context.close();
  console.log(JSON.stringify({ passed: true, actualBlastRecovery: true, dyingLastShot: true, dyingLastPack: true }));
} finally { await browser.close(); }
