import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreenControls } from '../src/fullscreen.js';

function fixture() {
  const doc = new EventTarget(), status = { hidden: true, textContent: '' };
  const buttons = Array.from({ length: 2 }, () => Object.assign(new EventTarget(), {
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
  }));
  let enters = 0, exits = 0;
  doc.fullscreenEnabled = true; doc.fullscreenElement = null;
  doc.querySelectorAll = () => buttons; doc.getElementById = () => status;
  doc.documentElement = { async requestFullscreen() {
    enters++; doc.fullscreenElement = doc.documentElement; doc.dispatchEvent(new Event('fullscreenchange'));
  } };
  doc.exitFullscreen = async () => { exits++; doc.fullscreenElement = null; doc.dispatchEvent(new Event('fullscreenchange')); };
  return { doc, status, buttons, get enters() { return enters; }, get exits() { return exits; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('menu and pause buttons toggle the document together and reflect browser-initiated exits', async () => {
  const f = fixture(), controls = createFullscreenControls(f.doc);
  assert.equal(f.enters, 0, 'fullscreen is never entered without a click');
  f.buttons[0].dispatchEvent(new Event('click'));
  f.buttons[1].dispatchEvent(new Event('click'));
  await settle();
  assert.equal(f.enters, 1, 'a pending request cannot be duplicated by the other button');
  assert.ok(f.buttons.every(button => button.textContent === '退出全屏' && button.attributes['aria-pressed'] === 'true'));
  f.buttons[1].dispatchEvent(new Event('click')); await settle();
  assert.equal(f.exits, 1);
  assert.ok(f.buttons.every(button => button.textContent === '全屏'));
  f.buttons[0].dispatchEvent(new Event('click')); await settle();
  f.doc.fullscreenElement = null; f.doc.dispatchEvent(new Event('fullscreenchange'));
  assert.ok(f.buttons.every(button => button.attributes['aria-pressed'] === 'false'));
  controls.dispose();
  f.buttons[0].dispatchEvent(new Event('click')); await settle();
  assert.equal(f.enters, 2);
});

test('unsupported fullscreen is explicit and rejected requests leave the game usable without automatic retries', async t => {
  const unsupported = fixture(); unsupported.doc.fullscreenEnabled = false;
  const disabled = createFullscreenControls(unsupported.doc);
  assert.ok(unsupported.buttons.every(button => button.disabled && button.textContent === '全屏不可用' && button.title.includes('F11')));
  disabled.dispose();
  const f = fixture(); let attempts = 0;
  f.doc.documentElement.requestFullscreen = async () => { attempts++; throw new Error('Permission denied'); };
  const logged = t.mock.method(console, 'error', () => {});
  const controls = createFullscreenControls(f.doc);
  f.buttons[0].dispatchEvent(new Event('click')); await settle();
  assert.equal(attempts, 1);
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(f.status.hidden, false); assert.match(f.status.textContent, /无法进入全屏/);
  assert.ok(f.buttons.every(button => !button.disabled && button.attributes['aria-pressed'] === 'false'));
  controls.dispose();
});
