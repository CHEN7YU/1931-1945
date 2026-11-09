import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('ordinary menu and pause screen do not ask players to select memory-resource tiers or repeat role rosters', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.equal(html.includes('data-resource-mode'), false);
  assert.equal(html.includes('data-resource-status'), false);
  assert.equal(html.includes('战役阶段'), false);
  assert.match(html, /id="campaign-choice" aria-label="选择战役"/);
  for (const text of ['11人班 · 1号迫击炮手', '我方4班44人 · 累计400人', '坚守仓库4分钟，阻止一楼失守'])
    assert.equal(main.includes(text), false);
  assert.match(main, /element\.hidden = !preferences\.status\.problem/);
});
