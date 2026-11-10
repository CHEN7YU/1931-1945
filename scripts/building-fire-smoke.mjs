import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__building-fire-review.html', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}canvas{display:block}</style><script type="module">
    import * as THREE from '/node_modules/three/build/three.module.js';
    import {makeWorld} from '/src/battlefield.js';
    import {loadSceneMaterials} from '/src/materials.js';
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1280,720);document.body.append(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(55,1280/720,.05,800);
    let scene,world,surface,sky;
    window.review={
      async map(campaign){
        if(scene)scene.traverse(object=>object.geometry?.dispose());
        scene=new THREE.Scene();scene.background=new THREE.Color(0x9ca8a3);
        scene.add(new THREE.HemisphereLight(0xffefd7,0x59645b,2.1));
        const sun=new THREE.DirectionalLight(0xffeed9,2.3);sun.position.set(-20,40,-30);scene.add(sun);
        if(!surface){surface=await loadSceneMaterials(renderer,scene,{lowMemory:true});sky=scene.background;}
        else scene.background=sky;
        world=makeWorld(scene,surface,campaign==='town'?{}:{campaign});
      },
      frame(time,low=false,smoke=true,angle=0){
        world.buildingFire.update(time,{low,smoke});
        const source=world.buildingFire.sources[0];
        camera.position.set(source.x+Math.cos(angle)*5,source.y+6,source.z+Math.sin(angle)*5);
        camera.lookAt(source.x,source.y+.8,source.z);
        renderer.render(scene,camera);
        const gl=renderer.getContext(),pixels=new Uint8Array(1280*720*4);
        gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let warm=0,checksum=0;
        for(let i=0;i<pixels.length;i+=4){
          if(pixels[i]>150&&pixels[i]>pixels[i+1]*1.3&&pixels[i+1]>pixels[i+2]*1.2)warm++;
          checksum=(checksum+pixels[i]*(i%251+1)+pixels[i+1]*3)>>>0;
        }
        const meshes=['damaged-building-flames','damaged-building-smoke'].map(name=>scene.getObjectByName(name));
        const ext=gl.getExtension('WEBGL_debug_renderer_info');
        return {warm,checksum,fire:world.buildingFire.snapshot,error:gl.getError(),
          gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
          programs:renderer.info.programs.map(program=>program.diagnostics?.runnable!==false),
          finite:meshes.every(mesh=>Array.from(mesh.instanceMatrix.array).every(Number.isFinite)),
          smokeVisible:meshes[1].visible};
      }
    };window.ready=true;
    </script>` }));
  await page.goto(new URL('/__building-fire-review.html', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  const results = [];
  for (const campaign of ['town', 'sihang', 'nanjing']) {
    await page.evaluate(campaign => review.map(campaign), campaign);
    const high = await page.evaluate(() => review.frame(12.4, false, true, .8));
    const paused = await page.evaluate(() => review.frame(12.4, false, true, .8));
    assert.equal(high.checksum, paused.checksum, 'paused fire pixels must be deterministic');
    await page.screenshot({ path: join(directory, campaign + '-fire-high.png') });
    const moved = await page.evaluate(() => review.frame(12.9, false, true, .8));
    assert.notEqual(high.checksum, moved.checksum, 'flame geometry and glow must animate');
    const reverse = await page.evaluate(() => review.frame(12.4, false, true, -.8));
    await page.screenshot({ path: join(directory, campaign + '-fire-reverse.png') });
    const low = await page.evaluate(() => review.frame(12.4, true, false, .8));
    await page.screenshot({ path: join(directory, campaign + '-fire-low-no-smoke.png') });
    assert.equal(high.fire.drawCalls, 2);
    assert.equal(low.fire.drawCalls, 1);
    assert.equal(low.fire.smoke, 0);
    assert.equal(low.smokeVisible, false);
    assert.ok(low.fire.flames < high.fire.flames && low.fire.flames >= low.fire.sources * 10);
    assert.ok(high.warm > 30 && reverse.warm > 30 && low.warm > 30,
      JSON.stringify({ campaign, high: high.warm, reverse: reverse.warm, low: low.warm }));
    for (const frame of [high, paused, moved, reverse, low]) {
      assert.equal(frame.error, 0); assert.ok(frame.finite && frame.programs.every(Boolean));
    }
    results.push({ campaign, high, reverse, low });
  }
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'building-fire-results.json'), JSON.stringify({ passed: true, results }, null, 2));
  console.log(JSON.stringify({ passed: true, results }));
} finally { await browser.close(); }
