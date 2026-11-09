import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from 'three';
import { warmBattleRendering } from '../src/battle-render-warmup.js';

test('preparation renders real onscreen shader variants, waits without blocking, and restores camera and views', async () => {
  const camera = new PerspectiveCamera(); camera.rotation.y = .3;
  const original = camera.quaternion.clone();
  let draws = 0, released = 0, polls = 0, yields = 0, currentTarget = 'previous';
  const gl = { SYNC_GPU_COMMANDS_COMPLETE: 1, CONDITION_SATISFIED: 2, ALREADY_SIGNALED: 3, WAIT_FAILED: 4,
    fenceSync: () => ({}), flush() {}, isContextLost: () => false,
    clientWaitSync: () => ++polls % 2 ? 0 : 2, deleteSync() { released++; } };
  const result = await warmBattleRendering({ camera, scene: {}, renderer: {
    getContext: () => gl, getRenderTarget: () => currentTarget,
    setRenderTarget: value => { currentTarget = value; }, async compileAsync() {},
    render() { assert.equal(currentTarget, null); draws++; },
  }, update() {}, yieldTask: async () => { yields++; }, prepareViews: () => () => {} });
  assert.equal(result.draws, 5); assert.equal(draws, 5); assert.equal(released, 5);
  assert.ok(yields >= 10); assert.equal(currentTarget, 'previous');
  assert.deepEqual(camera.quaternion.toArray(), original.toArray());
});
