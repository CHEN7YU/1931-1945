import * as THREE from 'three';

const waves = Object.freeze([
  Object.freeze({ amplitude: .055, x: .32, z: .19, speed: .8 }),
  Object.freeze({ amplitude: .032, x: -.21, z: .43, speed: -.61 }),
  Object.freeze({ amplitude: .015, x: .73, z: -.28, speed: 1.11 }),
]);
const normalTextures = new Map();

function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function createWaterNormalTexture(size = 256) {
  if (!Number.isInteger(size) || size < 8) throw new RangeError('Water normal texture size must be an integer of at least 8');
  if (normalTextures.has(size)) return normalTextures.get(size);
  const data = new Uint8Array(size * size * 4), directions = [];
  for (let index = 0; index < 22; index++) {
    const frequency = 2 + Math.floor(hash2(index, 1, 77) * 12), angle = hash2(index, 2, 77) * Math.PI * 2;
    directions.push({ x: Math.round(Math.cos(angle) * frequency), y: Math.round(Math.sin(angle) * frequency),
      amplitude: 1 / (frequency ** 1.15), phase: hash2(index, 3, 77) * 6.28 });
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let dx = 0, dy = 0;
    for (const wave of directions) {
      const phase = (wave.x * x + wave.y * y) / size * Math.PI * 2 + wave.phase;
      const slope = Math.cos(phase) * wave.amplitude * Math.PI * 2;
      dx += slope * wave.x; dy += slope * wave.y;
    }
    const normal = new THREE.Vector3(-dx * .055, -dy * .055, 1).normalize();
    const index = (y * size + x) * 4;
    data[index] = (normal.x * .5 + .5) * 255;
    data[index + 1] = (normal.y * .5 + .5) * 255;
    data[index + 2] = (normal.z * .5 + .5) * 255;
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  normalTextures.set(size, texture);
  return texture;
}

export function waterWaveHeight(x, z, time) {
  return waves.reduce((height, wave) =>
    height + wave.amplitude * Math.sin(wave.x * x + wave.z * z + wave.speed * time), 0);
}

export function createWaterWaveClock({ flow = { x: 1, z: 0 }, flowSpeed = 1.6,
  hazeColor = 0x858b7c, reflection = .7 } = {}) {
  if (!flow || !Number.isFinite(flow.x) || !Number.isFinite(flow.z) ||
    !Number.isFinite(flowSpeed) || !Number.isFinite(reflection))
    throw new RangeError('Water wave settings must be finite');
  const uniform = { value: 0 };
  const flowUniform = { value: new THREE.Vector2(flow.x, flow.z) };
  const hazeUniform = { value: new THREE.Color(hazeColor) };
  const speedUniform = { value: flowSpeed };
  const reflectionUniform = { value: reflection };
  const normalMaterials = new Set();
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
  const surfaceDefinitions = `
    uniform vec2 waterFlow;
    uniform float waterFlowSpeed;
    uniform vec3 waterHazeColor;
    uniform float waterReflection;
    varying float vWaterDepth;
    varying vec3 vWaterWorld;
    float waterFoam = 0.;
    float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float waterNoise(vec2 p) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
      return mix(mix(waterHash(i), waterHash(i + vec2(1., 0.)), u.x),
        mix(waterHash(i + vec2(0., 1.)), waterHash(i + vec2(1., 1.)), u.x), u.y);
    }
  `;
  return {
    attach(material, localVertical) {
      if (localVertical !== 'y' && localVertical !== 'z') throw new RangeError('Invalid water vertical axis');
      const riverSurface = material.isMeshStandardMaterial;
      if (riverSurface) {
        const normalMap = createWaterNormalTexture().clone();
        normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
        normalMap.needsUpdate = true;
        material.normalMap = normalMap;
        material.normalScale.set(.42, .42);
        material.userData.waterWaveTexture = normalMap;
        normalMaterials.add(material);
        material.needsUpdate = true;
      }
      const uniforms = {
        waterTime: uniform,
        waterFlow: flowUniform,
        waterFlowSpeed: speedUniform,
        waterHazeColor: hazeUniform,
        waterReflection: reflectionUniform,
      };
      material.onBeforeCompile = shader => {
        shader.uniforms.waterTime = uniform;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
${riverSurface ? 'attribute float waterDepth; varying float vWaterDepth; varying vec3 vWaterWorld;' : ''}
${definitions}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec2 waterPosition = (modelMatrix * vec4(transformed, 1.0)).xz;
          ${riverSurface ? 'vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz; vWaterDepth = waterDepth;' : ''}
          transformed.${localVertical} += waterHeight(waterPosition);
        `);
        if (!riverSurface) return;
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>
${surfaceDefinitions}
${definitions}`)
          .replace('#include <color_fragment>', `#include <color_fragment>
          vec2 waterDrift = waterFlow * waterTime * waterFlowSpeed;
          float sediment = waterNoise((vWaterWorld.xz - waterDrift) * vec2(.006, .014)) * .6
            + waterNoise((vWaterWorld.xz - waterDrift * 1.2) * vec2(.03, .07)) * .4;
          float currentStreak = smoothstep(.62, .9,
            waterNoise((vWaterWorld.xz - waterDrift * 1.4) * vec2(.02, .55)));
          float shallow = 1. - smoothstep(.2, 4., vWaterDepth);
          diffuseColor.rgb *= .86 + sediment * .28;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .35, .23), shallow * .3);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + .03,
            currentStreak * .35 * (1. - shallow));
          float foamBand = 1. - smoothstep(.15, 2.2, vWaterDepth);
          float foamPattern = smoothstep(.45, .8,
            waterNoise((vWaterWorld.xz - waterDrift * 1.3) * vec2(.6, 1.8)));
          waterFoam = foamBand * foamPattern;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.68, .65, .57), waterFoam * .8);`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, .22, (1. - shallow) * .5);
          roughnessFactor = mix(roughnessFactor, .8, waterFoam);`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec2 gradient = waterGradient(vWaterWorld.xz);
          normal = normalize(normal + mat3(viewMatrix) * vec3(-gradient.x, 0.0, -gradient.y) * 2.0);`)
          .replace('#include <opaque_fragment>', `
          vec3 waterViewDir = normalize(vWaterWorld - cameraPosition);
          vec3 waterNormalWorld = normalize(inverseTransformDirection(normal, viewMatrix));
          vec3 waterReflectionDir = reflect(waterViewDir, waterNormalWorld);
          float waterFresnel = .02 + .98 * pow(1. - clamp(dot(-waterViewDir, waterNormalWorld), 0., 1.), 5.);
          float reflectedSky = max(waterReflectionDir.y, 0.);
          vec3 reflectedColor = mix(waterHazeColor * 1.04, vec3(.6, .67, .74), pow(reflectedSky, .6));
          reflectedColor = mix(reflectedColor, vec3(.86, .86, .84),
            smoothstep(.45, .75, waterNoise(waterReflectionDir.xz / max(.08, reflectedSky) * .6 + waterTime * .002))
              * smoothstep(.02, .2, reflectedSky) * .6);
          outgoingLight = mix(outgoingLight, reflectedColor,
            waterFresnel * waterReflection * (1. - waterFoam) * .55);
          #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => `water-waves-${localVertical}-${riverSurface ? 'river' : 'ripple'}-v2`;
    },
    update(time, haze = null) {
      uniform.value = time;
      if (haze?.isColor) hazeUniform.value.copy(haze);
      for (const material of normalMaterials) {
        const texture = material.userData.waterWaveTexture;
        texture.offset.set(-flow.x * time * flowSpeed * .002, -flow.z * time * flowSpeed * .002);
      }
    },
  };
}
