import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__rifle-operation', route => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto(new URL('/__rifle-operation', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState, rifleReloadSeconds } = await import('/src/rifle-action.js');
    const output = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0), view = template.createView();
      for (const [action, ammo] of [['cycle', 4], ['reload', 0], ['reload', 2]]) {
        const actor = { id: `${team}-${action}-${ammo}`, team, index: 1, unitId: 'operation-review',
          formation: { type: 'infantry', memberCount: 11 }, health: 100, stance: 'standing',
          position: new T.Vector3(), heading: 0, walkPhase: 0, tactics: {},
          locomotion: { speed: 0, mode: 'idle' }, rifle: createRifleState() };
        Object.assign(actor.rifle, { action, ammo });
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        view.bind(actor.id);
        const duration = action === 'cycle' ? .65 : rifleReloadSeconds(actor.rifle);
        let issues = 0, maxPalmError = 0;
        for (let frame = 0; frame <= 60; frame++) {
          actor.rifle.elapsed = duration * frame / 60;
          view.update(actor, actor.rifle.elapsed, null);
          if (view.issue) issues++;
          maxPalmError = Math.max(maxPalmError, view.snapshot.riflePose.right.palmError);
        }
        output.push({ team, action, ammo, issues, maxPalmError });
      }
    }
    return output;
  });
  for (const result of results) {
    assert.equal(result.issues, 0, JSON.stringify(result));
    assert.ok(result.maxPalmError <= .005, JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results }));
} finally { await browser.close(); }
