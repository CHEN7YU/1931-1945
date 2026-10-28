import * as THREE from 'three';
import { PARTICLE_LIMITS, createParticleState, emitCombatParticles, emitExplosionParticles, advanceCombatParticles, clearCombatParticles, trimCombatParticles } from './combat-particles.js';
import { createTankFireEffects } from './tank-fire.js';

const colors = { stone: 0xada695, soil: 0x83715a, wood: 0x796048, generic: 0x96968b, muzzle: 0xb7b6b0,
  'blast-dust': 0x9b8a6e, 'blast-smoke': 0x666560, 'blast-flash': 0xffc575,
  'blast-fire': 0xff8a24, 'blast-soot': 0x292724, 'blast-wave': 0xc9b58e };
const fragmentColors = Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, new THREE.Color(value)]));
function cloudNoise(x, y) {
  const hash = (a, b) => {
    let value = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return ((value ^ value >>> 16) >>> 0) / 4294967295;
  };
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) * (1 - u) + hash(ix + 1, iy) * u;
  const b = hash(ix, iy + 1) * (1 - u) + hash(ix + 1, iy + 1) * u;
  return a * (1 - v) + b * v;
}
export function impactKind(object) {
  const surface = object.material?.userData.surface;
  if (surface === 'earth') return 'soil';
  if (['brick', 'plaster', 'tiles', 'paving'].includes(surface)) return 'stone';
  if (surface === 'timber') return 'wood';
  return 'generic';
}

export function captureImpact(hit, incoming) {
  if (!hit.face) throw new Error('Mesh impact is missing its face normal');
  const matrix = hit.object.matrixWorld.clone();
  if (hit.instanceId !== undefined) {
    const instance = new THREE.Matrix4(); hit.object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
  }
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix)).normalize();
  if (normal.dot(incoming) > 0) normal.negate();
  return { kind: impactKind(hit.object), position: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
    normal: { x: normal.x, y: normal.y, z: normal.z } };
}

