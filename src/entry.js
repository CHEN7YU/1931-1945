import './style.css';
import './loading-screen.css';
import { createPhotoWall } from './loading-screen.js';
import { setLoadingProgress } from './loading-progress.js';
import { getPerformanceDiagnostics } from './performance-diagnostics.js';
import { SELECTABLE_CAMPAIGNS, DEFAULT_CAMPAIGN, campaignById } from './campaigns.js';
import { createFeedback } from './feedback.js';
import { createFullscreenControls } from './fullscreen.js';
import { createCampaignPresentation } from './campaign-presentation.js';
import { createPlayerIdentityControls } from './player-identity.js';
import { getPlayerPreferences } from './player-preferences.js';
import { getMenuMusic } from './menu-music.js';
import { getEndingMusic } from './ending-music.js';

const params = new URLSearchParams(location.search);
getPerformanceDiagnostics();
const menu = document.getElementById('menu'), loading = document.getElementById('loading');
createFullscreenControls();
let photoWallsReady = false, initialCampaignSelection = true;
const ensurePhotoWalls = () => {
  if (photoWallsReady) return;
  createPhotoWall(document.getElementById('loading-photo-wall'), { visibilityElement: loading });
  createPhotoWall(document.getElementById('menu-photo-wall'), { visibilityElement: menu });
  photoWallsReady = true;
};
const campaignPresentation = createCampaignPresentation();
const playerIdentity = createPlayerIdentityControls();
const deploy = document.getElementById('deploy');
let loaded = false, pending = false;
const launcherPreferences = getPlayerPreferences();
const menuMusic = getMenuMusic();
const endingMusic = getEndingMusic();
const activateMusic = event => {
  if (!(event.target instanceof Element && event.target.closest('[data-menu-music-toggle]'))) {
    void menuMusic.activate(); void endingMusic.activate();
  }
};
document.addEventListener('pointerdown', activateMusic, { capture: true });
document.addEventListener('keydown', activateMusic, { capture: true });
for (const button of document.querySelectorAll('[data-menu-music-toggle]'))
  button.addEventListener('click', () => { menuMusic.toggle(); endingMusic.setMuted(menuMusic.snapshot.muted); });
menuMusic.setState('menu');
if (launcherPreferences.status.problem)
  document.querySelector('#menu [data-preferences-status]').textContent = launcherPreferences.status.message;
const $ = id => document.getElementById(id);
function openInitialDeployment() {
  menuMusic.setState('deployment');
  const campaign = campaignById(selector.value);
  if (campaign.locked || campaign.hidden) throw new RangeError('该战役尚未开放');
  campaignPresentation.select(campaign);
  $('initial-identity-slot').hidden = false;
  playerIdentity.show(campaign, $('initial-identity-slot'));
  $('deployment-campaign-context').hidden = false;
  $('overlay').hidden = false; $('overlay').classList.add('deployment-overlay');
  $('overlay').dataset.deploymentStep = 'identity';
  $('overlay-kicker').textContent = '作战部署 / DEPLOY';
  $('overlay-title').textContent = campaign.name;
  $('overlay-description').textContent = '查看本关作战信息，选择昵称和小队番号。下一步选择小队与阵地。';
  for (const id of ['resume', 'battle-summary', 'pause-settings', 'control-settings', 'motion-settings', 'audio-settings', 'quality-settings']) $(id).hidden = true;
  $('redeploy-choices').hidden = $('deployment-options').hidden = true;
  $('confirm-deploy').hidden = true;
  $('confirm-identity').hidden = false;
  $('deployment-help').open = false;
  $('deployment-help').hidden = false;
  $('overlay-description').hidden = false;
  $('overlay').querySelector('[data-build-version]').hidden = true;
  $('back-menu').textContent = '返回选择战役';
  $('overlay').querySelector('.dialog').scrollTop = 0;
}
$('back-menu').addEventListener('click', event => {
  const step = $('overlay').dataset.deploymentStep;
  if (!step) return;
  event.stopImmediatePropagation();
  if (step === 'squad') { openInitialDeployment(); return; }
  delete $('overlay').dataset.deploymentStep;
  $('overlay').hidden = true; campaignStep();
});
const selector = document.getElementById('campaign-choice');
createFeedback({ build: `${__BUILD_STAMP__.commit?.slice(0, 7) ?? 'unknown'}${__BUILD_STAMP__.dirty ? '-local' : ''}`,
  getState: () => window.__battle?.state ?? 'menu',
  getMap: () => selector.value || DEFAULT_CAMPAIGN.id });
