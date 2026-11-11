import * as THREE from 'three';

const materials = new WeakMap(), views = new WeakMap();

export function createEvacuationInstances(geometry, source, capacity) {
  if (!materials.has(source)) {
    const material = source.clone(), compile = source.onBeforeCompile, key = source.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      shader.vertexShader = `attribute float evacuationOpacity;\nvarying float vEvacuationOpacity;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEvacuationOpacity = evacuationOpacity;');
      shader.fragmentShader = `varying float vEvacuationOpacity;\n${shader.fragmentShader}`
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
if (vEvacuationOpacity < 1.0 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= vEvacuationOpacity) discard;`);
    };
    material.customProgramCacheKey = () => `${key}:evacuation-dither`;
    materials.set(source, material); materials.set(material, material);
  }
  const owned = geometry.attributes.evacuationOpacity ? geometry.clone() : geometry;
  owned.setAttribute('evacuationOpacity', new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1)
    .setUsage(THREE.DynamicDrawUsage));
  return new THREE.InstancedMesh(owned, materials.get(source), capacity);
}

export function setInstanceEvacuationOpacity(mesh, index, opacity = 1) {
  let attribute = mesh.geometry.attributes.evacuationOpacity;
  if (attribute.count < mesh.instanceMatrix.count) {
    const values = new Float32Array(mesh.instanceMatrix.count).fill(1); values.set(attribute.array);
    attribute = new THREE.InstancedBufferAttribute(values, 1).setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute('evacuationOpacity', attribute);
  }
  attribute.setX(index, opacity); attribute.needsUpdate = true;
}

export function setViewEvacuationOpacity(root, opacity = 1) {
  let state = views.get(root);
  if (!state && opacity === 1) return;
  if (!state) {
    state = [];
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const original = mesh.material;
      const clone = source => {
        const material = source.clone();
        material.onBeforeCompile = source.onBeforeCompile; material.customProgramCacheKey = source.customProgramCacheKey;
        material.transparent = true;
        return material;
      };
      mesh.material = Array.isArray(original) ? original.map(clone) : clone(original);
      state.push({ mesh, original });
    });
    views.set(root, state);
  }
  for (const { mesh, original } of state) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.opacity = opacity;
      if (opacity === 1) material.dispose();
    }
    if (opacity === 1) mesh.material = original;
  }
  if (opacity === 1) views.delete(root);
}
