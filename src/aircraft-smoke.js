import * as THREE from 'three';

export const AIRCRAFT_SMOKE = Object.freeze({ life: 3.2, interval: .03, lowInterval: .04, limit: 160, lowLimit: 80 });

export function createAircraftSmokeState() {
  return { time: null, sources: new Map(), puffs: [] };
}

export function advanceAircraftSmoke(state, vehicles, now, low = false) {
  if (!Number.isFinite(now) || now < 0) throw new RangeError('Aircraft smoke requires finite simulation time');
  if (state.time !== null && now < state.time) {
    state.sources.clear(); state.puffs.length = 0;
  }
  const interval = low ? AIRCRAFT_SMOKE.lowInterval : AIRCRAFT_SMOKE.interval;
  const active = new Set();
  state.puffs = state.puffs.filter(puff => now - puff.birth < AIRCRAFT_SMOKE.life);
  for (const vehicle of vehicles) {
    if (vehicle.type !== 'plane' || vehicle.health > 0 || !vehicle.fall ||
      vehicle.fall?.grounded || vehicle.fall?.sinking || vehicle.fall?.sunk) continue;
    if (!Number.isFinite(vehicle.health) || !['x', 'y', 'z'].every(axis => Number.isFinite(vehicle.position?.[axis])) ||
      ![vehicle.heading, vehicle.pitch, vehicle.roll].every(Number.isFinite)) throw new Error('Damaged aircraft smoke lacks a finite flight pose');
    active.add(vehicle.id);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(vehicle.pitch, vehicle.heading, vehicle.roll, 'YXZ'));
    const engine = new THREE.Vector3(0, .35, vehicle.team === 'enemy' ? -3.1 : -2.6).applyQuaternion(rotation).add(vehicle.position);
    const previous = state.sources.get(vehicle.id);
    const continuous = previous && engine.distanceTo(previous.position) < 80;
    const first = continuous ? previous.emittedAt + interval : now;
    let emittedAt = continuous ? previous.emittedAt : now;
    const intensity = 1;
    for (let birth = Math.max(first, now - AIRCRAFT_SMOKE.life + interval); birth <= now + 1e-8; birth += interval) {
      const blend = continuous && now > previous.time ? Math.max(0, Math.min(1, (birth - previous.time) / (now - previous.time))) : 1;
      const position = continuous ? previous.position.clone().lerp(engine, blend) : engine.clone();
      state.puffs.push({ id: vehicle.id, birth, position, intensity });
      emittedAt = birth;
    }
    state.sources.set(vehicle.id, { position: engine, time: now, emittedAt });
  }
  for (const id of state.sources.keys()) if (!active.has(id)) state.sources.delete(id);
  const limit = low ? AIRCRAFT_SMOKE.lowLimit : AIRCRAFT_SMOKE.limit;
  if (state.puffs.length > limit) {
    state.puffs.sort((a, b) => a.birth - b.birth);
    state.puffs.splice(0, state.puffs.length - limit);
  }
  state.time = now;
}

export function createAircraftSmokeEffects(scene, texture) {
  const state = createAircraftSmokeState(), geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(AIRCRAFT_SMOKE.limit), 1);
  const size = new THREE.InstancedBufferAttribute(new Float32Array(AIRCRAFT_SMOKE.limit), 1);
  const spin = new THREE.InstancedBufferAttribute(new Float32Array(AIRCRAFT_SMOKE.limit), 1);
  for (const [name, attribute] of [['smokeOpacity', opacity], ['smokeSize', size], ['smokeSpin', spin]])
    geometry.setAttribute(name, attribute.setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { smokeMap: { value: texture } },
    vertexShader: `
      attribute float smokeOpacity;
      attribute float smokeSize;
      attribute float smokeSpin;
      varying vec2 vUv;
      varying float vOpacity;
      void main() {
        vUv = uv; vOpacity = smokeOpacity;
        float c = cos(smokeSpin), s = sin(smokeSpin);
        vec2 corner = mat2(c, -s, s, c) * position.xy * smokeSize;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        gl_Position = projectionMatrix * (center + vec4(corner, 0.0, 0.0));
      }`,
    fragmentShader: `
      uniform sampler2D smokeMap;
      varying vec2 vUv;
      varying float vOpacity;
      void main() {
        float alpha = texture2D(smokeMap, vUv).a * vOpacity;
        gl_FragColor = vec4(vec3(0.035, 0.032, 0.030), alpha);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, AIRCRAFT_SMOKE.limit);
  mesh.name = 'aircraft-damage-black-smoke'; mesh.count = 0; mesh.visible = false; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(mesh);
  const matrix = new THREE.Matrix4();
  let settings = null;
  const clear = () => { state.sources.clear(); state.puffs.length = 0; state.time = null; mesh.count = 0; mesh.visible = false; };
  return {
    prepareBattleViews(camera) {
      const previous = { count: mesh.count, visible: mesh.visible, opacity: opacity.getX(0),
        size: size.getX(0), spin: spin.getX(0), matrix: new THREE.Matrix4() };
      mesh.getMatrixAt(0, previous.matrix);
      const point = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(point.x, point.y, point.z));
      opacity.setX(0, .1); size.setX(0, 1); spin.setX(0, 0);
      mesh.count = 1; mesh.visible = true;
      mesh.instanceMatrix.needsUpdate = opacity.needsUpdate = size.needsUpdate = spin.needsUpdate = true;
      return () => {
        mesh.count = previous.count; mesh.visible = previous.visible;
        mesh.setMatrixAt(0, previous.matrix); opacity.setX(0, previous.opacity);
        size.setX(0, previous.size); spin.setX(0, previous.spin);
        mesh.instanceMatrix.needsUpdate = opacity.needsUpdate = size.needsUpdate = spin.needsUpdate = true;
      };
    },
    configure(value) { settings = value; if (!settings.effects.hitParticles) clear(); },
    update(vehicles, now) {
      if (!settings?.effects.hitParticles) return;
      advanceAircraftSmoke(state, vehicles, now, settings.preset === 'low');
      mesh.count = state.puffs.length; mesh.visible = mesh.count > 0;
      for (const [index, puff] of state.puffs.entries()) {
        const age = now - puff.birth, t = age / AIRCRAFT_SMOKE.life;
        const phase = puff.birth * 3.7;
        matrix.makeTranslation(puff.position.x + age * .28 + Math.sin(phase) * age * .15,
          puff.position.y + age * .7, puff.position.z + age * .12);
        mesh.setMatrixAt(index, matrix);
        opacity.setX(index, (.65 + .3 * puff.intensity) * (1 - t) ** .7);
        size.setX(index, 2.3 + puff.intensity * .6 + age * .9);
        spin.setX(index, phase + age * .1);
      }
      if (mesh.count) {
        mesh.instanceMatrix.needsUpdate = true; opacity.needsUpdate = size.needsUpdate = spin.needsUpdate = true;
      }
    },
    clear,
    get snapshot() { return { sources: [...state.sources.keys()], puffs: mesh.count, visible: mesh.visible,
      oldestAge: state.puffs.length ? state.time - Math.min(...state.puffs.map(puff => puff.birth)) : 0 }; },
  };
}
