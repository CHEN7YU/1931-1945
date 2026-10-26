import test from 'node:test';
import assert from 'node:assert/strict';
import { createCombatEvents } from '../src/combat-events.js';
import { createCombatFeedback } from '../src/combat-feedback.js';

const source = (credit = 'player', soldierId = 's1', weaponId = 'rifle-1') =>
  ({ credit, team: credit === 'enemy' ? 'enemy' : 'friendly', unitId: 'alpha', soldierId, weaponId });
const victim = (team = 'enemy', id = 'e1', kind = 'soldier') => ({ kind, id, team, unitId: 'bravo' });
const viewer = { active: true, soldierId: 's1', weaponId: 'rifle-1' };
const damage = (overrides = {}) => createCombatEvents().publish('damage',
  { source: source(), target: victim(), amount: 50, health: 50, ...overrides }, 1);
const casualty = (overrides = {}, time = 1) => createCombatEvents().publish('casualty',
  { source: source(), target: victim(), health: 0, ...overrides }, time);

test('only actual hostile damage from the current soldier and weapon lights the hit marker', () => {
  const feedback = createCombatFeedback();
  feedback.consume(damage(), viewer, 1);
  assert.equal(feedback.snapshot(1).markerVisible, true);
  assert.equal(feedback.markerUntil, 1.2);
  assert.equal(feedback.flash, 0);
  assert.deepEqual(feedback.snapshot(1).markerSource, { soldierId: 's1', weaponId: 'rifle-1' });
  feedback.resetPersonal();
  for (const event of [damage({ source: source('ally', 's2') }), damage({ source: source('player', 'old-member') }),
    damage({ source: source('player', 's1', 'old-weapon') }), damage({ target: victim('friendly') })]) feedback.consume(event, viewer, 1);
  assert.equal(feedback.snapshot(1).markerVisible, false);
  feedback.consume(damage({ health: 0 }), viewer, 1);
  assert.equal(feedback.markerUntil, 1.25);
  assert.equal(feedback.snapshot(1.3).markerVisible, false);
});
test('ally kills and old-member delayed kills preserve feed credit without claiming a new-gun hit', () => {
  const feedback = createCombatFeedback();
  feedback.consume(casualty({ source: source('ally', 's2') }), viewer, 1);
  assert.equal(feedback.snapshot(1).markerVisible, false);
  assert.match(feedback.entries(1)[0].text, /^友军/);
  feedback.consume(casualty({ source: source('player', 'old-member', 'unit-mortar') }), viewer, 1);
  assert.match(feedback.entries(1)[0].text, /^你/);
  assert.equal(feedback.entries(1)[0].sourceId, 'old-member');
  assert.equal(feedback.snapshot(1).markerVisible, false);
  feedback.consume(damage({ source: source('player', 'old-member', 'unit-mortar') }), viewer, 1);
  assert.equal(feedback.snapshot(1).markerVisible, false);
});
test('damage flash belongs to the observer at the hit, pauses with simulation and resets on takeover', () => {
  const feedback = createCombatFeedback();
  const event = damage({ source: source('enemy', 'e2', 'enemy-rifle'), target: victim('friendly', 's1'), observerId: 's1' });
  feedback.consume(event, viewer, 1);
  assert.equal(feedback.flash, .65);
  feedback.update(0);
  assert.equal(feedback.flash, .65);
  feedback.update(.1);
  assert.ok(Math.abs(feedback.flash - .585) < 1e-10);
  feedback.resetPersonal();
  feedback.consume(event, { ...viewer, soldierId: 's2' }, 1.1);
  assert.equal(feedback.flash, 0);
  feedback.consume(event, { ...viewer, active: false }, 1.1);
  assert.equal(feedback.flash, 0);
  feedback.consume(damage({ target: victim('friendly', 'tank', 'vehicle'), observerId: 's1' }), viewer, 1);
  assert.equal(feedback.flash, .5);
  feedback.clear();
  feedback.consume(event, viewer, 3);
  assert.equal(feedback.flash, 0, 'stale presentation cannot restart old damage feedback');
});
test('casualty feed remains bounded, expires on simulation time and is independent of personal reset', () => {
  const feedback = createCombatFeedback();
  for (let time = 1; time <= 6; time++) feedback.consume(casualty({ target: victim('enemy', `e${time}`) }, time), viewer, time);
  assert.deepEqual(feedback.entries(6).map(entry => entry.targetId), ['e6', 'e5', 'e4', 'e3']);
  feedback.resetPersonal();
  assert.equal(feedback.entries(6).length, 4);
  const snapshot = feedback.snapshot(6);
  snapshot.feed[0].text = 'changed';
  assert.notEqual(feedback.entries(6)[0].text, 'changed');
  assert.deepEqual(feedback.entries(12), []);
  feedback.clear();
  assert.deepEqual(feedback.snapshot(12), { flash: 0, markerUntil: 0, markerVisible: false, markerSource: null, feed: [] });
});
test('environment casualties have honest credit and presentation never owns health or score', () => {
  const feedback = createCombatFeedback(), simulation = { health: 0, kills: 1 };
  const before = { ...simulation };
  const event = casualty({ source: { credit: 'environment', cause: 'crash', vehicleId: 'aircraft-1' },
    target: { ...victim(), actor: simulation } });
  feedback.consume(event, null, 1);
  assert.match(feedback.entries(1)[0].text, /^事故/);
  feedback.clear();
  assert.deepEqual(simulation, before);
  assert.equal('actor' in event.target, false);
});
test('invalid clocks and viewer contexts fail explicitly', () => {
  const feedback = createCombatFeedback();
  assert.throws(() => feedback.update(-1), RangeError);
  assert.throws(() => feedback.entries(NaN), RangeError);
  assert.throws(() => feedback.consume(damage(), viewer, 0), RangeError);
  assert.throws(() => feedback.consume(damage(), { active: 'yes' }, 1), RangeError);
  assert.throws(() => feedback.consume(damage(), { active: true }, 1), /controlled soldier/);
  assert.throws(() => feedback.consume({ type: 'shot' }, viewer, 1), RangeError);
});
