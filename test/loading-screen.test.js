import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import metadata from '../public/assets/loading/source.json' with { type: 'json' };
import { createPhotoWall, LOADING_PHOTOS, PHOTO_WALL_SPEED } from '../src/loading-screen.js';

function fixture({ hidden = false, reduced = false } = {}) {
  class Node extends EventTarget {
    hidden = false;
    textContent = '';
    children = [];
    attributes = new Map();
    classes = new Set();
    classList = { add: name => this.classes.add(name) };
    style = { setProperty: (name, value) => { this.style[name] = value; } };
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getBoundingClientRect() { return { width: 600, height: 300 }; }
    querySelectorAll(selector) {
      return this.children.flatMap(node => [
        ...(selector === 'img' && node.tag === 'img' ? [node] : []), ...node.querySelectorAll(selector),
      ]);
    }
  }
  const element = new Node(), root = new Node(), doc = new Node(), motion = new Node();
  const track = new Node(), status = new Node(), toggle = new Node();
  root.hidden = hidden; motion.matches = reduced;
  doc.createElement = tag => { const node = new Node(); node.tag = tag; return node; };
  element.querySelector = selector => ({ '[data-photo-wall-track]': track,
    '[data-photo-wall-status]': status, '[data-photo-wall-toggle]': toggle })[selector];
  let observed, callback;
  class Observer {
    constructor(cb) { callback = cb; }
    observe(target) { observed = target; }
    disconnect() { callback = null; }
  }
  class Resize { observe() {} disconnect() {} }
  const control = createPhotoWall(element, { document: doc, Observer, Resize, visibilityElement: root, reducedMotion: motion });
  return { element, root, doc, track, status, toggle, control, motion,
    get observed() { return observed; },
    visibility(value) { root.hidden = value; callback(); } };
}

test('all twenty-three supplied images retain exact PNG bytes, dimensions and unverified-rights provenance', () => {
  assert.equal(LOADING_PHOTOS.length, 23);
  assert.equal(metadata.permission.isCC0, false);
  assert.equal(metadata.permission.redistributionRightsIndependentlyVerified, false);
  for (const file of metadata.files) {
    const bytes = readFileSync(new URL(`../public/assets/loading/${file.file}`, import.meta.url));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(bytes.readUInt32BE(16), file.width);
    assert.equal(bytes.readUInt32BE(20), file.height);
  }
});

test('the wall has two identical collections for seamless horizontal scrolling, without slide timers', () => {
  const f = fixture();
  assert.equal(f.track.children.length, 2);
  const [first, duplicate] = f.track.children;
  assert.equal(first.children.length, 23);
  assert.equal(duplicate.attributes.get('aria-hidden'), 'true');
  assert.deepEqual(first.querySelectorAll('img').map(image => image.src), LOADING_PHOTOS.map(photo => photo.src));
  assert.deepEqual(duplicate.querySelectorAll('img').map(image => image.src), first.querySelectorAll('img').map(image => image.src));
  assert.equal(f.track.style['--photo-wall-duration'], `${600 / PHOTO_WALL_SPEED}s`);
  assert.equal(f.track.style.animationPlayState, 'running');
  f.control.dispose(); assert.equal(f.track.style.animationPlayState, 'paused');
});

test('hidden loading/menu screens and background tabs pause the wall without resetting its position', () => {
  const f = fixture({ hidden: true });
  assert.equal(f.observed, f.root);
  assert.equal(f.track.style.animationPlayState, 'paused');
  f.visibility(false); assert.equal(f.track.style.animationPlayState, 'running');
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.track.style.animationPlayState, 'paused');
  f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.track.style.animationPlayState, 'running');
  f.control.dispose();
});

test('users can pause/resume scrolling and reduced-motion starts with the wall stopped', () => {
  const f = fixture({ reduced: true });
  assert.equal(f.toggle.textContent, '继续滚动');
  assert.equal(f.track.style.animationPlayState, 'paused');
  f.toggle.dispatchEvent(new Event('click'));
  assert.equal(f.toggle.textContent, '暂停滚动');
  assert.equal(f.toggle.attributes.get('aria-pressed'), 'false');
  assert.equal(f.track.style.animationPlayState, 'running');
  f.toggle.dispatchEvent(new Event('click'));
  assert.equal(f.track.style.animationPlayState, 'paused');
  f.control.dispose();
});

test('failed photos are reported once, visibly marked, and do not stop the other photographs', t => {
  const report = t.mock.method(console, 'error', () => {});
  const f = fixture();
  f.track.children[0].children[0].children[0].onerror();
  f.track.children[1].children[0].children[0].onerror();
  assert.equal(report.mock.callCount(), 1);
  assert.match(f.status.textContent, /未能加载/);
  assert.equal(f.track.children[0].children[0].classes.has('unavailable'), true);
  assert.equal(f.track.children[0].children[0].children[1].textContent, '影像暂不可用');
  assert.equal(f.track.style.animationPlayState, 'running');
  f.control.dispose();
  assert.ok(f.track.querySelectorAll('img').every(image => image.onerror === null));
});

test('loading branding, real stage hooks and a proportional horizontal wall replace the China map and slideshow', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/loading-screen.css', import.meta.url), 'utf8');
  assert.match(html, /class="loading-years">1931-1945<\/span><strong>山河<\/strong>/);
  assert.match(html, /id="loading-message" role="status">正在构建战场/);
  assert.match(html, /id="menu-photo-wall"/);
  assert.doesNotMatch(html, /class="china-theater"|率领小队，即刻出击|原创战役位置示意|data-loading-photo-counter/);
  assert.match(css, /object-fit:\s*contain/);
  assert.match(css, /width:\s*auto; height:\s*min\(44vh, 420px\)/);
  assert.match(css, /from \{ transform: translateX\(0\); \}/);
  assert.match(css, /to \{ transform: translateX\(-50%\); \}/);
});
