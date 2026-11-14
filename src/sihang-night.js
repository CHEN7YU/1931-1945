import * as THREE from 'three';
import { SIHANG_RULES } from './sihang-campaign.js';

export const SIHANG_VISUAL_NIGHTFALL_SECONDS = 60;

export function sihangNightTransition(campaign) {
  return campaign.stage === 'sihang-retreat'
    ? THREE.MathUtils.smoothstep(campaign.stageElapsed, 0, SIHANG_VISUAL_NIGHTFALL_SECONDS) : 0;
}

export function sihangFlareState(campaign) {
  if (campaign.stage !== 'sihang-retreat' || !campaign.counterattack) return { cycle: -1, age: 0, intensity: 0 };
  const elapsed = Math.max(0, campaign.elapsed - campaign.counterattackAt);
  const cycle = Math.floor(elapsed / SIHANG_RULES.flareInterval), age = elapsed % SIHANG_RULES.flareInterval;
  const intensity = Math.min(1, age / 2) * Math.max(0, Math.min(1, (SIHANG_RULES.flareSeconds - age) / 4));
  return { cycle, age, intensity };
}

export function sihangNightVisibility(campaign, from, to) {
  if (campaign.stage !== 'sihang-retreat') return true;
  const flare = sihangFlareState(campaign);
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const visibilityTransition = THREE.MathUtils.smoothstep(campaign.stageElapsed, 0, SIHANG_RULES.nightfallSeconds);
  return distance <= 95 - visibilityTransition * 71 * (1 - flare.intensity);
}

export function createSihangNight(scene, sun, hemisphere, camera = null) {
  const skyMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.BackSide, fog: false, toneMapped: false,
    uniforms: { opacity: { value: 0 } },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 skyDirection;
      uniform float opacity;
      // Integer coefficients keep shared noise-cell corners identical after GPU reassociation.
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.0, 311.0))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec3 direction = normalize(skyDirection);
        float height = clamp(direction.y, 0.0, 1.0);
        vec3 color = mix(vec3(0.11, 0.14, 0.20), vec3(0.015, 0.027, 0.055), pow(height, 0.45));
        vec2 coordinates = vec2(atan(direction.z, direction.x) * 0.159155 + 0.5,
          asin(clamp(direction.y, -1.0, 1.0)) * 0.31831 + 0.5);
        vec2 cells = coordinates * vec2(450.0, 225.0), cell = floor(cells);
        float starSeed = hash(cell);
        vec2 starPosition = vec2(hash(cell + 3.1), hash(cell + 8.7));
        float star = (1.0 - smoothstep(0.015, 0.07, length(fract(cells) - starPosition)))
          * step(0.994, starSeed) * smoothstep(0.03, 0.2, height);
        vec3 moonDirection = normalize(vec3(0.42, 0.48, -0.77));
        float moonDistance = length(direction - moonDirection);
        float moon = 1.0 - smoothstep(0.012, 0.015, moonDistance);
        float halo = (1.0 - smoothstep(0.015, 0.075, moonDistance)) * 0.12;
        vec2 cloudUv = direction.xz * 6.0 + 8.0;
        float cloud = noise(cloudUv) * 0.6 + noise(cloudUv * 2.0 + 17.0) * 0.3
          + noise(cloudUv * 4.0 + 31.0) * 0.1;
        cloud = smoothstep(0.52, 0.72, cloud) * smoothstep(0.02, 0.15, height);
        color += vec3(0.67, 0.72, 0.79) * star * (1.0 - cloud * 0.8);
        color += vec3(0.62, 0.66, 0.70) * halo;
        color = mix(color, vec3(0.85, 0.84, 0.77), moon * (1.0 - cloud * 0.65));
        color = mix(color, vec3(0.105, 0.13, 0.17), cloud * 0.55);
        gl_FragColor = vec4(color, opacity);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), skyMaterial);
  sky.name = 'sihang-night-sky'; sky.frustumCulled = false; sky.visible = false;
  sky.renderOrder = -1; scene.add(sky);
  const root = new THREE.Group(); root.name = 'sihang-night-flares'; scene.add(root);
  const geometry = new THREE.SphereGeometry(.22, 8, 6);
  const material = new THREE.MeshBasicMaterial({ color: 0xffedb5, toneMapped: false });
  const flares = [[0, -38], [43, -30], [79, -22]].map(([x, z]) => {
    // Keep the light count stable even in daylight; only intensity changes during battle.
    const light = new THREE.PointLight(0xffedc4, 0, 115, 1);
    light.position.set(x, 45, z); scene.add(light);
    const glow = new THREE.Mesh(geometry, material); glow.visible = false; root.add(glow);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(.8, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xaaa18b, side: THREE.DoubleSide }));
    canopy.visible = false; root.add(canopy);
    return { light, glow, canopy, x, z };
  });
  let original = null, snapshot = { night: false, cycle: -1, visible: 0, intensity: 0 };
  return {
    update(campaign) {
      const night = campaign.stage === 'sihang-retreat';
      if (night && !original) original = { background: scene.background, environmentIntensity: scene.environmentIntensity,
        sunColor: sun.color.clone(), sunIntensity: sun.intensity,
        fillColor: hemisphere.color.clone(), groundColor: hemisphere.groundColor.clone(), fillIntensity: hemisphere.intensity,
        fogColor: scene.fog?.color.clone() };
      if (!night && original) {
        scene.background = original.background; scene.environmentIntensity = original.environmentIntensity;
        sun.color.copy(original.sunColor); sun.intensity = original.sunIntensity;
        hemisphere.color.copy(original.fillColor); hemisphere.groundColor.copy(original.groundColor);
        hemisphere.intensity = original.fillIntensity;
        if (scene.fog && original.fogColor) scene.fog.color.copy(original.fogColor);
        original = null;
      }
      const flare = sihangFlareState(campaign);
      const transition = sihangNightTransition(campaign);
      sky.visible = night && transition > 0;
      skyMaterial.uniforms.opacity.value = transition;
      if (camera) camera.getWorldPosition(sky.position);
      if (night) {
        scene.environmentIntensity = THREE.MathUtils.lerp(original.environmentIntensity, .4, transition);
        sun.color.copy(original.sunColor).lerp(new THREE.Color(0x8dace0), transition);
        sun.intensity = THREE.MathUtils.lerp(original.sunIntensity, .55, transition);
        hemisphere.color.copy(original.fillColor).lerp(new THREE.Color(0x8ba7cd), transition);
        hemisphere.groundColor.copy(original.groundColor).lerp(new THREE.Color(0x445266), transition);
        hemisphere.intensity = THREE.MathUtils.lerp(original.fillIntensity, 1.1, transition);
        if (scene.fog && original.fogColor) scene.fog.color.copy(original.fogColor).lerp(new THREE.Color(0x182338), transition);
      }
      for (const item of flares) {
        const height = flare.age < 2 ? 8 + flare.age * 22 : 52 - (flare.age - 2) * 1.05;
        item.light.position.set(item.x + flare.age * .2, height, item.z);
        item.light.intensity = flare.intensity * 95;
        item.glow.visible = item.canopy.visible = night && flare.intensity > 0;
        item.glow.position.copy(item.light.position);
        item.canopy.position.copy(item.light.position).y += 1.4;
      }
      snapshot = { night, transition, ...flare, visible: flares.filter(item => item.glow.visible).length };
    },
    get snapshot() { return { ...snapshot }; },
  };
}
