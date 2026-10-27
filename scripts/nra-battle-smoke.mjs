import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const directory = resolve(process.env.NRA_OBSERVATION_DIR ?? 'asset-research', 'nra-battle');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 },
  recordVideo: { dir: join(directory, 'video'), size: { width: 1280, height: 800 } } });
const page = await context.newPage(), errors = [], samples = [], stages = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => {
  const data = window.__battle;
  return { state: data.state, time: data.time, current: data.current, position: data.position, control: data.control,
    historical: data.historicalCharacter, force: data.historicalForce, allies: data.allies, population: data.population,
    events: data.combatEvents.history, rifle: data.rifle, look: data.look };
});
const capture = name => page.screenshot({ path: join(directory, `${name}.png`) });
let failure = null;
try {
  await page.goto(process.env.NRA_BATTLE_URL ?? 'http://127.0.0.1:5173/?character=nra88&benchmark=full&seed=1938');
  await page.waitForFunction(() => window.__battle?.state === 'menu', null, { timeout: 60000 });
  await page.locator('#deploy').click();
  await page.waitForFunction(() => window.__battle.historicalCharacter?.visible);
  let data = await snapshot();
  const observed = data.force.views.find(view => data.allies.some(actor => actor.id === view.actorId));
  assert.ok(observed, 'An actual player-squad member must be visible for the control check');
  const id = observed.actorId, initial = data.allies.find(actor => actor.id === id);
  assert.equal(data.population.friendly.alive, 100); assert.equal(data.population.enemy.alive, 100);
  await page.keyboard.press('y');
  for (let attempt = 0; attempt < 10 && (await snapshot()).control.soldierId !== id; attempt++) await page.keyboard.press('y');
  await page.waitForFunction(id => window.__battle.control.soldierId === id &&
    window.__battle.historicalForce.members.find(member => member.id === id)?.tier === 'hidden', id);
  data = await snapshot();
  assert.equal(data.rifle.id, initial.rifle.id); assert.equal(data.rifle.ammo, initial.rifle.ammo);
  assert.equal(data.allies.find(actor => actor.id === id).health, initial.health);
  stages.push({ stage: 'Y-native-controlled-hidden', data });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const data = window.__battle;
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -(-.5 - data.look.pitch) / .00132 }));
  });
  await page.mouse.down();
  await page.waitForFunction(ammo => window.__battle.ammo < ammo, data.rifle.ammo);
  await page.mouse.up(); await page.mouse.up({ button: 'right' });
  data = await snapshot();
  assert.equal(data.rifle.ammo, initial.rifle.ammo - 1);
  stages.push({ stage: 'native-personal-rifle-fired', data });
  for (let attempt = 0; attempt < 10 && (await snapshot()).current !== 0; attempt++) await page.keyboard.press('y');
  await page.waitForFunction(() => window.__battle.current === 0 && window.__battle.historicalCharacter.visible);
  data = await snapshot();
  const returned = data.allies.find(actor => actor.id === id);
  assert.equal(returned.rifle.id, initial.rifle.id); assert.equal(returned.rifle.ammo, initial.rifle.ammo - 1);
  stages.push({ stage: 'Y-return-native-visible-resources-preserved', data });
  await capture('control-return');
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.__battle.position.z <= 42 || window.__battle.state !== 'playing', null, { timeout: 40000 });
  await page.keyboard.up('w');
  await page.keyboard.press('x');
  data = await snapshot();
  assert.ok(['advance', 'hold'].includes(data.allies.find(actor => actor.id === id).order), 'Use the normal squad order to send the observed member into the firefight');
  stages.push({ stage: 'normal-frontline-squad-order', data });
  const started = Date.now();
  let observedShot = null;
  while (Date.now() - started < 60000) {
    data = await snapshot();
    const view = data.force.views.find(view => view.actorId === id);
    if (view?.soldier?.health > 0) {
      assert.equal(view.issue, null);
      assert.ok(view.riflePose.right.error < .015 && view.riflePose.left.error < .015, 'Both native wrist targets stay reachable');
      const expected = view.logicalMuzzle, actual = view.riflePose.muzzle;
      assert.ok(Math.hypot(actual[0] - expected.x, actual[1] - expected.y, actual[2] - expected.z) < 1e-4,
        'Displayed native rifle muzzle matches authoritative simulation muzzle');
    }
    samples.push({ state: data.state, time: data.time, historical: view, events: data.events });
    observedShot = data.events.find(event => event.type === 'shot' && event.source.soldierId === id && event.source.credit === 'ally');
    if (observedShot) { await capture('native-actual-fire'); break; }
    if (['victory', 'defeat', 'dead'].includes(data.state)) break;
    await page.waitForTimeout(200);
  }
  assert.ok(observedShot, 'Native soldier must actually fire as AI in normal combat, not only while controlled');
  stages.push({ stage: 'native-actual-AI-shot', event: observedShot, data });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, actorId: id, stages: stages.map(stage => stage.stage), samples: samples.length, directory }));
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  throw error;
} finally {
  await page.keyboard.up('w'); await page.mouse.up(); await page.mouse.up({ button: 'right' });
  await capture('final');
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ stages, samples, errors, failure }, null, 2));
  await context.close(); await browser.close();
}
