import test from 'node:test';
import assert from 'node:assert/strict';
import { installDriverProbe, driverProbeWindow } from '../scripts/driver-probe.mjs';

test('driver tracing preserves native arguments, return values, this and thrown errors without adding queries', () => {
  let now = 0, calls = 0;
  const failure = new Error('driver failure');
  class GL {
    constructor() { this.LINK_STATUS = 35714; }
    getProgramInfoLog(program) {
      assert.equal(arguments.length, 1); assert.ok(this instanceof GL); calls++;
      now += 10;
      if (program?.fail) throw failure;
      return 'diagnostic message';
    }
    getShaderInfoLog(shader) { calls++; now += 2; return shader; }
    getProgramParameter(program, kind) { calls++; now += 1; return kind; }
  }
  class GL2 extends GL {}
  const target = { WebGLRenderingContext: GL, WebGL2RenderingContext: GL2, performance: { now: () => now } };
  installDriverProbe(target);
  assert.throws(() => installDriverProbe(target), /already installed/);
  const gl = new GL2(), program = {}, shader = {};
  const before = target.__driverProbe;
  assert.equal(gl.getProgramInfoLog(program), 'diagnostic message');
  assert.equal(gl.getProgramInfoLog(program), 'diagnostic message');
  assert.equal(gl.getShaderInfoLog(shader), shader);
  assert.equal(gl.getProgramParameter(program, 999), 999, 'non-LINK queries are forwarded, not recorded');
  assert.equal(gl.getProgramParameter(program, gl.LINK_STATUS), gl.LINK_STATUS);
  assert.throws(() => gl.getProgramInfoLog({ fail: true }), error => error === failure);
  assert.equal(calls, 6);
  const after = target.__driverProbe;
  assert.equal(after.totalCalls, 5, 'inherited methods must not be wrapped twice');
  assert.equal(after.events[0].firstInfoLogForHandle, true);
  assert.equal(after.events[1].firstInfoLogForHandle, false);
  assert.equal(after.events.at(-1).threw, true);
  assert.deepEqual(after.events.map(event => event.durationMs), [10, 10, 2, 1, 10]);
  const result = driverProbeWindow(before, after, [{ serial: 1, intervalMs: 50, renderStartedAt: 0, renderEndedAt: 50 }]);
  assert.equal(result.insideRenderCpuMs, 33);
  assert.equal(result.methods.getProgramInfoLog.calls, 3);
  assert.ok(result.events.every(event => event.frameSerial === 1));
  after.events[0].durationMs = 10000;
  assert.equal(target.__driverProbe.events[0].durationMs, 10);
  assert.equal(driverProbeWindow(null, null, []), null);
});

test('trace overflow and missing capabilities fail explicitly; unmatched calls are not forced onto a render frame', () => {
  class GL { getProgramInfoLog() { return ''; } }
  const target = { WebGLRenderingContext: GL, performance: { now: () => 0 } };
  installDriverProbe(target);
  const before = target.__driverProbe, gl = new GL(), program = {};
  gl.getProgramInfoLog(program);
  assert.equal(driverProbeWindow(before, target.__driverProbe, []).events[0].frameSerial, null);
  for (let i = 0; i < 1024; i++) gl.getProgramInfoLog(program);
  assert.throws(() => driverProbeWindow(before, target.__driverProbe, []), /overwrote/);
  assert.throws(() => installDriverProbe({}), /No WebGL/);
  assert.throws(() => driverProbeWindow(before, null, []), /changed/);
});

test('program lifetime tracing links releases to material disposal without changing ownership or calling GL twice', () => {
  let queries = 0;
  const failure = new Error('material disposal failure');
  class GL {
    createProgram() { queries++; return {}; }
    deleteProgram(program) { assert.ok(program); queries++; }
    getProgramInfoLog() { queries++; return ''; }
  }
  const gl = new GL();
  class Material {
    constructor() { this.type = 'LineBasicMaterial'; this.name = 'tracer'; this.uuid = 'material-1'; }
    dispose(...args) {
      assert.deepEqual(args, ['expected argument']);
      gl.deleteProgram(this.program);
      if (this.fail) throw failure;
      return 'disposed';
    }
  }
  const target = { WebGLRenderingContext: GL, performance: { now: () => 0 } };
  installDriverProbe(target);
  target.__attachDriverMaterials(Material);
  assert.throws(() => target.__attachDriverMaterials(Material), /already attached/);
  const material = new Material();
  material.program = gl.createProgram();
  gl.getProgramInfoLog(material.program);
  assert.equal(material.dispose('expected argument'), 'disposed');
  gl.deleteProgram(material.program);
  const events = target.__driverProbe.events;
  assert.equal(queries, 4);
  assert.ok(events.every(event => event.handleId === events[0].handleId));
  assert.deepEqual(events[2].disposingMaterial, { type: 'LineBasicMaterial', name: 'tracer', uuid: 'material-1' });
  assert.match(events[2].releaseStack, /Sampled program release/);
  assert.equal(events[3].disposingMaterial, null, 'disposal context must be restored');
  events[2].disposingMaterial.type = 'changed snapshot';
  assert.equal(target.__driverProbe.events[2].disposingMaterial.type, 'LineBasicMaterial');
  assert.equal(material.type, 'LineBasicMaterial');
  material.fail = true;
  assert.throws(() => material.dispose('expected argument'), error => error === failure);
  gl.deleteProgram(material.program);
  assert.equal(target.__driverProbe.events.at(-1).disposingMaterial, null, 'restore disposal context after errors too');
});
