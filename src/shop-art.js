import * as THREE from 'three';

export const SHOP_ART_STYLES = Object.freeze({
  'west-0': Object.freeze({ cloth: 0xc4b085, background: '#493b2c', ink: '#e5d6b1',
    caption: '米 麵 雜糧', notice: ['本號經營', '小米 白麵', '雜糧 豆類', '公平交易'] }),
  'east-0': Object.freeze({ cloth: 0x7d9690, background: '#29413c', ink: '#e1d7b6',
    caption: '棉布 土布', notice: ['布匹零售', '棉布 土布', '素色 花布', '歡迎選購'] }),
});

export const SHOP_ART_VIEWS = Object.freeze({
  grain: Object.freeze({ yaw: Math.PI / 2, pitch: .13 }),
  cloth: Object.freeze({ yaw: -Math.PI / 2, pitch: .13 }),
  ground: Object.freeze({ yaw: Math.PI / 2, pitch: -.58 }),
});

const AWNING = Object.freeze({ halfWidth: 1.4, back: .14, front: 1.12, rearY: 2.66, frontY: 2.47 });

export function shopAwningFrame() {
  const { halfWidth, back, front, rearY, frontY } = AWNING;
  const rear = x => [x, rearY - .018, back], tip = x => [x, frontY - .018, front];
  return [
    ...[-halfWidth, 0, halfWidth].map(x => ({ start: rear(x), end: tip(x), radius: .014 })),
    { start: rear(-halfWidth), end: rear(halfWidth), radius: .016 },
    { start: tip(-halfWidth), end: tip(halfWidth), radius: .016 },
    ...[-halfWidth, halfWidth].map(x => ({ start: [x, 2.2, back], end: tip(x), radius: .022 })),
  ];
}

