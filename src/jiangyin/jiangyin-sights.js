// 江阴要塞：火炮瞄准镜（右键放大时出现）。参照 Enlisted / Easy Red 2 的做法——放大时不再只是把画面拉近，
// 而是换成炮手望远镜的圆形视场：视场外全黑，镜筒边缘有暗角，分划按真实角度绘制（中国军队用 6000 密位制）。
//   coastal：岸防炮直接瞄准镜——德式三柱分划（左右横柱、下方尖柱）+ 横向密位刻度；
//   flak88：高射炮瞄准镜——十字线 + 两圈对空提前量环（约 20、40 密位）；
//   naval：舰炮/艇首炮——十字线 + 横向/纵向密位刻度。
// 纯 SVG 叠加层，不增加任何 3D 渲染开销。
const NS = 'http://www.w3.org/2000/svg';
const MIL = Math.PI * 2 / 6000;   // 1 密位（弧度）

const el = (name, attrs = {}, parent = null) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.append(node);
  return node;
};

export function sightKind(weapon) {
  if (!weapon?.cannon) return null;
  if (weapon.variant === 'flak88') return 'flak88';
  if (weapon.mount === 'coastal') return 'coastal';
  return 'naval';
}

export function createSightOverlay(container, before = null) {
  const svg = el('svg', { id: 'jy-sight', 'aria-hidden': 'true' });
  container.insertBefore(svg, before);   // 放在 HUD 之前：弹药、炮位列表等仍显示在瞄准镜之上
  let key = '', shown = false;
  function draw(kind, width, height, fovDeg) {
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const cx = width / 2, cy = height / 2, R = Math.min(width, height) * .46;
    // 每密位多少像素：竖直视场 fov 对应半屏高
    const pxPerMil = (height / 2) / Math.tan(fovDeg * Math.PI / 360) * Math.tan(MIL);
    const defs = el('defs', {}, svg);
    const vignette = el('radialGradient', { id: 'jy-sight-vig', cx: .5, cy: .5, r: .5 }, defs);
    el('stop', { offset: '0.72', 'stop-color': '#000', 'stop-opacity': 0 }, vignette);
    el('stop', { offset: '0.93', 'stop-color': '#000', 'stop-opacity': .55 }, vignette);
    el('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': .95 }, vignette);
    // 视场外全黑（偶奇填充挖出圆孔）
    el('path', { d: `M0 0H${width}V${height}H0Z M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0Z`,
      fill: '#050505', 'fill-rule': 'evenodd' }, svg);
    el('circle', { cx, cy, r: R, fill: 'url(#jy-sight-vig)' }, svg);
    el('circle', { cx, cy, r: R - 1, fill: 'none', stroke: '#3a2e1c', 'stroke-width': 3, opacity: .7 }, svg);   // 镜筒内沿的暗铜色反光
    const ink = { stroke: '#0b0b0b', 'stroke-linecap': 'butt' };
    const g = el('g', {}, svg);
    const clip = el('clipPath', { id: 'jy-sight-clip' }, defs); el('circle', { cx, cy, r: R }, clip);
    g.setAttribute('clip-path', 'url(#jy-sight-clip)');
    const line = (x1, y1, x2, y2, w = 1.4) => el('line', { x1, y1, x2, y2, ...ink, 'stroke-width': w }, g);
    const text = (x, y, s, size = 12) => { const t = el('text', { x, y, 'font-size': size, 'text-anchor': 'middle', fill: '#0b0b0b',
      'font-family': 'Microsoft YaHei, sans-serif' }, g); t.textContent = s; return t; };
    const m = v => v * pxPerMil;
    if (kind === 'coastal') {
      const gap = m(10), post = Math.max(5, m(2.4));
      el('rect', { x: cx - R, y: cy - post / 2, width: R - gap, height: post, fill: '#0b0b0b' }, g);           // 左横柱
      el('rect', { x: cx + gap, y: cy - post / 2, width: R - gap, height: post, fill: '#0b0b0b' }, g);         // 右横柱
      el('path', { d: `M${cx - post * .9} ${cy + R} L${cx - post * .9} ${cy + m(5)} L${cx} ${cy} L${cx + post * .9} ${cy + m(5)} L${cx + post * .9} ${cy + R}Z`,
        fill: '#0b0b0b' }, g);                                                                                   // 下方尖柱（尖端为瞄准点）
      for (let k = -40; k <= 40; k += 2) {                                                                       // 横向密位刻度
        if (Math.abs(k) < 2 || Math.abs(m(k)) > R) continue;
        const h = k % 10 === 0 ? m(2.4) : k % 4 === 0 ? m(1.4) : m(.8);
        line(cx + m(k), cy - post / 2 - h, cx + m(k), cy - post / 2, k % 10 === 0 ? 1.6 : 1);
        if (k % 10 === 0) text(cx + m(k), cy - post / 2 - h - 4, String(Math.abs(k)), 11);
      }
      text(cx, cy + R - 16, '岸防炮直接瞄准镜 · 6000 密位', 12);
    } else if (kind === 'flak88') {
      line(cx - R, cy, cx - m(3), cy); line(cx + m(3), cy, cx + R, cy);
      line(cx, cy - R, cx, cy - m(3)); line(cx, cy + m(3), cx, cy + R);
      el('circle', { cx, cy, r: m(1.2), fill: 'none', ...ink, 'stroke-width': 1.4 }, g);
      for (const [r, label] of [[20, '20'], [40, '40']]) {
        el('circle', { cx, cy, r: m(r), fill: 'none', ...ink, 'stroke-width': 1.2, 'stroke-dasharray': `${m(2)} ${m(2)}` }, g);
        text(cx + m(r) * .72 + 10, cy - m(r) * .72 - 4, label, 11);
      }
      for (let k = -60; k <= 60; k += 5) if (k && Math.abs(m(k)) < R) { const h = k % 10 === 0 ? m(1.6) : m(.8);
        line(cx + m(k), cy - h, cx + m(k), cy + h, 1); line(cx - h, cy + m(k), cx + h, cy + m(k), 1); }
      text(cx, cy + R - 16, '高射炮瞄准镜 · 对空提前量环（密位）', 12);
    } else {
      line(cx - R, cy, cx - m(4), cy, 1.6); line(cx + m(4), cy, cx + R, cy, 1.6);
      line(cx, cy + m(4), cx, cy + R, 1.6); line(cx, cy - R, cx, cy - m(4), 1);
      for (let k = -50; k <= 50; k += 5) if (k && Math.abs(m(k)) < R) {
        const h = k % 10 === 0 ? m(2) : m(1);
        line(cx + m(k), cy - h, cx + m(k), cy, 1);
        if (k > 0) { line(cx - h, cy + m(k), cx + h, cy + m(k), 1); if (k % 10 === 0) text(cx + h + 12, cy + m(k) + 4, String(k), 10); }
      }
      text(cx, cy + R - 16, '舰炮瞄准镜 · 6000 密位', 12);
    }
  }
  return {
    update({ kind, visible, fovDeg }) {
      const on = Boolean(kind && visible);
      if (on !== shown) { svg.classList.toggle('show', on); shown = on; }
      if (!on) return;
      const width = innerWidth, height = innerHeight, next = `${kind}:${width}:${height}:${Math.round(fovDeg * 10)}`;
      if (next !== key) { key = next; draw(kind, width, height, fovDeg); }
    },
    get visible() { return shown; },
  };
}
