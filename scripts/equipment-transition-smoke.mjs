import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { deployFromMenu } from './game-entry.mjs';

const directory = resolve(process.env.ARTIFACT_DIR);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
window.__equipmentTransitionReview=()=>{
  showOverlay('pause');
  const results=[];
  for(const role of ['mortarman','engineer']){
    const actor=allies.find(actor=>actor.health>0&&actor.role===role);
    if(!actor)throw new Error('Missing original '+role);
    selectControlledSoldier(entities,actor);current=allies.indexOf(actor);
    bindControlInput();refreshControlSurface();
    const stock={...actor.rifle},ammo=actor.grenades.ammo,packs=actor.grenades.packs;
    equipTool(true);presentControlEvents();
    if(weapon.userData.rifle)throw new Error('Expected actual tool model');
    equipPrimary();
    let beforeDrainError=null;
    try{updateCamera(0);}catch(error){beforeDrainError=error.message;}
    const beforeDrainRifle=Boolean(weapon.userData.rifle);
    presentControlEvents();updateCamera(0);
    equipTool(true);presentControlEvents();equipGrenade('grenade');
    equipPrimary();
    let grenadeReturnError=null;
    try{updateCamera(0);}catch(error){grenadeReturnError=error.message;}
    presentControlEvents();
    results.push({role,beforeDrainError,grenadeReturnError,beforeDrainRifle,
      rifleUnchanged:['ammo','action','elapsed','shots','queuedReload'].every(key=>actor.rifle[key]===stock[key]),
      ammoUnchanged:actor.grenades.ammo===ammo&&actor.grenades.packs===packs});
    equipTool(true);presentControlEvents();
    const next=allies.findIndex(other=>other!==actor&&other.health>0);
    switchMember(next);
    let takeoverError=null;try{updateCamera(0);}catch(error){takeoverError=error.message;}
    results.push({role:role+'-takeover',beforeDrainError:takeoverError,grenadeReturnError:null,
      beforeDrainRifle:Boolean(weapon.userData.rifle),rifleUnchanged:true,ammoUnchanged:true});
    switchMember(allies.indexOf(actor));presentControlEvents();
    camera.remove(weapon);weapon=selectedToolModel(actor);camera.add(weapon);
    const retainedAmmo=actor.rifle.ammo,retainedShots=actor.rifle.shots;
    updateCamera(0);
    results.push({role:role+'-view-recovery',beforeDrainError:null,grenadeReturnError:null,
      beforeDrainRifle:Boolean(weapon.userData.rifle),rifleUnchanged:actor.rifle.ammo===retainedAmmo&&actor.rifle.shots===retainedShots,
      ammoUnchanged:actor.grenades.ammo===ammo&&actor.grenades.packs===packs});
  }
  return results;
};` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5347/');
  url.searchParams.set('benchmark', 'cover'); url.searchParams.set('resources', 'low-memory');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__battle?.state === 'menu');
  await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing');
  const result = await page.evaluate(() => window.__equipmentTransitionReview());
  await writeFile(join(directory, 'equipment-transitions.json'), JSON.stringify({ result, errors,
    note: 'Original registered mortar/engineer, actual equipment transition and camera call before presentation event drain' }, null, 2));
  if (process.env.EXPECT_TRANSITION_BUG === '1') {
    assert.ok(result.filter(sample=>!sample.role.includes('takeover')).every(sample => sample.beforeDrainError?.includes('bolt')));
  } else for (const sample of result) {
    assert.equal(sample.beforeDrainError, null, JSON.stringify(sample));
    assert.equal(sample.grenadeReturnError, null, JSON.stringify(sample));
    assert.equal(sample.beforeDrainRifle, true);
    assert.equal(sample.rifleUnchanged, true); assert.equal(sample.ammoUnchanged, true);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, result }));
} finally { await browser.close(); }
