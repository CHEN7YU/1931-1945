import test from 'node:test';
import assert from 'node:assert/strict';
import { finishStartupWork, runStartupWork, yieldStartupTask } from '../src/startup-work.js';

test('startup work preserves the synchronous result and every completed operation', async () => {
  const steps = [];
  function* work() {
    for (let index = 0; index < 20; index++) {
      steps.push(index);
      yield { completed: index + 1, total: 20 };
    }
    return 42;
  }
  assert.equal(finishStartupWork(work()), 42);
  const expected = [...steps], progress = [];
  steps.length = 0;
  let time = 0, yields = 0;
  assert.equal(await runStartupWork(work(), {
    budgetMs: 8, now: () => time += 3, yieldTask: async () => { yields++; },
    onProgress: item => progress.push(item.completed),
  }), 42);
  assert.deepEqual(steps, expected);
  assert.deepEqual(progress, Array.from({ length: 20 }, (_, index) => index + 1));
  assert.ok(yields > 3, 'initialization must yield repeatedly rather than defer one giant task');
});

test('startup work propagates failures and rejects invalid time budgets', async () => {
  function* broken() { yield; throw new Error('pose failed'); }
  await assert.rejects(runStartupWork(broken()), /pose failed/);
  await assert.rejects(runStartupWork(broken(), { budgetMs: 0 }), /positive time budget/);
});

test('fallback yields a real task and does not depend on animation frames', async () => {
  let taskRan = false;
  setTimeout(() => { taskRan = true; }, 0);
  await yieldStartupTask();
  assert.equal(taskRan, true);
});
