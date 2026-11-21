import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { civilianVoiceClips } from '../src/civilian-voice-lines.js';
import { createCivilianVoiceDirector, createCivilianVoices,loadCivilianVoices } from '../src/civilian-voices.js';
import { voiceSSML } from '../scripts/prepare-battle-voices.mjs';

const listener = { position: { x: 0, y: 1.6, z: 0 }, right: { x: 1, y: 0, z: 0 }, soldierId: 'player' };
const person = (ageGroup = 'adult', presentation = 'woman', id = 1) => ({
  visible: true, position: { x: 3, y: 0, z: 3 },
  userData: { active: true, civilianId: id, ageGroup, presentation, openingWave: true },
});
const buffers = () => Object.fromEntries(civilianVoiceClips().map(clip => [clip.file, { numberOfChannels: 1, duration: 3 }]));
function context() {
  const sources = [];
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connect() { return this; }, disconnect() {}, gain: parameter(), pan: parameter(), frequency: parameter() });
  return { state: 'running', currentTime: 0, sources,
    createBufferSource() { const source = { ...node(), start() {}, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source; },
    createGain: node, createStereoPanner: node, createBiquadFilter: node };
}

test('135 recordings cover opening, retreat and the three dedicated encounter lines', () => {
  const clips = civilianVoiceClips();
  assert.equal(clips.length, 135);
  assert.equal(new Set(clips.map(clip => clip.file)).size, 135);
  assert.equal(clips.filter(clip => clip.phase === 'retreat').length, 83);
  assert.equal(clips.filter(clip => Number.isInteger(clip.encounterOrder)).length, 3);
  assert.equal(clips.filter(clip => clip.speakerKind === 'soldier').length, 12);
  assert.ok(clips.every(clip => clip.voice !== 'zh-CN-YunxiNeural'));
  assert.ok(clips.filter(clip => clip.age === 'child' && clip.presentation === 'man')
    .every(clip => clip.voice === 'zh-CN-YunjianNeural' && !clip.role));
  for (const phase of ['opening', 'retreat']) for (const age of ['child', 'elderly', 'adult'])
    for (const presentation of ['man', 'woman'])
      assert.ok(clips.some(clip => clip.phase === phase && clip.age === age && clip.presentation === presentation));
  assert.match(voiceSSML(clips.find(clip => clip.role === 'SeniorMale')), /role="SeniorMale"/);
  assert.match(voiceSSML(clips[0]), /volume="medium"/);
});

