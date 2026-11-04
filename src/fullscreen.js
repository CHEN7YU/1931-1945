export function createFullscreenControls(doc = document) {
  const buttons = [...doc.querySelectorAll('[data-fullscreen-toggle]')];
  const status = doc.getElementById('fullscreen-status'), root = doc.documentElement;
  if (!buttons.length || !status) throw new Error('Fullscreen controls require their buttons and status element');
  const supported = doc.fullscreenEnabled !== false &&
    typeof root.requestFullscreen === 'function' && typeof doc.exitFullscreen === 'function';
  let pending = false;
  const sync = () => {
    const active = Boolean(doc.fullscreenElement);
    for (const button of buttons) {
      button.textContent = supported ? active ? '退出全屏' : '全屏' : '全屏不可用';
      button.disabled = pending || !supported;
      button.setAttribute('aria-pressed', String(active));
      button.title = supported ? active ? '退出全屏，也可按Esc' : '将游戏切换为全屏'
        : '当前浏览器不支持网页全屏，可尝试按F11';
    }
  };
  const toggle = async () => {
    if (pending || !supported) return;
    pending = true; status.hidden = true; status.textContent = ''; sync();
    const entering = !doc.fullscreenElement;
    try {
      if (entering) await root.requestFullscreen();
      else await doc.exitFullscreen();
    } catch (error) {
      status.textContent = entering ? '无法进入全屏，请允许浏览器全屏或按F11。' : '无法退出全屏，可按Esc返回。';
      status.hidden = false;
      console.error('Fullscreen change failed', error);
    } finally { pending = false; sync(); }
  };
  for (const button of buttons) button.addEventListener('click', toggle);
  doc.addEventListener('fullscreenchange', sync);
  sync();
  return {
    dispose() {
      for (const button of buttons) button.removeEventListener('click', toggle);
      doc.removeEventListener('fullscreenchange', sync);
    },
  };
}
