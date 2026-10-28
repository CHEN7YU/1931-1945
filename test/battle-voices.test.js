import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { battleVoiceClips, BATTLE_VOICE_PROFILES } from '../src/battle-voice-lines.js';
import { createBattleVoices, battleVoiceCue, battleVoiceMix, soldierVoiceVariant, createObjectiveVoiceTracker,
  battleClockDirection, findBattleCallout } from '../src/battle-voices.js';
import { voiceSSML, VOICE_FORMAT } from '../scripts/prepare-battle-voices.mjs';
import { advanceCapture, makeObjectives } from '../src/core.js';

const listener = { position: { x: 0, y: 1.7, z: 0 }, right: { x: 1, y: 0, z: 0 }, soldierId: 'player' };
const actor = (id = 'friendly-1', team = 'friendly', x = 5) => ({ id, team, health: 100, vehicleId: null,
  groundType: 'infantry', position: { x, y: 0, z: 0 }, locomotion: { speed: 2 }, rifle: { action: 'idle' },
  tactics: { mode: 'advance', suppressedUntil: 0, lastSeen: null } });
const buffers = () => Object.fromEntries(battleVoiceClips().map(clip => [clip.file, { duration: 2, numberOfChannels: 1 }]));
function fakeContext() {
  const sources = [], nodes = [];
  const param = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => {
    const result = { gain: param(), frequency: param(), pan: param(), disconnected: false,
      connect(next) { return next; }, disconnect() { this.disconnected = true; } };
    nodes.push(result); return result;
  };
  return { sources, nodes, state: 'running', currentTime: 0, destination: {},
    createGain: node, createStereoPanner: node, createBiquadFilter: node,
    createBufferSource() {
      const source = Object.assign(node(), { started: false, start() { this.started = true; },
        stop() { this.stopped = true; this.onended?.(); } });
      sources.push(source); return source;
    } };
}
const setup = () => {
  const context = fakeContext(), audio = createBattleVoices(buffers(), () => 0);
  audio.sync(true); return { context, audio };
};
const finish = context => context.sources.filter(source => !source.stopped).forEach(source => source.onended?.());
function sightedThreat(role = 'sniper', clock = 3, time = 2) {
  const player = actor('player'), observer = actor('observer'), target = actor('target', 'enemy');
  player.position = { x: 0, y: 0, z: 0 };
  observer.position = { x: -3, y: 0, z: 1 }; observer.heading = Math.PI;
  const angle = clock * Math.PI / 6;
  target.position = { x: Math.sin(angle) * 30, y: 0, z: -Math.cos(angle) * 30 };
  target.role = role; target.targetKind = 'person';
  if (role === 'tank') { target.vehicleId = 'tank-1'; target.targetKind = 'closed-armor'; target.role = 'gunner'; }
  observer.tactics = { ...observer.tactics, threatSense: 'vision', threatId: target.id,
    lastSightCheck: { time, targetId: target.id, visible: true } };
  return { player, observer, target, actors: [player, observer, target] };
}

test('264 original clips use three distinct stock male voices per side, with reproducible SSML', () => {
  const clips = battleVoiceClips();
  assert.equal(clips.length, 264);
  assert.equal(new Set(clips.map(clip => clip.file)).size, 264);
  for (const team of ['friendly', 'enemy']) {
    assert.equal(new Set(BATTLE_VOICE_PROFILES[team].map(profile => profile.voice)).size, 3);
    assert.equal(clips.filter(clip => clip.team === team).length, team === 'friendly' ? 186 : 78);
  }
  assert.equal(VOICE_FORMAT, 'audio-24khz-48kbitrate-mono-mp3');
  assert.match(voiceSSML(clips[0]), /style="angry"/);
  assert.match(voiceSSML(clips[0]), /volume="loud"/);
  assert.doesNotMatch(voiceSSML(clips.find(clip => clip.team === 'enemy')), /express-as/);
  assert.match(voiceSSML({ ...clips[0], text: '<&"' }), /&lt;&amp;&quot;/);
  assert.equal(soldierVoiceVariant('soldier-42'), soldierVoiceVariant('soldier-42'));
  assert.equal(new Set(Array.from({ length: 20 }, (_, i) => soldierVoiceVariant(`soldier-${i}`))).size, 3);
  assert.throws(() => soldierVoiceVariant(''), /identity/);
});

