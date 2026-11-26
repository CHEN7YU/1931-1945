import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu, setQualityPreset } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
const campaign = process.env.REVIEW_CAMPAIGN ?? 'taierzhuang-streets';
if (!['taierzhuang-fort', 'nanjing'].includes(campaign)) throw new Error('Invalid review campaign');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.blueSquadRoster = () => ({ campaign: campaign.id,
        squads: formations.filter(formation => formation.team === 'friendly').map(formation => ({
          index: formation.index, player: formation.player, active: formation.active !== false, reserve: Boolean(formation.reserve),
          uniforms: [...new Set(formation.members.map(actor => actor.avatarAppearance?.uniform))],
        })),
      });
      window.blueCapReview = (detailLimit, mode = 'normal') => {
        setGameState('pause'); missionBriefing.hide(); $('hud').hidden = true;
        const a = allForces.find(actor => actor.team === 'friendly' && actor.avatarAppearance?.uniform === 'A' && actor.index === 1);
        const blue = allForces.filter(actor => actor.team === 'friendly' && actor.avatarAppearance?.uniform === 'B' && actor.index !== 2);
        const source = blue[0];
        const blueOfficer = allForces.find(actor => actor.team === 'friendly' && actor.avatarAppearance?.uniform === 'B' && isNativeOfficer(actor));
        if (mode === 'replacement' && !window.blueCapReplacement) {
          const spawn = { id: source.spawnId, x: source.position.x, z: source.position.z };
          window.blueCapReplacement = actorAt(true, source.position.x, source.position.z, 1, spawn, source.formation);
        }
        const b = mode === 'replacement' || mode === 'casualty' ? window.blueCapReplacement
          : mode === 'officer' ? blueOfficer : source;
        if (!a || !b) throw new Error('Both real uniform variants are required');
        if (mode === 'casualty') {
          b.health = 0; b.deathTime = time;
          b.casualty = createCasualtyState(b, time, null, { variant: 0, retainGun: false });
        }
        const base = controlledSoldier(entities).position.clone();
        a.position.set(base.x + .55, base.y, base.z + 3);
        b.position.set(base.x - .55, base.y, base.z + 3);
        a.heading = b.heading = 0;
        if (mode === 'close') {
          camera.position.set(base.x - .55, base.y + 1.68, base.z + 1.85);
          camera.lookAt(base.x - .55, base.y + 1.68, base.z + 3);
        } else {
          camera.position.set(base.x, base.y + 1.52, base.z + .8);
          camera.lookAt(base.x, base.y + 1.48, base.z + 3);
        }
        camera.updateMatrixWorld(true);
        for (const child of camera.children) child.visible = false;
        nraCharacter.update([a, b], time + (mode === 'casualty' ? .5 : 0), null, 'high', { detailLimit });
        renderer.render(scene, camera);
        const parts = [];
        nraCharacter.root.traverseVisible(node => {
          if (node.isMesh && (node.name.includes('blue-field-cap') || /officer-insignia|鋼盔|helmet/i.test(node.name)))
            parts.push({ name: node.name, instanced: Boolean(node.isInstancedMesh), count: node.isInstancedMesh ? node.count : 1 });
        });
        return { a: a.id, b: b.id, bFormation: b.formation.index, bPlayer: b.formation.player,
          members: nraCharacter.snapshot.members, views: nraCharacter.snapshot.views,
          parts, image: renderer.domElement.toDataURL('image/png') };
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5376/');
  url.searchParams.set('campaign', campaign);
  url.searchParams.set('resources', 'low-memory'); url.searchParams.set('seed', '1938');
  await page.goto(url.href); await setQualityPreset(page, 'low'); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing' &&
    window.__battle?.historicalForce?.members.some(member => member.uniformVariant === 'B'), null, { timeout: 180000 });
  const roster = await page.evaluate(() => window.blueSquadRoster());
  assert.equal(roster.campaign, campaign);
  const { squads } = roster;
  const blueSquads = campaign === 'nanjing' ? [1, 4] : [1, 3, 6, 8, 9];
  const opening = squads.filter(squad => !squad.player && squad.active && !squad.reserve);
  assert.equal(opening.length, campaign === 'nanjing' ? 2 : 5);
  assert.equal(opening.filter(squad => blueSquads.includes(squad.index)).length,
    campaign === 'nanjing' ? 1 : 2);
  for (const squad of squads.filter(item => item.uniforms.length)) {
    assert.deepEqual(squad.uniforms, [blueSquads.includes(squad.index) && !squad.player ? 'B' : 'A']);
  }
  const results = [];
  for (const [name, detailLimit, mode] of [['near', 2, 'normal'], ['close', 2, 'close'],
    ['far', 0, 'normal'], ['officer-near', 2, 'officer'], ['officer-far', 0, 'officer'],
    ['replacement', 2, 'replacement'], ['casualty-far', 0, 'casualty']]) {
    const result = await page.evaluate(([limit, selected]) => window.blueCapReview(limit, selected), [detailLimit, mode]);
    const { image, ...observations } = result;
    await writeFile(join(directory, `${name}.png`), Buffer.from(image.split(',')[1], 'base64'));
    const a = result.members.find(member => member.id === result.a), b = result.members.find(member => member.id === result.b);
    assert.equal(a.helmet, true);
    assert.equal(b.helmet, false);
    assert.equal(b.appearance.blueFieldCap, true);
    if (campaign === 'nanjing') {
      assert.equal(result.bFormation, 1);
      assert.equal(result.bPlayer, false);
    }
    assert.equal(b.tier, detailLimit ? 'skinned' : 'instanced');
    assert.equal(b.officer, mode === 'officer');
    const capCount = result.parts.filter(part => part.name === 'native-friendly-blue-field-cap')
      .reduce((count, part) => count + part.count, 0);
    assert.equal(capCount, mode === 'officer' ? 0 : 1);
    if (mode === 'officer') assert.ok(result.parts.some(part => part.name ===
      (detailLimit ? 'native-friendly-officer-insignia' : 'native-friendly-blue-officer-insignia')));
    if (mode === 'casualty') assert.equal(b.health, 0);
    if (detailLimit && mode !== 'close') assert.ok(result.parts.some(part => /鋼盔|helmet/i.test(part.name)));
    results.push({ name, ...observations });
  }
  assert.notEqual(results[0].b, results.find(result => result.name === 'replacement').b);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'observations.json'), JSON.stringify({ squads, results, errors,
    limitation: 'Actual battle and lighting, paused with soldiers and camera manually positioned; far pose forced at close range, replacement created through actorAt.' }, null, 2));
  console.log('PASS: actual A/B soldiers, skinned and instanced blue cap, shared views and replacement identity.');
} finally {
  await browser.close();
}
