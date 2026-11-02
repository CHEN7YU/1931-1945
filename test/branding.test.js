import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREFERENCES_KEY } from '../src/player-preferences.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
test('the game exposes 山河 as its main title and 1931-1945 as its separate subtitle', () => {
  const html = read('../index.html');
  assert.match(html, /<title>山河 · 1931-1945<\/title>/);
  assert.match(html, /<h1 id="game-title">山河<\/h1>/);
  assert.match(html, /<p class="game-subtitle"[^>]*>1931-1945<\/p>/);
  assert.match(html, /<span>山河<small>1931-1945<\/small><\/span>/);
  assert.doesNotMatch(html, /烽火|EMBERS OF CHINA/);
});

test('preview labels follow the game name without migrating saved settings or deployment identity', () => {
  for (const path of ['../town-preview.html', '../nanjing-preview.html', '../asset-lab.html']) {
    const html = read(path);
    assert.match(html, /<title>山河 · 1931-1945 · /);
    assert.doesNotMatch(html, /烽火山河|EMBERS OF CHINA/);
  }
  assert.doesNotMatch(read('../uniform-study/index.html'), /烽火山河/);
  assert.equal(PREFERENCES_KEY, 'embers-of-china.preferences.v1');
  assert.match(read('../wrangler.toml'), /^name = "1931-1945"/m);
});