test('all generated MP3s have exact source evidence and cannot be accidentally relabelled CC0', async () => {
  const base = new URL('../public/assets/audio/battle-voices/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', base), 'utf8'));
  assert.equal(manifest.license, 'Azure-generated-speech');
  assert.match(manifest.provenance, /Not historical/);
  assert.equal(manifest.files.length, 264);
  for (const clip of battleVoiceClips()) {
    const record = manifest.files.find(file => file.file === clip.file);
    const bytes = await readFile(new URL(clip.file, base));
    assert.equal(record.gender, 'Male');
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(createHash('sha256').update(`${VOICE_FORMAT}\n${voiceSSML(clip)}`).digest('hex'), record.synthesisHash);
    assert.ok(bytes.length > 500);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /Bearer|\/subscriptions\/|accessToken|api[_-]?key/i);
});

test('situational cues use actual live infantry state, prioritizing grenade evasion over reload and contact', () => {
  const soldier = actor();
  assert.equal(battleVoiceCue(soldier, 5), 'advance');
  soldier.locomotion.speed = 0;
  assert.equal(battleVoiceCue(soldier, 5), null);
  soldier.tactics.lastSeen = { x: 0, y: 0, z: 0 }; soldier.tactics.forgetAt = 6;
  assert.equal(battleVoiceCue(soldier, 5), 'contact');
  assert.equal(battleVoiceCue(soldier, 7), null);
  soldier.tactics.suppressedUntil = 8;
  assert.equal(battleVoiceCue(soldier, 5), 'cover');
  soldier.rifle.action = 'reload';
  assert.equal(battleVoiceCue(soldier, 5), 'reload');
  soldier.tactics.mode = 'evade-grenade';
  assert.equal(battleVoiceCue(soldier, 5), 'grenade');
  for (const change of [{ health: 0 }, { vehicleId: 'tank' }, { groundType: 'mortar' }]) {
    assert.equal(battleVoiceCue({ ...soldier, ...change }, 5), null);
  }
});

test('battle voice mix follows listener orientation, fades out by 55 metres, and rejects invalid points', () => {
  const near = battleVoiceMix({ x: 2, y: 0, z: 0 }, listener), far = battleVoiceMix({ x: 45, y: 0, z: 0 }, listener);
  assert.ok(near.gain > far.gain && near.pan > 0);
  assert.ok(battleVoiceMix({ x: -2, y: 0, z: 0 }, listener).pan < 0);
  assert.equal(battleVoiceMix({ x: 55, y: 0, z: 0 }, listener).gain, 0);
  assert.throws(() => battleVoiceMix({ x: NaN, y: 0, z: 0 }, listener), /Invalid/);
});

test('ambient playback excludes the player, dead, distant and seated soldiers; teams and soldiers have bounded cooldowns', () => {
  const { audio, context } = setup();
  const actors = [actor('player'), { ...actor('dead'), health: 0 }, actor('far', 'enemy', 80),
    { ...actor('crew'), vehicleId: 'tank' }, actor('friendly'), actor('enemy', 'enemy', -10)];
  audio.update(context, actors, listener, 2);
  assert.equal(audio.snapshot.counts.ambient, 1);
  assert.equal(audio.snapshot.history[0].soldierId, 'friendly');
  finish(context);
  audio.update(context, actors, listener, 3);
  assert.equal(audio.snapshot.counts.ambient, 1);
  audio.update(context, actors, listener, 8);
  assert.equal(audio.snapshot.history.at(-1).team, 'enemy');
  finish(context);
  audio.update(context, actors, listener, 14);
  assert.equal(audio.snapshot.counts.ambient, 2, 'per-soldier cooldown is not bypassed by team eligibility');
  audio.update(context, actors, listener, 31);
  assert.equal(audio.snapshot.counts.ambient, 3);
  assert.equal(audio.snapshot.history.at(-1).soldierId, 'friendly');
  assert.notEqual(audio.snapshot.history[0].file, audio.snapshot.history.at(-1).file, 'avoid immediate line repetition');
});

