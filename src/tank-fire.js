import * as THREE from 'three';
import { CHI_HA } from './chi-ha.js';

export const TANK_FIRE = Object.freeze({ maxWrecks: 4, lowWrecks: 2, flamePlanes: 3, lowFlamePlanes: 2,
  smokePerWreck: 8, lowSmokePerWreck: 4, strongSeconds: 4, burnSeconds: 18, smokeSeconds: 4, range: 140 });
const clamp = value => Math.max(0, Math.min(1, value));
const finitePoint = point => point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
const rotate = (x, z, yaw) => ({ x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) });

export function tankFirePose(vehicle, now) {
  if (!Number.isFinite(now) || now < 0 || vehicle.type !== 'tank' || !finitePoint(vehicle.position) ||
    !Number.isFinite(vehicle.heading) || !Number.isFinite(vehicle.turretYaw) || !Number.isFinite(vehicle.health) || vehicle.health < 0 ||
    !Number.isFinite(vehicle.destroyedAt) || vehicle.destroyedAt < 0 ||
    ![undefined, null, CHI_HA.id].includes(vehicle.variant) || typeof vehicle.id !== 'string' || !vehicle.id) {
    throw new RangeError('Tank fire requires a known wreck, finite pose and destruction time');
  }
  const age = now - vehicle.destroyedAt;
  if (vehicle.health > 0 || age < 0 || age >= TANK_FIRE.burnSeconds + TANK_FIRE.smokeSeconds) return null;
  const chiHa = vehicle.variant === CHI_HA.id, position = vehicle.position;
  const rear = rotate(0, chiHa ? 1.65 : 1.45, vehicle.heading);
  const turret = chiHa ? CHI_HA.turret : { x: -.3, y: 1.36, z: -.38 };
  const pivot = rotate(turret.x, turret.z, vehicle.heading);
  const hatch = rotate(chiHa ? .17 : 0, chiHa ? .14 : .07, vehicle.turretYaw);
  let seed = 0;
  for (const char of vehicle.id) seed = (Math.imul(seed, 31) + char.charCodeAt(0)) >>> 0;
  const phase = seed % 1000 / 100;
  const strong = clamp(1 - age / TANK_FIRE.strongSeconds);
  const intensity = clamp((TANK_FIRE.burnSeconds - age) / 4);
  const pulse = 1 + .11 * Math.sin(age * 19 + phase) + .07 * Math.sin(age * 31 + phase * 2);
  return { id: vehicle.id, age, phase, intensity,
    height: (1.25 + 3.4 * strong) * pulse * Math.sqrt(intensity),
    width: (.85 + .3 * strong) * Math.sqrt(intensity),
    hatchIntensity: clamp((3.5 - age) / 1.5) * (.7 + .3 * Math.sin(age * 13 + phase) ** 2),
    engine: { x: position.x + rear.x, y: position.y + (chiHa ? 1.30 : 1.28), z: position.z + rear.z },
    hatch: { x: position.x + pivot.x + hatch.x, y: position.y + turret.y + (chiHa ? .74 : .79),
      z: position.z + pivot.z + hatch.z } };
}

