import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createUniformStudy, disposeUniformStudy } from './model.js';
import { createStudySurface } from './surfaces.js';
import { loadStudyAppearance } from './skin.js';
import research from './research.json';
import './style.css';

const $ = id => document.getElementById(id);
let renderer, controls, study, scene, camera, observer;
let fatal = null, ready = false, drawCalls = 0, triangles = 0;
const fail = error => {
  console.error(error);
  fatal = error instanceof Error ? error.message : String(error);
  ready = false;
  $('error').hidden = false; $('error').textContent = `静态样件未能显示：${fatal}`;
  $('metrics').textContent = '显示失败；没有使用替代人物';
  document.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
};

function fillEvidence(id) {
  const source = research.sources.find(item => item.id === id);
  if (!source) throw new Error(`Unknown study evidence: ${id}`);
  $('item-label').textContent = source.item;
  $('item-title').textContent = source.title;
  for (const key of ['finding', 'application', 'uncertainty']) $(key).textContent = source[key];
  $('source-link').href = source.url;
  document.querySelectorAll('[data-part]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.part === id)));
}

function populateResearch() {
  for (const source of research.sources) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.part = source.id; button.textContent = source.title;
    button.addEventListener('click', () => fillEvidence(source.id)); $('part-tabs').append(button);
  }
  for (const limitation of research.limitations) {
    const li = document.createElement('li'); li.textContent = limitation; $('limitations').append(li);
  }
  for (const item of research.excluded) {
    const li = document.createElement('li'), link = document.createElement('a');
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = item.item;
    li.append(link, document.createTextNode(`：${item.reason}`)); $('excluded').append(li);
  }
  $('candidate-note').textContent = `${research.candidate.title}（${research.candidate.author}）标注${research.candidate.license}，约8,163个三角面、5个材质、0动画。${research.candidate.reason}因此暂未导入。`;
  $('candidate-link').href = research.candidate.url;
  fillEvidence('uniform');
}

const views = {
  front: { position: [0, 1.10, 3.45], target: [0, .89, 0] },
  side: { position: [-3.45, 1.10, 0], target: [0, .89, 0] },
  back: { position: [0, 1.10, -3.45], target: [0, .89, 0] },
  detail: { position: [.68, 1.58, 1.2], target: [0, 1.37, 0] },
  'three-quarter': { position: [2.4, 1.40, 3.3], target: [0, .9, 0] },
};

function setView(name) {
  const view = views[name];
  if (!view) throw new Error(`Unknown study view: ${name}`);
  camera.position.set(...view.position); controls.target.set(...view.target); controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
}

function render() {
  if (fatal) return;
  try {
    renderer.render(scene, camera);
    drawCalls = renderer.info.render.calls; triangles = renderer.info.render.triangles;
    ready = true;
    $('metrics').textContent = `${drawCalls} 次绘制 · 静态研究专用`;
  } catch (error) { fail(error); }
}

Object.defineProperty(window, '__uniformStudy', { get: () => ({
  ready, fatal, studyOnly: true, battlefieldConnected: false, rigged: false,
  skinBaked: Boolean(study?.groups.head.getObjectByName('licensed-static-head-and-hands')?.userData.staticBaked),
  tailoredUpperBody: Boolean(study?.root.getObjectByName('standing-collar-tunic')?.userData.adaptedSourceGarment),
  balancedSilhouette: Boolean(study?.root.userData.balancedSilhouette),
  helmetVisible: study?.groups.helmet.visible ?? false,
  equipmentVisible: study?.groups.equipment.visible ?? false,
  selectedPart: document.querySelector('[data-part][aria-pressed="true"]')?.dataset.part ?? null,
  camera: camera?.position.toArray() ?? null, target: controls?.target.toArray() ?? null,
  drawCalls, triangles, rendererSize: renderer ? renderer.getSize(new THREE.Vector2()).toArray() : null,
}) });

try {
  if (!import.meta.env.DEV) throw new Error('This independent study is development-only');
  populateResearch();
  renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color(0x2a2e2b);
  scene.fog = new THREE.Fog(0x2a2e2b, 8, 24);
  const environment = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  const environmentTarget = pmrem.fromScene(environment, .04);
  scene.environment = environmentTarget.texture; scene.environmentIntensity = .35;
  environment.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe7ebee, 0x67675f, 1.0));
  const key = new THREE.DirectionalLight(0xfff7ee, 2.6);
  key.position.set(-2, 4, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -1, near: .1, far: 12 });
  key.shadow.bias = -.0001; key.shadow.normalBias = .0015; key.shadow.radius = 3; key.target.position.set(0, .8, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xdfe7ef, 1.2); rim.position.set(2, 3, -3); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x292e29, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.075; floor.receiveShadow = true; scene.add(floor);
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(.54, .56, .075, 80),
    new THREE.MeshStandardMaterial({ color: 0x343a32, roughness: .93 }));
  pedestal.position.y = -.038; pedestal.receiveShadow = true; scene.add(pedestal);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.515, .0016, 6, 80),
    new THREE.MeshStandardMaterial({ color: 0x827d55, roughness: .75 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .001; scene.add(ring);
  $('metrics').textContent = '正在载入静态改制上衣与头手…';
  const appearance = await loadStudyAppearance();
  study = createUniformStudy({ upperBody: appearance.upperBody, textures: {
    cloth: createStudySurface('cloth'), leather: createStudySurface('leather'), paint: createStudySurface('paint'),
  } });
  study.groups.head.add(appearance.skin);
  scene.add(study.root);
  camera = new THREE.PerspectiveCamera(33, 1, .03, 30);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.enablePan = false; controls.minDistance = .7; controls.maxDistance = 5.5;
  controls.maxPolarAngle = Math.PI * .55;
  setView('three-quarter');
  controls.addEventListener('change', render);
  controls.addEventListener('start', () => {
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  for (const id of ['helmet', 'equipment']) $(`${id}-toggle`).addEventListener('change', event => {
    study.groups[id].visible = event.target.checked;
    render();
  });
  const resize = () => {
    const { width, height } = $('viewport').getBoundingClientRect();
    if (width <= 0 || height <= 0) throw new Error('Study viewport has no drawable area');
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    render();
  };
  observer = new ResizeObserver(() => { try { resize(); } catch (error) { fail(error); } });
  observer.observe($('viewport')); resize();
  $('stage').addEventListener('webglcontextlost', event => {
    event.preventDefault();
    fail(new Error('WebGL context lost; reload the study to restore it'));
  });
  addEventListener('pagehide', event => {
    if (event.persisted) return;
    observer.disconnect(); controls.dispose();
    const textures = new Set();
    scene.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        for (const key of ['map', 'normalMap', 'roughnessMap']) if (material[key]) textures.add(material[key]);
      }
    });
    textures.forEach(texture => texture.dispose());
    environmentTarget.dispose();
    disposeUniformStudy(scene);
    renderer.dispose();
  });
} catch (error) { fail(error); }