test('moving out of hearing range and dying stop an active ambient voice', () => {
  const { audio, context } = setup(), soldier = actor();
  audio.update(context, [soldier], listener, 2);
  soldier.position.x = 100;
  audio.update(context, [soldier], listener, 3);
  assert.equal(audio.snapshot.active, 0);
  assert.ok(context.sources[0].stopped);
  soldier.position.x = 5;
  audio.update(context, [soldier], listener, 32);
  soldier.health = 0;
  audio.update(context, [soldier], listener, 33);
  assert.equal(audio.snapshot.active, 0);
});

test('every successful X command starts immediately even during cooldown or repeated commands; strategic events retain FIFO order', () => {
  const { audio, context } = setup(), actors = [actor()];
  audio.update(context, actors, listener, 2);
  audio.event(context, 'order-advance', { command: true, soldierId: 'player', time: 2 });
  audio.event(context, 'order-hold', { command: true, soldierId: 'player', time: 2.1 });
  audio.event(context, 'order-follow', { command: true, soldierId: 'player', time: 2.2 });
  assert.equal(audio.snapshot.counts.command, 3);
  assert.equal(audio.snapshot.active, 1);
  assert.equal(audio.snapshot.queued, 0);
  assert.ok(context.sources.slice(0, -1).every(source => source.stopped));
  audio.event(context, 'captured', { eventKey: 'C:captured' });
  audio.event(context, 'victory', { eventKey: 'victory' });
  assert.equal(audio.snapshot.queued, 2);
  finish(context);
  audio.update(context, actors, listener, 3, false);
  assert.equal(audio.snapshot.history.at(-1).cue, 'captured');
  finish(context);
  audio.update(context, actors, listener, 3, false);
  assert.equal(audio.snapshot.history.at(-1).cue, 'victory');
  assert.equal(audio.snapshot.counts.ambient, 1, 'no end-screen ambient chatter');
});

test('pause stops all voices and preserves unfinished announcements; suspended audio waits without consuming events', () => {
  const { audio, context } = setup();
  audio.event(context, 'captured');
  audio.sync(false);
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.snapshot.queued, 1);
  audio.update(context, [actor()], listener, 20);
  assert.equal(audio.snapshot.counts.announcement, 1);
  audio.sync(true);
  context.state = 'suspended';
  audio.event(context, 'rally-lost');
  audio.update(context, [actor()], listener, 21);
  assert.equal(audio.snapshot.queued, 2);
  context.state = 'running';
  audio.update(context, [actor()], listener, 22);
  assert.equal(audio.snapshot.history.at(-1).cue, 'captured');
  finish(context);
  audio.update(context, [actor()], listener, 23);
  assert.equal(audio.snapshot.history.at(-1).cue, 'rally-lost');
  audio.reset();
  assert.equal(audio.snapshot.active, 0);
  assert.equal(audio.snapshot.queued, 0);
  assert.equal(audio.snapshot.history.length, 0);
  assert.ok(context.nodes.every(node => node.disconnected));
});

test('a command interrupts and preserves an announcement rather than overlapping or discarding it', () => {
  const { audio, context } = setup();
  audio.event(context, 'captured');
  audio.event(context, 'order-advance', { command: true });
  assert.equal(audio.snapshot.active, 1);
  assert.equal(audio.snapshot.queued, 1);
  assert.equal(audio.snapshot.history.at(-1).cue, 'order-advance');
  finish(context);
  audio.update(context, [], listener, 2, false);
  assert.equal(audio.snapshot.history.at(-1).cue, 'captured');
  assert.equal(audio.snapshot.active, 1);
});

