import './style.css';
import './loading-screen.css';
import { createPhotoWall } from './loading-screen.js';
import { setLoadingProgress } from './loading-progress.js';
import { getPerformanceDiagnostics } from './performance-diagnostics.js';
import { SELECTABLE_CAMPAIGNS, DEFAULT_CAMPAIGN, campaignById } from './campaigns.js';
import { createFeedback } from './feedback.js';
import { deploymentCards, deploymentMarker, DEPLOYMENT_SQUADS } from './deployment-view.js';
import { createFullscreenControls } from './fullscreen.js';
import { createCampaignPresentation } from './campaign-presentation.js';
import { createPlayerIdentityControls } from './player-identity.js';
import { getPlayerPreferences } from './player-preferences.js';

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
const launcherPreferences = getPlayerPreferences(), quality = document.getElementById('menu-quality');
quality.value = launcherPreferences.snapshot.quality.preset;
if (launcherPreferences.status.problem)
  document.querySelector('#menu [data-preferences-status]').textContent = launcherPreferences.status.message;
quality.addEventListener('change', () => {
  if (loaded) return;
  launcherPreferences.update({ quality: { ...launcherPreferences.snapshot.quality, preset: quality.value } });
  document.querySelector('#menu [data-preferences-status]').textContent = launcherPreferences.status.message;
});
let initialSquad = null, initialSpawn = null;
let tacticalMapReady = false;
const $ = id => document.getElementById(id);
const initialSpawns = {
  infantry: { id: 'china-base', name: '初始步兵集结地', x: 0, z: 78 },
  tank: { id: 'china-garage', name: '初始装甲出发点', x: 0, z: 83 },
  plane: { id: 'china-air', name: '空中入场点', x: 0, z: 102 },
};
deploymentCards($('redeploy-choices'));
function refreshInitialDeployment() {
  for (const button of $('redeploy-choices').querySelectorAll('[data-type]')) {
    button.classList.toggle('selected', button.dataset.type === initialSquad);
    button.setAttribute('aria-pressed', String(button.dataset.type === initialSquad));
  }
  const spawn = initialSpawns[initialSquad];
  $('spawn-choices').replaceChildren();
  if (spawn) {
    const marker = deploymentMarker(spawn, initialSquad);
    marker.classList.toggle('selected', initialSpawn === spawn.id);
    marker.setAttribute('aria-pressed', String(initialSpawn === spawn.id));
    marker.setAttribute('aria-label', spawn.name);
    marker.querySelector('small').textContent = '初始出发位置';
    $('spawn-choices').append(marker);
  }
  $('deployment-selection').textContent = !spawn ? '请选择小队，系统会推荐出生点；可在地图上改选。' :
    `${DEPLOYMENT_SQUADS.find(item => item.id === initialSquad).name} · ${initialSpawn ? spawn.name + ' · 已选择' : '点击地图选择位置'}`;
  $('confirm-deploy').disabled = !initialSquad || !initialSpawn || !tacticalMapReady;
  $('confirm-deploy').firstChild.textContent = '确认小队与位置，进入战场 ';
}
async function openInitialDeployment() {
  const campaign = campaignById(selector.value);
  if (campaign.locked || campaign.hidden) throw new RangeError('该战役尚未开放');
  campaignPresentation.select(campaign);
  $('initial-identity-slot').hidden = false;
  playerIdentity.show(campaign, $('initial-identity-slot'));
  $('deployment-campaign-context').hidden = false;
  $('overlay').hidden = false; $('overlay').classList.add('deployment-overlay');
  $('overlay-kicker').textContent = '作战部署 / DEPLOY';
  $('overlay-title').textContent = campaign.name;
  $('overlay-description').textContent = '选择小队和初始出生位置，再确认出击。';
  for (const id of ['resume', 'battle-summary', 'pause-settings', 'control-settings', 'motion-settings', 'audio-settings', 'quality-settings']) $(id).hidden = true;
  $('redeploy-choices').hidden = $('deployment-options').hidden = false;
  $('confirm-deploy').hidden = false;
  $('deployment-help').open = false;
  $('deployment-help').hidden = false;
  $('overlay-description').hidden = false;
  $('overlay').querySelector('[data-build-version]').hidden = false;
  $('deployment-objective').textContent = '首次出击 · 初始阵地';
  $('back-menu').textContent = '返回选择战役';
  initialSquad = initialSpawn = null; tacticalMapReady = false; refreshInitialDeployment();
  const canvas = $('deployment-map'), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#273328'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  $('deployment-error').textContent = '正在加载战术地图…';
  try {
    const response = await fetch(`/assets/maps/${campaign.id}.json`);
    if (!response.ok) throw new Error(`Tactical map HTTP ${response.status}`);
    const map = await response.json(), size = canvas.width;
    ctx.fillStyle = '#abb39766';
    for (const b of map.obstacles) ctx.fillRect((b.minX + 110) / 220 * size, (b.minZ + 110) / 220 * size,
      (b.maxX - b.minX) / 220 * size, (b.maxZ - b.minZ) / 220 * size);
    ctx.fillStyle = '#f0d397'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center';
    for (const point of map.objectives) ctx.fillText(point.id, (point.x + 110) / 220 * size, (point.z + 110) / 220 * size);
    tacticalMapReady = true; refreshInitialDeployment();
    $('deployment-error').textContent = '';
  } catch (error) {
    console.error('Tactical map loading failed', error);
    $('deployment-error').textContent = '战术地图加载失败，请刷新后重试。';
    $('confirm-deploy').disabled = true;
  }
}
$('redeploy-choices').addEventListener('click', event => {
  if (loaded) return;
  const button = event.target.closest('[data-type]');
  if (!button) return;
  initialSquad = button.dataset.type; initialSpawn = initialSpawns[initialSquad].id;
  refreshInitialDeployment();
});
$('spawn-choices').addEventListener('click', event => {
  if (loaded) return;
  const button = event.target.closest('[data-spawn]');
  if (!button || !initialSquad) return;
  initialSpawn = button.dataset.spawn; refreshInitialDeployment();
});
$('back-menu').addEventListener('click', event => {
  if (loaded) return;
  event.stopImmediatePropagation();
  $('overlay').hidden = true; campaignStep();
});
const selector = document.getElementById('campaign-choice');
createFeedback({ build: `${__BUILD_STAMP__.commit?.slice(0, 7) ?? 'unknown'}${__BUILD_STAMP__.dirty ? '-local' : ''}`,
  getState: () => window.__battle?.state ?? 'menu',
  getMap: () => selector.value || DEFAULT_CAMPAIGN.id });
