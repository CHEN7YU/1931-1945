import * as THREE from 'three';

export function hasIjaRifleFlag(actor) {
  if (actor.team !== 'enemy') return false;
  if (!actor.id || !actor.unitId) throw new Error('Rifle flag assignment requires an owned soldier identity');
  let seed = 2166136261;
  for (const letter of `${actor.unitId}:${actor.id}`) seed = Math.imul(seed ^ letter.charCodeAt(0), 16777619) >>> 0;
  return seed % 5 === 0;
}

const clothTime = { value: 0 };
const clothShader = `
uniform float ijaClothTime;
attribute vec3 ijaClothAnchor;
vec3 ijaClothOffset(vec2 clothUv, vec3 anchor) {
  float u = clothUv.x, down = 1.0 - clothUv.y;
  float phase = ijaClothTime * 2.8 + anchor.x * .31 + anchor.z * .23;
  float loose = pow(u, .8);
  float spread = .27 * u * (.78 + .09 * sin(phase * .37));
  float sag = -.18 * down - .10 * pow(u, 1.3);
  sag += .018 * sin(phase - u * 7.0 + down * 2.0) * loose * down;
  float fold = (.026 * sin(u * 9.0 - phase) * (.35 + .65 * down)
    + .012 * sin(down * 10.0 + u * 5.0 + phase * .7)) * loose;
  vec3 wind = normalize(vec3(.8, 0.0, .35));
  return wind * spread + vec3(0.0, sag, 0.0) + vec3(-wind.z, 0.0, wind.x) * fold;
}
mat4 ijaClothFrame() {
  mat4 frame = modelMatrix;
  #ifdef USE_INSTANCING
    frame = frame * instanceMatrix;
  #endif
  return frame;
}
vec3 ijaClothLocal(vec3 world, mat4 frame) {
  vec3 delta = world - frame[3].xyz;
  return vec3(dot(frame[0].xyz, delta) / dot(frame[0].xyz, frame[0].xyz),
    dot(frame[1].xyz, delta) / dot(frame[1].xyz, frame[1].xyz),
    dot(frame[2].xyz, delta) / dot(frame[2].xyz, frame[2].xyz));
}
`;

function configureClothMaterial(material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.ijaClothTime = clothTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${clothShader}`)
      .replace('#include <begin_vertex>', `
        mat4 clothFrame = ijaClothFrame();
        vec3 clothAnchor = (clothFrame * vec4(ijaClothAnchor, 1.0)).xyz;
        vec3 transformed = ijaClothLocal(clothAnchor + ijaClothOffset(uv, clothAnchor), clothFrame);
      `)
      .replace('#include <beginnormal_vertex>', `
        #include <beginnormal_vertex>
        mat4 clothNormalFrame = ijaClothFrame();
        vec3 normalAnchor = (clothNormalFrame * vec4(ijaClothAnchor, 1.0)).xyz;
        vec3 clothBase = ijaClothOffset(uv, normalAnchor);
        vec3 clothU = ijaClothOffset(uv + vec2(.001, 0.0), normalAnchor) - clothBase;
        vec3 clothV = ijaClothOffset(uv + vec2(0.0, .001), normalAnchor) - clothBase;
        vec3 clothNormal = normalize(cross(clothU, clothV));
        objectNormal = vec3(dot(clothNormalFrame[0].xyz, clothNormal),
          dot(clothNormalFrame[1].xyz, clothNormal), dot(clothNormalFrame[2].xyz, clothNormal));
      `);
  };
  material.customProgramCacheKey = () => 'ija-soft-rifle-flag-v1';
  return material;
}

export function updateIjaRifleFlagTime(now) {
  if (!Number.isFinite(now) || now < 0) throw new Error('Rifle flag requires finite simulation time');
  clothTime.value = now;
}

export function bakeIjaRifleFlag(geometry, mesh) {
  const anchor = mesh.getWorldPosition(new THREE.Vector3()), values = new Float32Array(geometry.attributes.position.count * 3);
  for (let index = 0; index < values.length; index += 3) anchor.toArray(values, index);
  geometry.setAttribute('ijaClothAnchor', new THREE.Float32BufferAttribute(values, 3));
  // GPU cloth stays within this pin-centred bound, independently of the rifle's orientation.
  geometry.boundingSphere = new THREE.Sphere(anchor, .5);
  return geometry;
}

let geometry, material, depthMaterial, distanceMaterial;
export function createIjaRifleFlag() {
  if (!geometry) {
    geometry = new THREE.PlaneGeometry(.27, .18, 12, 8);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index++) {
      const u = uv.getX(index), v = uv.getY(index);
      positions.setXYZ(index, u * .27, -(1 - v) * .18 - .10 * u ** 1.3,
        .026 * Math.sin(u * Math.PI * 3 + v * 2) * u);
    }
    geometry.setAttribute('ijaClothAnchor', new THREE.Float32BufferAttribute(
      new Float32Array(positions.count * 3), 3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), .5);
    const width = 96, height = 64, pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const red = Math.hypot(x + .5 - width / 2, y + .5 - height / 2) <= height * .3;
      pixels.set(red ? [167, 28, 36, 255] : [226, 218, 196, 255], (y * width + x) * 4);
    }
    const map = new THREE.DataTexture(pixels, width, height);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.needsUpdate = true;
    material = configureClothMaterial(new THREE.MeshStandardMaterial({ map, roughness: 1, side: THREE.DoubleSide }));
    depthMaterial = configureClothMaterial(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
    distanceMaterial = configureClothMaterial(new THREE.MeshDistanceMaterial({ side: THREE.DoubleSide }));
  }
  const flag = new THREE.Mesh(geometry, material);
  flag.position.set(.022, -.014, -.705);
  flag.customDepthMaterial = depthMaterial; flag.customDistanceMaterial = distanceMaterial;
  flag.name = 'ija-rifle-flag'; flag.castShadow = flag.receiveShadow = true;
  flag.userData.rifleAttachment = true;
  return flag;
}