test('objective events distinguish neutral setbacks, enemy captures, friendly losses and repeated recaptures', () => {
  const tracker = createObjectiveVoiceTracker(), objective = makeObjectives()[0];
  const step = (dt, friendly, hostile) => {
    const status = advanceCapture(objective, dt, friendly, hostile);
    return tracker.update(objective, status);
  };
  assert.deepEqual(step(1, false, false), []);
  assert.deepEqual(step(1, true, false), ['capturing']);
  assert.deepEqual(step(1, true, true), ['contested']);
  assert.deepEqual(step(1, true, true), []);
  assert.deepEqual(step(2, false, false), ['setback']);
  assert.deepEqual(step(12, false, true), [], 'enemy capture is never announced as friendly success');
  assert.equal(objective.owner, 'enemy');
  assert.deepEqual(step(12, true, false), []);
  assert.deepEqual(step(1, true, false), ['capturing']);
  assert.deepEqual(step(11, true, false), ['captured']);
  assert.deepEqual(step(1, true, true), ['contested'], 'owned points can be contested too');
  assert.deepEqual(step(6, false, true), [], 'partial neutralization is not yet a lost point');
  assert.equal(objective.owner, 'friendly');
  assert.deepEqual(step(6, false, true), ['lost']);
  assert.equal(objective.owner, null);
  assert.deepEqual(step(12, false, true), []);
  assert.equal(objective.owner, 'enemy');
  assert.deepEqual(step(24, true, false), ['captured']);
  assert.deepEqual(step(24, false, true), ['lost'], 'loss is not also a neutral attack setback');
  assert.deepEqual(step(24, true, false), ['captured'], 'recaptures remain audible every time');
});

test('all three objective histories are independent and reset with a new battle', () => {
  const tracker = createObjectiveVoiceTracker(), objectives = makeObjectives();
  for (const objective of objectives) {
    assert.deepEqual(tracker.update(objective, advanceCapture(objective, 1, true, false)), ['capturing']);
    assert.deepEqual(tracker.update(objective, advanceCapture(objective, 1, true, true)), ['contested']);
  }
  for (const objective of objectives) {
    assert.deepEqual(tracker.update(objective, advanceCapture(objective, 11, true, false)), ['captured']);
  }
  tracker.reset();
  for (const objective of makeObjectives()) {
    assert.deepEqual(tracker.update(objective, advanceCapture(objective, 1, true, false)), ['capturing']);
    assert.deepEqual(tracker.update(objective, advanceCapture(objective, 1, true, true)), ['contested']);
  }
});

test('victory, defeat and draw each have an actual announcement independent of ambient cooldowns', () => {
  for (const cue of ['victory', 'defeat', 'draw']) {
    const { audio, context } = setup();
    audio.event(context, 'lost', { eventKey: 'objective:A:lost' });
    audio.event(context, cue, { eventKey: `match:${cue}` });
    assert.equal(audio.snapshot.queued, 1);
    finish(context);
    audio.update(context, [], listener, 30, false);
    assert.equal(audio.snapshot.history.at(-1).cue, cue);
    assert.equal(audio.snapshot.history.at(-1).eventKey, `match:${cue}`);
    assert.equal(audio.snapshot.active, 1);
    assert.equal(audio.snapshot.counts.ambient, 0);
  }
});

test('missing or oversized decoded recordings fail explicitly', () => {
  assert.throws(() => createBattleVoices({}), /short mono clip/);
  const bank = buffers(); bank[battleVoiceClips()[0].file].duration = 30;
  assert.throws(() => createBattleVoices(bank), /short mono clip/);
});

test('clock bearings cover all twelve directions relative to the player, with correct wraparound and yaw', () => {
  for (let hour = 1; hour <= 12; hour++) {
    const angle = hour * Math.PI / 6;
    assert.equal(battleClockDirection({ x: Math.sin(angle) * 20, y: 0, z: -Math.cos(angle) * 20 }, listener), hour);
  }
  assert.equal(battleClockDirection({ x: 20, y: 0, z: 0 }, listener), 3);
  assert.equal(battleClockDirection({ x: -20, y: 0, z: 0 }, listener), 9);
  const turned = { ...listener, right: { x: 0, y: .5, z: 1 } };
  assert.equal(battleClockDirection({ x: 20, y: 40, z: 0 }, turned), 12, 'looking east makes east twelve oclock; pitch and elevation do not change bearing');
  assert.equal(battleClockDirection({ x: 0, y: 0, z: -20 }, turned), 9);
  for (const degrees of [-14.9, 14.9, 359]) {
    const radians = degrees * Math.PI / 180;
    assert.equal(battleClockDirection({ x: Math.sin(radians) * 20, y: 0, z: -Math.cos(radians) * 20 }, listener), 12);
  }
  assert.equal(battleClockDirection({ x: 0, y: 20, z: 0 }, listener), null, 'no invented bearing for a target directly above/below');
  assert.throws(() => battleClockDirection({ x: NaN, y: 0, z: 1 }, listener), /Invalid/);
  assert.throws(() => battleClockDirection({ x: 1, y: 0, z: 1 }, { ...listener, right: { x: 0, y: 1, z: 0 } }), /horizontal/);
});

