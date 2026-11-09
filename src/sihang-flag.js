import * as THREE from 'three';

export function createSihangFlag(material) {
  const group = new THREE.Group();
  group.name = 'sihang-roof-roc-flag';
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.055, .065, 7, 8), material);
  pole.position.y = 3.5; group.add(pole);
  const width = 384, height = 256, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // DataTexture's first row is the bottom of the cloth.
    let color = [194, 25, 38];
    if (x < width / 2 && y >= height / 2) {
      color = [14, 43, 126];
      const dx = (x - width / 4) / height, dy = (y - height * .75) / height;
      const angle = Math.atan2(dy, dx), radius = Math.hypot(dx, dy);
      const sector = ((angle + Math.PI * 2) % (Math.PI / 6)) - Math.PI / 12;
      // Twelve triangular rays surrounding a separate white disc and blue ring.
      const rayRadius = .1875 * Math.cos(Math.PI / 12) /
        Math.cos(Math.PI / 12 - Math.abs(sector));
      const triangularRadius = .095 + (.1875 - .095) * (1 - Math.abs(sector) / (Math.PI / 12));
      if (radius < .0833 || radius > .104 && radius < Math.min(rayRadius, triangularRadius)) color = [255, 255, 255];
    }
    const i = (y * width + x) * 4;
    pixels.set([...color, 255], i);
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const clothMaterial = new THREE.MeshStandardMaterial({
    map: texture, side: THREE.DoubleSide, roughness: .95, metalness: 0,
  });
  const geometry = new THREE.PlaneGeometry(3, 2, 24, 16);
  geometry.translate(1.5, 0, 0);
  const rest = Float32Array.from(geometry.attributes.position.array);
  const cloth = new THREE.Mesh(geometry, clothMaterial);
  cloth.name = 'sihang-roc-cloth'; cloth.position.y = 5.85;
  cloth.userData.flag = { nation: 'ROC', aspect: 1.5, rays: 12, pinnedHoist: true };
  // Fixed conservative bounds cover every fold; flag is deliberately absent from solids.
  geometry.boundingBox = new THREE.Box3(new THREE.Vector3(0, -1.25, -.75), new THREE.Vector3(3, 1.25, .75));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(1.5, 0, 0), 2.05);
  group.add(cloth);
  function update(time) {
    if (!Number.isFinite(time)) throw new RangeError('Sihang flag requires finite simulation time');
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], free = x / 3;
      positions.setXYZ(i, x,
        x === 0 ? y : y + free * (.11 * Math.sin(x * 3.2 - time * 2.3 + y * 2) - .08 * free),
        x === 0 ? 0 : free * (.38 * Math.sin(x * 2.8 - time * 2.6 + y * 1.3) +
          .13 * Math.sin(x * 6.5 + y * 3 - time * 3.7)));
    }
    positions.needsUpdate = true; geometry.computeVertexNormals();
  }
  cloth.userData.updateFlag = update; group.userData.updateFlag = update;
  update(0);
  return { group, cloth, update, triangles: 768, vertices: 425 };
}
