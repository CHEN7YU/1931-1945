import './jiangyin/jiangyin-launcher.js';
import { isJiangyinRequest } from './jiangyin/jiangyin-campaign.js';
import './style.css';
import './loading-screen.css';
import { createPhotoWall } from './loading-screen.js';
import { getPerformanceDiagnostics } from './performance-diagnostics.js';
import { SELECTABLE_CAMPAIGNS, DEFAULT_CAMPAIGN, campaignById } from './campaigns.js';
import { createFeedback } from './feedback.js';
import { createFullscreenControls } from './fullscreen.js';
import { createCampaignPresentation } from './campaign-presentation.js';
import { createPlayerIdentityControls } from './player-identity.js';
import { getPlayerPreferences } from './player-preferences.js';
import { getPreferenceControls } from './preference-controls.js';
import { prefetchCommonStartupResources, startupResourceProfile } from './startup-resources.js';
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
let loaded = false, pending = false, gamePromise = null, loadingCampaign = null;
const launcherPreferences = getPlayerPreferences();
const lowMemoryRestart = document.getElementById('low-memory-restart');
const lowMemoryStartup = startupResourceProfile(params.get('resources') ??
  'auto', navigator.deviceMemory ?? null).lowMemory;
lowMemoryRestart.hidden = lowMemoryStartup;
lowMemoryRestart.addEventListener('click', () => {
  launcherPreferences.update({ resourceMode: 'low-memory' });
  const url = new URL(location.href); url.searchParams.set('resources', 'low-memory');
  location.assign(url);
});
const menuMusic = getMenuMusic();
const endingMusic = getEndingMusic();
getPreferenceControls();
const activateMusic = event => {
  if (!(event.target instanceof Element && event.target.closest('[data-menu-music-toggle]'))) {
    void menuMusic.activate(); void endingMusic.activate();
  }
};
document.addEventListener('pointerdown', activateMusic, { capture: true });
document.addEventListener('keydown', activateMusic, { capture: true });
for (const button of document.querySelectorAll('[data-menu-music-toggle]'))
  button.addEventListener('click', () => menuMusic.toggle());
menuMusic.setState('menu');
if (launcherPreferences.status.problem) {
  document.querySelector('#menu [data-preferences-status]').textContent = launcherPreferences.status.message;
  document.querySelector('#menu [data-preferences-status]').hidden = false;
}
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
function reportLoadFailure(error) {
  pending = false; deploy.disabled = false;
  menu.hidden = true; loading.hidden = false; $('overlay').hidden = true;
  $('loading-message').textContent = `加载失败：${error.message}。刷新后重试。`;
  console.error('Battle loading failed', error);
}
function startGameLoad() {
  if (gamePromise) return gamePromise;
  loadingCampaign = selector.value;
  if (!params.has('benchmark')) {
    const url = new URL(location.href); url.searchParams.set('campaign', loadingCampaign);
    history.replaceState(null, '', url);
  }
  gamePromise = import('./main.js').then(game => {
    loaded = true;
    if (!pending && $('overlay').dataset.deploymentStep === 'identity') {
      menu.hidden = true; loading.hidden = true;
      menuMusic.setState('deployment');
    }
    return game;
  }, error => {
    reportLoadFailure(error);
    return null;
  });
  return gamePromise;
}
confirmCampaign.addEventListener('click', () => {
  openInitialDeployment();
  void startGameLoad();
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
  document.getElementById('campaign-description').textContent = campaign.id === 'sihang' ? '' : campaign.description;
  document.getElementById('campaign-description').hidden = campaign.id === 'sihang';
  $('campaign-history').textContent = campaign.history;
  $('campaign-goals').replaceChildren(...campaign.goals.map(goal => {
    const item = document.createElement('li'); item.textContent = goal; return item;
  }));
}
selector.addEventListener('change', () => {
  if ((loaded || gamePromise) && selector.value !== loadingCampaign) {
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
if (!params.has('benchmark') && !isJiangyinRequest(location.search) && !lowMemoryStartup &&
  !['nanjing', 'sihang'].includes(params.get('campaign'))) {
  prefetchCommonStartupResources({ document, connection: navigator.connection, deviceMemory: navigator.deviceMemory,
    shouldStart: () => !gamePromise && selector.value !== 'jiangyin' });
}
$('confirm-identity').addEventListener('click', async event => {
  event.stopImmediatePropagation();
  if (pending) return;
  pending = true; deploy.disabled = true; menu.hidden = true; loading.hidden = false;
  $('overlay').hidden = true;
  menuMusic.setState('loading');
  const game = await startGameLoad();
  if (!game) return;
  pending = false; deploy.disabled = false; loading.hidden = true;
  try { game.showInitialSquadDeployment(); }
  catch (error) { reportLoadFailure(error); }
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
  if (params.has('benchmark')) {
    menuMusic.setState('loading');
    await startGameLoad();
  } else {
    loading.hidden = true;
    openInitialDeployment();
    void startGameLoad();
  }
}