test('every role/clock combination has three real male speech variants, including a forward enemy tank warning', () => {
  for (const role of ['sniper', 'machine-gunner', 'tank']) for (let hour = 1; hour <= 12; hour++) {
    const clips = battleVoiceClips().filter(clip => clip.cue === `callout-${role}-${hour}`);
    assert.equal(clips.length, 3);
    assert.ok(clips.every(clip => clip.team === 'friendly' && clip.locale === 'zh-CN'));
    if (role === 'tank' && hour === 12) assert.ok(clips.every(clip => clip.text === '前方发现敌军坦克！'));
  }
});

test('nearby squadmates report fresh visually identified targets, never player-only knowledge, sound, stale memory or occluded targets', () => {
  const baseline = sightedThreat();
  assert.equal(findBattleCallout(baseline.actors, listener, 2, () => true).target.id, 'target');
  assert.equal(findBattleCallout(baseline.actors, listener, 2, () => false), null, 'last known sight does not override a newly blocking wall');
  for (const mutate of [
    ({ observer }) => { observer.position.x = 19; },
    ({ observer }) => { observer.health = 0; },
    ({ observer }) => { observer.vehicleId = 'friendly-tank'; },
    ({ observer }) => { observer.team = 'enemy'; },
    ({ observer }) => { observer.groundType = 'mortar'; },
    ({ observer }) => { observer.rifle.action = 'reload'; },
    ({ observer }) => { observer.tactics.mode = 'evade-grenade'; },
    ({ observer }) => { observer.tactics.threatSense = 'sound'; },
    ({ observer }) => { observer.tactics.lastSightCheck.visible = false; },
    ({ observer }) => { observer.tactics.lastSightCheck.time = 0; },
    ({ observer }) => { observer.tactics.lastSightCheck.time = 3; },
    ({ observer }) => { observer.tactics.lastSightCheck.targetId = 'unknown'; },
    ({ observer }) => { observer.tactics.threatId = 'someone-else'; },
    ({ target }) => { target.health = 0; },
    ({ target }) => { target.team = 'friendly'; },
    ({ target }) => { target.role = 'rifleman'; },
    ({ target }) => { target.position.x = 80; },
    ({ target }) => { target.vehicleId = 'plane'; target.targetKind = 'aircraft'; },
    ({ player }) => { player.health = 0; },
  ]) {
    const sample = sightedThreat(); mutate(sample);
    assert.equal(findBattleCallout(sample.actors, listener, 2, () => true), null, mutate.toString());
  }
  assert.equal(findBattleCallout([baseline.player, baseline.target], listener, 2, () => true), null);
});

test('callouts interrupt random chatter but not commands/announcements, are spatial, and keep the reporting soldier voice', () => {
  const { audio, context } = setup(), sample = sightedThreat('sniper', 3);
  audio.update(context, sample.actors, listener, 2);
  assert.equal(audio.snapshot.counts.ambient, 1);
  audio.update(context, sample.actors, listener, 2.1, true, () => true);
  const report = audio.snapshot.history.at(-1);
  assert.equal(report.channel, 'callout');
  assert.equal(report.cue, 'callout-sniper-3');
  assert.equal(report.targetRole, 'sniper');
  assert.equal(report.soldierId, sample.observer.id);
  assert.equal(report.file, `friendly-${soldierVoiceVariant(sample.observer.id)}-callout-sniper-3.mp3`);
  assert.ok(report.distance < 5);
  assert.ok(context.sources[0].stopped);
  audio.event(context, 'order-follow', { command: true });
  assert.equal(audio.snapshot.active, 1);
  assert.ok(context.sources[1].stopped, 'a command supersedes the callout');
  audio.update(context, sample.actors, listener, 3, true, () => true);
  assert.equal(audio.snapshot.counts.callout, 1);
});

