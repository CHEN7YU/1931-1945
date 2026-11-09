import * as THREE from 'three';

export function createBuildingFire(scene, buildings) {
  const sources = buildings.filter(building => building.damaged || building.ruined).map((building, index) => {
    const turn = Number.isInteger(building.facing) && building.width ? building.facing * Math.PI / 2 : 0;
    const offset = (building.width ?? building.w ?? 6) * .27;
    return { id: building.id, x: building.x + (building.width ? offset * Math.cos(turn) : 0),
      y: building.near !== undefined ? Math.min(building.height * .6, 3.8) + .3 : building.width ? .45 : 1.35,
      z: building.z + (building.width ? -offset * Math.sin(turn) : (building.d ?? 6) * .27),
      phase: (index * .61803398875) % 1 };
  });
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const r = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5);
    const grain = .76 + .14 * Math.sin(x * .47 + y * .21) + .1 * Math.cos(y * .39 - x * .17);
    pixels.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - r) ** 1.4 * grain)], (y * 64 + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, 64, 64);
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const groups = [];
  for (const fire of [false, true]) {
    const capacity = Math.max(1, sources.length * (fire ? 3 : 8));
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute('plumeOpacity', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { plumeMap: { value: texture }, fire: { value: fire ? 1 : 0 }, time: { value: 0 } },
      transparent: true, depthWrite: false,
      vertexShader: `
        attribute float plumeOpacity;
        varying vec2 plumeUV;
        varying float opacity;
        void main() {
          plumeUV = uv; opacity = plumeOpacity;
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
          center.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
          gl_Position = projectionMatrix * center;
        }`,
      fragmentShader: `
        uniform sampler2D plumeMap;
        uniform float fire;
        uniform float time;
        varying vec2 plumeUV;
        varying float opacity;
        void main() {
          vec2 uv = plumeUV;
          uv.x += fire * .06 * sin(uv.y * 13. - time * 8.);
          float alpha = texture2D(plumeMap, uv).a * opacity;
          if (alpha < .008) discard;
          vec3 color = mix(vec3(.095, .087, .077),
            mix(vec3(1., .16, .015), vec3(1., .73, .15), (1. - uv.y) * (1. - uv.y)), fire);
          gl_FragColor = vec4(color, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.name = fire ? 'damaged-building-flames' : 'damaged-building-smoke';
    mesh.frustumCulled = false; mesh.count = 0; mesh.renderOrder = fire ? 2 : 1;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(mesh); groups.push({ mesh, fire, opacity: geometry.attributes.plumeOpacity });
  }
  const dummy = new THREE.Object3D();
  function update(time, { smoke = true, low = false } = {}) {
    if (!Number.isFinite(time)) throw new RangeError('Building fire requires simulation time');
    for (const group of groups) {
      const { mesh, fire, opacity } = group;
      const layers = fire ? low ? 1 : 3 : low ? 3 : 8;
      let index = 0;
      if (fire || smoke) for (const source of sources) for (let layer = 0; layer < layers; layer++) {
        const phase = ((time / (fire ? 1.15 : 9) + source.phase + layer / layers) % 1 + 1) % 1;
        const size = fire ? .8 + Math.sin(phase * Math.PI) * .7 : 1.5 + phase * 6;
        dummy.position.set(source.x + (fire ? Math.sin(time * 4 + layer) * .13 : phase * 3),
          source.y + (fire ? .6 + phase * 1.6 : 1.4 + phase * 13), source.z);
        dummy.scale.set(size, size * (fire ? 2 : 1.1), 1); dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        opacity.setX(index++, Math.sin(phase * Math.PI) * (fire ? .92 : .62));
      }
      mesh.count = index; mesh.visible = index > 0;
      mesh.material.uniforms.time.value = time;
      mesh.instanceMatrix.needsUpdate = true; opacity.needsUpdate = true;
    }
  }
  update(0);
  return { sources, update, get snapshot() { return { sources: sources.length,
    smoke: groups[0].mesh.count, flames: groups[1].mesh.count, drawCalls: groups.filter(group => group.mesh.visible).length }; } };
}