export function selectTankFires(vehicles, now, observer) {
  if (!finitePoint(observer) || !Number.isFinite(now) || now < 0) throw new RangeError('Tank fire requires a finite observer and simulation time');
  const candidates = [], ids = new Set();
  for (const vehicle of vehicles) {
    if (vehicle.type !== 'tank' || vehicle.health > 0 || vehicle.destroyedAt == null) continue;
    const pose = tankFirePose(vehicle, now);
    if (!pose) continue;
    if (ids.has(pose.id)) throw new Error('Duplicate tank fire identity');
    ids.add(pose.id);
    const distance = Math.hypot(pose.engine.x - observer.x, pose.engine.y - observer.y, pose.engine.z - observer.z);
    if (distance <= TANK_FIRE.range) candidates.push({ ...pose, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  return candidates.slice(0, TANK_FIRE.maxWrecks);
}

const vertexShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPhase;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.x += sin(uv.y * 8.0 - uTime * 9.0 + uPhase) * uv.y * uv.y * .12;
    p.z += sin(uv.y * 6.0 - uTime * 7.0 + uPhase) * uv.y * uv.y * .09;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;
const fragmentShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPhase;
  uniform float uIntensity;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    vec2 flow = vec2(vUv.x * 5.0 + uPhase, vUv.y * 6.0 - uTime * 4.5);
    float n = noise(flow) * .6 + noise(flow * 2.1) * .3 + noise(flow * 4.3) * .1;
    float center = .5 + sin(vUv.y * 9.0 - uTime * 8.0 + uPhase) * vUv.y * .09;
    float width = mix(.40, .025, vUv.y) * (.65 + n * .7);
    float body = 1.0 - smoothstep(width * .35, width, abs(vUv.x - center));
    float breakup = smoothstep(.16 + vUv.y * .4, .58 + vUv.y * .3, n + (1.0 - vUv.y) * .35);
    float alpha = body * breakup * smoothstep(0.0, .04, vUv.y) *
      (1.0 - smoothstep(.7, 1.0, vUv.y)) * uIntensity;
    vec3 color = mix(vec3(1.0, .12, .015), vec3(1.0, .72, .08), 1.0 - vUv.y);
    color = mix(color, vec3(1.0, .96, .65), pow(body, 3.0) * pow(1.0 - vUv.y, 3.0));
    gl_FragColor = vec4(color, alpha * .85);
  }`;

export function createTankFireEffects(scene, camera, smokeTexture) {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 12);
  geometry.translate(0, .5, 0);
  const views = Array.from({ length: TANK_FIRE.maxWrecks }, () => {
    const group = new THREE.Group();
    group.visible = false; scene.add(group);
    const flames = Array.from({ length: 2 }, () => {
      const source = new THREE.Group();
      const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, transparent: true,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false, forceSinglePass: true,
        uniforms: { uTime: { value: 0 }, uPhase: { value: 0 }, uIntensity: { value: 0 } } });
      for (let i = 0; i < TANK_FIRE.flamePlanes; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.y = i * Math.PI / TANK_FIRE.flamePlanes;
        source.add(mesh);
      }
      group.add(source); return source;
    });
    const smoke = Array.from({ length: TANK_FIRE.smokePerWreck }, () => {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexture, color: 0x282522,
        transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false; group.add(sprite); return sprite;
    });
    return { group, flames, smoke, id: null };
  });
  let settings = null, candidates = [];
  const display = () => {
    const low = settings?.preset === 'low', enabled = settings?.effects.hitParticles;
    const maxWrecks = low ? TANK_FIRE.lowWrecks : TANK_FIRE.maxWrecks;
    const planeCount = low ? TANK_FIRE.lowFlamePlanes : TANK_FIRE.flamePlanes;
    const smokeCount = low ? TANK_FIRE.lowSmokePerWreck : TANK_FIRE.smokePerWreck;
    views.forEach((view, index) => {
      const pose = enabled && index < maxWrecks ? candidates[index] : null;
      view.group.visible = Boolean(pose); view.id = pose?.id ?? null;
      if (!pose) return;
      view.flames.forEach((source, sourceIndex) => {
        const intensity = sourceIndex ? pose.hatchIntensity : pose.intensity;
        source.visible = intensity > 0;
        source.position.copy(sourceIndex ? pose.hatch : pose.engine);
        source.scale.set(sourceIndex ? .55 : pose.width, sourceIndex ? 2 * intensity : pose.height, sourceIndex ? .55 : pose.width);
        const uniforms = source.children[0].material.uniforms;
        uniforms.uTime.value = pose.age; uniforms.uPhase.value = pose.phase + sourceIndex * 3;
        uniforms.uIntensity.value = intensity;
        source.children.forEach((mesh, layer) => {
          mesh.visible = layer < planeCount;
          mesh.rotation.y = layer * Math.PI / planeCount;
        });
      });
      const interval = TANK_FIRE.smokeSeconds / smokeCount;
      const lastEmission = Math.floor(Math.min(pose.age, TANK_FIRE.burnSeconds) / interval) * interval;
      view.smoke.forEach((sprite, puff) => {
        const birth = lastEmission - puff * interval, age = pose.age - birth;
        sprite.visible = puff < smokeCount && birth >= 0 && age < TANK_FIRE.smokeSeconds;
        if (!sprite.visible) return;
        sprite.position.set(pose.engine.x + age * .28 + Math.sin(birth * 3 + pose.phase) * age * .12,
          pose.engine.y + .5 + age * 1.35, pose.engine.z + age * .12 + Math.cos(birth * 4 + pose.phase) * age * .1);
        sprite.scale.setScalar(.7 + age * .8);
        sprite.material.opacity = .7 * clamp(age / .35) * clamp((TANK_FIRE.smokeSeconds - age) / 1.2) *
          (.45 + .55 * clamp((TANK_FIRE.burnSeconds - birth) / 4));
        sprite.material.rotation = pose.phase + birth * 2;
      });
    });
  };
  return {
    configure(value) { settings = value; display(); },
    update(vehicles, now) { candidates = selectTankFires(vehicles, now, camera.position); display(); },
    clear() { candidates = []; display(); },
    get snapshot() {
      const active = views.filter(view => view.group.visible);
      return { wrecks: active.length, ids: active.map(view => view.id),
        flamePlanes: active.reduce((sum, view) => sum + view.flames.reduce((count, source) =>
          count + (source.visible ? source.children.filter(mesh => mesh.visible).length : 0), 0), 0),
        smoke: active.reduce((sum, view) => sum + view.smoke.filter(sprite => sprite.visible).length, 0),
        sources: active.map(view => {
          const pose = candidates.find(item => item.id === view.id);
          return { id: pose.id, age: pose.age, engine: { ...pose.engine }, hatch: { ...pose.hatch },
            height: pose.height, intensity: pose.intensity };
        }), limits: { ...TANK_FIRE } };
    },
  };
}
