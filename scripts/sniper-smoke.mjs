import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const snapshot = () => page.evaluate(() => window.__battle);
const wait = (predicate, arg = null) => page.waitForFunction(predicate, arg, { timeout: 120000 });
async function switchTo(index) {
  for (let step = 0; step < 11 && (await snapshot()).current !== index; step++) {
    const previous = (await snapshot()).current;
    await page.keyboard.press('y');
    await wait(previous => window.__battle.current !== previous, previous);
  }
  assert.equal((await snapshot()).current, index);
}
async function capture(name) {
  if (!process.env.ARTIFACT_DIR) return;
  await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ARTIFACT_DIR, name) });
}
try {
  for (const appearance of ['native', 'procedural']) {
    const url = new URL(process.env.GAME_URL || 'http://127.0.0.1:5173');
    if (appearance === 'procedural') url.searchParams.set('character', 'procedural');
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await wait(() => window.__battle?.state === 'menu');
    await page.locator('#menu-quality').selectOption('low');
    await page.locator('#deploy').click();
    await wait(() => window.__battle.state === 'playing');
    const initial = await snapshot();
    assert.equal(initial.population.friendly.alive, 110);
    assert.equal(initial.population.enemy.alive, 110);
    for (const unit of initial.population.units) {
      assert.equal(unit.memberCount, 11);
      assert.equal(unit.members.filter(actor => actor.role === 'sniper').length, 1);
      assert.equal(unit.members[9].weaponModel, 'sniper');
      assert.equal(unit.members[10].role, 'machine-gunner');
    }
    await switchTo(9);
    const selected = await snapshot(), soldierId = selected.control.soldierId, weaponId = selected.controlBinding.weaponId;
    assert.match(await page.locator('#weapon-name').textContent(), /狙击/);
    assert.match(await page.locator('#members .member').nth(9).getAttribute('title'), /狙击手/);
    assert.match(await page.locator('#battle-controls').textContent(), /屏息/);
    await page.mouse.down({ button: 'right' });
    await wait(() => window.__battle.scope.active && window.__battle.fov < 18.01);
    assert.equal(await page.locator('#sniper-scope').isVisible(), true);
    assert.equal((await snapshot()).weaponVisible, false);
    const lens = await page.locator('.scope-lens').boundingBox();
    assert.ok(Math.abs(lens.x + lens.width / 2 - 720) < 1);
    assert.ok(Math.abs(lens.y + lens.height / 2 - 450) < 1);
    const help = await page.locator('.scope-help').boundingBox();
    const equipment = await page.locator('#equipment-slots').boundingBox();
    assert.ok(help.y + help.height < equipment.y, 'scope breath instructions must not sit underneath the equipment bar');
    await page.keyboard.down('ShiftLeft');
    await wait(() => window.__battle.scope.breath.holding && window.__battle.breath < .9);
    await capture(`sniper-${appearance}-scope.png`);
    await page.keyboard.press('Escape');
    await wait(() => window.__battle.state === 'pause');
    const paused = await snapshot();
    await page.waitForTimeout(300);
    assert.equal((await snapshot()).breath, paused.breath);
    assert.equal(await page.locator('#sniper-scope').isVisible(), false);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('ShiftLeft');
    await page.locator('#resume').click();
    await page.mouse.down({ button: 'right' });
    await wait(() => window.__battle.scope.active);
    const before = await snapshot(), shots = before.rifle.shots;
    await page.mouse.down();
    await wait(shots => window.__battle.rifle.shots === shots + 1 && window.__battle.rifle.action === 'cycle', shots);
    assert.equal((await snapshot()).scope.active, false);
    await wait(() => window.__battle.rifle.action === 'idle' && window.__battle.scope.active);
    await wait(time => window.__battle.time > time + 1, before.time);
    assert.equal((await snapshot()).rifle.shots, shots + 1, 'held left button must not repeat sniper shots');
    await page.mouse.up();
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('r');
    await wait(() => window.__battle.rifle.action === 'reload' && window.__battle.rifle.elapsed > .3);
    const loading = await snapshot();
    assert.equal(loading.scope.active, false);
    await capture(`sniper-${appearance}-reload.png`);
    await switchTo(10);
    assert.equal((await snapshot()).rifle.ammo, 20);
    assert.equal(await page.locator('#sniper-scope').isVisible(), false);
    await switchTo(9);
    const returned = await snapshot();
    assert.equal(returned.control.soldierId, soldierId);
    assert.equal(returned.controlBinding.weaponId, weaponId);
    assert.equal(returned.rifle.shots, shots + 1);
    await wait(() => window.__battle.rifle.ammo === 5 && window.__battle.rifle.action === 'idle');
    await page.keyboard.press('5');
    await page.mouse.down({ button: 'right' });
    assert.equal((await snapshot()).scope.active, false);
    await page.mouse.up({ button: 'right' });
    await page.keyboard.press('1');
    await page.mouse.down({ button: 'right' });
    await wait(() => window.__battle.scope.active);
    await page.keyboard.down('ShiftLeft');
    await wait(() => window.__battle.scope.breath.exhausted);
    await wait(() => window.__battle.breath > .15);
    assert.equal((await snapshot()).scope.breath.holding, false);
    await page.keyboard.up('ShiftLeft');
    await wait(() => !window.__battle.scope.breath.exhausted);
    await page.mouse.up({ button: 'right' });
    observations.push({ appearance, soldierId, weaponId, returned, final: await snapshot() });
    console.log(`PASS: ${appearance} sniper roster, scope, breath, single-shot bolt action, reload and Y ownership.`);
  }
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'sniper.json'), JSON.stringify(observations, null, 2));
} finally {
  await browser.close();
}
