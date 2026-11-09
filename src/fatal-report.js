const failureCopy = {
  loading: {
    title: '战场未能加载',
    advice: '请保留诊断信息后重新加载；若反复出现，请检查浏览器硬件加速和资源加载情况。',
  },
  runtime: {
    title: '作战意外中断',
    advice: '当前战局已停止，无法安全继续。请先复制诊断信息，再重新加载。',
  },
  webgl: {
    title: '显卡连接已中断',
    advice: '图形上下文已丢失，当前战局无法继续。请保留诊断信息，关闭占用显存的其他页面后重新加载。',
  },
};

export function makeFatalReport({ kind, error, stage, build, context, occurredAt = new Date().toISOString() }) {
  if (!failureCopy[kind]) throw new RangeError(`Unknown failure kind: ${kind}`);
  const resource = error?.target?.currentSrc || error?.target?.src;
  const resourcePath = typeof resource === 'string' && URL.canParse(resource, 'http://local.invalid')
    ? new URL(resource, 'http://local.invalid').pathname : null;
  const message = error instanceof Error ? error.message
    : resourcePath ? `资源加载失败（${error.type}）：${resourcePath}` : String(error ?? '未知错误');
  const details = {
    kind, stage, occurredAt, build, context,
    error: { name: error instanceof Error ? error.name : resourcePath ? 'ResourceError' : 'Error', message,
      stack: error instanceof Error ? error.stack : null },
  };
  return { ...failureCopy[kind], message, text: JSON.stringify(details, null, 2) };
}

export function createFatalReporter({ document, window, build, getContext, onFatal, onRecorded = () => {} }) {
  const element = id => document.getElementById(id);
  let ready = false, report = null;
  const recovered = [];
  function show(error, { kind = ready ? 'runtime' : 'loading', stage = ready ? 'battle' : 'initialization' } = {}) {
    if (report) return report;
    report = makeFatalReport({ kind, error, stage, build, context: getContext() });
    element('fatal-title').textContent = report.title;
    element('fatal-message').textContent = `${report.message}。${report.advice}`;
    element('fatal-details').value = report.text;
    element('fatal-copy-status').textContent = '匿名错误摘要会尝试后台登记；完整诊断保留在本页，可复制后发给开发者。';
    element('loading').hidden = true;
    element('fatal').hidden = false;
    onFatal();
    onRecorded(error, { recovered: false, stage: ready ? 'battle' : 'initialization', position: getContext()?.position ?? null });
    return report;
  }
  window.addEventListener('error', event => show(event.error ?? event.message));
  window.addEventListener('unhandledrejection', event => show(event.reason, {
    stage: ready ? 'unhandled-promise' : 'initialization-promise',
  }));
  element('world').addEventListener('webglcontextlost', event => {
    event.preventDefault();
    show(new Error('WebGL context lost'), { kind: 'webgl', stage: ready ? 'battle-rendering' : 'renderer-initialization' });
  });
  element('fatal-copy').addEventListener('click', async () => {
    if (!report) return;
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('浏览器不支持剪贴板写入');
      await window.navigator.clipboard.writeText(report.text);
      element('fatal-copy-status').textContent = '完整诊断已复制，未自动发送；匿名错误摘要会单独尝试后台登记。';
    } catch (error) {
      const details = element('fatal-details');
      details.focus(); details.select();
      element('fatal-copy-status').textContent = `自动复制失败：${error.message}。已选中诊断信息，请按 Ctrl+C 手动复制。`;
    }
  });
  return {
    show, ready() { ready = true; }, get failed() { return Boolean(report); },
    recordRecovery(error, context) {
      if (!(error instanceof Error)) throw new TypeError('Recovered failure requires an Error');
      const key = `${error.name}:${error.message}:${context.stage}:${context.team ?? ''}:${context.details?.side ?? ''}`;
      const now = Date.now(), existing = recovered.find(entry => entry.key === key);
      if (existing) {
        existing.count++; existing.occurredAt = new Date(now).toISOString(); existing.context = context;
        if (now - existing.loggedAt >= 30000) {
          console.warn('Recovered character pose error; battle continues', error, context);
          existing.loggedAt = now;
        }
      } else {
        if (recovered.length >= 32) recovered.shift();
        recovered.push({ key, count: 1, loggedAt: now, occurredAt: new Date(now).toISOString(), build,
          context, error: { name: error.name, message: error.message, stack: error.stack } });
        console.warn('Recovered character pose error; battle continues', error, context);
      }
    },
    get recoveries() { return recovered.map(({ loggedAt, ...entry }) => structuredClone(entry)); },
  };
}
