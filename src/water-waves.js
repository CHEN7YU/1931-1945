const waves = Object.freeze([
  Object.freeze({ amplitude: .055, x: .32, z: .19, speed: .8 }),
  Object.freeze({ amplitude: .032, x: -.21, z: .43, speed: -.61 }),
  Object.freeze({ amplitude: .015, x: .73, z: -.28, speed: 1.11 }),
]);

export function waterWaveHeight(x, z, time) {
  return waves.reduce((height, wave) =>
    height + wave.amplitude * Math.sin(wave.x * x + wave.z * z + wave.speed * time), 0);
}

export function createWaterWaveClock() {
  const uniform = { value: 0 };
  const terms = waves.map(wave => {
    const phase = `(${wave.x.toFixed(4)} * p.x + ${wave.z.toFixed(4)} * p.y + ${wave.speed.toFixed(4)} * waterTime)`;
    return { height: `${wave.amplitude.toFixed(4)} * sin${phase}`,
      dx: `${(wave.amplitude * wave.x).toFixed(7)} * cos${phase}`,
      dz: `${(wave.amplitude * wave.z).toFixed(7)} * cos${phase}` };
  });
  const definitions = `
    uniform float waterTime;
    float waterHeight(vec2 p) { return ${terms.map(term => term.height).join(' + ')}; }
    vec2 waterGradient(vec2 p) {
      return vec2(${terms.map(term => term.dx).join(' + ')}, ${terms.map(term => term.dz).join(' + ')});
    }
  `;
  return {
    attach(material, localVertical) {
      if (localVertical !== 'y' && localVertical !== 'z') throw new RangeError('Invalid water vertical axis');
      material.onBeforeCompile = shader => {
        shader.uniforms.waterTime = uniform;
        shader.vertexShader = `varying vec2 vWaterPosition;\n${definitions}` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vec2 waterPosition = (modelMatrix * vec4(transformed, 1.0)).xz;
          vWaterPosition = waterPosition;
          transformed.${localVertical} += waterHeight(waterPosition);
        `);
        if (material.isMeshStandardMaterial) {
          shader.fragmentShader = `varying vec2 vWaterPosition;\n${definitions}` + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
            #include <normal_fragment_maps>
            vec2 gradient = waterGradient(vWaterPosition);
            normal = normalize(normal + mat3(viewMatrix) * vec3(-gradient.x, 0.0, -gradient.y) * 2.0);
          `);
          shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            diffuseColor.rgb *= 1.0 + 1.5 * waterHeight(vWaterPosition);
          `);
        } else {
          shader.fragmentShader = `varying vec2 vWaterPosition;\n${shader.fragmentShader}`;
        }
      };
      material.customProgramCacheKey = () => `water-waves-${localVertical}`;
    },
    update(time) { uniform.value = time; },
  };
}
