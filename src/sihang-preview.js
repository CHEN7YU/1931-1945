import { SIHANG_WAREHOUSE as W, SIHANG_BRIDGE as B, SIHANG_MAP_BOUNDS as M,
  sihangBridgePoint, sihangRiverBounds, SIHANG_RESERVED_LANES } from './sihang-layout.js';

const px = x => (x - M.minX) * 960 / (M.maxX - M.minX);
const pz = z => (z - M.minZ) * 540 / (M.maxZ - M.minZ);
const edge = bank => Array.from({ length: 109 }, (_, i) => {
  const x = -108 + i * 2;
  return `${px(x).toFixed(1)},${pz(sihangRiverBounds(x)[bank]).toFixed(1)}`;
});
const north = edge('northZ'), south = edge('southZ');
const river = `M${north.join('L')}L${south.reverse().join('L')}Z`;
let blocks = '';
for (const z of [-99, -77, -59, 64]) for (const x of [-98, -84, -54, -40, -24, 20, 36, 54, 84, 98]) {
  if (SIHANG_RESERVED_LANES.some(l => x > l.minX - 6 && x < l.maxX + 6 && z > l.minZ - 6 && z < l.maxZ + 6)) continue;
  blocks += `<rect x="${px(x - 5.5)}" y="${pz(z - 5)}" width="${px(11) - px(0)}" height="${pz(10) - pz(0)}" fill="${z < 0 ? '#68645a' : '#ccb79a'}" stroke="#313c38" stroke-width="2"/>`;
}
for (const z of [-54, -64, -82]) for (const x of [-7.5, 7.5])
  blocks += `<rect x="${px(x - 3)}" y="${pz(z - 3)}" width="${px(6) - px(0)}" height="${pz(6) - pz(0)}" fill="#68645a" stroke="#313c38" stroke-width="2"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
<rect width="960" height="540" fill="#434c40"/>${blocks}
<path d="${river}" fill="#597d89"/>
<polygon points="${[[0, -1], [1, -1], [1, 1], [0, 1]].map(([fraction, side]) => {
  const point = sihangBridgePoint(fraction, side * B.width / 2); return `${px(point.x)},${pz(point.z)}`;
}).join(' ')}" fill="#c8bca5"/>
<rect x="${px(34.5)}" y="${pz(-60)}" width="${px(15) - px(0)}" height="${pz(18) - pz(0)}" fill="#9b927e" stroke="#ded4bb" stroke-width="2"/>
<rect x="${px(W.minX)}" y="${pz(W.minZ)}" width="${px(W.width) - px(0)}" height="${pz(W.depth) - pz(0)}" fill="#b5ab94" stroke="#ded4bb" stroke-width="4"/>
<path d="M${px(-78)} ${pz(-88)}L${px(-38)} ${pz(-42)}M${px(0)} ${pz(-94)}V${pz(-45)}M${px(78)} ${pz(-88)}L${px(30)} ${pz(-42)}" stroke="#c77c61" stroke-width="5"/>
<g fill="#f4e6c8" font-family="sans-serif" text-anchor="middle">
<text x="${px(-4)}" y="${pz(-22)}" font-size="26">四行仓库</text>
<text x="${px(-15)}" y="${pz(19)}" font-size="24">苏州河</text>
<text x="${px(B.x)}" y="${pz(B.z - 5)}" font-size="20">西藏路桥</text>
<text x="${px(0)}" y="${pz(55)}" font-size="23">中立南岸租界</text>
<text x="480" y="525" font-size="16">原创游戏布局示意 · 非历史照片或测绘图</text>
</g></svg>`;
export const SIHANG_PREVIEW = Object.freeze({
  src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  alt: '四行仓库游戏布局示意：完整仓库、北岸战损街区、弯曲苏州河及东侧西藏路桥，南岸为中立租界；非历史测绘图。',
});
