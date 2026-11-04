import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  if (process.env.SHELL_EFFECT_BASELINE === '1') {
    const source = execFileSync('git', ['show', 'be0a799:src/combat-particles.js'], { encoding: 'utf8' });
    await page.route('**/src/combat-particles.js*', route => route.fulfill({ contentType: 'text/javascript', body: source }));
  }
  await page.route('**/__shell-impact-review.html', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}canvas{display:block}</style><script type="module">
    import * as THREE from '/node_modules/three/build/three.module.js';
    import {createCombatEffects} from '/src/combat-effects.js';
    import {defaultPreferences} from '/src/player-preferences.js';
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1280,800);
    renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color(0x9ca9ae);
    scene.add(new THREE.HemisphereLight(0xc3d3e1,0x766651,.6));
    const sun=new THREE.DirectionalLight(0xffefd5,2.5);sun.position.set(-5,12,8);scene.add(sun);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshStandardMaterial({color:0x756955,roughness:1}));
    ground.rotation.x=-Math.PI/2;scene.add(ground);
    const wall=new THREE.Mesh(new THREE.BoxGeometry(8,3,.4),new THREE.MeshStandardMaterial({color:0x615f55}));
    wall.position.set(0,1.5,-3);scene.add(wall);
    const camera=new THREE.PerspectiveCamera(60,1.6,.1,100);camera.position.set(8,3.8,12);camera.lookAt(0,1,0);
    const effects=createCombatEffects(scene,camera,()=>0);
    window.review={
      render(low,time){
        effects.clear();const quality=defaultPreferences().quality;quality.preset=low?'low':'high';
        quality.effects.hitParticles=quality.effects.muzzleLight=quality.effects.muzzle=true;effects.configure(quality);
        effects.explosion(new THREE.Vector3(0,.03,0),0,9,'tank-shell',{kind:'soil',normal:{x:0,y:1,z:0}});
        effects.update(time,time);renderer.render(scene,camera);return{...effects.snapshot,calls:renderer.info.render.calls};
      },
      wall(){
        effects.clear();effects.explosion(new THREE.Vector3(0,1.3,-2.79),0,9,'tank-shell',
          {kind:'stone',normal:{x:0,y:0,z:1}});
        effects.update(.12,.12);renderer.render(scene,camera);return effects.snapshot;
      }
    };window.ready=true;
    </script>` }));
  await page.goto((process.env.GAME_URL ?? 'http://127.0.0.1:5203') + '/__shell-impact-review.html');
  await page.waitForFunction(() => window.ready);
  const samples = [];
  if (process.env.ARTIFACT_DIR) await mkdir(process.env.ARTIFACT_DIR, { recursive: true });
  for (const low of [false, true]) for (const time of [.04, .3, .7, 4]) {
    const sample = await page.evaluate(({ low, time }) => review.render(low, time), { low, time });
    samples.push({ low, time, ...sample });
    assert.ok(sample.fragments <= (low ? 32 : 96) && sample.clouds <= (low ? 6 : 18));
    assert.equal(sample.pointLightShadows, false);
    if (time === .04) assert.ok(sample.fireClouds > 0 && sample.shockwaves > 0);
    if (time === 4) assert.equal(sample.fragments + sample.clouds + sample.lights, 0);
    if (process.env.ARTIFACT_DIR && time !== 4)
      await page.screenshot({ path: join(process.env.ARTIFACT_DIR, `shell-${low ? 'low' : 'high'}-${time}.png`) });
  }
  const wall = await page.evaluate(() => review.wall());
  assert.deepEqual(wall.lastExplosion.surface.normal, { x: 0, y: 0, z: 1 });
  assert.deepEqual(errors, []);
  if (process.env.ARTIFACT_DIR) await writeFile(join(process.env.ARTIFACT_DIR, 'shell-effects.json'),
    JSON.stringify({ samples, wall, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, samples: samples.map(({ low, time, fragments, clouds, calls }) =>
    ({ low, time, fragments, clouds, calls })), errors }));
} finally { await browser.close(); }