test('bearings are calculated when reporting, not when observing or by the observer heading', () => {
  const { audio, context } = setup(), sample = sightedThreat('sniper', 3);
  const turned = { ...listener, right: { x: 0, y: 0, z: 1 } };
  audio.update(context, sample.actors, turned, 2, true, () => true);
  assert.equal(audio.snapshot.history.at(-1).clock, 12);
  assert.equal(audio.snapshot.history.at(-1).cue, 'callout-sniper-12');
});

test('one target has a shared 24 second report cooldown across teammates; turning alone cannot bypass it', () => {
  const { audio, context } = setup(), sample = sightedThreat();
  audio.update(context, sample.actors, listener, 2, true, () => true);
  finish(context);
  const second = { ...sample.observer, id: 'observer-2', tactics: structuredClone(sample.observer.tactics) };
  sample.actors.push(second);
  for (const time of [10, 20, 25.9]) {
    sample.observer.tactics.lastSightCheck.time = second.tactics.lastSightCheck.time = time;
    audio.update(context, sample.actors, { ...listener, right: { x: -1, y: 0, z: 0 } }, time, true, () => true);
    finish(context);
  }
  assert.equal(audio.snapshot.counts.callout, 1);
  sample.observer.tactics.lastSightCheck.time = second.tactics.lastSightCheck.time = 26;
  audio.update(context, sample.actors, listener, 26.4, true, () => true);
  assert.equal(audio.snapshot.counts.callout, 2);
});

test('tank reports identify the visible occupied armor, prioritize it and deduplicate its four crew seats', () => {
  const { audio, context } = setup(), sample = sightedThreat('tank', 12);
  audio.update(context, sample.actors, listener, 2, true, () => true);
  let report = audio.snapshot.history.at(-1);
  assert.equal(report.cue, 'callout-tank-12');
  assert.equal(report.text, '前方发现敌军坦克！');
  assert.equal(report.targetKey, 'tank-1');
  finish(context);
  const otherCrew = { ...sample.target, id: 'second-crew', role: 'commander' };
  sample.actors.push(otherCrew);
  sample.observer.tactics.threatId = otherCrew.id;
  sample.observer.tactics.lastSightCheck = { targetId: otherCrew.id, time: 14, visible: true };
  audio.update(context, sample.actors, listener, 14, true, () => true);
  assert.equal(audio.snapshot.counts.callout, 1, 'another seat is not a new enemy tank');
  finish(context);
  audio.reset();
  sample.observer.tactics.lastSightCheck.time = 20;
  const sniper = sightedThreat('sniper', 3, 20);
  sniper.observer.id = 'sniper-observer'; sniper.target.id = 'sniper-target';
  sniper.observer.tactics.threatId = 'sniper-target'; sniper.observer.tactics.lastSightCheck.targetId = 'sniper-target';
  const selected = findBattleCallout([...sample.actors, sniper.observer, sniper.target], listener, 20, () => true);
  assert.equal(selected.targetRole, 'tank');
});

test('callouts stop on death, handover, pause or a new battle; a resumed game never replays a stale bearing', () => {
  for (const action of ['death', 'handover', 'pause', 'reset']) {
    const { audio, context } = setup(), sample = sightedThreat('machine-gunner', 10);
    audio.update(context, sample.actors, listener, 2, true, () => true);
    assert.equal(audio.snapshot.history.at(-1).cue, 'callout-machine-gunner-10');
    if (action === 'death') {
      sample.observer.health = 0;
      audio.update(context, sample.actors, listener, 2.1, true, () => true);
    } else if (action === 'handover') {
      audio.update(context, sample.actors, { ...listener, soldierId: 'observer' }, 2.1, true, () => true);
    } else if (action === 'pause') audio.sync(false);
    else audio.reset();
    assert.ok(context.sources[0].stopped, action);
    assert.equal(audio.snapshot.queued, 0, action);
    assert.equal(audio.snapshot.active, 0, action);
  }
});
