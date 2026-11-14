import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { loadNraCharacter } from '../src/nra-character.js';
import { createNraMotion, advanceNraMotion } from '../src/nra-motion.js';
import { createRifleState } from '../src/rifle-action.js';

test('reusing a detailed friendly view does not accumulate procedural torso translation', async () => {
  const load = FBXLoader.prototype.loadAsync, textureLoad = THREE.TextureLoader.prototype.loadAsync;
  const originalFetch = globalThis.fetch, originalDocument = globalThis.document;
  FBXLoader.prototype.loadAsync = async function(url) {
    const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
    return this.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  };
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture({ width: 1, height: 1 });
  globalThis.document = { createElement: () => ({ getContext: () => ({
    drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray([128, 128, 128, 255]) }),
    putImageData() {},
  }) }) };
  globalThis.fetch = async url => new Response(await readFile(new URL(`../public${url}`, import.meta.url)));
  let template;
  try {
    template = await loadNraCharacter(() => 0);
  } finally {
    FBXLoader.prototype.loadAsync = load;
    THREE.TextureLoader.prototype.loadAsync = textureLoad;
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
  const actors = [0, 1].map(index => {
    const actor = { id: `soldier-${index}`, team: 'friendly', friendly: true, health: 100,
      formation: { memberCount: 11 }, index, position: new THREE.Vector3(index * 2, 0, 0),
      heading: index, walkPhase: 0, stance: 'standing', rifle: createRifleState(),
      locomotion: { speed: 4.1, mode: 'sprint' } };
    actor.nativeMotion = createNraMotion(template.motionProfile, actor);
    for (let i = 0; i < 80; i++) {
      actor.position.z -= 4.1 / 60;
      advanceNraMotion(actor, 1 / 60);
    }
    return actor;
  });
  const spine = view => {
    let mesh;
    view.root.traverse(node => { if (!mesh && node.isSkinnedMesh) mesh = node; });
    return mesh.skeleton.bones.find(bone => bone.name === 'Spine').position.clone();
  };
  const references = actors.map(actor => {
    const view = template.createView();
    view.bind(actor.id); view.update(actor, 2, null);
    assert.equal(view.issue, null);
    return spine(view);
  });
  const reused = template.createView();
  for (let i = 0; i < 30; i++) {
    const actor = actors[i % actors.length];
    reused.bind(actor.id); reused.update(actor, 2, null);
    assert.ok(spine(reused).distanceTo(references[i % actors.length]) < 1e-6,
      `rebind ${i} must use the same torso position as a fresh view`);
    assert.equal(reused.issue, null, `rebind ${i} must preserve reachable rifle grips`);
  }
});
