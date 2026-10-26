import * as THREE from 'three';
import { PARTICLE_LIMITS, createParticleState, emitCombatParticles, advanceCombatParticles, clearCombatParticles, trimCombatParticles } from './combat-particles.js';

const colors = { stone: 0xada695, soil: 0x83715a, wood: 0x796048, generic: 0x96968b, muzzle: 0xb7b6b0 };
const fragmentColors = Object.fromEntries(Object.entries(colors).map(([name, value]) => [name, new THREE.Color(value)]));
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
  const clouds = Array.from({ length: PARTICLE_LIMITS.clouds }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 }));
    sprite.visible = false; scene.add(sprite); return sprite;
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
      const cloud = state.clouds[index]; sprite.visible = Boolean(cloud);
      if (!cloud) return;
      const t = cloud.age / cloud.life;
      sprite.position.set(cloud.x, cloud.y, cloud.z);
      sprite.scale.setScalar(cloud.size * (1 + t * 2));
      sprite.material.color.setHex(colors[cloud.kind]);
      sprite.material.opacity = .28 * (1 - t);
      const flash = cloud.kind === 'muzzle' && cloud.age < .05;
      sprite.material.blending = flash ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (flash) { sprite.material.color.setHex(0xffdfa0); sprite.material.opacity = .65 * (1 - cloud.age / .05); }
      sprite.material.rotation = cloud.rotation;
    });
    lights.forEach((light, index) => {
      const pulse = state.lights[index];
      // Keep a fixed shader light count during high-quality combat; inactive lights emit zero.
      light.visible = Boolean(settings && settings.preset !== 'low' && settings.effects.muzzle && settings.effects.muzzleLight);
      light.intensity = pulse ? 9 * (1 - pulse.age / pulse.life) : 0;
      if (pulse) light.position.set(pulse.x, pulse.y, pulse.z);
    });
  };
  const configure = value => {
    settings = value;
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
    update(dt, time) { advanceCombatParticles(state, dt, groundHeight, time); display(); },
    clear() { clearCombatParticles(state); lastImpact = null; display(); },
    get snapshot() {
      return { fragments: state.fragments.length, clouds: state.clouds.length, lights: state.lights.length,
        renderedFragments: fragments.count, renderedClouds: clouds.filter(sprite => sprite.visible).length,
        visibleLights: lights.filter(light => light.visible && light.intensity > 0).length,
        shaderLights: lights.filter(light => light.visible).length, pointLightShadows: lights.some(light => light.castShadow),
        limits: { ...PARTICLE_LIMITS }, emitted: state.emitted,
        muzzleLightIntensity: lights.reduce((sum, light) => sum + light.intensity, 0),
        lastImpact: lastImpact ? { ...lastImpact, position: [...lastImpact.position], normal: [...lastImpact.normal] } : null };
    },
  };
}
// ---模块结束---
