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
    const fill=new THREE.HemisphereLight(0xfff5e4,0x69716a,2.4);scene.add(fill);
    const light=new THREE.DirectionalLight(0xffefd7,3); light.position.set(-3,6,-5);scene.add(light);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x9d9a8d}));
    floor.rotation.x=-Math.PI/2;floor.position.y=-.008;scene.add(floor);
    const camera=new THREE.PerspectiveCamera(38,1440/900,.05,250);
    const factory=createCivilianCharacterFactory(),people=[];
    let crowd=[];
    const roles=[['adult','man','none'],['adult','woman','none'],['elderly','man','luggage'],
      ['elderly','woman','none'],['child','woman','none'],['child','man','none'],['adult','woman','child']];
    for(let i=0;i<roles.length;i++){
      const person=factory.create(i+2,...roles[i]);person.position.set((i-3)*.65,0,0);
      Object.assign(person.userData,{civilianId:i,ageGroup:roles[i][0],carrying:roles[i][2],walkPhase:i});
      people.push(person);scene.add(person);
    }
    window.review={
      render(mode){
        const fabric=mode==='fabric'||mode==='fabric-simple';
        fill.intensity=fabric?1:2.4;light.position.set(-3,fabric?3:6,fabric?-1:-5);
        if(mode==='cower')for(let frame=0;frame<60;frame++)for(const person of people)
          advanceCivilianMotion(person,{dt:1/60,now:frame/60,moved:0,mode:'cower'});
        if(mode==='face'){camera.position.set(-2.01,1.53,-.85);camera.lookAt(-1.95,1.57,0);}
        else if(mode==='face-angle'){camera.position.set(-2.5,1.6,-.75);camera.lookAt(-1.95,1.57,0);}
        else if(mode==='hands'||fabric){camera.position.set(-1.1,.9,-.85);camera.lookAt(-.9,.8,0);}
        else {camera.position.set(1.7,2.15,-7.2);camera.lookAt(0,.84,0);}
        updateCivilianAppearance(people,camera);
        if(mode==='fabric-simple')for(const person of people)person.civilianSkin.mesh.material=factory.simpleMaterial;
        renderer.render(scene,camera);
        return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
          detailed:people.filter(person=>person.civilianSkin.mesh.material.normalMap).length};
      },
      crowd(close=false){
        for(const person of people)scene.remove(person);
        for(const person of crowd)scene.remove(person);
        crowd=[];
        for(let i=0;i<180;i++){
          const person=factory.create(i,'adult',i%2?'man':'woman','none');
          person.position.set((i%18-9)*(close ? .3 : .8),0,(close?2:45)+Math.floor(i/18)*(close ? .35 : .9));
          scene.add(person);crowd.push(person);
        }
        camera.position.set(0,close?2:8,close?-1:-3);camera.lookAt(0,1,close?4:50);
        updateCivilianAppearance(crowd,camera,'low');renderer.render(scene,camera);
        return {far:crowd.filter(p=>p.civilianSkin.level==='far').length,calls:renderer.info.render.calls,
          triangles:renderer.info.render.triangles,templates:factory.templates.size,
          detailed:crowd.filter(person=>person.civilianSkin.mesh.material.normalMap).length};
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
    await page.evaluate(() => review.render('face-angle'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-face-angle.png') });
    await page.evaluate(() => review.render('hands'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-hands.png') });
    await page.evaluate(() => review.render('fabric-simple'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-fabric-before.png') });
    await page.evaluate(() => review.render('fabric'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-fabric-after.png') });
    await page.evaluate(() => review.render('cower'));
    await page.screenshot({ path: path.join(process.env.CIVILIAN_ARTIFACT_DIR, 'civilian-cower.png') });
  }
  const crowd = await page.evaluate(() => review.crowd());
  const nearCrowd = await page.evaluate(() => review.crowd(true));
  console.log(JSON.stringify({ gallery, crowd, nearCrowd, errors }));
  assert.equal(gallery.calls, 8, 'seven detailed people and one floor must use eight actual GPU draws');
  assert.equal(crowd.far, 180);
  assert.equal(crowd.calls, 181, 'far civilians must use one GPU draw per visible person');
  assert.ok(crowd.triangles < 400000, '180 far civilians must stay under the geometry budget');
  assert.equal(crowd.triangles, 309866, 'close-up detail must not add geometry to the existing distant-crowd fixture');
  assert.equal(crowd.detailed, 0, 'distant crowds must not run the surface-relief shader');
  assert.equal(nearCrowd.detailed, 8, 'low quality must bound normal-mapped civilians even inside a dense crowd');
  assert.ok(nearCrowd.calls <= 181, 'surface refinement must not add a second draw per person');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(JSON.stringify({ errors }));
  throw error;
} finally {
  await browser.close();
}
