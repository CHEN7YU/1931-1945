import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadNraUniformStudy, disposeNraUniformStudy } from './model.js';
import './style.css';

const $ = id => document.getElementById(id);
let renderer, scene, camera, controls, observer, environmentTarget, study;
let mode = 'compare', view = 'three-quarter', fatal = null, ready = false;
const fail = error => {
  console.error(error);
  fatal = error instanceof Error ? error.message : String(error); ready = false;
  $('error').hidden = false; $('error').textContent = `样件加载失败：${fatal}`;
  $('status').textContent = '未显示替代人物，请刷新重试。';
  document.querySelectorAll('button, input').forEach(element => { element.disabled = true; });
};
const render = () => {
  if (fatal || !renderer || !camera) return;
  try { renderer.render(scene, camera); ready = true; } catch (error) { fail(error); }
};

function setView(name) {
  const wide = mode === 'compare', width = $('viewport').clientWidth, height = $('viewport').clientHeight;
  const distance = Math.max(wide ? 5.2 : 4.25, (wide ? 3.5 : 1.7) / (width / height));
  const views = {
    front: [0, 1.12, distance],
    'three-quarter': [distance * .20, 1.26, distance],
    side: [-distance, 1.16, .08],
    back: [0, 1.2, -distance],
    detail: [wide ? .15 : .28, 1.4, wide ? Math.max(2.5, 2.8 / (width / height)) : 1.08],
  };
  if (!views[name]) throw new Error(`Unknown study view: ${name}`);
  view = name;
  $('labels').classList.toggle('detail', name === 'detail');
  const targetY = name === 'detail' ? 1.30 : .90;
  const aspect = width / height;
  const frameHeight = Math.max(name === 'detail' ? wide ? 1.12 : .70 : 2.6,
    (wide ? 2.15 : name === 'detail' ? .6 : 1.04) / aspect);
  camera.left = -frameHeight * aspect / 2; camera.right = frameHeight * aspect / 2;
  camera.top = frameHeight / 2; camera.bottom = -frameHeight / 2;
  camera.zoom = 1; camera.updateProjectionMatrix();
  // Rotate both turntables together; a side camera would make the two figures occlude one another.
  const angle = name === 'side' ? Math.PI / 2 : name === 'back' ? Math.PI : 0;
  study.baseline.rotation.y = study.remake.rotation.y = angle;
  const position = name === 'side' || name === 'back' ? [0, 1.18, distance] : views[name];
  camera.position.set(...position); controls.target.set(0, targetY, 0); controls.update();
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  render();
}

function setMode(name) {
  if (!['compare', 'remake'].includes(name)) throw new Error(`Unknown study mode: ${name}`);
  mode = name;
  study.baseline.visible = mode === 'compare';
  study.baseline.position.x = -.52; study.remake.position.x = mode === 'compare' ? .52 : 0;
  $('original-label').hidden = mode !== 'compare';
  $('labels').classList.toggle('solo', mode !== 'compare');
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  setView(view);
}

Object.defineProperty(window, '__nraUniformStudy', { get: () => ({
  ready, fatal, mode, view, studyOnly: true, battlefieldConnected: false, staticOnly: true,
  changedVertices: study?.changedVertices ?? 0,
  originalVisible: study?.baseline.visible ?? false,
  equipmentVisible: $('equipment').checked,
  camera: camera?.position.toArray() ?? null,
  triangles: renderer?.info.render.triangles ?? 0,
  rendererSize: renderer ? renderer.getSize(new THREE.Vector2()).toArray() : null,
}) });

try {
  if (!import.meta.env.DEV) throw new Error('This independent uniform study is development-only');
  renderer = new THREE.WebGLRenderer({ canvas: $('stage'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene(); scene.background = new THREE.Color('#e9e7df');
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  environmentTarget = pmrem.fromScene(room, .04); scene.environment = environmentTarget.texture;
  scene.environmentIntensity = .35; room.dispose(); pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8171, .9));
  const key = new THREE.DirectionalLight(0xfff8ec, 2.2);
  key.position.set(-2.8, 4.5, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2.6, bottom: -1, near: .1, far: 12 });
  key.shadow.normalBias = .002; key.shadow.bias = -.0001; key.target.position.y = .8;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xe9efff, .8); fill.position.set(3, 2.5, -2); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: '#deded4', roughness: 1 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.045; floor.receiveShadow = true; scene.add(floor);
  study = await loadNraUniformStudy();
  scene.add(study.baseline, study.remake);
  for (const root of [study.baseline, study.remake]) {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(.37, .39, .04, 80),
      new THREE.MeshStandardMaterial({ color: '#c4c6b7', roughness: .95 }));
    plinth.position.y = -.023; plinth.receiveShadow = true; root.add(plinth);
  }
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .02, 50);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.minDistance = .65; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * .54;
  controls.minZoom = .5; controls.maxZoom = 4;
  controls.addEventListener('change', render);
  controls.addEventListener('start', () => {
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', 'false'));
  });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $('equipment').addEventListener('change', () => {
    for (const root of [study.baseline, study.remake]) root.traverse(node => {
      if (node.userData.equipment) node.visible = $('equipment').checked;
    });
    render();
  });
  const resize = () => {
    const { width, height } = $('viewport').getBoundingClientRect();
    if (width <= 0 || height <= 0) throw new Error('Uniform viewport has no drawable area');
    renderer.setSize(width, height, false); setView(view);
  };
  observer = new ResizeObserver(() => { try { resize(); } catch (error) { fail(error); } });
  observer.observe($('viewport'));
  setMode(window.matchMedia('(max-width: 600px)').matches ? 'remake' : 'compare'); resize();
  $('status').textContent = '已载入 · 本页为静态衣装对照';
  $('stage').addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('WebGL context lost; reload to restore')); });
} catch (error) { fail(error); }

addEventListener('pagehide', event => {
  if (event.persisted) return;
  observer?.disconnect(); controls?.dispose(); environmentTarget?.dispose();
  if (scene) disposeNraUniformStudy(scene);
  renderer?.dispose();
});