export function createCombatEffects(scene, camera, groundHeight) {
  const state = createParticleState(), transform = new THREE.Object3D();
  const fragments = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }), PARTICLE_LIMITS.fragments);
  fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fragments.setColorAt(0, fragmentColors.generic);
  fragments.frustumCulled = false; fragments.count = 0; fragments.receiveShadow = true;
  scene.add(fragments);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d'), gradient = context.createRadialGradient(64, 64, 0, 64, 64, 63);
  gradient.addColorStop(0, 'rgba(255,255,255,.55)'); gradient.addColorStop(.35, 'rgba(255,255,255,.3)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient; context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  const blastPixels = new Uint8Array(128 * 128 * 4), firePixels = new Uint8Array(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const nx = (x - 63.5) / 64, ny = (y - 63.5) / 64, r = Math.hypot(nx, ny);
    const lobes = .10 * Math.sin(Math.atan2(ny, nx) * 7 + .7) + .05 * Math.sin(Math.atan2(ny, nx) * 11);
    const noise = .45 + .35 * cloudNoise(x * .06, y * .06) +
      .18 * cloudNoise(x * .13 + 19, y * .13) + .12 * cloudNoise(x * .27, y * .27 + 31);
    const edge = Math.max(0, Math.min(1, (.98 - r) * 8));
    const density = Math.max(0, Math.min(1, (1 + lobes - r) * 3)) * noise * edge;
    const i = (y * 128 + x) * 4, shade = 190 + Math.round(noise * 55);
    blastPixels.set([shade, shade, shade, Math.round(density * 195)], i);
    const heat = Math.max(0, 1 - r * 1.5) * noise;
    firePixels.set([255, Math.round(95 + heat * 160), Math.round(12 + heat * 200), Math.round(density * 220)], i);
  }
  const blastTexture = new THREE.DataTexture(blastPixels, 128, 128);
  blastTexture.magFilter = THREE.LinearFilter; blastTexture.needsUpdate = true;
  const fireTexture = new THREE.DataTexture(firePixels, 128, 128);
  fireTexture.magFilter = THREE.LinearFilter; fireTexture.needsUpdate = true;
  const tankFire = createTankFireEffects(scene, camera, blastTexture);
  const clouds = Array.from({ length: PARTICLE_LIMITS.clouds }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false; scene.add(sprite); return sprite;
  });
  const waveGeometry = new THREE.RingGeometry(.85, 1, 64);
  const waves = Array.from({ length: PARTICLE_LIMITS.clouds }, () => {
    const mesh = new THREE.Mesh(waveGeometry, new THREE.MeshBasicMaterial({ color: colors['blast-wave'],
      transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 }));
    mesh.rotation.x = -Math.PI / 2; mesh.visible = false; scene.add(mesh); return mesh;
  });
  const lights = Array.from({ length: PARTICLE_LIMITS.lights }, () => {
    const light = new THREE.PointLight(0xffc68b, 0, 3, 2);
    light.castShadow = false; light.visible = false; scene.add(light); return light;
  });
  let settings = null, lastImpact = null;
  const display = () => {
    fragments.count = state.fragments.length;
    state.fragments.forEach((particle, index) => {
      transform.position.set(particle.x, particle.y, particle.z);
      transform.rotation.set(particle.spin + particle.age * 5, particle.spin, particle.age * 8);
      transform.scale.setScalar(particle.size * Math.min(1, (1 - particle.age / particle.life) * 4));
      transform.updateMatrix();
      fragments.setMatrixAt(index, transform.matrix);
      fragments.setColorAt(index, fragmentColors[particle.kind]);
    });
    fragments.instanceMatrix.needsUpdate = true;
    if (fragments.instanceColor) fragments.instanceColor.needsUpdate = true;
    clouds.forEach((sprite, index) => {
      const cloud = state.clouds[index], wave = waves[index], shockwave = cloud?.kind === 'blast-wave';
      sprite.visible = Boolean(cloud) && !shockwave;
      wave.visible = Boolean(shockwave);
      if (!cloud) return;
      const t = cloud.age / cloud.life;
      if (shockwave) {
        wave.position.set(cloud.x, groundHeight(cloud.x, cloud.z) + .06, cloud.z);
        wave.scale.setScalar(cloud.size * (.25 + t * 1.8));
        wave.material.opacity = .36 * (1 - t) ** 2;
        return;
      }
      const blast = cloud.kind.startsWith('blast-');
      const fire = cloud.kind === 'blast-fire', smoke = cloud.kind === 'blast-smoke' || cloud.kind === 'blast-soot';
      sprite.material.map = fire ? fireTexture : blast ? blastTexture : texture;
      sprite.position.set(cloud.x, cloud.y, cloud.z);
      sprite.scale.set(cloud.size * (1 + t * (fire ? 1.3 : blast ? 3.2 : 2)),
        cloud.size * (1 + t * (fire ? 1.7 : cloud.kind === 'blast-dust' ? 1.1 : 2.4)), 1);
      sprite.material.color.setHex(colors[cloud.kind]);
      sprite.material.opacity = (blast ? .62 : .28) * (1 - t) * (smoke ? Math.min(1, .2 + t * 7) : 1);
      const flash = cloud.kind === 'muzzle' && cloud.age < .05 || cloud.kind === 'blast-flash';
      sprite.material.blending = flash || fire ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (flash) { sprite.material.color.setHex(cloud.kind === 'muzzle' ? 0xffdfa0 : 0xffc575); sprite.material.opacity = .85 * (1 - t); }
      if (fire) {
        sprite.material.color.setRGB(1, .9 * (1 - t) + .1, .6 * (1 - t) + .1);
        sprite.material.opacity = .7 * (1 - t) ** .7;
      }
      sprite.material.toneMapped = !flash && !fire;
      sprite.material.rotation = cloud.rotation;
    });
    lights.forEach((light, index) => {
      const pulse = state.lights[index];
      // Keep a fixed shader light count during high-quality combat; inactive lights emit zero.
      light.visible = Boolean(settings && settings.preset !== 'low' && settings.effects.muzzle && settings.effects.muzzleLight);
      light.intensity = pulse ? (pulse.intensity ?? 9) * (1 - pulse.age / pulse.life) : 0;
      light.distance = pulse?.distance ?? 3;
      if (pulse) light.position.set(pulse.x, pulse.y, pulse.z);
    });
  };
  const configure = value => {
    settings = value;
    tankFire.configure(value);
    const low = settings.preset === 'low';
    trimCombatParticles(state, { fragments: settings.effects.hitParticles ? low ? 32 : PARTICLE_LIMITS.fragments : 0,
      clouds: low ? 6 : PARTICLE_LIMITS.clouds, lights: low || !settings.effects.muzzle || !settings.effects.muzzleLight ? 0 : PARTICLE_LIMITS.lights },
    cloud => cloud.kind === 'muzzle' ? settings.effects.muzzle : settings.effects.hitParticles);
    display();
  };
  const emit = (position, normal, kind, time) => {
    const low = settings.preset === 'low', muzzle = kind === 'muzzle';
    emitCombatParticles(state, position, normal, kind, {
      fragmentCount: muzzle ? 0 : low ? 3 : 8, fragmentLimit: low ? 32 : PARTICLE_LIMITS.fragments,
      clouds: muzzle || !low, cloudLimit: low ? 6 : PARTICLE_LIMITS.clouds,
      lightLimit: !low && settings.effects.muzzleLight ? PARTICLE_LIMITS.lights : 0,
      time,
    });
    display();
  };
  return {
    configure,
    muzzle(position, direction, time) {
      if (!settings.effects.muzzle || camera.position.distanceTo(position) > 35) return;
      emit(position, direction, 'muzzle', time);
    },
    hit(impact, time) {
      const position = new THREE.Vector3(impact.position.x, impact.position.y, impact.position.z);
      if (!settings.effects.hitParticles || camera.position.distanceTo(position) > 100) return;
      const normal = new THREE.Vector3(impact.normal.x, impact.normal.y, impact.normal.z);
      lastImpact = { kind: impact.kind, position: position.toArray(), normal: normal.toArray() };
      emit(position, normal, impact.kind, time);
    },
    explosion(position, time, radius = 7, style = 'default') {
      if (!settings.effects.hitParticles || camera.position.distanceTo(position) > 140) return;
      emitExplosionParticles(state, position, time, { low: settings.preset === 'low', radius, lights: settings.effects.muzzleLight, style });
      display();
    },
    update(dt, time, vehicles = []) {
      advanceCombatParticles(state, dt, groundHeight, time);
      tankFire.update(vehicles, time);
      display();
    },
    clear() { clearCombatParticles(state); tankFire.clear(); lastImpact = null; display(); },
    get snapshot() {
      return { fragments: state.fragments.length, clouds: state.clouds.length, lights: state.lights.length,
        renderedFragments: fragments.count, renderedClouds: clouds.filter(sprite => sprite.visible).length + waves.filter(mesh => mesh.visible).length,
        blastClouds: state.clouds.filter(cloud => cloud.kind.startsWith('blast-')).length,
        fireClouds: state.clouds.filter(cloud => cloud.kind === 'blast-fire').length,
        sootClouds: state.clouds.filter(cloud => cloud.kind === 'blast-soot').length,
        shockwaves: waves.filter(mesh => mesh.visible).length,
        tankFire: tankFire.snapshot,
        visibleLights: lights.filter(light => light.visible && light.intensity > 0).length,
        shaderLights: lights.filter(light => light.visible).length, pointLightShadows: lights.some(light => light.castShadow),
        limits: { ...PARTICLE_LIMITS }, emitted: state.emitted,
        muzzleLightIntensity: lights.reduce((sum, light) => sum + light.intensity, 0),
        lastImpact: lastImpact ? { ...lastImpact, position: [...lastImpact.position], normal: [...lastImpact.normal] } : null };
    },
  };
}
// ---模块结束---
