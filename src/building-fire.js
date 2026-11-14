import * as THREE from 'three';

const fraction = value => value - Math.floor(value);
const noise = value => fraction(Math.sin(value * 127.1 + 311.7) * 43758.5453);

export function createBuildingFire(scene, buildings, { flames = true } = {}) {
  if (typeof flames !== 'boolean') throw new TypeError('Building flames option must be boolean');
  const sources = buildings.filter(building => building.damaged || building.ruined).map((building, index) => {
    const width = building.width ?? building.w ?? 6, depth = building.depth ?? building.d ?? 6;
    const phase = noise(index + 1), outskirts = building.near !== undefined;
    // Nanjing loses its eastern roof half; town/outskirts roofs survive only at the rear.
    const x = building.x + (building.width ? width * .24 : 0);
    const z = building.z + (building.width ? 0 : depth * .23);
    const y = outskirts ? building.near ? Math.min(building.height, 3.8) + .025 : .505 : .045;
    const spreadX = Math.min(width * (building.width ? .15 : .3), 3.3);
    const spreadZ = Math.min(depth * .21, 3.1);
    const sites = Array.from({ length: 3 }, (_, site) => ({
      x: x + (site - 1) * spreadX * .66,
      y, z: z + (noise(index * 7 + site + 4) - .5) * spreadZ,
      size: .8 + noise(index * 13 + site + 8) * .65,
      phase: noise(index * 11 + site + 2),
    }));
    return { id: building.id, x, y, z, phase, sites };
  });
  const groups = [];
  for (const fire of [false, true]) {
    const capacity = Math.max(1, sources.length * (fire ? 27 : 10));
    const geometry = new THREE.PlaneGeometry(1, 1, fire ? 8 : 1, fire ? 8 : 1);
    for (const name of ['plumeOpacity', 'plumeKind', 'plumeSeed']) {
      geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
    }
    const material = new THREE.ShaderMaterial({
      uniforms: { fire: { value: fire ? 1 : 0 }, time: { value: 0 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        attribute float plumeOpacity;
        attribute float plumeKind;
        attribute float plumeSeed;
        uniform float fire;
        uniform float time;
        varying vec2 plumeUV;
        varying float opacity;
        varying float kind;
        varying float seed;
        varying float shellFacing;
        void main() {
          plumeUV = uv; opacity = plumeOpacity; kind = plumeKind; seed = plumeSeed;
          vec3 local = position;
          shellFacing = 1.;
          if (fire > .5 && kind < .5) {
            float angle = uv.x * 6.2831853;
            float radius = pow(1. - uv.y, .75) * (.38 + .07 * sin(uv.y * 19. - time * 5. + seed * 31.)
              + .045 * sin(angle * 3. + uv.y * 13. - time * 3.));
            local = vec3(cos(angle) * radius, uv.y - .5, sin(angle) * radius * .75);
            float bend = uv.y * uv.y;
            local.x += bend * (.16 * sin(time * 2.8 + seed * 31. + uv.y * 4.)
              + .08 * sin(time * 5.1 + seed * 47. - uv.y * 7.));
            local.z += bend * .13 * sin(time * 2.3 + seed * 19. + uv.y * 5.);
          }
          vec4 center = modelViewMatrix * instanceMatrix * vec4(local, 1.);
          if (fire > .5 && kind < .5) {
            vec3 normal = normalize((modelViewMatrix * instanceMatrix * vec4(cos(uv.x * 6.2831853), .25, sin(uv.x * 6.2831853), 0.)).xyz);
            shellFacing = abs(dot(normal, normalize(-center.xyz)));
          }
          if (fire < .5 || kind > 1.5) {
            center = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
            center.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          }
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `
        uniform float fire;
        uniform float time;
        varying vec2 plumeUV;
        varying float opacity;
        varying float kind;
        varying float seed;
        varying float shellFacing;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 cell = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(hash(cell), hash(cell + vec2(1., 0.)), f.x),
            mix(hash(cell + vec2(0., 1.)), hash(cell + vec2(1., 1.)), f.x), f.y);
        }
        void main() {
          vec2 uv = plumeUV, p = uv * 2. - 1.;
          float alpha; vec3 color;
          if (fire < .5) {
            float billow = noise(uv * 5. + vec2(seed * 71., -time * .17));
            float edge = 1. - length(p * vec2(1., .9)) + (billow - .5) * .38;
            alpha = smoothstep(0., .6, edge) * opacity;
            color = mix(vec3(.085, .072, .059), vec3(.24, .225, .20), uv.y * .6 + billow * .25);
            color += vec3(.15, .043, .008) * (1. - uv.y) * opacity;
          } else if (kind > 1.5) {
            alpha = (1. - smoothstep(.1, 1., length(p))) * opacity;
            color = vec3(1., .36 + seed * .3, .035);
          } else if (kind > .5) {
            float grain = noise(uv * 15. + seed * 57.);
            float edge = 1. - length(p) + (noise(uv * 7. + seed * 29.) - .5) * .3;
            float coal = smoothstep(.66, .84, grain) * smoothstep(0., .55, edge);
            float pulse = .72 + .28 * sin(time * 3. + seed * 23. + grain * 9.);
            color = mix(vec3(.025, .017, .012), vec3(.95, .12, .005) * pulse, coal);
            alpha = smoothstep(0., .18, edge) * opacity;
          } else {
            float flow = noise(vec2(uv.x * 5. + seed * 59., uv.y * 6. - time * (2.1 + seed)));
            float detail = noise(vec2(uv.x * 11. - seed * 37., uv.y * 13. - time * 4.));
            float body = smoothstep(.08, .55, shellFacing) * (.65 + flow * .35);
            alpha = body * (1. - smoothstep(.65 + flow * .18, 1., uv.y)) * smoothstep(0., .09, uv.y) * opacity;
            float heat = clamp((1. - uv.y) * .92 + flow * .16 + detail * .12, 0., 1.);
            color = mix(vec3(.85, .075, .006), vec3(1., .43, .025), smoothstep(.12, .65, heat));
            color = mix(color, vec3(1., .71, .18), smoothstep(.66, 1., heat));
          }
          if (alpha < .01) discard;
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = fire ? 'damaged-building-flames' : 'damaged-building-smoke';
    mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = fire ? 1 : 2;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh); groups.push({ mesh, fire, attributes: geometry.attributes });
  }
  const dummy = new THREE.Object3D();
  function update(time, { smoke = true, low = false } = {}) {
    if (!Number.isFinite(time)) throw new RangeError('Building fire requires simulation time');
    // Bound GPU time as well as phase arithmetic during long-running sessions.
    time %= 4096;
    for (const { mesh, fire, attributes } of groups) {
      if (fire && !flames) {
        mesh.count = 0; mesh.visible = false;
        continue;
      }
      let index = 0;
      const put = (x, y, z, width, height, yaw, opacity, kind, seed) => {
        dummy.position.set(x, y, z); dummy.scale.set(width, height, 1);
        dummy.rotation.set(kind === 1 ? -Math.PI / 2 : 0, kind === 1 ? 0 : yaw, kind === 1 ? yaw : 0);
        dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
        attributes.plumeOpacity.setX(index, opacity);
        attributes.plumeKind.setX(index, kind); attributes.plumeSeed.setX(index++, seed);
      };
      for (const source of sources) {
        if (fire) {
          // All quality levels retain a fire bed and spatially separated flame volumes.
          for (const site of source.sites) {
            put(site.x, site.y, site.z, site.size * 2.4, site.size * 1.9, site.phase * 6.28, .96, 1, site.phase);
            const tongues = low ? 2 : 6;
            for (let layer = 0; layer < tongues; layer++) {
              const seed = noise(site.phase * 100 + layer);
              const pulse = .82 + .18 * Math.sin(time * (3.2 + seed) + seed * 31.);
              const height = site.size * (1.1 + seed * 1.6) * pulse;
              const angle = layer * 2.39996 + site.phase * 6.28;
              const reach = layer < 2 ? .18 : .5;
              put(site.x + Math.cos(angle) * site.size * reach, site.y + height / 2 + .015,
                site.z + Math.sin(angle) * site.size * reach,
                site.size * (.65 + noise(seed * 17) * .65), height, angle, .91, 0, seed);
            }
          }
          for (let ember = 0; ember < (low ? 1 : 6); ember++) {
            const site = source.sites[ember % 3], seed = noise(ember + source.phase * 43);
            const phase = fraction(time / (2.8 + seed * 2) + seed);
            put(site.x + phase * .9 + Math.sin(time + seed * 31.) * phase * .25,
              site.y + .3 + phase * (2.4 + seed * 2), site.z + phase * .3,
              .035 + seed * .025, .065 + seed * .045, 0, Math.sin(phase * Math.PI) * .9, 2, seed);
          }
        } else if (smoke) {
          const layers = low ? 4 : 10;
          for (let layer = 0; layer < layers; layer++) {
            const phase = fraction(time / 10 + source.phase + layer / layers);
            const site = source.sites[layer % 3];
            const size = site.size * (1.6 + phase * 5.2);
            put(site.x + phase * 3.4, site.y + 1.2 + phase * 12,
              site.z + phase * .8, size, size * 1.15, 0,
              Math.min(1, phase * 6) * (1 - phase) * .55, 0, site.phase + layer * .13);
          }
        }
      }
      mesh.count = index; mesh.visible = index > 0;
      mesh.material.uniforms.time.value = time;
      mesh.instanceMatrix.needsUpdate = true;
      for (const name of ['plumeOpacity', 'plumeKind', 'plumeSeed']) attributes[name].needsUpdate = true;
    }
  }
  update(0);
  return { sources, update, get snapshot() { return { sources: sources.length,
    smoke: groups[0].mesh.count, flames: groups[1].mesh.count, drawCalls: groups.filter(group => group.mesh.visible).length }; } };
}
