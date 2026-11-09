import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
  await page.route('**/__atmosphere-review.html', route => route.fulfill({ contentType: 'text/html', body: `
    <style>body{margin:0}canvas{display:block}</style><script type="module">
    import * as THREE from '/node_modules/three/build/three.module.js';
    import {makeWorld} from '/src/battlefield.js';
    import {createCivilianCharacterFactory,updateCivilianAppearance} from '/src/civilian-character.js';
    import {advanceCivilianMotion} from '/src/civilian-motion.js';
    import {loadSceneMaterials} from '/src/materials.js';
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    renderer.setSize(1280,720);renderer.setPixelRatio(1);document.body.append(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(55,1280/720,.05,800);
    let scene,world,surface,sky,people=[],travel=0,clock=0;
    function fresh(){
      if(scene)scene.traverse(object=>{object.geometry?.dispose();});
      scene=new THREE.Scene();scene.background=new THREE.Color(0x9ca8a3);
      scene.add(new THREE.HemisphereLight(0xffefd7,0x59645b,2.1));
      const sun=new THREE.DirectionalLight(0xffeed9,2.3);sun.position.set(-20,40,-30);scene.add(sun);
    }
    window.review={
      async map(campaign){
        fresh();
        if(!surface){surface=await loadSceneMaterials(renderer,scene,{lowMemory:true});sky=scene.background;}
        else scene.background=sky;
        world=makeWorld(scene,surface,
          campaign==='town'?{}:{campaign});
        world.buildingFire.update(12.4);
        const source=world.buildingFire.sources[0];
        camera.position.set(source.x+(campaign==='town'?10:6),campaign==='town'?7:3.8,source.z+(campaign==='town'?12:-2));
        camera.lookAt(source.x,2.2,source.z);
        renderer.render(scene,camera);
        const gl=renderer.getContext(),pixels=new Uint8Array(1280*720*4);
        gl.readPixels(0,0,1280,720,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let warm=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i]>150&&pixels[i]>pixels[i+1]*1.3&&pixels[i+1]>pixels[i+2]*1.2)warm++;
        return {campaign,warm,fire:world.buildingFire.snapshot,craters:world.staticDamage.craters.length,
          calls:renderer.info.render.calls,error:gl.getError()};
      },
      crater(){
        const crater=world.staticDamage.craters[0];
        camera.position.set(crater.x+5,3.5,crater.z+4);camera.lookAt(crater.x,-.15,crater.z);
        renderer.render(scene,camera);
      },
      civilians(){
        fresh();people=[];clock=travel=0;
        const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x8a857a}));
        floor.rotation.x=-Math.PI/2;floor.position.y=-.008;scene.add(floor);
        const grid=new THREE.GridHelper(100,100,0x5d5a50,0x777368);grid.position.y=-.004;scene.add(grid);
        const factory=createCivilianCharacterFactory();
        const roles=[['adult','man','none'],['adult','woman','none'],['elderly','man','luggage'],
          ['elderly','woman','none'],['child','woman','none'],['adult','woman','child']];
        roles.forEach((role,index)=>{
          const person=factory.create(index,...role);person.position.x=(index-2.5)*.8;
          Object.assign(person.userData,{civilianId:index,ageGroup:role[0],carrying:role[2],walkPhase:index*.8});
          people.push(person);scene.add(person);
        });
      },
      gait(speed,frames){
        for(let frame=0;frame<frames;frame++){
          clock+=1/60;travel+=speed/60;
          for(const person of people){
            person.position.z-=speed/60;
            advanceCivilianMotion(person,{dt:1/60,now:clock,moved:speed/60,dz:-speed/60,mode:speed>2?'flee':'street'});
          }
        }
        camera.position.set(5,2,-travel-5.8);camera.lookAt(0,.8,-travel);
        updateCivilianAppearance(people,camera);renderer.render(scene,camera);
        return people.map(person=>({mode:person.userData.escapeMode,knee:person.civilianSkin.joints.leftKnee.rotation.x,
          z:person.position.z,lift:person.userData.escapeMotion.feet[0].lift}));
      }
    };window.ready=true;
    </script>` }));
  await page.goto(new URL('/__atmosphere-review.html', process.env.GAME_URL ?? 'http://127.0.0.1:5353').href);
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  const maps = [];
  for (const campaign of ['town', 'sihang', 'nanjing']) {
    const result = await page.evaluate(campaign => review.map(campaign), campaign);
    await page.screenshot({ path: join(directory, campaign + '-burning-buildings.png') });
    assert.ok(result.fire.sources > 0 && result.fire.drawCalls === 2);
    assert.ok(result.warm > 15, JSON.stringify(result));
    assert.equal(result.error, 0); assert.ok(result.craters >= 5);
    await page.evaluate(() => review.crater());
    await page.screenshot({ path: join(directory, campaign + '-shell-crater.png') });
    maps.push(result);
  }
  for (const [mode, speed] of [['walk', 1.1], ['run', 3.2]]) {
    await page.evaluate(() => review.civilians());
    await page.evaluate(speed => review.gait(speed, 90), speed);
    const poses = [];
    for (let frame = 0; frame < 4; frame++) {
      poses.push(await page.evaluate(speed => review.gait(speed, 8), speed));
      await page.screenshot({ path: join(directory, 'civilian-' + mode + '-' + frame + '.png') });
    }
    assert.ok(poses.flat().some(pose => pose.knee < -.5));
    assert.ok(poses[3][0].z < poses[0][0].z - .3);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, maps }));
} finally { await browser.close(); }
