import test from 'node:test';
import assert from 'node:assert/strict';
import { installRenderWorkProbe, renderWorkWindow } from '../scripts/render-work-probe.mjs';

function fixture(options = { passes: true }) {
  let now = 0, ratio = 1;
  const gl = { bufferSubData() { return 7; }, texImage2D() {} };
  const info = { calls: 0, triangles: 0, lines: 0, points: 0 };
  const target = { performance: { now: () => now } };
  const object = { id: 1, name: 'body', type: 'InstancedMesh', castShadow: true };
  const material = { id: 2, type: 'MeshStandardMaterial', transparent: false, side: 0, forceSinglePass: false };
  const renderer = {
    domElement: { width: 1280, height: 720 },
    getContext() { return gl; },
    getPixelRatio() { return ratio; },
    setPixelRatio(value) { ratio = value; this.domElement.width = 1280 * ratio; this.domElement.height = 720 * ratio; },
    info: { render: info },
    renderBufferDirect(camera, scene, geometry, material, object) {
      assert.equal(this, renderer); info.calls++; info.triangles += 12; now++;
      if (this.fail) throw new Error('draw failed');
      return object.id;
    },
    shadowMap: { render() { renderer.renderBufferDirect(null, null, { id: 3 }, material, object); } },
    render(...args) {
      assert.equal(this, renderer);
      gl.bufferSubData();
      this.shadowMap.render();
      for (const key of Object.keys(info)) info[key] = 0;
      this.renderBufferDirect(...args, { id: 3 }, material, object);
      gl.texImage2D();
      return 42;
    },
  };
  const original = { render: renderer.render, shadow: renderer.shadowMap.render, direct: renderer.renderBufferDirect,
    ratio: renderer.setPixelRatio, upload: gl.bufferSubData };
  installRenderWorkProbe(options, target); target.__attachRenderWorkProbe(renderer);
  return { target, renderer, gl, original };
}

test('pass counters retain shadow draws despite renderer info reset and capture actual submissions', () => {
  const { target, renderer, gl } = fixture();
  const before = target.__renderWorkProbe;
  target.__beginRenderWorkCapture();
  assert.equal(renderer.render(null, null), 42);
  assert.equal(gl.bufferSubData(), 7);
  const window = renderWorkWindow(before, target.__renderWorkProbe), event = window.events[0];
  assert.equal(event.shadow.calls, 1); assert.equal(event.shadow.triangles, 12);
  assert.equal(event.main.calls, 1); assert.equal(event.main.triangles, 12);
  assert.equal(event.setup.uploads.bufferSubData, 1); assert.equal(event.main.uploads.texImage2D, 1);
  assert.equal(event.shadowEntries, 1); assert.equal(event.shadowCpuMs, 1);
  assert.equal(event.shadow.objects[0].name, 'body');
  window.events[0].shadow.objects[0].name = 'changed';
  assert.equal(target.__renderWorkProbe.events[0].shadow.objects[0].name, 'body');
  renderer.render(null, null); renderer.render(null, null); renderer.render(null, null);
  assert.equal(target.__renderWorkProbe.events.filter(event => event.detailed).length, 3);
  assert.equal(target.__renderWorkProbe.events[3].main.objects.length, 0);
});

test('buffer scaling preserves requested ratio and restores exact controls and all probe methods', () => {
  const { target, renderer, gl, original } = fixture({ passes: true, backbufferScale: .5 });
  assert.equal(renderer.domElement.width, 640);
  renderer.setPixelRatio(1.6);
  assert.equal(renderer.getPixelRatio(), .8);
  renderer.render(null, null);
  target.__stopRenderWorkProbe();
  assert.equal(renderer.render, original.render); assert.equal(renderer.shadowMap.render, original.shadow);
  assert.equal(renderer.renderBufferDirect, original.direct); assert.equal(gl.bufferSubData, original.upload);
  assert.equal(renderer.setPixelRatio, original.ratio); assert.equal(renderer.getPixelRatio(), 1.6);
  target.__stopRenderWorkProbe();
  assert.equal(target.__renderWorkProbe.stopped, true);
});

test('buffer-only runs do not instrument render or WebGL work; exceptions remain visible', () => {
  const simple = fixture({ backbufferScale: .5 });
  assert.equal(simple.renderer.render, simple.original.render);
  assert.equal(simple.gl.bufferSubData, simple.original.upload);
  const { target, renderer } = fixture();
  renderer.fail = true;
  assert.throws(() => renderer.render(null, null), /draw failed/);
  assert.equal(target.__renderWorkProbe.events[0].threw, true);
  renderer.fail = false; renderer.render(null, null);
  assert.equal(target.__renderWorkProbe.events[1].main.calls, 1);
  target.__stopRenderWorkProbe();
  assert.throws(() => installRenderWorkProbe({ backbufferScale: .8 }, {}), TypeError);
  assert.throws(() => installRenderWorkProbe({}, target), /already installed/);
});
