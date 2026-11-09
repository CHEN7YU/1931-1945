import { yieldStartupTask } from './startup-work.js';

export async function warmBattleRendering({ renderer, scene, camera, update,
  prepareViews = () => () => {}, yieldTask = yieldStartupTask, onProgress = () => {} }) {
  const rotation = camera.quaternion.clone(), gl = renderer.getContext();
  const originalTarget = renderer.getRenderTarget();
  const started = performance.now();
  let draws = 0;
  try {
    renderer.setRenderTarget(null);
    for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
      await yieldTask();
      camera.quaternion.copy(rotation); camera.rotateY(angle); camera.updateMatrixWorld(true);
      update();
      const restore = prepareViews();
      try {
        await renderer.compileAsync(scene, camera);
        renderer.render(scene, camera); draws++;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!sync) throw new Error('Unable to synchronize battle render preparation');
        gl.flush();
        try {
          for (;;) {
            if (performance.now() - started > 120000) throw new Error('Battle render preparation exceeded its time limit');
            if (gl.isContextLost()) throw new Error('WebGL context lost during battle preparation');
            const status = gl.clientWaitSync(sync, 0, 0);
            if (status === gl.WAIT_FAILED) throw new Error('Battle render preparation synchronization failed');
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
            await yieldTask();
          }
        } finally { gl.deleteSync(sync); }
      } finally { restore(); }
      onProgress(draws / 5);
    }
    return { draws, milliseconds: performance.now() - started };
  } finally {
    camera.quaternion.copy(rotation); camera.updateMatrixWorld(true);
    renderer.setRenderTarget(originalTarget); update();
  }
}