export function shopAwningGeometry() {
  const positions = [], uv = [], colors = [], indices = [];
  const add = (x, y, z, u, v, shade) => {
    positions.push(x, y, z); uv.push(u, v); colors.push(shade, shade, shade);
  };
  const across = 40, forward = 16;
  const { halfWidth, back, front, rearY, frontY } = AWNING;
  for (let row = 0; row <= forward; row++) for (let column = 0; column <= across; column++) {
    const u = column / across, t = row / forward, x = (u * 2 - 1) * halfWidth, z = back + t * (front - back);
    const sag = Math.sin(u * Math.PI * 2) ** 2 * Math.sin(t * Math.PI) * .09;
    const folds = Math.sin(u * Math.PI * 16) * .007 * Math.sin(t * Math.PI);
    const patch = u >= .15 && u <= .3 && t >= .4 && t <= .75;
    const seam = column === 20 || row === 0 || row === forward;
    add(x, rearY + t * (frontY - rearY) - sag + folds, z, x / .35, z / .35,
      patch ? .7 : seam ? .76 : .89 + .08 * Math.sin(u * Math.PI));
    if (row < forward && column < across) {
      const at = row * (across + 1) + column;
      indices.push(at, at + across + 1, at + 1, at + 1, at + across + 1, at + across + 2);
    }
  }
  const start = positions.length / 3;
  const hems = [0, .08, .48, .94, 1];
  for (let row = 0; row < hems.length; row++) for (let column = 0; column <= across; column++) {
    const u = column / across, t = hems[row], x = (u * 2 - 1) * halfWidth;
    const drop = .205 + .012 * Math.sin(u * Math.PI * 8);
    const pleat = t * .032 * Math.sin(u * Math.PI * 12);
    add(x, frontY - t * drop, front + Math.min(1, t / .08) * .019 + pleat, x / .35, (front + t * drop) / .35,
      row === hems.length - 1 ? (column % 2 ? .72 : .56) : row === 0 ? .76 : .92);
    if (row < hems.length - 1 && column < across) {
      const at = start + row * (across + 1) + column;
      indices.push(at, at + 1, at + across + 1, at + 1, at + across + 2, at + across + 1);
    }
  }
  for (const side of [-1, 1]) {
    const offset = positions.length / 3;
    for (let row = 0; row <= forward; row++) for (let edge = 0; edge < 2; edge++) {
      const t = row / forward, drop = edge * (.03 + .175 * t);
      add(side * halfWidth, rearY + t * (frontY - rearY) - drop, back + t * (front - back),
        (back + t * (front - back)) / .35, drop / .35, edge ? .68 : .86);
      if (row < forward && !edge) {
        const at = offset + row * 2;
        indices.push(at, at + 1, at + 2, at + 1, at + 3, at + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

export function shopNoticeGeometry() {
  const geometry = new THREE.PlaneGeometry(.62, .775, 12, 16);
  const positions = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    let x = positions.getX(i), y = positions.getY(i);
    if (u === 0) x += .004 + .002 * Math.sin(v * 73) + Math.max(0, v - .84) * .06;
    if (u === 1) x -= .004 + .002 * Math.sin(v * 59);
    if (v === 0) y += .004 + .003 * Math.sin(u * 51);
    if (v === 1) y -= .004 + .002 * Math.sin(u * 47);
    const curl = .025 * Math.max(0, 1 - u / .25) * Math.max(0, 1 - v / .3)
      + .012 * Math.max(0, (u - .75) / .25) * Math.max(0, (v - .8) / .2);
    positions.setXYZ(i, x, y, curl + .0008 * Math.sin(u * 19 + v * 9));
  }
  geometry.computeVertexNormals(); geometry.computeBoundingBox();
  return geometry;
}

export function shopContactPatches(town) {
  return town.buildings.filter(shop => Object.hasOwn(SHOP_ART_STYLES, shop.id)).flatMap(shop => {
    const front = shop.x + shop.facing * shop.w / 2;
    return [
      { buildingId: shop.id, x: front + shop.facing * .48, z: shop.doorZ + shop.facing * 1.7, w: 1.05, d: 3.2 },
      { buildingId: shop.id, x: front + shop.facing * .78, z: shop.doorZ, w: 1.55, d: 2.3 },
    ];
  });
}

export function shopPrintMaterial(style, name, wood, plaster, notice = false) {
  const canvas = document.createElement('canvas');
  canvas.width = notice ? 512 : 1024; canvas.height = notice ? 640 : 256;
  const context = canvas.getContext('2d');
  context.fillStyle = notice ? '#c9b68f' : style.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.globalAlpha = notice ? .13 : .55;
  context.globalCompositeOperation = 'soft-light';
  if (notice) context.drawImage(plaster, 0, 0, canvas.width, canvas.height);
  else {
    context.translate(0, 256); context.rotate(-Math.PI / 2);
    context.drawImage(wood, 260, 0, 235, 1024, 0, 0, 256, 1024);
  }
  context.restore();
  if (!notice) {
    context.strokeStyle = style.ink; context.lineWidth = 4;
    context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  } else {
    const edge = context.createLinearGradient(0, 0, 512, 0);
    edge.addColorStop(0, 'rgba(86,57,25,.32)'); edge.addColorStop(.12, 'rgba(86,57,25,0)');
    edge.addColorStop(.88, 'rgba(86,57,25,0)'); edge.addColorStop(1, 'rgba(86,57,25,.25)');
    context.fillStyle = edge; context.fillRect(0, 0, 512, 640);
    const stain = context.createRadialGradient(35, 25, 4, 35, 25, 155);
    stain.addColorStop(0, 'rgba(117,77,32,.2)'); stain.addColorStop(1, 'rgba(117,77,32,0)');
    context.fillStyle = stain; context.fillRect(0, 0, 210, 195);
    context.strokeStyle = 'rgba(92,65,35,.23)'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(55, 155); context.lineTo(457, 155); context.stroke();
  }
  context.fillStyle = notice ? '#2f281f' : style.ink;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.font = `bold ${notice ? 68 : 142}px KaiTi, STKaiti, SimSun, serif`;
  if (notice) {
    style.notice.forEach((text, index) => {
      context.font = `${index ? '' : 'bold '}${index ? 61 : 74}px KaiTi, STKaiti, SimSun, serif`;
      context.fillText(text, 256, 100 + index * 138, 450);
    });
  } else {
    context.fillText(name, 512, 106, 890);
    context.font = '44px KaiTi, STKaiti, SimSun, serif';
    context.fillText(style.caption, 512, 213, 850);
  }
  // A local hash keeps print wear reproducible without advancing the world's random stream.
  const salt = Array.from(name).reduce((value, character) => Math.imul(value, 31) + character.codePointAt(0), 173);
  const noise = i => {
    let value = Math.imul(i + salt, 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  if (notice) {
    context.fillStyle = 'rgba(106,70,30,.13)';
    for (let i = 0; i < 80; i++) {
      const x = noise(i * 3) * 512, y = noise(i * 3 + 1) * 640;
      context.beginPath(); context.arc(x, y, .7 + noise(i * 3 + 2) * 1.8, 0, Math.PI * 2); context.fill();
    }
    context.strokeStyle = 'rgba(86,61,32,.17)'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(3, 441); context.lineTo(508, 445); context.stroke();
    context.strokeStyle = 'rgba(255,244,209,.25)'; context.lineWidth = 1;
    context.beginPath(); context.moveTo(3, 444); context.lineTo(508, 448); context.stroke();
    for (const x of [54, 458]) {
      const stain = context.createRadialGradient(x, 52, 1, x, 52, 17);
      stain.addColorStop(0, 'rgba(77,47,19,.4)'); stain.addColorStop(1, 'rgba(77,47,19,0)');
      context.fillStyle = stain; context.fillRect(x - 17, 35, 34, 34);
    }
  } else {
    const grain = document.createElement('canvas'); grain.width = 1024; grain.height = 256;
    const woodContext = grain.getContext('2d');
    woodContext.translate(0, 256); woodContext.rotate(-Math.PI / 2);
    woodContext.drawImage(wood, 260, 0, 235, 1024, 0, 0, 256, 1024);
    woodContext.setTransform(1, 0, 0, 1, 0, 0);
    woodContext.globalCompositeOperation = 'multiply'; woodContext.fillStyle = '#9b8060';
    woodContext.fillRect(0, 0, 1024, 256);
    context.fillStyle = context.createPattern(grain, 'no-repeat');
    for (let i = 0; i < 72; i++) {
      const edge = i % 4, along = noise(i * 5), inward = noise(i * 5 + 1) * 21;
      const x = edge < 2 ? along * 1024 : edge === 2 ? inward : 1024 - inward;
      const y = edge < 2 ? (edge ? 256 - inward : inward) : along * 256;
      const w = 3 + noise(i * 5 + 2) * 12, h = 2 + noise(i * 5 + 3) * 4;
      context.beginPath(); context.moveTo(x - w, y); context.lineTo(x - w * .3, y - h);
      context.lineTo(x + w * .7, y - h * .6); context.lineTo(x + w, y + h * .35);
      context.lineTo(x - w * .4, y + h); context.closePath(); context.fill();
    }
    context.strokeStyle = 'rgba(192,168,122,.24)'; context.lineWidth = 1;
    for (let i = 0; i < 25; i++) {
      const x = noise(i * 3) * 1024, y = noise(i * 3 + 1) * 256;
      context.beginPath(); context.moveTo(x, y); context.lineTo(x + 12 + noise(i * 3 + 2) * 35, y + .5); context.stroke();
    }
  }
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.userData.source = notice ? '/assets/materials/ai-scene/weathered-plaster/color.webp' : '/assets/materials/ai-scene/crate-timber/color.webp';
  map.userData.processing = notice ? 'Existing plaster grain on locally drawn aged paper, edge stains and fold; original typeset fictional notice.'
    : 'Existing single-plank crop under painted sign and exposed edge chips; original typeset shop name.';
  return new THREE.MeshStandardMaterial({ map, roughness: .95, side: notice ? THREE.DoubleSide : THREE.FrontSide });
}

export function shopContactMaterial(image) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, 512, 512, 0, 0, 256, 256);
  const pixels = context.getImageData(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const at = (y * 256 + x) * 4;
    const radius = Math.hypot((x - 127.5) / 123, (y - 127.5) / 123);
    pixels.data[at + 3] = Math.min(160, pixels.data[at + 3] * 4) * Math.max(0, 1 - radius) ** .65;
    pixels.data[at] = 164; pixels.data[at + 1] = 142; pixels.data[at + 2] = 107;
  }
  context.putImageData(pixels, 0, 0);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  map.userData.source = '/assets/materials/ai-scene/wall-grime/atlas.webp';
  map.userData.processing = 'First existing AI mask cell, recolored dust, radial alpha falloff; not baked lighting.';
  return new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
}
