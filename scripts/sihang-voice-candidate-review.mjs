import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { deployFromMenu } from './game-entry.mjs';

const directory = process.env.ARTIFACT_DIR, candidate = process.env.CANDIDATE_AUDIO;
if (!directory) throw new Error('ARTIFACT_DIR is required');
await mkdir(directory, { recursive: true });
const bytes = candidate ? await readFile(candidate) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (bytes) await page.route('**/assets/audio/sihang-voices/withdrawal.mp3*', route =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: bytes }));
  await page.route('**/src/main.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      window.candidateVoiceReview = {
        async start() {
          if (!sihangVoices || !audioMixer || !audioContext) throw new Error('Sihang audio is not ready');
          await audioContext.resume();
          if (audioContext.state !== 'running') throw new Error('Audio context did not resume');
          const stream = audioContext.createMediaStreamDestination();
          const channels = ['weapons', 'voices', 'footsteps', 'effects'];
          for (const channel of channels) audioMixer.output(channel).connect(stream);
          const recorder = new MediaRecorder(stream.stream, { mimeType: 'audio/webm;codecs=opus' });
          const chunks = [];
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          this.finish = new Promise((resolve, reject) => {
            recorder.onerror = event => reject(event.error);
            recorder.onstop = async () => {
              for (const channel of channels) audioMixer.output(channel).disconnect(stream);
              const blob = new Blob(chunks, { type: recorder.mimeType });
              const data = new Uint8Array(await blob.arrayBuffer());
              let binary = '';
              for (const value of data) binary += String.fromCharCode(value);
              resolve(btoa(binary));
            };
          });
          this.recorder = recorder;
          recorder.start();
          missionBriefing.hide();
          sihangCampaign.stageElapsed = SIHANG_RULES.defenseSeconds - .01;
          updateSihangMission(.02);
          return { stage: sihangCampaign.stage, voice: sihangVoices.snapshot, mix: audioMixer.snapshot };
        },
        async stop() { this.recorder.stop(); return await this.finish; }
      };` });
  });
  const url = new URL(process.env.GAME_URL ?? 'http://127.0.0.1:5353');
  url.searchParams.set('campaign', 'sihang'); url.searchParams.set('resources', 'low-memory');
  if (process.env.GAME_CHARACTER === 'procedural') url.searchParams.set('character', 'procedural');
  await page.goto(url.href); await deployFromMenu(page);
  await page.waitForFunction(() => window.__battle?.state === 'playing', null, { timeout: 180000 });
  const started = await page.evaluate(() => candidateVoiceReview.start());
  await page.screenshot({ path: join(directory, 'battle.png') });
  await page.waitForTimeout(8000);
  const audio = await page.evaluate(() => candidateVoiceReview.stop());
  await writeFile(join(directory, 'battle-mix.webm'), Buffer.from(audio, 'base64'));
  await writeFile(join(directory, 'review.json'), JSON.stringify({
    fixture: `${process.env.GAME_CHARACTER === 'procedural' ? 'procedural' : 'native'} character battle, real audio mixer and mission transition; clock advanced manually; ${candidate ? 'candidate replaces the withdrawal response only in the browser' : 'uses the shipped withdrawal recording'}`,
    started, errors }, null, 2));
  assert.equal(started.stage, 'sihang-retreat');
  assert.equal(started.voice.active, 'withdrawal');
  assert.ok(started.voice.spoken > 0);
  assert.deepEqual(errors, []);
  console.log('Candidate voice played through the actual mission and audio mixer.');
} finally {
  await browser.close();
}
