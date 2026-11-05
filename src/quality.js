export const QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({ pixelRatioCap: 1.6, shadowSize: 4096, smokeBudget: 30 }),
  low: Object.freeze({ pixelRatioCap: 1, shadowSize: 1024, smokeBudget: 10 }),
});
export const QUALITY_EFFECTS = Object.freeze(['shadows', 'fog', 'smoke', 'grain', 'overcast', 'muzzle', 'muzzleLight', 'hitParticles', 'damageVignette']);

export function qualityProfile(preset, deviceRatio, maxTextureSize) {
  if (!Object.hasOwn(QUALITY_PRESETS, preset)) throw new RangeError(`Unknown quality preset: ${preset}`);
  if (!Number.isFinite(deviceRatio) || deviceRatio <= 0 || !Number.isFinite(maxTextureSize) || maxTextureSize <= 0) throw new RangeError('Invalid renderer capabilities');
  const profile = QUALITY_PRESETS[preset];
  return { ...profile, pixelRatio: Math.min(deviceRatio, profile.pixelRatioCap), shadowSize: Math.min(profile.shadowSize, maxTextureSize) };
}

export function createQualitySettings({ renderer, scene, sun, smoke, grain, deviceRatio = () => window.devicePixelRatio,
  initialPreset = 'high', initialEffects = {} }) {
  qualityProfile(initialPreset, deviceRatio(), renderer.capabilities.maxTextureSize);
  for (const [effect, enabled] of Object.entries(initialEffects)) {
    if (!QUALITY_EFFECTS.includes(effect) || typeof enabled !== 'boolean') throw new RangeError('Unknown initial graphics effect or invalid enabled flag');
  }
  const state = { preset: initialPreset, automaticLevel: 0,
    effects: Object.fromEntries(QUALITY_EFFECTS.map(effect => [effect, initialEffects[effect] ?? true])) };
  const fog = scene.fog;
  const effective = () => {
    const preset = state.automaticLevel ? 'low' : state.preset, effects = { ...state.effects };
    if (state.automaticLevel >= 2) {
      for (const effect of ['shadows', 'grain', 'muzzleLight']) effects[effect] = false;
    }
    if (state.automaticLevel >= 3) effects.smoke = false;
    const profile = qualityProfile(preset, deviceRatio(), renderer.capabilities.maxTextureSize);
    if (state.automaticLevel >= 2) profile.pixelRatio = Math.min(profile.pixelRatio, state.automaticLevel === 3 ? .6 : .8);
    return { preset, effects, profile };
  };
  const invalidateMaterials = () => scene.traverse(object => {
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
  });
  const releaseShadowMap = () => {
    sun.shadow.map?.dispose();
    sun.shadow.mapPass?.dispose();
    sun.shadow.map = sun.shadow.mapPass = null;
  };
  const apply = () => {
    const { effects, profile } = effective();
    if (renderer.getPixelRatio() !== profile.pixelRatio) renderer.setPixelRatio(profile.pixelRatio);
    const shadersChanged = renderer.shadowMap.enabled !== effects.shadows || Boolean(scene.fog) !== effects.fog;
    if (!effects.shadows || sun.shadow.mapSize.x !== profile.shadowSize) releaseShadowMap();
    sun.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
    sun.shadow.needsUpdate = true;
    renderer.shadowMap.enabled = effects.shadows;
    scene.fog = effects.fog ? fog : null;
    const budget = effects.smoke ? Math.min(smoke.length, profile.smokeBudget) : 0;
    const indices = new Set(Array.from({ length: budget }, (_, i) => Math.floor(i * smoke.length / budget)));
    smoke.forEach((puff, i) => { puff.visible = indices.has(i); });
    grain.hidden = !effects.grain;
    if (shadersChanged) invalidateMaterials();
  };
  apply();
  return {
    setAutomaticLevel(level) {
      if (!Number.isInteger(level) || level < 0 || level > 3) throw new RangeError('Invalid automatic quality level');
      if (level === state.automaticLevel) return;
      state.automaticLevel = level; apply();
    },
    setPreset(preset) {
      qualityProfile(preset, deviceRatio(), renderer.capabilities.maxTextureSize);
      state.preset = preset;
      apply();
    },
    setEffect(effect, enabled) {
      if (!QUALITY_EFFECTS.includes(effect) || typeof enabled !== 'boolean') throw new RangeError('Unknown effect or invalid enabled flag');
      state.effects[effect] = enabled;
      apply();
    },
    resize(width, height) {
      apply();
      renderer.setSize(width, height);
    },
    get snapshot() {
      const { preset, effects } = effective();
      return { preset, effects, automaticLevel: state.automaticLevel,
        requested: { preset: state.preset, effects: { ...state.effects } }, pixelRatio: renderer.getPixelRatio(),
        canvasWidth: renderer.domElement.width, canvasHeight: renderer.domElement.height,
        requestedShadowSize: QUALITY_PRESETS[preset].shadowSize, shadowSize: sun.shadow.mapSize.x,
        shadowMapWidth: sun.shadow.map?.width || 0, shadowsEnabled: renderer.shadowMap.enabled,
        fogEnabled: Boolean(scene.fog), visibleSmoke: smoke.filter(puff => puff.visible).length,
        grainEnabled: !grain.hidden, postProcessing: false, textureCount: renderer.info.memory.textures };
    },
  };
}
// ---模块结束---
