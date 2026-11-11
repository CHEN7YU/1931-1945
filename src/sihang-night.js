import * as THREE from 'three';
import { SIHANG_RULES } from './sihang-campaign.js';

export function sihangNightTransition(campaign) {
  return campaign.stage === 'sihang-retreat'
    ? THREE.MathUtils.smoothstep(campaign.stageElapsed, 0, SIHANG_RULES.nightfallSeconds) : 0;
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
  return distance <= 95 - sihangNightTransition(campaign) * 71 * (1 - flare.intensity);
}

export function createSihangNight(scene, sun, hemisphere) {
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
  const nightSky = new THREE.Color(0x0c1830), background = new THREE.Color();
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
      if (night) {
        scene.background = background.copy(original.background?.isColor ? original.background : nightSky).lerp(nightSky, transition);
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