const squadStep = document.getElementById('squad-step');
const confirmCampaign = document.getElementById('confirm-campaign');
function campaignStep() {
  if (!initialCampaignSelection || params.get('campaign') !== 'nanjing' && !params.has('benchmark')) ensurePhotoWalls();
  playerIdentity.hide();
  campaignPresentation.reset();
  squadStep.hidden = true;
  confirmCampaign.hidden = false;
}
confirmCampaign.addEventListener('click', () => {
  if (loaded || selector.value === 'nanjing') {
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
  $('campaign-history-source').href = campaign.historySource.url;
  $('campaign-history-source').textContent = `史料来源：${campaign.historySource.name} ↗`;
  $('campaign-goals').replaceChildren(...campaign.goals.map(goal => {
    const item = document.createElement('li'); item.textContent = goal; return item;
  }));
}
selector.addEventListener('change', () => {
  if (loaded) {
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
$('confirm-deploy').addEventListener('click', async event => {
  if (loaded) return;
  event.stopImmediatePropagation();
  if (pending) return;
  if (!initialSquad || !initialSpawn || !tacticalMapReady) return;
  pending = true; deploy.disabled = true; menu.hidden = true; loading.hidden = false;
  setLoadingProgress(0, '正在加载游戏程序与已选战场…');
  const url = new URL(location.href); url.searchParams.set('campaign', selector.value);
  history.replaceState(null, '', url);
  try {
    await import('./main.js');
    loaded = true; deploy.disabled = false; loading.hidden = true;
    document.querySelector(`.squad-choice[data-type="${initialSquad}"]`).click();
    $('overlay').hidden = true;
    deploy.click();
  } catch (error) {
    pending = false; deploy.disabled = false;
    loading.querySelector('p').textContent = `加载失败：${error.message}。刷新后重试。`;
    console.error('Battle loading failed', error);
  }
});
// Existing diagnostic URLs intentionally bypass the campaign launcher.
if (params.has('benchmark') || params.get('campaign') === 'nanjing') {
  if (params.get('campaign') === 'nanjing') {
    const campaign = campaignById('nanjing');
    campaignPresentation.select(campaign);
    playerIdentity.show(campaign, $('selected-identity-slot'));
  }
  squadStep.hidden = false; confirmCampaign.hidden = true;
  menu.hidden = true; loading.hidden = false;
  await import('./main.js');
  loaded = true;
}
