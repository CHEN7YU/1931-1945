import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/__civilian-review.html', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
    <style>body{margin:0;background:#c9c4b8;font:18px sans-serif}
    #label{position:fixed;top:20px;left:25px;color:#292d2a}canvas{display:block}</style>
    <div id="label">Civilian character review - original procedural skinned models</div>
    <script type="module">
    import * as THREE from '/node_modules/three/build/three.module.js';
    import {createCivilianCharacterFactory,updateCivilianAppearance} from '/src/civilian-character.js';
    import {advanceCivilianMotion} from '/src/civilian-motion.js';
    const renderer=new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(1440,900); renderer.setPixelRatio(1);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    const scene=new THREE.Scene(); scene.background=new THREE.Color(0xc9c4b8);
    scene.add(new THREE.HemisphereLight(0xfff5e4,0x69716a,2.4));
    const light=new THREE.DirectionalLight(0xffefd7,3); light.position.set(-3,6,-5);scene.add(light);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x9d9a8d}));
    floor.rotation.x=-Math.PI/2;floor.position.y=-.008;scene.add(floor);
    const camera=new THREE.PerspectiveCamera(38,1440/900,.05,250);
    const factory=createCivilianCharacterFactory(),people=[];
    const roles=[['adult','man','none'],['adult','woman','none'],['elderly','man','luggage'],
      ['elderly','woman','none'],['child','woman','none'],['child','man','none'],['adult','woman','child']];
    for(let i=0;i<roles.length;i++){
      const person=factory.create(i+2,...roles[i]);person.position.set((i-3)*.65,0,0);
      Object.assign(person.userData,{civilianId:i,ageGroup:roles[i][0],carrying:roles[i][2],walkPhase:i});
      people.push(person);scene.add(person);
    }
    window.review={
      render(mode){
        if(mode==='cower')for(let frame=0;frame<60;frame++)for(const person of people)
          advanceCivilianMotion(person,{dt:1/60,now:frame/60,moved:0,mode:'cower'});
        if(mode==='face'){camera.position.set(-2.01,1.53,-.85);camera.lookAt(-1.95,1.57,0);}
        else {camera.position.set(1.7,2.15,-7.2);camera.lookAt(0,.84,0);}
        updateCivilianAppearance(people,camera);renderer.render(scene,camera);
        return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
      },
      crowd(){
        for(const person of people)scene.remove(person);
        const crowd=[];
        for(let i=0;i<180;i++){
          const person=factory.create(i,'adult',i%2?'man':'woman','none');
          person.position.set((i%18-9)*.8,0,45+Math.floor(i/18)*.9);
          scene.add(person);crowd.push(person);
        }
        camera.position.set(0,8,-3);camera.lookAt(0,1,50);
        updateCivilianAppearance(crowd,camera,'low');renderer.render(scene,camera);
        return {far:crowd.filter(p=>p.civilianSkin.level==='far').length,calls:renderer.info.render.calls,
          triangles:renderer.info.render.triangles,templates:factory.templates.size};
      }
    };
    window.ready=true;
    </script>` }));
  await page.goto(`${process.env.GAME_URL || 'http://127.0.0.1:5173'}/__civilian-review.html`);
  await page.waitForFunction(() => window.ready);
  const gallery = await page.evaluate(() => review.render('gallery'));
  if (process.env.CIVILIAN_ARTIFACT_DIR) {
    await mkdir(process.env.CIVILIAN_ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-gallery.png') });
    await page.evaluate(() => review.render('face'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-face.png') });
    await page.evaluate(() => review.render('cower'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-cower.png') });
  }
  const crowd = await page.evaluate(() => review.crowd());
  console.log(JSON.stringify({ gallery, crowd, errors }));
  assert.equal(gallery.calls, 8, 'seven detailed people and one floor must use eight actual GPU draws');
  assert.equal(crowd.far, 180);
  assert.equal(crowd.calls, 181, 'far civilians must use one GPU draw per visible person');
  assert.ok(crowd.triangles < 400000, '180 far civilians must stay under the geometry budget');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors }));
  throw error;
} finally {
  await browser.close();
}
