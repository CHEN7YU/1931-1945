import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionBriefing, MISSION_BRIEFING_SECONDS } from '../src/mission-briefing.js';
import { SELECTABLE_CAMPAIGNS, campaignById } from '../src/campaigns.js';

function fixture() {
  const title = { textContent: '' }, goals = { children: [], replaceChildren(...items) { this.children = items; } };
  const dismiss = new EventTarget();
  const element = { hidden: false, ownerDocument: { createElement: () => ({ textContent: '' }) },
    querySelector: name => ({ '[data-mission-title]': title, '[data-mission-goals]': goals,
      '[data-mission-dismiss]': dismiss })[name] };
  return { element, title, goals, dismiss, control: createMissionBriefing(element) };
}

test('selectable battle backgrounds have sources and remain separate from the playable objectives', () => {
  for (const campaign of SELECTABLE_CAMPAIGNS.filter(campaign => !campaign.locked)) {
    assert.ok(campaign.history.length > 30 && campaign.history.length < 150);
    assert.equal(new URL(campaign.historySource.url).protocol, 'https:');
    assert.doesNotMatch(campaign.history, /A\/B\/C|20秒|玩家|上新河/);
    assert.equal(campaign.goals.length, 3);
    assert.ok(Object.isFrozen(campaign.goals));
  }
  assert.match(campaignById('taierzhuang-fort').history, /徐州会战/);
  assert.match(campaignById('nanjing').history, /12月13日/);
});

test('the opening briefing follows active battle time, supports dismissal and resets for another campaign', () => {
  const f = fixture(), campaign = campaignById('taierzhuang-fort');
  assert.equal(f.element.hidden, true);
  f.control.show(campaign, 0);
  assert.equal(f.title.textContent, campaign.name);
  assert.deepEqual(f.goals.children.map(item => item.textContent), [...campaign.goals]);
  for (let frame = 0; frame < 100; frame++) f.control.update(3);
  assert.equal(f.element.hidden, false, 'paused simulation time does not consume the briefing');
  f.control.update(MISSION_BRIEFING_SECONDS - .01); assert.equal(f.element.hidden, false);
  f.control.update(MISSION_BRIEFING_SECONDS); assert.equal(f.element.hidden, true);
  f.control.show(campaignById('nanjing'), 0);
  assert.match(f.goals.children[0].textContent, /中华门/);
  f.dismiss.dispatchEvent(new Event('click')); assert.equal(f.element.hidden, true);
  assert.throws(() => f.control.show({ name: 'Incomplete' }, 0), /objectives/);
  assert.throws(() => f.control.update(NaN), RangeError);
  f.control.dispose();
});
