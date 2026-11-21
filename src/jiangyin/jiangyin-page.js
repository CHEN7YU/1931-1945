// 江阴要塞阻击战 · 页面结构。由大厅（index.html?map=jiangyin）进入时，替换大厅 DOM 为本关画布与 HUD。
// 不新增 HTML 入口，生产构建只多出带哈希的 js/css 分块，符合 scripts/audit-assets.mjs 的构建审计。
import { lobbyUrl } from './jiangyin-campaign.js';

export const JIANGYIN_MARKUP = `
<canvas id="jy-world" aria-label="江阴江面三维战场"></canvas>
<div id="jy-caption" class="jy-caption" hidden></div>
<div id="jy-hud" hidden>
  <div class="jy-top">
    <div><small id="jy-top-0-label">第一阶段</small><strong id="jy-top-0">江面决战</strong></div>
    <div><small id="jy-top-1-label">我舰尚存</small><strong id="jy-top-1">3/3</strong></div>
    <div><small id="jy-top-2-label">在场日舰</small><strong id="jy-top-2">0</strong></div>
  </div>
  <div id="jy-hurt"></div>
  <div id="jy-crosshair"><i></i><i></i></div>
  <div id="jy-interact"></div>
  <div id="jy-range"></div>
  <div id="jy-hitinfo" aria-live="polite"><b></b><span></span><i><em></em></i></div>
  <div id="jy-toast" role="status"></div>
  <ol id="jy-posts" aria-label="可接管阵位"></ol>
  <!-- 底部 HUD：与其他战役（index.html 的 .hud-bottom / .squad-status / .weapon-status / #minimap）同样的布局与样式 -->
  <div class="jy-hud-bottom">
    <div class="jy-squad-status" id="jy-squad-status" hidden>
      <div class="jy-squad-heading"><span id="jy-unit-title">步兵小队</span><kbd>Y</kbd></div>
      <div id="jy-members"></div>
    </div>
    <div class="jy-weapon-status jy-weapon">
      <div id="jy-movement"><span id="jy-pace">站定</span></div>
      <div class="jy-reload-track"><div id="jy-reload"></div></div>
      <div class="jy-hud-label" id="jy-weapon-name"></div>
      <div class="jy-ammo"><span id="jy-ammo"></span><small id="jy-ammo-max"></small></div>
      <div id="jy-equipment" aria-label="装备栏"></div>
      <div class="jy-health-track"><div id="jy-health-fill"></div></div><span id="jy-health-text"></span>
      <small id="jy-help">鼠标瞄准 · 左键开火 · V 第一/第三人称 · Q/E 或 1–8 切换阵位 · M 地图 · Esc 暂停</small>
    </div>
  </div>
  <div id="jy-minimap"><canvas id="jy-radar" width="352" height="352" aria-label="战术简图"></canvas><span>N ↑ / 战术简图</span></div>
</div>
<div id="jy-flash" aria-hidden="true"></div>
<div id="jy-fade" aria-hidden="true"></div>
<div id="jy-underwater" aria-hidden="true"></div>
<section id="jy-overlay" class="jy-overlay">
  <div class="jy-dialog">
    <span class="jy-kicker" id="jy-kicker">1937 · 江阴</span>
    <h1 id="jy-title">江阴要塞阻击战</h1>
    <p id="jy-text">日军舰队自下游（吴淞方向）逆流而上，企图摧毁江阴要塞。你随“平海”“宁海”“逸仙”三舰出战：舰艇由 AI 航行，你可在任一舰上操纵舰艏主炮塔。<br />
鼠标瞄准 · 左键开火 · 右键放大 · V 视角 · Q/E 或 1–3 换舰 · M 地图 · Esc 暂停</p>
    <div id="jy-stats"></div>
    <button id="jy-start" class="jy-primary">进入战场 ↗</button>
    <a class="jy-link" id="jy-lobby" href="/">返回作战大厅</a>
  </div>
</section>
`;

export function mountJiangyinPage(doc = document) {
  if (doc.getElementById('jy-world')) return false;
  doc.title = '江阴要塞阻击战 1937 · 山河 1931-1945';
  doc.body.className = 'jiangyin';
  doc.body.innerHTML = JIANGYIN_MARKUP;
  // 大厅 DOM 已被替换；停用大厅样式表，避免其全局规则（body、button、canvas 等）影响本关 HUD。
  // 开发服务器的 <style data-vite-dev-id> 与生产构建的 <link href=".../jiangyin-main-*.css"> 都含 jiangyin 字样。
  for (const node of doc.querySelectorAll('style, link[rel="stylesheet"]')) {
    const source = node.dataset?.viteDevId ?? node.getAttribute('href') ?? '';
    if (!/jiangyin/i.test(source)) node.disabled = true;
  }
  const lobby = doc.getElementById('jy-lobby');
  if (lobby) lobby.href = lobbyUrl(doc.location.href);
  return true;
}
