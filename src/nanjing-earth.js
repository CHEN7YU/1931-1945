export function nanjingEarth(surface, color, metersPerTile) {
  const material = surface('earth', color, metersPerTile);
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    compile.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('#include <map_fragment>'))
      throw new Error('Nanjing earth material requires the map shader');
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec3 nanjingEarthTint = diffuseColor.rgb;
      #endif
      #include <map_fragment>
      #ifdef USE_MAP
        vec3 nanjingEarthMap = diffuseColor.rgb / max(nanjingEarthTint, vec3(0.00001));
        float nanjingEarthLight = dot(nanjingEarthMap, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = nanjingEarthTint * nanjingEarthLight;
      #endif`);
  };
  material.customProgramCacheKey = () => `${key}:nanjing-earth-neutral-v1`;
  return material;
}