const squadStep = document.getElementById('squad-step');
const confirmCampaign = document.getElementById('confirm-campaign');
function campaignStep() {
  menuMusic.setState('menu');
  menu.hidden = false;
  loading.hidden = true;
  if (!initialCampaignSelection || !['nanjing', 'sihang'].includes(params.get('campaign')) && !params.has('benchmark')) ensurePhotoWalls();
  playerIdentity.hide();
  campaignPresentation.reset();
  squadStep.hidden = true;
  confirmCampaign.hidden = false;
}
confirmCampaign.addEventListener('click', () => {
  if (!loaded && ['nanjing', 'sihang'].includes(selector.value)) {
    menuMusic.prepareNavigation();
    const url = new URL(location.href); url.searchParams.set('campaign', selector.value); location.assign(url); return;
  }
  void openInitialDeployment();
});
document.getElementById('back-campaign').addEventListener('click', campaignStep);
for (const campaign of SELECTABLE_CAMPAIGNS) {
  const option = document.createElement('option');
  option.value = campaign.id; option.textContent = campaign.locked
    ? `${campaign.name} / ${campaign.year} · 设计图待提交`
    : `${campaign.name} / ${campaign.year}`;
  option.disabled = Boolean(campaign.locked);
  selector.append(option);
}
const requestedCampaign = params.get('campaign') ? campaignById(params.get('campaign')) : DEFAULT_CAMPAIGN;
selector.value = requestedCampaign.locked || requestedCampaign.hidden ? DEFAULT_CAMPAIGN.id : requestedCampaign.id;
function selectCampaign(id) {
  const campaign = campaignById(id);
  if (campaign.locked || campaign.hidden) throw new RangeError('This campaign is not available in the launcher');
  selector.value = id;
  campaignStep();
  document.getElementById('campaign-description').textContent = campaign.description;
  $('campaign-history').textContent = campaign.history;
  $('campaign-goals').replaceChildren(...campaign.goals.map(goal => {
    const item = document.createElement('li'); item.textContent = goal; return item;
  }));
}
selector.addEventListener('change', () => {
  if (loaded) {
    menuMusic.prepareNavigation();
    const url = new URL(location.href);
    url.searchParams.set('campaign', selector.value);
    location.assign(url); return;
  }
  selectCampaign(selector.value);
  initialCampaignSelection = false;
});
for (const button of document.querySelectorAll('.squad-choice')) button.addEventListener('click', () => {
  if (loaded) return;
  for (const choice of document.querySelectorAll('.squad-choice')) {
    choice.classList.toggle('selected', choice === button);
    choice.setAttribute('aria-pressed', String(choice === button));
  }
});
selectCampaign(selector.value);
loading.hidden = true; menu.hidden = false;
$('confirm-identity').addEventListener('click', async event => {
  event.stopImmediatePropagation();
  if (pending) return;
  pending = true; deploy.disabled = true; menu.hidden = true; loading.hidden = false;
  $('overlay').hidden = true;
  menuMusic.setState('loading');
  setLoadingProgress(0, '正在加载游戏程序与已选战场…');
  const url = new URL(location.href); url.searchParams.set('campaign', selector.value);
  history.replaceState(null, '', url);
  try {
    const game = await import('./main.js');
    loaded = true; pending = false; deploy.disabled = false; loading.hidden = true;
    game.showInitialSquadDeployment();
  } catch (error) {
    pending = false; deploy.disabled = false;
    loading.querySelector('p').textContent = `加载失败：${error.message}。刷新后重试。`;
    console.error('Battle loading failed', error);
  }
});
deploy.addEventListener('click', event => {
  if (params.has('benchmark')) return;
  event.stopImmediatePropagation();
  openInitialDeployment();
});
// Existing diagnostic URLs intentionally bypass the campaign launcher.
if (params.has('benchmark') || ['nanjing', 'sihang'].includes(params.get('campaign'))) {
  if (['nanjing', 'sihang'].includes(params.get('campaign'))) {
    const campaign = campaignById(params.get('campaign'));
    campaignPresentation.select(campaign);
    playerIdentity.show(campaign, $('selected-identity-slot'));
  }
  squadStep.hidden = false; confirmCampaign.hidden = true;
  menu.hidden = true; loading.hidden = false;
  menuMusic.setState('loading');
  await import('./main.js');
  loaded = true;
  if (!params.has('benchmark')) openInitialDeployment();
}
