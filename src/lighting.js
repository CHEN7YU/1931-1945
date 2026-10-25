export const DAYLIGHT = Object.freeze({
  original: Object.freeze({ sun: 0xffefd5, sunIntensity: 2.5, sky: 0xc3d3e1, ground: 0x766651, fill: .6, environment: .8, background: .65, fog: 0xb7b6af }),
  cool: Object.freeze({ sun: 0xe7edf2, sunIntensity: 1.75, sky: 0xcbd6df, ground: 0x747978, fill: .95, environment: .9, background: .55, fog: 0xb5bec2 }),
});

export function createDaylight(scene, sun, hemisphere, fog) {
  return {
    setEnabled(enabled) {
      const profile = enabled ? DAYLIGHT.cool : DAYLIGHT.original;
      sun.color.setHex(profile.sun); sun.intensity = profile.sunIntensity;
      hemisphere.color.setHex(profile.sky); hemisphere.groundColor.setHex(profile.ground); hemisphere.intensity = profile.fill;
      scene.environmentIntensity = profile.environment; scene.backgroundIntensity = profile.background;
      fog.color.setHex(profile.fog);
    },
  };
}
// ---模块结束---
