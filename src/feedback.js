export function createFeedback({ build, getState, getMap }) {
  const dialog = document.getElementById('feedback-dialog'), form = document.getElementById('feedback-form');
  const status = document.getElementById('feedback-status'), submit = document.getElementById('feedback-submit');
  const fields = document.getElementById('feedback-fields'), content = document.getElementById('feedback-content');
  const retry = document.getElementById('feedback-retry');
  let pending = false, id = crypto.randomUUID(), context;
  let availabilityRevision = 0;
  let availabilityMessage = null;
  const captureContext = () => ({ build, map: getMap(), state: getState(),
    browser: navigator.userAgent.slice(0, 300), viewport: `${innerWidth}x${innerHeight}` });
  form.addEventListener('input', () => {
    id = crypto.randomUUID(); context = captureContext();
    if (availabilityMessage !== null) { status.textContent = availabilityMessage; return; }
    status.textContent = ''; delete status.dataset.kind;
  });
  content.addEventListener('input', () => {
    document.getElementById('feedback-count').textContent = `${content.value.length} / 2000`;
  });
  async function checkAvailability() {
    if (pending || !dialog.open) return;
    const revision = ++availabilityRevision;
    submit.disabled = true; retry.hidden = true;
    availabilityMessage = '正在检查反馈服务…';
    status.textContent = availabilityMessage; delete status.dataset.kind;
    try {
      const response = await fetch('/api/feedback/status', { signal: AbortSignal.timeout(5000) });
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('反馈接口未连接');
      const result = await response.json();
      if (result.available !== true) throw new Error('反馈服务尚未配置完成');
      if (revision !== availabilityRevision || !dialog.open) return;
      availabilityMessage = null;
      submit.disabled = pending; status.textContent = '反馈将私下保存，不公开展示。';
    } catch (error) {
      console.warn('Feedback availability check failed', error);
      if (revision !== availabilityRevision || !dialog.open) return;
      availabilityMessage = '在线反馈服务当前不可用，暂时无法提交。填写内容已保留，可点击“重新连接”重试，或复制草稿发给开发者。';
      status.textContent = availabilityMessage;
      status.dataset.kind = 'error';
      retry.hidden = false;
    }
  }
  for (const button of document.querySelectorAll('[data-feedback-open]')) button.addEventListener('click', () => {
    context ??= captureContext();
    dialog.showModal();
    void checkAvailability();
  });
  retry.addEventListener('click', () => { void checkAvailability(); });
  document.getElementById('feedback-close').addEventListener('click', () => { availabilityRevision++; dialog.close(); });
  document.getElementById('feedback-copy').addEventListener('click', async () => {
    const text = `${form.elements.category.selectedOptions[0].textContent}\n${content.value}\n${build} / ${getMap()}`;
    try { await navigator.clipboard.writeText(text); status.textContent = '已复制反馈草稿，可直接发给开发者；未提交到服务器。'; }
    catch (error) {
      console.warn('Feedback draft copy failed', error);
      content.focus(); content.select(); status.textContent = '复制不可用，已选中草稿，请手动复制。';
    }
  });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || submit.disabled || !form.reportValidity()) return;
    if (content.value.trim().length < 5) { status.textContent = '请至少填写5个非空白字符。'; content.focus(); return; }
    pending = true; fields.disabled = submit.disabled = true;
    document.getElementById('feedback-close').disabled = true;
    form.setAttribute('aria-busy', 'true'); status.textContent = '正在保存反馈…';
    const payload = { id, category: form.elements.category.value, content: content.value,
      contact: form.elements.contact.value, website: form.elements.website.value, context: context ??= captureContext() };
    try {
      const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
      if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('反馈接口未连接，内容尚未保存。');
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '提交失败，请稍后重试。');
      if (result.saved !== true || result.id !== id) throw new Error('未收到有效保存回执，请保留内容并重试。');
      form.reset(); id = crypto.randomUUID(); context = undefined;
      document.getElementById('feedback-count').textContent = '0 / 2000';
      status.textContent = `反馈已保存，谢谢！回执编号：${result.id}`; status.dataset.kind = 'success';
    } catch (error) {
      console.error('Feedback submission failed', error);
      status.dataset.kind = 'error';
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError'
        ? '网络中断或超时，保存状态未确认。草稿已保留，相同内容重试不会重复保存。' : error.message;
    } finally {
      pending = false; fields.disabled = submit.disabled = false;
      document.getElementById('feedback-close').disabled = false; form.removeAttribute('aria-busy');
    }
  });
  return { get open() { return dialog.open; } };
}
