import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__motion-contact', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
  await page.goto(new URL('/__motion-contact', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  const results = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { loadNraCharacter } = await import('/src/nra-character.js');
    const { loadIjaCharacter } = await import('/src/ija-character.js');
    const { createNraMotion, advanceNraMotion } = await import('/src/nra-motion.js');
    const { createRifleState } = await import('/src/rifle-action.js');
    const results = [];
    for (const [team, load] of [['friendly', loadNraCharacter], ['enemy', loadIjaCharacter]]) {
      const template = await load(() => 0), view = template.createView();
      for (const [mode, speed] of [['walk', 1.75], ['sprint', 4.1]]) for (const fps of [30, 60, 144]) for (const slope of [0, .05]) {
        const actor = { id: `${team}-${mode}`, team, index: 1, health: 100, stance: 'standing',
          formation: { type: 'infantry', memberCount: 11 }, unitId: 'contact-review',
          position: new T.Vector3(), heading: 0, walkPhase: 0, locomotion: { speed, mode },
          tactics: {}, rifle: createRifleState() };
        actor.nativeMotion = createNraMotion(template.motionProfile, actor);
        view.bind(actor.id);
        const groundAt = (x, z) => slope * x;
        let maxSlip = 0, contacts = 0, recoveries = 0;
        for (let frame = 0; frame < fps * 4; frame++) {
          const time = frame / fps, moving = time >= .2 && time < 3;
          actor.heading = time > 1.4 && moving ? Math.min(.5, (time - 1.4) * .42) : actor.heading;
          actor.locomotion.speed = moving ? speed : 0;
          actor.position.x -= Math.sin(actor.heading) * actor.locomotion.speed / fps;
          actor.position.z -= Math.cos(actor.heading) * actor.locomotion.speed / fps;
          actor.position.y = groundAt(actor.position.x, actor.position.z);
          advanceNraMotion(actor, 1 / fps); view.update(actor, time, groundAt);
          const snapshot = view.snapshot;
          if (snapshot.gait.legPose?.recovered) recoveries++;
          for (const side of ['left', 'right']) {
            const anchor = actor.nativeMotion.footContacts?.[side];
            if (!anchor) continue;
            const foot = snapshot[`${side}Foot`];
            maxSlip = Math.max(maxSlip, Math.hypot(foot[0] - anchor.x, foot[2] - anchor.z));
            contacts++;
          }
        }
        results.push({ team, mode, fps, slope, maxSlip, contacts, recoveries,
          contactsAfterStopping: actor.nativeMotion.footContacts });
      }
    }
    return results;
  });
  for (const result of results) {
    assert.ok(result.contacts > 10, JSON.stringify(result));
    assert.equal(result.recoveries, 0, JSON.stringify(result));
    assert.ok(result.maxSlip <= .03, JSON.stringify(result));
    assert.equal(result.contactsAfterStopping, null, JSON.stringify(result));
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, results, errors }));
} finally { await browser.close(); }
