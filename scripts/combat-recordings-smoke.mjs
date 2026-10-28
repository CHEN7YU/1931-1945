import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5173');
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__combat-audio', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><button>Enable audio</button>',
  }));
  await page.goto(new URL('/__combat-audio', base).href);
  await page.locator('button').click();
  const result = await page.evaluate(async () => {
    const { loadRifleAudio } = await import('/src/rifle-audio.js');
    const { loadBattleReactions, createBattleReactions, reactionClips } = await import('/src/battle-reactions.js');
    const context = new AudioContext(); await context.resume();
    const rifles = await loadRifleAudio(), decoded = {};
    for (const clip of reactionClips()) {
      const response = await fetch(`/assets/audio/battle-reactions/${clip.file}`);
      if (!response.ok) throw new Error(`Reaction HTTP ${response.status}`);
      decoded[clip.file] = await context.decodeAudioData(await response.arrayBuffer());
    }
    const reactions = createBattleReactions(decoded, () => 0); reactions.sync(true);
    const loader = await loadBattleReactions();
    const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 },
      soldierId: 'player', weaponId: 'player:rifle' };
    const soldier = { id: 'enemy', team: 'enemy', health: 100, groundType: 'infantry', vehicleId: null,
      position: { x: -3, y: 0, z: 0 }, tactics: { suppressedUntil: 5 } };
    const event = { type: 'damage', time: 1, target: { kind: 'soldier', id: soldier.id },
      source: { credit: 'player' } };
    const immediate = reactions.damage(context, event, soldier, listener);
    const playing = reactions.snapshot;
    reactions.update(context, [soldier], listener, 1, true);
    const interrupted = reactions.snapshot.active;
    reactions.sync(false); reactions.reset();
    for (const [id, team, automatic] of [[1, 'friendly', false], [2, 'enemy', false], [3, 'friendly', true], [4, 'enemy', true]]) {
      rifles.playBatch(context, [{ id, time: id * .12, automatic, weaponType: 'infantry',
        source: { team, soldierId: 'player', weaponId: 'player:rifle', credit: team === 'enemy' ? 'enemy' : 'player' },
        start: { x: 0, y: 1.7, z: 0 } }], listener);
    }
    const reports = rifles.snapshot;
    rifles.reset();
    await context.close();
    return { reports, immediate, playing, interrupted, loader: loader.snapshot.status,
      reset: reactions.snapshot, durations: Object.values(decoded).map(buffer => buffer.duration) };
  });
  assert.equal(result.loader, 'recorded');
  assert.equal(result.immediate, true);
  assert.equal(result.playing.active, 1); assert.equal(result.interrupted, 0);
  assert.equal(result.reset.history.length, 0);
  assert.ok(result.durations.length === 18 && result.durations.every(value => value >= .08 && value <= 2));
  assert.deepEqual(result.reports.history.map(item => item.report),
    ['recorded-rifle', 'enemy-rifle', 'machine-gun', 'machine-gun']);
  assert.ok(result.reports.enemyDuration > 3 && result.reports.enemyDuration < 3.2);
  assert.ok(result.reports.machineGunDurations.every(value => Math.abs(value - .095) < 1 / 24000));
  await page.close();

  const failed = await browser.newPage();
  await failed.route('**/assets/audio/battle-reactions/0-hurt-0.wav', route => route.abort());
  const url = new URL(base); url.search = '?benchmark=interior&character=procedural';
  await failed.goto(url.href);
  await failed.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 90000 });
  assert.equal(await failed.evaluate(() => window.__battle.battleReactions.status), 'unavailable');
  assert.equal(await failed.evaluate(() => window.__battle.battleVoices.status), 'ready', 'reaction failure preserves existing dialogue');
  await failed.locator('#deploy').click();
  await failed.waitForFunction(() => window.__battle.state === 'playing');
  assert.match(await failed.locator('#force-status').textContent(), /真人战斗反应不可用/);
  await failed.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ decodedReactions: result.durations.length, reports: result.reports.history.map(item => item.report),
    immediateReaction: true, priorityInterruption: true, missingReactionWarning: true }));
} finally {
  await browser.close();
}