test('every real MP3 matches its synthesis hash and provenance, with independent character budgets well below 50 USD per phase', async () => {
  const root = new URL('../public/assets/audio/civilian-voices/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('source.json', root), 'utf8'));
  assert.equal(manifest.license, 'Azure-generated-speech');
  assert.equal(manifest.files.length, 135);
  assert.ok(manifest.files.every(file => file.voice !== 'zh-CN-YunxiNeural'));
  for (const clip of civilianVoiceClips()) {
    const record = manifest.files.find(file => file.file === clip.file);
    const bytes = await readFile(new URL(clip.file, root));
    assert.equal(bytes.length, record.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
    assert.equal(createHash('sha256').update(`${manifest.format}\n${voiceSSML(clip)}`).digest('hex'), record.synthesisHash);
  }
  for (const phase of ['opening', 'retreat']) {
    assert.equal(manifest.budgetPerPhaseUSD[phase], 50);
    assert.ok(manifest.attemptedCharactersByPhase[phase] <= 200000);
    assert.ok(manifest.attemptedCharactersByPhase[phase] * 15 / 1000000 < 50);
  }
});
test('only the six new urgent takes change emotion parameters and cache revision',()=>{
  const urgent=civilianVoiceClips().filter(clip=>clip.audioRevision);
  assert.equal(urgent.length,6);
  assert.ok(urgent.every(clip=>clip.styledegree==='2'&&clip.volume==='loud'&&clip.pauseMs===110&&clip.age==='child'));
  assert.equal(urgent.filter(clip=>clip.voice==='zh-CN-YunjianNeural'&&clip.audioRevision==='sad-2'&&clip.style==='sad').length,3);
  assert.equal(urgent.filter(clip=>clip.voice==='zh-CN-XiaomoNeural'&&clip.audioRevision==='fearful-2'&&clip.style==='fearful').length,3);
});
test('the actual voice loader requests revised URLs for changed takes and keeps legacy URLs stable',async()=>{
  const previousAudio=globalThis.OfflineAudioContext,previousFetch=globalThis.fetch,requests=[];
  globalThis.OfflineAudioContext=class { async decodeAudioData(){return{numberOfChannels:1,duration:3};} };
  globalThis.fetch=async url=>{requests.push(url);return new Response(new Uint8Array([0]));};
  try{
    await loadCivilianVoices();
    assert.equal(requests.length,135);
    assert.equal(requests.filter(url=>url.includes('?v=fearful-2')).length,3);
    assert.equal(requests.filter(url=>url.includes('?v=sad-2')).length,3);
    assert.ok(requests.includes('/assets/audio/civilian-voices/man-1.mp3'));
  }finally{globalThis.fetch=previousFetch;globalThis.OfflineAudioContext=previousAudio;}
});

test('voice selection follows actual age, gender, stage and location, excludes inactive or dead people, and never repeats a text within 150 seconds', () => {
  const director = createCivilianVoiceDirector(undefined, () => 0), civilian = person('child', 'man');
  const first = director.select([civilian], listener, 'gate-defense', 0);
  assert.equal(first.clip.phase, 'opening');
  assert.equal(first.clip.age, 'child');
  assert.equal(first.clip.role, undefined);
  const heard = new Set([first.clip.text]);
  for (let now = 30; now <= 120; now += 30) {
    const next = director.select([civilian], listener, 'gate-defense', now);
    assert.ok(!heard.has(next.clip.text)); heard.add(next.clip.text);
  }
  director.reset();
  civilian.userData.dead = true;
  assert.equal(director.select([civilian], listener, 'gate-defense', 0), null);
  civilian.userData.dead = false; civilian.userData.active = false;
  assert.equal(director.select([civilian], listener, 'gate-defense', 0), null);
  civilian.userData.active = true; civilian.position = { x: -65, y: .36, z: -80 };
  const dockListener = { ...listener, position: { x: -65, y: 2, z: -80 } };
  assert.equal(director.select([civilian], dockListener, 'dock-defense', 0).clip.zone, 'both');
  director.reset(); civilian.position.z = -20;
  assert.equal(director.select([civilian], { ...listener, position: civilian.position }, 'gate-defense', 0), null);
});

test('a real nearby soldier can call for civilian protection but human-shield calls require an enemy behind the refugees', () => {
  const clips = civilianVoiceClips().filter(clip => clip.speakerKind === 'soldier');
  const civilian = person(), soldier = { id: 'guard', health: 100, position: { x: 0, y: 0, z: 0 } };
  const director = createCivilianVoiceDirector(clips, () => 0);
  const call = director.select([civilian], listener, 'gate-defense', 0, [soldier]);
  assert.equal(call.clip.cue, 'protect');
  assert.equal(call.person.actor, soldier);
  const shields = createCivilianVoiceDirector(clips.filter(clip => clip.cue === 'shield'), () => 0);
  assert.equal(shields.select([civilian], listener, 'gate-defense', 0, [soldier]), null);
  const enemy = { health: 100, position: { x: 3, y: 0, z: 15 } };
  assert.equal(shields.select([civilian], listener, 'gate-defense', 1, [soldier], [enemy]).clip.cue, 'shield');
});

test('priority orders duck current civilian speech, do not consume new lines, and pause, death and reset stop playback', () => {
  const audio = createCivilianVoices(buffers()), ctx = context(), civilian = person();
  audio.setOutput({});
  audio.update(ctx, [civilian], listener, 'gate-defense', 0, true, true);
  assert.equal(ctx.sources.length, 0);
  audio.update(ctx, [civilian], listener, 'gate-defense', 1, true, false);
  assert.equal(ctx.sources.length, 1);
  audio.update(ctx, [civilian], listener, 'gate-defense', 2, true, true);
  assert.equal(audio.snapshot.active, 1);
  civilian.userData.dead = true;
  audio.update(ctx, [civilian], listener, 'gate-defense', 3, true, false);
  assert.ok(ctx.sources[0].stopped);
  civilian.userData.dead = false; audio.reset();
  audio.update(ctx, [civilian], listener, 'gate-defense', 0, true, false);
  audio.sync(false);
  assert.equal(audio.snapshot.active, 0);
  assert.ok(ctx.sources.at(-1).stopped);
  audio.reset(); ctx.state = 'suspended';
  audio.update(ctx, [civilian], listener, 'gate-defense', 0, true, false);
  assert.equal(audio.snapshot.spoken, 0);
  assert.throws(() => createCivilianVoices({}), /Invalid civilian audio buffer/);
});
