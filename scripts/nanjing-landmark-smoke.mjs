import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultPreferences, PREFERENCES_KEY } from '../src/player-preferences.js';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  const settings = defaultPreferences(); settings.quality.preset = 'low';
  Object.keys(settings.quality.effects).forEach(key => settings.quality.effects[key] = false);
  await page.addInitScript(({ key, settings }) => localStorage.setItem(key, JSON.stringify({ version: 1, settings })),
    { key: PREFERENCES_KEY, settings });
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.landmarkReview=kind=>{
        fatal=true;setGameState('pause');
        for(const id of ['menu','hud','overlay','loading'])$(id).hidden=true;
        for(const child of camera.children)child.visible=false;
        if(nraCharacter)nraCharacter.root.visible=false;
        if(ijaCharacter)ijaCharacter.root.visible=false;
        for(const person of world.civilians)person.visible=false;
        const temple=world.landmarks.temple;
        const plaque=world.solids.find(mesh=>mesh.userData.nanjingFeature==='gate-name-plaque');
        camera.fov=55;camera.updateProjectionMatrix();
        if(kind==='gate'){
          camera.position.set(1,2.1,plaque.position.z+13);camera.lookAt(0,plaque.position.y-.7,plaque.position.z);
        }else if(kind==='temple'){
          camera.position.set(temple.x+2.6,1.9,temple.entry.z-3.8);camera.lookAt(temple.x,1.5,temple.z);
        }else{
          camera.position.set(temple.x,1.6,temple.entry.z+2);camera.lookAt(temple.x,1.5,temple.z+temple.depth/2-1);
        }
        renderer.render(scene,camera);
        return {temple,text:plaque.userData.text,rasterized:plaque.material.userData.lettering.rasterized,
          door:world.doorSystem.doors.find(door=>door.id===temple.id+'-door').state};
      };` });
  });
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/?campaign=nanjing');
  await page.waitForFunction(() => window.__battle?.state === 'menu' && window.landmarkReview, null, { timeout: 180000 });
  const observations = [];
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  for (const kind of ['gate', 'temple', 'temple-interior']) {
    const result = await page.evaluate(kind => landmarkReview(kind), kind); observations.push(result);
    assert.equal(result.text, '中華門'); assert.ok(result.rasterized); assert.equal(result.door, 'open');
    if (process.env.ARTIFACT_DIR) await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `${kind}.png`) });
  }
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'landmarks.json'),
    JSON.stringify({ observations, errors, note: 'Actual scene captures; temple is fictional game scenery, plaque is original typesetting.' }, null, 2));
  console.log(JSON.stringify({ passed: true, observations, errors }));
} finally { await browser.close(); }
