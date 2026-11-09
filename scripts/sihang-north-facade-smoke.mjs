import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__north-facade.html', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}canvas{display:block}</style><script type="module">
    import * as THREE from '/node_modules/three/build/three.module.js';
    import {makeWorld} from '/src/battlefield.js';
    import {loadSceneMaterials} from '/src/materials.js';
    import {configureSunShadow} from '/src/lighting.js';
    import {createSolidIndex} from '/src/solid-index.js';
    import {SIHANG_NORTH_APERTURES,SIHANG_DEMOLITION_POINT} from '/src/sihang-layout.js';
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1600,900);renderer.setPixelRatio(1);
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
    document.body.append(renderer.domElement);
    const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0xb7b6af,.0035);
    scene.add(new THREE.HemisphereLight(0xc3d3e1,0x766651,.6));
    const sun=new THREE.DirectionalLight(0xffefd5,2.5);sun.position.set(-55,70,38);
    sun.castShadow=true;configureSunShadow(sun);scene.add(sun);
    const surface=await loadSceneMaterials(renderer,scene,{lowMemory:false});
    const world=makeWorld(scene,surface,{campaign:'sihang'});world.buildingFire.update(12.4);world.updateFlag(12.4);
    const camera=new THREE.PerspectiveCamera(50,1600/900,.07,650);
    const index=createSolidIndex(world.solids), ray=new THREE.Raycaster();
    scene.updateMatrixWorld(true);
    const traces=SIHANG_NORTH_APERTURES.flatMap(hole=>[-1,1].map(side=>{
      const start=new THREE.Vector3(hole.u,(hole.bottom+hole.top)/2,-42-side*.7);
      const direction=new THREE.Vector3(0,0,side);ray.set(start,direction);ray.far=1.4;
      return {id:hole.id,side,hits:ray.intersectObjects(index.candidates(start,direction,1.4),true).length};
    }));
    window.review={
      north(){camera.position.set(-4,21.3,-82);camera.lookAt(-4,19.5,-42);renderer.render(scene,camera);},
      interior(){camera.position.set(0,18.42,-38.5);camera.lookAt(0,18.7,-55);renderer.render(scene,camera);},
      breach(){world.breachNorthWall();scene.updateMatrixWorld(true);this.north();},
      result:{traces,charge:SIHANG_DEMOLITION_POINT,flag:world.landmarks.warehouse.roofFlag.children[0].geometry.parameters.height,
        error:renderer.getContext().getError()}
    };window.review.north();window.ready=true;
    </script>` }));
  await page.goto(new URL('/__north-facade.html', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  const result = await page.evaluate(() => review.result);
  assert.equal(result.traces.length, 16); assert.ok(result.traces.every(trace => trace.hits === 0), JSON.stringify(result));
  assert.equal(result.flag, 7); assert.equal(result.charge.x, 0); assert.equal(result.error, 0);
  await page.screenshot({ path: join(directory, 'sihang-reference-north-exterior.png') });
  await page.evaluate(() => review.interior());
  await page.screenshot({ path: join(directory, 'sihang-reference-north-interior.png') });
  await page.evaluate(() => review.breach());
  await page.screenshot({ path: join(directory, 'sihang-reference-north-breached.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'sihang-reference-north.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, ...result }));
} finally { await browser.close(); }
