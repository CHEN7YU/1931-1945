export function yieldStartupTask() {
  // Boosted scheduler.yield continuations can starve startup timers and uploads.
  if (typeof globalThis.scheduler?.postTask === 'function')
    return globalThis.scheduler.postTask(() => {}, { priority: 'background' });
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function finishStartupWork(work) {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

export async function runStartupWork(work, { budgetMs = 8, now = () => performance.now(),
  yieldTask = yieldStartupTask, onProgress = () => {} } = {}) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new RangeError('Startup work requires a positive time budget');
  await yieldTask();
  let deadline = now() + budgetMs;
  for (;;) {
    const step = work.next();
    if (step.done) return step.value;
    if (step.value !== undefined) onProgress(step.value);
    if (now() >= deadline) {
      await yieldTask();
      deadline = now() + budgetMs;
    }
  }
}
