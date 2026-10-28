import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { advanceRifle } from '../src/rifle-action.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const capture = async name => {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
};
const wait = (predicate, timeout = 6000) => page.waitForFunction(predicate, null, { timeout });
const press = key => page.keyboard.press(key);
const shoot = async () => {
  await page.mouse.down();
  await wait(() => window.__battle.rifle.action === 'cycle');
  await page.mouse.up();
};
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:5173');
  await wait(() => window.__battle?.state === 'menu', 60000);
  await page.locator('#deploy').click();
  await wait(() => window.__battle.state === 'playing');
  await page.waitForTimeout(700);
  await capture('rifle-hip.png');
  await page.mouse.down({ button: 'right' });
  await wait(() => window.__battle.fov < 48.01);
  let data = await snapshot();
  assert.ok(Math.abs(data.rifle.model.dimensions.length - 1.11) < .002, 'authored gun body, not just metadata, measures 111 cm within 2 mm');
  for (const arm of Object.values(data.rifle.model.arms)) {
    assert.ok(Math.abs(arm.upper - .35) < .002 && arm.forearm > .3 && arm.forearm < .37, 'two-segment arms keep anatomical lengths instead of long straight tubes');
  }
  const sharedGeometry = await page.evaluate(async () => {
    const { rifleModel, rifleWorldModel } = await import('/src/rifle-model.js');
    const view = rifleModel(), body = rifleWorldModel();
    const viewIds = [];
    for (const name of ['rifleBody', 'bolt']) view.getObjectByName(name).traverse(child => { if (child.isMesh) viewIds.push(child.geometry.uuid); });
    const worldIds = [];
    body.traverse(child => { if (child.isMesh) worldIds.push(child.geometry.uuid); });
    return { viewIds, worldIds };
  });
  assert.deepEqual(sharedGeometry.viewIds, sharedGeometry.worldIds, 'first- and third-person friendly guns use the exact same authored geometry, not different approximations');
  for (const sight of data.rifle.sights) {
    assert.ok(Math.abs(sight.x) < .002 && Math.abs(sight.y) < .002, 'actual rear notch and front tip project onto the sight ray');
  }
  await capture('rifle-ads.png');
  await shoot();
  const boltObservation = await page.waitForFunction(() => {
    const data = window.__battle;
    return data.rifle.action === 'cycle' && data.rifle.model.boltLift > .8 && data.rifle.model.boltTravel > .03 ? data : false;
  });
  data = await boltObservation.jsonValue();
  await boltObservation.dispose();
  assert.equal(data.ammo, 4);
  assert.ok(data.rifle.model.boltLift > .8 && data.rifle.model.boltTravel > .03, 'the visible bolt is lifted and extracted');
  assert.ok(data.rifle.trace && data.rifle.trace.start.every(Number.isFinite));
  assert.ok(Math.hypot(...data.rifle.trace.start.map((v, i) => v - data.rifle.muzzle[i])) < .15, 'shot originates at the rendered muzzle, not a hardcoded camera offset');
  await capture('rifle-bolt.png');
  await wait(() => window.__battle.rifle.action === 'idle');
  await press('r');
  await wait(() => window.__battle.rifle.elapsed > .75);
  data = await snapshot();
  assert.equal(data.ammo, 4, 'starting the animation does not refill ammo');
  assert.equal(data.rifle.model.clipVisible, true);
  assert.equal(data.rifle.model.chargerVisible, false, 'partial reload feeds loose cartridges rather than a full clip into a nearly full magazine');
  assert.equal(data.rifle.model.cartridges, 1);
  await capture('rifle-reload.png');
  await press('Escape');
  const paused = await snapshot();
  await page.waitForTimeout(350);
  assert.equal((await snapshot()).rifle.elapsed, paused.rifle.elapsed, 'pause freezes action and ammo');
  await page.locator('#resume').click();
  await press('y');
  const switched = await snapshot(), held = switched.allies[0].rifle.elapsed;
  await page.waitForFunction(held => window.__battle.allies[0].rifle.elapsed > held + .2, held);
  const background = await snapshot();
  data = background;
  assert.equal(data.current, 1);
  assert.ok(data.allies[0].rifle.elapsed > held, 'the former controller now advances its real AI-owned loading action');
  assert.equal(data.ammo, 5, 'each member has an independent magazine');
  assert.equal(data.rifle.action, 'idle', 'another soldier loading does not animate the new controller rifle');
  for (let i = 1; i < 11 && (await snapshot()).current !== 0; i++) await press('y');
  data = await snapshot();
  assert.equal(data.current, 0);
  const expected = structuredClone(background.allies[0].rifle);
  advanceRifle(expected, data.time - background.time);
  assert.equal(data.ammo, expected.ammo, 'Y preserves precisely the ammo allowed by elapsed simulation time, including a naturally finished reload');
  assert.equal(data.rifle.action, expected.action);
  assert.ok(Math.abs(data.rifle.elapsed - expected.elapsed) < 1e-7, 'Y neither freezes nor restarts the ongoing owned action');
  assert.equal(data.controlBinding.weaponId, data.allies[0].rifle.id);
  const atBinding = structuredClone(background.allies[0].rifle);
  advanceRifle(atBinding, data.controlBinding.time - background.time);
  assert.equal(data.controlBinding.ammo, atBinding.ammo);
  if (atBinding.action === 'reload') assert.ok(data.controlBinding.reloadUntil > data.controlBinding.time,
    'remaining reload timing is synchronised before the control-surface event is presented');
  else assert.equal(data.controlBinding.reloadUntil, 0);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'rifle-control-binding.json'),
    JSON.stringify({ control: data.control, binding: data.controlBinding, rifle: data.rifle }, null, 2));
  await wait(() => window.__battle.rifle.action === 'idle');
  await shoot();
  await wait(() => window.__battle.rifle.action === 'idle');
  await press('r');
  await wait(() => window.__battle.rifle.action === 'reload' && window.__battle.rifle.elapsed > .3);
  await press('2');
  const stowed = await snapshot(), toolPause = stowed.rifle.elapsed;
  const toolEvent = stowed.controlEvents.history.at(-1).id;
  await page.waitForTimeout(450);
  assert.equal((await snapshot()).rifle.elapsed, toolPause, 'hammer pauses the rifle action');
  assert.ok(!(await snapshot()).controlEvents.history.some(event => event.id > toolEvent && event.type === 'weapon.mechanical' &&
    event.soldierId === stowed.control.soldierId), 'the stowed personal rifle cannot produce mechanical cues while other AI continue');
  await press('1');
  await wait(() => window.__battle.rifle.action === 'idle');
  assert.equal((await snapshot()).ammo, 5);
  assert.ok((await snapshot()).controlEvents.history.some(event => event.type === 'weapon.mechanical' &&
    event.soldierId === stowed.control.soldierId && event.weaponId === stowed.allies[0].rifle.id && event.cue === 'load'));
  const shotsBeforeMagazine = (await snapshot()).rifle.shots;
  await page.mouse.down();
  await page.waitForFunction(before => window.__battle.rifle.shots === before + 5 && window.__battle.ammo === 0,
    shotsBeforeMagazine, { timeout: 10000 });
  await page.mouse.up();
  await wait(() => window.__battle.rifle.action === 'idle');
  await press('r');
  await wait(() => window.__battle.rifle.elapsed > .9);
  data = await snapshot();
  assert.equal(data.rifle.model.cartridges, 5);
  assert.equal(data.rifle.model.chargerVisible, true, 'empty magazine uses the five-round charger');
  await capture('rifle-clip.png');
  await wait(() => window.__battle.rifle.action === 'idle');
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: -2380 })));
  await page.keyboard.down('w');
  await wait(() => window.__battle.rifle.obstruction > .5, 10000);
  await page.keyboard.up('w');
  await page.waitForTimeout(350);
  data = await snapshot();
  assert.ok(data.rifle.muzzle[2] < 87, 'actual retracted muzzle remains in front of the building face');
  assert.equal(await page.locator('#crosshair').isVisible(), true, 'blocked rifle leaves the sight picture');
  const blockedShots = data.rifle.shots, blockedAmmo = data.ammo;
  await page.mouse.down(); await page.waitForTimeout(300); await page.mouse.up();
  data = await snapshot();
  assert.equal(data.rifle.shots, blockedShots, 'blocked muzzle cannot shoot through the wall');
  assert.equal(data.ammo, blockedAmmo, 'blocked firing consumes no ammunition');
  assert.match(await page.locator('#toast').textContent(), /枪口受阻/);
  await capture('rifle-wall.png');
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 2380 })));
  await wait(() => window.__battle.rifle.obstruction === 0 && window.__battle.rifle.obstructionBlend < .03);
  await shoot();
  assert.equal((await snapshot()).ammo, blockedAmmo - 1, 'turning away restores normal firing');
  assert.deepEqual(errors, []);
  console.log('PASS: actual sight alignment, muzzle-origin shooting, visible bolt movement, partial/clip loading, pause/member/tool interruption, and physical near-wall clearance.');
} finally {
  await browser.close();
}
