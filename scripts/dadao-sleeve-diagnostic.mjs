import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const directory = process.env.ARTIFACT_DIR;
if (!directory) throw new Error('ARTIFACT_DIR is required for the sleeve diagnostic');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const base = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5203');
  await page.route(new URL('/__sleeve-diagnostic', base).href, route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#171c19"></body>',
  }));
  await page.goto(new URL('/__sleeve-diagnostic', base).href);
  const report = await page.evaluate(async () => {
    const T = await import('/node_modules/.vite/deps/three.js');
    const { FBXLoader } = await import('/node_modules/three/examples/jsm/loaders/FBXLoader.js');
    const { prepareNraRig } = await import('/src/nra-rig.js');
    const { createNraGrenadeHand } = await import('/src/nra-hand.js');
    const { dadaoViewModel, updateDadaoView } = await import('/src/dadao-model.js');
    const { loadDadaoSurfaces } = await import('/src/dadao-surface.js');
    const manager = new T.LoadingManager();
    manager.addHandler(/\.(png|jpe?g|dds)$/i, { setPath() { return this; }, load() { return new T.Texture(); } });
    const model = await new FBXLoader(manager).loadAsync('/assets/game/nra-88/character.fbx');
    const rig = prepareNraRig(model), source = new T.Group(), bounds = new T.Box3().setFromObject(model);
    source.scale.setScalar(1.78 / (bounds.max.y - bounds.min.y)); source.rotation.y = Math.PI;
    model.position.y -= bounds.min.y; source.add(model); source.updateMatrixWorld(true);
    const manifestResponse = await fetch('/assets/game/nra-88/source.json');
    if (!manifestResponse.ok) throw new Error(`Character manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json(), textures = new Map();
    for (const [id, file] of Object.entries(manifest.textures)) {
      const texture = await new T.TextureLoader().loadAsync(`/assets/game/nra-88/${file}`);
      texture.colorSpace = T.SRGBColorSpace; textures.set(id, texture);
    }
    for (const mesh of rig.meshes) {
      const materials = manifest.meshMaterials[mesh.name].map(id =>
        new T.MeshStandardMaterial({ map: textures.get(id), roughness: .9, side: T.DoubleSide }));
      mesh.material = materials.length === 1 ? materials[0] : materials;
    }
    await loadDadaoSurfaces(1);
    const view = dadaoViewModel((side, options) => createNraGrenadeHand(source, side, { fullArm: true, ...options }));
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(72, 1.6, .07, 20);
    const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1280, 800); renderer.setClearColor(0x171c19); document.body.append(renderer.domElement);
    scene.add(camera); camera.add(view);
    scene.add(new T.HemisphereLight(0xf2edd9, 0x424642, 2));
    const light = new T.DirectionalLight(0xffffff, 2); light.position.set(-1, 2, 2); scene.add(light);
    updateDadaoView(view, { phase: 'recover', progress: .3 }, { weaponX: 0, weaponY: 0 }, camera);
    const originalByName = new Map(rig.meshes.map(mesh => [mesh.name, mesh.geometry]));
    const diagnostics = new T.Group(), removed = new T.Group(); scene.add(diagnostics, removed);
    const reports = [], probe = new T.Vector3(), eye = camera.getWorldPosition(new T.Vector3());
    const vertexData = (mesh, index) => {
      const world = mesh.localToWorld(mesh.getVertexPosition(index, new T.Vector3()));
      const geometry = mesh.geometry;
      return { index, originalLocal: new T.Vector3().fromBufferAttribute(geometry.attributes.position, index).toArray(),
        world: world.toArray(), ndc: world.clone().project(camera).toArray(),
        weights: [0, 1, 2, 3].map(slot => ({
          bone: mesh.skeleton.bones[geometry.attributes.skinIndex.getComponent(index, slot)].name,
          weight: geometry.attributes.skinWeight.getComponent(index, slot),
        })) };
    };
    view.userData.dadaoArm.traverse(mesh => {
      if (!mesh.isSkinnedMesh || !mesh.visible || !['衣服', '臂章'].includes(mesh.name)) return;
      mesh.skeleton.update(); mesh.computeBoundingSphere(); mesh.computeBoundingBox();
      const original = originalByName.get(mesh.name), geometry = mesh.geometry;
      if (!geometry.index) throw new Error('Diagnostic currently requires source-preserving sleeve indices');
      const kept = new Set();
      for (let at = 0; at < geometry.index.count; at += 3) {
        kept.add([0, 1, 2].map(corner => geometry.index.getX(at + corner)).join(','));
      }
      const key = index => probe.fromBufferAttribute(original.attributes.position, index).toArray()
        .map(value => value.toFixed(4)).join(',');
      const edges = new Map(), triangles = [], rejected = [];
      for (let at = 0; at < (original.index?.count ?? original.attributes.position.count); at += 3) {
        const ids = [0, 1, 2].map(corner => original.index ? original.index.getX(at + corner) : at + corner);
        const included = kept.has(ids.join(','));
        const triangle = { id: at / 3, ids, included }; triangles.push(triangle);
        if (!included) rejected.push(...ids);
        for (let corner = 0; corner < 3; corner++) {
          const a = ids[corner], b = ids[(corner + 1) % 3], ka = key(a), kb = key(b);
          const edgeKey = [ka, kb].sort().join('|');
          if (!edges.has(edgeKey)) edges.set(edgeKey, { a, b, incidents: [] });
          edges.get(edgeKey).incidents.push(triangle);
        }
      }
      const artificial = [...edges.values()].filter(edge =>
        edge.incidents.some(triangle => triangle.included) && edge.incidents.some(triangle => !triangle.included));
      const positions = [], endpoints = [], degrees = new Map();
      for (const edge of artificial) {
        const a = vertexData(mesh, edge.a), b = vertexData(mesh, edge.b);
        positions.push(...a.world, ...b.world); endpoints.push({ a, b, triangles: edge.incidents });
        for (const index of [edge.a, edge.b]) degrees.set(key(index), (degrees.get(key(index)) ?? 0) + 1);
      }
      const lines = new T.LineSegments(new T.BufferGeometry().setAttribute('position',
        new T.Float32BufferAttribute(positions, 3)), new T.LineBasicMaterial({ color: 0xff3b57, depthTest: false }));
      diagnostics.add(lines);
      const boundaryKeys = new Set(artificial.flatMap(edge => [key(edge.a), key(edge.b)]));
      const neighbouringRemoved = triangles.filter(triangle => !triangle.included &&
        triangle.ids.some(index => boundaryKeys.has(key(index)))).flatMap(triangle => triangle.ids);
      const ghost = mesh.clone(); ghost.geometry = original.clone(); ghost.geometry.clearGroups(); ghost.geometry.setIndex(neighbouringRemoved);
      ghost.material = new T.MeshBasicMaterial({ color: 0xffbe55, side: T.DoubleSide, wireframe: true,
        transparent: true, opacity: .3, depthTest: false });
      const wrapper = new T.Group(); wrapper.matrixAutoUpdate = false;
      wrapper.matrix.copy(mesh.parent.matrixWorld); wrapper.add(ghost); removed.add(wrapper);
      const failing = mesh.name === '衣服' ? vertexData(mesh, 2598) : null;
      let closestBoundary = null;
      if (failing) {
        const point = new T.Vector3(...failing.world);
        for (const edge of endpoints) {
          const segment = new T.Line3(new T.Vector3(...edge.a.world), new T.Vector3(...edge.b.world));
          const distance = segment.closestPointToPoint(point, true, new T.Vector3()).distanceTo(point);
          if (!closestBoundary || distance < closestBoundary.distance) closestBoundary = { distance, edge };
        }
        const marker = new T.Mesh(new T.SphereGeometry(.007, 12, 8),
          new T.MeshBasicMaterial({ color: 0x5cff84, depthTest: false }));
        marker.position.copy(point); diagnostics.add(marker);
      }
      reports.push({ name: mesh.name, retainedTriangles: geometry.index.count / 3,
        rejectedTriangles: rejected.length / 3, artificialEdges: endpoints,
        boundaryDegrees: [...degrees], failing, closestBoundary,
        neighbours: failing ? triangles.filter(triangle => triangle.ids.some(index => key(index) === key(2598)))
          .map(triangle => ({ ...triangle, vertices: triangle.ids.map(index => vertexData(mesh, index)) })) : [] });
    });
    const arm = view.userData.dadaoArm, jointNames = ['Spine2', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'];
    const joints = Object.fromEntries(jointNames.map(name => {
      const world = arm.getObjectByName(name).getWorldPosition(new T.Vector3());
      const marker = new T.Mesh(new T.SphereGeometry(.012, 8, 6),
        new T.MeshBasicMaterial({ color: name === 'RightHand' ? 0x67e6ff : 0xc9acff, depthTest: false }));
      marker.position.copy(world); diagnostics.add(marker);
      return [name, { world: world.toArray(), ndc: world.clone().project(camera).toArray() }];
    }));
    const rigPositions = ['RightArm', 'RightForeArm', 'RightHand'].flatMap(name => joints[name].world);
    diagnostics.add(new T.Line(new T.BufferGeometry().setAttribute('position',
      new T.Float32BufferAttribute(rigPositions, 3)), new T.LineBasicMaterial({ color: 0xc9acff, depthTest: false })));
    window.renderSleeveDiagnostic = mode => {
      diagnostics.visible = mode !== 'normal'; removed.visible = mode === 'removed';
      renderer.render(scene, camera);
    };
    window.renderDadaoPose = (phase, progress) => {
      updateDadaoView(view, { phase, progress }, { weaponX: 0, weaponY: 0 }, camera);
      window.renderSleeveDiagnostic('normal');
    };
    window.renderSleeveDiagnostic('normal');
    return { phase: 'recover', progress: .3, camera: { fov: 72, aspect: 1.6, near: .07, far: 20 },
      eye: eye.toArray(), arm: arm.armSnapshot, joints, meshes: reports };
  });
  assert.ok(report.meshes.find(mesh => mesh.name === '衣服').closestBoundary.distance < .001,
    'the original failed vertex must be on an actual retained/rejected geometric boundary');
  for (const mode of ['normal', 'boundary', 'removed']) {
    await page.evaluate(mode => window.renderSleeveDiagnostic(mode), mode);
    await page.screenshot({ path: join(directory, `${mode}.png`) });
  }
  await page.evaluate(() => window.renderDadaoPose('cut', 1));
  await page.screenshot({ path: join(directory, 'cut-finish.png') });
  await writeFile(join(directory, 'diagnostic.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ phase: report.phase, progress: report.progress,
    meshes: report.meshes.map(mesh => ({ name: mesh.name, retainedTriangles: mesh.retainedTriangles,
      artificialEdges: mesh.artificialEdges.length, boundaryDistance: mesh.closestBoundary?.distance,
      boundaryDegrees: [...new Set(mesh.boundaryDegrees.map(([, degree]) => degree))] })) }));
} finally {
  await browser.close();
}
