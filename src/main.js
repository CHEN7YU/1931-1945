import * as THREE from 'three';
import './style.css';
import { setLoadingProgress } from './loading-progress.js';
import { soldierModel, weaponModel, baseSpawnModel, setModelSurfaces } from './world.js';
import { makeWorld } from './battlefield.js';
import { campaignLayout } from './campaign-layout.js';
import { campaignById } from './campaigns.js';
import { createSihangCampaign, advanceSihangCampaign, sihangDeploymentCount, registerSihangDeployment,
  sihangRetreatDeploymentCount, registerSihangRetreatSquad, transferSihangRetreatSquad, sihangRetreatStatus, sihangSafePosition, SIHANG_RULES,
  startSihangWithdrawalWave, advanceSihangWithdrawalWave,
  sihangWaveAssemblyRemaining } from './sihang-campaign.js';
import { createSihangNight, sihangNightVisibility } from './sihang-night.js';
import { addSihangBridgeDefenses } from './sihang-bridge-defenses.js';
import { SIHANG_ASSEMBLY_ARRIVAL, SIHANG_ASSEMBLY_APPROACH_MAX_X, sihangAssemblyPosition, sihangRetreatFollowPosition, sihangRetreatBlockedWaypoint, sihangRetreatYieldPosition, sihangAssemblyApproach, sihangParadePosition, sihangParadeExit, sihangParadePassage, createProceduralStaticFormation } from './sihang-formation.js';
import { createSihangCombat, sihangShieldLayout, sihangShieldSpawnPositions } from './sihang-combat.js';
import { sihangCoverContext, sihangCoverCandidates, sihangOutsideCover, sihangCoverMovementAllowed,
  sihangDefenseGoal, sihangAssaultFiringWindow } from './sihang-tactics.js';
import { loadSihangVoices } from './sihang-voices.js';
import { createAdaptiveStepBudget } from './adaptive-step-budget.js';
import { createStaticSceneBatchRescue } from './static-scene-batches.js';
import { sihangBattleRoster, sihangSpawns, sihangObjectives, SIHANG_EMPLACEMENTS,
  sihangEnemyTargetAllowed as sihangTargetRule, sihangEnemyRayRange as sihangRayRule, sihangRetreatGoal, sihangRetreatVehicleBypass, sihangPursuitGoal,
  replaceSihangDemolition, sihangRetreatFormation, sihangEnemyRegroupPosts, sihangArmorInterceptObjective } from './sihang-roster.js';
import { SIHANG_RIVER, SIHANG_BRIDGE, SIHANG_WAREHOUSE,
  SIHANG_EVACUATION, SIHANG_DEMOLITION_POINT, SIHANG_STAIRWELLS, SIHANG_LEVELS, SIHANG_MAP_BOUNDS, SIHANG_BATTLE_AREA, sihangBridgePoint, sihangBridgeCoordinates, sihangBridgeContains, sihangRiverBounds,
  sihangNorthBank, sihangSouthBank, sihangBlastClearOfSouthBank } from './sihang-layout.js';
import { ENCIRCLEMENT_RULES, encirclementRoster, encirclementSpawns, encirclementObjectives, supplyGarrisonPositions,
  createEncirclement, captureEncirclement, advanceEncirclement, advanceEncirclementSupport, scheduleEncirclementRespawn,
  encirclementGroundEnemies, EAST_BREAKOUT, recordEncirclementEscape } from './encirclement.js';
import { createEncirclementVoiceTracker } from './encirclement-voices.js';
import { loadSceneMaterials } from './materials.js';
import { TYPES, MATCH_SECONDS, DOMINATION_SECONDS, makeObjectives, objectiveContainsPosition, advanceCapture, createConquest, advanceConquest, moveGround, circleBlocked, segmentClear, createNavigator, blastDamage, nextAlive, canDeploySquad, shotState } from './core.js';
import * as collisionDiagnostics from './core.js';
import { createQueryDiagnostics } from './query-diagnostics.js';
import { createMovementObstacles } from './movement-obstacles.js';
import { floorDestination, multistoryPath } from './multistory.js';
import { RIVER, riverSectionAt } from './ground.js';
import { SQUADS, makeBaseSpawns, deploymentBlockReason, supportsSquad, spawnBlockReason, capturedSpawnPoints, recommendedSpawn } from './spawns.js';
import { FOOT_SPEEDS, createLocomotion, advanceLocomotion, advanceStamina, stopLocomotion, landLocomotion } from './locomotion.js';
import { RIFLE, createRifleState, reloadRifle, shootRifle, infantryWeaponProfile, rifleReloadSeconds } from './rifle-action.js';
import { createBreathState, advanceBreath, aimSway } from './sniper-aim.js';
import { updateRifleModel, updateRifleArms, rifleTextureSnapshot } from './rifle-model.js';
import { createRifleRecoil } from './rifle-recoil.js';
import { createWeaponHands } from './weapon-hands.js';
import { isNativeOfficer } from './officer-appearance.js';
import { supportWeaponTargets } from './support-weapon-pose.js';
import { createSupportViewHands } from './support-view-hands.js';
import { createOcclusionQuery, createClosestHitQuery } from './occlusion-query.js';
import { createGrenadeSupport } from './grenade-support.js';
import { createTactics, rememberThreat, expireThreat, peekTurn, selectCover, pointSegmentDistance,
  friendlyCoverAction, targetAimPoint, visibleTargetPoint, observeVisualThreat, objectiveDestination, objectiveAdvanceRequired,
  assignAssaultObjectives, assaultDestination, formationAssaultAction, resetObjectiveMovement, followGuardAction } from './tactics.js';
import { createQualitySettings, QUALITY_EFFECTS } from './quality.js';
import { canWeaponDamageTarget, canRiflemanTrackTarget, damageForTarget, rifleArmorResponse, rifleAIFireDelay, rifleAIHitChance } from './combat-targets.js';
import { createDaylight, configureSunShadow } from './lighting.js';
import { createCombatEffects, captureImpact } from './combat-effects.js';
import { createTracerPool } from './tracer-pool.js';
import { BATTLE_RULES, AIRCRAFT_SQUAD_SIZE, battleRoster, nanjingBattleRoster, stagingSpawns, formationPositions, validateRoster, armySummary, sectionOffset, holdDestination, isVehicleUnit, FormationPlacementError, reinforcementDue, battleSpawn, infantryEquipment } from './battle-roster.js';
import { SpatialGrid, obstacleLookup } from './spatial.js';
import { createSolidIndex } from './solid-index.js';
import { createSoldierRenderer } from './soldier-renderer.js';
import { createSoldierHitSystem } from './soldier-hit-zones.js';
import { loadRifleAudio } from './rifle-audio.js';
import { loadFootstepAudio } from './footstep-audio.js';
import { loadRifleMechanicalAudio } from './rifle-mechanical-audio.js';
import { loadBattleVoices, createObjectiveVoiceTracker } from './battle-voices.js';
import { loadBattleSignals, enemySignalsEnabled } from './battle-signals.js';
import { loadTacticalFeedbackAudio } from './tactical-feedback-audio.js';
import { loadVehicleAudio } from './vehicle-audio.js';
import { getMenuMusic } from './menu-music.js';
import { getEndingMusic } from './ending-music.js';
import { createGrenadeBlastAudio, grenadeBlastMix } from './grenade-blast-audio.js';
import { createBlastFeedback } from './blast-feedback.js';
import { loadBattleReactions } from './battle-reactions.js';
import { createNraMotion, advanceNraMotion, sampleNraMotion as sampleNativeMotion, nativeAimReady, syncNativeAimGoal } from './nra-motion.js';
import { createNraAppearance } from './nra-appearance.js';
import { benchmarkConfig, seededRandom, diagnosticRoster, diagnosticSpawns, createFrameTelemetry } from './benchmark.js';
import { SHOP_ART_VIEWS } from './shop-art.js';
import { createEntityRegistry, registerUnit, registerSoldier, registerWeapon, createVehicleEntity, occupiedVehicle, seatSoldier,
  leaveGroundVehicle, selectControlledSoldier, controlledSoldier, createControlView, vehicleCollider as buildVehicleCollider, groundExit,
  damageVehicleEntity, resetEntities, controlOwner, captureAttackSource, releaseSupportWeapon, createControlPoseView, occupiedSeat,
  soldierRifleMuzzle, SOLDIER_FIRE_HEIGHT, soldierPostureHeight, soldierEyePosition } from './entities.js';
import { FIRING_POSES, chooseCombatPosture, postureReady, ownedFiringPose, wallFiringContact,
  chooseAdvancePace, chooseShotRelocation } from './combat-posture.js';
import { createDeathTransfer, startDeathTransfer, advanceDeathTransfer, deathTransferMask, resetDeathTransfer } from './control-transition.js';
import { createControlInput } from './control-input.js';
import { createControlEvents } from './control-events.js';
import { createProjectile, advanceProjectile, PROJECTILE_LIMIT } from './projectiles.js';
import { advanceOwnedWeapons, syncControlledRifleTiming } from './weapon-simulation.js';
import { AI_RIFLE, createAIRifleControl, resetAIRifleAim, attemptAIRifleShot, automaticFireMovement } from './ai-rifle.js';
import { BAYONET, createBayonetState, cancelBayonet, bayonetDistance, advanceBayonet, bayonetPoseReady } from './bayonet.js';
import { bayonetObstructed } from './bayonet-clearance.js';
import { dadaoCombatDistance, advanceAIDadao } from './ai-dadao.js';
import { DADAO, createDadaoState, drawDadao, stowDadao, startDadaoSwing, advanceDadao, dadaoPhase, selectDadaoTarget } from './dadao.js';
import { dadaoViewModel, updateDadaoView } from './dadao-model.js';
import { createPresentationRecovery, createBattleFrameLoop } from './presentation-recovery.js';
import { loadDadaoSurfaces, dadaoSurfaceSnapshot } from './dadao-surface.js';
import { advanceAITurn, headingError, AI_TURN } from './ai-turning.js';
import { createAIDecisionScheduler, aiDecisionPriority } from './ai-decisions.js';
import { createAdaptiveAI, idleAIForReduction } from './adaptive-ai.js';
import { createFrameWork } from './frame-work.js';
import { createSquadRoutes } from './squad-routes.js';
import { warmBattleRendering } from './battle-render-warmup.js';
import { createAdaptiveQuality } from './adaptive-quality.js';
import { advanceCivilianFlight } from './civilian-refugees.js';
import './battle-ending.css';
import { BATTLE_HISTORY, createBattleEnding, loadEndingNarration, playEndingNarration } from './battle-ending.js';
import { getPerformanceDiagnostics } from './performance-diagnostics.js';
import { tankSweptContact, chooseTankEvasion as planTankEvasion } from './tank-infantry.js';
import { createPresentationView } from './presentation-view.js';
import { createCombatEvents } from './combat-events.js';
import { attackSourceLabel, createCombatFeedback } from './combat-feedback.js';
import { createVehicleRenderer } from './vehicle-renderer.js';
import { createSimulationClock, SIMULATION_CLOCK } from './simulation-clock.js';
import { BATTLE_AREA, AIR_BATTLE_AREA, BOUNDARY_RULES, createBoundaryState, advanceBoundary } from './battle-boundary.js';
import { CORPSE_RULES, createCasualtyState, expiredCorpses, placeCasualty } from './casualties.js';
import { GRENADE, EXPLOSIVE_PACK, throwableProfile, throwableStock, throwableVehicleDamage, createGrenadeInventory, createGrenadeSystem, grenadePose, grenadeCanDamage } from './grenades.js';
import { createGrenadeRenderer } from './grenade-renderer.js';
import { advanceTankMachineGun, advanceTankDriving, tankConvergedDirection, tankHeading, tankCannonPose, tankObservationPose } from './player-tank.js';
import { infantrySteering as steerInfantry, advanceInfantryPath as advanceInfantryRoute, sampledRouteClear } from './infantry-spacing.js';
import { updateInfantryAimPitch } from './infantry-aim.js';
import { civilianEscapeSpeed, frightenCivilian } from './civilian-panic.js';
import { createMissionBriefing } from './mission-briefing.js';
import { civilianStepAvoidsThreats, updateCivilianThreatResponse } from './civilian-threat.js';
import { advanceCivilianMotion } from './civilian-motion.js';
import { traceCivilianBullet } from './civilian-hits.js';
import { NANJING_EMPLACEMENTS, EMPLACEMENT_PROFILES, createEmplacement, emplacementLook, emplacementPose, emplacementEntry,
  advanceEmplacement, fireEmplacement, reloadEmplacement, aimEmplacement, emplacementCanAimAt,
  emplacementObstacles, moveArtillery, setArtilleryPosition, damageEmplacement, fireSupportPriority,
  artilleryPositionTargets, emplacementCooldown, canOperateEmplacement } from './emplacements.js';
import { createEmplacementModel } from './emplacement-model.js';
import { KILL_COLUMNS, createBattleStats } from './battle-stats.js';
import { campaignUnitName, campaignUnitDescription, soldierRoleLabel, friendlyAIFormationName } from './battle-units.js';
import { chooseAIThrowable, planAIThrow, antiTankApproach } from './ai-throwables.js';
import { scoreIcon } from './score-icons.js';
import { CHI_HA, CHI_HA_MG, japaneseArmorSpawns, chiHaObjectiveDestination } from './chi-ha.js';
import { advanceChiHaAI } from './chi-ha-ai.js';
import { advanceChiHaMachineGuns } from './chi-ha-machine-guns.js';
import { createTankNavigation } from './tank-navigation.js';
import { chooseTankCover } from './armor-cooperation.js';
import { TRAVERSAL, findVault, findSillClimb, beginTraversal, advanceTraversal, moveAirborne, moveSupported, landingHeight, landingDamage, reservationMovementBlockers } from './infantry-traversal.js';
import { beginFatalFall, fatalFallExpired, fatalFallActionAllowed } from './fatal-fall.js';
import { beginDying, dyingExpired, dyingActionAllowed, dyingMask, lastStandThrowable } from './dying.js';
import { meleeEngagementRange, emptyMagazineMeleeCandidate } from './bayonet.js';
import { beginBlastReaction, advanceBlastReaction, sampleBlastReaction, sampleBlastBlur, blastCasualty } from './blast-reaction.js';
import { deploymentMapPoint, deploymentMapView } from './deployment-map.js';
import { WEAPON_MOUNT, mountCandidate, beginWeaponMount, releaseWeaponMount, advanceWeaponMount, mountedLook, mountStability } from './weapon-mount.js';
import { createFatalReporter } from './fatal-report.js';
import { getPlayerPreferences, lookSensitivity } from './player-preferences.js';
import { startupResourceProfile, createStartupTextureBudget } from './startup-resources.js';
import { squadBoundDecision } from './squad-coordination.js';
import { createAudioMixer } from './audio-mixer.js';
import { getPreferenceControls } from './preference-controls.js';
import { weaponRestriction } from './weapon-feedback.js';
import { applyCloseWeaponPose } from './weapon-close-pose.js';
import { MORTAR, createMortar, mortarTarget as calculateMortarTarget, stowMortar, adjustMortarRange, mortarObjectiveRanges, mortarPlacement } from './mortar.js';
import { GRENADE_DISCHARGER, createGrenadeDischarger, stowGrenadeDischarger,
  selectDischargerTargets, dischargerTargetAllowed, createDischargerShell,
  dischargerTrajectoryClear, loadDischargerRound, advanceDischargerShell, dischargerAccuracy,
  dischargerAimTrajectory, dischargerTrajectoryImpact } from './grenade-discharger.js';
import { createGrenadeDischargerModel, createGrenadeDischargerShellModel,
  updateGrenadeDischargerShellModel } from './grenade-discharger-model.js';
import { drawFacingSector, drawMissionMarker } from './minimap-view.js';
import { missionTargets } from './mission-targets.js';
import { soldierRoleIcon } from './soldier-role-icons.js';
import { advanceConstruction, selectConstructionBlueprint } from './construction.js';
import { SIHANG_RESERVED_LANES } from './sihang-layout.js';
import { ENGINEER, createEngineerState, cancelEngineer, engineerPlacement, engineerObstacle,
  engineerBuiltSpec, engineerColliders, engineerFootprintBlocked, engineerConstructionReservations, selectEngineerEquipment,
  consumeEngineerMaterial, createEngineerTool, updateEngineerTool, rememberEngineerConstruction,
  findEngineerConstruction, resumeEngineerConstruction } from './engineer.js';
import { getPlayerIdentity } from './player-identity.js';
import { advanceAircraftAI, AIRCRAFT_GUN, createAircraftObstacleLookup } from './aircraft-ai.js';
import { deploymentCards, deploymentMarker, deploymentMarkerPositions } from './deployment-view.js';
import { loadMortarLaunch, playMortarLaunch } from './mortar-audio.js';
import { createAircraftFall, advanceAircraftFall, expiredAircraftWrecks } from './aircraft-wreck.js';
import { updateMortarModel } from './mortar-model.js';
import { createAircraftControl, aircraftMouseLook, advancePlayerAircraft } from './player-aircraft.js';
import { NANJING_BOAT_CAPACITY, NANJING_DOCK, NANJING_DOCK_ASSAULT_SPAWNS, NANJING_GATE_CAPTURE_SECONDS, NANJING_CIVILIAN_FINAL_WAIT, NANJING_SPAWNS, activateNanjingDock, advanceNanjingCampaign, advanceNanjingGateCapture, boardCivilian, createNanjingCampaign,
  completeNanjingCrossing, createNanjingObjectives, departNanjingBoat, isNanjingSpawnAvailable,
  nanjingDefensePost, nanjingGateRegroupPost, nanjingMissionVoice, nanjingEvacuationVoice, nanjingWallExitWaypoint, overrunNanjingDock, recordNanjingSquadEvacuation,
  recordNanjingAISquadBoarding, nanjingAISquadsBoarded, nanjingAIBoardedCount, registerCivilianArrival,
  registerCivilianCasualties, returnNanjingBoat, nanjingCivilianEvacuationStatus, recordNanjingCivilianCityEntry } from './nanjing-campaign.js';
import { assignNanjingDefense, nanjingDefenseGoal, nanjingWallEntryWaypoint, nanjingCoreGuard } from './nanjing-defense.js';
import { NANJING_DOCK_BUFFER, nanjingDockBufferActive, nanjingDockInside, nanjingDockPathClear,
  nanjingDockOutsideGoal, nanjingDockAssaultGoal, assignNanjingDockDefense } from './nanjing-dock-defense.js';
import { civilianWaypointReached, moveCivilianInCrowd,
  civilianPaceMultiplier, civilianWaitingDrift, createCivilianCrowdPlanner, rejoinCivilianRoute,
  activateCivilianEvacuation, civilianBoardingSpeed } from './civilian-crowd.js';
import { updateCivilianAppearance } from './civilian-character.js';
import { civilianRecoveryDue, installCivilianRecovery, stalledCivilianCandidates, endCivilianRecoveryWait, expireCivilianShoreWait } from './civilian-recovery.js';
import { beginCivilianStreetEvacuation, openCivilianHomeDoor, updateCivilianStreetLife } from './civilian-street-life.js';
import { loadCivilianVoices } from './civilian-voices.js';
import { BREAKOUT_FORCE, breakoutRestorationPlan, hiddenBreakoutPositions } from './breakout-restoration.js';
import { registerBreakoutStrength, crossedEastGate } from './encirclement.js';
import { NANJING_FERRY_ROUTE, updateFerryVisibility, restoreFerryPassenger, shouldDepartNanjingFerry,
  selectCivilianBoarding } from './nanjing-ferry.js';
import { NANJING_FERRY_FLOOR, updateNanjingFerryRower } from './nanjing-river-details.js';
import { troopFerryWaitPoint, beginTroopFerryBoarding, advanceTroopFerryBoarding,
  syncTroopFerryPassengers, troopFerryReady, playerTroopFerryReady, completeTroopFerryCrossing,
  startFinalBoardingFireBuffer, finalBoardingFireHeld, finalBoardingDamageHeld, retainTroopFerryCasualty,
  syncTroopFerryCorpses } from './nanjing-troop-ferry.js';
import {civilianCombatTargets,civilianAimHeight,civilianEngagementPreferred} from './civilian-targets.js';
import {advanceBreakoutGroups,breakoutGroupNumber,breakoutGroupDestination} from './breakout-groups.js';

const buildStamp = Object.freeze(__BUILD_STAMP__);
const buildRevision = buildStamp.commit?.slice(0, 7);
const buildLabel = import.meta.env.DEV
  ? `开发预览 · ${buildRevision ? `基线 ${buildRevision}` : '版本未知'}`
  : buildRevision ? `构建 ${buildRevision}${buildStamp.dirty ? ' · 含未提交改动' : ''}` : '构建版本未知';
for (const element of document.querySelectorAll('[data-build-version]')) {
  element.textContent = buildLabel;
  element.title = `${import.meta.env.DEV ? '开发服务器启动基线，源码可热更新，非线上发布版本' : '此页面的实际构建版本'}\n提交：${buildStamp.commit ?? '未知'}\n构建时间（UTC）：${buildStamp.builtAt}`;
}

const nanjingCampaignMode = new URLSearchParams(location.search).get('campaign') === 'nanjing';
const sihangCampaignMode = new URLSearchParams(location.search).get('campaign') === 'sihang';
const battleArea = sihangCampaignMode ? SIHANG_BATTLE_AREA : BATTLE_AREA;
const benchmark = benchmarkConfig(location.search, import.meta.env.DEV);
const performanceDiagnostics = getPerformanceDiagnostics();
const reportLoading = stage => performanceDiagnostics.recordLoading({
  map: campaignById(new URLSearchParams(location.search).get('campaign') ?? 'taierzhuang-streets').id,
  quality: preferenceValues.startupQualityLevel || startupResources.lowMemory ? 'low' : preferenceValues.quality.preset, stage,
});
const chooseTankEvasion = (...args) => performanceDiagnostics.measure('tankEvasion', () => planTankEvasion(...args));
const telemetry = createFrameTelemetry(Boolean(benchmark));
const renderIsolation = { mode: 'normal', drawFrames: 0, skippedFrames: 0, hiddenCharacterFrames: 0, characterPresentationFrames: 0 };
const queryDiagnostics = createQueryDiagnostics(Boolean(benchmark?.queryStats));
const sampleNraMotion = queryDiagnostics ? queryDiagnostics.wrap('tacticalMotion', sampleNativeMotion) : sampleNativeMotion;
const vehicleCollider = queryDiagnostics ? queryDiagnostics.wrap('vehicleCollider', buildVehicleCollider) : buildVehicleCollider;
const infantrySteering = queryDiagnostics ? queryDiagnostics.wrap('crowdSteering', steerInfantry) : steerInfantry;
const advanceInfantryPath = queryDiagnostics ? queryDiagnostics.wrap('waypointSkipping', advanceInfantryRoute) : advanceInfantryRoute;
const entities = createEntityRegistry();
const controlPose = createControlPoseView(entities);
const deathTransfer = createDeathTransfer();
const playerInput = createControlInput();
const held = playerInput.held;
const controlEvents = createControlEvents();
const combatEvents = createCombatEvents();
const combatFeedback = createCombatFeedback();
let renderedFeedKey = '';
const grenades = createGrenadeSystem();
const aiThrowReservations = new Map();
const battleStats = createBattleStats();
let scoreboardRevision = -1;

function registerBattleScore(formation) {
  if (formation.player) {
    const identity = getPlayerIdentity(campaign.id);
    formation.playerName = identity.nickname; formation.historicalName = identity.unitName; formation.customIdentity = identity.custom;
  } else if (formation.team === 'friendly') {
    formation.historicalName = friendlyAIFormationName(campaign.id, getPlayerIdentity(campaign.id).unitName, formation.index);
  }
  formation.scoreLabel = campaignUnitName({ ...formation, campaign: campaign.id });
  battleStats.register(formation);
}

function renderSquadScores(container = $('squad-score-table')) {
  const scoreboard = container === $('squad-score-table');
  if (scoreboard && ($('scoreboard').hidden || scoreboardRevision === battleStats.revision)) return;
  container.replaceChildren();
  for (const team of ['friendly', 'enemy']) {
    const section = document.createElement('section'); section.className = `score-team ${team}`;
    const caption = document.createElement('div'); caption.className = 'score-team-caption';
    caption.textContent = team === 'friendly' ? '我军' : '日军'; section.append(caption);
    const scroll = document.createElement('div'); scroll.className = 'score-table-wrap';
    const table = document.createElement('table'); table.className = 'score-team-table';
    table.setAttribute('aria-label', `${caption.textContent}各小队击杀`);
    const head = document.createElement('thead'), heading = document.createElement('tr');
    for (const [kind, title] of [['squad', '玩家／小队'], ['total', '总击杀'], ...KILL_COLUMNS, ['destroyed', '毁车']]) {
      const cell = document.createElement('th'); cell.scope = 'col'; cell.title = title; cell.setAttribute('aria-label', title);
      cell.dataset.stat = kind; cell.append(scoreIcon(kind)); heading.append(cell);
    }
    head.append(heading); table.append(head);
    const body = document.createElement('tbody');
    const rows = battleStats.snapshot.filter(row => row.team === team).sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    for (const [rank, row] of rows.entries()) {
      const line = document.createElement('tr'), label = document.createElement('th');
      const current = entities.units.get(entities.control.unitId);
      if (row.player || row.unitId === current?.id && row.squadId === (current.squadId ?? current.id)) line.className = 'controlled';
      label.scope = 'row'; label.setAttribute('aria-label', row.player ? `${row.name} · ${row.unitName}` : row.name);
      const number = document.createElement('span'); number.className = 'score-rank'; number.textContent = String(rank + 1);
      label.append(number, document.createTextNode(row.player ? `${row.name} · ${row.unitName}` : row.name.replace(/^(我方|日军)/, '').replace(/\s+(\d+)$/, '$1')));
      label.title = row.player ? '玩家及直属小队累计击杀，跨兵种和重生保留。' : campaignUnitDescription(row.name); line.append(label);
      for (const value of [row.total, ...KILL_COLUMNS.map(([key]) => row.kills[key]), row.vehicles]) {
        const cell = document.createElement('td'); cell.textContent = String(value);
        if (!value) cell.className = 'score-zero';
        line.append(cell);
      }
      body.append(line);
    }
    table.append(body); scroll.append(table); section.append(scroll); container.append(section);
  }
  if (scoreboard) scoreboardRevision = battleStats.revision;
}

function renderCasualtyStats(container) {
  if (container.dataset.revision === String(battleStats.revision)) return;
  const table = document.createElement('table'); table.className = 'casualty-table';
  const head = document.createElement('thead'), heading = document.createElement('tr');
  for (const label of ['阵营', '累计参战', '阵亡', '负伤存活', '未伤存活']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; heading.append(cell);
  }
  head.append(heading); table.append(head);
  const body = document.createElement('tbody');
  for (const row of battleStats.casualtySummary) {
    const line = document.createElement('tr'); line.dataset.team = row.team;
    for (const value of [row.team === 'friendly' ? '我军' : '日军', row.deployed, row.killed, row.wounded, row.unhurt]) {
      const cell = document.createElement('td'); cell.textContent = String(value); line.append(cell);
    }
    body.append(line);
  }
  table.append(body); container.replaceChildren(table); container.dataset.revision = String(battleStats.revision);
}
const boundaryStates = new Map();
const simulationClock = createSimulationClock(performance.now());
const stepWorkBudget = createAdaptiveStepBudget();
const activeStates = new Set(['playing', 'transferring', 'dead']);
const gameStates = new Set(['menu', 'playing', 'transferring', 'dead', 'pause', 'victory', 'defeat', 'draw']);
let pausedFrom = 'playing';
let battleRandom = benchmark ? seededRandom(benchmark.seed) : Math.random;

const $ = id => document.getElementById(id);
const missionBriefing = createMissionBriefing($('mission-briefing'));
if (sihangCampaignMode) {
  document.title = '上海四行仓库 1937 · 山河 1931-1945';
  $('game-title').textContent = '上海四行仓库 1937';
  document.querySelector('.map-description').textContent = '';
  document.querySelector('.map-description').hidden = true;
  $('deploy').querySelector('span:first-child').textContent = '进入四行仓库';
  document.querySelector('.deployment-note').textContent = '';
  document.querySelector('.deployment-note').hidden = true;
  for (const button of document.querySelectorAll('#squad-choices [data-type]')) button.hidden = button.dataset.type !== 'infantry';
}
if (nanjingCampaignMode) {
  $('hud').classList.add('nanjing-campaign');
  document.title = '南京保卫战 · 山河 1931-1945';
  $('game-title').textContent = '南京保卫战';
  document.querySelector('.map-description').textContent =
    '独立南京战场布局：精简为两道内瓮城、三重城门，保留护城河石桥、中华门防线与上新河渡口。先坚守3分钟，再掩护百姓登船并守住渡口3分钟。复用现有人物、武器和战斗系统，不复用台儿庄地图。';
  $('deploy').querySelector('span:first-child').textContent = '进入南京战役';
  document.querySelector('.deployment-note').innerHTML = '我方3支小队 <span>·</span> 日军10支小队 <span>·</span> 两阶段撤离战役';
  for (const button of document.querySelectorAll('#squad-choices [data-type]')) {
    if (button.dataset.type !== 'infantry') button.hidden = true;
  }
}
const canvas = $('world');
let fatal = false;
let readFailureContext = () => ({ state: 'loading' });
let stopAfterFailure = () => {
  playerInput.block();
  if (document.pointerLockElement) document.exitPointerLock();
};
const fatalReporter = createFatalReporter({ document, window,
  build: { ...buildStamp, development: import.meta.env.DEV },
  getContext: () => readFailureContext(),
  onFatal: () => { fatal = true; stopAfterFailure(); },
  onRecorded: (error, details) => {
    if (error instanceof Error) {
      performanceDiagnostics.runtimeError(error, details);
      if (!details.recovered) performanceDiagnostics.flush('ended');
    }
  },
});
const preferences = getPlayerPreferences();
let preferenceValues = preferences.snapshot;
const startupResources = startupResourceProfile(new URLSearchParams(location.search).get('resources') ??
  'auto', navigator.deviceMemory ?? null);
const textureBudget = createStartupTextureBudget(startupResources);
const recordRecoveredFailure = (error, context) => {
  fatalReporter.recordRecovery(error, context);
  if (context.stage === 'native-gait') performanceDiagnostics.error('pose-recovered');
};
const dadaoViewRecovery = createPresentationRecovery(recordRecoveredFailure);
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb7b6af, .0035);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .07, 650);
camera.rotation.order = 'YXZ';
scene.add(camera);
const aiDecisionView = createPresentationView(camera);
const aiDecisions = createAIDecisionScheduler({ pathBudgetMs: 3 });
const adaptiveAI = createAdaptiveAI();
const squadRoutes = createSquadRoutes((x, z, y) => world.walkHeight(x, z, y));
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !startupResources.lowMemory, powerPreference: 'high-performance' });
} catch (error) {
  fatalReporter.show(error, { stage: 'webgl-renderer' });
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, startupResources.lowMemory ? .6 : 1.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !startupResources.lowMemory;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
window.__attachRenderTimingProbe?.(renderer);
const frameWork = createFrameWork({ gl: renderer.getContext(), warn(message) {
  console.warn(message);
  performanceDiagnostics.runtimeError(new Error(message), { recovered: true, stage: 'battle' });
} });
window.__attachRenderPassTimingProbe?.(renderer);
if (import.meta.env.DEV) window.__attachRenderWorkProbe?.(renderer);
const hemisphere = new THREE.HemisphereLight(0xc3d3e1, 0x766651, .6);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffefd5, 2.5);
sun.position.set(-55, 70, 38);
sun.castShadow = true;
configureSunShadow(sun);
scene.add(sun);
let surface;
try {
  setLoadingProgress(5, '第一阶段 · 加载已选战场的地形与建筑材质…');
  reportLoading('scene-materials');
  surface = await loadSceneMaterials(renderer, scene, { textureBudget, lowMemory: startupResources.lowMemory });
  setLoadingProgress(35, '第二阶段 · 加载战局所需枪械与装备…');
  await setModelSurfaces(surface, renderer.capabilities.getMaxAnisotropy(), textureBudget);
  setLoadingProgress(45, '第二阶段 · 准备近战装备材质…');
  await loadDadaoSurfaces(renderer.capabilities.getMaxAnisotropy(), new THREE.TextureLoader(), textureBudget);
  setLoadingProgress(55, '正在构建战场与双方部队…');
} catch (error) {
  fatalReporter.show(error, { stage: 'scene-materials' });
  throw error;
}
const campaign = campaignById(new URLSearchParams(location.search).get('campaign') ?? 'taierzhuang-streets');
if (campaign.locked) throw new RangeError('该战场等待设计图，当前不可进入');
const encirclementMode = !benchmark && campaign.id === 'taierzhuang-fort';
const battleLayout = nanjingCampaignMode ? { campaign: 'nanjing' } : benchmark ? {} : campaignLayout(campaign.id);
const world = makeWorld(scene, surface, battleLayout);
let sihangEnemyPosts = null;
const staticRescue = nanjingCampaignMode ? createStaticSceneBatchRescue(scene, { protectedMeshes: world.solids }) : null;
if (nanjingCampaignMode) for (const aircraft of world.aircraft) aircraft.visible = false;
const emplacementSpecs = sihangCampaignMode ? SIHANG_EMPLACEMENTS : nanjingCampaignMode ? NANJING_EMPLACEMENTS : [];
const emplacements = new Map(emplacementSpecs.map(spec => {
  const point = createEmplacement(spec), model = createEmplacementModel(point);
  model.position.y = point.altitude ?? world.groundHeight(point.x, point.z);
  scene.add(model); model.traverse(object => { if (object.isMesh) world.solids.push(object); });
  if (sihangCampaignMode && point.id.startsWith('sihang-north-gate-'))
    world.obstacles.push(...emplacementObstacles(point));
  point.view = model;
  return [point.id, point];
}));
const sihangCombat = sihangCampaignMode ? createSihangCombat(scene, world) : null;
if (sihangCampaignMode) addSihangBridgeDefenses(scene, world, SIHANG_EMPLACEMENTS.filter(point => point.retreatCover));
const sihangNight = sihangCampaignMode ? createSihangNight(scene, sun, hemisphere, camera) : null;
let sihangSupportContext = null;
let solidIndex = createSolidIndex(world.solids);
const occluded = createOcclusionQuery();
const closestHit = createClosestHitQuery();
const grenadeSupport = createGrenadeSupport(world.solids, world.groundHeight, (point, radius) =>
  !world.doorSystem.doors.some(door => Math.hypot(point.x - door.x, point.z - door.z) < door.width * 2 + radius + .1) &&
  ![...entities.vehicles.values()].some(vehicle =>
    Math.hypot(point.x - vehicle.position.x, point.z - vehicle.position.z) < (vehicle.type === 'plane' ? 15 : 5) + radius));
const soldierRenderer = createSoldierRenderer(scene, camera, sihangCampaignMode ? 192 : nanjingCampaignMode ? 5 * TYPES.infantry.members + 8 * TYPES.infantry.members + 5
  : BATTLE_RULES.unitsPerTeam * TYPES.infantry.members + TYPES.infantry.members);
const vehicleRenderer = createVehicleRenderer(scene);
let nraCharacter = null;
let ijaCharacter = null;
const uniformExcludedIds = new Set();
if (new URLSearchParams(location.search).get('character') !== 'procedural') {
  try {
    setLoadingProgress(60, '第三阶段 · 加载我军士兵与人物动作…');
    reportLoading('friendly-model');
    const { loadNraCharacter } = await import('./nra-character.js');
    const { createNraForceRendererAsync } = await import('./nra-force-renderer.js');
    const nraTemplate = await loadNraCharacter(world.walkHeight, { textureBudget, onPoseRecovery: recordRecoveredFailure });
    reportLoading('friendly-poses');
    nraCharacter = await createNraForceRendererAsync(scene, camera, nraTemplate, 330, {
      lowMemory: startupResources.lowMemory,
      onProgress: ({ completed, total }) =>
        setLoadingProgress(Math.floor(62 + 16 * completed / total), `第三阶段 · 准备我军人物动作 ${completed}/${total}…`),
    });
    setLoadingProgress(80, '第三阶段 · 加载日军士兵与人物动作…');
    reportLoading('enemy-model');
    const { loadIjaCharacter, createIjaForceRendererAsync } = await import('./ija-character.js');
    const ijaTemplate = await loadIjaCharacter(world.walkHeight, { textureBudget, onPoseRecovery: recordRecoveredFailure });
    reportLoading('enemy-poses');
    ijaCharacter = await createIjaForceRendererAsync(scene, camera, ijaTemplate, 330, {
      lowMemory: startupResources.lowMemory,
      onProgress: ({ completed, total }) =>
        setLoadingProgress(Math.floor(81 + 8 * completed / total), `第三阶段 · 准备日军人物动作 ${completed}/${total}…`),
    });
    setLoadingProgress(90, '正在准备人物呈现与战场入口…');
  } catch (error) {
    fatalReporter.show(error, { stage: 'character-loading' });
    throw error;
  }
}
const sihangParade = sihangCampaignMode
  ? nraCharacter ? nraCharacter.createStaticFormation(40) : createProceduralStaticFormation(scene) : null;
let sihangParadeSerial = 0;
const actorGrid = new SpatialGrid();
const trafficGrid = new SpatialGrid();
const trafficReservations = new Map();
const soldierHits = createSoldierHitSystem((actor, now) => {
  const character = actor.friendly ? nraCharacter : ijaCharacter;
  if (!character) throw new Error('Native soldier has no anatomical pose factory');
  return character.sampleAnatomy(actor, now);
});
const bodyRay = new THREE.Raycaster();
const groundCollision = obstacleLookup(world.obstacles, 2.5, 4);
const aircraftCollision = createAircraftObstacleLookup(world.obstacles);
const engineerWorks = [];
let engineerPlanBudget = 2;
const engineerPreviews = new Map(ENGINEER.profiles.map(profile => {
  const point = createEmplacement({ id: `preview-${profile}`, profile, x: 0, z: 0, heading: 0 });
  const model = createEmplacementModel(point);
  model.traverse(node => {
    if (!node.isMesh) return;
    node.material.transparent = true; node.material.opacity = .3; node.material.depthWrite = false;
    node.castShadow = false;
  });
  model.visible = false; scene.add(model);
  return [profile, { point, model }];
}));
const engineerTool = nraCharacter ? createEngineerTool(nraCharacter.createGrenadeHand) : weaponModel('hammer');

function selectedToolModel(actor) {
  return actor.engineer ? engineerTool : weaponModel('mortar');
}

function refreshEngineerObstacles(bounds) {
  squadRoutes.clear();
  groundCollision.rebuild(); aircraftCollision.rebuild();
  world.refreshNavigation?.([bounds]);
  refreshBattleNavigation([bounds]);
  if (nanjingCampaignMode) {
    world.civilianNavigate.refresh(bounds); civilianNavigationLookup.rebuild(); civilianCrowdPlanner.invalidate();
  }
}

const ENGINEER_FRIENDLY_OCCUPIED = '队员占据建造空间';

function engineerPlacementReason(actor, position) {
  const selected = actor.engineer.selected;
  if (!actor.engineer.materials[selected]) return '此类阵地的材料已用完，按R切换另一类';
  if (actor.traversal.kind !== 'grounded') return '落地后才能建造';
  const heading = actor.engineer.heading ?? actor.heading;
  const bounds = engineerObstacle('preview', position, heading, selected);
  if (sihangCampaignMode && Math.abs(position.y) > .025 &&
    !(sihangBridgeContains(position) && Math.abs(position.y - world.groundHeight(position.x, position.z)) <= .025))
    return '四行仓库的机枪与火炮阵地只能在一楼或室外地面建造';
  if (sihangCampaignMode && SIHANG_STAIRWELLS.some(stair =>
    bounds.minX < stair.maxX && bounds.maxX > stair.minX &&
    bounds.minZ < stair.maxZ && bounds.maxZ > stair.minZ)) return '楼梯及其出口不能设置阵地';
  if (sihangCampaignMode && sihangSouthBank(position)) return '南岸租界不设置战斗工事';
  if (sihangCampaignMode && SIHANG_RESERVED_LANES.some(lane =>
    lane.id !== 'warehouse-south-quay' && !lane.id.startsWith('retreat-') &&
    bounds.minX < lane.maxX && bounds.maxX > lane.minX && bounds.minZ < lane.maxZ && bounds.maxZ > lane.minZ))
    return '装甲或爆破通路不能设置阵地';
  if (nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage) && !actor.playerUnit &&
    bounds.minX < NANJING_DOCK_BUFFER.maxX && bounds.maxX > NANJING_DOCK_BUFFER.minX &&
    bounds.minZ < NANJING_DOCK_BUFFER.maxZ && bounds.maxZ > NANJING_DOCK_BUFFER.minZ) return '候船区不能设置AI阵地';
  if (bounds.minX < battleArea.minX + .5 || bounds.maxX > battleArea.maxX - .5 ||
    bounds.minZ < battleArea.minZ + .5 || bounds.maxZ > battleArea.maxZ - .5) return '建造位置超出战区';
  const candidates = new Set();
  for (const x of [bounds.minX, bounds.cx, bounds.maxX]) for (const z of [bounds.minZ, bounds.cz, bounds.maxZ])
    for (const obstacle of movementObstacles(x, z)) candidates.add(obstacle);
  for (const reservation of engineerConstructionReservations(actor, actorGrid.near(position.x, position.z, 8)))
    candidates.add(reservation);
  if ([...candidates].some(obstacle => engineerFootprintBlocked(bounds, obstacle))) return '阵地所需空间受阻';
  const supports = selected === 'bofors75' ? [[-.95, 0], [.95, 0], [-.95, 1.9], [.95, 1.9], [0, -.65], [0, 1.02]]
    : [[-1.5, -.7], [0, -.7], [1.5, -.7], [-1.5, .7], [1.5, .7], [0, .76]];
  for (const [x, z] of supports) {
    const px = position.x + x * Math.cos(heading) + z * Math.sin(heading);
    const pz = position.z - x * Math.sin(heading) + z * Math.cos(heading);
    if (Math.abs(world.walkHeight(px, pz, position.y) - position.y) > .1 ||
      world.stairAt?.({ x: px, y: position.y, z: pz })) return '阵地需要平坦、非楼梯的支撑面';
  }
  let friendlyOccupied = false;
  for (const other of allForces) {
    if (other === actor || other.health <= 0 || other.vehicleId ||
      Math.abs(other.position.y - position.y) >= 1.5 ||
      !circleBlocked(other.position.x, other.position.z, .45, [bounds], other.position.y)) continue;
    if (other.team !== actor.team) return '敌军占据建造空间';
    friendlyOccupied = true;
  }
  if (friendlyOccupied) return ENGINEER_FRIENDLY_OCCUPIED;
  return null;
}

function updateEngineerConstruction(actor, dt, holding = held.primary, candidate = null) {
  const equipment = actor.engineer, construction = equipment.construction;
  if (actor === controlledSoldier(entities) && !construction.site && !holding) equipment.heading = null;
  candidate ??= engineerPlacement(actor.position, equipment.heading ?? controlPose.yaw);
  candidate.y = world.walkHeight(candidate.x, candidate.z, actor.position.y);
  const unfinished = !construction.site && findEngineerConstruction(equipment, actor.id, actor.position, candidate);
  if (unfinished && !holding) {
    candidate = { ...unfinished.site };
    equipment.heading = unfinished.heading;
  }
  if (holding) resumeEngineerConstruction(equipment, actor.id, actor.position, candidate);
  const previous = { ...construction };
  const previousHeading = equipment.heading;
  const result = advanceConstruction(construction, { builderId: actor.id, position: actor.position,
    candidate, holding, buildSeconds: ENGINEER.buildSeconds,
    pauseOnReason: ENGINEER_FRIENDLY_OCCUPIED,
    allowed: actor.health > 0 && !actor.vehicleId &&
      (actor !== controlledSoldier(entities) || state === 'playing' && toolEquipped) },
    dt, point => engineerPlacementReason(actor, point));
  if (!result.completed && previous.site && construction.site !== previous.site) {
    const heading = equipment.heading;
    equipment.heading = previousHeading;
    rememberEngineerConstruction(equipment, previous);
    equipment.heading = heading;
  }
  if (result.notice === 'moved') toast('施工已中断，返回原处可继续');
  if (!result.completed) return;
  const spec = engineerBuiltSpec(actor, result.completed.position, equipment.heading ?? actor.heading);
  const point = createEmplacement(spec), model = createEmplacementModel(point), meshes = [];
  model.position.y = spec.altitude; scene.add(model); model.updateMatrixWorld(true);
  model.traverse(node => { if (node.isMesh) {
    node.userData.dynamicCollision = true; meshes.push(node); world.solids.push(node); solidIndex.addDynamic(node);
  } });
  point.view = model;
  registerWeapon(entities, point.weapon, `${point.id}:weapon`, point.id, point.weapon.type);
  emplacements.set(point.id, point);
  const obstacles = engineerColliders(spec);
  world.obstacles.push(...obstacles);
  if (nanjingCampaignMode && world.civilianNavigationObstacles !== world.obstacles)
    world.civilianNavigationObstacles.push(...obstacles);
  engineerWorks.push({ point, model, meshes, obstacles, builderId: actor.id });
  consumeEngineerMaterial(equipment, spec.profile, spec.id);
  equipment.site = equipment.heading = null;
  if (actor === controlledSoldier(entities)) {
    playerInput.clearFire();
    for (const preview of engineerPreviews.values()) preview.model.visible = false;
    toast(`${spec.profile === 'bofors75' ? '火炮' : '机枪'}阵地建成 · 按F操作，R切换另一类建造`);
  }
  const bounds = engineerObstacle(spec.id, result.completed.position, spec.heading, spec.profile);
  refreshEngineerObstacles(bounds);
}

function clearEngineerWorks() {
  for (const work of engineerWorks) {
    for (const actor of allForces) if (actor.emplacementId === work.point.id || actor.tactics.stationId === work.point.id)
      releaseEmplacement(actor, false);
    entities.weapons.delete(work.point.weapon.id); emplacements.delete(work.point.id); scene.remove(work.model);
    for (const mesh of work.meshes) {
      solidIndex.removeDynamic(mesh);
      const index = world.solids.indexOf(mesh); if (index >= 0) world.solids.splice(index, 1);
      if (mesh.isInstancedMesh) mesh.dispose();
    }

    for (const obstacle of work.obstacles) for (const list of [world.obstacles,
      ...(nanjingCampaignMode && world.civilianNavigationObstacles !== world.obstacles ? [world.civilianNavigationObstacles] : [])]) {
      const index = list.indexOf(obstacle); if (index >= 0) list.splice(index, 1);
    }
  }
  if (engineerWorks.length) {
    squadRoutes.clear();
    groundCollision.rebuild(); aircraftCollision.rebuild();
    const regions = engineerWorks.flatMap(work => work.obstacles);
    world.refreshNavigation?.(regions);
    refreshBattleNavigation(regions);
    if (nanjingCampaignMode) {
      for (const region of regions) world.civilianNavigate.refresh(region);
      civilianNavigationLookup.rebuild(); civilianCrowdPlanner.invalidate();
    }
  }
  engineerWorks.length = 0;
  for (const preview of engineerPreviews.values()) preview.model.visible = false;
}

function sihangWaveCover(actor) {
  const wave = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && sihangCampaign.withdrawalWave;
  return Boolean(wave && wave.phase === 'main' && wave.covering && actor.friendly && !actor.playerUnit &&
    actor.formation.sihangSlot === wave.coverSlot && wave.squads[wave.coverSlot].includes(actor.id));
}

function activateSihangWaveCover(actor) {
  const wave = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && sihangCampaign.withdrawalWave;
  if (!wave || wave.phase !== 'main' || wave.covering || !actor.friendly ||
    !actor.playerUnit && !wave.squads.some(ids => ids.includes(actor.id))) return;
  if (wave.squads[wave.coverSlot].some(id => {
    const member = entities.soldiers.get(id);
    return member?.health > 0 && !member.sihangEvacuated;
  })) wave.covering = true;
}

function operateAIEngineer(actor, dt, combatTarget = null) {
  const equipment = actor.engineer;
  const retreatCover = sihangWaveCover(actor);
  if (!equipment || actor.playerUnit || actor.vehicleId || actor.emplacementId || !equipment.kits || combatTarget ||
    actor.traversal.kind !== 'grounded' || actor.grenades.action || time < actor.tactics.suppressedUntil ||
    sihangCampaignMode && (sihangCampaign.stage !== 'sihang-defense' && !retreatCover || actor.tactics.sihangDuty === 'wall-fire' && !retreatCover ||
      !actor.friendly && sihangCampaign.northWallBreached) ||
    nanjingCampaignMode && !['gate-defense', 'dock-defense'].includes(nanjingCampaign.stage) ||
    nanjingCampaignMode && nanjingCampaign.stage === 'gate-defense' && nanjingCoreGuard(actor) ||
    encirclementMode && encirclement.phase !== 1) {
    if (equipment?.construction.mode === 'building') cancelEngineer(equipment);
    return false;
  }
  const objective = formationObjective(actor, objectives[0]);
  if (!objective || Math.hypot(actor.position.x - objective.x, actor.position.z - objective.z) > 55 ||
    actorGrid.near(actor.position.x, actor.position.z, 18).some(other =>
      other.team !== actor.team && other.health > 0 && Math.hypot(other.position.x - actor.position.x,
        other.position.z - actor.position.z) < 18)) {
    cancelEngineer(equipment); return false;
  }
  if (sihangCampaignMode && (Math.abs(actor.position.y) > .025 || world.stairAt(actor.position))) {
    cancelEngineer(equipment);
    actor.target = null; actor.rifleReady = false;
    cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'engineering-ground-floor');
    actor.stance = 'standing'; actor.firingPose = null;
    walkActor(actor, { x: objective.x, y: 0, z: objective.z, transit: true }, 2.4, dt);
    actor.tactics.mode = 'engineer-descend';
    return true;
  }
  if (!equipment.site) {
    if (time < equipment.planAt || engineerPlanBudget <= 0) return false;
    engineerPlanBudget--; equipment.planAt = time + 2;
    equipment.selected = equipment.materials.maxim24 ? 'maxim24' : 'bofors75';
    equipment.heading = Math.atan2(actor.position.x - objective.x, actor.position.z - objective.z);
    const center = engineerPlacement(actor.position, equipment.heading);
    for (const offset of [0, 4.8, -4.8]) {
      const candidate = { x: center.x + Math.cos(equipment.heading) * offset, y: actor.position.y,
        z: center.z - Math.sin(equipment.heading) * offset };
      candidate.y = world.walkHeight(candidate.x, candidate.z, actor.position.y);
      if (!engineerPlacementReason(actor, candidate) &&
        (!sihangSupportContext || actor.friendly || sihangCoverMovementAllowed(actor.position, candidate, sihangSupportContext))) {
        equipment.site = candidate; break;
      }
    }
    if (!equipment.site) { equipment.heading = null; return false; }
  }
  const site = equipment.site;
  const goal = { x: site.x + Math.sin(equipment.heading) * ENGINEER.reach, y: site.y,
    z: site.z + Math.cos(equipment.heading) * ENGINEER.reach };
  cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'engineering');
  actor.rifleReady = false; actor.tactics.mode = 'build-emplacement';
  if (Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) > .3 ||
    Math.abs(actor.position.y - goal.y) > .25) {
    actor.stance = 'standing'; actor.firingPose = null;
    walkActor(actor, goal, 2.4, dt); return true;
  }
  stopLocomotion(actor.locomotion);
  actor.stance = 'crouched'; actor.firingPose = 'kneeling';
  actor.heading = equipment.heading;
  if (!equipment.construction.blueprint) selectConstructionBlueprint(equipment.construction, actor.id);
  updateEngineerConstruction(actor, dt, true, { ...site });
  return true;
}

function applyEmplacementDamage(point, amount, source) {
  const applied = damageEmplacement(point, amount, source, time);
  if (!applied) return;
  combatEvents.publish('damage', { source, amount: applied, health: point.health,
    target: { kind: 'emplacement', id: point.id, team: point.team,
      unitId: point.builderUnitId ?? `fixed-${point.id}`,
      name: point.profile === 'bofors75' ? '炮兵阵地' : '机枪阵地' } }, time);
  if (point.health > 0) return;
  for (const actor of allForces) if (actor.emplacementId === point.id || actor.tactics.stationId === point.id) {
    actor.artilleryThreat = false; releaseEmplacement(actor);
  }
  point.view.traverse(node => {
    if (!node.isMesh || !node.material.color) return;
    node.material.color.setHex(0x292723); node.material.emissive?.setHex(0);
  });
  if (point.team === 'friendly') toast(`${point.profile === 'bofors75' ? '炮兵' : '机枪'}阵地已被摧毁`);
}
const civilianCrowdPlanner = createCivilianCrowdPlanner();
const civilianNavigationLookup = nanjingCampaignMode ? obstacleLookup(world.civilianNavigationObstacles, .8) : null;
const movementCollision = createMovementObstacles(groundCollision, entities.vehicles, vehicleCollider);
const daylight = createDaylight(scene, sun, hemisphere, scene.fog);
const combatEffects = createCombatEffects(scene, camera, world.groundHeight);
const grenadeRenderer = createGrenadeRenderer(scene, camera, nraCharacter?.createGrenadeHand);
const weaponHands = nraCharacter ? createWeaponHands(nraCharacter.createWeaponHand) : null;
const supportViewHands = nraCharacter ? createSupportViewHands(nraCharacter.createWeaponHand, {
  applyAppearance(root, actor) {
    const officer = isNativeOfficer(actor);
    root.traverse(node => node.setOfficerAppearance?.(officer));
  },
}) : null;
if (supportViewHands) scene.add(supportViewHands.root);
const supportActorFrame = new THREE.Object3D();

function updateSupportGripMarkers() {
  for (const actor of allForces) {
    const point = emplacements.get(actor.emplacementId);
    const tube = actor.discharger;
    const tubeActive = tube?.presentationActive && actor.tactics.mode === 'operate-grenade-discharger';
    const model = point?.operatorId === actor.id ? point.view
      : tubeActive ? dischargerViews.get(actor.id) : null;
    if (!model || actor.health <= 0 || actor.vehicleId || actor.traversal.kind !== 'grounded') {
      actor.supportWeaponPose = null; continue;
    }
    const phase = point ? point.position === 'march' ? 'march' : point.weapon.reloadUntil > 0 ? 'loading' : 'operate'
      : tube.phase === 'ready' && time < tube.nextShot - 4.8 ? 'loading' : 'operate';
    supportActorFrame.position.copy(actor.position); supportActorFrame.rotation.set(0, actor.heading, 0);
    supportActorFrame.updateMatrixWorld(true);
    const supportTarget = tubeActive ? entities.soldiers.get(tube.targetId) : null;
    const targetEye = supportTarget ? soldierEyePosition(supportTarget) : null;
    const ownEye = tubeActive ? soldierEyePosition(actor) : null;
    const gazePitch = targetEye ? Math.atan2(targetEye.y - ownEye.y,
      Math.hypot(targetEye.x - ownEye.x, targetEye.z - ownEye.z)) : 0;
    actor.supportWeaponPose = { active: true, kind: point?.profile ?? 'type89', phase,
      pitch: point?.pitch ?? 0, gazePitch, targets: supportWeaponTargets(model, supportActorFrame, phase) };
  }
}
const graphics = createQualitySettings({ renderer, scene, sun, smoke: world.smoke, grain: document.querySelector('.grain'),
  initialPreset: preferenceValues.quality.preset, initialEffects: preferenceValues.quality.effects,
  initialAutomaticLevel: preferenceValues.startupQualityLevel,
  lowMemory: startupResources.lowMemory, reducedSmokeAtLevel2: nanjingCampaignMode });
const automaticQuality = createAdaptiveQuality({ initialLevel: preferenceValues.startupQualityLevel, onChange({ level, reason }) {
  performanceDiagnostics.checkpoint();
  if (['pressure', 'backlog', 'recovery', 'manual'].includes(reason) &&
    preferences.snapshot.startupQualityLevel !== level) preferences.update({ startupQualityLevel: level });
  if (preferences.status.problem) syncPreferenceControls();
  graphics.setAutomaticLevel(level);
  syncQualityControls();
} });
const endingNarration = {}, endingNarrationFailures = {};
let endingVoice = null, endingPageHeight = 0;
const endingCampaign = sihangCampaignMode ? 'sihang' : nanjingCampaignMode ? 'nanjing' : 'taierzhuang-fort';
const battleEnding = createBattleEnding({
  onBlack() {
    endingVoice?.stop(); endingVoice = null;
    setGameState('pause'); releaseMouse();
    getEndingMusic().setState('history');
    performanceDiagnostics.suspend('pause');
    $('battle-ending').hidden = false;
    const history = BATTLE_HISTORY[endingCampaign], page = $('battle-ending-page');
    page.replaceChildren();
    const title = document.createElement('h2'); title.textContent = history.title; page.append(title);
    const date = document.createElement('p'); date.className = 'battle-ending-date'; date.textContent = history.date; page.append(date);
    for (const [heading, text] of history.sections) {
      const h = document.createElement('h3'), p = document.createElement('p');
      h.textContent = heading; p.textContent = text; page.append(h, p);
    }
    const sources = document.createElement('p'); sources.className = 'battle-ending-sources';
    for (const [label, url] of history.sources) {
      const link = document.createElement('a'); link.textContent = label; link.href = url;
      link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
    }
    page.append(sources); page.hidden = false;
    page.style.fontSize = '';
    const height = page.scrollHeight, available = innerHeight - 85;
    if (height > available)
      page.style.fontSize = `${Math.max(12, parseFloat(getComputedStyle(page).fontSize) * available / height)}px`;
    endingPageHeight = page.scrollHeight;
  },
  onFinish(kind) { $('battle-ending').hidden = true; showOverlay(kind); },
});
for (const outcome of ['victory', 'defeat', 'draw'])
  void loadEndingNarration(endingCampaign, outcome).then(buffer => { endingNarration[outcome] = buffer; }).catch(error => {
    endingNarrationFailures[outcome] = error.message;
    console.warn(`战役结尾${outcome}旁白暂不可用：`, error);
  });
$('battle-ending-continue').addEventListener('click', () => battleEnding.finish());
const navigate = createNavigator(world.doorSystem.navigationObstacles);
if (nanjingCampaignMode) world.setGroundNavigation(navigate, movementObstacles);
const armorNavigate = createTankNavigation(world.armorObstacles ?? world.obstacles);
const dockNavigationObstacles = nanjingCampaignMode ? [...world.doorSystem.navigationObstacles, NANJING_DOCK_BUFFER] : null;
const dockNavigate = dockNavigationObstacles ? createNavigator(dockNavigationObstacles) : null;
const dockArmorObstacles = nanjingCampaignMode ? [...(world.armorObstacles ?? world.obstacles), NANJING_DOCK_BUFFER] : null;
const dockArmorNavigate = dockArmorObstacles ? createTankNavigation(dockArmorObstacles) : null;
function refreshBattleNavigation(regions) {
  navigate.refreshMany(regions); armorNavigate.refreshMany(regions);
  if (dockNavigate) {
    dockNavigationObstacles.splice(0, dockNavigationObstacles.length, ...world.doorSystem.navigationObstacles, NANJING_DOCK_BUFFER);
    dockArmorObstacles.splice(0, dockArmorObstacles.length, ...(world.armorObstacles ?? world.obstacles), NANJING_DOCK_BUFFER);
    dockNavigate.refreshMany(regions); dockArmorNavigate.refreshMany(regions);
  }
}
world.doorSystem.onNavigationChanged = (bounds, regions = [bounds]) => {
  squadRoutes.clear();
  refreshBattleNavigation(regions); groundCollision.rebuild(); aircraftCollision.rebuild();
  civilianCrowdPlanner.invalidate(); civilianNavigationLookup?.rebuild();
};
world.doorSystem.onRequested = door => controlEvents.publish('door.requested', { doorId: door.id, opening: door.targetAngle !== 0,
  position: { x: door.x, y: world.groundHeight(door.x, door.z) + door.height / 2, z: door.z } }, time);
const ray = new THREE.Raycaster();
const vector = new THREE.Vector3();
const direction = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const groundPlane = new THREE.Plane(up, 0);
const projectileGeometry = new THREE.SphereGeometry(.12, 6, 6);
const impactGeometry = new THREE.IcosahedronGeometry(1, 1);
const shellMaterial = new THREE.MeshBasicMaterial({ color: 0xffce70 });
const emplacedMortar = weaponModel('mortar');
emplacedMortar.visible = false;
scene.add(emplacedMortar);
const radarContext = $('radar').getContext('2d');
const keys = playerInput.keys;
const effects = [];
const tracerPool = createTracerPool();
const shells = [];
const shellViews = new Map();
const dischargerViews = new Map();
let dischargerQueryBudget = 0;
const projectileImpacts = [];
let projectileSerial = 0;
const coverClaims = new Map();
const combatSounds = [];
const rifleReports = [];
const combatStats = { aiRifleShots: 0, aiRifleShotsAtArmor: 0, aiRifleShotsAtAircraft: 0, armorThreatsObserved: 0,
  rifleAircraftCandidatesIgnored: 0, rejectedRifleArmorDamage: 0, rejectedRifleAircraftDamage: 0 };
let actorSerial = 0;
let soundSerial = 0;
let state = 'menu';
let battlePreparing = false, battleWarmup = null;
let selectedType = nanjingCampaignMode || sihangCampaignMode ? 'infantry' : document.querySelector('.squad-choice.selected')?.dataset.type ?? 'infantry';
let objectives = sihangCampaignMode ? sihangObjectives() : nanjingCampaignMode ? createNanjingObjectives() : encirclementMode ? encirclementObjectives() : makeObjectives(battleLayout.objectives);
let encirclement = createEncirclement();
let conquest = createConquest();
let nanjingCampaign = nanjingCampaignMode ? createNanjingCampaign() : null;
let sihangCampaign = sihangCampaignMode ? createSihangCampaign() : null;
function sihangEnemyTargetAllowed(actor) { return sihangTargetRule(actor, sihangCampaign); }
function sihangEnemyRayRange(origin, direction, range) { return sihangRayRule(origin, direction, range, sihangCampaign); }
function sihangProtectedSouthBank(position) {
  return sihangSouthBank(position);
}
function sihangCeasefire(actor) {
  return Boolean(sihangCampaignMode && actor && sihangSouthBank(actor.position));
}
let assaultAssignmentAt = 0;
let allies = [];
let enemies = [];
let friendlyAI = [];
let friendlyForces = [];
const corpses = new Map();
const civilianCorpses = new Map();
let corpseCleanupAt = 0;
let allForces = [];
const sihangEnemyPositions = new Set();
const nanjingEnemyPositions = new Set();
const sihangSapperPositions = new Set();
let civilianCombatTime=null,civilianCombatList=[];
let formations = [];
let aiCursor = 0;
const pathRequests = new Map();
let populationRefreshAt = 0;
let current = 0;
let unit = null;
let weapon = null;
let time = 0;
let remaining = sihangCampaignMode ? sihangCampaign.stageRemaining : nanjingCampaignMode ? nanjingCampaign.stageRemaining : MATCH_SECONDS;
let kills = 0;
let teamKills = 0;
let deployments = 0;
let recoil = 0;
const rifleRecoil = createRifleRecoil();
let toastUntil = 0;
let hudAt = 0;
let lastFrame = performance.now();
const frameTimes = [];
let audioContext;
let audioMixer = null;
let noiseBuffer;
let grenadeBlastAudio = null, grenadeFlashUntil = 0, grenadeFlashStrength = 0;
const blastFeedback = createBlastFeedback();
let blastFeedbackTime = 0;
let rifleAudio = null, rifleAudioFailure = null, audioWarningShown = false, audioUnsupported = false;
let footstepAudio = null, footstepAudioFailure = null;
let mechanicalAudio = null, mechanicalAudioFailure = null;
let battleVoices = null, battleVoicesFailure = null;
let battleSignals = null, battleSignalsFailure = null;
let tacticalAudio = null, tacticalAudioFailure = null, vehicleAudio = null, vehicleAudioFailure = null;
let civilianVoices = null, civilianVoicesFailure = null;
let sihangVoices = null, sihangVoicesFailure = null;
let battleReactions = null, battleReactionsFailure = null;
let mortarLaunch = null, mortarLaunchFailure = null, mortarLaunchesPlayed = 0;
if (sihangCampaignMode) {
  try { sihangVoices = await loadSihangVoices(); }
  catch (error) {
    sihangVoicesFailure = error.message;
    console.warn('四行仓库指挥与南岸百姓语音未加载：', error);
  }
}
if (nanjingCampaignMode) {
  try { civilianVoices = await loadCivilianVoices(); }
  catch (error) {
    civilianVoicesFailure = error.message;
    console.error('南京百姓语音未加载：', error);
  }
}
const objectiveVoiceTracker = createObjectiveVoiceTracker();
const encirclementVoiceTracker = createEncirclementVoiceTracker();
try {
  mortarLaunch = await loadMortarLaunch();
} catch (error) {
  mortarLaunchFailure = error.message;
  console.error('迫击炮发射录音未加载，将使用原合成爆声：', error);
}
try {
  rifleAudio = await loadRifleAudio();
} catch (error) {
  rifleAudioFailure = error.message;
  console.error('步枪录音未加载，将保留原合成声：', error);
}
try {
  footstepAudio = await loadFootstepAudio();
} catch (error) {
  footstepAudioFailure = error.message;
  console.error('脚步录音未加载，将保留原合成声：', error);
}
try {
  mechanicalAudio = await loadRifleMechanicalAudio();
} catch (error) {
  mechanicalAudioFailure = error.message;
  console.error('步枪机械录音未加载，将保留原合成声：', error);
}
try {
  battleVoices = await loadBattleVoices();
} catch (error) {
  battleVoicesFailure = error.message;
  console.error('战场语音未加载，喊话和指挥提示不可用：', error);
}
try {
  battleReactions = await loadBattleReactions((position, listener) =>
    !hasLine(new THREE.Vector3(position.x, position.y + 1.5, position.z), listener.position, 36));
} catch (error) {
  battleReactionsFailure = error.message;
  console.error('真人战斗反应录音未加载，短喊与受击人声不可用：', error);
}
try { battleSignals = await loadBattleSignals(); }
catch (error) {
  battleSignalsFailure = error.message;
  console.error('日军进攻哨声未加载：', error);
}
try {
  tacticalAudio = await loadTacticalFeedbackAudio({ water: typeof world.isDeepWater === 'function', ferries: Boolean(world.ferries?.length) });
} catch (error) {
  tacticalAudioFailure = error.message; console.error('弹道与场景接触音效未加载：', error);
}
try { vehicleAudio = await loadVehicleAudio(); }
catch (error) { vehicleAudioFailure = error.message; console.error('载具引擎录音未加载：', error); }
let pointerHintShown = false;
let hadPointerLock = false;
let scoreboardInteractive = false, scoreboardReturnCapture = false, scoreboardRestoring = false;
let lean = 0;
let jumpHeight = 0;
let jumpVelocity = 0;
let eyeHeight = 1.67;
let motionStrength = preferenceValues.motionStrength;
let playerFootsteps = 0;
let lastFootSurface = null;
let weaponObstruction = 0;
let obstructionBlend = 0;
let lastRifleTrace = null;
let spawnPoints = sihangCampaignMode ? sihangSpawns() : nanjingCampaignMode ? [...NANJING_SPAWNS] : encirclementMode ? encirclementSpawns() : [...makeBaseSpawns(), ...stagingSpawns()];
let spawnEvents = [];
let pendingSquad = null;
let pendingSpawn = null;
let deploymentRefreshAt = 0;
let toolEquipped = false;
let dadaoEquipped = false;
let grenadeEquipped = false;
let selectedThrowable = 'grenade';
let controlBinding = null;
readFailureContext = () => ({
  state, time, type: unit?.type ?? null, control: { ...entities.control },
  stance: controlPose.stance, position: allies[current]?.position.toArray() ?? null,
  look: { yaw: controlPose.yaw, pitch: controlPose.pitch },
  equipment: { toolEquipped, dadaoEquipped, grenadeEquipped, selectedThrowable },
  rifle: allies[current] ? { model: allies[current].rifle.model ?? 'rifle', action: allies[current].rifle.action,
    ammo: allies[current].rifle.ammo } : null,
  obstruction: weaponObstruction, obstructionBlend,
  weaponView: weapon ? { position: weapon.position.toArray(), rotation: weapon.quaternion.toArray(),
    handsVisible: weaponHands?.snapshot?.visible ?? false,
    reachLimited: weaponHands?.snapshot?.reachLimited ?? false } : null,
});
stopAfterFailure = releaseMouse;
const mortarTarget = new THREE.Vector3();
const baseSpawnViews = new Map();
for (const point of spawnPoints.filter(point => !nanjingCampaignMode && !sihangCampaignMode && !point.aiOnly && (point.kind === 'base' || point.kind === 'garage'))) {
  const model = baseSpawnModel(point.team);
  model.position.set(point.x, 0, point.z);
  scene.add(model);
  baseSpawnViews.set(point.id, model);
}

function toast(message, duration = 3) {
  $('toast').textContent = message;
  $('toast').style.opacity = '1';
  toastUntil = time + duration;
}

function setGameState(next) {
  if (!gameStates.has(next)) throw new RangeError(`Unknown game state: ${next}`);
  const active = activeStates.has(next);
  if (simulationClock.active !== active) simulationClock.setActive(active, performance.now());
  state = next;
  if (battleEnding.fading) {
    if (next === 'pause') endingVoice?.pause();
    else if (active) endingVoice?.resume();
  }
  if (next === 'menu') {
    endingVoice?.stop(); endingVoice = null; battleEnding.reset();
    $('battle-ending').hidden = true;
  }
  if (['menu', 'victory', 'defeat', 'draw'].includes(next)) automaticQuality.leaveBattle();
  getEndingMusic().setState(next);
  getMenuMusic().setState(next);
  if (['pause', 'menu', 'victory', 'defeat', 'draw'].includes(next)) {
    performanceDiagnostics.flush(['victory', 'defeat', 'draw'].includes(next) ? 'ended' : 'pause');
  }
  battleVoices?.sync(['playing', 'transferring', 'dead', 'victory', 'defeat', 'draw'].includes(state));
  civilianVoices?.sync(['playing', 'transferring'].includes(state));
  sihangVoices?.sync(active && !battleEnding.fading);
  battleReactions?.sync(['playing', 'transferring', 'dead'].includes(state));
  battleSignals?.sync(enemySignalsEnabled(active, nanjingCampaignMode ? nanjingCampaign?.stage ?? null : null));
  tacticalAudio?.sync(activeStates.has(state)); vehicleAudio?.sync(activeStates.has(state));
  if (!activeStates.has(state) || state === 'transferring') {
    grenadeBlastAudio?.reset(); blastFeedback.reset(); blastFeedbackTime = time;
    grenadeFlashUntil = grenadeFlashStrength = 0;
    canvas.style.filter = '';
  }
  footstepAudio?.sync(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  syncMechanicalAudio();
}

function mechanicalPlayback() {
  const actor = controlledSoldier(entities);
  const owner = controlOwner(entities);
  return { owner, playing: Boolean(state === 'playing' && actor?.health > 0 &&
    !actor.vehicleId && actor.groundType === 'infantry' && !toolEquipped && !dadaoEquipped && !grenadeEquipped && owner.weaponId === actor.rifle?.id) };
}

function syncMechanicalAudio() {
  const { owner, playing } = mechanicalPlayback();
  mechanicalAudio?.sync(owner, playing);
}

function sound(kind) {
  if (!audioContext || audioContext.state !== 'running') return;
  const t = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = kind === 'blast' ? 220 : 1000;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(kind === 'blast' ? .22 : .09, t);
  gain.gain.exponentialRampToValueAtTime(.001, t + (kind === 'blast' ? .65 : .13));
  source.connect(filter).connect(gain).connect(audioMixer.output('weapons'));
  audioMixer.track(source, [filter, gain], 'weapons');
  source.start(t);
  source.stop(t + .7);
}

function mechanicalSound(event) {
  if (mechanicalAudio) {
    mechanicalAudio.play(audioContext, event);
    return;
  }
  const { owner, playing } = mechanicalPlayback();
  if (!playing || event.soldierId !== owner.soldierId || event.weaponId !== owner.weaponId) return;
  if (!audioContext || audioContext.state !== 'running') return;
  const { cue } = event;
  const source = audioContext.createBufferSource(), gain = audioContext.createGain(), filter = audioContext.createBiquadFilter();
  const now = audioContext.currentTime, length = cue === 'extract' ? .1 : .045;
  source.buffer = noiseBuffer;
  filter.type = 'bandpass'; filter.frequency.value = cue === 'load' ? 2400 : cue === 'close' ? 1250 : 3200; filter.Q.value = 2;
  gain.gain.setValueAtTime(.045, now); gain.gain.exponentialRampToValueAtTime(.001, now + length);
  source.connect(filter).connect(gain).connect(audioMixer.output('weapons'));
  audioMixer.track(source, [filter, gain], 'weapons');
  source.start(now, .3, length);
}

function playDoorSound(event) {
  if (!audioContext || audioContext.state !== 'running') return;
  const distance = Math.hypot(event.position.x - camera.position.x, event.position.z - camera.position.z);
  if (distance > 18) return;
  const now = audioContext.currentTime, oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(95, now);
  oscillator.frequency.exponentialRampToValueAtTime(58, now + .4);
  gain.gain.setValueAtTime(.001, now);
  gain.gain.linearRampToValueAtTime(.018 / (1 + distance * .3), now + .04);
  gain.gain.exponentialRampToValueAtTime(.001, now + .45);
  const panner = audioContext.createStereoPanner();
  const local = camera.worldToLocal(new THREE.Vector3(event.position.x, camera.position.y, event.position.z));
  panner.pan.value = THREE.MathUtils.clamp(local.x / Math.max(1, distance), -.9, .9);
  oscillator.connect(gain).connect(panner).connect(audioMixer.output('effects'));
  audioMixer.track(oscillator, [gain, panner], 'effects');
  oscillator.start(now); oscillator.stop(now + .46);
}

function initAudio() {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) { audioUnsupported = true; return; }
  if (!audioContext) {
    audioContext = new Audio();
    audioMixer = createAudioMixer(audioContext, preferenceValues.audio);
    rifleAudio?.setOutput(audioMixer.output('weapons'));
    mechanicalAudio?.setOutput(audioMixer.output('weapons'));
    footstepAudio?.setOutput(audioMixer.output('footsteps'));
    battleVoices?.setOutput(audioMixer.output('voices'));
    civilianVoices?.setOutput(audioMixer.output('voices'));
    sihangVoices?.setOutput(audioMixer.output('voices'));
    battleReactions?.setOutput(audioMixer.output('voices'));
    battleSignals?.setOutput(audioMixer.output('voices'));
    tacticalAudio?.setOutputs({ weapons: audioMixer.output('weapons'), footsteps: audioMixer.output('footsteps'), effects: audioMixer.output('effects') });
    vehicleAudio?.setOutput(audioMixer.output('effects'));
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    grenadeBlastAudio = createGrenadeBlastAudio(audioContext, noiseBuffer, audioMixer.output('weapons'), audioMixer.output('effects'));
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(error => {
    console.warn('游戏音效未启用：', error);
    toast('浏览器尚未允许音效，请点击游戏画面后重试', 6);
  });
}

function emitFootstep(position, speed, landing = false) {
  const ground = world.groundSurface(position.x, position.z);
  lastFootSurface = ground;
  playerFootsteps++;
  emitControlEvent('movement.footstep', { position, surface: ground, speed, landing, stance: controlPose.stance });
}

function playFootstep(event) {
  if (!audioContext || audioContext.state !== 'running') return;
  if (footstepAudio && (event.stance !== 'prone' || event.landing)) {
    footstepAudio.play(audioContext, event);
    return;
  }
  const { surface: ground, speed, landing } = event;
  const t = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = 'bandpass';
  const crawling = event.stance === 'prone' && !landing;
  filter.frequency.value = crawling ? 420 : ground === 'stone' ? 950 : ground === 'wood' ? 560 : 380;
  filter.Q.value = .65;
  const gain = audioContext.createGain();
  const force = (.035 + Math.min(speed, 5) * .008) * (landing ? 1.8 : crawling ? .45 : 1);
  gain.gain.setValueAtTime(force, t);
  gain.gain.exponentialRampToValueAtTime(.001, t + .13);
  source.connect(filter).connect(gain).connect(audioMixer.output('footsteps'));
  audioMixer.track(source, [filter, gain], 'footsteps');
  source.start(t, Math.random() * .5, .15);
  if (crawling) return;
  const thud = audioContext.createOscillator();
  thud.frequency.setValueAtTime(ground === 'stone' ? 110 : 75, t);
  thud.frequency.exponentialRampToValueAtTime(40, t + .1);
  const thudGain = audioContext.createGain();
  thudGain.gain.setValueAtTime(force * .65, t);
  thudGain.gain.exponentialRampToValueAtTime(.001, t + .12);
  thud.connect(thudGain).connect(audioMixer.output('footsteps'));
  audioMixer.track(thud, [thudGain], 'footsteps');
  thud.start(t); thud.stop(t + .14);
}

function lockMouse() {
  if (fatal) return;
  if (document.pointerLockElement === canvas) return;
  if (!canvas.requestPointerLock) {
    toast('当前浏览器不支持鼠标捕获：按住右键拖动瞄准', 6);
    return;
  }
  const request = canvas.requestPointerLock();
  if (request?.catch) request.catch(error => {
    console.warn('鼠标捕获未获准：', error.message);
    if (!pointerHintShown) {
      toast('鼠标捕获未获准：可点击画面重试，或按住右键拖动瞄准', 7);
      pointerHintShown = true;
    }
  });
  return request;
}

function releaseMouse() {
  scoreboardInteractive = scoreboardReturnCapture = scoreboardRestoring = false;
  if (document.pointerLockElement) document.exitPointerLock();
  playerInput.block();
  $('scoreboard').hidden = true;
  if (allies[current]) stopLocomotion(allies[current].locomotion);
}

function actorAt(friendly, x, z, index, spawn, formation) {
  const loadout = infantryEquipment(friendly ? 'friendly' : 'enemy', index, formation.type, formation);
  const model = soldierModel(friendly, 'near', loadout.unarmed ? 'unarmed' : loadout.model);
  const position = new THREE.Vector3(x, world.walkHeight(x, z, spawn.altitude ?? world.groundHeight(x, z)), z);
  // Apply the seeded gait phase only after a walk update; idle spawns retain neutral legs.
  const actor = { model, health: 100, friendly, index, spawnId: spawn.id, role: loadout.role,
    hasFirearm: !loadout.unarmed, demolitionCharge: Boolean(loadout.demolitionCharge),
    assaultCrossing: formation?.assaultCrossing ?? null, nextFire: time + 1 + battleRandom() * 2,
    nextThink: 0, target: null, walkPhase: battleRandom() * 6, walkPoseReady: false, deathTime: 0,
    buildProgress: 0, locomotion: createLocomotion(), rifle: createRifleState(loadout.model) };
  actor.targetKind = 'person';
  actor.aiRifle = createAIRifleControl();
  actor.bayonet = createBayonetState();
  actor.dadao = friendly ? createDadaoState() : null;
  actor.breathControl = createBreathState();
  actor.grenades = createGrenadeInventory();
  actor.grenades.ammo = loadout.handGrenades;
  actor.grenades.packs = loadout.explosivePacks;
  actor.explosivePack = { get ammo() { return actor.grenades.packs; } };
  actor.rifleReady = false;
  if (loadout.unarmed) { actor.rifle.ammo = 0; actor.rifle.reserve = 0; }
  actor.spawnPosition = { x, z };
  actor.spawnClear = !circleBlocked(x, z, .42, world.obstacles, position.y);
  actor.playerUnit = Boolean(formation?.player);
  actor.formation = formation;
  actor.section = Math.floor(index / BATTLE_RULES.sectionMembers);
  actor.tactics = createTactics(++actorSerial, (friendly ? 100 : 0) + (formation?.index || 0) * Math.ceil(TYPES.infantry.members / BATTLE_RULES.sectionMembers) + actor.section, index % BATTLE_RULES.sectionMembers);
  Object.assign(actor, { id: `soldier-${actor.tactics.id}`, unitId: formation.id, team: friendly ? 'friendly' : 'enemy',
    position, heading: formation.sihangDemolition ? sihangShieldLayout(index, formation.memberCount).facing
      : friendly && nanjingCampaignMode ? Math.PI : friendly ? 0 : Math.PI,
    groundType: formation.type === 'mortar' ? 'mortar' : 'infantry' });
  if (friendly && nraCharacter) {
    actor.nativeMotion = createNraMotion(nraCharacter.motionProfile, actor);
    actor.avatarAppearance = createNraAppearance(actor);
  } else if (!friendly && ijaCharacter) {
    actor.nativeMotion = createNraMotion(ijaCharacter.motionProfile, actor);
  }
  registerSoldier(entities, actor);
  battleStats.registerSoldier(actor);
  if (!loadout.unarmed)
    registerWeapon(entities, Object.assign(actor.rifle, { nextShot: 0, reloadUntil: 0 }), `${actor.id}:rifle`, actor.id, 'infantry');
  if (actor.role === 'mortarman') actor.mortar = registerWeapon(entities, createMortar(), `${actor.id}:mortar`, actor.id, 'mortar');
  if (actor.role === 'engineer') actor.engineer = createEngineerState();
  if (loadout.discharger) {
    actor.discharger = registerWeapon(entities, createGrenadeDischarger(),
      `${actor.id}:grenade-discharger`, actor.id, 'grenade-discharger');
    actor.discharger.queryAt = time + 1 + battleRandom() * 1.5;
    const supportModel = createGrenadeDischargerModel();
    supportModel.visible = false; scene.add(supportModel); dischargerViews.set(actor.id, supportModel);
  }
  if (!loadout.unarmed) {
    registerWeapon(entities, actor.grenades, `${actor.id}:grenades`, actor.id, 'grenade');
    registerWeapon(entities, actor.explosivePack, `${actor.id}:explosive-pack`, actor.id, 'explosive-pack');
  }
  if (actor.dadao) registerWeapon(entities, actor.dadao, `${actor.id}:dadao`, actor.id, 'melee');
  model.position.copy(position);
  model.rotation.y = actor.heading;
  spawnEvents.push({ team: friendly ? 'friendly' : 'enemy', pointId: spawn.id, pointX: spawn.x, pointZ: spawn.z, x, z, time,
    formationId: formation?.id, generation: (formation?.generation || 0) + 1 });
  if (spawnEvents.length > 2048) spawnEvents.shift();
  model.traverse(child => { if (child.isMesh) child.userData.actor = actor; });
  return actor;
}

function hostilePositions(team) {
  return (team === 'friendly' ? enemies : friendlyForces).map(actor => ({
    x: actor.position.x, z: actor.position.z, health: actor.health, altitude: actor.position.y,
  }));
}

function rebuildForces() {
  friendlyForces = [...allies, ...friendlyAI];
  allForces = [...enemies, ...friendlyForces];
  if (nanjingCampaignMode) {
    nanjingEnemyPositions.clear();
    for (const actor of enemies) nanjingEnemyPositions.add(actor.position);
  }
  if (sihangCampaignMode) {
    sihangEnemyPositions.clear();
    sihangSapperPositions.clear();
    for (const actor of enemies) {
      sihangEnemyPositions.add(actor.position);
      if (actor.formation.sihangDemolition) sihangSapperPositions.add(actor.position);
    }
  }
  actorGrid.rebuild(allForces);
}

function nanjingPlayerFerry() {
  if (!nanjingCampaignMode || nanjingCampaign?.playerBoardingBoatId == null) return null;
  return world.ferries.find(ferry => ferry.userData.ferryId === nanjingCampaign.playerBoardingBoatId) ?? null;
}

function nanjingBoardingGoal(actor) {
  const ferry = actor === controlledSoldier(entities) ? nanjingPlayerFerry() : null;
  return ferry ? { x: -72.2, z: ferry.position.z, transit: true } : troopFerryWaitPoint(actor, world.ferries,
    nanjingPlayerFerry() ? null : world.ferries[0].userData.ferryId);
}

function hasFerrySupport(actor) {
  const phase = actor?.tactics?.nanjingFerry?.phase;
  return phase === 'boarding' || phase === 'aboard' || phase === 'evacuated';
}

function nextDeathTransferMember() {
  const ferry = nanjingPlayerFerry();
  if (ferry?.userData.state === 'outbound') {
    const onboard = allies.findIndex(actor => actor.health > 0 &&
      actor.tactics.nanjingFerry?.phase === 'aboard' && actor.tactics.nanjingFerry.ferryId === ferry.userData.ferryId);
    if (onboard >= 0) return onboard;
  }
  return nextControllableMember();
}

function nextControllableMember() {
  if (!nanjingCampaignMode) return nextAlive(allies, current);
  for (let offset = 1; offset <= allies.length; offset++) {
    const index = (current + offset) % allies.length, actor = allies[index];
    if (actor.health > 0 && actor.tactics.nanjingFerry?.phase !== 'evacuated') return index;
  }
  return -1;
}

function movementObstacles(x, z, ignoreVehicleId = null) {
  const candidates = movementCollision.at(x, z, ignoreVehicleId);
  if (queryDiagnostics) queryDiagnostics.candidates(candidates.length, candidates.length - groundCollision.at(x, z).length);
  return candidates;
}

function infantryMovementObstacles(actor, x, z, escapePosition = null, radius = .43) {
  const obstacles = movementObstacles(x, z);
  const reservations = engineerConstructionReservations(actor, actorGrid.near(x, z, 8));
  const blockers = escapePosition && reservations.length
    ? reservationMovementBlockers(escapePosition, radius, reservations) : reservations;
  return blockers.length ? [...obstacles, ...blockers] : obstacles;
}

function infantryNavigationBlocked(point, position, radius = .43, actor = null) {
  if (nanjingDockMovementLimited(position) && nanjingDockInside(point, radius)) return true;
  const obstacles = actor ? infantryMovementObstacles(actor, point.x, point.z, position, radius)
    : movementObstacles(point.x, point.z);
  if (!sihangCampaignMode && !(nanjingCampaignMode && world.casemateNearby(point)))
    return circleBlocked(point.x, point.z, radius, obstacles, position.y);
  const floor = world.walkHeight(point.x, point.z, position.y);
  const horizontal = Math.hypot(point.x - position.x, point.z - position.z);
  if (world.isDeepWater(point.x, point.z) || Math.abs(floor - position.y) > .32 + horizontal * .26) return true;
  return circleBlocked(point.x, point.z, radius,
    obstacles.filter(obstacle => !obstacle.walkable || obstacle.height > floor + (sihangCampaignMode ? .25 : .5)), floor);
}

function constructionExitGoal(actor, builders) {
  const position = actor.position;
  const nearby = builders.filter(builder => builder !== actor && builder.engineer.construction.site &&
    Math.abs(builder.engineer.construction.site.x - position.x) < 8 &&
    Math.abs(builder.engineer.construction.site.z - position.z) < 8);
  if (!nearby.length) return null;
  const reservations = engineerConstructionReservations(actor, nearby);
  const occupied = reservations.find(bounds => circleBlocked(position.x, position.z, .45, [bounds], position.y));
  if (!occupied) return null;
  const { cx, cz, cos, sin, hx, hz } = occupied;
  const dx = position.x - cx, dz = position.z - cz;
  const x = cos * dx - sin * dz, z = sin * dx + cos * dz;
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  const candidates = [[hx + 1, clamp(z, hz)], [-hx - 1, clamp(z, hz)],
    [clamp(x, hx), hz + 1], [clamp(x, hx), -hz - 1]].map(([lx, lz]) => ({
    x: cx + cos * lx + sin * lz, y: position.y, z: cz - sin * lx + cos * lz, transit: true,
  })).sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) -
    Math.hypot(b.x - position.x, b.z - position.z));
  return candidates.find(goal =>
    goal.x > battleArea.minX + .5 && goal.x < battleArea.maxX - .5 &&
    goal.z > battleArea.minZ + .5 && goal.z < battleArea.maxZ - .5 &&
    Math.abs(world.walkHeight(goal.x, goal.z, position.y) - position.y) < .3 &&
    !circleBlocked(goal.x, goal.z, .5, reservations, position.y) &&
    sampledRouteClear(position, goal, (x, z) =>
      !infantryNavigationBlocked({ x, z }, position, .46, actor) &&
      Math.abs(world.walkHeight(x, z, position.y) - position.y) < .3)) ?? null;
}

function clearSihangConstruction(actor, builders, dt) {
  if (actor.vehicleId || actor.traversal.kind !== 'grounded' || actor.target || actor.tactics.lastSeen || !builders.length) return false;
  const goal = constructionExitGoal(actor, builders);
  if (!goal) return false;
  actor.rifleReady = false; actor.firingPose = null; actor.stance = 'standing';
  cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'clear-construction');
  actor.tactics.mode = 'clear-construction';
  walkActor(actor, goal, 2.4, dt);
  settleActorSupport(actor);
  return true;
}

function deploymentObstacles() {
  return entities.vehicles.size ? [...world.obstacles, ...[...entities.vehicles.values()].filter(item => item.type === 'tank').map(vehicleCollider)] : world.obstacles;
}

function deploymentOccupiedPositions(actors) {
  const positions = actors.filter(actor => actor.health > 0).map(actor => actor.position);
  if (nanjingCampaignMode) for (const civilian of world.civilians) {
    if (civilian.visible && civilian.parent === scene && !civilian.userData.dead) positions.push(civilian.position);
  }
  return positions;
}

function vehicleSolids(ignoreVehicleId = null, from = null, groundOnly = false) {
  return [...entities.vehicles.values()].filter(item => item.id !== ignoreVehicleId &&
    !item.fall?.sunk &&
    (!groundOnly || item.type === 'tank') &&
    (!from || from.distanceTo(item.position) > 3.2)).map(item => vehicleRenderer.model(item.id));
}

function battleSummary(team) {
  return { ...armySummary(formations, team), vehicles: [...entities.vehicles.values()].filter(item => item.team === team && item.health > 0).length };
}

function clearControlInputs() {
  playerInput.block();
  const actor = controlledSoldier(entities);
  if (actor) {
    actor.shoulderAiming = false;
    actor.breathControl.holding = false;
    releaseWeaponMount(actor.weaponMount);
    actor.weaponMount.blend = 0;
  }
  resetConstruction();
}

function resetControlledSimulation() {
  const ids = new Set([playerInput.snapshot.owner?.soldierId, controlBinding?.soldierId, entities.control.soldierId]);
  for (const id of ids) {
    const actor = entities.soldiers.get(id);
    if (actor?.dadao) stowDadao(actor.dadao);
    if (actor?.bayonet) cancelBayonet(actor.bayonet);
  }
  dadaoEquipped = false;
  toolEquipped = false;
  grenadeEquipped = false;
  selectedThrowable = 'grenade';
  jumpHeight = jumpVelocity = 0;
  resetConstruction();
}

function bindControlInput() {
  const owner = controlOwner(entities);
  const previousToolEquipped = toolEquipped, previousJumpHeight = jumpHeight, previousJumpVelocity = jumpVelocity;
  const changed = playerInput.bind(owner, state === 'playing' && allies[current]?.health > 0);
  if (changed) {
    resetControlledSimulation();
    const incoming = controlledSoldier(entities);
    if (incoming) resetAIRifleAim(incoming.aiRifle, 'controlled');
  }
  syncRifleUnit();
  syncMechanicalAudio();
  if (state === 'playing' && controlledSoldier(entities)?.grenades.action) grenades.release(owner.soldierId, time);
  controlBinding = { ...owner, time, changed, previousToolEquipped, previousJumpHeight, previousJumpVelocity,
    toolEquipped, jumpHeight, jumpVelocity, ammo: unit?.ammo, reloadUntil: unit?.reloadUntil,
    viewHasRifle: Boolean(weapon?.userData.rifle) };
}

function emitControlEvent(type, data = {}) {
  controlEvents.publish(type, { soldierId: entities.control.soldierId, unitId: entities.control.unitId, ...data }, time);
}

function primaryViewAvailable() {
  return unit?.type !== 'tank' || Boolean(occupiedSeat(entities)?.controlsTurret);
}

function rifleAimAvailable() {
  const actor = controlledSoldier(entities);
  return Boolean(state === 'playing' && actor?.health > 0 && unit.type === 'infantry' && !actor.vehicleId &&
    held.aiming && actor.traversal.kind !== 'vaulting' && !toolEquipped && !dadaoEquipped && !grenadeEquipped && !actor.grenades.action &&
    actor.rifle.action !== 'reload' && (!infantryWeaponProfile(actor.rifle).scoped || actor.rifle.action === 'idle') &&
    !actor.locomotion.sprinting && actor.locomotion.aimRecovery === 0 && weaponObstruction === 0 && obstructionBlend < .03);
}

function sniperScopeActive() {
  return rifleAimAvailable() && Boolean(infantryWeaponProfile(allies[current].rifle).scoped);
}

function currentWeaponRestriction(action = 'fire') {
  const actor = controlledSoldier(entities);
  if (!actor || state !== 'playing') return null;
  if (actor.emplacementId) return null;
  const infantry = unit.type === 'infantry', foot = infantry || unit.type === 'mortar';
  return weaponRestriction({
    firearm: !toolEquipped && !dadaoEquipped && !grenadeEquipped && !actor.grenades.action,
    vaulting: actor.traversal.kind === 'vaulting',
    canFire: !actor.vehicleId || occupiedSeat(entities)?.canFire,
    sprinting: foot && actor.locomotion.sprinting, recovery: foot ? actor.locomotion.aimRecovery : 0,
    obstruction: infantry ? weaponObstruction : 0, obstructionBlend: infantry ? obstructionBlend : 0,
    reloading: infantry ? actor.rifle.action === 'reload' : time < unit.reloadUntil,
    cycling: infantry && actor.rifle.action === 'cycle',
    scoped: infantry && infantryWeaponProfile(actor.rifle).scoped,
    readying: time < unit.nextShot,
    ammo: unit.ammo, magazine: infantry ? infantryWeaponProfile(actor.rifle).magazine : TYPES[unit.type].magazine,
    shellLimit: unit.type === 'mortar' && shells.length >= PROJECTILE_LIMIT,
  }, action);
}

function refreshWeaponVisibility() {
  if (weapon) weapon.visible = state === 'playing' && controlledSoldier(entities)?.health > 0 &&
    !controlledSoldier(entities).emplacementId &&
    !grenadeEquipped && !controlledSoldier(entities).grenades.action &&
    (primaryViewAvailable() || occupiedVehicle(entities, controlledSoldier(entities))?.type === 'tank') &&
    !weapon.userData.optical && !sniperScopeActive() &&
    !(toolEquipped && controlledSoldier(entities).mortar && controlledSoldier(entities).mortar.phase !== 'carrying');
  syncMechanicalAudio();
}

function resetPersonalCombatFeedback() {
  rifleRecoil.clear();
  combatFeedback.resetPersonal();
  $('hit-marker').style.opacity = $('damage-vignette').style.opacity = '0';
}

function presentCombatEvents(bornAt = time) {
  const position = point => new THREE.Vector3(point.x, point.y, point.z);
  const listener = tacticalAudio ? battleAudioListener() : null;
  combatEvents.drain(event => {
    tacticalAudio?.consume(event, listener);
    if (event.type === 'shot') {
      if (event.weaponType === 'mortar' && mortarLaunch && audioContext && audioMixer) {
        if (playMortarLaunch(audioContext, mortarLaunch, audioMixer,
          event.source.weaponClass === 'grenade-discharger' ? .48 : .9)) mortarLaunchesPlayed++;
      } else if ((event.weaponType === 'infantry' || event.weaponType === 'tank' && event.sound === 'shot') && rifleAudio) {
        rifleReports.push(event);
      } else if (event.sound) sound(event.sound);
      const start = position(event.start);
      if (event.end) {
        const end = position(event.end);
        tracer(start, end, event.color, .08, bornAt);
        if (event.muzzle) combatEffects.muzzle(start, end.clone().sub(start).normalize(), bornAt);
      }
      if (state === 'playing' && event.source.soldierId === entities.control.soldierId &&
        event.source.weaponId === controlOwner(entities)?.weaponId) {
        if (event.weaponType === 'infantry') {
          rifleRecoil.shot(event.time, { model: allies[current].rifle.model ?? 'rifle', stance: controlPose.stance,
            aiming: held.aiming, support: mountStability(allies[current].weaponMount,
              Boolean(infantryWeaponProfile(allies[current].rifle).automatic)).recoil });
          recoil = 0;
        } else recoil = event.recoil;
        if (unit.type === 'infantry' && weapon?.userData.rifle) {
          updateRifleModel(weapon, allies[current].rifle);
          weapon.userData.rifle.flash.visible &&= graphics.snapshot.effects.muzzle;
        }
      }
    } else if (event.type === 'impact') {
      if (event.kind) combatEffects.hit(event, bornAt);
      else renderImpact(position(event.position), bornAt);
    } else if (event.type === 'explosion') {
      combatEffects.explosion(position(event.position), bornAt, event.radius, event.style, event.surface ?? null);
      if (event.sound && ['grenade', 'explosive-pack', 'mortar', 'grenade-discharger'].includes(event.style)) {
        const listener = battleAudioListener(), point = position(event.position);
        grenadeBlastAudio?.play(point, listener, event.style);
        blastFeedback.trigger(point, listener.position, event.style);
        const mix = grenadeBlastMix(point, listener, event.style);
        if (mix.flash > 0 && hasLine(point.clone().add(new THREE.Vector3(0, .35, 0)), listener.position,
          point.distanceTo(listener.position) + 1)) {
          grenadeFlashStrength = Math.max(grenadeFlashStrength, mix.flash);
          grenadeFlashUntil = performance.now() + 220;
        }
      } else if (event.sound) sound('blast');
    } else {
      battleStats.consume(event);
      if (event.type === 'damage') {
        battleReactions?.damage(audioContext, event, entities.soldiers.get(event.target.id),
          battleAudioListener(), battleVoices?.priorityActive ?? false);
      }
      combatFeedback.consume(event, { soldierId: entities.control.soldierId, weaponId: controlOwner(entities)?.weaponId,
        grenadeWeaponId: controlledSoldier(entities)?.grenades.id,
        explosivePackWeaponId: controlledSoldier(entities)?.explosivePack.id,
        machineGunWeaponIds: occupiedVehicle(entities, controlledSoldier(entities))?.machineGuns?.map(gun => gun.id) ?? [],
        active: state === 'playing' || state === 'transferring' }, time);
    }
  });
}

function battleAudioListener() {
  camera.updateMatrixWorld();
  const elements = camera.matrixWorld.elements;
  const actor = controlledSoldier(entities), transport = occupiedVehicle(entities, actor);
  return {
    position: camera.position, right: { x: elements[0], y: elements[1], z: elements[2] },
    soldierId: entities.control.soldierId, weaponId: controlOwner(entities)?.weaponId, vehicleId: transport?.id ?? null,
    ownedWeaponIds: occupiedSeat(entities)?.canFire ? (transport?.machineGuns ?? []).map(gun => gun.id) : [],
  };
}

function presentRifleReports() {
  const listener = battleAudioListener();
  tacticalAudio?.flush(audioContext, listener, time, entities.vehicles.values());
  vehicleAudio?.update(audioContext, entities.vehicles.values(), listener, time, activeStates.has(state));
  const chatterEnabled = activeStates.has(state) && !battleEnding.fading;
  if (sihangCampaignMode) sihangVoices?.update(audioContext, sihangCampaign, world.civilians, listener, time, chatterEnabled);
  const sihangPriority = Boolean(sihangVoices?.snapshot.active);
  const signalsEnabled = enemySignalsEnabled(chatterEnabled, nanjingCampaignMode ? nanjingCampaign?.stage ?? null : null);
  const signal = battleSignals?.update(audioContext, allForces, listener, time, signalsEnabled);
  if (signal?.team === 'enemy') {
    const speaker = friendlyForces.filter(actor => actor.health > 0 && !actor.vehicleId && actor.id !== listener.soldierId)
      .sort((a, b) => a.position.distanceToSquared(listener.position) - b.position.distanceToSquared(listener.position))[0];
    if (speaker) battleVoices?.signalWarning(audioContext, speaker, listener, time);
  }
  rifleAudio?.playBatch(audioContext, rifleReports.splice(0), listener);
  battleVoices?.update(audioContext, allForces, listener, time, chatterEnabled && !sihangPriority, (observer, target) => {
    const eye = soldierEyePosition(observer);
    return Boolean(visibleTargetPoint(target, point => hasLine(new THREE.Vector3(eye.x, eye.y, eye.z), point, 75, target.vehicleId)));
  });
  battleReactions?.update(audioContext, allForces, listener, time, sihangPriority || (battleVoices?.priorityActive ?? false), chatterEnabled);
  if (nanjingCampaignMode) civilianVoices?.update(audioContext, world.civilians, listener, nanjingCampaign.stage,
    time, ['playing', 'transferring'].includes(state) && !battleEnding.fading &&
      (nanjingCampaign.stage === 'gate-defense' || world.civilianFlight.encounterAt !== null ||
        world.civilianFlight.allReleasedAt !== null), battleVoices?.priorityActive ?? false, friendlyForces, enemies);
}

function battleVoiceEvent(cue, options = {}) {
  if (sihangCampaignMode) return; // Sihang cues use their campaign-specific voice bank, never Nanjing/ferry lines.
  battleVoices?.event(audioContext, cue, { time, soldierId: entities.control.soldierId ?? 'commander', ...options });
}

function presentControlEvents() {
  footstepAudio?.sync(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  syncMechanicalAudio();
  const count = controlEvents.drain(event => {
    if (event.type === 'door.requested') { playDoorSound(event); return; }
    if (event.soldierId !== entities.control.soldierId) return;
    if (event.type === 'movement.footstep') {
      if (state === 'playing' && !controlledSoldier(entities)?.vehicleId) playFootstep(event);
    } else if (['control.changed', 'vehicle.exited', 'vehicle.entered'].includes(event.type)) {
      refreshControlSurface();
      if (event.type === 'vehicle.exited') toast('已离开原车 · 车体状态、主炮弹药与个人步枪均保留');
      else if (event.type === 'vehicle.entered') toast(`已返回原车 · ${event.label}`);
      else if (event.reason !== 'death') toast(`已切换至 ${event.index + 1} 号队员`);
    } else if (event.type === 'death.started') {
      refreshWeaponVisibility();
      hudAt = 0;
    } else if (event.type === 'death.completed') {
      refreshWeaponVisibility();
      resetPersonalCombatFeedback();
      toast('已接管存活队员 · 生命与弹药保持原状');
    } else if (event.type === 'weapon.reload-requested') {
      toast(event.queued ? '拉栓后装填 · 动作与成员状态保留' : '正在装填…', event.duration);
    } else if (event.type === 'weapon.mechanical') {
      mechanicalSound(event);
    } else if (event.type === 'equipment.changed') updateControlHelp();
  });
  if (count) renderConstruction();
}

function updateControlHelp() {
  const actor = controlledSoldier(entities), transport = occupiedVehicle(entities, actor);
  $('battle-controls').textContent = transport?.type === 'plane'
    ? '鼠标 指向／辅助跟随 · W/S 俯仰 · A/D 滚转 · Q/E 方向舵 · Shift/Ctrl 或滚轮 油门 · C 按住环顾 · 右键 放大 · 左键 机枪 · 低速会失速下沉'
    : transport ? primaryViewAvailable()
      ? 'W S 前后 · A D 车体转向 · 鼠标 炮塔 · 右键 放大 · 左键 主炮（车组自动装填） · 按住空格 机枪 · Y 换人 · F 地面离车'
      : 'WASD 驾驶 · 鼠标 有限观察（不转炮塔） · 主炮／机枪不可操作 · Y 换人 · F 下车'
    : unit.type === 'mortar'
      ? 'WASD 搬运 · C 慢走 · Shift 短时冲刺 · 鼠标 弹着点 · 左键 发射 · R 装填 · Y 炮组 · X 命令 · 1 主武器 · 3 大刀 · 5 手雷 · 6 炸药包 · 左键准备／松开投掷'
      : actor.role === 'sniper'
        ? 'WASD 移动 · 右键 开镜 · 左 Shift 屏息 · 左键 单发 · R 装填 · Ctrl 蹲姿 · Z 卧姿 · Y 换人 · 1 主武器 · 3 大刀 · 5 手雷 · 6 炸药包 · 左键准备／松开投掷'
        : actor.role === 'mortarman'
          ? '迫击炮手 · 1 步枪／收炮 · 2 迫击炮 · 站定后左键架设 · 鼠标左右调方向、上下调射程50–250米 · 架设后左键发射，自动装填 · 右键收起 · 5手榴弹 · 6炸药包 · Y换人'
          : actor.role === 'engineer'
            ? '工兵 · 1步枪 · 2锤子 · R选择机枪／火炮 · 长按左键20秒建造 · 每类仅一份材料 · 5手雷 · 6炸药包 · Y换人'
          : 'WASD 慢跑 · C 慢走 · Shift 冲刺 · 左键 射击／挥刀 · 右键 瞄准 · R 装填 · F 交互 · Y 队员 · X 命令 · 1 主武器 · 3 大刀 · 5 手雷（G兼容选择） · 6 炸药包 · 左键准备／松开投掷';
  if (!transport) $('battle-controls').textContent += unit.type === 'infantry'
    ? ' · B 架枪／解除 · Space 跳跃／翻越低障碍（蹲卧时先起身）'
    : ' · Space 跳跃／翻越低障碍（蹲卧时先起身）';
}

function refreshControlSurface() {
  const actor = controlledSoldier(entities);
  if (weapon) camera.remove(weapon);
  weapon = dadaoEquipped ? dadaoViewModel(nraCharacter?.createGrenadeHand) : toolEquipped ? selectedToolModel(actor)
    : weaponModel(unit.type, actor.rifle, occupiedSeat(entities)?.role ?? 'commander');
  weapon.traverse(mesh => { if (mesh.isMesh) { mesh.castShadow = false; mesh.frustumCulled = false; } });
  camera.add(weapon);
  refreshWeaponVisibility();
  if (unit.type === 'infantry' && !toolEquipped && !dadaoEquipped) weapon.position.set(.18, -.22, -.14);
  $('weapon-name').textContent = dadaoEquipped ? '抗战大刀 · 左键挥砍'
    : toolEquipped ? actor.engineer ? '工兵锤 · R选择阵地 · 长按左键建造20秒' : '轻型迫击炮 · 左键架设'
    : primaryViewAvailable() ? unit.type === 'infantry' ? infantryWeaponProfile(actor.rifle).name : TYPES[unit.type].weapon : `${occupiedSeat(entities).label}观察 · 主炮不可操作`;
  $('ammo-max').textContent = `/ ${unit.type === 'infantry' ? infantryWeaponProfile(actor.rifle).magazine : TYPES[unit.type].magazine}`;
  $('aim-label').hidden = unit.type !== 'mortar';
  updateControlHelp();
  lean = recoil = 0;
  resetPersonalCombatFeedback();
  weaponObstruction = obstructionBlend = 0;
  eyeHeight = controlPose.eyeHeight;
  updateCamera(0);
}

function groundVehicleFocus() {
  const actor = allies[current];
  if (!actor || actor.vehicleId) return null;
  const direction = camera.getWorldDirection(new THREE.Vector3());
  return [...entities.vehicles.values()].filter(item => item.type === 'tank' && item.health > 0 && item.team === actor.team &&
    item.unitId === actor.unitId && item.crewIds.includes(actor.id) && actor.position.distanceTo(item.position) < 4.8)
    .sort((a, b) => actor.position.distanceToSquared(a.position) - actor.position.distanceToSquared(b.position))
    .find(item => {
      const toward = item.position.clone().sub(camera.position); toward.y = 0;
      return (toward.length() < 1 || toward.normalize().dot(new THREE.Vector3(direction.x, 0, direction.z).normalize()) > .4) &&
        hasLine(camera.position, item.position.clone().add(new THREE.Vector3(0, 1, 0)), 6, item.id);
    }) || null;
}

function interactVehicle() {
  const actor = allies[current], transport = occupiedVehicle(entities, actor);
  if (transport) {
    const exit = transport.type === 'tank' ? groundExit(transport, (point, from) =>
      !circleBlocked(point.x, point.z, .42, movementObstacles(point.x, point.z)) &&
      segmentClear(from, point, .42, movementObstacles(point.x, point.z, transport.id)) &&
      !allForces.some(other => other !== actor && !other.vehicleId && other.health > 0 && Math.hypot(other.position.x - point.x, other.position.z - point.z) < .9),
    world.groundHeight) : null;
    const reason = leaveGroundVehicle(entities, actor, exit);
    if (reason) { toast(reason); return true; }
    clearControlInputs(); bindControlInput();
    actor.order = 'hold'; actor.personalHold = true; actor.orderPoint = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
    emitControlEvent('vehicle.exited', { vehicleId: transport.id });
    return true;
  }
  const nearby = groundVehicleFocus();
  if (!nearby) return false;
  const seat = nearby.seats.find(item => !item.occupantId || entities.soldiers.get(item.occupantId)?.health <= 0);
  if (!seat) { toast('车组席位已满'); return true; }
  const old = entities.soldiers.get(seat.occupantId);
  if (old) { old.vehicleId = old.seatId = null; seat.occupantId = null; }
  const reason = seatSoldier(entities, actor, nearby, seat.id);
  if (reason) { toast(reason); return true; }
  clearControlInputs(); bindControlInput();
  emitControlEvent('vehicle.entered', { vehicleId: nearby.id, seatId: seat.id, label: seat.label });
  return true;
}

function resetSpawns() {
  for (const model of baseSpawnViews.values()) model.visible = true;
  spawnPoints = benchmark?.diagnostic ? diagnosticSpawns(benchmark.scenario)
    : sihangCampaignMode ? sihangSpawns() : nanjingCampaignMode ? [...NANJING_SPAWNS]
      : encirclementMode ? encirclementSpawns() : [...makeBaseSpawns(), ...stagingSpawns(), ...japaneseArmorSpawns()];
  spawnEvents = [];
}

function spawnFormation(formation, initial = false, retreatTopUp = false) {
  if (formation.active === false || formation.respawnEnabled === false) return false;
  const retreatWave = sihangCampaignMode && formation.team === 'friendly' && sihangCampaign.stage === 'sihang-retreat';
  const existing = retreatTopUp && retreatWave ? formation.members.filter(actor => actor.health > 0) : [];
  const remainingSlots = SIHANG_RULES.squadMembers - existing.length;
  if (retreatTopUp && (!retreatWave || !remainingSlots)) return false;
  const memberCount = sihangCampaignMode && formation.team === 'friendly'
    ? retreatWave ? sihangRetreatDeploymentCount(sihangCampaign, retreatTopUp ? remainingSlots : SIHANG_RULES.squadMembers)
      : sihangDeploymentCount(sihangCampaign)
    : formation.memberCount || BATTLE_RULES.infantryMembers;
  if (!memberCount) return false;
  if (formation.variant === CHI_HA.id) return spawnJapaneseArmor(formation, initial);
  if (formation.type === 'plane' && formation.team === 'enemy') return spawnJapaneseAircraft(formation);
  if (formation.type !== 'infantry') throw new Error('自主载具单位尚未接入，不能用步兵冒充载具');
  const team = formation.team, hostiles = hostilePositions(team);
  const supplyGuard = initial && encirclementMode && formation.supplyGarrison;
  const spawn = retreatWave ? spawnPoints.find(point => point.id === formation.spawnId)
    : supplyGuard ? { id: 'japan-supply-A', name: '粮栈补给点驻军', team: 'enemy', kind: 'base', x: -37.8, z: 12 }
    : sihangCampaignMode && team === 'enemy' ? spawnPoints.find(point => point.id === formation.spawnId)
    : battleSpawn(formation, sihangCampaignMode && team === 'friendly'
      ? spawnPoints.filter(point => !point.playerOnly && !point.id.startsWith('sihang-retreat-') && point.id !== 'sihang-bridge-cover')
      : spawnPoints, hostiles, deploymentObstacles(), initial);
  // Indoor guards use collision-checked room slots, not the outdoor spawn's 2.8m centre clearance.
  const reason = supplyGuard ? null : spawn ? spawnBlockReason(spawn, 'infantry', hostiles, deploymentObstacles()) : '无可用步兵重生点';
  if (reason) { formation.blockedReason = reason; formation.spawnRetryAt = formation.respawnAt = time + 2; return false; }
  const occupied = deploymentOccupiedPositions(allForces);
  let positions;
  try {
    positions = supplyGuard ? supplyGarrisonPositions(formation.memberCount, deploymentObstacles(), occupied, hostiles)
      : formation.sihangDemolition ? sihangShieldSpawnPositions(spawn, memberCount, deploymentObstacles(), occupied, hostiles)
        : formationPositions(spawn, memberCount, deploymentObstacles(), occupied, hostiles);
  } catch (error) {
    if (!(error instanceof FormationPlacementError)) throw error;
    formation.blockedReason = error.message; formation.spawnRetryAt = formation.respawnAt = time + 2;
    return false;
  }

  if (supplyGuard) formation.supplyGuardPositions = positions.map(position => ({ x: position.x, y: 0, z: position.z }));
  const usedIndices = new Set(existing.map(actor => actor.index));
  const availableIndices = Array.from({ length: SIHANG_RULES.squadMembers }, (_, index) => index)
    .filter(index => !usedIndices.has(index));
  const members = positions.map((position, index) => actorAt(team === 'friendly', position.x, position.z,
    retreatTopUp ? availableIndices[index] : index, spawn, formation));
  if (retreatWave) registerSihangRetreatSquad(sihangCampaign, members);
  else if (sihangCampaignMode && team === 'friendly') registerSihangDeployment(sihangCampaign, members.length);
  formation.members = [...existing, ...members]; formation.generation++; formation.respawnAt = null;
  formation.reinforcementStartedAt = formation.spawnRetryAt = null;
  formation.blockedReason = null;
  if (retreatWave) { formation.withdrawAt = Infinity; formation.retreatAssembled = false; }
  if (team === 'friendly') friendlyAI.push(...members);
  else enemies.push(...members);
  rebuildForces();
  return true;
}

function spawnJapaneseArmor(formation, initial = false) {
  const hostiles = hostilePositions(formation.team), obstacles = deploymentObstacles();
  const spawn = battleSpawn(formation, spawnPoints, hostiles, obstacles, initial);
  const blocked = !spawn ? '无可用日军装甲重生点' : spawnBlockReason(spawn, 'tank', hostiles, obstacles) ||
    (!armorNavigate.canSpawn(spawn, [...entities.vehicles.values()]) ? '日军装甲出发点净空不足' : null);
  if (blocked) {
    formation.blockedReason = blocked; formation.spawnRetryAt = formation.respawnAt = time + 2;
    return false;
  }
  const transport = createVehicleEntity(entities, { id: `${formation.id}:vehicle-${formation.generation + 1}`,
    unitId: formation.id, type: 'tank', variant: CHI_HA.id, team: formation.team,
    position: new THREE.Vector3(spawn.x, world.groundHeight(spawn.x, spawn.z), spawn.z) });
  transport.heading = transport.turretYaw = Math.PI;
  transport.weapon.nextShot = time + 4;
  formation.members = transport.seats.map((seat, index) => {
    const actor = actorAt(false, spawn.x, spawn.z, index, spawn, formation);
    actor.role = 'tanker';
    const reason = seatSoldier(entities, actor, transport, seat.id);
    if (reason) throw new Error(reason);
    return actor;
  });
  formation.vehicleId = transport.id; formation.generation++;
  formation.respawnAt = formation.spawnRetryAt = null; formation.reinforcementStartedAt = null; formation.blockedReason = null;
  enemies.push(...formation.members);
  rebuildForces();
  vehicleRenderer.update(entities.vehicles.values());
  return true;
}

function spawnJapaneseAircraft(formation) {
  const hostiles = hostilePositions(formation.team), obstacles = deploymentObstacles();
  const spawn = battleSpawn(formation, spawnPoints, hostiles, obstacles);
  const blocked = spawn ? spawnBlockReason(spawn, 'plane', hostiles, obstacles) : '无可用日军航空重生点';
  if (blocked) {
    formation.blockedReason = blocked; formation.spawnRetryAt = formation.respawnAt = time + 2;
    return false;
  }
  clearActors(formation.members, true);
  enemies = enemies.filter(actor => actor.formation !== formation);
  for (const previous of [...entities.vehicles.values()].filter(vehicle => vehicle.unitId === formation.id)) {
    if (previous.health > 0) {
      entities.vehicles.delete(previous.id); entities.weapons.delete(previous.weapon.id);
    }
  }
  formation.members = [];
  for (let index = 0; index < formation.aircraftCount; index++) {
    const transport = createVehicleEntity(entities, { id: `${formation.id}:plane-${formation.generation + 1}-${index}`,
      unitId: formation.id, type: 'plane', team: 'enemy',
      position: new THREE.Vector3(spawn.x + index * 24, spawn.altitude + index * 4, spawn.z + index * 18) });
    transport.heading = Math.PI;
    transport.aiFlight = { phase: 'approach', until: 0, targetId: null, nextSense: index * 1.5, returningToArea: false };
    const actor = actorAt(false, spawn.x, spawn.z, index, spawn, formation);
    actor.role = 'pilot';
    const reason = seatSoldier(entities, actor, transport, transport.seats[0].id);
    if (reason) throw new Error(reason);
    formation.members.push(actor);
    if (index === 0) formation.vehicleId = transport.id;
  }
  formation.generation++;
  formation.respawnAt = formation.spawnRetryAt = null; formation.reinforcementStartedAt = null; formation.blockedReason = null;
  enemies.push(...formation.members); rebuildForces();
  vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
  return true;
}

function clearActorDischarger(actor) {
  if (!actor.discharger) return;
  stowGrenadeDischarger(actor.discharger);
  entities.weapons.delete(actor.discharger.id);
  const view = dischargerViews.get(actor.id);
  if (view) scene.remove(view);
  dischargerViews.delete(actor.id);
}

function clearActors(list, preserveCorpses = false) {
  const removed = list.filter(actor => !preserveCorpses || !corpses.has(actor.id));
  nraCharacter?.remove(removed);
  ijaCharacter?.remove(removed);
  for (const actor of removed) {
    if (actor.health <= 0) actor.corpseRemoved = true;
    releaseEmplacement(actor, false);
    aiDecisions.forget(actor);
    grenades.forget(actor.id);
    scene.remove(actor.model);
    const transport = occupiedVehicle(entities, actor);
    if (transport) {
      transport.seats.find(seat => seat.id === actor.seatId).occupantId = null;
      actor.vehicleId = actor.seatId = null;
    }
    entities.soldiers.delete(actor.id);
    entities.weapons.delete(actor.rifle.id);
    if (actor.mortar) entities.weapons.delete(actor.mortar.id);
    clearActorDischarger(actor);
    entities.weapons.delete(actor.grenades.id);
    entities.weapons.delete(actor.explosivePack.id);
    if (actor.dadao) entities.weapons.delete(actor.dadao.id);
  }
}

function clearTransient() {
  sihangParade?.reset(); sihangParadeSerial = 0;
  clearEngineerWorks();
  grenadeBlastAudio?.reset(); grenadeFlashUntil = grenadeFlashStrength = 0;
  blastFeedback.reset(); blastFeedbackTime = 0;
  $('blast-flash').style.opacity = '0';
  missionBriefing.hide();
  grenades.clear();
  aiThrowReservations.clear();
  grenadeRenderer.clear();
  $('grenade-warning').hidden = true;
  corpseCleanupAt = 0;
  civilianCorpses.clear();
  boundaryStates.clear();
  combatEvents.clear();
  battleStats.clear(); scoreboardRevision = -1;
  rifleReports.length = 0;
  rifleAudio?.reset();
  audioMixer?.reset();
  battleVoices?.reset();
  civilianVoices?.reset();
  sihangVoices?.reset();
  battleReactions?.reset();
  battleSignals?.reset();
  tacticalAudio?.reset(); vehicleAudio?.reset();
  objectiveVoiceTracker.reset();
  encirclementVoiceTracker.reset();
  combatFeedback.clear(); recoil = 0; rifleRecoil.clear();
  $('hit-marker').style.opacity = $('damage-vignette').style.opacity = '0';
  combatEffects.clear();
  for (const effect of [...effects]) removeEffect(effect);
  tracerPool.reset();
  for (const mesh of shellViews.values()) scene.remove(mesh);
  shellViews.clear();
  shells.length = 0;
  projectileImpacts.length = 0;
  projectileSerial = 0;
}

function beginMatch(initialSpawnId = null) {
  if (battlePreparing) return;
  squadRoutes.reset();
  clearEngineerWorks();
  endingVoice?.stop(); endingVoice = null; battleEnding.reset();
  $('battle-ending').hidden = true;
  $('player-identity').hidden = true;
  $('initial-identity-slot').hidden = true;
  $('confirm-identity').hidden = true;
  $('takeover-sihang-squad').hidden = true;
  delete $('overlay').dataset.deploymentStep;
  civilianCombatTime=null;civilianCombatList=[];
  footstepAudio?.sync(null, false);
  mechanicalAudio?.reset();
  simulationClock.reset(performance.now());
  stepWorkBudget.reset();
  staticRescue?.update({ enabled: false });
  playerInput.reset(); controlEvents.clear();
  controlBinding = null;
  resetDeathTransfer(deathTransfer);
  if (benchmark) {
    battleRandom = seededRandom(benchmark.seed);
    actorSerial = soundSerial = 0;
    telemetry.reset();
  }
  queryDiagnostics?.reset();
  renderIsolation.mode = 'normal';
  renderIsolation.drawFrames = renderIsolation.skippedFrames = renderIsolation.hiddenCharacterFrames = renderIsolation.characterPresentationFrames = 0;
  if (sihangCampaignMode) {
    world.resetCampaign(); sihangCombat.reset(); groundCollision.rebuild(); aircraftCollision.rebuild();
    solidIndex = createSolidIndex(world.solids);
    navigate.refreshMany([{ minX: -108, maxX: 108, minZ: -108, maxZ: 108 }]);
  }
  else if (nanjingCampaignMode) {
    world.resetCampaign();
    for (const ferry of world.ferries) {
      ferry.userData.troopPassengers = [];
      ferry.userData.troopCorpses = [];
      ferry.userData.troopBoarding = null;
      ferry.userData.troopsLoadedAt = null;
    }
    for (const aircraft of world.aircraft) aircraft.visible = false;
  }
  else world.doorSystem.reset();
  coverClaims.clear();
  combatSounds.length = 0;
  for (const key of Object.keys(combatStats)) combatStats[key] = 0;
  clearActors(allies);
  clearActors(enemies);
  clearActors(friendlyAI);
  clearActors([...corpses.values()]); corpses.clear();
  vehicleRenderer.clear();
  resetEntities(entities);
  for (const point of emplacements.values()) {
    const view = point.view, spec = emplacementSpecs.find(spec => spec.id === point.id);
    Object.assign(point, createEmplacement(spec)); point.view = view;
    syncArtilleryCollision(point);
    registerWeapon(entities, point.weapon, `${point.id}:weapon`, point.id, point.weapon.type);
    point.view.userData.update();
  }
  armorNavigate.reset();
  dockArmorNavigate?.reset();
  clearTransient();
  enemies = [];
  allies = [];
  friendlyAI = []; friendlyForces = []; allForces = [];
  pathRequests.clear(); trafficReservations.clear(); trafficGrid.clear(); aiCursor = 0;
  aiDecisions.reset();
  adaptiveAI.reset();
  resetSpawns();
  pendingSquad = pendingSpawn = null;
  objectives = sihangCampaignMode ? sihangObjectives() : nanjingCampaignMode ? createNanjingObjectives() : encirclementMode ? encirclementObjectives() : makeObjectives(battleLayout.objectives);
  encirclement = createEncirclement();
  nanjingCampaign = nanjingCampaignMode ? createNanjingCampaign() : null;
  sihangCampaign = sihangCampaignMode ? createSihangCampaign() : null;
  conquest = createConquest();
  assaultAssignmentAt = 0;
  for (const [index, flag] of world.flags.entries()) {
    if (sihangCampaignMode || flag.userData.nationalFlag) continue;
    flag.material.color.setHex(objectives[index].owner === 'enemy' ? 0xb66551 : 0xa19469);
  }
  time = 0;
  remaining = sihangCampaignMode ? sihangCampaign.stageRemaining : nanjingCampaignMode ? nanjingCampaign.stageRemaining : MATCH_SECONDS;
  kills = teamKills = deployments = 0;
  populationRefreshAt = 0;
  playerFootsteps = 0;
  lastFootSurface = null;
  frameTimes.length = 0;
  const playerType = SQUADS[selectedType].type;
  formations = benchmark?.diagnostic ? diagnosticRoster(benchmark.scenario)
    : sihangCampaignMode ? sihangBattleRoster(playerType) : nanjingCampaignMode ? nanjingBattleRoster(playerType) : encirclementMode ? encirclementRoster(playerType) : battleRoster(playerType);
  for (const formation of formations) {
    registerUnit(entities, formation);
    if (formation.active !== false) registerBattleScore(formation);
  }
  if (!benchmark?.diagnostic && !nanjingCampaignMode && !sihangCampaignMode) validateRoster(formations, encirclementMode
    ? { friendly: ENCIRCLEMENT_RULES.maxFriendly, enemy: ENCIRCLEMENT_RULES.enemySquads } : undefined);
  for (const formation of formations.filter(item => !item.player && item.active !== false && !item.reserve)) {
    if (!spawnFormation(formation, true)) throw new Error(`开局集结失败：${formation.id}，未减少单位数作为回退`);
  }
  $('menu').hidden = true;
  $('hud').hidden = false;
  deploy(selectedType, initialSpawnId, !benchmark);
  if (!benchmark) void prepareBattleRendering().catch(error => fatalReporter.show(error, { stage: 'battle-rendering' }));
}

async function prepareBattleRendering() {
  battlePreparing = true;
  $('loading').hidden = false;
  setLoadingProgress(90, '正在准备战场画面…');
  const update = () => {
    vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
    const displayed = allForces.filter(actor => actor.health > 0), preset = graphics.snapshot.preset;
    nraCharacter?.update(displayed.filter(actor => actor.team === 'friendly'), time, entities.control.soldierId, preset);
    ijaCharacter?.update(displayed.filter(actor => actor.team === 'enemy'), time, entities.control.soldierId, preset);
    for (const force of [nraCharacter, ijaCharacter]) if (force) force.root.visible = true;
  };
  try {
    armorNavigate.prepare([...entities.vehicles.values()]);
    if (sihangCampaignMode) {
      const position = controlledSoldier(entities).position;
      for (const y of SIHANG_LEVELS) world.elevatedPath({ x: position.x, y, z: position.z },
        { x: position.x, y, z: position.z });
      const path = world.elevatedPath(controlledSoldier(entities).position,
        { x: SIHANG_BRIDGE.northX, y: 0, z: SIHANG_BRIDGE.northZ });
      if (!path.length) throw new Error('四行仓库开局撤离路线不可达');
    }
    updateCamera(0);
    battleWarmup = await warmBattleRendering({ renderer, scene, camera, update,
      prepareViews: () => {
        const restores = [nraCharacter, ijaCharacter].filter(Boolean)
          .map(force => force.prepareBattleViews(allForces, time, entities.control.soldierId));
        restores.push(combatEffects.prepareBattleViews());
        return () => { for (const restore of restores) restore(); };
      },
      onProgress: progress => setLoadingProgress(90 + Math.floor(progress * 10), '正在准备战场画面…') });
    frameWork.reset(); adaptiveAI.reset(); automaticQuality.leaveBattle();
    lastFrame = performance.now();
    setGameState('playing'); bindControlInput();
    if (!campaign.hidden && !campaign.locked) missionBriefing.show(campaign, performance.now() / 1000);
    battleVoiceEvent('deploy');
    $('loading').hidden = true;
  } finally { battlePreparing = false; }
}

function deploy(squadId, spawnId = null, prepare = false) {
  if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && time < sihangCampaign.coverRespawnAt) {
    toast(`掩护队补充中 · ${Math.ceil(sihangCampaign.coverRespawnAt - time)}秒`); return;
  }
  if (sihangCampaignMode && (squadId !== 'infantry' || !sihangDeploymentCount(sihangCampaign))) {
    toast(sihangCampaign.outcome ? '本次战斗已结束' : '400人兵力池已用尽，等待其余守军撤离');
    return;
  }
  const type = SQUADS[squadId]?.type;
  const blocked = deploymentBlockReason(state, allies, squadId, unit?.squadId);
  if (blocked) {
    $('deployment-error').textContent = blocked;
    toast(blocked, 4);
    return;
  }
  if (benchmark?.diagnostic && type !== (['control', 'ford'].includes(benchmark.scenario) ? 'tank' : 'infantry')) { toast('当前诊断场景的出击类型固定；正常出击使用无benchmark参数的网址'); return; }
  refreshCapturedSpawns(type);
  const openingSpawnId = nanjingCampaignMode && deployments === 0 && !spawnId ? 'nanjing-gate-front-0' : null;
  const allowedSihangSpawn = point => !sihangCampaignMode || (sihangCampaign.stage === 'sihang-retreat'
    ? point.retreatOnly : !point.retreatOnly && !point.id.startsWith('sihang-retreat-') && point.id !== 'sihang-bridge-cover');
  const spawn = openingSpawnId ? spawnPoints.find(point => point.id === openingSpawnId) : spawnPoints.find(point => allowedSihangSpawn(point) && (spawnId ? point.id === spawnId : !point.aiOnly && point.team === 'friendly' &&
    point.kind !== 'rally' && supportsSquad(point, type)) && (!nanjingCampaignMode ||
    isNanjingSpawnAvailable(point, nanjingCampaign.dockActivated) || deployments === 0 && point.initialOnly));
  const spawnError = !spawn || spawn.team !== 'friendly' || spawn.aiOnly ? '请选择己方可用重生点' : spawnBlockReason(spawn, type, hostilePositions('friendly'), deploymentObstacles());
  if (spawnError) {
    $('deployment-error').textContent = spawnError;
    toast(spawnError, 4);
    return;
  }
  const formation = formations.find(item => item.player);
  if (!formation) { toast('请从作战部署开始新战局'); return; }
  if (nanjingCampaignMode) nanjingCampaign.playerBoardingBoatId = null;
  if (isVehicleUnit(type) && [...entities.vehicles.values()].filter(item => item.team === 'friendly' && item.health > 0).length >= BATTLE_RULES.vehicleLimit) {
    toast('我方载具单位已达到2个上限'); return;
  }
  let positions = [];
  const memberCount = sihangCampaignMode ? sihangDeploymentCount(sihangCampaign) : benchmark?.diagnostic ? formation.memberCount : TYPES[type].members;
  const initialPitch = type === 'mortar' ? -.18 : 0;
  try {
    if (type !== 'tank' && type !== 'plane') positions = formationPositions(spawn, memberCount, deploymentObstacles(),
      deploymentOccupiedPositions([...friendlyAI, ...enemies]), hostilePositions('friendly'));
  } catch (error) {
    if (!(error instanceof FormationPlacementError)) throw error;
    $('deployment-error').textContent = error.message; toast(error.message); return;
  }
  clearActors(allies, true);
  if (weapon) {
    camera.remove(weapon);
    // View models own only their hierarchy; their geometry/materials are shared.
    weapon = null;
  }
  allies = [];
  const active = objectives.find(point => !point.captured);
  deployments++;
  resetDeathTransfer(deathTransfer);
  releaseSupportWeapon(entities, formation);
  formation.type = type; formation.squadId = squadId;
  registerBattleScore(formation);
  if (type === 'mortar') formation.supportWeapon = registerWeapon(entities, { ammo: TYPES.mortar.magazine, nextShot: 0, reloadUntil: 0 },
    `${formation.id}:mortar-${deployments}`, formation.id, 'mortar');
  current = 0;
  for (let i = 0; i < memberCount; i++) {
    const position = type === 'tank' || type === 'plane' ? spawn : positions[i];
    const actor = actorAt(true, position.x, position.z, i, spawn, formation);
    actor.lookPitch = initialPitch;
    actor.health = type === 'tank' ? 100 : TYPES[type].health;
    if (type !== 'infantry') actor.role = type === 'mortar' ? 'mortarman' : type === 'tank' ? 'tanker' : 'pilot';
    actor.targetKind = type === 'tank' ? 'closed-armor' : type === 'plane' ? 'aircraft' : 'person';
    allies.push(actor);
  }
  formation.type = type; formation.members = allies; formation.spawnId = spawn.id; formation.generation++;
  if (sihangCampaignMode) registerSihangDeployment(sihangCampaign, allies.length, allies);
  rebuildForces();
  entities.control.unitId = formation.id;
  selectControlledSoldier(entities, allies[0]);
  unit = createControlView(entities);
  controlPose.yaw = nanjingCampaignMode && !nanjingCampaign.dockActivated ? Math.PI : 0;
  recoil = 0; resetPersonalCombatFeedback();
  weaponObstruction = obstructionBlend = 0;
  lastRifleTrace = null;
  controlPose.stance = 'standing';
  lean = jumpHeight = jumpVelocity = 0;
  eyeHeight = controlPose.eyeHeight;
  if (type === 'tank' || type === 'plane') {
    const transport = createVehicleEntity(entities, { id: `${formation.id}:vehicle-${deployments}`, unitId: formation.id, type,
      team: 'friendly', position: new THREE.Vector3(spawn.x, type === 'plane' ? spawn.altitude : world.groundHeight(spawn.x, spawn.z), spawn.z) });
    transport.pitch = controlPose.pitch;
    if (type === 'plane') transport.flightControl = createAircraftControl(transport);
    formation.vehicleId = transport.id;
    for (let i = 0; i < allies.length; i++) {
      const reason = seatSoldier(entities, allies[i], transport, transport.seats[i].id);
      if (reason) throw new Error(reason);
    }
    vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
  }
  weapon = weaponModel(type, controlledSoldier(entities).rifle, occupiedSeat(entities)?.role ?? 'commander');
  weapon.traverse(mesh => {
    if (mesh.isMesh) {
      mesh.castShadow = false;
      mesh.frustumCulled = false;
    }
  });
  camera.add(weapon);
  if (type === 'infantry') weapon.position.set(.18, -.22, -.14);
  toolEquipped = false;
  resetConstruction();
  $('unit-title').textContent = formation.customIdentity ? formation.historicalName
    : formation.historicalName?.replace(/^国民革命军/, '') ?? SQUADS[squadId].name;
  $('unit-title').title = `${formation.historicalName ?? SQUADS[squadId].name} · ${SQUADS[squadId].name}`;
  $('weapon-name').textContent = TYPES[type].weapon;
  $('ammo-max').textContent = `/ ${TYPES[type].magazine}`;
  $('aim-label').hidden = type !== 'mortar';
  $('squad-hint').textContent = type === 'plane' ? '单机出击 · 飞机损失后换队' : type === 'infantry' ? '' : 'Y 切换队员 · 整队阵亡后换队';
  if (sihangCampaignMode && memberCount < 11)
    $('squad-hint').textContent = `最后 ${memberCount} 人补充 · 全军累计400人已全部投入 · Y换人`;
  $('squad-hint').hidden = !$('squad-hint').textContent;
  updateControlHelp();
  allies.forEach(actor => { actor.order = 'follow'; });
  $('overlay').hidden = true;
  pendingSquad = pendingSpawn = null;
  setGameState(prepare ? 'pause' : 'playing');
  refreshWeaponVisibility();
  bindControlInput();
  hudAt = 0;
  initAudio();
  if (!prepare) battleVoiceEvent('deploy');
  if (encirclementMode) for (const cue of encirclementVoiceTracker.update(encirclement, objectives, formations)) {
    battleVoiceEvent(cue, { eventKey: `encirclement:${cue}` });
  }
  if (benchmark?.scenario !== 'shop-art') lockMouse();
  updateCamera(0);
  renderConstruction();
  toast(type === 'plane' ? '从南侧空中入场点进入战场 · 飞机损失后可换其他小队' : `${TYPES[type].name}从${spawn.name}出击`, 5);
  if ((audioUnsupported || rifleAudioFailure || footstepAudioFailure || mechanicalAudioFailure || battleVoicesFailure || battleReactionsFailure || civilianVoicesFailure || sihangVoicesFailure) && !audioWarningShown) {
    const warnings = [];
    if (rifleAudioFailure) warnings.push('步枪录音未加载，暂用原合成声；友军／敌军空间枪声暂不可用');
    if (footstepAudioFailure) warnings.push('脚步录音未加载，暂用原合成声');
    if (mechanicalAudioFailure) warnings.push('步枪机械录音未加载，暂用原合成声');
    if (battleVoicesFailure) warnings.push('战场语音未加载，喊话与指挥提示不可用');
    if (civilianVoicesFailure) warnings.push('百姓语音未加载，城中与渡口对白不可用');
    if (sihangVoicesFailure) warnings.push('四行仓库指挥与南岸百姓语音未加载；仍保留文字警报');
    if (battleReactionsFailure) warnings.push('真人战斗反应录音未加载，短喊与受击人声不可用');
    toast(audioUnsupported ? '浏览器不支持Web Audio，当前无音效' : warnings.join('；'), 8);
    audioWarningShown = true;
  }
  updateHUD();
}

function showOverlay(kind = 'pause') {
  $('end-civilian-wait').hidden = true;
  if (kind === 'dead' && sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && !sihangCampaign.outcome)
    sihangCampaign.coverRespawnAt = Math.max(sihangCampaign.coverRespawnAt, time + SIHANG_RULES.coverRespawnSeconds);
  if (kind === 'dead' && sihangCampaignMode && sihangCampaign.outcome) {
    if (battleEnding.fading || battleEnding.complete) return;
    kind = sihangCampaign.outcome === 'evacuated' ? 'victory' : 'defeat';
  }
  if (['victory', 'defeat', 'draw'].includes(kind) && !battleEnding.complete) {
    if (battleEnding.start(kind, performance.now(), endingNarration[kind]?.duration ?? 0)) {
      $('battle-ending').hidden = false;
      $('battle-ending').style.opacity = '0';
      $('battle-ending').dataset.phase = 'fade';
      $('battle-ending-page').hidden = true;
      $('battle-ending-continue').hidden = true;
      $('battle-ending-warning').hidden = true;
      battleVoices?.sync(false); civilianVoices?.sync(false); sihangVoices?.sync(false); battleSignals?.sync(false);
      if (endingNarration[kind] && audioContext?.state === 'running')
        endingVoice = playEndingNarration(audioContext, endingNarration[kind], audioMixer.output('voices'));
      else {
        $('battle-ending-warning').textContent = `结尾旁白暂不可用：${endingNarrationFailures[kind] ?? '音效尚未启用或未加载完成'}`;
        $('battle-ending-warning').hidden = false;
        battleVoiceEvent(kind, { eventKey: `match:${kind}` });
      }
    }
    return;
  }
  if (kind === 'dead' && battleEnding.fading) { setGameState('dead'); return; }
  delete $('overlay').dataset.deploymentStep;
  $('confirm-identity').hidden = true;
  $('takeover-sihang-squad').hidden = true;
  $('player-identity').hidden = true;
  $('initial-identity-slot').hidden = true;
  $('deployment-campaign-context').hidden = true;
  if (kind === 'pause') pausedFrom = state === 'transferring' ? 'transferring' : 'playing';
  else resetDeathTransfer(deathTransfer);
  setGameState(kind);
  releaseMouse();
  $('overlay').hidden = false;
  $('battle-summary').hidden = false;
  $('back-menu').textContent = '返回作战大厅';
  const ended = ['victory', 'defeat', 'draw'].includes(kind);
  if (ended && !battleEnding.complete) battleVoiceEvent(kind, { eventKey: `match:${kind}` });
  const dead = kind === 'dead';
  if (ended || dead) missionBriefing.hide();
  $('battle-results').hidden = !ended;
  if (ended) {
    renderCasualtyStats($('result-casualties')); renderSquadScores($('result-squad-scores'));
    const playerScore = battleStats.snapshot.find(row => row.player);
    $('result-player-score').hidden = !playerScore;
    $('result-player-score').textContent = playerScore
      ? `${playerScore.name} · 累计击杀 ${playerScore.total} · 击毁载具 ${playerScore.vehicles}` : '';
  }
  $('overlay').classList.toggle('deployment-overlay', dead);
  $('confirm-deploy').hidden = !dead;
  $('deployment-help').hidden = ended;
  $('encirclement-controls').hidden = !encirclementMode;
  $('deployment-help').open = !dead && !ended;
  $('overlay').querySelector('[data-build-version]').hidden = ended || kind === 'pause';
  $('overlay-description').hidden = kind === 'victory' && !nanjingCampaignMode;
  resetConstruction();
  renderConstruction();
  $('overlay-kicker').textContent = kind === 'victory' ? '作战胜利 / VICTORY' : kind === 'defeat' ? nanjingCampaignMode ? '守土尽忠 / IN MEMORIAM' : '作战失利 / DEFEAT' : kind === 'draw' ? '战局持平 / DRAW' : dead ? '整队阵亡 / REDEPLOY' : '作战暂停 / PAUSED';
  $('overlay-title').textContent = nanjingCampaignMode && kind === 'victory' ? '你已登船，撤离南京。'
    : nanjingCampaignMode && kind === 'defeat' ? '为国捐躯，山河永记。'
      : kind === 'victory' ? encirclementMode ? '城东阻击告捷。' : '阵地已夺，山河犹在。' : kind === 'defeat' ? encirclementMode && encirclement.phase === 2 ? '敌军突破东门，阻击失利。' : '阵地失守，战线未竟。' : kind === 'draw' ? '时间耗尽，双方未分胜负。' : dead ? '重整队伍，再出发。' : '下一步，由你指挥。';
  const victoryRule = encirclementMode ? encirclement.phase === 2
    ? `本阶段地面敌军已全部被歼或逃脱。合围残敌${encirclement.breakout?.strength ?? 0}人，已歼${encirclement.breakout?.killed ?? 0}人、逃出${encirclement.breakout?.escapedIds.length ?? 0}人；歼灭至少2/3且逃出不超过1/3获胜。`
    : kind === 'defeat' ? '日军连续控制三个据点90秒，反夺宽限耗尽，我方合围失败。'
    : '三点合围后转为城东突围阻击。'
    : conquest.dominationTime >= DOMINATION_SECONDS ? '连续控制三点20秒。' : '时间结束：先比较控制点数，同分比较累计控制点秒。';
  $('overlay-description').textContent = ended ? victoryRule : dead ? '选择小队卡片，点击地图上的己方出生标记，再确认出击。允许再次选择同类型新小队；战斗与计时仍在继续。' : encirclementMode ? '第一阶段占领三个据点形成合围；第二阶段在C点周围布防，20秒后阻击日军穿过东门。' : '三点同时争夺，双方可占领和反夺；连续控制三点20秒获胜。整队阵亡后才能换单位。';
  if (nanjingCampaignMode) $('overlay-description').textContent = ended
    ? `已掩护 ${nanjingCampaign.civiliansArrived} 名百姓到达上新河渡口，其中 ${nanjingCampaign.civiliansEvacuated} 名已撤离南京，免于日军屠刀。${kind === 'defeat' ? nanjingCampaign.outcome === 'gate-overrun' ? '中华门第二道门内阵地失守，城市入口被突破，守军战至最后。' : '渡口失守，守军战至最后。' : '你是最后一批撤离的守军。'}`
    : dead ? '选择其他小队和可用重生点，再确认出击。战斗与计时仍在继续。'
      : '守住中华门防线，随后撤往上新河渡口掩护百姓登船，最后撤离。';
  else if (encirclementMode && !ended && !dead) $('overlay-description').textContent =
    '第一阶段夺取三点形成合围；第二阶段先在C点周围布防20秒，日军分组集结后向东门突围并还击。歼灭至少2/3、逃脱不超过1/3为胜利目标；全部地面敌军被歼或逃脱后才结算。';
  $('resume').hidden = ended || dead;
  const stranded = nanjingCampaignMode && kind === 'pause' && nanjingCampaign.stage === 'withdrawal-to-boats'
    ? stalledCivilianCandidates(world.civilians, time).length : 0;
  $('end-civilian-wait').hidden = stranded === 0;
  $('end-civilian-wait').dataset.confirm = '';
  $('end-civilian-wait').textContent = `结束等待 · 将卡住的 ${stranded} 人记为未救出`;
  if (kind === 'victory') $('overlay-description').textContent = '';
  $('redeploy-choices').hidden = !canDeploySquad(kind, allies);
  $('deployment-options').hidden = !dead;
  $('pause-settings').hidden = kind !== 'pause';
  $('pause-settings').open = false;
  $('motion-settings').hidden = kind !== 'pause';
  $('control-settings').hidden = kind !== 'pause';
  $('audio-settings').hidden = kind !== 'pause';
  $('quality-settings').hidden = kind !== 'pause';
  pendingSquad = pendingSpawn = null;
  $('deployment-error').textContent = '';
  if (dead) refreshDeployment();
  $('battle-summary').textContent = nanjingCampaignMode
    ? `个人击倒 ${kills}　友军击倒 ${teamKills}　百姓到达渡口 ${nanjingCampaign.civiliansArrived}　已撤离 ${nanjingCampaign.civiliansEvacuated}　被日军击毙 ${nanjingCampaign.civilianCasualties}　未救出 ${nanjingCampaign.civiliansUnrescued}`
    : `个人击倒 ${kills}　友军击倒 ${teamKills}　我方控制 ${objectives.filter(p => p.owner === 'friendly').length}/3 · 日军 ${objectives.filter(p => p.owner === 'enemy').length}/3`;
  if (encirclementMode && encirclement.breakout) $('battle-summary').textContent =
    `个人击倒 ${kills}　友军击倒 ${teamKills}　合围残敌 ${encirclement.breakout.strength}　已歼 ${encirclement.breakout.killed}　逃脱 ${encirclement.breakout.escapedIds.length}/${encirclement.breakout.escapeLimit}`;
  if (sihangCampaignMode) {
    $('overlay-kicker').textContent = ended ? kind === 'victory' ? '掩护撤离 / EVACUATED' : '历史铭记 / IN MEMORIAM'
      : dead ? '后备补充 / REINFORCEMENT' : '四行仓库 / SIHANG';
    $('overlay-title').textContent = ended ? kind === 'victory' ? '守军已过桥，山河终有归期。' : '守军的牺牲，历史永远铭记。'
      : dead ? sihangDeploymentCount(sihangCampaign) ? '补充新班，继续掩护。' : '补充额度已尽，友军仍在坚守。' : '坚守仓库，掩护撤离。';
    $('overlay-description').hidden = false;
    $('overlay-description').textContent = ended
      ? `累计参战 ${sihangCampaign.deployed}/400 人。${sihangCampaign.outcome === 'occupied' ? '一楼阵地被日军占领。' : sihangCampaign.outcome === 'timeout' ? '撤离时限已尽。' : ''}铭记每一位守军与对岸守望的百姓。`
      : '前往仓库南面，抵达后首批出发。玩家可留在北岸掩护或提前过桥；南岸禁火。无撤退时限，全员去向确定后结算。';
    const retreat = sihangRetreatStatus(sihangCampaign);
    $('battle-summary').textContent = sihangCampaign.stage === 'sihang-retreat'
      ? `将士400人　牺牲 ${retreat.casualties}　安全撤离 ${retreat.saved}　尚未撤离 ${retreat.unresolved}　${retreat.grade}`
      : `个人击倒 ${kills}　友军击倒 ${teamKills}　累计参战 ${sihangCampaign.deployed}/400　后备 ${sihangCampaign.reserve}`;
  }
}

function refreshCapturedSpawns(type) {
  if (encirclementMode || nanjingCampaignMode || sihangCampaignMode) return;
  spawnPoints = spawnPoints.filter(point => !point.objectiveId);
  if (benchmark?.diagnostic) return;
  if (type !== 'infantry') return;
  const base = spawnPoints.find(point => point.id === 'china-base');
  const hostiles = hostilePositions('friendly'), obstacles = deploymentObstacles();
  const occupied = allForces.filter(actor => actor.health > 0).map(actor => actor.position);
  spawnPoints.push(...capturedSpawnPoints(objectives, base, type, point => {
    if (Math.hypot(point.x - base.x, point.z - base.z) < 12) return false;
    if (spawnBlockReason(point, type, hostiles, obstacles)) return false;
    const height = world.walkHeight(point.x, point.z, world.groundHeight(point.x, point.z));
    if (Math.abs(height - world.groundHeight(point.x, point.z)) > .2) return false;
    if (type === 'tank') return [-1, 1].every(side =>
      Math.abs(world.groundHeight(point.x + side * 2, point.z) - height) < .2 &&
      Math.abs(world.groundHeight(point.x, point.z + side * 2) - height) < .2);
    try {
      const positions = formationPositions(point, TYPES.infantry.members, obstacles, occupied, hostiles);
      return positions.every(position => Math.abs(world.walkHeight(position.x, position.z, height) - height) < .25);
    } catch (error) {
      if (!(error instanceof FormationPlacementError)) throw error;
      return false;
    }
  }));
}

export function showInitialSquadDeployment() {
  if (state !== 'menu') throw new Error('Initial squad selection requires the lobby state');
  $('takeover-sihang-squad').hidden = true;
  if (deployments > 0) {
    deployments = 0;
    objectives = sihangCampaignMode ? sihangObjectives() : nanjingCampaignMode ? createNanjingObjectives()
      : encirclementMode ? encirclementObjectives() : makeObjectives(battleLayout.objectives);
    nanjingCampaign = nanjingCampaignMode ? createNanjingCampaign() : null;
    sihangCampaign = sihangCampaignMode ? createSihangCampaign() : null;
    encirclement = createEncirclement(); conquest = createConquest();
    pendingSquad = pendingSpawn = null;
    resetSpawns();
  }
  $('menu').hidden = true; $('overlay').hidden = false;
  $('overlay').classList.add('deployment-overlay');
  $('overlay').dataset.deploymentStep = 'squad';
  $('initial-identity-slot').hidden = $('player-identity').hidden = true;
  $('deployment-campaign-context').hidden = true;
  $('confirm-identity').hidden = true;
  $('confirm-deploy').hidden = false;
  $('redeploy-choices').hidden = $('deployment-options').hidden = false;
  for (const id of ['resume', 'battle-summary', 'battle-results', 'pause-settings']) $(id).hidden = true;
  $('overlay-kicker').textContent = '小队与阵地 / DEPLOY';
  $('overlay-title').textContent = '选择小队与出生点';
  $('overlay-description').hidden = false;
  $('overlay-description').textContent = `${campaign.name} · 已默认选择步兵与可用阵地，可直接出击，也可自行改选。`;
  $('back-menu').textContent = '返回番号选择';
  $('deployment-help').hidden = false; $('deployment-help').open = false;
  $('overlay').querySelector('[data-build-version]').hidden = true;
  $('overlay').querySelector('.dialog').scrollTop = 0;
  getMenuMusic().setState('deployment');
  refreshDeployment();
}

function chooseDeploymentSquad(id) {
  if (sihangCampaignMode && (id !== 'infantry' || !sihangDeploymentCount(sihangCampaign))) return false;
  const type = SQUADS[id]?.type;
  const reason = sihangCampaignMode && !sihangDeploymentCount(sihangCampaign) ? '后备已耗尽或友军已撤完'
    : deploymentBlockReason(state, allies, id, unit?.squadId);
  if (reason) { $('deployment-error').textContent = reason; return false; }
  pendingSquad = id;
  refreshCapturedSpawns(type);
  const candidates = deploymentSpawnChoices(type).filter(point =>
    !spawnBlockReason(point, type, hostilePositions('friendly'), deploymentObstacles()));
  const preferred = nanjingCampaignMode
    ? state === 'menu' && deployments === 0 ? 'nanjing-gate-front-0'
      : nanjingCampaign.dockActivated ? 'nanjing-west-dock' : 'nanjing-gate' : null;
  pendingSpawn = candidates.find(point => point.id === preferred)?.id ??
    recommendedSpawn(candidates, type, objectives, () => true)?.id ?? null;
  $('deployment-error').textContent = pendingSpawn ? '' : '当前没有可用出生点，请等待阵地恢复或选择其他小队。';
  return true;
}

function sihangTakeoverCandidate() {
  if (!sihangCampaignMode || state !== 'dead' || sihangCampaign.outcome ||
    sihangDeploymentCount(sihangCampaign) || allies.some(actor => actor.health > 0)) return null;
  const saved = new Set(sihangCampaign.evacuatedIds), lost = new Set(sihangCampaign.retreatLostIds);
  let gunner = null;
  for (const formation of formations) {
    if (formation.team !== 'friendly' || formation.player || formation.type !== 'infantry') continue;
    const members = formation.members.filter(actor => friendlyAI.includes(actor) && actor.health > 0 && !actor.youngSoldier &&
      !actor.grenades.action &&
      !actor.vehicleId && !actor.sihangEvacuated && !saved.has(actor.id) && !lost.has(actor.id) &&
      !(sihangCampaign.stage === 'sihang-retreat' && sihangCampaign.assemblyReleased && sihangSafePosition(actor.position)) &&
      (sihangCampaign.stage !== 'sihang-retreat' || sihangCampaign.aiRetreatIds.includes(actor.id)));
    const available = members.filter(actor => !actor.dying && !actor.fatalFall && !actor.blastReaction);
    const selected = available.find(actor => !actor.emplacementId);
    if (selected) return { formation, members, selected };
    if (!gunner && available.length) gunner = { formation, members, selected: available[0] };
  }
  return gunner;
}

function takeOverSihangSquad() {
  const candidate = sihangTakeoverCandidate();
  if (!candidate) { refreshDeployment(); toast('当前没有可接管的存活友军'); return; }
  const playerFormation = formations.find(formation => formation.player);
  if (!playerFormation) throw new Error('Sihang takeover requires the player formation');
  const { formation, members, selected } = candidate;
  if (sihangCampaign.stage === 'sihang-retreat') transferSihangRetreatSquad(sihangCampaign, members);
  clearControlInputs();
  clearActors(allies, true);
  const ids = new Set(members.map(actor => actor.id));
  formation.members = formation.members.filter(actor => !ids.has(actor.id));
  friendlyAI = friendlyAI.filter(actor => !ids.has(actor.id));
  for (const actor of members) {
    cancelEngineer(actor.engineer);
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.tactics.cover = actor.path = actor.pathGoal = actor.target = null;
    pathRequests.delete(actor.tactics.id);
    actor.playerUnit = true; actor.formation = playerFormation; actor.unitId = playerFormation.id;
    actor.order = 'follow';
  }
  allies = members; playerFormation.members = allies;
  current = allies.indexOf(selected);
  entities.control.unitId = playerFormation.id;
  if (!selectControlledSoldier(entities, selected)) throw new Error('Cannot select the transferred soldier');
  unit = createControlView(entities);
  resetDeathTransfer(deathTransfer);
  rebuildForces();
  pendingSquad = pendingSpawn = null;
  $('takeover-sihang-squad').hidden = true;
  $('overlay').hidden = true;
  setGameState('playing');
  bindControlInput();
  refreshControlSurface();
  updateCamera(0);
  updateHUD();
  lockMouse();
  toast('已接管战场上的友军小队 · 人员和装备保持原状', 5);
}

function refreshDeployment() {
  if (state !== 'dead' && !(state === 'menu' && $('overlay').dataset.deploymentStep === 'squad')) return;
  const noSihangReserve = sihangCampaignMode && !sihangDeploymentCount(sihangCampaign);
  const takeover = state === 'dead' && noSihangReserve && !sihangCampaign.outcome;
  $('takeover-sihang-squad').hidden = !takeover;
  $('takeover-sihang-squad').disabled = takeover && !sihangTakeoverCandidate();
  if (noSihangReserve) pendingSquad = pendingSpawn = null;
  if (sihangCampaignMode && state === 'dead') {
    $('overlay-title').textContent = noSihangReserve ? '后备兵力已耗尽。' : '补充新班，继续掩护。';
    $('overlay-description').textContent = noSihangReserve
      ? '无法补充新兵；可接管战场上的存活友军小队，或等待剩余守军撤离。'
      : '前往仓库南面，抵达后首批出发。玩家可留在北岸掩护或提前过桥；南岸禁火。无撤退时限，全员去向确定后结算。';
    if (sihangCampaign.stage === 'sihang-retreat') {
      const retreat = sihangRetreatStatus(sihangCampaign);
      $('battle-summary').textContent = `将士400人　牺牲 ${retreat.casualties}　安全撤离 ${retreat.saved}　尚未撤离 ${retreat.unresolved}　${retreat.grade}`;
    }
  }
  if (!pendingSquad) chooseDeploymentSquad('infantry');
  for (const button of $('redeploy-choices').querySelectorAll('[data-type]')) {
    const id = button.dataset.type;
    const type = SQUADS[id].type;
    const reason = noSihangReserve ? '后备兵力已耗尽' : deploymentBlockReason(state, allies, id, unit?.squadId);
    button.disabled = Boolean(reason);
    button.classList.toggle('selected', pendingSquad === id);
    button.setAttribute('aria-pressed', String(pendingSquad === id));
    button.querySelector('small').textContent = reason || `${sihangCampaignMode ? sihangDeploymentCount(sihangCampaign) : TYPES[type].members} 人 · 新小队可出击`;
  }
  $('deployment-objective').textContent = sihangCampaignMode
    ? `四行仓库 · ${sihangCampaign.stage === 'sihang-defense' ? `一楼集结 · 后备 ${sihangCampaign.reserve}/400`
      : `仓库南面补充 · 剩余兵力 ${sihangCampaign.reserve}`}`
    : state === 'menu' ? '首次出击 · 初始阵地' : nanjingCampaignMode
    ? ({ 'gate-defense': '第一阶段 · 中华门第二道门内阵地防守', withdrawal: '撤往上新河渡口 · 第二阶段即将开始',
      'dock-defense': '第二阶段 · 上新河渡口防守', 'withdrawal-to-boats': '撤退阶段 · AI小队先登船' }[nanjingCampaign.stage] ?? '南京保卫战')
    : encirclementMode && encirclement.phase === 2
    ? `第二阶段 · 守住东门 · 已歼 ${encirclement.breakout?.killed ?? 0}/${encirclement.breakout?.requiredKills ?? 0} · 突围 ${encirclement.breakout?.escapedIds.length ?? 0}/${encirclement.breakout?.escapeLimit ?? 0}`
    : `三点合围 · 我方 ${objectives.filter(point => point.owner === 'friendly').length}/3 · 日军 ${objectives.filter(point => point.owner === 'enemy').length}/3`;
  const pendingType = SQUADS[pendingSquad]?.type;
  refreshCapturedSpawns(pendingType);
  $('deployment-selection').textContent = noSihangReserve ? '没有可部署的后备兵力'
    : pendingSquad ? `${SQUADS[pendingSquad].name} · 点击地图选择出生位置` : '先选择小队卡片，再点击地图上的己方出生标记。';
  const candidates = pendingSquad ? deploymentSpawnChoices(pendingType) : [];
  const hostiles = hostilePositions('friendly');
  const markerPositions = deploymentMarkerPositions(candidates, deploymentMapView(sihangCampaignMode ? 'sihang' : nanjingCampaignMode ? nanjingCampaign.stage : null));
  const signature = candidates.map(point => point.id).join(',');
  if ($('spawn-choices').dataset.signature !== signature) {
    $('spawn-choices').replaceChildren(...candidates.map(point => deploymentMarker(point, pendingType)));
    $('spawn-choices').dataset.signature = signature;
  }
  for (const button of $('spawn-choices').querySelectorAll('[data-spawn]')) {
    const point = candidates.find(candidate => candidate.id === button.dataset.spawn);
    const reason = spawnBlockReason(point, pendingType, hostiles, deploymentObstacles());
    button.disabled = Boolean(reason);
    button.classList.toggle('selected', pendingSpawn === point.id);
    button.setAttribute('aria-pressed', String(pendingSpawn === point.id));
    const position = markerPositions.find(marker => marker.id === point.id);
    button.style.left = `${position.x}%`;
    button.style.top = `${position.y}%`;
    const nearest = objectives.reduce((a, b) => Math.hypot(a.x - point.x, a.z - point.z) <= Math.hypot(b.x - point.x, b.z - point.z) ? a : b);
    const detail = reason || (nanjingCampaignMode
      ? point.allowNearbyEnemies ? '渡口附近分散重生 · 不因近敌关闭'
        : point.kind === 'rally' ? `工兵建造 · 耐久 ${Math.ceil(point.health)}` : point.layout === 'wall' ? '城墙高处 · 可部署' : '默认重生点'
      : `${point.permanent ? '永久启用 · ' : ''}距${nearest.id} ${Math.round(Math.hypot(nearest.x - point.x, nearest.z - point.z))}米`);
    button.querySelector('small').textContent = detail;
    button.title = `${point.name} · ${detail}`;
    button.setAttribute('aria-label', button.title);
  }
  const selected = candidates.find(point => point.id === pendingSpawn);
  const blocked = selected ? spawnBlockReason(selected, pendingType, hostiles, deploymentObstacles()) : null;
  if (pendingSpawn && !selected) pendingSpawn = null;
  if (selected) $('deployment-selection').textContent = `${SQUADS[pendingSquad].name} · ${selected.name}${blocked ? ' · 暂不可用' : ' · 已选择'}`;
  $('confirm-deploy').disabled = !pendingSquad || !selected || Boolean(blocked);
  $('confirm-deploy').firstChild.textContent = pendingSquad ? `部署${SQUADS[pendingSquad].name} ` : '选择小队后出击 ';
  if (noSihangReserve) $('deployment-error').textContent = '后备兵力已耗尽，无法部署新小队。';
  else if (blocked) $('deployment-error').textContent = blocked;
  else if (selected) $('deployment-error').textContent = '';
  drawRadar($('deployment-map').getContext('2d'), true);
}

function deploymentSpawnChoices(type) {
  if (sihangCampaignMode && (!sihangDeploymentCount(sihangCampaign) || type !== 'infantry')) return [];
  return type ? spawnPoints.filter(point => !point.aiOnly && point.team === 'friendly' &&
    (!sihangCampaignMode || (sihangCampaign.stage === 'sihang-retreat'
      ? point.retreatOnly : !point.retreatOnly)) &&
    supportsSquad(point, type) && (!nanjingCampaignMode ||
      isNanjingSpawnAvailable(point, nanjingCampaign.dockActivated) ||
      state === 'menu' && deployments === 0 && point.initialOnly)) : [];
}

function selectDeploymentSpawn(id) {
  if (!pendingSquad || state !== 'dead' && !(state === 'menu' && $('overlay').dataset.deploymentStep === 'squad')) return;
  const type = SQUADS[pendingSquad].type;
  const point = deploymentSpawnChoices(type).find(candidate => candidate.id === id);
  if (!point) return;
  const reason = spawnBlockReason(point, type, hostilePositions('friendly'), deploymentObstacles());
  if (reason) { $('deployment-error').textContent = reason; return; }
  pendingSpawn = point.id;
  $('deployment-error').textContent = '';
  refreshDeployment();
}

function resetConstruction() {
  const mortar = allies[current]?.mortar;
  if (mortar) stowMortar(mortar);
  cancelEngineer(allies[current]?.engineer);
  for (const preview of engineerPreviews.values()) preview.model.visible = false;
}

function equipTool(equipped) {
  if (equipped && (!['mortarman', 'engineer'].includes(allies[current]?.role) || allies[current]?.vehicleId)) {
    toast('只有迫击炮手或工兵配备专用工具；按 Y 切换队员');
    return;
  }
  resetConstruction();
  stowControlledDadao();
  grenadeEquipped = false;
  toolEquipped = equipped;
  if (equipped && allies[current].engineer)
    selectConstructionBlueprint(allies[current].engineer.construction, allies[current].id);
  playerInput.clearFire();
  held.primary = held.aiming = held.secondary = false;
  unit.nextShot = Math.max(unit.nextShot, time + .3);
  syncRifleUnit();
  renderEquippedTool();
  emitControlEvent('equipment.changed', { equipped });
}

function equipGrenade(kind = 'grenade') {
  throwableProfile(kind);
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0 || actor.vehicleId) { toast('请先离开载具再选择投掷装备'); return; }
  if (throwableStock(actor.grenades, kind) === 0) {
    toast(kind === 'grenade' ? '手榴弹已用完，保持当前装备' : '炸药包已用完，保持当前装备');
    return;
  }
  resetConstruction();
  stowControlledDadao();
  toolEquipped = false; grenadeEquipped = true;
  selectedThrowable = kind;
  playerInput.clearFire();
  held.primary = held.secondary = held.aiming = false;
  actor.rifleReady = false;
  refreshWeaponVisibility();
  $('weapon-name').textContent = `${kind === 'grenade' ? '手榴弹' : '炸药包'}${actor.dying || actor.fatalFall ? '' : ' · 左键准备／松开投掷'}`;
}

function equipPrimary() {
  stowControlledDadao();
  grenadeEquipped = false;
  if (unit.type === 'infantry') equipTool(false);
  else {
    playerInput.clearFire();
    held.primary = held.secondary = held.aiming = false;
    refreshControlSurface();
  }
}

function renderEquippedTool() {
  const equipped = toolEquipped;
  if (weapon) camera.remove(weapon);
  weapon = equipped ? selectedToolModel(allies[current]) : weaponModel(unit.type, allies[current].rifle);
  weapon.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = false; });
  camera.add(weapon);
  refreshWeaponVisibility();
  if (!equipped && unit.type === 'infantry') weapon.position.set(.18, -.22, -.14);
  $('weapon-name').textContent = equipped ? allies[current].engineer ? '工兵锤 · R选择阵地 · 长按左键建造20秒' : '轻型迫击炮 · 左键架设'
    : unit.type === 'infantry' ? infantryWeaponProfile(allies[current].rifle).name : TYPES[unit.type].weapon;
}

function stowControlledDadao() {
  const actor = controlledSoldier(entities);
  if (actor?.dadao) stowDadao(actor.dadao);
  dadaoEquipped = false;
}

function equipDadao() {
  const actor = controlledSoldier(entities);
  if (!actor?.dadao || actor.health <= 0 || actor.vehicleId) {
    toast('大刀仅供离开载具的我军士兵使用'); return;
  }
  resetConstruction();
  toolEquipped = grenadeEquipped = false;
  dadaoEquipped = true;
  drawDadao(actor.dadao, time);
  playerInput.clearFire();
  held.primary = held.secondary = held.aiming = false;
  actor.rifleReady = false;
  refreshControlSurface();
  dadaoViewRecovery.reset(weapon);
}

function swingDadao() {
  const actor = controlledSoldier(entities);
  if (sihangCeasefire(actor)) return;
  if (!dadaoEquipped || actor.vehicleId || actor.health <= 0) return;
  startDadaoSwing(actor.dadao, time);
}

function updatePlayerDadao(actor) {
  advanceDadao(actor.dadao, time);
  const origin = camera.position.clone(); origin.y -= .32;
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const target = selectDadaoTarget(actor.dadao, time, actor, origin, forward, allForces, targetAimPoint,
    (from, to) => hasLine(from, to, DADAO.reach + 1));
  if (!target) return;
  actor.dadao.connected = true; actor.dadao.hits++;
  hurt(target, DADAO.damage, captureAttackSource(entities, actor, actor.dadao), 'dadao');
}

function updateConstruction(dt, fireRequested = held.primary) {
  const actor = controlledSoldier(entities);
  if (actor.engineer) { updateEngineerConstruction(actor, dt); return; }
  const mortar = actor.mortar;
  if (!mortar) throw new Error('Equipped mortar requires its living owner');
  if (mortar.phase === 'setting-up' && time >= mortar.setupUntil) mortar.phase = 'ready';
  if (mortar.phase !== 'ready') return;
  if (!fireRequested) return;
  held.primary = false;
  if (!mortar.ammo) { toast('迫击炮弹已用完，按1使用步枪'); return; }
  if (time < mortar.nextShot) { toast('正在装填迫击炮'); return; }
  if (shells.length >= PROJECTILE_LIMIT) { toast('在飞炮弹已达上限，请等待'); return; }
  const target = calculateMortarTarget(actor.position, controlPose.yaw, mortar.distance, world.groundHeight);
  if (Math.abs(target.x) > 105 || Math.abs(target.z) > 105) { toast('弹着点位于地图外，请调整方向或射程'); return; }
  syncMortarDisplay();
  const start = emplacedMortar.userData.mortar.muzzle.getWorldPosition(new THREE.Vector3());
  const source = captureAttackSource(entities, actor, mortar);
  const shell = createProjectile({ id: `shell-${++projectileSerial}`, source, start, target, firedAt: time,
    duration: 1.6 + mortar.distance / 35, damage: MORTAR.damage, radius: MORTAR.radius });
  shell.blastKind = MORTAR.blastKind;
  const mesh = new THREE.Mesh(projectileGeometry, shellMaterial);
  mesh.userData.projectileId = shell.id; mesh.position.copy(shell.position); scene.add(mesh);
  shellViews.set(shell.id, mesh); shells.push(shell);
  mortar.ammo--; mortar.nextShot = time + MORTAR.reloadSeconds;
  combatEvents.publish('shot', { source, weaponType: 'mortar', start, end: new THREE.Vector3(target.x, target.y, target.z), sound: 'blast', recoil: 0 }, time);
}

function syncMortarDisplay() {
  const actor = controlledSoldier(entities), mortar = actor?.mortar;
  emplacedMortar.visible = Boolean(state === 'playing' && toolEquipped && mortar?.anchor && mortar.phase !== 'carrying');
  if (!emplacedMortar.visible) return;
  emplacedMortar.position.set(mortar.anchor.x, mortar.anchor.y, mortar.anchor.z);
  emplacedMortar.rotation.set(0, controlPose.yaw, 0);
  updateMortarModel(emplacedMortar, mortar.distance);
  emplacedMortar.updateMatrixWorld(true);
}

function renderConstruction() {
  syncMortarDisplay();
  const visible = toolEquipped && state === 'playing';
  $('construction-panel').hidden = !visible;
  $('mortar-objective-sight').hidden = !visible || allies[current]?.mortar?.phase !== 'ready';
  if (!visible) return;
  const engineer = allies[current].engineer;
  if (engineer) {
    $('mortar-objective-sight').hidden = true;
    const construction = engineer.construction;
    const actor = allies[current], candidate = engineerPlacement(actor.position, controlPose.yaw);
    candidate.y = world.walkHeight(candidate.x, candidate.z, actor.position.y);
    const unfinished = !construction.site && findEngineerConstruction(engineer, actor.id, actor.position, candidate);
    for (const [profile, preview] of engineerPreviews) {
      preview.model.visible = Boolean(profile === engineer.selected && construction.blueprint && construction.preview);
      if (!preview.model.visible) continue;
      const position = unfinished?.site ?? construction.preview;
      const heading = unfinished?.heading ?? engineer.heading ?? actor.heading;
      Object.assign(preview.point, { x: position.x, z: position.z, heading, yaw: heading });
      preview.model.position.y = position.y; preview.model.userData.update();
    }
    $('construction-status').textContent = construction.blockedReason ??
      `${engineer.selected === 'maxim24' ? '机枪' : '火炮'}阵地 · ${unfinished ? '长按左键继续施工' : '长按左键20秒'} · R切换 · 材料 ${engineer.materials.maxim24}机枪／${engineer.materials.bofors75}火炮`;
    $('construction-fill').style.width = `${(unfinished?.progress ?? construction.progress) / ENGINEER.buildSeconds * 100}%`;
    return;
  }
  const mortar = allies[current].mortar;
  $('construction-status').textContent = mortar.phase === 'carrying' ? '左键架设 · 架设后不能移动'
    : mortar.phase === 'setting-up' ? '正在架设迫击炮…'
    : `${Math.round(mortar.distance)}米 · 鼠标左右方向／上下射程 · ${time < mortar.nextShot ? '自动装填中' : '左键发射'}`;
  $('construction-fill').style.width = `${mortar.phase === 'setting-up' ? Math.max(0, 1 - (mortar.setupUntil - time) / MORTAR.setupSeconds) * 100 : 0}%`;
  if (mortar.phase === 'ready') {
    const ranges = mortarObjectiveRanges(allies[current].position, controlPose.yaw, objectives);
    const centered = ranges.filter(point => point.centered).sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle))[0];
    $('mortar-target-distance').textContent = centered
      ? `${centered.id} · ${centered.name} · 实距 ${Math.round(centered.distance)}米${centered.inRange ? '' : '（射程外）'}`
      : '鼠标左右对准据点标记，上下校准射程';
    $('mortar-range-setting').textContent = `${Math.round(mortar.distance)} m`;
    $('mortar-range-setting').setAttribute('aria-label', `迫击炮当前设置射程 ${Math.round(mortar.distance)}米`);
    $('mortar-objective-markers').replaceChildren();
    const halfFov = camera.fov * Math.PI / 360;
    for (const point of ranges) {
      if (Math.abs(point.angle) >= halfFov) continue;
      const marker = document.createElement('span');
      marker.className = point.centered ? 'mortar-objective-marker centered' : 'mortar-objective-marker';
      marker.style.left = `${50 - Math.tan(point.angle) / Math.tan(halfFov) * 50}%`;
      marker.textContent = `${point.id} · ${Math.round(point.distance)}米`;
      marker.title = point.name;
      $('mortar-objective-markers').append(marker);
    }
    $('mortar-objective-distances').textContent = ranges.map(point =>
      `${point.id} ${Math.round(point.distance)}米${point.inRange ? '' : '（射程外）'}`).join('　');
  }
}

function switchMember(index) {
  if (index === current || !allies[index] || allies[index].health <= 0 ||
    nanjingCampaignMode && allies[index].tactics.nanjingFerry?.phase === 'evacuated') return;
  if (allies[current]?.dying || allies[current]?.blastReaction) {
    if (!allies[current]?.dying) toast('暂时无法换人');
    return;
  }
  if (allies[current]?.health > 0 && allies[current].fatalFall) {
    return;
  }
  interruptGrenade(allies[current]);
  clearControlInputs();
  stopLocomotion(allies[current].locomotion);
  current = index;
  selectControlledSoldier(entities, allies[current]);
  if (!allies[current].vehicleId && allies[current].traversal.kind === 'grounded' && !hasFerrySupport(allies[current])) {
    const position = allies[current].position;
    position.y = landingHeight(position, position.y, movementObstacles(position.x, position.z), world.walkHeight);
  }
  if (allies[current].tactics.cover) coverClaims.delete(allies[current].tactics.cover.id);
  allies[current].tactics.cover = null;
  stopLocomotion(allies[current].locomotion);
  bindControlInput();
  unit.nextShot = Math.max(unit.nextShot, time + .35);
  refreshControlSurface();
  recoil = 0; rifleRecoil.clear();
  eyeHeight = controlPose.eyeHeight;
  emitControlEvent('control.changed', { index, reason: state === 'transferring' ? 'death' : 'manual' });
  if (nanjingCampaignMode && nanjingCampaign?.stage === 'withdrawal-to-boats') {
    const support = allies[current].tactics.nanjingFerry;
    if (support && ['boarding', 'aboard'].includes(support.phase)) {
      nanjingCampaign.playerBoardingBoatId = support.ferryId;
    } else if (nanjingCampaign.playerBoardingBoatId != null) {
      nanjingCampaign.playerBoardingBoatId = null;
      toast('当前队员仍在岸边，靠近有空位的木船按F登船。', 5);
    }
  }
}

function changeMember(index) {
  releaseEmplacement(controlledSoldier(entities));
  switchMember(index);
}

function focusEmplacement(actor) {
  if (state !== 'playing' || !actor || actor.health <= 0 || actor.vehicleId) return null;
  return [...emplacements.values()].filter(point => point.health > 0 && (!point.operatorId ||
    entities.soldiers.get(point.operatorId)?.team === actor.team) &&
    (!point.retreatCover || sihangCampaign?.stage === 'sihang-retreat') &&
    Math.abs(actor.position.y - (point.altitude ?? world.groundHeight(point.x, point.z))) < 1 &&
    Math.hypot(point.x - actor.position.x, point.z - actor.position.z) < 2.8)
    .sort((a, b) => Math.hypot(a.x - actor.position.x, a.z - actor.position.z) -
      Math.hypot(b.x - actor.position.x, b.z - actor.position.z))[0] ?? null;
}

function enterEmplacement(actor) {
  const point = focusEmplacement(actor);
  if (!point || actor.traversal.kind !== 'grounded' || actor.grenades.action) return false;
  if (!canOperateEmplacement(point, actor)) {
    toast('只能操作我军工兵建造的火炮或指定防御炮位'); return true;
  }
  return occupyEmplacement(point, actor);
}

function syncArtilleryCollision(point) {
  if(point.profile!=='bofors75')return;
  const updated=emplacementObstacles(point),previous=[];
  for(const collider of updated) {
    const existing=world.obstacles.find(obstacle=>obstacle.id===collider.id);
    if(!existing)throw new Error(`Missing mobile artillery collision: ${collider.id}`);
    previous.push({...existing});Object.assign(existing,collider);
  }
  const all=[...previous,...updated];
  const bounds={minX:Math.min(...all.map(box=>box.minX))-2,maxX:Math.max(...all.map(box=>box.maxX))+2,
    minZ:Math.min(...all.map(box=>box.minZ))-2,maxZ:Math.max(...all.map(box=>box.maxZ))+2};
  squadRoutes.clear();
  groundCollision.rebuild();aircraftCollision.rebuild();
  world.refreshNavigation?.([bounds]);refreshBattleNavigation([bounds]);
  if (nanjingCampaignMode) {
    world.civilianNavigate.refresh(bounds);civilianNavigationLookup.rebuild();civilianCrowdPlanner.invalidate();
  }
}

function occupyEmplacement(point, actor) {
  if (point.health <= 0 || !canOperateEmplacement(point, actor)) return false;
  if (point.weapon.settings.antiAircraft && actor !== controlledSoldier(entities) &&
    !(sihangCampaignMode && sihangCampaign.stage === 'sihang-defense' && actor.friendly && !actor.playerUnit &&
      sihangDefenseGoal(actor.formation.index, actor.index).stationId === point.id)) return false;
  const entry = emplacementEntry(point, point.altitude ?? world.groundHeight(point.x, point.z),
    operator => circleBlocked(operator.x, operator.z, .43,
      movementObstacles(operator.x, operator.z), operator.y));
  if (!entry) {
    toast(point.profile === 'bofors75' ? '炮位后方被挡住，无法进入' : '机枪操作位置被挡住，无法进入'); return true;
  }
  point.yaw = entry.yaw;
  if (point.view) point.view.userData.update();
  const { pose } = entry;
  for (const id of new Set([point.operatorId, point.crewId])) {
    const previous = entities.soldiers.get(id);
    if (previous && previous !== actor) {
      releaseEmplacement(previous, false);
      previous.tactics.stationCooldownUntil = time + 8;
    }
  }
  const personal = actor === controlledSoldier(entities);
  if (personal) resetControlledSimulation();
  releaseWeaponMount(actor.weaponMount);
  point.operatorId = actor.id; point.weapon.ownerId = actor.id; point.team = actor.team;
  point.crewId = null; actor.tactics.stationId = null;
  actor.emplacementId = point.id; actor.emplacementWeaponId = point.weapon.id;
  actor.position.set(pose.operator.x, pose.operator.y, pose.operator.z);
  actor.heading = point.yaw; actor.lookPitch = point.pitch;
  stopLocomotion(actor.locomotion);
  if (personal) {
    bindControlInput(); refreshWeaponVisibility();
    $('weapon-name').textContent = EMPLACEMENT_PROFILES[point.profile].name;
    toast(point.profile === 'bofors75' ? '1 炮手位 · 2 行军位 · WASD推炮／转向 · F 离开'
      : '左键射击 · 右键瞄准 · R 装填 · F 离开阵地');
  }
  return true;
}

function releaseEmplacement(actor, rebind = true) {
  const point = emplacements.get(actor?.emplacementId ?? actor?.tactics?.stationId);
  if (!point) return;
  if (point.crewId === actor.id) point.crewId = null;
  actor.tactics.stationId = null;
  if (point.operatorId !== actor.id) return;
  point.operatorId = null; point.weapon.ownerId = point.id;
  point.position = 'gunner';
  actor.emplacementId = actor.emplacementWeaponId = null;
  if (rebind && actor.health > 0 && actor === controlledSoldier(entities)) {
    bindControlInput(); refreshWeaponVisibility();
    $('weapon-name').textContent = infantryWeaponProfile(actor.rifle).name ?? TYPES.infantry.weapon;
  }
}

function operateAIEmplacement(actor, dt) {
  if (actor.vehicleId ||
    actor.playerUnit && !actor.emplacementId) return false;
  if (actor.traversal.kind !== 'grounded') {
    if (actor.emplacementId) releaseEmplacement(actor, false);
    return false;
  }
  if (!actor.emplacementId && time < (actor.tactics.stationCooldownUntil ?? 0)) return false;
  const stage = sihangCampaignMode ? sihangCampaign.stage : nanjingCampaignMode ? nanjingCampaign.stage : null;
  const sihangDuty = sihangCampaignMode && stage === 'sihang-defense' && actor.friendly && !actor.playerUnit
    ? sihangDefenseGoal(actor.formation.index, actor.index) : null;
  if (nanjingCampaignMode && stage === 'gate-defense' && !actor.playerUnit && nanjingCoreGuard(actor)) {
    if (actor.emplacementId || actor.tactics.stationId) releaseEmplacement(actor, false);
    return false;
  }
  const usable = point => (!point.playerOnly || actor.playerUnit) && point.health > 0 &&
    canOperateEmplacement(point, actor) &&
    (!point.weapon.settings.antiAircraft || sihangDuty?.stationId === point.id) &&
    (!sihangDuty || sihangDuty.stationId === point.id ||
      ['ground-intercept', 'ground-defense'].includes(sihangDuty.duty) &&
      Math.abs(point.altitude ?? 0) < .3 &&
      (sihangDuty.duty === 'ground-defense' ? point.z > SIHANG_WAREHOUSE.minZ : point.z < SIHANG_WAREHOUSE.minZ)) &&
    (!nanjingCampaignMode || !nanjingDockBufferActive(stage) || actor.playerUnit ||
      !nanjingDockInside(emplacementPose(point, point.altitude ?? world.groundHeight(point.x, point.z)).operator, .6)) &&
    point.team === actor.team && (point.engineerBuilt
      ? sihangCampaignMode ? !sihangCampaign.outcome &&
          (actor.team === 'enemy' || stage === 'sihang-defense' || sihangWaveCover(actor))
        : nanjingCampaignMode ? ['gate-defense', 'dock-defense'].includes(stage)
          : !encirclementMode || encirclement.phase === 1 ||
            actor.team === 'friendly' && Math.hypot(point.x - EAST_BREAKOUT.x, point.z - EAST_BREAKOUT.z) < 35
      : sihangCampaignMode
      ? (stage === 'sihang-defense' && !point.retreatCover || stage === 'sihang-retreat' && point.retreatCover) && !sihangCampaign.outcome
      : stage === 'gate-defense' ? !point.id.startsWith('dock-') : stage === 'dock-defense' && point.id.startsWith('dock-'));
  let point = emplacements.get(actor.emplacementId ?? actor.tactics.stationId);
  if (point && !usable(point)) { releaseEmplacement(actor, false); return false; }
  const regroup = sihangCampaignMode && stage === 'sihang-retreat' && !sihangCampaign.counterattack && !actor.friendly;
  const withinRegroupReach = point => {
    const pose = emplacementPose(point, point.altitude ?? world.groundHeight(point.x, point.z));
    return Math.hypot(actor.position.x - pose.operator.x, actor.position.z - pose.operator.z) <= .6;
  };
  if (regroup && !actor.emplacementId && point && !withinRegroupReach(point)) {
    releaseEmplacement(actor, false); point = null;
  }
  if (!point) {
    point = [...emplacements.values()].filter(point => usable(point) && !point.operatorId && !point.crewId &&
      (!regroup || withinRegroupReach(point)) &&
      Math.abs(actor.position.y - (point.altitude ?? world.groundHeight(point.x, point.z))) < 1 &&
      Math.hypot(actor.position.x - point.x, actor.position.z - point.z) < 25)
      .sort((a, b) => Math.hypot(actor.position.x - a.x, actor.position.z - a.z) -
        Math.hypot(actor.position.x - b.x, actor.position.z - b.z))[0];
    if (!point) return false;
    point.crewId = actor.id; actor.tactics.stationId = point.id;
  }
  const floor = point.altitude ?? world.groundHeight(point.x, point.z);
  const pose = emplacementPose(point, floor);
  cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'fixed-weapon');
  if (!actor.emplacementId) {
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.tactics.cover = actor.target = null; actor.tactics.lastSeen = null;
    actor.stance = 'standing'; actor.firingPose = null; actor.tactics.mode = 'fixed-weapon-approach';
    if (Math.hypot(actor.position.x - pose.operator.x, actor.position.z - pose.operator.z) > .6)
      walkActor(actor, { ...pose.operator, transit: true }, 3, dt);
    else occupyEmplacement(point, actor);
    return true;
  }
  const profile = point.weapon.settings, antiAircraft = Boolean(profile.antiAircraft);
  const standingOperator = antiAircraft;
  actor.stance = standingOperator ? 'standing' : 'crouched';
  actor.firingPose = standingOperator ? null : 'kneeling';
  actor.rifleReady = false; stopLocomotion(actor.locomotion);
  actor.tactics.mode = antiAircraft ? 'operate-antiaircraft' : 'operate-fixed-weapon';
  const candidates = antiAircraft
    ? [...entities.vehicles.values()].filter(vehicle => vehicle.team === 'enemy' && vehicle.type === 'plane' && vehicle.health > 0)
    : (actor.friendly ? enemies : sihangCampaignMode ? friendlyForces.filter(sihangEnemyTargetAllowed) :
      nanjingCampaignMode ? [...friendlyForces, ...nanjingCivilianCombatTargets()] : friendlyForces)
      .filter(enemy => enemy.health > 0 && enemy.targetKind !== 'aircraft' &&
      (point.profile === 'bofors75' || enemy.targetKind !== 'closed-armor'));
  const targetPoint = target => {
    if (antiAircraft) return target.position.clone();
    if (target.civilian) return target.position.clone().add(new THREE.Vector3(0, target.aimHeight, 0));
    const point = targetAimPoint(target);
    return new THREE.Vector3(point.x, point.y, point.z);
  };
  const eye = new THREE.Vector3(point.x, floor + profile.muzzleHeight + .8, point.z);
  const target = candidates.filter(target => target.position.distanceTo(eye) < profile.range &&
    (!sihangCampaignMode || sihangNightVisibility(sihangCampaign, eye, target.position)) &&
    emplacementCanAimAt(point, targetPoint(target), floor))
    .sort((a, b) => a.position.distanceToSquared(eye) - b.position.distanceToSquared(eye))
    .find(target => hasLine(eye, targetPoint(target),
      profile.range, target.type === 'plane' ? target.id : target.vehicleId));
  if (!target) return true;
  const aim = targetPoint(target);
  const aligned = aimEmplacement(point, aim, dt, floor);
  point.view.userData.update();
  const operatorPose = emplacementPose(point, floor);
  actor.position.set(operatorPose.operator.x, operatorPose.operator.y, operatorPose.operator.z);
  actor.heading = point.yaw; actor.lookPitch = Math.min(.8, point.pitch);
  const muzzle = emplacementPose(point, floor).muzzle;
  const unsafe = allForces.some(friend => {
    if (friend.team !== actor.team) return false;
    if (friend === actor || friend.health <= 0) return false;
    if (point.profile === 'bofors75' && friend.position.distanceTo(aim) < profile.radius + 1) return true;
    const near = pointSegmentDistance(friend.position, muzzle, aim);
    const height = muzzle.y + (aim.y - muzzle.y) * near.fraction;
    return near.distance < .8 && height >= friend.position.y - .2 &&
      height <= friend.position.y + soldierPostureHeight(friend, 'body') + .2;
  });
  if (!actor.friendly && sihangCampaignMode && point.profile === 'bofors75' &&
    !sihangBlastClearOfSouthBank(aim, profile.radius)) return true;
  if (encirclementMode && encirclement.phase === 2 && encirclement.breakout?.stage !== 'breakout') return true;
  if (aligned && !unsafe) {
    const origin = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
    const travel = aim.clone().sub(origin), distance = travel.length();
    ray.set(origin, travel.normalize()); ray.far = distance;
    const blocker = ray.intersectObjects([...solidIndex.candidates(origin, travel, distance)
      .filter(object => object.userData.emplacementId !== point.id || object.userData.emplacementCover),
      ...vehicleSolids(antiAircraft ? target.id : target.vehicleId)], true)[0];
    ray.far = Infinity;
    if (!blocker || blocker.distance >= distance - .3) fireFixedWeapon(point, actor);
  }
  return true;
}

function fireFixedWeapon(point, actor) {
  if (sihangCeasefire(actor)) return;
  if (!actor.friendly && finalBoardingFireHeld(nanjingCampaign, time)) return;
  if (point.position === 'march') return;
  const cannon = point.profile === 'bofors75', settings = point.weapon.settings;
  if (cannon && shells.length >= PROJECTILE_LIMIT) return;
  const pose = emplacementPose(point, point.altitude ?? world.groundHeight(point.x, point.z));
  const start = new THREE.Vector3(pose.muzzle.x, pose.muzzle.y, pose.muzzle.z);
  const behind = new THREE.Vector3(point.x, (point.altitude ?? world.groundHeight(point.x, point.z)) + settings.muzzleHeight, point.z);
  direction.set(-Math.sin(point.yaw) * Math.cos(point.pitch), Math.sin(point.pitch), -Math.cos(point.yaw) * Math.cos(point.pitch));
  const clearDistance = start.distanceTo(behind);
  const barrelDirection = start.clone().sub(behind).normalize();
  ray.set(behind, barrelDirection); ray.far = clearDistance;
  const blocked = ray.intersectObjects(solidIndex.candidates(behind, barrelDirection, clearDistance)
    .filter(object => object.userData.emplacementId !== point.id || object.userData.emplacementCover), true)[0];
  ray.far = Infinity;
  if (blocked) { toast('固定武器枪口受阻 · 调整射界'); return; }
  if (!fireEmplacement(point, time)) return;
  const source = captureAttackSource(entities, actor, point.weapon);
  if (!cannon) {
    fireAutomaticShot({ id: null, team: actor.team }, { gun: point.weapon }, source, start,
      point.yaw + (battleRandom() * 2 - 1) * settings.spread,
      point.pitch + (battleRandom() * 2 - 1) * settings.spread, false, point.id);
    return;
  }
  const shotRange = !actor.friendly && sihangCampaignMode ? sihangEnemyRayRange(start, direction, settings.range) : settings.range;
  ray.set(start, direction); ray.far = shotRange;
  const rayEnd = start.clone().addScaledVector(direction, shotRange);
  const people = allForces.filter(person => person.health > 0 && !person.vehicleId && person !== actor &&
    pointSegmentDistance(person.position, start, rayEnd).distance < 2)
    .map(person => soldierHits.sync(person, time));
  const hit = ray.intersectObjects([...solidIndex.candidates(start, direction, shotRange)
    .filter(object => object.userData.emplacementId !== point.id), ...vehicleSolids(), ...people], true)[0];
  const target = hit ? hit.point.clone() : rayEnd;
  const floor = direction.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
  if (floor && floor.distanceTo(start) < target.distanceTo(start)) target.copy(floor);
  ray.far = Infinity;
  const shell = createProjectile({ id: `shell-${++projectileSerial}`, source, start, target, firedAt: time,
    duration: Math.max(.1, start.distanceTo(target) / 180), damage: settings.damage, radius: settings.radius });
  shell.arcHeight = 0; shell.blastKind = 'explosion'; shell.emplacementId = point.id;
  const mesh = new THREE.Mesh(projectileGeometry, shellMaterial);
  mesh.position.copy(start); mesh.userData.projectileId = shell.id;
  scene.add(mesh); shellViews.set(shell.id, mesh); shells.push(shell);
  combatEvents.publish('shot', { source, weaponType: 'tank', start,
    end: target, muzzle: true, sound: 'blast', recoil: .04 }, time);
  combatSounds.push({ id: ++soundSerial, friendly: actor.friendly, x: start.x, y: start.y, z: start.z, time, radius: 85 });
  if (combatSounds.length > 32) combatSounds.shift();
}

function syncRifleUnit() {
  syncControlledRifleTiming(entities, time, toolEquipped || dadaoEquipped || grenadeEquipped);
}

function reload() {
  const point = emplacements.get(controlledSoldier(entities)?.emplacementId);
  if (point) { if (!reloadEmplacement(point, time)) toast('无需装填，或备用弹药已用完'); return; }
  if (dadaoEquipped) { toast('大刀无需装填；按 1 切回主武器'); return; }
  if (grenadeEquipped) { toast('当前选择投掷装备；按 1 切回主武器'); return; }
  if (allies[current]?.grenades.action) { toast('先完成手榴弹动作再装填'); return; }
  if (unit.type === 'tank') {
    toast(occupiedSeat(entities).canFire ? '主炮射击后自动装填，无需按 R'
      : '驾驶员席位不能装填主炮；射击后由车组自动装填');
    return;
  }
  if (unit.type === 'infantry') {
    if (toolEquipped) { toast('先按 1 收起工具再装填步枪'); return; }
    const reason = currentWeaponRestriction('reload');
    if (reason) { toast(reason.text); return; }
    if (reloadRifle(allies[current].rifle)) emitControlEvent('weapon.reload-requested', {
      weaponId: allies[current].rifle.id, duration: rifleReloadSeconds(allies[current].rifle), queued: allies[current].rifle.action === 'cycle' });
    syncRifleUnit();
    return;
  }
  if (unit.reloadUntil || unit.ammo === TYPES[unit.type].magazine) {
    const reason = currentWeaponRestriction('reload');
    if (reason) toast(reason.text);
    return;
  }
  unit.reloadUntil = time + TYPES[unit.type].reload;
  emitControlEvent('weapon.reload-requested', { weaponId: controlOwner(entities).weaponId, duration: TYPES[unit.type].reload });
}

function hasLine(from, to, maxDistance = 120, ignoreVehicleId = null, ignoreEmplacementId = null) {
  vector.copy(to).sub(from);
  const distance = vector.length();
  if (distance > maxDistance) return false;
  ray.set(from, vector.normalize());
  ray.far = Math.max(0, distance - .04);
  const transports = vehicleSolids(ignoreVehicleId, from);
  const candidates = [...solidIndex.candidates(from, ray.ray.direction, distance).filter(object =>
    !ignoreEmplacementId || object.userData.emplacementId !== ignoreEmplacementId || object.userData.emplacementCover), ...transports];
  queryDiagnostics?.candidates(candidates.length, transports.length);
  const blocked = occluded(ray, candidates);
  ray.far = Infinity;
  return !blocked;
}

function tracer(start, end, color = 0xffd49a, life = .08, bornAt = time) {
  const line = tracerPool.acquire(start, end, color);
  scene.add(line);
  effects.push({ object: line, end: bornAt + life, bornAt, lastAt: bornAt, life, kind: 'line' });
}

function renderImpact(position, bornAt = time) {
  if (!graphics.snapshot.effects.hitParticles) return;
  const mesh = new THREE.Mesh(impactGeometry, new THREE.MeshBasicMaterial({ color: 0xd0ba86, transparent: true, opacity: .85, depthWrite: false }));
  mesh.position.copy(position);
  mesh.scale.setScalar(.12);
  scene.add(mesh);
  effects.push({ object: mesh, end: bornAt + .18, bornAt, lastAt: bornAt, life: .18, kind: 'spark' });
}

function removeEffect(effect) {
  scene.remove(effect.object);
  if (effect.kind === 'line') tracerPool.release(effect.object);
  else effect.object.material.dispose();
  effects.splice(effects.indexOf(effect), 1);
}

function acceptedWeaponDamage(weaponKind, targetKind, amount, hitZone = null) {
  const damage = damageForTarget(weaponKind, targetKind, amount, hitZone);
  if (amount > 0 && damage === 0 && weaponKind === 'rifle') {
    if (targetKind === 'closed-armor') combatStats.rejectedRifleArmorDamage++;
    if (targetKind === 'aircraft') combatStats.rejectedRifleAircraftDamage++;
  }
  return damage;
}

function hurt(actor, damage, source, weaponKind = 'rifle', hitZone = null, hitDirection = null, blastOrigin = null) {
  if (finalBoardingDamageHeld(nanjingCampaign, time, source, actor)) return;
  if (sihangCampaignMode && sihangCampaign.outcome) return;
  if (sihangCampaignMode && source?.team === 'enemy' && !sihangEnemyTargetAllowed(actor)) return;
  if (actor.health <= 0 || actor.dying || !['playing', 'transferring', 'dead'].includes(state)) return;
  damage = acceptedWeaponDamage(weaponKind, actor.targetKind, damage, hitZone);
  if (damage === 0) return;
  const transport = occupiedVehicle(entities, actor);
  if (transport) {
    damageVehicle(transport, damage, source, weaponKind);
    return;
  }
  const previous = actor.health;
  if (source?.team === 'enemy') activateSihangWaveCover(actor);
  const selected = actor === controlledSoldier(entities);
  const delayed = selected && damage >= previous && !actor.fatalFall &&
    !['fall', 'boundary', 'collision'].includes(weaponKind) && beginDying(actor, time, source);
  actor.health = delayed ? 1 : Math.max(0, previous - damage);
  actor.lastHit = { time, hitZone, damage: previous - actor.health, weaponKind,
    blast: Boolean(blastOrigin),
    direction: hitDirection ? { x: hitDirection.x, z: hitDirection.z } : null,
    source: typeof source === 'object' ? { ...source } : null };
  if (weaponKind !== 'boundary' && weaponKind !== 'fall') {
    actor.tactics.suppressedUntil = time + 4;
    if (actor.friendly) actor.tactics.decisionAt = Math.min(actor.tactics.decisionAt, time + .1);
  }
  if (blastOrigin && actor.health > 0 && beginBlastReaction(actor, blastOrigin, damage, time,
    actor.nativeMotion ? sampleNraMotion(actor) : null, { force: Boolean(delayed) })) {
    const reaction = actor.blastReaction, factory = actor.team === 'friendly' ? nraCharacter : ijaCharacter;
    if (factory && actor.nativeMotion) reaction.casualty = { ...placeActorCasualty(actor, reaction.casualty, factory), retainGun: true };
    reaction.lethal = Boolean(delayed);
    releaseEmplacement(actor, false); releaseWeaponMount(actor.weaponMount);
    cancelAIMelee(actor); stopLocomotion(actor.locomotion);
    if (selected && dadaoEquipped) equipPrimary();
    actor.firingPose = null; actor.rifleReady = false;
  }
  if (delayed) {
    actor.dying.reason = attackSourceLabel(source);
    if (actor.blastReaction) actor.blastReaction.lethal = true;
    playerInput.releaseFire(); held.aiming = false;
    stopLocomotion(actor.locomotion);
    releaseEmplacement(actor, false); releaseWeaponMount(actor.weaponMount);
    if (selected && dadaoEquipped) equipPrimary();
    else if (actor.dadao) stowDadao(actor.dadao);
    cancelBayonet(actor.bayonet);
    if (selected) {
      const throwable = lastStandThrowable(actor, selectedThrowable);
      if (throwable) equipGrenade(throwable);
      if (grenadeEquipped) $('weapon-name').textContent = selectedThrowable === 'grenade' ? '手榴弹' : '炸药包';
    }
  }
  if (previous > actor.health) battleStats.consume(combatEvents.publish('damage', { source, target: { kind: 'soldier', id: actor.id, unitId: actor.unitId, team: actor.team },
    amount: previous - actor.health, health: actor.health, observerId: selected ? actor.id : null, hitZone }, time));
  if (selected && actor.health === 0) {
    beginDeathFeedback(actor, weaponKind === 'boundary' ? '脱离战区' : weaponKind === 'bayonet' ? '刺刀突刺'
      : weaponKind === 'dadao' ? '大刀斩击' : weaponKind === 'collision' ? '坦克碾压'
      : attackSourceLabel(source));
  }
  if (actor.health === 0) finishActorDeath(actor, source);
}

function placeActorCasualty(actor, casualty, factory) {
  const obstaclesAt = movementCollision.snapshot();
  return performanceDiagnostics.measure('casualtyPlacement', () => placeCasualty(actor, casualty,
    (variant, retain) => factory.casualtyBounds(variant, retain),
    (point, radius, height) => circleBlocked(point.x, point.z, radius,
      obstaclesAt(point.x, point.z), point.y, height)));
}

function finishActorDeath(actor, source) {
  if (!actor.deathProcessed) {
    clearActorDischarger(actor);
    releaseEmplacement(actor, false);
    if (actor.dadao) stowDadao(actor.dadao);
    cancelBayonet(actor.bayonet);
    interruptGrenade(actor);
    releaseWeaponMount(actor.weaponMount);
    actor.traversal.kind = 'grounded'; actor.traversal.velocity = 0; actor.traversal.plan = null;
    actor.deathProcessed = true;
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.deathTime = time;
    actor.deathSource = typeof source === 'object' ? source : null;
    if (!actor.vehicleId) {
      const ferry = nanjingCampaignMode && world.ferries.find(ferry =>
        ferry.userData.ferryId === actor.tactics.nanjingFerry?.ferryId);
      const onFerry = ferry && retainTroopFerryCasualty(ferry, actor);
      if (!onFerry) actor.position.y = world.walkHeight(actor.position.x, actor.position.z, actor.position.y);
      const dropSide = actor.tactics.id % 2 ? .65 : -.65, c = Math.cos(actor.heading), s = Math.sin(actor.heading);
      const drop = circleBlocked(actor.position.x + dropSide * c, actor.position.z - dropSide * s, .12,
        movementObstacles(actor.position.x, actor.position.z)) ? [0, .05, 0] : [dropSide, .05, 0];
      const falling = blastCasualty(actor);
      actor.casualty = falling ? Object.freeze({ ...falling, time: time + falling.time, retainGun: false }) :
        createCasualtyState(actor, time, actor.nativeMotion ? sampleNraMotion(actor) : null,
        { retainGun: false, drop: onFerry ? [0, .05, 0] : drop, ...(onFerry ? { variant: 3 } : {}) });
      if (onFerry) actor.casualty = Object.freeze({ ...actor.casualty, wallLimited: true });
      const factory = actor.team === 'friendly' ? nraCharacter : ijaCharacter;
      if (factory && actor.nativeMotion && !onFerry && !falling) {
        actor.casualty = placeActorCasualty(actor, actor.casualty, factory);
        if (actor.casualty.wallLimited) console.warn(`No fully clear falling path for ${actor.id}; using a bounded compact collapse`);
      }
      corpses.set(actor.id, actor);
      actor.blastReaction = null;
    }
    if (!actor.friendly) {
      const credit = source?.credit ?? source;
      if (credit === 'player') kills++;
      else if (credit === 'ally') teamKills++;
    }
    battleStats.consume(combatEvents.publish('casualty', { source, target: { kind: 'soldier', id: actor.id, unitId: actor.unitId, team: actor.team }, health: 0 }, time));
  }
}

function damageVehicle(transport, damage, source, weaponKind) {
  if (sihangCampaignMode && !sihangEnemyTargetAllowed(transport)) return;
  damage = acceptedWeaponDamage(weaponKind, transport.type === 'tank' ? 'closed-armor' : 'aircraft', damage);
  if (damage === 0) return;
  if (source === 'crash') source = Object.freeze({ credit: 'environment', cause: 'crash', vehicleId: transport.id });
  const observer = controlledSoldier(entities);
  const observerId = observer?.health > 0 && occupiedVehicle(entities, observer)?.id === transport.id ? observer.id : null;
  const previousHealth = transport.health;
  const result = damageVehicleEntity(entities, transport, damage);
  if (result.damage > 0) battleStats.consume(combatEvents.publish('damage', { source,
    target: { kind: 'vehicle', id: transport.id, unitId: transport.unitId, team: transport.team },
    amount: result.damage, health: transport.health, observerId }, time));
  if (transport.type === 'plane' && result.damage > 0 &&
    (previousHealth === TYPES.plane.health || result.destroyed)) {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(transport.pitch, transport.heading, transport.roll, 'YXZ'));
    const engine = new THREE.Vector3(0, .35, transport.team === 'enemy' ? -3.1 : -2.6)
      .applyQuaternion(rotation).add(transport.position);
    combatEvents.publish('explosion', { position: engine, source, style: 'aircraft-hit',
      radius: result.destroyed ? 9 : 6, sound: result.destroyed }, time);
  }
  for (const actor of result.casualties) {
    finishActorDeath(actor, source);
    if (actor === allies[current]) beginDeathFeedback(actor, weaponKind === 'boundary' ? '脱离战区' : result.destroyed ? '载具被毁' : '车组成员阵亡');
  }
  if (result.destroyed) {
    transport.destroyedAt = time;
    if (transport.type === 'plane') transport.fall = createAircraftFall(transport);
    if (transport.type === 'tank') combatEvents.publish('explosion', {
      position: transport.position.clone().add(new THREE.Vector3(0, 1.5, 0)),
      source, sound: true, style: 'tank-destruction' }, time);
  }
}

function beginDeathFeedback(actor, reason) {
  if (state === 'pause' || state === 'menu') return;
  startDeathTransfer(deathTransfer, actor.id, reason);
  clearControlInputs();
  stopLocomotion(actor.locomotion);
  setGameState('transferring');
  emitControlEvent('death.started', { reason });
}

function updateDeathFeedback(dt) {
  if (state !== 'transferring') return;
  const event = advanceDeathTransfer(deathTransfer, dt);
  if (event === 'handoff') {
    const next = nextDeathTransferMember();
    if (next >= 0 && allies[next].health > 0) changeMember(next);
    else {
      resetDeathTransfer(deathTransfer);
      showOverlay('dead');
      return;
    }
  } else if (event === 'complete') {
    if (allies[current]?.health <= 0) {
      const next = nextDeathTransferMember();
      if (next < 0) { showOverlay('dead'); return; }
      changeMember(next);
    }
    setGameState('playing');
    clearControlInputs();
    bindControlInput();
    emitControlEvent('death.completed');
  }
}

function renderDeathFeedback() {
  const mask = deathTransferMask(deathTransfer), element = $('death-transfer');
  const dying = dyingMask(allies[current], time);
  element.classList.toggle('dying', Boolean(dying));
  element.hidden = !deathTransfer.active && !dying;
  if (dying) {
    element.style.opacity = '1';
    const red = graphics.snapshot.effects.damageVignette ? dying.red : 0;
    element.style.setProperty('--dying-blood', String(red));
    element.style.background = `radial-gradient(ellipse at center,rgba(0,0,0,${dying.dark * .35}),rgba(20,0,0,${Math.min(1, dying.dark + red * .3)}))`;
    $('death-transfer-label').textContent = '重伤';
    return;
  }
  element.style.opacity = String(mask.opacity);
  const red = graphics.snapshot.effects.damageVignette ? mask.red : 0;
  element.style.background = `linear-gradient(rgba(5,5,5,${mask.dark}),rgba(5,5,5,${mask.dark})),radial-gradient(ellipse at center,rgba(65,0,0,${red * .5}),rgba(100,0,0,${red}))`;
  $('death-transfer-label').textContent = deathTransfer.handedOff ? '正在接管存活队员' : `当前队员阵亡 · ${deathTransfer.reason}`;
}

function explode(position, damage, radius, source, weaponKind = 'explosion', surface = null) {
  combatEvents.publish('explosion', { position, source, sound: true, radius,
    style: ['grenade', 'explosive-pack', 'mortar', 'grenade-discharger'].includes(weaponKind) ? weaponKind
      : ['tank', 'field-gun'].includes(source.weaponClass) ? 'tank-shell' : 'default',
    ...(surface ? { surface } : {}) }, time);
  combatSounds.push({ id: ++soundSerial, friendly: source.team === 'friendly',
    x: position.x, y: position.y, z: position.z, time, radius, kind: 'explosion' });
  if (combatSounds.length > 32) combatSounds.shift();
  const blastOrigin = position.clone();
  if (surface) blastOrigin.addScaledVector(new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z), .03);
  for (const point of emplacements.values()) {
    if (point.health <= 0 || point.team === source.team) continue;
    const target = new THREE.Vector3(point.x, (point.altitude ?? world.groundHeight(point.x, point.z)) + .95, point.z);
    const distance = target.distanceTo(position);
    if (distance < radius && hasLine(blastOrigin, target, radius + 1, null, point.id))
      applyEmplacementDamage(point, blastDamage(distance, radius, damage), source);
  }
  for (const transport of entities.vehicles.values()) {
    if (transport.health <= 0) continue;
    if (weaponKind === 'grenade') continue;
    if (weaponKind === 'explosive-pack') {
      const applied = throwableVehicleDamage(weaponKind, source, transport, position,
        (from, to, maxDistance) => hasLine(new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(to.x, to.y, to.z), maxDistance, transport.id));
      if (applied > 0) damageVehicle(transport, applied, source, weaponKind);
      continue;
    }
    const target = transport.position.clone().add(new THREE.Vector3(0, 1, 0));
    const distance = target.distanceTo(position), origin = blastOrigin.clone();
    origin.y = Math.max(origin.y, .5);
    if (distance < radius && hasLine(origin, target, radius + 1, transport.id)) damageVehicle(transport,
      blastDamage(distance, radius, damage), source,
      ['mortar', 'grenade-discharger'].includes(weaponKind) ? weaponKind : 'explosion');
  }
  for (const actor of allForces) {
    if (actor.health <= 0) continue;
    if (actor.vehicleId) continue;
    if (['grenade', 'explosive-pack'].includes(weaponKind) && !grenadeCanDamage(source, actor, weaponKind)) continue;
    const target = actor.position.clone();
    target.y += ['grenade', 'explosive-pack'].includes(weaponKind) ? soldierPostureHeight(actor, 'aim') : 1;
    const d = target.distanceTo(position);
    // Walls shield units from blast; raise the ray above ground to avoid self-occlusion.
    const origin = blastOrigin.clone();
    origin.y = Math.max(origin.y, .5);
    if (source.weaponClass === 'grenade-discharger' && actor.team !== source.team &&
      (!sihangCampaignMode || sihangEnemyTargetAllowed(actor)) && d < radius * 1.7 &&
      hasLine(origin, target, radius * 1.7 + 1)) {
      actor.tactics.suppressedUntil = Math.max(actor.tactics.suppressedUntil, time + 3);
      actor.tactics.decisionAt = Math.min(actor.tactics.decisionAt, time + .1);
    }
    if (d < radius && hasLine(origin, target, radius + 1)) hurt(actor, blastDamage(d, radius, damage), source, weaponKind,
      null, target.clone().sub(position), position);
  }
  if(nanjingCampaignMode&&source.team==='enemy'){
    for(const civilian of nanjingCivilianCombatTargets()){
      const target=civilian.position.clone().add(new THREE.Vector3(0,civilian.aimHeight,0));
      const distance=target.distanceTo(position);
      if(distance<radius&&hasLine(blastOrigin,target,radius+1))
        applyCivilianDamage(civilian.civilian,blastDamage(distance,radius,damage),source);
    }
  }
}

function traceGrenade(from, to, radius, checkingSupport = false, ignoreVehicleId = null, groundVehiclesOnly = false, groundHeight = world.groundHeight) {
  const start = new THREE.Vector3(from.x, from.y, from.z), delta = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = delta.length();
  if (length < 1e-8) return null;
  const travel = delta.clone().normalize(), transports = vehicleSolids(ignoreVehicleId, null, groundVehiclesOnly);
  const candidates = [...solidIndex.sweptCandidates(from, to, radius), ...transports];
  let closest = null, distance = length + 1;
  // Sample the small projectile's extent as well as its centre, including thin walls and doors.
  for (const offset of [[0, 0, 0], [radius, 0, 0], [-radius, 0, 0], [0, radius, 0], [0, -radius, 0], [0, 0, radius], [0, 0, -radius]]) {
    const origin = start.clone().add(new THREE.Vector3(...offset));
    ray.set(origin, travel); ray.far = length;
    const hit = closestHit(ray, candidates);
    if (hit && hit.distance < distance) {
      distance = hit.distance;
      closest = { position: start.clone().addScaledVector(travel, distance), normal: captureImpact(hit, travel).normal,
        surfaceKind: 'solid',
        vehicleId: hit.object.userData.vehicleId ?? null,
        ...(checkingSupport ? { staticSupport: grenadeSupport.mesh(hit.object, from, radius) } : {}) };
    }
  }
  ray.far = Infinity;
  const clearance = fraction => {
    const x = from.x + delta.x * fraction, z = from.z + delta.z * fraction;
    return from.y + delta.y * fraction - radius - groundHeight(x, z);
  };
  if (clearance(1) < 0) {
    let low = 0, high = 1;
    for (let i = 0; i < 10; i++) {
      const middle = (low + high) / 2;
      if (clearance(middle) > 0) low = middle; else high = middle;
    }
    if (length * high <= distance) {
      const position = start.clone().addScaledVector(delta, high);
      position.y = groundHeight(position.x, position.z) + radius;
      const slopeX = (groundHeight(position.x + .02, position.z) - groundHeight(position.x - .02, position.z)) / .04;
      const slopeZ = (groundHeight(position.x, position.z + .02) - groundHeight(position.x, position.z - .02)) / .04;
      closest = { position, normal: new THREE.Vector3(-slopeX, 1, -slopeZ).normalize(),
        surfaceKind: 'ground',
        ...(checkingSupport ? { staticSupport: grenadeSupport.ground(from, radius) } : {}) };
    }
  }
  return closest;
}

function grenadeThrowPose(id, action) {
  const actor = entities.soldiers.get(id);
  if (!actor) throw new Error(`Missing grenade holder: ${id}`);
  const eye = soldierEyePosition(actor), pose = grenadePose(action, soldierPostureHeight(actor));
  const c = Math.cos(actor.heading), s = Math.sin(actor.heading), [x, y, z] = pose.position;
  const position = new THREE.Vector3(actor.position.x + x * c + z * s,
    actor.position.y + y, actor.position.z - x * s + z * c);
  const origin = new THREE.Vector3(eye.x, eye.y, eye.z);
  const hit = traceGrenade(origin, position, throwableProfile(action.kind).size);
  if (hit) position.copy(hit.position).addScaledVector(new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z), .002);
  const direction = actor === controlledSoldier(entities) ? camera.getWorldDirection(new THREE.Vector3())
    : action.aiDirection ? new THREE.Vector3(action.aiDirection.x, action.aiDirection.y, action.aiDirection.z)
    : new THREE.Vector3(-s * Math.cos(actor.lookPitch), Math.sin(actor.lookPitch), -c * Math.cos(actor.lookPitch));
  return { position, direction };
}

function interruptGrenade(actor) {
  const action = actor?.grenades.action;
  if (action && action.phase !== 'recovering') action.position = grenadeThrowPose(actor.id, action).position;
  if (actor) grenades.interrupt(actor.id);
}

function tryAIThrowable(actor, target, dt, orderedVehicleId = null) {
  if (!actor.friendly && finalBoardingFireHeld(nanjingCampaign, time)) return false;
  if (actor.hasFirearm === false) return false;
  if (sihangCampaignMode && !actor.friendly && (!sihangEnemyTargetAllowed(target) ||
    actor.tactics.lastSeen && sihangProtectedSouthBank(actor.tactics.lastSeen))) return false;
  const tactics = actor.tactics;
  const approach = () => {
    const plan = tactics.packApproach, tank = plan && entities.vehicles.get(plan.vehicleId);
    if (!plan || plan.until <= time || !tank || tank.health <= 0 ||
      !actor.grenades.packs || Math.hypot(actor.position.x - tank.position.x, actor.position.z - tank.position.z) <= 13) {
      tactics.packApproach = null; return false;
    }
    cancelAIMelee(actor);
    if (tactics.cover) coverClaims.delete(tactics.cover.id);
    tactics.cover = tactics.armorEscort = null;
    actor.stance = 'standing'; actor.firingPose = null; actor.rifleReady = false;
    tactics.mode = 'approach-armor-pack';
    resetAIRifleAim(actor.aiRifle, 'moving');
    walkActor(actor, plan, 3.15, dt, true);
    return true;
  };
  if (!tactics.throwIntent && time < (tactics.throwDecisionAt ?? 0)) return approach();
  const eye = soldierEyePosition(actor), origin = new THREE.Vector3(eye.x, eye.y, eye.z);
  const visible = candidate => hasLine(origin, new THREE.Vector3(candidate.position.x,
    candidate.position.y + (candidate.kind === 'armor' ? 1 : .6), candidate.position.z), 30, candidate.vehicleId);
  if (!tactics.throwIntent) {
    tactics.throwDecisionAt = time + 1.1 + tactics.id % 7 * .09;
    const targets = actor.grenades.packs ? [...entities.vehicles.values()]
      .filter(armor => armor.type === 'tank' && armor.health > 0 && armor.team !== actor.team &&
        (!orderedVehicleId || armor.id === orderedVehicleId) &&
        Math.hypot(actor.position.x - armor.position.x, actor.position.z - armor.position.z) <= 30)
      .map(armor => ({ id: armor.id, kind: 'armor', vehicleId: armor.id, position: { ...armor.position } })) : [];
    if (!orderedVehicleId && target?.health > 0 && !target.vehicleId) targets.push({
      id: target.id, kind: 'person', position: { ...target.position } });
    const observed = targets.filter(visible);
    const choice = chooseAIThrowable(actor, observed, allForces.filter(other => other.team === actor.team));
    tactics.packApproach = null;
    if (!choice) {
      const goal = antiTankApproach(actor, observed, point => circleBlocked(point.x, point.z, .43,
        movementObstacles(point.x, point.z), actor.position.y));
      if (goal) tactics.packApproach = { ...goal, until: time + 2.3 };
      return approach();
    }
    if (choice.kind === 'grenade' && time < (actor.formation.nextThrowableAt ?? 0)) return false;
    const key = `${actor.team}:${choice.target.id}`, reservation = aiThrowReservations.get(key);
    if (reservation && reservation.until > time && reservation.actorId !== actor.id) return false;
    aiThrowReservations.set(key, { actorId: actor.id, until: time + 2.5 });
    tactics.throwIntent = { ...choice, key, expires: time + 2 };
  }
  const intent = tactics.throwIntent;
  const live = intent.target.kind === 'armor' ? entities.vehicles.get(intent.target.id) : entities.soldiers.get(intent.target.id);
  const currentTarget = live ? { ...intent.target, position: { ...live.position } } : null;
  if (!live || live.health <= 0 || time > intent.expires || !visible(currentTarget) ||
    !throwableStock(actor.grenades, intent.kind)) {
    tactics.throwIntent = null;
    if (aiThrowReservations.get(intent.key)?.actorId === actor.id) aiThrowReservations.delete(intent.key);
    return false;
  }
  intent.target = currentTarget;
  actor.rifleReady = false;
  resetAIRifleAim(actor.aiRifle, 'throwable');
  tactics.mode = intent.kind === 'explosive-pack' ? 'prepare-anti-tank-pack' : 'prepare-grenade';
  const heading = Math.atan2(actor.position.x - intent.target.position.x, actor.position.z - intent.target.position.z);
  if (!advanceAITurn(actor, heading, dt).facing) return true;
  const profile = throwableProfile(intent.kind), launch = grenadeThrowPose(actor.id,
    { kind: intent.kind, phase: 'throwing', elapsed: profile.windup }).position;
  const point = { ...intent.target.position, y: world.groundHeight(intent.target.position.x, intent.target.position.z) + profile.size };
  const plan = planAIThrow(launch, point, intent.kind, traceGrenade, intent.target.vehicleId);
  if (!plan) {
    tactics.throwIntent = null; aiThrowReservations.delete(intent.key);
    if (intent.kind === 'explosive-pack') {
      const goal = antiTankApproach(actor, [intent.target], point => circleBlocked(point.x, point.z, .43,
        movementObstacles(point.x, point.z), actor.position.y));
      if (goal) tactics.packApproach = { ...goal, until: time + 2.3 };
      return approach();
    }
    return false;
  }
  const source = captureAttackSource(entities, actor, intent.kind === 'grenade' ? actor.grenades : actor.explosivePack);
  const reason = grenades.begin(actor.id, actor.grenades, source, time, intent.kind);
  if (reason) { tactics.throwRejection = reason; tactics.throwIntent = null; aiThrowReservations.delete(intent.key); return false; }
  const action = actor.grenades.action;
  action.aiDirection = Object.freeze({ ...plan.direction }); action.aiTargetId = intent.target.id;
  action.aiLanding = Object.freeze({ ...plan.landing }); actor.lookPitch = plan.pitch;
  action.position = grenadeThrowPose(actor.id, action).position;
  grenades.release(actor.id, time);
  aiThrowReservations.set(intent.key, { actorId: actor.id, until: time + profile.draw + profile.fuse + 1 });
  actor.formation.nextThrowableAt = time + 5;
  tactics.throwIntent = null;
  return true;
}

function prepareGrenade() {
  const actor = controlledSoldier(entities);
  if (!actor || actor.health <= 0) return;
  if (actor.vehicleId) { toast('车内不能投掷；先离开地面载具'); return; }
  if (!grenadeEquipped) return;
  if (actor.grenades.action) { toast('正在准备或投掷'); return; }
  startThrowableAction(actor, selectedThrowable);
}

function startThrowableAction(actor, kind) {
  if (sihangCeasefire(actor)) return;
  if (actor.dying?.action) return;
  if (actor.fatalFall?.throwStarted) return;
  const source = captureAttackSource(entities, actor, kind === 'explosive-pack' ? actor.explosivePack : actor.grenades);
  const reason = grenades.begin(actor.id, actor.grenades, source, time, kind);
  if (reason) { toast(reason); return; }
  if (actor.fatalFall) actor.fatalFall.throwStarted = true;
  if (actor.dying) actor.dying.action = 'throw';
  playerInput.clearFire();
  held.primary = held.secondary = held.aiming = false;
  resetConstruction();
  toolEquipped = false; grenadeEquipped = true; selectedThrowable = kind;
  $('weapon-name').textContent = `${kind === 'grenade' ? '手榴弹' : '炸药包'}${actor.dying || actor.fatalFall ? '' : ' · 左键准备／松开投掷'}`;
  actor.rifleReady = false;
  const action = actor.grenades.action;
  action.position = grenadeThrowPose(actor.id, action).position;
  refreshWeaponVisibility();
}

function updateGrenades(dt) {
  grenades.advance(time, dt, {
    pose: grenadeThrowPose, trace: traceGrenade,
    primed: () => sound('click'),
    explode: event => {
      const profile = throwableProfile(event.kind);
      explode(new THREE.Vector3(event.position.x, event.position.y, event.position.z), profile.damage, profile.radius, event.source, event.kind);
    },
  });
  const actor = controlledSoldier(entities);
  if (state === 'playing' && grenadeEquipped && actor?.health > 0 && !actor.vehicleId &&
    !actor.grenades.action && throwableStock(actor.grenades, selectedThrowable) === 0) equipPrimary();
  refreshWeaponVisibility();
}

function renderGrenades() {
  const actor = controlledSoldier(entities);
  grenadeRenderer.update(grenades.active, actor, state === 'playing', grenadeEquipped, selectedThrowable);
  const action = actor?.grenades.action, label = $('grenade-status'), warning = $('grenade-warning');
  $('equipment-slots').hidden = !actor || Boolean(actor.vehicleId);
  label.hidden = !actor || Boolean(actor.vehicleId) || !action;
  const pack = (action?.kind ?? selectedThrowable) === 'explosive-pack', name = pack ? '炸药包' : '手榴弹';
  const count = pack ? actor?.grenades.packs ?? 0 : actor?.grenades.ammo ?? 0;
  label.textContent = action ? `${name} ${count} · ${action.phase === 'drawing' ? '准备中' :
    action.phase === 'cooking' ? '已拉弦 · 松开左键投掷' : action.phase === 'throwing' ? '投掷中' : '收回手臂'}`
    : `5 手榴弹 ${actor?.grenades.ammo ?? 0}/1 · 6 炸药包 ${actor?.grenades.packs ?? 0}/1${grenadeEquipped ? ' · 左键准备／松开投掷' : ''}`;
  for (const element of document.querySelectorAll('[data-equipment-slot]')) {
    const slot = Number(element.dataset.equipmentSlot);
    const active = slot === (dadaoEquipped ? 3 : grenadeEquipped ? selectedThrowable === 'explosive-pack' ? 6 : 5 : toolEquipped ? 2 : 1);
    element.classList.toggle('selected', active); element.setAttribute('aria-current', String(active));
    if (slot === 2) {
      element.hidden = !actor?.mortar && !actor?.engineer;
      element.title = actor?.engineer ? '工兵锤 · 按2选择，R切换机枪／火炮，长按左键20秒，每类仅一份材料'
        : '迫击炮 · 按2选择，左键架设，鼠标上下调射程，架设后左键发射';
      element.querySelector('.equipment-label').textContent = actor?.engineer ? '工' : '炮';
      element.setAttribute('aria-label', element.title);
    }
    if (slot === 5 || slot === 6) {
      const pack = slot === 6;
      const count = (pack ? actor?.grenades.packs : actor?.grenades.ammo) ?? 0;
      element.querySelector('.equipment-count').textContent = String(count);
      element.querySelector('.equipment-label').textContent = pack ? '包' : '雷';
      element.setAttribute('aria-label', `${slot} ${pack ? '炸药包' : '手榴弹'} ${count}/1`);
    }
  }
  const eye = actor ? soldierEyePosition(actor) : null;
  const nearby = state === 'playing' && actor?.health > 0 && !actor.vehicleId ? grenades.active.filter(grenade =>
    grenade.detonateAt !== null && grenade.holderId !== actor.id && grenadeCanDamage(grenade.source, actor, grenade.kind) &&
    Math.hypot(grenade.position.x - actor.position.x, grenade.position.z - actor.position.z,
      grenade.position.y - actor.position.y) < throwableProfile(grenade.kind).radius &&
    hasLine(new THREE.Vector3(eye.x, eye.y, eye.z),
      new THREE.Vector3(grenade.position.x, grenade.position.y + .08, grenade.position.z), throwableProfile(grenade.kind).radius + 2))
    .sort((a, b) => a.detonateAt - b.detonateAt)[0] : null;
  warning.hidden = !nearby;
  warning.textContent = nearby ? `${nearby.kind === 'explosive-pack' ? '炸药包' : '手榴弹'}危险 · 无法回掷，立即寻找掩护` : '';
}

function fire() {
  if (sihangCeasefire(controlledSoldier(entities))) return;
  if (controlledSoldier(entities)?.fatalFall) return;
  if (controlledSoldier(entities)?.dying?.action ||
    controlledSoldier(entities)?.blastReaction && !controlledSoldier(entities)?.dying) return;
  if (state !== 'playing' || allies[current]?.health <= 0) return;
  if (dadaoEquipped || grenadeEquipped || allies[current].grenades.action) return;
  if (allies[current].traversal.kind === 'vaulting') return;
  const transport = occupiedVehicle(entities, allies[current]);
  if (transport && !occupiedSeat(entities).canFire) {
    toast('驾驶员席位不能发射主炮；按 Y 切换车长或炮手');
    return;
  }
  const motion = allies[current].locomotion;
  if ((unit.type === 'infantry' || unit.type === 'mortar') && (motion.sprinting || motion.aimRecovery > 0)) return;
  if (unit.type === 'mortar' && shells.length >= PROJECTILE_LIMIT) { toast('在飞炮弹已达上限，请等待弹着后再射击'); return; }
  if (unit.type === 'infantry') {
    if (time < unit.nextShot) return;
    if (weaponObstruction > 0 || obstructionBlend > .03) { toast('枪口受阻 · 后退或移开枪口'); return; }
    if (!shootRifle(allies[current].rifle, !allies[current].dying)) { syncRifleUnit(); return; }
    if (allies[current].rifle.queuedReload) emitControlEvent('weapon.reload-requested', {
      weaponId: allies[current].rifle.id, duration: rifleReloadSeconds(allies[current].rifle), queued: true });
    if (infantryWeaponProfile(allies[current].rifle).scoped) held.primary = false;
    syncRifleUnit();
  } else if (!shotState(unit, time, true)) return;
  if (unit.type === 'tank') emitControlEvent('weapon.reload-requested', { weaponId: transport.weapon.id, duration: TYPES.tank.reload });
  if (allies[current].dying) {
    allies[current].dying.action = 'shot';
    playerInput.releaseFire();
  }
  const source = captureAttackSource(entities, allies[current]);
  combatSounds.push({ id: ++soundSerial, friendly: true, x: camera.position.x, y: camera.position.y, z: camera.position.z, time, radius: unit.type === 'infantry' ? 55 : 85 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (transport?.type === 'plane') direction.set(-Math.sin(transport.heading) * Math.cos(transport.pitch),
    Math.sin(transport.pitch), -Math.cos(transport.heading) * Math.cos(transport.pitch));
  else camera.getWorldDirection(direction);
  const start = transport?.type === 'plane' ? new THREE.Vector3(0, .1, -2.8)
    .applyEuler(new THREE.Euler(transport.pitch, transport.heading, transport.roll, 'YXZ')).add(transport.position) : camera.position.clone();
  if (unit.type === 'mortar') {
    const target = getMortarTarget();
    combatEvents.publish('shot', { source, weaponType: unit.type, start, end: null, sound: 'blast', recoil: .05 }, time);
    const shell = createProjectile({ id: `shell-${++projectileSerial}`, source, start, target,
      firedAt: time, duration: 1.6 + target.distanceTo(start) / 35, damage: MORTAR.damage, radius: MORTAR.radius });
    shell.blastKind = MORTAR.blastKind;
    const mesh = new THREE.Mesh(projectileGeometry, shellMaterial);
    mesh.userData.projectileId = shell.id;
    mesh.position.copy(shell.position);
    scene.add(mesh);
    shellViews.set(shell.id, mesh);
    shells.push(shell);
  } else {
    ray.set(start, direction);
    const shotRange = unit.type === 'plane' ? 260 : unit.type === 'infantry'
      ? infantryWeaponProfile(allies[current].rifle).range : RIFLE.range;
    ray.far = shotRange;
    const endOfRay = start.clone().addScaledVector(direction, ray.far);
    const enemyTargets = actorGrid.near(start.x, start.z, ray.far).filter(actor => !actor.friendly && !actor.vehicleId && actor.health > 0 && pointSegmentDistance(actor.position, start, endOfRay).distance < 2);
    const enemyModels = enemyTargets.map(actor => soldierHits.sync(actor, time));
    const targets = [...solidIndex.candidates(start, direction, ray.far), ...vehicleSolids(transport?.id), ...enemyModels];
    let hit = ray.intersectObjects(targets, true)[0], shellSurface = null;
    const end = hit ? hit.point : start.clone().addScaledVector(direction, ray.far);
    const cannonPoint = unit.type === 'tank' ? tankCannonPose(transport).start : null;
    const muzzle = unit.type === 'infantry' ? weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3())
      : cannonPoint ? new THREE.Vector3(cannonPoint.x, cannonPoint.y, cannonPoint.z)
      : transport?.type === 'plane' ? start.clone() : new THREE.Vector3(.28, -.25, -1.25).applyMatrix4(camera.matrixWorld);
    if (unit.type === 'infantry' || unit.type === 'tank') {
      // Aim at the sight ray's target, but resolve the shot from the physical muzzle.
      const travel = end.clone().sub(muzzle);
      if (travel.dot(direction) <= 0) travel.copy(direction);
      ray.set(muzzle, travel.normalize()); ray.far = shotRange;
      hit = ray.intersectObjects([...solidIndex.candidates(muzzle, travel, ray.far), ...vehicleSolids(transport?.id), ...enemyModels], true)[0];
      end.copy(hit ? hit.point : muzzle.clone().addScaledVector(travel, ray.far));
      if (unit.type === 'tank') {
        const ground = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
        if (ground && ground.distanceTo(muzzle) < end.distanceTo(muzzle)) {
          end.copy(ground); hit = null; shellSurface = { kind: 'soil', normal: { x: 0, y: 1, z: 0 } };
        } else if (hit) shellSurface = captureImpact(hit, travel);
        transport.weapon.lastShot = Object.freeze({ time, impact: Boolean(shellSurface),
          start: Object.freeze(muzzle.toArray()), end: Object.freeze(end.toArray()) });
      } else lastRifleTrace = { start: muzzle.toArray(), end: end.toArray(), time, hit: Boolean(hit), doorId: hit?.object.userData.doorIds?.[hit.instanceId] || null,
        targetId: hit?.object.userData.actor?.id ?? null, hitZone: hit?.object.userData.hitZone ?? null,
        bodyPart: hit?.object.userData.bodyPart ?? null,
        rallyId: hit?.object.userData.rallyId || null, vehicleId: hit?.object.userData.vehicleId || null };
    }
    combatEvents.publish('shot', { source, weaponType: unit.type, start: muzzle, end, muzzle: ['infantry', 'tank'].includes(unit.type),
      automatic: unit.type === 'infantry' && infantryWeaponProfile(allies[current].rifle).automatic,
      sound: unit.type === 'tank' ? 'blast' : 'shot', recoil: unit.type === 'tank' ? .04 :
        .05 * mountStability(allies[current].weaponMount, Boolean(infantryWeaponProfile(allies[current].rifle).automatic)).recoil }, time);
    for (const enemy of enemies) {
      if (enemy.health > 0 && pointSegmentDistance(enemy.position, muzzle, end).distance < 2.2) {
        enemy.tactics.suppressedUntil = time + 3;
        enemy.tactics.decisionAt = Math.min(enemy.tactics.decisionAt, time);
      }
    }
    if (unit.type === 'tank') {
      if (hit?.object.userData.actor) hurt(hit.object.userData.actor, TYPES.tank.damage, source, 'cannon');
      if (shellSurface) explode(end, TYPES.tank.damage, 11, source, 'explosion', shellSurface);
    } else if (hit) {
      const impact = hit.object.userData.actor ? { position: end, kind: null } : captureImpact(hit, end.clone().sub(muzzle).normalize());
      combatEvents.publish('impact', { ...impact, source }, time);
      if (hit.object.userData.vehicleId) {
        const hitVehicle = entities.vehicles.get(hit.object.userData.vehicleId);
        damageVehicle(hitVehicle, TYPES[unit.type].damage, source, unit.type === 'plane' ? 'aircraft-gun' : 'rifle');
      }
      if (hit.object.userData.actor) {
        hurt(hit.object.userData.actor, TYPES[unit.type].damage, source, unit.type === 'plane' ? 'aircraft-gun' : 'rifle',
          hit.object.userData.hitZone, end.clone().sub(muzzle));
      }
    }
    ray.far = Infinity;
  }
}

function getMortarTarget() {
  camera.getWorldDirection(direction);
  ray.set(camera.position, direction);
  const intersection = ray.ray.intersectPlane(groundPlane, mortarTarget);
  if (!intersection || mortarTarget.distanceTo(camera.position) > 85) {
    mortarTarget.copy(direction);
    mortarTarget.y = 0;
    mortarTarget.normalize().multiplyScalar(85).add(camera.position);
    mortarTarget.y = .1;
  }
  mortarTarget.x = THREE.MathUtils.clamp(mortarTarget.x, -105, 105);
  mortarTarget.z = THREE.MathUtils.clamp(mortarTarget.z, -105, 105);
  mortarTarget.y = world.groundHeight(mortarTarget.x, mortarTarget.z) + .15;
  return mortarTarget;
}

const mortarMarker = new THREE.Mesh(new THREE.RingGeometry(.6, .85, 24), new THREE.MeshBasicMaterial({ color: 0xffd18a, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: .8 }));
mortarMarker.rotation.x = -Math.PI / 2;
mortarMarker.visible = false;
scene.add(mortarMarker);

function updateJapaneseArmor(transport, dt) {
  const nightRegroup = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && !sihangCampaign.counterattack;
  const gateRegroup = nanjingCampaignMode && nanjingCampaign.stage === 'withdrawal';
  const eastAssembly = encirclementMode && encirclement.phase === 2 && encirclement.breakout?.stage !== 'breakout';
  const dockLimited = nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage);
  const navigation = dockLimited ? dockArmorNavigate : armorNavigate;
  const vehicles = [...entities.vehicles.values()];
  const targets=sihangCampaignMode ? friendlyForces.filter(sihangEnemyTargetAllowed) : nanjingCampaignMode?[...friendlyForces,...nanjingCivilianCombatTargets()]:friendlyForces;
  const artillery = artilleryPositionTargets(emplacements.values(), world.groundHeight)
    .filter(target => target.team !== transport.team &&
      (!sihangCampaignMode || !sihangProtectedSouthBank(target.position)));
  const cannonTargets = [...targets, ...artillery];
  const warehouseEntered = sihangCampaignMode && enemies.some(actor => actor.tactics.sihangEnteredWarehouse);
  const objective = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && warehouseEntered
    ? sihangArmorInterceptObjective()
    : encirclementMode && encirclement.phase === 2
    ? { id: 'east-breakout', x: EAST_BREAKOUT.x, z: EAST_BREAKOUT.z, radius: 8, owner: 'friendly' }
    : nanjingCampaignMode
    ? objectives.find(point => point.id === (nanjingCampaign.dockActivated ? 'dock' : 'gate'))
    : objectives.find(point => !point.captured) ?? objectives[0];
  const crew = transport.seats.map(seat => entities.soldiers.get(seat.occupantId)).filter(actor => actor?.health > 0);
  const gunner = transport.seats.filter(seat => seat.canFire).map(seat => entities.soldiers.get(seat.occupantId)).find(actor => actor?.health > 0);
  const supportDestination = sihangSupportContext && crew[0] ? sihangSupportGoal(crew[0]) : null;
  const protectedInfantry = sihangCampaignMode
    ? enemies.filter(actor => actor.tactics.sihangDemolitionReturned) : [];
  const shot = advanceChiHaAI(transport, dt, time, {
    crew, canFire: Boolean(gunner) && !eastAssembly && !finalBoardingFireHeld(nanjingCampaign, time), holdOnVisible: nightRegroup,
    targets: eastAssembly ? [] : gateRegroup
      ? cannonTargets.filter(actor => actor.position.z > -12 && Math.hypot(actor.position.x, actor.position.z - 29) < 40)
      : cannonTargets, objective,
    destination: nightRegroup ? { x: (entities.units.get(transport.unitId).armorSlot === 0 ? -70 : 70), z: -55 }
      : supportDestination ?? (encirclementMode && encirclement.phase === 2 && crew.length ? breakoutDestination(crew[0])
      : gateRegroup ? transport.position.z > 40 ? { x: -24, z: 38 } : { x: 0, z: 29 }
      : nanjingCampaignMode && !nanjingCampaign.dockActivated
      ? transport.position.z > 38 + CHI_HA.arrivalDistance + .1 ? { x: -24, z: 38 } : { x: 0, z: 28 }
      : dockLimited ? { x: -43, z: -85 }
      : chiHaObjectiveDestination(entities.units.get(transport.unitId).armorSlot ?? entities.units.get(transport.unitId).index - 8, objective)),
    visible: (from, to, target) => (!sihangCampaignMode || sihangNightVisibility(sihangCampaign, from, to)) &&
      hasLine(new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z), CHI_HA.range + 5, transport.id, target?.emplacementPositionId),
    safeToFire: (from, to) => (!sihangCampaignMode || sihangBlastClearOfSouthBank(to, CHI_HA.blastRadius)) && !enemies.some(actor => actor.health > 0 && !actor.vehicleId &&
      (Math.hypot(actor.position.x - to.x, actor.position.z - to.z) < CHI_HA.blastRadius + 1 ||
        pointSegmentDistance(actor.position, from, to).distance < 1.2)),
    pathTo: (from, to) => navigation.pathTo(transport, to, vehicles, protectedInfantry),
    canTravel: (from, to) => (!sihangCampaignMode || sihangNorthBank(to, 3)) &&
      sihangCoverMovementAllowed(from, to, sihangSupportContext) && navigation.canTravel(transport, from, to, vehicles, protectedInfantry),
    move: (position, dx, dz) => {
      if (sihangCampaignMode && !sihangNorthBank({ x: position.x + dx, z: position.z + dz }, 3)) return;
      if (!sihangCoverMovementAllowed(position, { x: position.x + dx, z: position.z + dz }, sihangSupportContext)) return;
      navigation.move(transport, dx, dz, vehicles, protectedInfantry);
    },
  });
  transport.position.y = world.groundHeight(transport.position.x, transport.position.z);
  const machineGunShots = advanceChiHaMachineGuns(transport, dt, time, {
    crew, targets: eastAssembly || finalBoardingFireHeld(nanjingCampaign, time) ? [] : targets, busyCrewIds: shot ? [gunner.id] : [],
    aimPoint: actor => ({ x: actor.position.x, y: actor.position.y +
      (actor.civilian?actor.aimHeight:soldierPostureHeight(actor,'aim')), z: actor.position.z }),
    visible: (from, to) => (!sihangCampaignMode || sihangNightVisibility(sihangCampaign, from, to)) &&
      hasLine(new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(to.x, to.y, to.z), CHI_HA_MG.range + 2, transport.id),
    safeToFire: (from, to) => (!sihangCampaignMode || !sihangProtectedSouthBank(to)) && !enemies.some(actor => actor.health > 0 && !actor.vehicleId &&
      pointSegmentDistance(actor.position, from, to).distance < .8),
  });
  for (const machineGunShot of machineGunShots) fireTankMachineGun(transport, machineGunShot);
  if (!shot) return;
  const source = captureAttackSource(entities, gunner, transport.weapon);
  const start = new THREE.Vector3(shot.start.x, shot.start.y, shot.start.z);
  const travel = new THREE.Vector3(-Math.sin(transport.turretYaw) * Math.cos(transport.turretPitch),
    Math.sin(transport.turretPitch), -Math.cos(transport.turretYaw) * Math.cos(transport.turretPitch));
  const shotRange = sihangCampaignMode ? sihangEnemyRayRange(start, travel, CHI_HA.range) : CHI_HA.range;
  if (!shotRange) return;
  const endOfRay = start.clone().addScaledVector(travel, shotRange);
  const people = allForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
    pointSegmentDistance(actor.position, start, endOfRay).distance < 2).map(actor => soldierHits.sync(actor, time));
  ray.set(start, travel); ray.far = shotRange;
  const hit = ray.intersectObjects([...solidIndex.candidates(start, travel, shotRange),
    ...vehicleSolids(transport.id), ...people], true)[0];
  // The target point may be below a standing body's proxy; ground contact still ends the shell.
  const groundHit = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
  let end = hit ? hit.point : endOfRay, surface = hit ? captureImpact(hit, travel) : null;
  if (groundHit && groundHit.distanceTo(start) < end.distanceTo(start)) {
    end = groundHit; surface = { kind: 'soil', normal: { x: 0, y: 1, z: 0 } };
  }
  const civilianHit=nanjingCampaignMode?traceCivilianBullet(nanjingCivilianCombatTargets().map(target=>target.civilian),
    start,travel,end.distanceTo(start),person=>person.getWorldPosition(new THREE.Vector3())):null;
  if(civilianHit){end=new THREE.Vector3(civilianHit.position.x,civilianHit.position.y,civilianHit.position.z);surface=null;}
  ray.far = Infinity;
  combatEvents.publish('shot', { source, weaponType: 'tank', start, end, sound: 'blast', recoil: 0 }, time);
  combatSounds.push({ id: ++soundSerial, friendly: false, x: start.x, y: start.y, z: start.z, time, radius: 85 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (surface || civilianHit) explode(end, CHI_HA.damage, CHI_HA.blastRadius, source, 'explosion', surface);
}

function fireTankMachineGun(transport, shot) {
  const settings = shot.gun.settings, friendly = transport.team === 'friendly';
  const source = captureAttackSource(entities, shot.operator, shot.gun);
  const start = new THREE.Vector3(shot.start.x, shot.start.y, shot.start.z);
  let aim = null;
  if (friendly && shot.operator.id === entities.control.soldierId && occupiedVehicle(entities, shot.operator)?.id === transport.id) {
    const sightDirection = camera.getWorldDirection(new THREE.Vector3()), sightStart = camera.position;
    const sightEnd = sightStart.clone().addScaledVector(sightDirection, settings.range);
    const sightPeople = allForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
      pointSegmentDistance(actor.position, sightStart, sightEnd).distance < 2).map(actor => soldierHits.sync(actor, time));
    ray.set(sightStart, sightDirection); ray.far = settings.range;
    const target = ray.intersectObjects([...solidIndex.candidates(sightStart, sightDirection, settings.range),
      ...vehicleSolids(transport.id), ...sightPeople], true)[0];
    if (target) sightEnd.copy(target.point);
    const floor = sightDirection.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
    if (floor && floor.distanceTo(sightStart) < sightEnd.distanceTo(sightStart)) sightEnd.copy(floor);
    ray.far = Infinity;
    aim = tankConvergedDirection(shot, sightEnd);
  }
  const yaw = (aim ? Math.atan2(-aim.x, -aim.z) : shot.yaw) + (battleRandom() * 2 - 1) * settings.spread;
  const pitch = (aim ? Math.asin(aim.y) : shot.pitch) + (battleRandom() * 2 - 1) * settings.spread;
  fireAutomaticShot(transport, shot, source, start, yaw, pitch);
}

function fireAutomaticShot(transport, shot, source, start, yaw, pitch, aircraft = false, ignoredEmplacementId = null) {
  const settings = shot.gun.settings, friendly = transport.team === 'friendly';
  const travel = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  const shotRange = sihangCampaignMode && !friendly ? sihangEnemyRayRange(start, travel, settings.range) : settings.range;
  if (!shotRange) return;
  const endOfRay = start.clone().addScaledVector(travel, shotRange);
  const people = allForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
    pointSegmentDistance(actor.position, start, endOfRay).distance < 2).map(actor => soldierHits.sync(actor, time));
  ray.set(start, travel); ray.far = shotRange;
  let hit = ray.intersectObjects([...solidIndex.candidates(start, travel, shotRange)
    .filter(object => !ignoredEmplacementId || object.userData.emplacementId !== ignoredEmplacementId ||
      object.userData.emplacementCover),
    ...vehicleSolids(transport.id), ...people], true)[0];
  const groundHit = travel.y < 0 ? ray.ray.intersectPlane(groundPlane, new THREE.Vector3()) : null;
  let end = hit ? hit.point : endOfRay;
  if (groundHit && groundHit.distanceTo(start) < end.distanceTo(start)) { end = groundHit; hit = null; }
  const civilianHit = nanjingCampaignMode && !friendly
    ? traceCivilianBullet(nanjingCivilianCombatTargets().map(target=>target.civilian),start,travel,end.distanceTo(start),
      person=>person.getWorldPosition(new THREE.Vector3())) : null;
  if (civilianHit) { end = new THREE.Vector3(civilianHit.position.x, civilianHit.position.y, civilianHit.position.z); hit = null; }
  ray.far = Infinity;
  shot.gun.lastShot = Object.freeze({ time, start: Object.freeze(start.toArray()), end: Object.freeze(end.toArray()) });
  combatEvents.publish('shot', { source, weaponType: aircraft ? 'plane' : 'infantry', start, end, sound: 'shot', muzzle: true, automatic: true,
    color: friendly ? 0xf6d399 : 0xdfb17a }, time);
  combatSounds.push({ id: ++soundSerial, friendly, x: start.x, y: start.y, z: start.z, time, radius: 40 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (civilianHit) {
    applyCivilianDamage(civilianHit.civilian, settings.damage, source);
    combatEvents.publish('impact', { position: end, kind: null, source }, time);
    return;
  }
  if (!hit) return;
  const actor = hit.object.userData.actor;
  const impact = actor ? { position: end, kind: null } : captureImpact(hit, travel);
  combatEvents.publish('impact', { ...impact, source }, time);
  const damageKind = settings.antiAircraft ? 'anti-aircraft-gun' : aircraft ? 'aircraft-gun' : 'rifle';
  if (actor && actor.team !== transport.team) hurt(actor, settings.damage, source, damageKind, hit.object.userData.hitZone, travel);
  const vehicle = entities.vehicles.get(hit.object.userData.vehicleId);
  if (vehicle && vehicle.team !== transport.team) damageVehicle(vehicle, settings.damage, source, damageKind);
}

function updateVehicles(dt) {
  for (const actor of allForces) {
    const point = emplacements.get(actor.emplacementId);
    actor.artilleryThreat = Boolean(point?.profile === 'bofors75' && point.health > 0 && point.operatorId === actor.id);
  }
  for (const transport of entities.vehicles.values()) {
    if (transport.health <= 0) {
      if (transport.type === 'plane' && transport.fall && !transport.fall.grounded && !transport.fall.sunk) {
        const impactHeight = world.impactHeight ?? world.groundHeight;
        const landed = advanceAircraftFall(transport, dt, time, (from, to) => {
          const collision = traceGrenade(from, to, .45, false, transport.id, true, impactHeight);
          if (collision) return { ...collision.position,
            ...(collision.surfaceKind === 'ground' && world.isDeepWater?.(collision.position.x, collision.position.z)
              ? { water: true, waterLevel: impactHeight(collision.position.x, collision.position.z) } : {}) };
          const floor = impactHeight(to.x, to.z) + .45;
          if (to.y <= floor) return { x: to.x, y: floor, z: to.z,
            ...(world.isDeepWater?.(to.x, to.z) ? { water: true, waterLevel: floor - .45 } : {}) };
          return null;
        });
        for (const seat of transport.seats) {
          const occupant = entities.soldiers.get(seat.occupantId);
          if (occupant) occupant.position.copy(transport.position);
        }
        if (landed) {
          if (transport.fall.sinking) tacticalAudio?.waterCrash(transport, time);
          combatEvents.publish('explosion', { position: transport.position,
            source: { credit: 'environment', cause: 'crash', vehicleId: transport.id },
            sound: !transport.fall.sinking, style: 'tank-destruction' }, time);
        }
      }
      continue;
    }
    if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      transport.team === 'enemy' && transport.type === 'plane') {
      const turn = Math.atan2(Math.sin(-transport.heading), Math.cos(-transport.heading));
      transport.heading += THREE.MathUtils.clamp(turn, -dt * .55, dt * .55);
      transport.pitch = THREE.MathUtils.damp(transport.pitch, .06, 2, dt);
      transport.bank = THREE.MathUtils.damp(transport.bank ?? 0, -Math.sign(turn) * Math.min(.25, Math.abs(turn)), 2, dt);
      transport.position.x -= Math.sin(transport.heading) * dt * 48;
      transport.position.z -= Math.cos(transport.heading) * dt * 48;
      transport.position.y += dt * 3;
      for (const seat of transport.seats) {
        const occupant = entities.soldiers.get(seat.occupantId);
        if (occupant) occupant.position.copy(transport.position);
      }
      if (transport.position.z < -220) {
        const crew = transport.seats.map(seat => entities.soldiers.get(seat.occupantId)).filter(Boolean);
        clearActors(crew);
        enemies = enemies.filter(actor => !crew.includes(actor));
        entities.vehicles.delete(transport.id); entities.weapons.delete(transport.weapon.id);
        rebuildForces();
      }
      continue;
    }
    if (transport.variant === CHI_HA.id) {
      updateJapaneseArmor(transport, dt);
      for (const seat of transport.seats) {
        const occupant = entities.soldiers.get(seat.occupantId);
        if (occupant) occupant.position.copy(transport.position);
      }
      continue;
    }
    if (transport.type === 'plane' && transport.team === 'enemy') {
      const pilot = transport.seats.map(seat => entities.soldiers.get(seat.occupantId)).find(actor => actor?.health > 0);
      const eastAirSupport=encirclementMode&&encirclement.phase===2;
      const shot = advanceAircraftAI(transport, dt, time, { targets: eastAirSupport
        ? friendlyForces.filter(actor=>actor.unitId===controlledSoldier(entities)?.unitId ||
          Math.hypot(actor.position.x-EAST_BREAKOUT.x,actor.position.z-EAST_BREAKOUT.z)<75)
        : sihangCampaignMode ? friendlyForces.filter(sihangEnemyTargetAllowed) : nanjingCampaignMode?[...friendlyForces,...nanjingCivilianCombatTargets()]:friendlyForces,
        preferredUnitId: controlledSoldier(entities)?.unitId,
        canFire: Boolean(pilot) && !finalBoardingFireHeld(nanjingCampaign, time) &&
          (!eastAirSupport || encirclement.breakout?.stage === 'breakout') &&
          (!nanjingCampaignMode || nanjingCampaign.stage !== 'withdrawal' && !nanjingCampaign.outcome),
        obstacles: world.obstacles, collisionLookup: aircraftCollision, groundHeight: world.groundHeight,
        patrolCenter: nanjingCampaignMode ? objectives.find(point => point.id === (nanjingCampaign.dockActivated ? 'dock' : 'gate'))
          : eastAirSupport ? EAST_BREAKOUT : undefined,
        visible: (from, to) => (!sihangCampaignMode || !sihangSouthBank(to)) && hasLine(new THREE.Vector3(from.x, from.y, from.z),
          new THREE.Vector3(to.x, to.y, to.z), 225, transport.id) });
      if (shot) fireAircraftGun(transport, pilot, shot.start);
      for (const seat of transport.seats) {
        const occupant = entities.soldiers.get(seat.occupantId);
        if (occupant) { occupant.position.copy(transport.position); occupant.heading = transport.heading; }
      }
      const colliding = world.obstacles.some(b => transport.position.x > b.minX - 1 && transport.position.x < b.maxX + 1 &&
        transport.position.z > b.minZ - 1 && transport.position.z < b.maxZ + 1 && transport.position.y < b.height + 1);
      if (transport.position.y < 1.8 || colliding) damageVehicle(transport, transport.health, 'crash', 'collision');
      continue;
    }
    const actor = allies[current];
    const controlled = state === 'playing' && actor?.health > 0 && actor.vehicleId === transport.id;
    const forward = controlled ? Number(keys.has('KeyW')) - Number(keys.has('KeyS')) : 0;
    const sideways = controlled ? Number(keys.has('KeyD')) - Number(keys.has('KeyA')) : 0;
    const position = transport.position;
    if (transport.type === 'plane') {
      advancePlayerAircraft(transport, dt, {
        roll: controlled ? Number(keys.has('KeyA')) - Number(keys.has('KeyD')) : 0,
        pitch: controlled ? Number(keys.has('KeyS')) - Number(keys.has('KeyW')) : 0,
        rudder: controlled ? Number(keys.has('KeyQ')) - Number(keys.has('KeyE')) : 0,
        throttle: controlled ? Number(keys.has('ShiftLeft')) - Number(keys.has('ControlLeft')) : 0,
        freeLook: controlled && keys.has('KeyC'),
      });
      const colliding = world.obstacles.some(b => position.x > b.minX - 1 && position.x < b.maxX + 1 && position.z > b.minZ - 1 && position.z < b.maxZ + 1 && position.y < b.height + 1);
      if (position.y < 1.8 || colliding) { damageVehicle(transport, transport.health, 'crash', 'collision'); continue; }
    } else {
      transport.roll = 0;
      const driving = advanceTankDriving(transport, forward, sideways, dt);
      transport.heading -= driving.turn;
      const beforeX = position.x, beforeZ = position.z;
      moveGround(position, -Math.sin(transport.heading) * driving.distance, -Math.cos(transport.heading) * driving.distance, 1.9,
        movementObstacles(position.x, position.z, transport.id));
      const traveled = Math.hypot(position.x - beforeX, position.z - beforeZ);
      if (Math.abs(driving.distance) > .000001 && traveled < Math.abs(driving.distance) * .95)
        transport.speed *= traveled / Math.abs(driving.distance);
      transport.trackDistance += Math.sign(driving.distance) * traveled;
      position.y = world.groundHeight(position.x, position.z);
    }
    for (const seat of transport.seats) {
      const occupant = entities.soldiers.get(seat.occupantId);
      if (!occupant) continue;
      occupant.position.copy(position);
    }
  }
}

function updateTankContacts(before, dt) {
  for (const tank of entities.vehicles.values()) {
    if (tank.type !== 'tank' || tank.health <= 0 || !before.has(tank.id)) continue;
    const start = before.get(tank.id);
    tank.groundMotion = {
      x: (tank.position.x - start.x) / dt, z: (tank.position.z - start.z) / dt,
      turn: headingError(start.heading, tank.heading) / dt,
    };
    if (!preferenceValues.tankCrushing) continue;
    let source = null;
    for (const actor of allForces) {
      if (!tankSweptContact(tank, start, actor, dt)) continue;
      if (!source) {
        const controlled = controlledSoldier(entities);
        const operator = controlled?.health > 0 && controlled.vehicleId === tank.id ? controlled :
          tank.seats.filter(seat => seat.role === 'driver').concat(tank.seats)
            .map(seat => entities.soldiers.get(seat.occupantId)).find(person => person?.health > 0);
        source = operator ? Object.freeze({ ...captureAttackSource(entities, operator, tank.weapon), cause: 'tank-crush' })
          : Object.freeze({ credit: 'environment', cause: 'tank-crush', vehicleId: tank.id });
      }
      hurt(actor, actor.health, source, 'collision');
    }
  }
}

function fireAircraftGun(transport, pilot, muzzle) {
  const source = captureAttackSource(entities, pilot, transport.weapon);
  const start = new THREE.Vector3(muzzle.x, muzzle.y, muzzle.z);
  const gun={settings:{...AIRCRAFT_GUN,damage:TYPES.plane.damage},lastShot:null};
  fireAutomaticShot(transport,{gun},source,start,
    transport.heading+(battleRandom()*2-1)*AIRCRAFT_GUN.spread,
    transport.pitch+(battleRandom()*2-1)*AIRCRAFT_GUN.spread,true);
  transport.weapon.lastShot=gun.lastShot;
}

function updateWeaponSimulation(dt) {
  for (const actor of entities.soldiers.values()) {
    actor.meleePriority = false;
    if (actor !== controlledSoldier(entities) && emptyMagazineMeleeCandidate(actor, actor.target)) {
      const target = actor.target;
      const origin = soldierEyePosition(actor), destination = targetAimPoint(target);
      actor.meleePriority = hasLine(new THREE.Vector3(origin.x, origin.y, origin.z), destination, meleeEngagementRange(actor, target) + 2) &&
        segmentClear(actor.position, target.position, .43, null, movementObstacles, actor.position.y, 1.75);
    }
    if (actor.health > 0 && (actor !== controlledSoldier(entities) || state !== 'playing')) advanceBreath(actor.breathControl, dt, false, false);
  }
  const cues = advanceOwnedWeapons(entities, dt, time, state === 'playing' && !toolEquipped && !dadaoEquipped && !grenadeEquipped, true);
  for (const cue of cues)
    if (cue.soldierId === entities.control.soldierId) emitControlEvent('weapon.mechanical', cue);
  if (state === 'playing') syncRifleUnit();
}

function updateBattleBoundary(dt) {
  const apply = (subject, area, vehicle) => {
    let boundary = boundaryStates.get(subject.id);
    if (!boundary) { boundary = createBoundaryState(); boundaryStates.set(subject.id, boundary); }
    const damage = advanceBoundary(boundary, subject.position, dt, area);
    if (damage > 0) {
      const source = { credit: 'environment', cause: 'boundary', subjectId: subject.id };
      if (vehicle) damageVehicle(subject, damage, source, 'boundary');
      else hurt(subject, damage, source, 'boundary');
    }
  };
  for (const actor of allies) if (actor.health > 0 && !actor.vehicleId && !hasFerrySupport(actor)) apply(actor, battleArea, false);
  for (const transport of entities.vehicles.values()) {
    if (transport.health > 0 && entities.units.get(transport.unitId)?.player) {
      apply(transport, transport.type === 'plane' ? AIR_BATTLE_AREA : battleArea, true);
    }
  }
}

function controlledBoundary() {
  const actor = controlledSoldier(entities);
  if (hasFerrySupport(actor)) return null;
  return actor ? boundaryStates.get(occupiedVehicle(entities, actor)?.id ?? actor.id) : null;
}

function renderBattleBoundary() {
  const boundary = controlledBoundary(), element = $('boundary-warning');
  element.hidden = state !== 'playing' || !boundary?.outside || controlledSoldier(entities)?.health <= 0;
  if (element.hidden) return;
  element.classList.toggle('damaging', boundary.damaging);
  const direction = `${boundary.returnX < 0 ? '西' : boundary.returnX > 0 ? '东' : ''}${boundary.returnZ < 0 ? '北' : boundary.returnZ > 0 ? '南' : ''}`;
  const distance = Math.ceil(Math.hypot(boundary.returnX, boundary.returnZ));
  $('boundary-detail').textContent = `向${direction}返回约 ${distance} 米 · ${boundary.damaging
    ? `正在损失生命（${BOUNDARY_RULES.damagePerSecond}/秒）` : `${Math.ceil(boundary.remaining)} 秒后开始掉血`}`;
}

function probeWeaponSupport(point, depth) {
  const supportRay = new THREE.Raycaster(new THREE.Vector3(point.x, point.y, point.z), new THREE.Vector3(0, -1, 0), 0, depth);
  const hit = supportRay.intersectObjects(solidIndex.candidates(supportRay.ray.origin, supportRay.ray.direction, depth), false)[0];
  if (!hit?.face || hit.object.userData.doorIds || hit.object.userData.doorId) return null;
  const matrix = hit.object.matrixWorld.clone();
  if (hit.instanceId != null) {
    const instance = new THREE.Matrix4();
    hit.object.getMatrixAt(hit.instanceId, instance); matrix.multiply(instance);
  }
  const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(matrix));
  return { x: hit.point.x, y: hit.point.y, z: hit.point.z, normalY: normal.y };
}

function weaponSupportAvailable(actor) {
  return Boolean(actor.health > 0 && !actor.vehicleId && unit?.type === 'infantry' &&
    actor.traversal.kind === 'grounded' && !toolEquipped && !dadaoEquipped && !grenadeEquipped && !actor.grenades.action &&
    actor.rifle.action !== 'reload' && !actor.locomotion.sprinting && actor.locomotion.aimRecovery === 0);
}

function currentMountCandidate(actor) {
  return mountCandidate(actor.position, soldierPostureHeight(actor), controlPose.yaw, probeWeaponSupport);
}

function updateActorTraversal(actor, dt) {
  if (hasFerrySupport(actor)) return;
  const previousY = actor.position.y;
  const impact = advanceTraversal(actor.traversal, actor.position, dt,
    movementObstacles(actor.position.x, actor.position.z), world.walkHeight,
    actor.traversal.kind === 'vaulting'
      ? engineerConstructionReservations(actor, actorGrid.near(actor.position.x, actor.position.z, 8)) : []);
  if (sihangCampaignMode && actor === controlledSoldier(entities) && actor.position.y < previousY &&
    enemies.some(enemy => enemy.health > 0 && enemy.sihangShield?.active &&
      previousY > enemy.position.y + 1.8 && actor.position.y <= enemy.position.y + 2 &&
      Math.hypot(actor.position.x - enemy.position.x, actor.position.z - enemy.position.z) < .9))
    actor.tactics.sihangShieldLanding = time;
  if (impact !== null) {
    landLocomotion(actor.locomotion, impact);
    actor.locomotion.aimRecovery = Math.max(actor.locomotion.aimRecovery, .2);
    if (actor === controlledSoldier(entities)) emitFootstep(actor.position, actor.locomotion.speed, true);
    const fallDamage = landingDamage(impact);
    const fatalLanding = beginFatalFall(actor, fallDamage, time, actor === controlledSoldier(entities));
    const damage = fatalLanding ? Math.max(0, actor.health - 1) : fallDamage;
    if (fatalLanding) {
      releaseEmplacement(actor, false); releaseWeaponMount(actor.weaponMount);
      clearControlInputs(); resetConstruction();
      actor.stance = controlPose.stance = 'prone'; actor.firingPose = null;
      stopLocomotion(actor.locomotion); actor.rifleReady = false;
      const throwable = lastStandThrowable(actor, selectedThrowable);
      if (throwable) equipGrenade(throwable);
      toast('重伤', 1);
    }
    if (damage > 0) hurt(actor, damage, { credit: 'environment', cause: 'fall', subjectId: actor.id }, 'fall');
  }
  if (actor.traversal.blocked && actor === controlledSoldier(entities)) {
    toast('翻越路径受阻 · 已停止翻越');
    actor.traversal.blocked = false;
  }
}

function nanjingDockMovementLimited(position) {
  return nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage) && nanjingEnemyPositions.has(position);
}

function moveInfantry(position, dx, dz, radius, obstacles, bodyHeight = TRAVERSAL.bodyHeight) {
  if (nanjingDockMovementLimited(position)) obstacles = [...obstacles, NANJING_DOCK_BUFFER];
  if (sihangSupportContext && !sihangCampaign.northWallBreached &&
    sihangEnemyPositions.has(position) && !sihangSapperPositions.has(position) &&
    !sihangCoverMovementAllowed(position, { x: position.x + dx, z: position.z + dz }, sihangSupportContext))
    return position;
  if (sihangCampaignMode && sihangEnemyPositions.has(position))
    dz = Math.min(dz, sihangRiverBounds(position.x + dx).northZ - .5 - position.z);
  return moveSupported(position, dx, dz, radius, obstacles, world.walkHeight, world.moveInfantry,
    bodyHeight, nanjingCampaignMode ? 2 : Infinity);
}

function settleActorSupport(actor) {
  if (hasFerrySupport(actor)) return;
  if (actor.traversal.kind !== 'grounded') return;
  const position = actor.position;
  const floor = landingHeight(position, position.y, movementObstacles(position.x, position.z), world.walkHeight);
  if (position.y - floor > .25) {
    beginTraversal(actor.traversal, position); actor.traversal.velocity = 0;
  } else position.y = floor;
}

function updatePlayer(dt) {
  const actor = allies[current];
  actor.shoulderAiming = Boolean(held.aiming);
  if (actor.dying || actor.blastReaction) {
    stopLocomotion(actor.locomotion); actor.rifleReady = false; actor.firingPose = null;
    const fireRequested = playerInput.consumeFire(controlOwner(entities), !fatal && state === 'playing' && actor.health > 0);
    if (actor.dying && fireRequested && !actor.dying.action && !grenadeEquipped && !toolEquipped && !dadaoEquipped) fire();
    if (actor.nativeMotion) advanceNraMotion(actor, dt);
    updateCamera(dt);
    return;
  }
  if (actor.fatalFall) {
    actor.stance = controlPose.stance = 'prone'; actor.firingPose = null;
    actor.rifleReady = false; stopLocomotion(actor.locomotion);
    actor.heading = controlPose.yaw;
    if (actor.nativeMotion) advanceNraMotion(actor, dt);
    updateCamera(dt);
    return;
  }
  const fireRequested = playerInput.consumeFire(controlOwner(entities), !fatal && state === 'playing' && actor.health > 0);
  const playerFerry = nanjingPlayerFerry();
  if (playerFerry) {
    if (battleEnding.fading && actor.tactics.nanjingFerry?.phase === 'aboard') {
      const passenger = playerFerry.userData.troopPassengers?.find(passenger => passenger.actor === actor);
      if (!passenger) throw new Error('Controlled ending passenger is missing its ferry seat');
      passenger.deckControlled = true;
      const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const yaw = controlPose.yaw - playerFerry.rotation.y;
      const x = Math.max(-2.1, Math.min(2.1, passenger.local.x + (-Math.sin(yaw) * forward + Math.cos(yaw) * side) * dt * 1.5));
      const z = Math.max(-.45, Math.min(.45, passenger.local.z + (-Math.cos(yaw) * forward - Math.sin(yaw) * side) * dt * 1.5));
      let moved = 0;
      if (!playerFerry.userData.troopPassengers.some(other => other !== passenger && other.actor.health > 0 &&
        Math.hypot(other.local.x - x, other.local.z - z) < .35)) {
        moved = Math.hypot(passenger.local.x - x, passenger.local.z - z);
        passenger.local.set(x, NANJING_FERRY_FLOOR, z);
      }
      actor.position.copy(passenger.local).applyMatrix4(playerFerry.matrixWorld);
      actor.heading = controlPose.yaw; actor.stance = controlPose.stance;
      actor.locomotion.speed = dt > 0 ? moved / dt : 0; actor.locomotion.mode = moved > .001 ? 'walk' : 'idle';
      const previousPhase = actor.walkPhase; actor.walkPhase += moved * 3.6;
      if (Math.floor(previousPhase / Math.PI) !== Math.floor(actor.walkPhase / Math.PI))
        tacticalAudio?.emit('deck-step', actor.position, time, actor.id);
      actor.rifleReady = Boolean(held.aiming || fireRequested);
      if (actor.nativeMotion) advanceNraMotion(actor, dt);
      if (fireRequested) fire();
      updateCamera(dt); return;
    }
    actor.rifleReady = false; actor.firingPose = null;
    held.primary = held.aiming = false;
    const support = actor.tactics.nanjingFerry;
    if (!support && playerFerry.userData.state === 'docked') {
      const goal = nanjingBoardingGoal(actor);
      walkActor(actor, { ...goal, y: world.groundHeight(goal.x, goal.z) }, 3.2, dt);
    } else {
      actor.locomotion.speed = support?.speed ?? 0;
      actor.stance = support?.phase === 'aboard' ? 'crouched' : 'standing';
    }
    controlPose.stance = actor.stance;
    if (actor.nativeMotion) advanceNraMotion(actor, dt);
    updateCamera(dt);
    return;
  }
  const point = emplacements.get(actor.emplacementId);
  if (point) {
    stopLocomotion(actor.locomotion);
    if (point.position === 'march') {
      const before = { x: point.x, z: point.z };
      const moved = moveArtillery(point, Number(keys.has('KeyW')) - Number(keys.has('KeyS')),
        Number(keys.has('KeyD')) - Number(keys.has('KeyA')), dt, candidate => {
          const c = Math.cos(candidate.heading), s = Math.sin(candidate.heading);
          const obstacles = world.obstacles.filter(obstacle => !obstacle.id?.startsWith(`${point.id}:obstacle-`));
          for (const [x, z] of [[-.95,0],[.95,0],[-.65,1.3],[.65,1.3],[0,-1.7],[0,1.7]]) {
            const px = candidate.x + x*c + z*s, pz = candidate.z - x*s + z*c;
            if (px < battleArea.minX+.5 || px > battleArea.maxX-.5 ||
              pz < battleArea.minZ+.5 || pz > battleArea.maxZ-.5 ||
              circleBlocked(px,pz,.25,obstacles,actor.position.y) ||
              Math.abs(world.walkHeight(px,pz,actor.position.y)-actor.position.y) > .24 ||
              allForces.some(other=>other!==actor&&other.health>0&&!other.vehicleId&&
                Math.abs(other.position.y-actor.position.y)<2&&Math.hypot(other.position.x-px,other.position.z-pz)<.7)) return false;
          }
          if (world.impactHeight && world.impactHeight(candidate.x,candidate.z) < -.2) return false;
          return true;
        });
      if (moved) {
        syncArtilleryCollision(point);
        const pose = emplacementPose(point,world.groundHeight(point.x,point.z));
        actor.position.set(pose.operator.x,pose.operator.y,pose.operator.z);
        actor.locomotion.speed=Math.hypot(point.x-before.x,point.z-before.z)/Math.max(dt,.001);
        actor.locomotion.mode=actor.locomotion.speed>.01?'walk':'idle';
      }
      point.view.userData.update();
      actor.heading=point.heading; actor.stance='standing';actor.firingPose=null;actor.rifleReady=false;
      if(actor.nativeMotion)advanceNraMotion(actor,dt);
      updateCamera(dt);return;
    }
    const standingOperator = point.weapon.settings.antiAircraft;
    const operatorPose = emplacementPose(point, point.altitude ?? world.groundHeight(point.x, point.z));
    actor.position.set(operatorPose.operator.x, operatorPose.operator.y, operatorPose.operator.z);
    actor.heading = point.yaw; actor.lookPitch = point.pitch;
    actor.rifleReady = false;
    actor.firingPose = standingOperator ? null : 'kneeling';
    actor.stance = standingOperator ? 'standing' : 'crouched';
    controlPose.stance = actor.stance;
    if (actor.nativeMotion) advanceNraMotion(actor, dt);
    updateCamera(dt);
    if (fireRequested) fireFixedWeapon(point, actor);
    return;
  }
  if (!actor.vehicleId && ['infantry', 'mortar'].includes(unit.type) && actor.traversal.kind === 'grounded' &&
    keys.has('ShiftLeft') && !held.aiming && controlPose.stance !== 'standing') {
    if (!circleBlocked(actor.position.x, actor.position.z, .4,
      movementObstacles(actor.position.x, actor.position.z), actor.position.y, 1.75)) {
      controlPose.stance = 'standing'; releaseWeaponMount(actor.weaponMount);
      actor.tactics.sprintRiseBlocked = false;
    } else if (!actor.tactics.sprintRiseBlocked) {
      actor.tactics.sprintRiseBlocked = true;
      toast('上方空间不足，暂时无法站起冲刺。');
    }
  } else actor.tactics.sprintRiseBlocked = false;
  const { yaw, stance } = controlPose;
  const position = actor.position;
  const emplaced = toolEquipped && actor.mortar && actor.mortar.phase !== 'carrying';
  const forward = emplaced ? 0 : Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const sideways = emplaced ? 0 : Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  actor.aimWalking = false;
  if (forward || sideways) actor.firingPose = null;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = actor.locomotion;
  const traversal = actor.traversal, mount = actor.weaponMount;
  if (forward || sideways || keys.has('KeyQ') || keys.has('KeyE')) releaseWeaponMount(mount);
  const wasVaulting = traversal.kind === 'vaulting';
  if (!actor.vehicleId && !wasVaulting) {
    const steps = advanceLocomotion(motion, position, {
      type: unit.type, forward, sideways, yaw, stance, aiming: held.aiming, playerControlled: true,
      bodyHeight: Math.min(1.75, soldierPostureHeight(actor, 'body')),
      sprint: keys.has('ShiftLeft') && !actor.grenades.action && postureReady(actor),
      walking: keys.has('KeyC') && !keys.has('ShiftLeft'),
      grounded: traversal.kind === 'grounded',
      busy: Boolean(actor.grenades.action) || unit.reloadUntil > time ||
        (!dadaoEquipped && unit.type === 'infantry' && actor.rifle.action !== 'idle') ||
        dadaoEquipped && actor.dadao.startedAt !== null || toolEquipped || fireRequested,
    }, infantryMovementObstacles(actor, position.x, position.z), dt,
    actor.sihangEvacuated ? (p, dx, dz, ...rest) => {
      if (sihangSafePosition({ x: p.x + dx, y: p.y, z: p.z + dz })) moveInfantry(p, dx, dz, ...rest);
    } : traversal.kind !== 'grounded' ? moveAirborne : moveInfantry);
    for (let i = 0; i < steps; i++) emitFootstep(position, motion.speed);
  }
  if (!actor.vehicleId) {
    settleActorSupport(actor);
    updateActorTraversal(actor, dt);
    if (actor.health <= 0) return;
  }
  jumpHeight = traversal.kind === 'grounded' ? 0 : Math.max(0, position.y - traversal.baseY);
  jumpVelocity = traversal.velocity;
  advanceWeaponMount(mount, dt, position, stance,
    mount.active && weaponSupportAvailable(actor) && Boolean(currentMountCandidate(actor)), probeWeaponSupport);
  actor.heading = yaw;
  actor.aimWalking = foot && held.aiming && motion.speed > .06 && !motion.sprinting;
  actor.rifleReady = !wasVaulting && !dadaoEquipped && !grenadeEquipped && !actor.grenades.action && !toolEquipped && (held.aiming || fireRequested) && !motion.sprinting && motion.aimRecovery === 0;
  advanceBreath(actor.breathControl, dt, keys.has('ShiftLeft'),
    rifleAimAvailable() && motion.speed < .1 && traversal.kind === 'grounded');
  if (actor.nativeMotion) advanceNraMotion(actor, dt);
  // Movement, stance, lean and mouse aim must be current before muzzle clearance/fire.
  updateCamera(dt);
  const transport = occupiedVehicle(entities, actor);
  if (transport?.type === 'tank' && transport.variant === null) {
    const shot = advanceTankMachineGun(transport, actor, dt, time, keys.has('Space'));
    if (shot) fireTankMachineGun(transport, shot);
  }
  if (actor.grenades.action || wasVaulting) return;
  if (dadaoEquipped) updatePlayerDadao(actor);
  else if (toolEquipped) updateConstruction(dt, fireRequested);
  else if (fireRequested) fire();
}

function updateCamera(dt) {
  if (!allies[current] || !unit) return;
  if (dadaoEquipped && !allies[current].dadao?.equipped) {
    recordRecoveredFailure(new Error('Controlled sword was stowed; synchronized the first-person equipment view'),
      { stage: 'battle', team: allies[current].team, position: allies[current].position.toArray() });
    equipPrimary();
  }
  const point = emplacements.get(allies[current].emplacementId);
  if (point) {
    const pose = emplacementPose(point, point.altitude ?? world.groundHeight(point.x, point.z));
    const eye = pose.eye;
    camera.position.set(eye.x, eye.y, eye.z);
    if(point.position==='march')camera.position.set(pose.operator.x,pose.operator.y+1.6,pose.operator.z);
    camera.rotation.set(point.position==='march'?-.15:point.pitch, point.yaw, 0, 'YXZ');
    camera.fov = held.aiming ? 42 : 65;
    camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    weaponObstruction = obstructionBlend = 0;
    refreshWeaponVisibility();
    return;
  }
  const { yaw, pitch } = controlPose;
  const position = allies[current].position;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  const mount = allies[current].weaponMount, stability = mountStability(mount);
  const eyePoint = foot && !allies[current].vehicleId ? soldierEyePosition(allies[current]) : position;
  const desiredHeight = controlPose.eyeHeight;
  const tank = occupiedVehicle(entities, allies[current]), seat = occupiedSeat(entities);
  const observation = tank?.type === 'tank' ? tankObservationPose(tank, seat.role, held.aiming) : null;
  eyeHeight = tank?.type === 'tank' || !allies[current].vehicleId && allies[current].nativeMotion?.profile.headAim
    ? desiredHeight : THREE.MathUtils.lerp(eyeHeight, desiredHeight, 1 - Math.exp(-dt * 12));
  if (observation) eyeHeight = observation.y - tank.position.y;
  const desiredLean = foot && !mount.active ? (Number(keys.has('KeyE')) - Number(keys.has('KeyQ'))) * .23 : 0;
  const offsetX = Math.cos(yaw) * desiredLean;
  const offsetZ = -Math.sin(yaw) * desiredLean;
  const safeLean = foot && circleBlocked(eyePoint.x + offsetX, eyePoint.z + offsetZ, .35, world.obstacles, position.y) ? 0 : desiredLean;
  lean = THREE.MathUtils.lerp(lean, safeLean, Math.min(1, dt * 12));
  const cameraSway = foot ? motion.cameraX * motionStrength : 0;
  camera.position.set(eyePoint.x + Math.cos(yaw) * (lean + cameraSway), unit.altitude + eyeHeight + (foot ? mount.eyeOffset * mount.blend + (motion.cameraY + motion.landing) * motionStrength : 0), eyePoint.z - Math.sin(yaw) * (lean + cameraSway));
  if (observation) camera.position.set(observation.x, observation.y, observation.z);
  const profile = infantryWeaponProfile(allies[current].rifle);
  const sway = rifleAimAvailable() ? aimSway(time, { scoped: Boolean(profile.scoped),
    holding: allies[current].breathControl.holding, moving: motion.speed > .1, stance: controlPose.stance }) : { pitch: 0, yaw: 0 };
  const flight = tank?.type === 'plane' ? tank.flightControl : null;
  const kick = rifleRecoil.sample(time);
  camera.rotation.set(pitch + (flight?.lookPitch ?? 0) + recoil + kick.pitch + sway.pitch * stability.sway,
    yaw + (flight?.lookYaw ?? 0) + kick.yaw + sway.yaw * stability.sway,
    tank?.type === 'plane' ? tank.roll : -lean * .35 + (foot ? motion.cameraRoll * motionStrength : 0));
  const blast = sampleBlastReaction(allies[current]);
  if (blast) {
    camera.position.y = Math.max(position.y + .2, position.y + blast.eyeHeight);
    camera.rotation.x += blast.pitch; camera.rotation.z += blast.roll;
  } else if (allies[current].dying) {
    const progress = dyingMask(allies[current], time).progress;
    camera.position.y -= .55 * progress;
    camera.rotation.z += .2 * progress;
  }
  recoil = Math.max(0, recoil - dt * .3);
  const rifleReloading = unit.type === 'infantry' && allies[current].rifle.action === 'reload';
  const effectiveAim = unit.type === 'infantry' ? rifleAimAvailable() : held.aiming && !dadaoEquipped && !grenadeEquipped && !allies[current].grenades.action && primaryViewAvailable() && !toolEquipped && !rifleReloading && weaponObstruction === 0 && obstructionBlend < .03 && (!foot || motion.aimRecovery === 0);
  const desiredFov = observation?.fov ?? (effectiveAim && unit.type === 'infantry' ? profile.aimFov ?? 48 : unit.type === 'plane' ? held.aiming ? 55 : 82 : 72);
  camera.fov = observation ? desiredFov : THREE.MathUtils.lerp(camera.fov, desiredFov, Math.min(1, dt * 12));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  if (weapon && !grenadeEquipped && !allies[current].grenades.action) {
    const aim = effectiveAim && unit.type === 'infantry';
    const response = 1 - Math.exp(-dt * 15);
    if (dadaoEquipped) {
      weaponObstruction = obstructionBlend = 0;
      dadaoViewRecovery.run(weapon, () => {
        updateDadaoView(weapon, dadaoPhase(allies[current].dadao, time), motion, camera);
        weapon.userData.dadaoArm?.setOfficerAppearance?.(isNativeOfficer(allies[current]));
        weapon.userData.dadaoLeftArm?.setOfficerAppearance?.(isNativeOfficer(allies[current]));
      }, { team: allies[current].team, position: allies[current].position.toArray() });
    } else if (unit.type === 'infantry' && !toolEquipped) {
      if (!weapon.userData.rifle?.bolt || !weapon.userData.rifle.clip || !weapon.userData.rifle.muzzle) {
        const error = new Error('First-person rifle view lacked required metadata; rebuilt from the controlled soldier');
        error.code = 'equipment-view-metadata';
        renderEquippedTool();
        if (!weapon.userData.rifle?.bolt || !weapon.userData.rifle.clip || !weapon.userData.rifle.muzzle)
          throw new Error('Rebuilt first-person rifle view is still invalid');
        recordRecoveredFailure(error, { stage: 'battle', team: allies[current].team, position: allies[current].position.toArray() });
      }
      const pose = updateRifleModel(weapon, allies[current].rifle);
      weapon.userData.rifle.flash.visible &&= graphics.snapshot.effects.muzzle;
      const swayScale = aim ? .025 : 1;
      const supportAim = Math.max(aim ? 1 : 0, mount.blend);
      const targetX = .18 * (1 - supportAim) + motion.weaponX * swayScale * stability.sway;
      const vaultLower = allies[current].traversal.kind === 'vaulting' ? .3 : 0;
      const targetY = -.22 * (1 - supportAim) - RIFLE.sightHeight * supportAim + motion.weaponY * swayScale * stability.sway - pose.lower * .045 - vaultLower;
      const targetZ = (aim ? -.2 : -.14) + motion.sprintBlend * .08;
      const base = weapon.userData.basePosition ??= weapon.position.clone();
      base.x = THREE.MathUtils.lerp(base.x, targetX, response);
      base.y = THREE.MathUtils.lerp(base.y, targetY, response);
      base.z = THREE.MathUtils.lerp(base.z, targetZ, response);
      weapon.position.copy(base);
      weapon.position.z += kick.rear;
      weapon.rotation.set(motion.weaponPitch * swayScale - pose.lower * .14 + kick.weaponPitch,
        kick.weaponYaw, -motion.sprintBlend * .12 - pose.lower * .08);
      weapon.updateMatrixWorld(true);
      // Test the intended shoulder-to-muzzle segment, not the already-retracted gun.
      const start = new THREE.Vector3(targetX, targetY, -.1).applyMatrix4(camera.matrixWorld);
      const intendedMuzzle = weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3());
      const length = start.distanceTo(intendedMuzzle);
      ray.set(start, intendedMuzzle.clone().sub(start).normalize()); ray.far = length + .08;
      const blocked = ray.intersectObjects(solidIndex.candidates(ray.ray.origin, ray.ray.direction, ray.far), false)[0];
      // A parallel camera ray prevents a lateral stock offset from missing a corner.
      ray.set(camera.position, camera.getWorldDirection(new THREE.Vector3())); ray.far = length + .18;
      const centerBlocked = ray.intersectObjects(solidIndex.candidates(ray.ray.origin, ray.ray.direction, ray.far), false)[0];
      const nearest = Math.min(blocked?.distance ?? Infinity, centerBlocked?.distance ?? Infinity);
      weaponObstruction = Math.max(0, Math.min(1, (length + .08 - nearest) / .75));
      obstructionBlend = THREE.MathUtils.lerp(obstructionBlend, weaponObstruction, 1 - Math.exp(-dt * 20));
      // The intended muzzle still blocks fire immediately; presentation follows a bounded high-ready arc.
      applyCloseWeaponPose(weapon, obstructionBlend);
      updateRifleArms(weapon);
      // Traversal stows the native arms; unexpected unreachable contacts retain the explicit safety guard.
      weaponHands?.update(weapon, allies[current].rifle, {
        stowed: vaultLower > 0, appearance: allies[current].avatarAppearance,
        officer: isNativeOfficer(allies[current]),
      });
      if (weaponHands?.snapshot?.reachLimited) weapon.visible = false;
      weapon.updateMatrixWorld(true);
      ray.far = Infinity;
    } else if (toolEquipped && weapon.userData.engineerTool) {
      weaponObstruction = obstructionBlend = 0;
      weapon.position.set(0, 0, 0); weapon.rotation.set(0, 0, 0);
      updateEngineerTool(weapon, time, held.primary, isNativeOfficer(allies[current]));
    } else if (toolEquipped && weapon.userData.mortar) {
      weaponObstruction = obstructionBlend = 0;
      updateMortarModel(weapon, allies[current].mortar.distance);
      weapon.position.set(.38 + motion.weaponX, -.82 + motion.weaponY, -1.05);
      weapon.rotation.set(.25, 0, -.15);
    } else {
      weaponObstruction = obstructionBlend = 0;
      weapon.position.x = THREE.MathUtils.lerp(weapon.position.x, foot ? motion.weaponX : 0, response);
      weapon.position.y = THREE.MathUtils.lerp(weapon.position.y, foot ? motion.weaponY : 0, response);
      const tank = occupiedVehicle(entities, allies[current])?.type === 'tank';
      weapon.position.z = (tank ? 0 : recoil * 1.5) + (foot ? motion.sprintBlend * .08 : 0);
      if (flight) {
        const vehicle = occupiedVehicle(entities, allies[current]);
        weapon.quaternion.setFromEuler(new THREE.Euler(vehicle.pitch, vehicle.heading, vehicle.roll, 'YXZ'))
          .premultiply(camera.quaternion.clone().invert());
      } else {
        weapon.rotation.x = tank ? 0 : (unit.reloadUntil ? Math.sin(time * 4) * .14 - .3 : 0) + (foot ? motion.weaponPitch : 0);
        weapon.rotation.z = foot ? -motion.sprintBlend * .12 : 0;
      }
      if (weapon.userData.breech) weapon.userData.breech.position.z = recoil * .35;
    }
  }
  $('crosshair').hidden = !primaryViewAvailable() || observation?.aperture === 'scope' || (effectiveAim && unit.type === 'infantry');
}

function renderSniperScope() {
  const tank = occupiedVehicle(entities, controlledSoldier(entities));
  const optical = tank?.type === 'tank';
  $('tank-optics').hidden = !(['playing', 'transferring', 'pause'].includes(state) && optical);
  if (optical) {
    const role = occupiedSeat(entities).role;
    $('tank-optics').dataset.view = tankObservationPose(tank, role, held.aiming).aperture;
    $('tank-optics').setAttribute('aria-label', role === 'commander' ? '车长闭舱观察狭缝' : role === 'gunner' ? '炮手光学瞄具' : '驾驶员闭舱观察窗');
  } else $('tank-optics').dataset.view = tank?.type === 'tank' ? 'driver' : '';
  const active = sniperScopeActive(), scope = $('sniper-scope');
  scope.hidden = !active;
  refreshWeaponVisibility();
  if (!active) return;
  const breath = allies[current].breathControl, percent = Math.round(breath.remaining * 100);
  $('breath-meter').setAttribute('aria-valuenow', String(percent));
  $('breath-fill').style.width = `${percent}%`;
  $('breath-label').textContent = `${breath.holding ? '屏息中' : breath.exhausted ? '呼吸恢复 · 松开 Shift' : '按住左 Shift 屏息'} · ${percent}%`;
}

function squadCommand(follow) {
  if (unit.type !== 'infantry' && unit.type !== 'mortar') return;
  updateCamera(0);
  camera.getWorldDirection(direction);
  ray.set(camera.position, direction);
  ray.far = 65;
  if (!follow) {
    const origin = camera.position, end = origin.clone().addScaledVector(direction, ray.far);
    const people = actorGrid.near(origin.x, origin.z, ray.far).filter(actor =>
      actor !== controlledSoldier(entities) && actor.health > 0 && !actor.vehicleId &&
      pointSegmentDistance(actor.position, origin, end).distance < 2)
      .map(actor => soldierHits.sync(actor, time));
    const pointed = ray.intersectObjects([...solidIndex.candidates(origin, direction, ray.far),
      ...vehicleSolids(), ...people], true)[0];
    const person = pointed?.object.userData.actor;
    const vehicle = entities.vehicles.get(pointed?.object.userData.vehicleId);
    const ordered = person?.health > 0 && !person.friendly ? { kind: 'person', id: person.id }
      : vehicle?.health > 0 && vehicle.team !== 'friendly' && vehicle.type === 'tank'
        ? { kind: 'armor', id: vehicle.id } : null;
    if (ordered) {
      ray.far = Infinity;
      for (const actor of allies) {
        actor.orderTarget = { ...ordered };
        const intent = actor.tactics.throwIntent;
        if (intent && aiThrowReservations.get(intent.key)?.actorId === actor.id)
          aiThrowReservations.delete(intent.key);
        actor.tactics.throwIntent = actor.tactics.packApproach = null;
        actor.tactics.throwDecisionAt = actor.nextThink = 0;
      }
      toast(ordered.kind === 'armor' ? '小队命令：攻击敌方坦克' : '小队命令：集火敌兵');
      battleVoiceEvent('order-advance', { command: true });
      return;
    }
  }
  const hit = ray.intersectObjects(world.solids, false)[0];
  ray.far = Infinity;
  const target = hit ? hit.point : camera.position.clone().addScaledVector(direction, 45);
  const objective = objectives.find(point => objectiveContainsPosition(point, target));
  const attack = Boolean(objective);
  const orderPoint = floorDestination({ x: target.x, y: target.y, z: target.z },
    { x: THREE.MathUtils.clamp(target.x, -100, 100),
      z: THREE.MathUtils.clamp(target.z, sihangCampaignMode ? battleArea.minZ : -100, sihangCampaignMode ? battleArea.maxZ : 100),
      ...(nanjingCampaignMode || sihangCampaignMode ? { y: world.walkHeight(target.x, target.z, target.y) } : {}) },
    world.town.buildings);
  if (!follow && sihangCampaignMode && (world.isDeepWater(orderPoint.x, orderPoint.z) ||
    circleBlocked(orderPoint.x, orderPoint.z, .42, movementObstacles(orderPoint.x, orderPoint.z), orderPoint.y))) {
    toast('标记位置无法通行 · 请指向道路或楼层地面');
    return;
  }
  for (const actor of allies) {
    const hadTargetOrder = Boolean(actor.orderTarget);
    actor.orderTarget = null;
    if (hadTargetOrder) {
      const intent = actor.tactics.throwIntent;
      if (intent && aiThrowReservations.get(intent.key)?.actorId === actor.id)
        aiThrowReservations.delete(intent.key);
      actor.tactics.throwIntent = actor.tactics.packApproach = null;
      actor.tactics.throwDecisionAt = actor.nextThink = 0;
    }
    actor.order = follow ? 'follow' : attack ? 'advance' : 'hold';
    actor.personalHold = false;
    actor.orderPoint = { ...orderPoint };
    actor.orderObjectiveId = attack && !follow ? objective.id : null;
    actor.path = actor.pathGoal = null; pathRequests.delete(actor.tactics.id);
    actor.tactics.traffic = actor.tactics.followGuard = null;
    actor.tactics.decisionAt = 0;
    if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
    actor.tactics.cover = null;
  }
  toast(follow ? '小队命令：取消命令，跟随我' : attack ? `小队命令：进攻 ${objective.id} 据点` : '小队命令：移动并守住标记位置');
  battleVoiceEvent(follow ? 'order-follow' : attack ? 'order-advance' : 'order-hold', { command: true });
}
function personalDestination(actor, target) {
  if (sihangCampaignMode && (actor.formation.sihangDemolition || target.transit)) return target;
  const state = actor.tactics;
  if (target.transit) {
    state.personalSlot = null;
    return target;
  }
  const enabled = ['formation-advance', 'assault', 'advance-to-objective', 'follow', 'hold', 'advance'].includes(state.mode);
  if (!enabled) return target;
  const floor = target.y ?? world.groundHeight(target.x, target.z);
  const cached = state.personalSlot;
  if (cached && Math.hypot(cached.anchor.x - target.x, cached.anchor.z - target.z,
    (cached.anchor.y ?? 0) - (target.y ?? 0)) < .7) {
    if (cached.point) { cached.expiresAt = time + 5; return cached.point; }
    if (time < cached.retryAt) return null;
  }
  const peers = allForces.filter(other => other !== actor && other.health > 0 && !other.vehicleId &&
    other.team === actor.team && Math.abs(other.position.y - floor) < 1.5);
  const mission = !target.transit && ['formation-advance', 'assault', 'advance-to-objective', 'advance'].includes(state.mode)
    ? objectives.find(point => point.id === state.objectiveId) : null;
  const candidates = [{ ...target }];
  for (const radius of [1.7, 3.4, 5.1]) for (let side = 0; side < 16; side++) {
    const angle = side * Math.PI / 8 + state.id * .618;
    candidates.push({ x: target.x + Math.cos(angle) * radius, z: target.z + Math.sin(angle) * radius,
      ...(target.y === undefined ? {} : { y: target.y }) });
  }
  const point = candidates.find(point => {
    if (nanjingDockMovementLimited(actor.position) && nanjingDockInside(point, .6)) return false;
    if (sihangCampaignMode && (point.x < battleArea.minX + .5 || point.x > battleArea.maxX - .5 ||
      point.z < battleArea.minZ + .5 || point.z > battleArea.maxZ - .5)) return false;
    const missionRadius = nanjingCampaignMode && actor.playerUnit && mission?.id === 'gate' && actor.index % 11 >= 3
      ? mission.radius + 3 : mission ? mission.radius - 1 : 0;
    if (mission && Math.hypot(point.x - mission.x, point.z - mission.z) > missionRadius) return false;
    if (nanjingCampaignMode && floor <= .24 && world.landmarks.wallRamps.some(ramp =>
      point.x >= ramp.minX - .5 && point.x <= ramp.maxX + .5 &&
      point.z >= ramp.minZ - .5 && point.z <= ramp.maxZ + .5)) return false;
    if (Math.abs(world.walkHeight(point.x, point.z, floor) - floor) > .3 ||
      circleBlocked(point.x, point.z, .5, movementObstacles(point.x, point.z), floor)) return false;
    return peers.every(other => {
      const reserved = other.tactics.personalSlot;
      return !(reserved?.point && reserved.expiresAt > time && Math.hypot(point.x - reserved.point.x, point.z - reserved.point.z) < 1.65) &&
        !(other.locomotion.speed < .2 && Math.hypot(point.x - other.position.x, point.z - other.position.z) < 1.45);
    });
  }) ?? null;
  state.personalSlot = { anchor: { ...target }, point, objectiveId: mission?.id ?? null,
    floor, expiresAt: time + 5, retryAt: time + 1 };
  return point;
}

function connectSquadRoute(start, goal) {
  if (Math.hypot(goal.x - start.x, goal.z - start.z) > 8) return [];
  if (world.connectInfantryPath) return world.connectInfantryPath(start, goal);
  const count = Math.max(1, Math.ceil(Math.hypot(goal.x - start.x, goal.z - start.z) / .12));
  const path = [];
  let y = start.y;
  for (let i = 1; i <= count; i++) {
    const x = start.x + (goal.x - start.x) * i / count, z = start.z + (goal.z - start.z) * i / count;
    const height = world.walkHeight(x, z, y);
    if (Math.abs(height - y) > .26 || circleBlocked(x, z, .5,
      movementObstacles(x, z).filter(o => !o.walkable || o.height > height + .25), height)) return [];
    y = height; path.push({ x, y, z });
  }
  return Math.abs(y - (goal.y ?? 0)) <= .025 ? path : [];
}

function sihangBridgeWorkRoute(actor, target) {
  const start = sihangBridgeCoordinates(actor.position), end = sihangBridgeCoordinates(target);
  if (start.along < -8 || start.along > SIHANG_BRIDGE.length ||
    end.along <= SIHANG_BRIDGE.length ||
    !engineerWorks.some(work => sihangBridgeContains(work.point))) return [];
  const lanes = start.across < 0 ? [-2.8, 2.8] : [2.8, -2.8];
  for (const lane of lanes) {
    const points = [];
    for (let along = Math.max(0, start.along); along < SIHANG_BRIDGE.length; along += 3)
      points.push(sihangBridgePoint(along / SIHANG_BRIDGE.length, lane));
    points.push(sihangBridgePoint(1, lane), target);
    const route = [];
    let from = { x: actor.position.x, y: actor.position.y, z: actor.position.z };
    for (const point of points) {
      const next = { ...point, y: world.walkHeight(point.x, point.z, from.y) };
      const segment = connectSquadRoute(from, next);
      if (!segment.length) break;
      route.push(...segment);
      from = next;
    }
    if (Math.hypot(from.x - target.x, from.z - target.z) < .001) return route;
  }
  return [];
}

function walkActor(actor, target, speed, dt, sprint = false, urgentConstrainedJog = false) {
  actor.locomotion.speed = 0; actor.locomotion.sprinting = false; actor.locomotion.mode = 'idle';
  if (nanjingDockMovementLimited(actor.position)) target = nanjingDockOutsideGoal(target, .6);
  if (sihangCampaignMode && !actor.friendly && !sihangNorthBank(target, .5))
    target = { ...target, z: sihangRiverBounds(target.x).northZ - .5, y: 0 };
  target = personalDestination(actor, target);
  if (!target) { actor.tactics.mode = 'wait-for-position'; return; }
  // Keep the final, collision-clear shell slot current instead of waiting at its stale cached endpoint.
  if (actor.formation.sihangDemolition && actor.path?.length === 1 &&
    Math.hypot(actor.path[0].x - target.x, actor.path[0].z - target.z) > .001 &&
    Math.hypot(actor.position.x - target.x, actor.position.z - target.z) < 1 &&
    Math.abs(actor.position.y - (target.y ?? 0)) < .3 &&
    sampledRouteClear(actor.position, target, (x, z) => !infantryNavigationBlocked({ x, z }, actor.position, .43, actor))) {
    actor.path = [{ ...target }]; actor.pathGoal = target;
  }
  if (target === actor.tactics.personalSlot?.point &&
    Math.hypot(actor.position.x - target.x, actor.position.z - target.z) < .45 &&
    Math.abs(actor.position.y - actor.tactics.personalSlot.floor) < .3) {
    actor.path = []; actor.pathGoal = target; pathRequests.delete(actor.tactics.id);
    return;
  }
  const profile = FOOT_SPEEDS[actor.groundType];
  const pos = actor.position;
  if ((!actor.path || !actor.path.length) && time >= (actor.nextPath || 0) ||
      !actor.pathGoal || Math.hypot(actor.pathGoal.x - target.x, actor.pathGoal.z - target.z,
        (actor.pathGoal.y ?? 0) - (target.y ?? 0)) > .75 ||
      actor.stuckTime > .6 && time >= (actor.nextPath || 0)) {
    pathRequests.set(actor.tactics.id, { actor, target: { ...target }, requestedAt: pathRequests.get(actor.tactics.id)?.requestedAt ?? time });
  }
  if (!actor.path) return;
  const waypoint = performanceDiagnostics.measure('routes', () => advanceInfantryPath(pos, actor.path, point =>
    (!sihangCampaignMode || sihangCampaign.stage === 'sihang-retreat' && actor.friendly &&
      !actor.playerUnit && !target.assembly && !target.parade && actor.path.length > 1 &&
      sihangRetreatBlockedWaypoint(actor, actor.path[0], trafficGrid.near(actor.path[0].x, actor.path[0].z, 1))) &&
    sampledRouteClear(pos, point, (x, z) =>
    !infantryNavigationBlocked({ x, z }, pos, world.elevatedPath && pos.y > 7 ? .42 : .46, actor) &&
      !(Math.abs(world.walkHeight(x, z, pos.y) - pos.y) > .3)), actor.formation.sihangDemolition ? .035 :
      target.assembly ? SIHANG_ASSEMBLY_ARRIVAL : sihangCampaignMode ? .2 : .1));
  if (!waypoint) return;
  const waitingDoor = pos.y < 1 ? world.doorSystem.openAhead(pos, waypoint) : null;
  if (waitingDoor) {
    actor.tactics.mode = 'open-door';
    actor.tactics.blockedBy = 'door';
    if (waitingDoor.blocked) {
      const hx = waitingDoor.x - (waitingDoor.axis === 'x' ? waitingDoor.width / 2 : 0);
      const hz = waitingDoor.z - (waitingDoor.axis === 'z' ? waitingDoor.width / 2 : 0);
      const dx = pos.x - hx, dz = pos.z - hz, distance = Math.max(.01, Math.hypot(dx, dz));
      moveInfantry(pos, dx / distance * dt * 1.8, dz / distance * dt * 1.8, .42, infantryMovementObstacles(actor, pos.x, pos.z));
    }
    return;
  }
  const dx = waypoint.x - pos.x;
  const dz = waypoint.z - pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < (target.assembly ? .01 : .05)) return;
  if (sihangCampaignMode) {
    let progress = actor.tactics.pathProgress;
    if (!progress || progress.waypoint !== waypoint || distance < progress.distance - .1)
      progress = actor.tactics.pathProgress = { waypoint, distance, updatedAt: time };
    // Crowd avoidance can move continuously in circles without advancing the route.
    if (time - progress.updatedAt > 2.5 && time >= (actor.nextPath || 0)) {
      pathRequests.set(actor.tactics.id, { actor, target: { ...target },
        requestedAt: pathRequests.get(actor.tactics.id)?.requestedAt ?? time });
      progress.updatedAt = time;
    }
  }
  const obstacles = infantryMovementObstacles(actor, pos.x, pos.z);
  const heading = Math.atan2(-dx, -dz);
  let space = actor.tactics.movementSpace;
  if (!space || time >= space.expiresAt || Math.hypot(pos.x - space.x, pos.z - space.z) > .6 ||
    Math.cos(heading - space.heading) < .9) {
    space = { x: pos.x, z: pos.z, heading, expiresAt: time + .35,
      constrained: [-1, 1].some(side => sihangCampaignMode
        ? infantryNavigationBlocked({ x: pos.x - dz / distance * side, z: pos.z + dx / distance * side }, pos, .42, actor)
        : circleBlocked(pos.x - dz / distance * side, pos.z + dx / distance * side, .42, obstacles)) };
    actor.tactics.movementSpace = space;
  }
  let pace = chooseAdvancePace({ preference: (actor.tactics.id * .61803398875) % 1, urgent: sprint,
    threat: Boolean(actor.tactics.lastSeen), distance: Math.hypot(target.x - pos.x, target.z - pos.z),
    exhausted: actor.locomotion.exhausted, stamina: actor.locomotion.stamina, constrained: space.constrained,
    catchUp: actor.playerUnit && actor.order === 'follow', urgentConstrainedJog });
  if (target.assault && ['walk', 'aim'].includes(pace)) pace = 'jog';
  if (infantryWeaponProfile(actor.rifle).automatic && ['aim', 'jog'].includes(target.firePace))
    pace = space.constrained ? 'aim' : target.firePace;
  if (pace === 'aim' && actor.tactics.lastSeen) {
    const observed = actor.tactics.lastSeen, aimingHeading = Math.atan2(pos.x - observed.x, pos.z - observed.z);
    if (Math.cos(aimingHeading - heading) <= .8) pace = space.constrained ? 'walk' : 'jog';
  }
  sprint = pace === 'sprint';
  speed = Math.hypot(target.x - pos.x, target.z - pos.z) > 1.3 ? profile[pace] : Math.min(speed, profile[pace]);
  if (actor.formation.sihangDemolition) { speed = Math.min(speed, 1); sprint = false; }
  const inCaptureArea = objectives.some(point => objectiveContainsPosition(point, pos));
  const withdrawalCoverEgress = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
    actor.friendly && !actor.playerUnit && sihangCampaign.withdrawalWave?.phase === 'cover' &&
    sihangCampaign.withdrawalWave.squads[sihangCampaign.withdrawalWave.coverSlot]?.includes(actor.id) &&
    actor.tactics.traffic?.reason === 'no-yield-space' && actor.tactics.traffic.waitSeconds >= 2.5;
  const neighbors = trafficGrid.near(pos.x, pos.z, 3.2);
  const steeringNeighbors = withdrawalCoverEgress ? neighbors.filter(other => other.friendly) : neighbors;
  const cohort = actor.formation.sihangDemolition && sihangCombat.formed;
  const steering = performanceDiagnostics.measure('steering', () => infantrySteering(actor,
    cohort ? steeringNeighbors.filter(other => other.formationId !== actor.formation.id) : steeringNeighbors,
    { x: dx, z: dz }, {
    spacing: actor.formation.sihangDemolition ? 1 : sihangCampaignMode && target.assembly ? .7 :
      sihangCampaignMode && target.transit ? 1.2 : inCaptureArea ? 1.45 : 2.2,
    minimumSeparation: sihangCampaignMode && target.assembly ? .7 : .9,
    constrained: space.constrained || Boolean(sihangCampaignMode && target.transit &&
      (pos.y > .3 || actor.formation.sihangDemolition || target.assembly || target.parade)),
    dt, now: time, reservations: trafficReservations,
    holdShallowYield: Boolean(sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      actor.friendly && !actor.playerUnit && !target.assembly && !target.parade),
    lookAhead: actor.formation.sihangDemolition ? Math.min(.065, distance) : sihangCampaignMode ? Math.min(.65, distance) : .65,
    blocked: point => infantryNavigationBlocked(point, pos, .43, actor),
  }));
  speed *= steering.speed;
  actor.tactics.blockedBy = steering.waitingFor;
  if (speed < .05) {
    actor.stuckTime = (actor.stuckTime || 0) + dt;
    actor.tactics.mode = 'wait-for-spacing'; actor.locomotion.mode = 'idle';
    return;
  }
  actor.stance = 'standing'; actor.firingPose = null;
  if (!postureReady(actor)) {
    actor.turningThisStep = true;
    actor.locomotion.mode = 'rise';
    actor.tactics.mode = 'rise-to-move';
    return;
  }
  const backwards = actor.formation.sihangDemolition && target.backwards === true;
  const shieldFacing = actor.formation.sihangDemolition && Number.isFinite(target.facing);
  const turn = advanceAITurn(actor, shieldFacing ? target.facing :
    Math.atan2(-steering.x, -steering.z) + (backwards ? Math.PI : 0), dt, true);
  actor.turningThisStep = true;
  if (!turn.mayMove) {
    actor.locomotion.mode = 'turn';
    actor.tactics.mode = 'turn-to-path';
    return;
  }
  const step = Math.min(speed * turn.moveScale * dt, distance);
  const travel = shieldFacing ? steering : backwards ? { x: -turn.direction.x, z: -turn.direction.z } : turn.direction;
  const destination = { x: pos.x + travel.x * step, z: pos.z + travel.z * step };
  const arcClear = !infantryNavigationBlocked(destination, pos, .43, actor) &&
    actorGrid.near(pos.x, pos.z, 1.5).every(other => other === actor || other.health <= 0 || other.vehicleId ||
      Math.abs(other.position.y - pos.y) >= 1.5 ||
      Math.hypot(destination.x - other.position.x, destination.z - other.position.z) >=
        Math.min(sihangCampaignMode && target.assembly ? .7 : .9,
          Math.hypot(pos.x - other.position.x, pos.z - other.position.z) - .01));
  if (!arcClear && turn.remaining > AI_TURN.resumeAngle) {
    actor.locomotion.mode = 'turn'; actor.tactics.mode = 'turn-to-path';
    return;
  }
  const beforeX = pos.x;
  const beforeZ = pos.z;
  const movementZ = (arcClear ? travel.z : steering.z) * step;
  moveInfantry(pos, (arcClear ? travel.x : steering.x) * step,
    sihangCampaignMode && !actor.friendly
      ? Math.min(movementZ, sihangRiverBounds(pos.x + (arcClear ? travel.x : steering.x) * step).northZ - .5 - pos.z)
      : movementZ, .42, obstacles);
  if (Math.hypot(pos.x - beforeX, pos.z - beforeZ) < step * .3) {
    actor.stuckTime = (actor.stuckTime || 0) + dt;
  } else actor.stuckTime = 0;
  settleActorSupport(actor);
  actor.walkPhase += Math.hypot(pos.x - beforeX, pos.z - beforeZ) * 2.5;
  actor.walkPoseReady = true;
  actor.locomotion.speed = Math.hypot(pos.x - beforeX, pos.z - beforeZ) / dt;
  actor.locomotion.sprinting = sprint && actor.locomotion.speed > profile.jog + .1;
  actor.locomotion.mode = actor.locomotion.speed < .06 ? 'idle' : actor.locomotion.sprinting ? 'sprint' : pace;
  actor.aimWalking = pace === 'aim' && actor.locomotion.speed > .06;
  if (actor.aimWalking || target.firePace === 'jog' && infantryWeaponProfile(actor.rifle).automatic) actor.rifleReady = true;
}

const posturePreviews = new WeakMap();
function postureFireLine(actor, point, stance, threat) {
  return performanceDiagnostics.measure('posture', () => evaluatePostureFireLine(actor, point, stance, threat));
}
function evaluatePostureFireLine(actor, point, stance, threat) {
  if (actor.weaponBlocked) return false;
  if (!actor.nativeMotion) {
    const bodyStance = stance === 'standing' ? 'standing' : FIRING_POSES[stance]?.stance;
    if (!bodyStance) throw new RangeError('Unknown procedural combat posture');
    const position = new THREE.Vector3(point.x, world.walkHeight(point.x, point.z, point.y ?? actor.position.y), point.z);
    const heading = Math.atan2(point.x - threat.x, point.z - threat.z);
    const preview = { ...actor, position, heading, stance: bodyStance };
    const muzzle = new THREE.Vector3().copy(soldierRifleMuzzle(preview));
    const eye = new THREE.Vector3().copy(soldierEyePosition(preview));
    return hasLine(eye, muzzle, 2) && hasLine(eye, threat, 90) && hasLine(muzzle, threat, 90);
  }
  const profile = actor.nativeMotion?.profile, track = profile && (stance === 'standing' ? profile.idle : profile[stance]);
  if (!track) throw new Error('Native combat posture is missing its carry profile');
  const heading = Math.atan2(point.x - threat.x, point.z - threat.z), c = Math.cos(heading), s = Math.sin(heading);
  let preview = null;
  if (profile.rifleContacts) {
    let cached = posturePreviews.get(actor);
    if (!cached) { cached = new Map(); posturePreviews.set(actor, cached); }
    if (!cached.has(stance)) cached.set(stance, { time: null, motion: { ...actor.nativeMotion, speed: 0,
    weight: 0, lowReady: 0, cheekWeight: profile.headAim ? 1 : 0, chestFire: 0, aim: 0, headGoal: null,
      posture: Object.fromEntries(Object.keys(FIRING_POSES).map(pose => [pose, pose === stance ? 1 : 0])) } });
    const entry = cached.get(stance);
    if (entry.time !== time) {
      entry.motion.idleTime = actor.nativeMotion.idleTime;
      entry.motion.bodyLean = actor.nativeMotion.fireLean;
    const derived = { ...actor, rifleReady: true, weaponBlocked: false,
      rifle: { ...actor.rifle, action: 'idle' },
      grenades: actor.grenades && { ...actor.grenades, action: null },
      dadao: actor.dadao && { ...actor.dadao, equipped: false, pose: null, mode: 'idle' },
      bayonet: actor.bayonet && { ...actor.bayonet, targetId: null, startedAt: null, mode: 'idle' },
      nativeMotion: entry.motion };
      syncNativeAimGoal(derived);
      entry.pose = sampleNraMotion(derived); entry.time = time;
    }
    preview = entry.pose;
  }
  if (preview?.headAim && (preview.headAim.sightError >= .004 || preview.headAim.cheekError >= .012 ||
    preview.headAim.gazeError >= .05 || preview.headAim.eyeRelief <= .04)) return false;
  const local = new THREE.Vector3(...profile.muzzle)
    .applyQuaternion(new THREE.Quaternion(...(preview?.weaponQuaternion ?? track.quaternions.slice(0, 4))))
    .add(new THREE.Vector3(...(preview?.weaponPosition ?? track.positions.slice(0, 3))));
  const y = world.walkHeight(point.x, point.z, point.y ?? actor.position.y);
  const muzzle = new THREE.Vector3(point.x + local.x * c + local.z * s, y + local.y, point.z - local.x * s + local.z * c);
  const eyeLocal = preview?.headAim?.eye ?? [0, stance === 'standing' ? 1.67 : FIRING_POSES[stance].eye, 0];
  const eye = new THREE.Vector3(point.x + eyeLocal[0] * c + eyeLocal[2] * s, y + eyeLocal[1],
    point.z - eyeLocal[0] * s + eyeLocal[2] * c);
  return hasLine(eye, muzzle, 2) && hasLine(eye, threat, 90) && hasLine(muzzle, threat, 90);
}

function proneSpaceClear(actor, heading) {
  const c = Math.cos(heading), s = Math.sin(heading), base = actor.position.y;
  for (const z of [-1, -.5, 0, .5, 1]) for (const x of [-.18, .18]) {
    const point = { x: actor.position.x + x * c + z * s, z: actor.position.z - x * s + z * c };
    if (circleBlocked(point.x, point.z, .22, movementObstacles(point.x, point.z), base, .55) ||
      Math.abs(world.walkHeight(point.x, point.z, base) - base) > .16) return false;
  }
  return true;
}

function clearAIRifleLine(actor, from, threat) {
  if (sihangCampaignMode && !actor.friendly && sihangProtectedSouthBank(threat)) return null;
  const origin = soldierRifleMuzzle(actor), muzzle = new THREE.Vector3(origin.x, origin.y, origin.z);
  const nearbyFriend = actorGrid.near(actor.position.x, actor.position.z, muzzle.distanceTo(threat)).some(other => {
    if (other.friendly !== actor.friendly || other === actor || other.health <= 0 || other.targetKind === 'aircraft') return false;
    const segment = pointSegmentDistance(other.position, muzzle, threat);
    const lineY = muzzle.y + (threat.y - muzzle.y) * segment.fraction;
    return segment.fraction > .03 && segment.fraction < .97 && segment.distance < .55 &&
      lineY > other.position.y - .1 && lineY < other.position.y + soldierPostureHeight(other, 'body');
  });
  const civilianInLine = nanjingCampaignMode && actor.friendly && world.civilians.some(person => {
    if (!person.visible || !person.userData.active || person.userData.dead || person.parent !== scene) return false;
    const segment = pointSegmentDistance(person.position, muzzle, threat);
    const lineY = muzzle.y + (threat.y - muzzle.y) * segment.fraction;
    return segment.fraction > 0 && segment.fraction < 1 && segment.distance < .48 &&
      lineY > person.position.y && lineY < person.position.y + (person.userData.ageGroup === 'child' ? 1.15 : 1.7);
  });
  return !nearbyFriend && !civilianInLine && hasLine(from, muzzle, 2) && hasLine(muzzle, threat, 75) ? muzzle : null;
}

function fightFromCover(actor, target, dt, tankCover = null, stationary = false) {
  if (sihangCeasefire(actor)) { actor.rifleReady = false; return; }
  const t = actor.tactics, position = actor.position;
  const fixedWindow = sihangCampaignMode && (actor.friendly && t.sihangDuty === 'wall-fire' ||
    !actor.friendly && sihangCampaign.northWallBreached);
  if (fixedWindow) {
    actor.stance = 'standing'; actor.firingPose = null;
    t.eligiblePoses = ['standing'];
  }
  if (t.shotMovePending && (time >= t.suppressedUntil || actor.order === 'hold' ||
    !t.shotMoveGoal && time - t.shotMoveStartsAt > 1.6)) {
    t.shotMovePending = false; t.shotMoveGoal = null;
  }
  const armorThreat = t.threatKind === 'closed-armor';
  const threat = new THREE.Vector3(t.lastSeen.x, t.lastSeen.y, t.lastSeen.z);
  t.coordination = null;
  if (!stationary && !fixedWindow && !armorThreat && actor.order !== 'hold' && position.distanceTo(threat) > 12 &&
    !(sihangCampaignMode && sihangCampaign?.stage === 'sihang-retreat') &&
    !(nanjingCampaignMode && ['withdrawal', 'withdrawal-to-boats'].includes(nanjingCampaign.stage))) {
    const bounding = squadBoundDecision(actor, time, entities.control.soldierId);
    t.coordination = time >= t.suppressedUntil ? bounding : { ...bounding, hold: false, role: 'evade' };
    if (time >= t.suppressedUntil) stationary = bounding.hold;
  }
  const objective = formationObjective(actor, objectives[0]);
  const gateDefender = nanjingCampaignMode && actor.friendly && !actor.playerUnit && nanjingCampaign.stage === 'gate-defense';
  const defensePost = gateDefender && t.nanjingDefense ? formationDestination(actor, objective) : null;
  const captureGuard = defensePost && Math.hypot(defensePost.x - objective.x, defensePost.z - objective.z) < objective.radius;
  let mayFire = true;
  if (!stationary) {
  if ((!encirclementMode || encirclement.phase === 1) && !gateDefender && !armorThreat && objective && time >= t.suppressedUntil &&
    objectiveAdvanceRequired(actor, objective, position.distanceTo(threat), AI_RIFLE.closeRange)) {
    if (t.cover) coverClaims.delete(t.cover.id);
    t.cover = null; t.wallContact = null; t.shotMovePending = false; t.shotMoveGoal = null;
    t.mode = 'advance-to-objective'; t.objectiveId = objective.id;
    walkActor(actor, formationDestination(actor, objective), 3, dt);
    resetAIRifleAim(actor.aiRifle, 'objective-advance');
    return;
  }
  t.engagementPoint ??= {};
  Object.assign(t.engagementPoint, t.lastSeen);
  if (tankCover) {
    if (t.cover?.id !== tankCover.id || Math.hypot(t.cover.x - tankCover.x, t.cover.z - tankCover.z) > .75) {
      if (t.cover) coverClaims.delete(t.cover.id);
      actor.path = actor.pathGoal = null; pathRequests.delete(t.id);
      t.enteredCover = false;
    }
    t.cover = tankCover;
  } else if (t.cover?.kind === 'tank') {
    coverClaims.delete(t.cover.id); t.cover = null; t.enteredCover = false; t.decisionAt = 0;
  }
  const committedMove = t.cover && !t.enteredCover && time < (t.coverMoveUntil || 0) && time >= t.suppressedUntil;
  if (!tankCover && time >= t.decisionAt && !committedMove && aiDecisions.take('cover', actor)) {
    const coverStarted = benchmark ? performance.now() : 0;
    t.decisionAt = time + 2.3 + t.slot * .17;
    const context = {
      state: t, position, threat,
      slots: position.y > 1 || captureGuard ? [] : defensePost ? world.town.covers.filter(slot =>
        Math.hypot(slot.x - defensePost.x, slot.z - defensePost.z) < 2)
        : actor.friendly && actor.order === 'hold' ? world.town.covers.filter(slot => Math.hypot(slot.x - actor.orderPoint.x, slot.z - actor.orderPoint.z) < 7)
        : nanjingCampaignMode && actor.friendly && objective ? world.town.covers.filter(slot =>
          Math.hypot(slot.x - objective.x, slot.z - objective.z) <= Math.hypot(position.x - objective.x, position.z - objective.z) + 1.5)
        : actor.friendly ? world.town.covers.filter(slot => Math.hypot(slot.x - position.x, slot.z - position.z) <= 15)
        : !actor.friendly ? world.town.covers.filter(slot => {
          return objective && Math.hypot(slot.x - position.x, slot.z - position.z) < 10 &&
            Math.hypot(slot.x - objective.x, slot.z - objective.z) < Math.max(objective.radius - 2, Math.hypot(position.x - objective.x, position.z - objective.z));
        }) : world.town.covers,
      claims: coverClaims, now: time,
      blocked: point => circleBlocked(point.x, point.z, .46, world.obstacles),
      protectedAt: point => {
        const base = world.groundHeight(point.x, point.z);
        if (!actor.nativeMotion) return !hasLine(threat, new THREE.Vector3(point.x, base + 1.1, point.z), 90);
        const shielded = height => !hasLine(threat, new THREE.Vector3(point.x, base + height, point.z), 90);
        return shielded(.65) ? shielded(1.0) || shielded(.35) : shielded(1.0) && shielded(.35);
      },
      supportedAt: point => {
        if (!actor.nativeMotion) return false;
        const base = { ...point, y: world.groundHeight(point.x, point.z) };
        const heading = Math.atan2(point.x - threat.x, point.z - threat.z);
        const contact = wallFiringContact(base, heading, world.town.pieces);
        return Boolean(contact && postureFireLine(actor, point, contact.pose, threat));
      },
      seesTarget: point => actor.nativeMotion
        ? postureFireLine(actor, point, 'crouched', threat) || postureFireLine(actor, point, 'standing', threat)
        : hasLine(new THREE.Vector3(point.x, world.groundHeight(point.x, point.z) + 1.3, point.z), threat, 90),
      pathTo: point => navigate(position, point),
    };
    const currentProtected = t.cover && (t.cover.kind === 'wall-support' ? context.supportedAt(t.cover) : context.protectedAt(t.cover)) &&
      !context.blocked(t.cover) && !context.blocked(t.cover.peek) && context.seesTarget(t.cover.peek);
    const chosen = currentProtected ? null : selectCover(context);
    if (chosen) {
      const changed = t.cover?.id !== chosen.cover.id;
      if (changed) {
        t.coverMoveUntil = time + 4;
        pathRequests.delete(t.id);
      }
      t.cover = chosen.cover;
      if (changed) { t.enteredCover = false; actor.path = chosen.path; actor.pathGoal = { x: chosen.cover.x, z: chosen.cover.z }; actor.nextPath = time + 1.8; }
    } else if (currentProtected) {
      coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    } else {
      if (t.cover) coverClaims.delete(t.cover.id);
      t.cover = null;
    }
    if (benchmark) telemetry.add('coverMs', performance.now() - coverStarted);
  }
  mayFire = true;
  if (t.cover) {
    t.shotMovePending = false; t.shotMoveGoal = null;
    coverClaims.set(t.cover.id, { owner: t.id, until: time + 7 });
    if (!t.enteredCover && Math.hypot(t.cover.x - position.x, t.cover.z - position.z) < .28) {
      t.enteredCover = true; t.arrivedAt = time;
    }
    if (t.cover.kind === 'tank') {
      const exposed = target && !armorThreat && t.enteredCover && peekTurn(t, time);
      const goal = exposed ? t.cover.peek : t.cover;
      const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
      t.mode = exposed ? 'tank-peek' : distance > .6 ? 'follow-tank' : 'tank-cover';
      mayFire = Boolean(exposed && distance < .4);
      if (distance > .35) walkActor(actor, goal, 2.4, dt);
    } else if (!armorThreat) {
      const action = friendlyCoverAction(t, position, time);
      t.mode = action.mode;
      mayFire = action.mayFire;
      if (action.moving) walkActor(actor, action.goal, 2.4, dt, action.sprint);
    } else {
      const exposed = !armorThreat && t.enteredCover && peekTurn(t, time);
      const goal = exposed ? t.cover.peek : t.cover;
      const distance = Math.hypot(goal.x - position.x, goal.z - position.z);
      t.mode = armorThreat ? distance > .25 ? 'evade-armor' : 'cover-from-armor' : distance > .25 ? 'take-cover' : exposed ? 'peek' : 'cover';
      mayFire = exposed && distance < .35;
      if (distance > .15) walkActor(actor, goal, 1.8, dt);
    }
  } else {
    const distance = position.distanceTo(threat);
    const automatic = automaticFireMovement(actor, time, target?.id ?? null, distance, { allowed:
      !fixedWindow && !stationary && !armorThreat && !gateDefender && actor.order !== 'hold' &&
      time >= t.suppressedUntil && t.threatSense === 'vision' && t.threatId === target?.id });
    t.mode = distance > 24 ? 'advance-under-cover' : 'engage';
    if (armorThreat) {
      t.mode = 'armor-alert';
      if (time >= (t.retreatAt || 0)) {
        t.retreatAt = time + 2;
        t.retreatPoint = rifleArmorResponse(position, threat, point => circleBlocked(point.x, point.z, .46, world.obstacles));
      }
      if (t.retreatPoint && Math.hypot(t.retreatPoint.x - position.x, t.retreatPoint.z - position.z) > .5) {
        t.mode = 'evade-armor';
        walkActor(actor, t.retreatPoint, 2.6, dt);
      }
      mayFire = false;
    } else if (automatic) {
      t.mode = `automatic-${automatic.mode}`;
      if (automatic.mode !== 'stand') {
        automatic.goal ??= { x: position.x + (threat.x - position.x) / distance * 3.2,
          z: position.z + (threat.z - position.z) / distance * 3.2, y: position.y,
          firePace: automatic.mode === 'jog' ? 'jog' : 'aim' };
        if (segmentClear(position, automatic.goal, .43, null, movementObstacles, position.y, 1.75))
          walkActor(actor, automatic.goal, automatic.mode === 'jog' ? 2.7 : 1.1, dt);
        actor.automaticFireMoving = actor.locomotion.speed > .06 && !actor.locomotion.sprinting;
      }
    } else if (actor.friendly && t.shotMovePending) {
      mayFire = false;
      if (!t.shotMoveGoal && time >= (t.shotMoveRetryAt ?? 0) && time >= t.shotMoveStartsAt) {
        t.shotMoveRetryAt = time + .8;
        t.shotMoveGoal = chooseShotRelocation({ position, threat, preference: (t.id * .61803398875) % 1,
          blocked: point => defensePost &&
            Math.hypot(point.x - defensePost.x, point.z - defensePost.z) > 2.6 ||
            captureGuard && Math.hypot(point.x - objective.x, point.z - objective.z) > objective.radius - .4 ||
            actor.order === 'hold' && Math.hypot(point.x - actor.orderPoint.x, point.z - actor.orderPoint.z) > 7 ||
            circleBlocked(point.x, point.z, .44, movementObstacles(point.x, point.z), position.y) ||
            actorGrid.near(point.x, point.z, 1).some(other => other !== actor && other.health > 0 &&
              Math.hypot(other.position.x - point.x, other.position.z - point.z) < .8),
          heightAt: point => world.walkHeight(point.x, point.z, position.y),
          canFinish: point => actor.nativeMotion ? ['standing', 'kneeling', 'crouched'].some(pose =>
            postureFireLine(actor, point, pose, threat))
            : hasLine(new THREE.Vector3(point.x, world.groundHeight(point.x, point.z) + SOLDIER_FIRE_HEIGHT, point.z), threat, 75) });
        if (t.shotMoveGoal) {
          t.shotMoveGoal.y = world.walkHeight(t.shotMoveGoal.x, t.shotMoveGoal.z, position.y);
          actor.path = actor.pathGoal = null; pathRequests.delete(t.id);
        }
      }
      t.mode = t.shotMoveGoal ? 'relocate-after-shot' : 'seek-clear-relocation';
      if (t.shotMoveGoal) {
        if (Math.hypot(position.x - t.shotMoveGoal.x, position.z - t.shotMoveGoal.z) > .25) walkActor(actor, t.shotMoveGoal, 2.8, dt);
        else {
          t.shotMovePending = false; t.shotMoveGoal = null;
          t.poseSequence = (t.poseSequence ?? 0) + 1;
          t.completedShotMoves = (t.completedShotMoves ?? 0) + 1;
          t.relocatedFireUntil = time + 3;
          t.postureDecisionAt = t.postureUntil = 0;
        }
      }
    } else if (actor.friendly && actor.order === 'hold') {
      const goal = floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings);
      if (time >= (t.relocatedFireUntil ?? 0) && Math.hypot(goal.x - position.x, goal.z - position.z) > .4) walkActor(actor, goal, 2.4, dt);
    } else if (distance > AI_RIFLE.closeRange && time >= (t.relocatedFireUntil ?? 0) && !actor.friendly) {
      const angle = Math.atan2(threat.z - position.z, threat.x - position.x);
      const flank = { x: threat.x - Math.cos(angle) * 18 + Math.sin(angle) * (t.slot % 2 ? 5 : -5), z: threat.z - Math.sin(angle) * 18 - Math.cos(angle) * (t.slot % 2 ? 5 : -5) };
      walkActor(actor, flank, 2.2, dt);
    }
  }
  }
  if (actor.nativeMotion && !fixedWindow) {
    const moving = actor.locomotion.speed > .1 || actor.turningThisStep;
    if (moving || (t.postureNeedsChoice || time >= (t.postureDecisionAt ?? 0)) && aiDecisions.take('posture', actor)) {
      t.postureDecisionAt = time + .35;
      const heading = Math.atan2(position.x - threat.x, position.z - threat.z);
      const suppressed = time < t.suppressedUntil, distance = position.distanceTo(threat);
      const wall = !moving ? wallFiringContact(position, heading, world.town.pieces) : null;
      const proneClear = !moving && distance >= 14 && !t.cover && proneSpaceClear(actor, heading);
      const eligiblePoses = [];
      const next = chooseCombatPosture({ distance, moving, covered: Boolean(t.cover),
        exposed: mayFire && ['peek', 'wall-supported-fire'].includes(t.mode), suppressed,
        proneClear, wall, previousPose: !t.shotMovePending ? ownedFiringPose(actor) : null,
        preference: (t.id * .61803398875 + (t.poseSequence ?? 0) * .38196601125) % 1,
        canFire: stance => {
          const clear = postureFireLine(actor, position, stance, threat);
          if (clear) eligiblePoses.push(stance);
          return clear;
        } });
      t.wallContact = wall;
      const invalid = actor.firingPose === 'prone' && !proneClear ||
        actor.firingPose?.startsWith('wall') && wall?.pose !== actor.firingPose ||
        mayFire && !moving && eligiblePoses.length > 0 && !eligiblePoses.includes(ownedFiringPose(actor));
      if (moving || invalid || t.postureNeedsChoice || time >= (t.postureUntil ?? 0)) {
        if (ownedFiringPose(actor) !== next) {
          actor.firingPose = next === 'standing' ? null : next;
          actor.stance = FIRING_POSES[next]?.stance ?? 'standing';
          t.postureChangedAt = time; t.postureUntil = time + 2.6;
        }
        t.eligiblePoses = eligiblePoses;
        t.postureNeedsChoice = moving;
        if (moving) t.postureUntil = time;
      }
    }
  }
  const desiredHeading = Math.atan2(position.x - threat.x, position.z - threat.z);
  const facing = actor.automaticFireMoving
    ? Math.abs(headingError(actor.heading, desiredHeading)) <= AI_TURN.fireAngle
    : !actor.turningThisStep && actor.locomotion.speed <= .1 && advanceAITurn(actor, desiredHeading, dt).facing;
  const eye = actor.nativeMotion ? soldierEyePosition(actor) : { x: position.x, y: position.y + SOLDIER_FIRE_HEIGHT, z: position.z };
  const from = new THREE.Vector3(eye.x, eye.y, eye.z);
  const suppressed = time < t.suppressedUntil;
  const solution = Boolean(target && t.threatSense === 'vision' && t.threatId === target.id && mayFire &&
    canWeaponDamageTarget('rifle', t.threatKind) && canRiflemanTrackTarget(t.threatKind));
  actor.rifleReady = actor.aimWalking || actor.automaticFireMoving ||
    solution && facing && actor.locomotion.speed <= .1 && actor.locomotion.aimRecovery === 0;
  let muzzle = null, firingOptions = [];
  if (!attemptAIRifleShot(actor, { now: time, targetId: target?.id ?? null, suppressed,
    postureSettled: postureReady(actor) && nativeAimReady(actor),
    mayFire: solution && facing && (actor.friendly || !finalBoardingFireHeld(nanjingCampaign, time)),
    confirmShot: () => {
      const observed = observeVisualThreat(t, target, time, point => hasLine(from, point, 75, target.vehicleId));
      if (!observed) { actor.target = null; return null; }
      threat.copy(observed);
      t.engagementPoint = { ...observed };
      if (Math.abs(headingError(actor.heading, Math.atan2(position.x - threat.x, position.z - threat.z))) > AI_TURN.fireAngle) return null;
      muzzle = clearAIRifleLine(actor, from, threat);
      if (!muzzle) return null;
      firingOptions = actor.nativeMotion ? (t.eligiblePoses ?? []).filter(pose =>
        postureFireLine(actor, position, pose, threat)) : [];
      return from.distanceTo(threat);
    } })) return;
  const distance = actor.aiRifle.lastShot.distance;
  actor.nextFire = time + (infantryWeaponProfile(actor.rifle).automatic
    ? actor.rifle.shots % 3 === 0 ? .8 : infantryWeaponProfile(actor.rifle).cycleSeconds
    : rifleAIFireDelay(distance, suppressed, battleRandom()));
  t.lastShot = { time, previousTime: t.lastShot?.time ?? null, mode: t.mode, stance: actor.stance, firingPose: ownedFiringPose(actor),
      heading: actor.heading, lowReady: actor.nativeMotion?.lowReady ?? null,
      headAim: actor.nativeMotion ? sampleNraMotion(actor).headAim ?? null : null,
      facingError: Math.abs(headingError(actor.heading, Math.atan2(position.x - threat.x, position.z - threat.z))),
      coverId: t.cover?.id ?? t.wallContact?.wallId ?? null, completedShotMoves: t.completedShotMoves ?? 0,
      eligiblePoses: firingOptions,
      speed: actor.locomotion.speed, aimRecovery: actor.locomotion.aimRecovery,
      position: { x: position.x, z: position.z } };
  if (actor.friendly) {
    if (suppressed && t.suppressedUntil - time > .8 && time >= (t.nextRelocationAt ?? 0) &&
      !t.cover && !t.wallContact && actor.order !== 'hold' && !infantryWeaponProfile(actor.rifle).automatic) {
      t.shotMovePending = true; t.shotMoveGoal = null;
      t.shotMoveStartsAt = time + .45;
      t.nextRelocationAt = time + 8;
    }
  }
  combatStats.aiRifleShots++;
  if (target.targetKind === 'closed-armor') combatStats.aiRifleShotsAtArmor++;
  if (target.targetKind === 'aircraft') combatStats.aiRifleShotsAtAircraft++;
  const source = captureAttackSource(entities, actor, actor.rifle);
  combatEvents.publish('shot', { source, weaponType: 'infantry', start: muzzle, end: threat,
    automatic: infantryWeaponProfile(actor.rifle).automatic,
    muzzle: true, color: actor.friendly ? 0xf6d399 : 0xdfb17a }, time);
  combatSounds.push({ id: ++soundSerial, friendly: actor.friendly, x: muzzle.x, y: muzzle.y, z: muzzle.z, time, radius: 40 });
  if (combatSounds.length > 32) combatSounds.shift();
  if (battleRandom() < rifleAIHitChance(distance, suppressed)) {
    const hit = soldierHits.raycast(target, time, muzzle, threat.clone().sub(muzzle).normalize(), bodyRay);
    if (hit && hit.distance <= 75 && hasLine(muzzle, hit.point, 75)) {
      hurt(target, TYPES.infantry.damage, source, 'rifle', hit.object.userData.hitZone, hit.point.clone().sub(muzzle));
    }
  }
}

function cancelAIMelee(actor) {
  cancelBayonet(actor.bayonet);
  if (actor.dadao) stowDadao(actor.dadao);
}

function updateAIWeaponClearance(actor, anticipatingThrust = false) {
  actor.weaponBlocked = false;
  if (actor.team !== 'enemy' || actor.health <= 0 || actor.vehicleId ||
    (actor.rifle.model ?? 'rifle') !== 'rifle' || !actor.nativeMotion ||
    !movementObstacles(actor.position.x, actor.position.z).length) return;
  const extensions = anticipatingThrust || actor.bayonet.mode !== 'idle' ? [0, .5, 1] : [null];
  actor.weaponBlocked = extensions.some(extension => {
    const poseActor = { ...actor, weaponBlocked: false,
      bayonet: extension === null ? actor.bayonet : { ...actor.bayonet, mode: 'thrust', extension } };
    return bayonetObstructed(actor, sampleNativeMotion(poseActor, false), movementObstacles);
  });
  if (actor.weaponBlocked) { cancelBayonet(actor.bayonet); actor.rifleReady = false; }
}

function tryAIMelee(actor, target, dt) {
  if (!actor.friendly && finalBoardingFireHeld(nanjingCampaign, time)) { cancelAIMelee(actor); return false; }
  if (actor.hasFirearm === false) { cancelAIMelee(actor); return false; }
  if (actor.rifle.ammo === 0 && !actor.meleePriority) { cancelAIMelee(actor); return false; }
  const sword = actor.team === 'friendly' && Boolean(actor.dadao);
  const state = sword ? actor.dadao : actor.bayonet, reach = sword ? DADAO.reach : BAYONET.reach;
  const distance = sword ? dadaoCombatDistance(actor, target) : bayonetDistance(actor, target);
  const limit = meleeEngagementRange(actor, target);
  if (distance === null || distance > limit) { cancelAIMelee(actor); return false; }
  const eye = soldierEyePosition(actor), origin = new THREE.Vector3(eye.x, eye.y, eye.z);
  const observed = observeVisualThreat(actor.tactics, target, time, point => hasLine(origin, point, limit + 2));
  const visible = Boolean(observed && hasLine(actor.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
    targetAimPoint(target), limit + 2));
  if (!visible) { cancelAIMelee(actor); return false; }
  actor.stance = 'standing'; actor.firingPose = null;
  const position = actor.position, dx = target.position.x - position.x, dz = target.position.z - position.z;
  const targetHeading = Math.atan2(-dx, -dz);
  const steering = distance > reach ? infantrySteering(actor,
    trafficGrid.near(position.x, position.z, 3.2).filter(other => other.id !== target.id),
    { x: dx, z: dz }, { spacing: 1, constrained: false,
      dt, now: time, reservations: trafficReservations,
      blocked: point => circleBlocked(point.x, point.z, .43, movementObstacles(point.x, point.z), position.y) }) : null;
  const turn = advanceAITurn(actor, steering ? Math.atan2(-steering.x, -steering.z) : targetHeading, dt, true);
  updateAIWeaponClearance(actor, true);
  if (actor.weaponBlocked) { cancelAIMelee(actor); return false; }
  actor.turningThisStep = true;
  const facts = { now: time, visible,
    facing: Math.abs(headingError(actor.heading, targetHeading)) <= AI_TURN.fireAngle,
    settled: sword ? postureReady(actor) : bayonetPoseReady(actor) };
  const action = sword ? advanceAIDadao(actor, target, { ...facts,
    origin: position.clone().add(new THREE.Vector3(0, 1.1, 0)),
    forward: new THREE.Vector3(-Math.sin(actor.heading), 0, -Math.cos(actor.heading)),
    aimPoint: targetAimPoint, clear: (from, to) => hasLine(from, to, DADAO.reach + 1) })
    : advanceBayonet(actor, target, facts);
  if (!action.active) return false;
  const kind = sword ? 'dadao' : 'bayonet';
  resetAIRifleAim(actor.aiRifle, kind);
  actor.rifleReady = false; actor.buildProgress = 0;
  const tactics = actor.tactics;
  if (tactics.cover) coverClaims.delete(tactics.cover.id);
  tactics.cover = null; tactics.enteredCover = false; tactics.armorEscort = null;
  actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
  tactics.mode = `${kind}-${state.mode}`;
  if (action.hit) hurt(target, sword ? DADAO.damage : BAYONET.damage,
    captureAttackSource(entities, actor, sword ? actor.dadao : actor.rifle), kind);
  if (state.mode !== 'charge' || !steering || !turn.mayMove || !postureReady(actor)) return true;
  const obstacles = movementObstacles(position.x, position.z);
  const profile = FOOT_SPEEDS[actor.groundType];
  const sprint = !actor.locomotion.exhausted && actor.locomotion.stamina > 0;
  const speed = sprint ? profile.sprint : profile.jog;
  const step = Math.min(distance - reach + .05, speed * dt * steering.speed);
  const beforeX = position.x, beforeZ = position.z;
  (sihangCampaignMode || nanjingDockMovementLimited(position) ? moveInfantry : world.moveInfantry)(
    position, steering.x * step, steering.z * step, .42, infantryMovementObstacles(actor, position.x, position.z));
  position.y = world.walkHeight(position.x, position.z, position.y);
  actor.locomotion.speed = Math.hypot(position.x - beforeX, position.z - beforeZ) / dt;
  actor.locomotion.sprinting = sprint && actor.locomotion.speed > profile.jog;
  actor.locomotion.mode = actor.locomotion.speed < .06 ? 'idle' : actor.locomotion.sprinting ? 'sprint' : 'jog';
  actor.walkPhase += actor.locomotion.speed * dt * 2.5;
  actor.walkPoseReady = actor.locomotion.speed > .06;
  return true;
}

function formationObjective(actor, fallback) {
  return objectives.find(point => point.id === (actor.playerUnit ? actor.orderObjectiveId : actor.formation.objectiveId)) ?? fallback;
}

function playerOrderDestination(actor, player, yaw = controlPose.yaw) {
  const offset = sectionOffset(actor.index % BATTLE_RULES.sectionMembers);
  let desired = actor.order === 'follow'
    ? { x: player.position.x + Math.cos(yaw) * offset.x * 1.5 + Math.sin(yaw) * (offset.z * 1.5 + 5),
      z: player.position.z - Math.sin(yaw) * offset.x * 1.5 + Math.cos(yaw) * (offset.z * 1.5 + 5) }
    : holdDestination(actor);
  if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
    sihangCampaign.assemblyReleased && actor.order === 'follow')
    desired = sihangRetreatFollowPosition(actor, player, desired);
  const anchor = actor.order === 'follow' ? player.position : actor.orderPoint;
  if (nanjingCampaignMode && world.casemateContains(anchor)) {
    const y = world.walkHeight(desired.x, desired.z, anchor.y);
    if (!world.casemateContains({ ...desired, y }) || Math.abs(y - anchor.y) > .3 ||
      circleBlocked(desired.x, desired.z, .42, movementObstacles(desired.x, desired.z), y))
      return { x: anchor.x, y: anchor.y, z: anchor.z };
    return { ...desired, y };
  }
  if (sihangCampaignMode) {
    const y = world.walkHeight(desired.x, desired.z, anchor.y ?? 0);
    if (desired.x < battleArea.minX || desired.x > battleArea.maxX || desired.z < battleArea.minZ || desired.z > battleArea.maxZ ||
      world.isDeepWater(desired.x, desired.z) || Math.abs(y - (anchor.y ?? 0)) > .3 ||
      circleBlocked(desired.x, desired.z, .42, movementObstacles(desired.x, desired.z), y))
      return { x: anchor.x, y: anchor.y ?? 0, z: anchor.z };
    return { ...desired, y };
  }
  return floorDestination(anchor, desired, world.town.buildings);
}

function formationDestination(actor, active) {
  if (sihangCampaignMode) {
    if (actor.friendly) {
      if (sihangCampaign.stage === 'sihang-retreat') return actor.playerUnit
        ? playerOrderDestination(actor, controlledSoldier(entities))
        : sihangRetreatGoal(actor);
      if (!actor.playerUnit) {
        const post = sihangDefenseGoal(actor.formation.index, actor.index);
        actor.tactics.sihangDuty = post.duty; actor.tactics.sihangPost = post.id ?? null;
        return { ...post, transit: true };
      }
    }
    if (sihangCampaign.stage === 'sihang-retreat') return sihangPursuitGoal(actor);
  }
  if (encirclementMode && encirclement.phase === 2) return breakoutDestination(actor);
  if (nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage)) {
    if (!actor.friendly) return nanjingDockAssaultGoal(actor);
    if (!actor.playerUnit && actor.tactics.nanjingDockDefense)
      return actor.tactics.nanjingDockDefense;
  }
  const point = formationObjective(actor, active);
  actor.tactics.objectiveId = point.id;
  if (actor.formation.supplyGarrison && actor.formation.supplyGuardPositions) {
    return actor.formation.supplyGuardPositions[actor.index % actor.formation.supplyGuardPositions.length];
  }
  if (nanjingCampaignMode && actor.friendly && !actor.playerUnit && nanjingCampaign.stage === 'gate-defense') {
    const duty = nanjingDefenseGoal(actor, nanjingCampaign.defenseSituation);
    if (duty) return duty;
    const anchor = spawnPoints.find(spawn => spawn.id === actor.formation.openingSpawnId);
    return nanjingDefensePost(actor.position, actor.index, anchor);
  }
  if (!actor.friendly && nanjingCampaignMode && nanjingCampaign.stage === 'gate-defense') {
    const southGate = world.landmarks.gatehouse.gates.find(gate => gate.main);
    if (actor.assaultCrossing === 'bridge' && actor.position.z > 38.8) {
      return { x: world.landmarks.bridges[0].x, z: 38, transit: true };
    }
    if (southGate && actor.position.z > southGate.z - southGate.depth / 2 - .2) {
      return { x: 0, z: southGate.z - southGate.depth / 2 - 1, transit: true };
    }
  }
  return actor.friendly ? objectiveDestination(actor.tactics, actor.position, point) : assaultDestination(actor, point);
}

function sihangSupportGoal(actor) {
  const context = sihangSupportContext, cached = actor.tactics.sihangCover;
  if (cached?.point && Math.hypot(context.center.x - cached.x, context.center.z - cached.z) < 2 &&
    sihangOutsideCover(cached.point, context)) return cached.point;
  const point = sihangCoverCandidates(actor, context).find(point =>
    point.x > battleArea.minX + 2 && point.x < battleArea.maxX - 2 &&
    point.z > battleArea.minZ + 2 && point.z < battleArea.maxZ - 2 &&
    sihangNorthBank(point, 1) && !circleBlocked(point.x, point.z, .5,
      movementObstacles(point.x, point.z), 0) && Math.abs(world.walkHeight(point.x, point.z, 0)) < .1);
  if (!point) {
    actor.tactics.pathReason = 'blocked-support-position';
    if (!cached?.warned) console.warn('Sihang support position unavailable', actor.id);
    actor.tactics.sihangCover = { warned: true };
    return null;
  }
  actor.tactics.sihangCover = { x: context.center.x, z: context.center.z, point };
  return point;
}

function breakoutDestination(actor) {
  const breakout = encirclement.breakout;
  const intercept = actor.friendly && actor.formation.breakoutDuty === 'intercept';
  let destination;
  if (intercept) destination = { x: 39 + actor.formation.index % 3 * 4 + actor.index % 2 * 1.3,
    z: EAST_BREAKOUT.z + (actor.index % 5 - 2) * 2.4 + (Math.floor(actor.formation.index / 3) - 1) * 3 };
  else if (!actor.friendly && breakout?.stage === 'breakout' &&
    (breakout.groups?.[breakoutGroupNumber(actor.formation)].released??true)) {
    if (actor.position.x >= EAST_BREAKOUT.x - (actor.vehicleId ? 6 : 5) &&
      Math.abs(actor.position.z - EAST_BREAKOUT.z) < 3)
      actor.tactics.breakoutApproach = true;
    destination = { x: actor.tactics.breakoutApproach ? EAST_BREAKOUT.exitX + 2 : EAST_BREAKOUT.x - 4, z: EAST_BREAKOUT.z };
  } else {
    const group=breakoutGroupDestination(breakoutGroupNumber(actor.formation));
    destination={x:group.x+(actor.index%3-1)*1.5,z:group.z+(Math.floor(actor.index/3)-1.5)*1.5};
  }
  const signature = `${destination.x}:${destination.z}`;
  if (actor.tactics.breakoutGoal?.signature === signature) return actor.tactics.breakoutGoal.point;
  const radius = actor.vehicleId ? 2.2 : .5;
  const candidates = [destination];
  for (const offset of [2, 4, 6, 8, 12]) for (let side = 0; side < 16; side++) {
    candidates.push({ x: destination.x + Math.cos(side * Math.PI / 8) * offset,
      z: destination.z + Math.sin(side * Math.PI / 8) * offset });
  }
  const point = candidates.find(point => !circleBlocked(point.x, point.z, radius, world.obstacles,
    world.groundHeight(point.x, point.z)));
  if (!point) throw new Error('No physically clear eastern breakout destination');
  actor.tactics.breakoutGoal = { signature, point: { ...point, y: world.groundHeight(point.x, point.z), transit: true } };
  return actor.tactics.breakoutGoal.point;
}

function resolveEastGateEscapes() {
  const leaving = enemies.filter(actor => {
    if (actor.health <= 0 || actor.formation.type === 'plane' && actor.vehicleId) return false;
    const position = actor.position;
    if(crossedEastGate(actor.tactics.breakoutPreviousPosition,position))actor.tactics.passedEastGate=true;
    actor.tactics.breakoutPreviousPosition={x:position.x,y:position.y,z:position.z};
    return actor.tactics.passedEastGate && position.x >= EAST_BREAKOUT.exitX &&
      Math.abs(position.z - EAST_BREAKOUT.z) <= EAST_BREAKOUT.halfWidth + 2 &&
      recordEncirclementEscape(encirclement, actor.id);
  });
  if (!leaving.length) return;
  const removed = new Set(leaving), transports = new Set(leaving.map(actor => actor.vehicleId).filter(Boolean));
  clearActors(leaving);
  enemies = enemies.filter(actor => !removed.has(actor));
  for (const formation of formations) formation.members = formation.members.filter(actor => !removed.has(actor));
  for (const id of transports) {
    const vehicle = entities.vehicles.get(id);
    if (vehicle && vehicle.seats.every(seat => !seat.occupantId)) {
      entities.vehicles.delete(id); entities.weapons.delete(vehicle.weapon.id);
      for (const gun of vehicle.machineGuns ?? []) entities.weapons.delete(gun.id);
    }
  }
  rebuildForces();
}

function restoreBreakoutForces() {
  const breakout=encirclement.breakout;
  if(!breakout?.reinforcing)return;
  breakout.restoration??=breakoutRestorationPlan(formations);
  if(time<(breakout.nextRestoreAt??0))return;
  breakout.nextRestoreAt=time+BREAKOUT_FORCE.spawnInterval;
  const task=breakout.restoration.find(task=>task.required>0);
  if(!task){registerBreakoutStrength(encirclement,[],true);return;}
  let formation=formations.find(unit=>unit.id===task.id);
  if(!formation){
    formation={id:task.id,index:10+breakout.restoration.indexOf(task),team:'enemy',type:'plane',
      members:[],memberCount:AIRCRAFT_SQUAD_SIZE,aircraftCount:AIRCRAFT_SQUAD_SIZE,
      spawnId:'japan-air',generation:0,active:true,respawnEnabled:true,player:false};
    formations.push(formation);registerUnit(entities,formation);registerBattleScore(formation);
  }
  const player=controlledSoldier(entities);
  camera.updateMatrixWorld(true);
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  const visible=(point,height=2)=>frustum.intersectsSphere(new THREE.Sphere(new THREE.Vector3(point.x,
    world.groundHeight(point.x,point.z)+height,point.z),3));
  const obstacles=deploymentObstacles();
  let spawn,positions;
  if(task.type==='plane'){
    const candidates=[[-180,-130],[-180,130],[180,-130],[180,130],[0,-190],[0,190]];
    const point=candidates.map(([x,z])=>({x,z})).find(point=>!frustum.intersectsSphere(
      new THREE.Sphere(new THREE.Vector3(point.x,60,point.z),8)));
    if(point)spawn={id:`${task.id}-entry`,name:'东门突围航空支援',team:'enemy',kind:'air',altitude:60,...point};
  }else{
    const candidates=hiddenBreakoutPositions(player.position,visible,point=>
      !spawnBlockReason({...point,altitude:0,kind:task.type==='tank'?'garage':'base',team:'enemy'},
        task.type,hostilePositions('enemy'),obstacles));
    for(let attempt=0;attempt<Math.min(3,candidates.length);attempt++){
      const point=candidates[(task.spawnCursor??0)%candidates.length];
      task.spawnCursor=(task.spawnCursor??0)+1;
      if(!navigate(point,{x:52,z:3}).length)continue;
      const candidate={id:`${task.id}-restore`,name:'合围部队视野外集结',team:'enemy',kind:task.type==='tank'?'garage':'base',altitude:0,...point};
      if(task.type==='tank'&&!armorNavigate.canSpawn(candidate,[...entities.vehicles.values()]))continue;
      if(task.type==='infantry'){
        try{positions=formationPositions(candidate,task.required,obstacles,allForces.filter(actor=>actor.health>0).map(actor=>actor.position),
          hostilePositions('enemy'));}
        catch(error){if(error instanceof FormationPlacementError)continue;throw error;}
        if(positions.some(point=>visible(point)||Math.hypot(point.x-player.position.x,point.z-player.position.z)<28))continue;
      }
      spawn=candidate;break;
    }
  }
  if(!spawn){
    if(!task.reported){toast('日军突围部队等待视野外安全集结位置。',4);task.reported=true;}
    return;
  }
  if(task.type==='infantry'){
    const base=formation.members.reduce((max,actor)=>Math.max(max,actor.index+1),0);
    const added=positions.map((point,index)=>actorAt(false,point.x,point.z,base+index,spawn,formation));
    formation.members.push(...added);enemies.push(...added);registerBreakoutStrength(encirclement,added.map(actor=>actor.id));
    rebuildForces();
  }else{
    const oldSpawn=formation.spawnId,oldRespawn=formation.respawnEnabled;
    formation.spawnId=spawn.id;formation.respawnEnabled=true;
    spawnPoints.push(spawn);
    const success=task.type==='tank'?spawnJapaneseArmor(formation):spawnJapaneseAircraft(formation);
    spawnPoints.splice(spawnPoints.indexOf(spawn),1);
    formation.spawnId=oldSpawn;formation.respawnEnabled=oldRespawn;
    if(!success)return;
    if(task.type==='tank')registerBreakoutStrength(encirclement,formation.members.map(actor=>actor.id));
  }
  task.required=0;
  for(const actor of formation.members.filter(actor=>actor.health>0)){
    actor.tactics.cover=null;actor.tactics.breakoutGoal=null;actor.target=null;actor.path=actor.pathGoal=null;
    pathRequests.delete(actor.tactics.id);
  }
  if(breakout.restoration.every(task=>task.required===0))registerBreakoutStrength(encirclement,[],true);
}

const sweepRoute = [
  ...[-82, -51, -30, 3, 30, 62, 82].flatMap(z => [-88, -66, -44, -22, 0, 22, 44, 66, 88]
    .map(x => ({ x, y: world.groundHeight(x, z), z }))
    .filter(point => !circleBlocked(point.x, point.z, .5, world.obstacles, point.y))),
  ...world.town.buildings.flatMap(building => [
    { x: building.x + building.w / 2 + 1.2, y: 0, z: building.doorZ },
    ...(building.stairs ?? []).map(flight => ({ ...flight.upper })),
  ]),
];

function sweepDestination(actor) {
  if (encirclementMode && encirclement.phase === 2) return breakoutDestination(actor);
  const tactics = actor.tactics;
  tactics.sweep ??= { index: (actor.formation.index * 7 + actor.index) % sweepRoute.length, startedAt: time };
  let point = sweepRoute[tactics.sweep.index];
  if (actor.position.distanceTo(new THREE.Vector3(point.x, point.y, point.z)) < 2 || time - tactics.sweep.startedAt > 45) {
    tactics.sweep.index = (tactics.sweep.index + 1) % sweepRoute.length;
    tactics.sweep.startedAt = time;
    point = sweepRoute[tactics.sweep.index];
  }
  return point;
}

function moveNanjingDefender(actor, goal, dt) {
  const position = actor.position, tactics = actor.tactics;
  const waypoint = goal.y > 7
    ? nanjingWallEntryWaypoint(position, tactics.nanjingDefense.side)
    : nanjingWallExitWaypoint(position);
  if (tactics.cover) coverClaims.delete(tactics.cover.id);
  tactics.cover = null; tactics.enteredCover = false;
  tactics.shotMovePending = false; tactics.shotMoveGoal = null;
  actor.stance = 'standing'; actor.firingPose = null;
  tactics.mode = `defense-${tactics.nanjingDefense.role}`;
  resetAIRifleAim(actor.aiRifle, 'defense-positioning');
  const stepPoint = waypoint ?? goal;
  const alignPost = !waypoint && goal.y > 7 && Math.hypot(goal.x - position.x, goal.z - position.z) < 1;
  if (waypoint && (waypoint.ramp || position.y > .24) || alignPost) {
    actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
    const dx = stepPoint.x - position.x, dz = stepPoint.z - position.z;
    const distance = Math.hypot(dx, dz);
    const turn = advanceAITurn(actor, Math.atan2(-dx, -dz), dt, true);
    if (distance > .01 && turn.mayMove && postureReady(actor)) {
      const beforeX = position.x, beforeZ = position.z;
      const step = Math.min(distance, FOOT_SPEEDS[actor.groundType].jog * dt);
      world.moveInfantry(position, dx / distance * step, dz / distance * step,
        .42, infantryMovementObstacles(actor, position.x, position.z));
      actor.locomotion.speed = Math.hypot(position.x - beforeX, position.z - beforeZ) / dt;
      actor.locomotion.mode = actor.locomotion.speed > .06 ? 'jog' : 'idle';
      actor.walkPhase += actor.locomotion.speed * dt * 2.5;
      actor.walkPoseReady = actor.locomotion.speed > .06;
    }
  } else walkActor(actor, waypoint ?? goal, 3, dt);
}

function dischargerContext() {
  return { sihang: sihangCampaignMode, nanjingStage: nanjingCampaignMode ? nanjingCampaign.stage : null,
    eastAssembly: encirclementMode && encirclement.phase === 2 && encirclement.breakout?.stage !== 'breakout' };
}

function traceDischargerSegment(from, to, shell = null) {
  const origin = new THREE.Vector3(from.x, from.y, from.z);
  const delta = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z);
  const length = delta.length();
  if (length < .00001) return null;
  const travel = delta.clone().normalize();
  ray.set(origin, travel); ray.far = length;
  const people = shell ? actorGrid.near((from.x + to.x) / 2, (from.z + to.z) / 2, length / 2 + 2)
    .filter(actor => actor.health > 0 && !actor.vehicleId && actor.id !== shell.source.soldierId &&
      pointSegmentDistance(actor.position, origin, to).distance < 2)
    .map(actor => soldierHits.sync(actor, time)) : [];
  const hit = ray.intersectObjects([...solidIndex.candidates(origin, travel, length),
    ...vehicleSolids(), ...people], true)[0];
  ray.far = Infinity;
  const clearance = fraction => {
    const x = from.x + delta.x * fraction, z = from.z + delta.z * fraction;
    return from.y + delta.y * fraction - world.groundHeight(x, z) - .035;
  };
  let previous = 0;
  for (let index = 1; index <= 4; index++) {
    const fraction = index / 4;
    if (clearance(fraction) <= 0) {
      let low = previous, high = fraction;
      for (let iteration = 0; iteration < 8; iteration++) {
        const middle = (low + high) / 2;
        if (clearance(middle) > 0) low = middle; else high = middle;
      }
      if (!hit || length * high < hit.distance) return origin.addScaledVector(delta, high);
      break;
    }
    previous = fraction;
  }
  return hit?.point ?? null;
}

function dischargerTargetVisible(operator, target) {
  if (sihangCampaignMode && !sihangNightVisibility(sihangCampaign, operator.position, target.position)) return false;
  const eye = soldierEyePosition(operator), targetEye = soldierEyePosition(target);
  const from = new THREE.Vector3(eye.x, eye.y, eye.z);
  return hasLine(from, targetAimPoint(target), GRENADE_DISCHARGER.maxRange + 3) ||
    hasLine(from, new THREE.Vector3(targetEye.x, targetEye.y, targetEye.z), GRENADE_DISCHARGER.maxRange + 3);
}

function operateAIDischarger(actor, dt) {
  const weapon = actor.discharger;
  if (!weapon) return false;
  const context = dischargerContext(), view = dischargerViews.get(actor.id);
  if (!view || actor.grenades.action || !weapon.ammo && !weapon.reserve || context.eastAssembly) {
    stowGrenadeDischarger(weapon); return false;
  }
  let target = entities.soldiers.get(weapon.targetId);
  if (time >= weapon.queryAt && dischargerQueryBudget > 0) {
    dischargerQueryBudget--;
    weapon.queryAt = time + GRENADE_DISCHARGER.querySeconds;
    const candidates = selectDischargerTargets(actor,
      actorGrid.near(actor.position.x, actor.position.z, GRENADE_DISCHARGER.maxRange)
        .filter(target => target.id !== weapon.blockedTargetId || time >= (weapon.blockedUntil ?? 0)),
      emplacements, context);
    const chosen = candidates.find(({ target }) => dischargerTargetVisible(actor, target));
    target = chosen?.target; weapon.targetId = target?.id ?? null;
    weapon.aimPoint = target ? { x: target.position.x, y: target.position.y + .035,
      z: target.position.z } : null;
    weapon.priority = chosen?.priority ?? null;
    weapon.rejected = target ? null : 'no-visible-legal-target';
  }
  if (!target || !dischargerTargetAllowed(actor, target, context) ||
    sihangCampaignMode && !sihangNightVisibility(sihangCampaign, actor.position, target.position)) {
    stowGrenadeDischarger(weapon); return false;
  }
  if (weapon.phase === 'carrying') {
    const heading = Math.atan2(actor.position.x - target.position.x, actor.position.z - target.position.z);
    const anchor = { x: actor.position.x - Math.sin(heading) * .14, y: actor.position.y,
      z: actor.position.z - Math.cos(heading) * .14 };
    if (circleBlocked(anchor.x, anchor.z, .12, movementObstacles(anchor.x, anchor.z), anchor.y, .6) ||
      Math.abs(world.walkHeight(anchor.x, anchor.z, anchor.y) - anchor.y) > .2) {
      weapon.rejected = 'unsafe-placement'; stowGrenadeDischarger(weapon); return false;
    }
    weapon.anchor = anchor; weapon.phase = 'setting-up';
    weapon.setupUntil = time + GRENADE_DISCHARGER.setupSeconds;
  }
  if (Math.hypot(actor.position.x - weapon.anchor.x, actor.position.z - weapon.anchor.z) > 1 ||
    Math.abs(actor.position.y - weapon.anchor.y) > .2) {
    stowGrenadeDischarger(weapon); return false;
  }
  cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'grenade-discharger');
  releaseWeaponMount(actor.weaponMount); stopLocomotion(actor.locomotion);
  actor.rifleReady = false; actor.stance = 'crouched'; actor.firingPose = 'kneeling';
  actor.tactics.mode = 'operate-grenade-discharger';
  weapon.presentationActive = true;
  const turn = advanceAITurn(actor, Math.atan2(actor.position.x - target.position.x,
    actor.position.z - target.position.z), dt);
  view.position.set(weapon.anchor.x, weapon.anchor.y, weapon.anchor.z);
  view.rotation.y = actor.heading; view.updateMatrixWorld(true);
  if (time < weapon.setupUntil || !turn.facing || !postureReady(actor)) return true;
  weapon.phase = 'ready';
  if (finalBoardingFireHeld(nanjingCampaign, time) || time < weapon.nextShot || shells.length >= PROJECTILE_LIMIT ||
    shells.filter(shell => shell.kind === 'grenade-discharger').length >= GRENADE_DISCHARGER.activeLimit) return true;
  // Validate observed aim before dispersion; an otherwise-safe miss may hit real masonry.
  if (!dischargerQueryBudget) return true;
  dischargerQueryBudget--;
  if (!dischargerTargetVisible(actor, target)) {
    weapon.rejected = 'target-occluded'; stowGrenadeDischarger(weapon); return false;
  }
  const start = view.userData.discharger.muzzle.getWorldPosition(new THREE.Vector3());
  const source = captureAttackSource(entities, actor, weapon);
  if (!weapon.aimPoint) throw new Error('Discharger has no observed aim position');
  const shell = createDischargerShell({ id: `shell-${++projectileSerial}`, source, start,
    target: weapon.aimPoint, accuracy: dischargerAccuracy(actor, target, time),
    firedAt: time, random: battleRandom });
  shell.target = Object.freeze({ ...shell.target,
    y: world.walkHeight(shell.target.x, shell.target.z, target.position.y) + .035 });
  if (sihangCampaignMode && !sihangBlastClearOfSouthBank(shell.target, GRENADE_DISCHARGER.radius)) {
    weapon.rejected = 'neutral-bank-danger'; weapon.nextShot = time + GRENADE_DISCHARGER.querySeconds;
    return true;
  }
  const aimShell = dischargerAimTrajectory(shell);
  const clearAim = dischargerTrajectoryClear(aimShell, traceDischargerSegment);
  const impact = clearAim ? dischargerTrajectoryImpact(shell, traceDischargerSegment).position : shell.target;
  const unsafe = clearAim && enemies.some(friend => friend.health > 0 &&
    Math.hypot(friend.position.x - impact.x, friend.position.y - impact.y,
      friend.position.z - impact.z) < GRENADE_DISCHARGER.radius + 1);
  if (unsafe || !clearAim) {
    weapon.rejected = unsafe ? 'friendly-danger' : 'blocked-trajectory';
    weapon.blockedTargetId = target.id; weapon.blockedUntil = time + 3;
    weapon.nextShot = time + GRENADE_DISCHARGER.querySeconds;
    stowGrenadeDischarger(weapon); return false;
  }
  if (!loadDischargerRound(weapon, time, shells.filter(shell => shell.kind === 'grenade-discharger').length)) return true;
  weapon.rejected = null;
  const mesh = createGrenadeDischargerShellModel();
  updateGrenadeDischargerShellModel(mesh, shell);
  mesh.position.copy(start); mesh.userData.projectileId = shell.id;
  scene.add(mesh); shellViews.set(shell.id, mesh); shells.push(shell);
  combatEvents.publish('shot', { source, weaponType: 'mortar', start, sound: 'blast', recoil: 0 }, time);
  combatSounds.push({ id: ++soundSerial, friendly: false, x: start.x, y: start.y, z: start.z, time, radius: 65 });
  if (combatSounds.length > 32) combatSounds.shift();
  return true;
}

function sihangTrafficYield(actor, player, wave, cover) {
  const leavingCover = wave?.phase === 'cover' && wave.squads[wave.coverSlot]?.includes(actor.id);
  const eligible = sihangCampaign.assemblyReleased && ['main', 'cover'].includes(wave?.phase) &&
    (cover || leavingCover || actor.playerUnit && actor.order === 'follow' && player?.locomotion.speed < .2);
  if (!eligible) { actor.tactics.sihangTrafficYield = null; return null; }
  const state = actor.tactics.sihangTrafficYield;
  const waiting = state && entities.soldiers.get(state.waitingId);
  if (state && time < state.until && waiting?.health > 0 &&
    Math.hypot(waiting.position.x - actor.position.x, waiting.position.z - actor.position.z) < 3)
    return state.goal;
  actor.tactics.sihangTrafficYield = null;
  if (time < (actor.tactics.sihangYieldRetryAt ?? 0)) return null;
  const neighbors = trafficGrid.near(actor.position.x, actor.position.z, 3.8);
  const blocked = neighbors.map(other => entities.soldiers.get(other.id)).find(other =>
    other && other.friendly && !other.playerUnit && !sihangWaveCover(other) && other.health > 0 &&
    wave.squads.some(ids => ids.includes(other.id)) &&
    ['wait-for-spacing', 'turn-to-path'].includes(other.tactics.mode) &&
    other.tactics.blockedBy === actor.id && other.tactics.traffic?.waitSeconds >= 2.5);
  const stalled = !blocked && leavingCover && actor.tactics.traffic?.reason === 'no-yield-space' &&
    actor.tactics.traffic.waitSeconds >= 2.5;
  if (!blocked && !stalled) return null;
  actor.tactics.sihangYieldRetryAt = time + 3;
  const goal = sihangRetreatYieldPosition(actor, blocked ?? actor, destination =>
    sampledRouteClear(actor.position, destination, (x, z) =>
      !infantryNavigationBlocked({ x, z }, actor.position, .43, actor) &&
      Math.abs(world.walkHeight(x, z, actor.position.y) - actor.position.y) <= .3 &&
      neighbors.every(other => other.id === actor.id || other.health <= 0 || other.vehicleId ||
        Math.abs(other.position.y - actor.position.y) >= 1.5 ||
        Math.hypot(x - other.position.x, z - other.position.z) >=
          Math.min(.9, Math.hypot(actor.position.x - other.position.x, actor.position.z - other.position.z) - .01))));
  if (!goal) return null;
  actor.tactics.sihangTrafficYield = { goal, waitingId: blocked?.id ?? actor.id, until: time + (blocked ? 8 : 3) };
  return goal;
}

function updateAI(dt) {
  dischargerQueryBudget = 2;
  engineerPlanBudget = 2;
  sihangSupportContext = sihangCampaignMode && sihangCampaign.stage === 'sihang-defense' && !sihangCampaign.outcome
    ? sihangCoverContext(sihangCombat.snapshot.members) : null;
  const player = allies[current];
  const finalNanjingWithdrawal = nanjingCampaignMode && nanjingCampaign.stage === 'withdrawal-to-boats' &&
    nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready;
  if (nanjingCampaignMode && nanjingCampaign.stage === 'gate-defense' &&
    time >= (nanjingCampaign.defenseUpdateAt ?? 0)) {
    nanjingCampaign.defenseUpdateAt = time + 3;
    assignNanjingDefense(friendlyForces, time);
    const intruder = enemies.some(actor => actor.health > 0 && !actor.vehicleId &&
      actor.position.y < 2.5 && Math.abs(actor.position.x) < 10 && actor.position.z < 15.2);
    if (intruder) {
      nanjingCampaign.defenseBreachUntil = time + 15;
      nanjingCampaign.defenseEmergencyUntil = time + 15;
    }
    const breached = time < (nanjingCampaign.defenseBreachUntil ?? 0);
    if (nanjingCampaign.gateCaptureSeconds > 0) nanjingCampaign.defenseEmergencyUntil = time + 45;
    nanjingCampaign.defenseSituation = { breached,
      emergency: time < (nanjingCampaign.defenseEmergencyUntil ?? 0) };
    const claimed = [];
    for (const actor of friendlyForces.filter(actor => actor.tactics.nanjingDefense?.role === 'wall' && actor.health > 0)) {
      const duty = actor.tactics.nanjingDefense;
      duty.firePost = null;
      const goal = nanjingDefenseGoal(actor, nanjingCampaign.defenseSituation);
      if (goal.y < 7) continue;
      const threat = enemies.filter(enemy => enemy.health > 0 && !enemy.vehicleId &&
        (breached ? enemy.position.z < 15.2 : enemy.position.z > 21.2))
        .sort((a, b) => actor.position.distanceToSquared(a.position) - actor.position.distanceToSquared(b.position))[0];
      const aim = threat ? targetAimPoint(threat) : new THREE.Vector3(-24, 1, 38);
      const candidates = [0, -.5, -.85, .5].flatMap(dz => [0, -.65, .65, -1.3, 1.3].map(dx =>
        ({ ...goal, x: goal.x + dx, z: goal.z + dz })));
      const post = candidates.find(point =>
        !circleBlocked(point.x, point.z, .46, world.obstacles, point.y) &&
        claimed.every(other => Math.hypot(point.x - other.x, point.z - other.z) > 1.4) &&
        postureFireLine(actor, point, 'standing', aim));
      duty.firePost = { ...(post ?? goal), breached };
      claimed.push(duty.firePost);
    }
  }
  if (nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage) &&
    (time >= (nanjingCampaign.dockDefenseUpdateAt ?? 0) || friendlyForces.some(actor =>
      actor.health > 0 && !actor.playerUnit && !actor.vehicleId && !actor.formation.reserve && !actor.tactics.nanjingDockDefense))) {
    nanjingCampaign.dockDefenseUpdateAt = time + 3;
    assignNanjingDockDefense(friendlyForces, point => Math.abs(world.walkHeight(point.x, point.z, 0)) < .1 &&
      !circleBlocked(point.x, point.z, .5, movementObstacles(point.x, point.z), 0));
  }
  const yaw = controlPose.yaw;
  const objective = objectives.find(p => !p.captured) ?? objectives[0];
  if (time >= assaultAssignmentAt && (!encirclementMode || encirclement.phase === 1)) {
    const assigned = nanjingCampaignMode
      ? formations.filter(formation => formation.team === 'enemy' && !formation.aerialSupport)
      : assignAssaultObjectives(formations, objectives);
    for (const formation of assigned) {
      if (nanjingCampaignMode) formation.objectiveId = nanjingCampaign.dockActivated ? 'dock' : 'gate';
      for (const actor of formation.members) {
        if (actor.health <= 0 || actor.vehicleId) continue;
        if (actor.tactics.cover && coverClaims.get(actor.tactics.cover.id)?.owner === actor.tactics.id) coverClaims.delete(actor.tactics.cover.id);
        pathRequests.delete(actor.tactics.id);
        resetObjectiveMovement(actor, formation.objectiveId);
      }
    }
    assaultAssignmentAt = time + 5;
  }
  actorGrid.rebuild(allForces);
  trafficReservations.clear();
  trafficGrid.rebuild(allForces.map(actor => {
    const previous = actor.tactics.trafficPosition;
    const waypoint = actor.path?.[0], dx = waypoint ? waypoint.x - actor.position.x : 0,
      dz = waypoint ? waypoint.z - actor.position.z : 0, length = Math.hypot(dx, dz);
    const snapshot = { id: actor.id, formationId: actor.formation.id, friendly: actor.friendly,
      health: actor.health, vehicleId: actor.vehicleId,
      position: { x: actor.position.x, y: actor.position.y, z: actor.position.z }, heading: actor.heading,
      tactics: { id: actor.tactics.id }, locomotion: { speed: actor.locomotion.speed },
      velocity: previous && dt > 0 ? { x: (actor.position.x - previous.x) / dt, z: (actor.position.z - previous.z) / dt } : { x: 0, z: 0 },
      intent: length > .01 ? { x: dx / length, z: dz / length } : null };
    actor.tactics.trafficPosition = { x: actor.position.x, z: actor.position.z };
    return snapshot;
  }));
  aiDecisionView.update();
  aiDecisions.beginStep(time,
    actor => aiDecisionPriority(actor.position, camera.position, aiDecisionView.intersects(actor.position, 2)),
    (actor, kind) => {
      if (actor.health <= 0 || actor === player || actor.vehicleId ||
        actor.traversal.kind !== 'grounded' || actor.grenades.action) return false;
      if (kind === 'path') return pathRequests.has(actor.tactics.id);
      if (kind === 'sensor') return time >= actor.nextThink;
      if (kind === 'cover') return actor.tactics.lastSeen && time >= actor.tactics.decisionAt;
      return actor.nativeMotion && actor.tactics.lastSeen &&
        (actor.tactics.postureNeedsChoice || time >= (actor.tactics.postureDecisionAt ?? 0));
    }, (actor, kind) => adaptiveAI.intervalFor(kind, actor.position, camera.position,
      aiDecisionView.intersects(actor.position, 2), actor.target?.id === entities.control.soldierId,
      { idle: idleAIForReduction(actor, time), emergencyLevel: automaticQuality.snapshot.level }));
  let completedPaths = 0;
  for (const [id, request] of pathRequests) {
    if (request.actor.health <= 0 || request.actor === player || request.actor.vehicleId) {
      pathRequests.delete(id);
      continue;
    }
    if (request.actor.traversal.kind !== 'grounded' || request.actor.grenades.action ||
      !aiDecisions.take('path', request.actor)) continue;
    pathRequests.delete(id);
    const pathStarted = performance.now();
    const dockLimited = nanjingDockMovementLimited(request.actor.position);
    const planner = dockLimited ? dockNavigate : navigate;
    if (dockLimited) request.target = nanjingDockOutsideGoal(request.target, .6);
    const actor = request.actor, target = request.target;
    const bridgeApproach = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      actor.friendly && !actor.playerUnit && target.transit && !target.assembly && !target.parade &&
      Math.abs(actor.position.y) < .05 &&
      Math.hypot(actor.position.x - SIHANG_BRIDGE.northX, actor.position.z - SIHANG_BRIDGE.northZ) < 14 &&
      Math.abs(sihangBridgeCoordinates(target).along + SIHANG_BRIDGE.length * .2) < .1;
    const blockingTank = bridgeApproach && [...entities.vehicles.values()].find(vehicle =>
      vehicle.type === 'tank' &&
      circleBlocked(target.x, target.z, .46, [vehicleCollider(vehicle)], actor.position.y));
    const clearBridgePoint = point => !infantryNavigationBlocked(point, actor.position, .46, actor) &&
      Math.abs(world.walkHeight(point.x, point.z, actor.position.y) - actor.position.y) <= .3;
    const bypass = blockingTank ? sihangRetreatVehicleBypass(actor.position, vehicleCollider(blockingTank),
      clearBridgePoint, (start, end) => sampledRouteClear(start, end, (x, z) => clearBridgePoint({ x, z }))) : [];
    request.actor.path = bypass.length ? bypass : squadRoutes.find(request.actor, request.target, time,
      () => {
        const bridgeWorkRoute = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
          actor.friendly && !actor.playerUnit && target.transit && !target.assembly && !target.parade
          ? sihangBridgeWorkRoute(actor, target) : [];
        return bridgeWorkRoute.length ? bridgeWorkRoute :
          world.elevatedPath?.(request.actor.position, request.target, request.actor.tactics.preferredStair) ??
          multistoryPath(request.actor.position, request.target, world.town.buildings, planner);
      },
      (start, goal) => {
        const path = connectSquadRoute(start, goal);
        return !dockLimited || nanjingDockPathClear(start, path) ? path : [];
      });
    request.actor.tactics.pathReason = request.actor.path.length ? 'ready' : planner.stats.reason;
    const pathWorkMs = performance.now() - pathStarted;
    aiDecisions.recordPathWork(pathWorkMs);
    if (benchmark) telemetry.add('pathMs', pathWorkMs);
    request.actor.pathGoal = request.target;
    request.actor.nextPath = time + (request.actor.path.length ? 1.8 : 3);
    request.actor.stuckTime = 0;
    completedPaths++;
  }
  if (benchmark) telemetry.add('pathsServiced', completedPaths);
  const armor = [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'tank' && vehicle.health > 0);
  const constructionBuilders = friendlyForces.filter(actor => actor.health > 0 && !actor.vehicleId &&
    actor.engineer?.construction.mode === 'building' && actor.engineer.construction.site);
  const escortClaims = new Map();
  for (const actor of allies) {
    if (!actor.orderTarget) continue;
    const order = actor.orderTarget;
    const target = order.kind === 'armor' ? entities.vehicles.get(order.id) : entities.soldiers.get(order.id);
    if (!target || target.health <= 0 || target.team === actor.team ||
      order.kind === 'person' && target.vehicleId) {
      actor.orderTarget = null;
      const intent = actor.tactics.throwIntent;
      if (intent && aiThrowReservations.get(intent.key)?.actorId === actor.id)
        aiThrowReservations.delete(intent.key);
      actor.tactics.throwIntent = actor.tactics.packApproach = null;
    }
  }
  for (const actor of allForces) {
    const escort = actor.tactics.armorEscort;
    if (actor.health > 0 && escort) escortClaims.set(`${escort.vehicleId}:${escort.slot}`, actor.id);
  }
  for (let index = 0; index < allForces.length; index++) {
    const actor = allForces[(index + aiCursor) % allForces.length];
    if (actor.discharger) actor.discharger.presentationActive = false;
    if (actor.health <= 0) continue;
    if (actor.blastReaction || actor.dying) {
      actor.rifleReady = false; actor.aimWalking = false;
      stopLocomotion(actor.locomotion); resetAIRifleAim(actor.aiRifle, 'blast-recovery');
      continue;
    }
    if (actor === player) {
      actor.aimPitch = 0;
      actor.tactics.traffic = actor.tactics.followGuard = null;
      resetAIRifleAim(actor.aiRifle, 'controlled'); continue;
    }
    if (sihangCampaignMode && sihangCampaign.stage === 'sihang-defense' && actor.tactics.sihangDemolitionReturned) {
      stopLocomotion(actor.locomotion); actor.rifleReady = false; actor.path = [];
      actor.tactics.mode = 'sihang-demolition-returned';
      continue;
    }
    if (sihangCampaignMode && actor.sihangEvacuated && actor.sihangParadeGoal) {
      actor.target = null; actor.rifleReady = false; actor.stance = 'standing'; actor.firingPose = null;
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'evacuated');
      if (actor.sihangFadeAt !== undefined) {
        stopLocomotion(actor.locomotion);
        actor.path = []; actor.pathGoal = actor.tactics.traffic = null;
        pathRequests.delete(actor.tactics.id);
        actor.tactics.mode = 'sihang-parade-exit';
        continue;
      }
      walkActor(actor, actor.sihangParadeGoal, 2.2, dt, false);
      actor.tactics.mode = 'sihang-parade';
      continue;
    }
    const withdrawalWave = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat'
      ? sihangCampaign.withdrawalWave : null;
    const waveCover = sihangWaveCover(actor);
    if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' && actor.friendly &&
      !sihangAssemblyFocusAvailable(actor) &&
      (!sihangCampaign.assemblyReleased || !actor.playerUnit && !waveCover &&
        (!actor.formation.retreatAssembled || !withdrawalWave || withdrawalWave.phase === 'interval' ||
          !withdrawalWave.squads[actor.formation.sihangSlot]?.includes(actor.id)))) {
      if (actor.engineer && (actor.engineer.construction.mode === 'building' || actor.engineer.site))
        cancelEngineer(actor.engineer);
      if (clearSihangConstruction(actor, constructionBuilders, dt)) continue;
      const goal = sihangActorAssemblyGoal(actor);
      actor.target = null; actor.rifleReady = false; actor.firingPose = null;
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'assembly');
      if (Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) > SIHANG_ASSEMBLY_ARRIVAL || Math.abs(actor.position.y) > .3) {
        actor.stance = 'standing';
        const retryAssembly = actor.sihangAssemblyRoute && actor.tactics.traffic?.waitSeconds > 2.5 &&
          time >= (actor.sihangAssemblyRetryAt ?? 0);
        if ((!actor.sihangAssemblyRoute || retryAssembly) && actor.position.y < .3 &&
          actor.position.z > -7.3 && actor.position.x < SIHANG_ASSEMBLY_APPROACH_MAX_X) {
          actor.sihangAssemblyRoute = sihangAssemblyApproach(actor.position, goal,
            player?.health > 0 && Math.abs(player.position.y) < .3 ? [player.position] : []);
          if (retryAssembly) actor.sihangAssemblyRetryAt = time + 5;
        }
        const route = actor.sihangAssemblyRoute;
        while (route?.length > 1 && Math.hypot(actor.position.x - route[0].x, actor.position.z - route[0].z) < SIHANG_ASSEMBLY_ARRIVAL)
          route.shift();
        walkActor(actor, route?.[0] ?? goal, 3.5, dt, true, true);
      } else {
        actor.path = [];
        pathRequests.delete(actor.tactics.id);
        actor.tactics.traffic = null;
        actor.turningThisStep = actor.turningToPath = false;
        stopLocomotion(actor.locomotion); actor.stance = 'crouched';
        advanceAITurn(actor, -Math.PI / 2, dt);
      }
      actor.tactics.mode = 'sihang-assembly';
      continue;
    }
    if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      actor.playerUnit && player?.sihangEvacuated) {
      if (clearSihangConstruction(actor, constructionBuilders, dt)) continue;
      actor.target = null; actor.rifleReady = false; actor.stance = 'standing'; actor.firingPose = null;
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'leader-evacuated');
      walkActor(actor, sihangRetreatGoal(actor), 3, dt, false);
      actor.tactics.mode = 'sihang-follow-withdrawal';
      continue;
    }
    const sihangRegroup = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      !actor.vehicleId && !actor.friendly && !sihangCampaign.counterattack;
    if (!(sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat') &&
      operateAIEngineer(actor, dt)) continue;
    if (operateAIEmplacement(actor, dt)) continue;
    if (actor.traversal.kind !== 'grounded') {
      cancelAIMelee(actor);
      actor.tactics.traffic = actor.tactics.followGuard = null;
      resetAIRifleAim(actor.aiRifle, 'traversing');
      actor.rifleReady = false;
      continue;
    }
    actor.locomotion.speed = 0; actor.locomotion.sprinting = false; actor.locomotion.mode = 'idle';
    actor.shoulderAiming = false;
    actor.aimWalking = false; actor.automaticFireMoving = false;
    actor.rifleReady = false; actor.turningThisStep = false;
    const tactics = actor.tactics, previousCover = tactics.cover;
    if (finalNanjingWithdrawal && actor.friendly && (!actor.playerUnit || nanjingPlayerFerry()) && !actor.vehicleId && !actor.grenades.action) {
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'embarking');
      if (tactics.cover) coverClaims.delete(tactics.cover.id);
      tactics.cover = tactics.lastSeen = actor.target = null;
      actor.stance = 'standing'; actor.firingPose = null; tactics.mode = 'embarking';
      const ferryState = tactics.nanjingFerry;
      if (ferryState) {
        actor.locomotion.speed = ferryState.speed;
        if (ferryState.phase === 'aboard') actor.stance = 'crouched';
      } else {
        const goal = nanjingBoardingGoal(actor);
        walkActor(actor, { ...goal, y: world.groundHeight(goal.x, goal.z) }, 3.5, dt);
      }
      continue;
    }
    if (encirclementMode && encirclement.phase === 2 &&
      encirclement.breakout?.stage !== 'breakout' && !actor.vehicleId) {
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'east-gate-assembly');
      if (tactics.cover) coverClaims.delete(tactics.cover.id);
      tactics.cover = null; actor.target = null; tactics.lastSeen = null;
      actor.stance = 'standing'; actor.firingPose = null;
      tactics.mode = actor.friendly ? 'east-gate-defense-assembly' : 'east-breakout-assembly';
      const goal = breakoutDestination(actor);
      if (Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) > .6) walkActor(actor, goal, 3.5, dt);
      continue;
    }
    if (nanjingCampaignMode && !actor.friendly && !actor.vehicleId &&
      nanjingCampaign.stage === 'gate-defense' && time < 46 &&
      [1, 2].includes(actor.formation.index) && actor.index % 11 < 2 &&
      !friendlyForces.some(friend => friend.health > 0 && friend.position.distanceTo(actor.position) < 22)) {
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'waiting-for-stragglers');
      tactics.mode = 'bridge-rearguard';
      const post = { x: -24 + (actor.index % 11 ? 1.5 : -1.5), y: 0, z: 79 + actor.formation.index * 1.6 };
      if (actor.position.distanceTo(post) > .7) walkActor(actor, post, 3, dt);
      else advanceAITurn(actor, 0, dt);
      continue;
    }
    if (nanjingCampaignMode && !actor.friendly && nanjingCampaign.stage === 'withdrawal') {
      if (!actor.vehicleId) {
        const post = tactics.nanjingRegroup;
        if (post && Math.hypot(actor.position.x - post.x, actor.position.z - post.z) > .65) {
          cancelAIMelee(actor);
          resetAIRifleAim(actor.aiRifle, 'gate-regroup');
          actor.target = null;
          actor.stance = 'standing'; actor.firingPose = null;
          tactics.mode = 'gate-regroup';
          const exit = actor.position.y > .025 ? nanjingWallExitWaypoint(actor.position) : null;
          if (exit) {
            const dx = exit.x - actor.position.x, dz = exit.z - actor.position.z;
            const distance = Math.hypot(dx, dz), step = Math.min(distance, dt * 3);
            world.moveInfantry(actor.position, dx / Math.max(distance, .001) * step,
              dz / Math.max(distance, .001) * step, .42, infantryMovementObstacles(actor, actor.position.x, actor.position.z));
          } else walkActor(actor, actor.position.z > 38.8 ? { x: -24, z: 38 } : post, 3, dt);
          continue;
        }
      }
    }
    const playerOrderGoal = actor.playerUnit
      ? actor.order === 'follow' ? player.position
        : actor.order === 'hold' ? actor.orderPoint : formationObjective(actor, objective)
      : null;
    const descendingToOrder = actor.playerUnit && playerOrderGoal &&
      (playerOrderGoal.y ?? 0) <= world.groundHeight(playerOrderGoal.x, playerOrderGoal.z) + .24;
    if (nanjingCampaignMode && actor.friendly && !actor.vehicleId && !actor.grenades.action &&
      (descendingToOrder || !actor.playerUnit && actor.formation.objectiveId === 'dock')) {
      const waypoint = nanjingWallExitWaypoint(actor.position);
      if (waypoint) {
        cancelAIMelee(actor);
        resetAIRifleAim(actor.aiRifle, 'withdrawal-wall');
        actor.path = actor.pathGoal = actor.target = null;
        pathRequests.delete(tactics.id);
        actor.stance = 'standing'; actor.firingPose = null;
        tactics.mode = actor.playerUnit ? 'order-descend-wall' : 'withdrawal-wall';
        const dx = waypoint.x - actor.position.x, dz = waypoint.z - actor.position.z;
        const distance = Math.hypot(dx, dz);
        const turn = advanceAITurn(actor, Math.atan2(-dx, -dz), dt, true);
        if (distance > .01 && turn.mayMove && postureReady(actor)) {
          const beforeX = actor.position.x, beforeZ = actor.position.z;
          const step = Math.min(distance, FOOT_SPEEDS[actor.groundType].jog * dt);
          world.moveInfantry(actor.position, dx / distance * step, dz / distance * step,
            .42, infantryMovementObstacles(actor, actor.position.x, actor.position.z));
          actor.locomotion.speed = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ) / dt;
          actor.locomotion.mode = actor.locomotion.speed > .06 ? 'jog' : 'idle';
          actor.walkPhase += actor.locomotion.speed * dt * 2.5;
          actor.walkPoseReady = actor.locomotion.speed > .06;
        }
        continue;
      }
    }
    const regrouping = nanjingCampaignMode && actor.friendly && !actor.vehicleId &&
      !actor.grenades.action && (
        actor.playerUnit && actor.order === 'follow' && actor.position.distanceTo(player.position) > 18 ||
        !actor.playerUnit && actor.formation.objectiveId === 'dock' &&
          Math.hypot(actor.position.x - NANJING_DOCK.x, actor.position.z - NANJING_DOCK.z) > 17);
    if (regrouping) {
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'withdrawal-regroup');
      if (tactics.cover) coverClaims.delete(tactics.cover.id);
      tactics.cover = null; tactics.lastSeen = null; actor.target = null;
      actor.stance = 'standing'; actor.firingPose = null;
      tactics.mode = 'follow';
      const goal = actor.playerUnit ? { ...player.position, transit: true } : {
        x: NANJING_DOCK.x + 5, y: world.groundHeight(NANJING_DOCK.x + 5, NANJING_DOCK.z + 5),
        z: NANJING_DOCK.z + 5, transit: true };
      walkActor(actor, goal, 3.5, dt);
      continue;
    }
    if (actor.order !== 'follow' || tactics.lastSeen) tactics.followGuard = null;
    if (expireThreat(tactics, time)) {
      actor.target = null;
      actor.path = actor.pathGoal = null;
      pathRequests.delete(tactics.id);
      tactics.coverMoveUntil = 0;
      tactics.shotMoveGoal = null; tactics.shotMovePending = false; tactics.wallContact = null;
      if (previousCover) coverClaims.delete(previousCover.id);
    }
    if (actor.vehicleId) {
      tactics.traffic = tactics.followGuard = null;
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'seated'); continue;
    }
    const dodge = actor.formation.sihangDemolition ? null : chooseTankEvasion(actor, armor, {
      visible: tank => {
        const eye = soldierEyePosition(actor);
        return hasLine(new THREE.Vector3(eye.x, eye.y, eye.z),
          tank.position.clone().add(new THREE.Vector3(0, .8, 0)), 20, tank.id);
      },
      clear: (from, to) => segmentClear(from, to, .42, world.obstacles,
        movementObstacles, from.y),
    });
    if (dodge) {
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'moving');
      if (tactics.cover) coverClaims.delete(tactics.cover.id);
      tactics.cover = tactics.armorEscort = null;
      actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
      const position = actor.position, dx = dodge.x - position.x, dz = dodge.z - position.z;
      const distance = Math.max(.001, Math.hypot(dx, dz));
      const beforeX = position.x, beforeZ = position.z;
      actor.stance = 'standing'; actor.firingPose = null;
      tactics.mode = 'evade-tank'; tactics.evadingTankId = dodge.vehicleId;
      advanceAITurn(actor, Math.atan2(-dx, -dz), dt, true);
      (sihangCampaignMode || nanjingDockMovementLimited(position) ? moveInfantry : world.moveInfantry)(position, dx / distance * Math.min(distance, 3.15 * dt),
        dz / distance * Math.min(distance, 3.15 * dt), .42, movementObstacles(position.x, position.z));
      settleActorSupport(actor);
      actor.locomotion.speed = Math.hypot(position.x - beforeX, position.z - beforeZ) / dt;
      actor.locomotion.mode = actor.locomotion.speed > .06 ? 'jog' : 'idle';
      actor.walkPhase += actor.locomotion.speed * dt * 2.5;
      actor.walkPoseReady = actor.locomotion.speed > .06;
      continue;
    }
    tactics.evadingTankId = null;
    if (actor.grenades.action) {
      cancelAIMelee(actor);
      const action = actor.grenades.action;
      actor.tactics.mode = action.kind === 'explosive-pack' ? 'throw-explosive-pack' : 'throw-grenade';
      resetAIRifleAim(actor.aiRifle, 'throwable');
      continue;
    }
    const dangers = grenades.active.filter(grenade => grenade.phase === 'flight' && grenade.detonateAt > time &&
      grenadeCanDamage(grenade.source, actor, grenade.kind) &&
      Math.hypot(grenade.position.x - actor.position.x, grenade.position.z - actor.position.z,
        grenade.position.y - actor.position.y) < throwableProfile(grenade.kind).radius).sort((a, b) => a.detonateAt - b.detonateAt);
    if (dangers.length && !actor.formation.sihangDemolition) {
      const eye = soldierEyePosition(actor), origin = new THREE.Vector3(eye.x, eye.y, eye.z);
      const danger = dangers.find(grenade => hasLine(origin,
        new THREE.Vector3(grenade.position.x, grenade.position.y + .08, grenade.position.z), throwableProfile(grenade.kind).radius + 3));
      if (danger) {
        cancelAIMelee(actor);
        resetAIRifleAim(actor.aiRifle, 'moving');
        const distance = Math.hypot(actor.position.x - danger.position.x, actor.position.z - danger.position.z);
        const dx = distance > .01 ? actor.position.x - danger.position.x : Math.sin(actor.tactics.id);
        const dz = distance > .01 ? actor.position.z - danger.position.z : Math.cos(actor.tactics.id);
        const length = Math.hypot(dx, dz);
        actor.stance = 'standing'; actor.firingPose = null; actor.tactics.mode = 'evade-grenade';
        const beforeX = actor.position.x, beforeZ = actor.position.z;
        const turn = advanceAITurn(actor, Math.atan2(-dx, -dz), dt, true);
        if (turn.mayMove && postureReady(actor)) moveInfantry(actor.position,
          dx / length * dt * FOOT_SPEEDS[actor.groundType].jog, dz / length * dt * FOOT_SPEEDS[actor.groundType].jog, .42,
          infantryMovementObstacles(actor, actor.position.x, actor.position.z));
        settleActorSupport(actor);
        actor.locomotion.speed = Math.hypot(actor.position.x - beforeX, actor.position.z - beforeZ) / dt;
        actor.locomotion.mode = actor.locomotion.speed > .06 ? 'jog' : 'idle';
        actor.walkPhase += actor.locomotion.speed * dt * 2.5;
        actor.walkPoseReady = actor.locomotion.speed > .06;
        continue;
      }
    }
    if (actor.nativeMotion && !tactics.lastSeen && actor.firingPose && tactics.mode !== 'guard') { actor.stance = 'standing'; actor.firingPose = null; }
    const position = actor.position;
    settleActorSupport(actor);
    if (actor.traversal.kind !== 'grounded') continue;
    const escape = position.y < 1 ? world.doorSystem.swingEscape(position) : null;
    if (escape) {
      cancelAIMelee(actor);
      const dx = escape.x - position.x, dz = escape.z - position.z, distance = Math.max(.01, Math.hypot(dx, dz));
      moveInfantry(position, dx / distance * Math.min(distance, dt * 2), dz / distance * Math.min(distance, dt * 2), .42, infantryMovementObstacles(actor, position.x, position.z));
      settleActorSupport(actor);
      tactics.mode = 'yield-door'; tactics.blockedBy = 'door';
      resetAIRifleAim(actor.aiRifle, 'moving');
      continue;
    }
    const gateDefender = nanjingCampaignMode && actor.friendly && !actor.playerUnit &&
      nanjingCampaign.stage === 'gate-defense';
    const coveringSappers = Boolean(sihangSupportContext && !sihangCampaign.northWallBreached &&
      !actor.friendly && !actor.formation.sihangDemolition);
    const supportGoal = coveringSappers ? sihangSupportGoal(actor) ??
      { ...actor.spawnPosition, y: 0, transit: true } : null;
    if (!sihangRegroup && operateAIDischarger(actor, dt)) continue;
    const eye = actor.nativeMotion ? soldierEyePosition(actor) : { x: position.x, y: position.y + 1.45, z: position.z };
    const from = new THREE.Vector3(eye.x, eye.y, eye.z);
    const directedPerson = actor.orderTarget?.kind === 'person'
      ? entities.soldiers.get(actor.orderTarget.id) : null;
    if (directedPerson?.health > 0 && directedPerson.friendly !== actor.friendly &&
      !directedPerson.vehicleId && (!sihangCampaignMode ||
        sihangNightVisibility(sihangCampaign, position, directedPerson.position))) {
      const aim = targetAimPoint(directedPerson), distance = from.distanceTo(aim);
      const heading = Math.atan2(position.x - aim.x, position.z - aim.z);
      if (distance >= 9 && distance < 75 && Math.cos(heading - actor.heading) <= .25 &&
        time >= tactics.suppressedUntil && visibleTargetPoint(directedPerson, point => hasLine(from, point, 75))) {
        cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'ordered-turn');
        stopLocomotion(actor.locomotion);
        advanceAITurn(actor, heading, dt);
        continue;
      }
    }
    if (time >= actor.nextThink && aiDecisions.take('sensor', actor)) {
      const sensingStarted = benchmark ? performance.now() : 0;
      actor.nextThink = time + .6 + battleRandom() * .2;
      const candidates = actorGrid.near(position.x, position.z, 75)
        .filter(candidate => {
          if (candidate.friendly === actor.friendly || candidate.health <= 0) return false;
          if (sihangCampaignMode && !actor.friendly && !sihangEnemyTargetAllowed(candidate)) return false;
          if (sihangCampaignMode && !sihangNightVisibility(sihangCampaign, position, candidate.position)) return false;
          if (!canRiflemanTrackTarget(candidate.targetKind)) {
            combatStats.rifleAircraftCandidatesIgnored++;
            return false;
          }
          return true;
        })
        .sort((a, b) => (actor.friendly ? 0 : fireSupportPriority(a) - fireSupportPriority(b)) ||
          position.distanceToSquared(a.position) - position.distanceToSquared(b.position)).slice(0, 8);
      let closest = 75, closestObservation = null;
      let bestPriority = Infinity;
      actor.target = null;
      for (const candidate of candidates) {
        if (candidate.health <= 0) continue;
        const to = targetAimPoint(candidate);
        const distance = from.distanceTo(to);
        const angle = Math.atan2(position.x - to.x, position.z - to.z);
        const rampartSentry = gateDefender && position.y > 7;
        const coveringRetreat = encirclementMode && encirclement.phase === 2 &&
          encirclement.breakout?.stage === 'breakout' && !actor.friendly &&
          candidate.id === tactics.threatId && Boolean(tactics.lastSeen);
        const inView = rampartSentry || distance < 9 || Math.cos(angle - actor.heading) > .25 ||
          time < tactics.suppressedUntil || coveringRetreat;
        const armorCandidate = candidate.targetKind === 'closed-armor' && actor.grenades.packs > 0;
        const priority = actor.friendly ? 1 : fireSupportPriority(candidate);
        const better = distance < 75 && (priority < bestPriority || priority === bestPriority && distance < closest);
        if (inView && (better || armorCandidate)) {
          const observed = visibleTargetPoint(candidate, point => hasLine(from, point, 75, candidate.vehicleId));
          if (candidate.id === tactics.threatId) tactics.lastSightCheck = { time, targetId: candidate.id, visible: Boolean(observed) };
          if (observed) {
            if (armorCandidate) tactics.seenArmor = { vehicleId: candidate.vehicleId, time };
            if (better) {
              bestPriority = priority;
              closest = from.distanceTo(observed);
              closestObservation = observed;
              actor.target = candidate;
            }
          }
        }
      }
      const orderedPerson = actor.orderTarget?.kind === 'person'
        ? entities.soldiers.get(actor.orderTarget.id) : null;
      if (orderedPerson?.health > 0 && orderedPerson.friendly !== actor.friendly &&
        !orderedPerson.vehicleId && (!sihangCampaignMode ||
          sihangNightVisibility(sihangCampaign, position, orderedPerson.position))) {
        const aim = targetAimPoint(orderedPerson), distance = from.distanceTo(aim);
        const angle = Math.atan2(position.x - aim.x, position.z - aim.z);
        const inView = distance < 9 || Math.cos(angle - actor.heading) > .25 || time < tactics.suppressedUntil;
        const observed = inView ? visibleTargetPoint(orderedPerson, point => hasLine(from, point, 75)) : null;
        if (observed) {
          actor.target = orderedPerson;
          closestObservation = observed;
        }
      }
      if (actor.target) {
        rememberThreat(tactics, closestObservation, time, actor.target.targetKind, 'vision', actor.target.id);
        if (sihangCampaignMode) activateSihangWaveCover(actor);
        if (actor.target.targetKind === 'closed-armor') combatStats.armorThreatsObserved++;
      } else {
        for (const heard of [...combatSounds].reverse()) {
          if (heard.friendly === actor.friendly || time - heard.time > 2 || heard.id <= (tactics.lastSound || 0)) continue;
          if (sihangCampaignMode && !actor.friendly && sihangProtectedSouthBank(heard)) continue;
          const audible = hasLine(from, new THREE.Vector3(heard.x, heard.y, heard.z), 90) ? heard.radius : heard.radius * .45;
          if (Math.hypot(heard.x - position.x, heard.z - position.z) < audible) {
            tactics.lastSound = heard.id;
            rememberThreat(tactics, { x: heard.x + Math.sin(tactics.id) * 2, y: heard.y, z: heard.z + Math.cos(tactics.id) * 2 }, time, 'person', 'sound');
            break;
          }
        }
      }
      if (benchmark) telemetry.add('sensingMs', performance.now() - sensingStarted);
    }
    const regroupGuard = nanjingCampaignMode && !actor.friendly && nanjingCampaign.stage === 'withdrawal';
    const civilianPursuit = nanjingCampaignMode && !actor.friendly ? nanjingCivilianPursuitTarget(actor) : null;
    const target = actor.target?.health > 0 && (!sihangCampaignMode ||
      sihangNightVisibility(sihangCampaign, position, actor.target.position) &&
      (actor.friendly || sihangEnemyTargetAllowed(actor.target))) &&
      !(civilianPursuit && civilianEngagementPreferred(actor,actor.target,
        {position:civilianPursuit.getWorldPosition(new THREE.Vector3())})) &&
      (!regroupGuard || actor.target.position.z > -12 &&
        Math.hypot(actor.target.position.x, actor.target.position.z - 27) < 40) ? actor.target : null;
    if (sihangRegroup) {
      if (actor.discharger) stowGrenadeDischarger(actor.discharger);
      cancelAIMelee(actor);
      const observed = target && tactics.threatSense === 'vision' && tactics.threatId === target.id &&
        observeVisualThreat(tactics, target, time, point => hasLine(from, point, 75, target.vehicleId));
      if (observed && actor.hasFirearm !== false) {
        actor.path = []; actor.pathGoal = null; pathRequests.delete(tactics.id);
        stopLocomotion(actor.locomotion);
        tactics.mode = 'sihang-regroup-defense';
        updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
        fightFromCover(actor, target, dt, null, true);
      } else {
        actor.target = null; tactics.lastSeen = null; actor.rifleReady = false;
        resetAIRifleAim(actor.aiRifle, 'night-regroup');
        const post = sihangEnemyPosts[actor.formation.index * SIHANG_RULES.squadMembers + actor.index];
        if (!post) throw new Error('四行仓库日军缺少整顿位置');
        if (Math.hypot(position.x - post.x, position.z - post.z) > .65 || Math.abs(position.y) > .3) {
          actor.stance = 'standing'; actor.firingPose = null;
          walkActor(actor, post, 3.5, dt, true);
        } else {
          stopLocomotion(actor.locomotion);
          actor.stance = 'crouched'; actor.firingPose = 'crouched';
          advanceAITurn(actor, Math.PI, dt);
        }
        tactics.mode = 'sihang-regroup';
      }
      settleActorSupport(actor);
      continue;
    }
    const retreatObservedTarget = actor.friendly && sihangCampaignMode &&
      sihangCampaign.stage === 'sihang-retreat' && tactics.threatSense === 'vision'
      ? entities.soldiers.get(tactics.threatId) : null;
    let retreatTarget = target ?? (retreatObservedTarget?.health > 0 &&
      retreatObservedTarget.friendly !== actor.friendly && !retreatObservedTarget.vehicleId &&
      sihangNightVisibility(sihangCampaign, position, retreatObservedTarget.position) &&
      observeVisualThreat(tactics, retreatObservedTarget, time,
        point => hasLine(from, point, 75, retreatObservedTarget.vehicleId))
      ? retreatObservedTarget : null);
    if (actor.friendly && sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      actor.dadao && actor.dadao.startedAt !== null) {
      const swingTarget = entities.soldiers.get(actor.dadao.targetId);
      const distance = dadaoCombatDistance(actor, swingTarget);
      if (distance !== null && distance <= meleeEngagementRange(actor, swingTarget) &&
        sihangNightVisibility(sihangCampaign, position, swingTarget.position) &&
        observeVisualThreat(tactics, swingTarget, time, point => hasLine(from, point, 75))) {
        retreatTarget = swingTarget;
      } else cancelAIMelee(actor);
    }
    if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
      operateAIEngineer(actor, dt, target)) continue;
    if (actor.orderTarget) {
      const order = actor.orderTarget;
      const ordered = order.kind === 'armor' ? entities.vehicles.get(order.id) : entities.soldiers.get(order.id);
      if (!ordered || ordered.health <= 0 || ordered.team === actor.team ||
        order.kind === 'person' && ordered.vehicleId) {
        actor.orderTarget = null;
      } else if (!sihangCeasefire(actor)) {
        if (order.kind === 'armor' && (!sihangCampaignMode ||
          sihangNightVisibility(sihangCampaign, position, ordered.position)) &&
          tryAIThrowable(actor, null, dt, order.id)) {
          settleActorSupport(actor);
          continue;
        }
        if (order.kind === 'armor' && actor.grenades.packs > 0) {
          const range = Math.hypot(position.x - ordered.position.x, position.z - ordered.position.z);
          const sameLevel = Math.abs(position.y - ordered.position.y) <= 1;
          const visible = (!sihangCampaignMode || sihangNightVisibility(sihangCampaign, position, ordered.position)) &&
            hasLine(from, new THREE.Vector3(ordered.position.x, ordered.position.y + 1, ordered.position.z), 75, ordered.id);
          if (range > 30 && range < 75 && sameLevel && visible) {
            const angle = Math.atan2(position.z - ordered.position.z, position.x - ordered.position.x);
            const goal = [0, .45, -.45, .9, -.9].map(offset => ({
              x: ordered.position.x + Math.cos(angle + offset) * 27,
              y: position.y, z: ordered.position.z + Math.sin(angle + offset) * 27,
            })).find(point => Math.abs(world.walkHeight(point.x, point.z, position.y) - position.y) < .3 &&
              !circleBlocked(point.x, point.z, .43, movementObstacles(point.x, point.z), position.y));
            if (goal) {
              cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'ordered-armor-approach');
              tactics.mode = 'approach-armor-pack';
              actor.stance = 'standing'; actor.firingPose = null; actor.rifleReady = false;
              walkActor(actor, goal, 3.15, dt, true);
              settleActorSupport(actor);
              continue;
            }
          }
        }
        if (order.kind === 'person' && target === ordered && actor.hasFirearm !== false &&
          observeVisualThreat(tactics, ordered, time, point => hasLine(from, point, 75))) {
          updateInfantryAimPitch(actor, targetAimPoint(ordered), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, ordered, dt, null, true);
          settleActorSupport(actor);
          continue;
        }
      }
    }
    // Visible close threats take precedence over scripted rifle/guard posts.
    // tryAIMelee retains weapon eligibility, floor, sight, clearance and ceasefire checks.
    if (!actor.friendly && tryAIMelee(actor, target, dt)) { settleActorSupport(actor); continue; }
    if (coveringSappers && (!sihangOutsideCover(position, sihangSupportContext) ||
      Math.hypot(position.x - supportGoal.x, position.z - supportGoal.z) > .6)) {
      if (actor.discharger) stowGrenadeDischarger(actor.discharger);
      cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'support-reposition');
      tactics.mode = 'sihang-support-position';
      walkActor(actor, supportGoal, 3, dt); settleActorSupport(actor);
      continue;
    }
    if (regroupGuard) {
      tactics.mode = 'gate-guard';
      actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
      if (target && tactics.lastSeen) {
        updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
        fightFromCover(actor, target, dt, null, true);
      } else {
        cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'gate-guard');
        advanceAITurn(actor, 0, dt);
        actor.stance = 'crouched'; actor.firingPose = 'crouched';
      }
      continue;
    }
    if (sihangCampaignMode) {
      if (coveringSappers) {
        cancelAIMelee(actor); stopLocomotion(actor.locomotion);
        tactics.mode = 'sihang-cover-fire';
        if (target && !sihangCeasefire(actor)) {
          updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, target, dt, null, true);
        } else {
          resetAIRifleAim(actor.aiRifle, 'support-watch');
          actor.stance = 'crouched'; actor.firingPose = 'kneeling';
          advanceAITurn(actor, Math.atan2(position.x - SIHANG_WAREHOUSE.x,
            position.z - SIHANG_WAREHOUSE.minZ), dt);
        }
        settleActorSupport(actor);
        continue;
      }
      const demolitionGoal = sihangCombat.goalFor(actor, sihangCampaign);
      const withdrawing = actor.friendly && sihangCampaign.stage === 'sihang-retreat';
      const defending = actor.friendly && !actor.playerUnit && sihangCampaign.stage === 'sihang-defense';
      const pursuingRetreat = !actor.friendly && sihangCampaign.stage === 'sihang-retreat';
      const trafficYield = withdrawing ? sihangTrafficYield(actor, player, withdrawalWave, waveCover) : null;
      const retreatContact = withdrawing && retreatTarget &&
        tactics.threatSense === 'vision' && tactics.threatId === retreatTarget.id &&
        Math.hypot(position.x - retreatTarget.position.x, position.z - retreatTarget.position.z) <= 12 &&
        !sihangCeasefire(actor);
      if (retreatContact && actor.target !== retreatTarget) actor.target = retreatTarget;
      let retreatContactState = tactics.sihangRetreatContact;
      const previousContactActive = withdrawing && (retreatContactState || tactics.sihangRetreatContacts?.size) &&
        actorGrid.near(position.x, position.z, 12).some(other => other !== actor &&
          other.friendly !== actor.friendly && other.health > 0 && !other.vehicleId &&
          Math.hypot(position.x - other.position.x, position.z - other.position.z) <= 12) &&
        !sihangCeasefire(actor);
      if (!retreatContact && !previousContactActive) {
        retreatContactState = tactics.sihangRetreatContact = null;
        tactics.sihangRetreatContacts = null;
      } else if (retreatContact && retreatContactState?.targetId !== retreatTarget.id) {
        if (retreatContactState) {
          tactics.sihangRetreatContacts ??= new Map();
          tactics.sihangRetreatContacts.set(retreatContactState.targetId, retreatContactState);
        }
        retreatContactState = tactics.sihangRetreatContact =
          tactics.sihangRetreatContacts?.get(retreatTarget.id) ?? null;
      }
      const sameRetreatContact = Boolean(retreatContactState && (retreatContact || previousContactActive));
      const meleeAttackInProgress = Boolean(sameRetreatContact && retreatTarget &&
        actor.dadao?.targetId === retreatTarget.id &&
        actor.dadao.startedAt !== null);
      const meleeDistance = retreatContact ? dadaoCombatDistance(actor, retreatTarget) : null;
      const meleeRange = retreatContact ? meleeEngagementRange(actor, retreatTarget) : null;
      const trappedInMelee = Boolean(sameRetreatContact && meleeDistance !== null &&
        meleeDistance <= DADAO.reach && tactics.traffic?.waitSeconds >= 2.5);
      if (sameRetreatContact && retreatContactState.meleeSwings > 0 &&
        actor.dadao?.startedAt === null && !trappedInMelee) {
        retreatContactState.until = Number.POSITIVE_INFINITY;
        cancelAIMelee(actor);
      }
      const contactCooldown = Boolean(sameRetreatContact && (retreatContactState.until === Number.POSITIVE_INFINITY ||
        retreatContactState.shotAttemptUntil !== undefined && time >= retreatContactState.shotAttemptUntil));
      const meleeCooldown = Boolean(sameRetreatContact && retreatContactState.meleeSwings > 0 &&
        !meleeAttackInProgress && !trappedInMelee);
      const mayMeleeOnContact = retreatContact && !meleeCooldown &&
        (!contactCooldown || meleeAttackInProgress ||
          meleeDistance !== null && meleeDistance <= meleeEngagementRange(actor, retreatTarget));
      const retreatContactShot = retreatContact && actor.hasFirearm !== false &&
        !contactCooldown &&
        actor.rifle.ammo > 0 && actor.rifle.action !== 'reload' &&
        canWeaponDamageTarget('rifle', retreatTarget.targetKind) &&
        canRiflemanTrackTarget(retreatTarget.targetKind) &&
        clearAIRifleLine(actor, from, targetAimPoint(retreatTarget));
      if (withdrawing && !waveCover && tactics.sihangWaveCoverAssignment) {
        tactics.sihangDuty = tactics.sihangWaveCoverAssignment.duty;
        tactics.sihangPost = tactics.sihangWaveCoverAssignment.post;
        tactics.sihangWaveCoverAssignment = null;
      }
      if (mayMeleeOnContact) {
        const swings = actor.dadao?.swings ?? 0;
        if (tryAIMelee(actor, retreatTarget, dt)) {
          if (actor.dadao?.swings > swings) {
            retreatContactState = tactics.sihangRetreatContact = {
              targetId: retreatTarget.id, meleeSwings: actor.dadao.swings, until: 0 };
            if (trappedInMelee) tactics.traffic = null;
          }
          settleActorSupport(actor);
          continue;
        }
      }
      if (retreatContactShot) {
        retreatContactState ??= tactics.sihangRetreatContact = {
          targetId: retreatTarget.id, until: 0, shotAttemptUntil: time + 2.5 };
        const previousShotAt = tactics.lastShot?.time ?? null;
        stopLocomotion(actor.locomotion);
        tactics.mode = 'sihang-retreat-contact-fire';
        updateInfantryAimPitch(actor, targetAimPoint(retreatTarget), soldierRifleMuzzle(actor), dt);
        fightFromCover(actor, retreatTarget, dt, null, true);
        if ((tactics.lastShot?.time ?? null) !== previousShotAt ||
          time >= retreatContactState.shotAttemptUntil)
          retreatContactState.until = Number.POSITIVE_INFINITY;
        settleActorSupport(actor);
        continue;
      }
      if (trafficYield && Math.hypot(position.x - trafficYield.x, position.z - trafficYield.z) > .3 &&
        !meleeAttackInProgress) {
        cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'sihang-traffic-yield');
        tactics.mode = 'sihang-traffic-yield';
        walkActor(actor, trafficYield, 2.4, dt);
        settleActorSupport(actor);
        continue;
      }
      if (trafficYield && !waveCover) {
        stopLocomotion(actor.locomotion); tactics.mode = 'sihang-traffic-yield';
        if (target && actor.hasFirearm !== false && !sihangCeasefire(actor)) {
          updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, target, dt, null, true);
        } else resetAIRifleAim(actor.aiRifle, 'sihang-traffic-yield');
        settleActorSupport(actor);
        continue;
      }
      const constructionExit = actor.friendly && !target && !tactics.lastSeen && constructionBuilders.length
        ? constructionExitGoal(actor, constructionBuilders) : null;
      if (constructionExit) {
        tactics.mode = 'clear-construction';
        walkActor(actor, constructionExit, 2.4, dt);
        settleActorSupport(actor);
        continue;
      }
      if (withdrawing && waveCover) {
        cancelAIMelee(actor);
        tactics.sihangWaveCoverAssignment ??= { duty: tactics.sihangDuty, post: tactics.sihangPost };
        const coverGoal = sihangDefenseGoal(Math.max(1, Math.min(3, actor.formation.index)), actor.index);
        tactics.sihangDuty = coverGoal.duty;
        tactics.sihangPost = coverGoal.id ?? null;
        const atCoverGoal = Math.hypot(position.x - coverGoal.x, position.z - coverGoal.z) <= .35 &&
          Math.abs(position.y - coverGoal.y) <= .4;
        const coverTarget = !atCoverGoal && retreatTarget && actor.hasFirearm !== false &&
          actor.rifle.ammo > 0 && actor.rifle.action !== 'reload' &&
          tactics.threatSense === 'vision' && tactics.threatId === retreatTarget.id &&
          !sihangCeasefire(actor) && canWeaponDamageTarget('rifle', retreatTarget.targetKind) &&
          canRiflemanTrackTarget(retreatTarget.targetKind) &&
          observeVisualThreat(tactics, retreatTarget, time, point => hasLine(from, point, 75, retreatTarget.vehicleId)) &&
          clearAIRifleLine(actor, from, targetAimPoint(retreatTarget)) ? retreatTarget : null;
        if (!atCoverGoal && !coverTarget) {
          actor.stance = 'standing'; actor.firingPose = null;
          resetAIRifleAim(actor.aiRifle, 'sihang-wave-cover-position');
          walkActor(actor, coverGoal, 3.5, dt, false);
          tactics.mode = 'sihang-wave-cover-position';
        } else if ((coverTarget || target) && actor.hasFirearm !== false && !sihangCeasefire(actor)) {
          const enemy = coverTarget || target;
          if (coverTarget) actor.target = coverTarget;
          stopLocomotion(actor.locomotion);
          tactics.mode = 'sihang-wave-cover';
          updateInfantryAimPitch(actor, targetAimPoint(enemy), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, enemy, dt, null, true);
        } else {
          stopLocomotion(actor.locomotion);
          tactics.mode = 'sihang-wave-cover';
          resetAIRifleAim(actor.aiRifle, 'sihang-wave-cover');
          actor.stance = 'crouched'; actor.firingPose = 'crouched';
          advanceAITurn(actor, coverGoal.heading ?? 0, dt);
        }
        settleActorSupport(actor);
        continue;
      }
      if (demolitionGoal || withdrawing || defending || pursuingRetreat) {
        cancelAIMelee(actor);
        if (tactics.cover) coverClaims.delete(tactics.cover.id);
        tactics.cover = tactics.armorEscort = null;
        const goal = demolitionGoal ?? formationDestination(actor, objective);
        const assaulting = demolitionGoal?.assault === true;
        tactics.mode = assaulting ? 'sihang-breach-assault' : demolitionGoal ? 'sihang-demolition' : withdrawing
          ? actor.playerUnit ? actor.order : 'sihang-retreat' : defending ? 'sihang-defense' : 'sihang-intercept';
        if (pursuingRetreat && !demolitionGoal)
          tactics.mode = tactics.sihangPursuit === 'enter-warehouse' ? 'sihang-enter-warehouse' : 'sihang-intercept';
        const arrival = actor.formation.sihangDemolition ? .06 : demolitionGoal || tactics.sihangDuty === 'wall-fire' ? .22 : .8;
        const moving = Math.hypot(position.x - goal.x, position.z - goal.z) > arrival ||
          Math.abs(position.y - (goal.y ?? 0)) > .4;
        if ((assaulting || pursuingRetreat) && target && actor.hasFirearm !== false &&
          (!moving || sihangAssaultFiringWindow(actor, time))) {
          stopLocomotion(actor.locomotion);
          tactics.mode = 'sihang-breach-cover-fire';
          updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, target, dt, null, true);
        } else if (moving) {
          actor.stance = 'standing'; actor.firingPose = null;
          resetAIRifleAim(actor.aiRifle, 'moving');
          walkActor(actor, goal, 3.5, dt, assaulting || withdrawing || tactics.sihangDuty === 'ground-intercept',
            withdrawing && !actor.playerUnit);
        } else if (target && actor.hasFirearm !== false && !sihangCeasefire(actor)) {
          updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
          fightFromCover(actor, target, dt, null, true);
        } else {
          resetAIRifleAim(actor.aiRifle, 'sihang-guard');
          if (demolitionGoal) {
            stopLocomotion(actor.locomotion);
            actor.stance = actor.sihangShield?.installing ? 'crouched' : 'standing';
            actor.firingPose = actor.sihangShield?.installing ? 'kneeling' : null;
          }
          advanceAITurn(actor, demolitionGoal && Number.isFinite(goal.facing) ? goal.facing : demolitionGoal
            ? Math.atan2(position.x - SIHANG_WAREHOUSE.x, position.z - SIHANG_WAREHOUSE.minZ)
            : defending ? goal.heading ?? 0 : actor.playerUnit ? player.heading : actor.friendly ? Math.PI : 0, dt);
          if (defending && tactics.sihangDuty === 'wall-fire') actor.rifleReady = true;
        }
        settleActorSupport(actor);
        continue;
      }
    }
    if (actor.friendly && actor.meleePriority && tryAIMelee(actor, target, dt)) continue;
    const defenseGoal = gateDefender && tactics.nanjingDefense ? formationDestination(actor, objective) : null;
    const defenseObjective = defenseGoal ? formationObjective(actor, objectives[0]) : null;
    const changingLevel = defenseGoal && Math.abs(position.y - defenseGoal.y) > .3;
    const urgentDefense = defenseGoal && nanjingCampaign.defenseSituation?.emergency && defenseGoal.y === 0 &&
      Math.hypot(defenseGoal.x - defenseObjective.x, defenseGoal.z - defenseObjective.z) < defenseObjective.radius;
    const firingFromPost = defenseGoal && target && !urgentDefense &&
      postureFireLine(actor, position, 'standing', targetAimPoint(target));
    if (defenseGoal && (changingLevel ||
      Math.hypot(position.x - defenseGoal.x, position.z - defenseGoal.z) >
        (firingFromPost && !nanjingCoreGuard(actor) ? 2.6 : defenseGoal.y > 7 ? .12 : .65))) {
      cancelAIMelee(actor);
      moveNanjingDefender(actor, defenseGoal, dt);
      continue;
    }
    const coreDefender = gateDefender && nanjingCoreGuard(actor);
    if (coreDefender || nanjingCampaignMode && nanjingDockBufferActive(nanjingCampaign.stage) && actor.friendly && !actor.playerUnit) {
      const goal = coreDefender ? defenseGoal : formationDestination(actor, objective);
      if (tactics.cover) coverClaims.delete(tactics.cover.id);
      tactics.cover = null; tactics.shotMovePending = false; tactics.shotMoveGoal = null;
      cancelAIMelee(actor);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > (coreDefender ? .65 : .8)) {
        tactics.mode = coreDefender ? 'core-defense-positioning' : 'dock-defense-positioning';
        resetAIRifleAim(actor.aiRifle, tactics.mode);
        walkActor(actor, goal, 3.5, dt);
      } else if (target) {
        updateInfantryAimPitch(actor, targetAimPoint(target), soldierRifleMuzzle(actor), dt);
        fightFromCover(actor, target, dt, null, true);
      } else {
        tactics.mode = coreDefender ? 'core-defense-guard' : 'dock-defense-guard';
        advanceAITurn(actor, goal.heading ?? Math.PI, dt);
      }
      continue;
    }
    if (actor.friendly && nanjingCampaignMode && tryAIMelee(actor, target, dt)) continue;
    if (actor.orderTarget?.kind !== 'armor' && tryAIThrowable(actor, target, dt)) continue;
    if (actor.friendly && !nanjingCampaignMode && tryAIMelee(actor, target, dt)) continue;
    updateInfantryAimPitch(actor, target ? targetAimPoint(target) : null, soldierRifleMuzzle(actor), dt);
    if (encirclementMode && encirclement.phase === 2 && !actor.friendly &&
      (!target || actor.position.distanceTo(target.position) > 6)) {
      if (target && time >= (tactics.breakoutNextFireAt ?? 0)) {
        tactics.breakoutFireUntil = time + 2.2;
        tactics.breakoutNextFireAt = time + 3.8;
      }
      if (target && time < (tactics.breakoutFireUntil ?? 0)) fightFromCover(actor, target, dt, null, true);
      else {
        tactics.mode = 'breakout'; actor.stance = 'standing'; actor.firingPose = null;
        resetAIRifleAim(actor.aiRifle, 'breakout-moving');
        walkActor(actor, breakoutDestination(actor), 3.5, dt);
      }
      continue;
    }
    const oldEscort = tactics.armorEscort;
    if (oldEscort) escortClaims.delete(`${oldEscort.vehicleId}:${oldEscort.slot}`);
    const assaultObjective = formationObjective(actor, objective);
    const escort = actor.formation.supplyGarrison ? null : chooseTankCover({ actor, vehicles: armor, objective: assaultObjective,
      threat: target?.position ?? tactics.lastSeen,
      reserved: (id, slot) => escortClaims.has(`${id}:${slot}`),
      blocked: point => circleBlocked(point.x, point.z, .46, movementObstacles(point.x, point.z)) ||
        actorGrid.near(point.x, point.z, 1).some(other => other !== actor && other.health > 0 && !other.vehicleId &&
          Math.hypot(other.position.x - point.x, other.position.z - point.z) < .9),
      clear: (from, to) => segmentClear(from, to, .46, world.obstacles, movementObstacles),
    });
    tactics.armorEscort = escort ? { vehicleId: escort.vehicleId, slot: escort.slot, x: escort.x, z: escort.z } : null;
    if (escort) escortClaims.set(`${escort.vehicleId}:${escort.slot}`, actor.id);
    if (!escort && oldEscort) {
      if (tactics.cover?.kind === 'tank') { coverClaims.delete(tactics.cover.id); tactics.cover = null; }
      actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
    }
    const hostileRally = !actor.friendly && !target ? spawnPoints.find(point => point.team === 'friendly' && point.kind === 'rally' && point.health > 0 && Math.hypot(point.x - position.x, point.z - position.z) < 40 && hasLine(from, new THREE.Vector3(point.x, .8, point.z), 40)) : null;
    if (!target && !hostileRally && !civilianPursuit) resetAIRifleAim(actor.aiRifle, 'no-target');
    const offensive = !actor.playerUnit || actor.order === 'advance';
    const closeFight = actor.friendly && target && Math.abs(position.y - target.position.y) < 2.5 &&
      Math.hypot(position.x - target.position.x, position.z - target.position.z) < 8;
    const sweeping = encirclementMode && encirclement.phase === 2 && actor.friendly && offensive &&
      actor.formation.breakoutDuty !== 'intercept';
    const assault = (!encirclementMode || encirclement.phase === 1) && !sweeping && offensive && !gateDefender && !closeFight && !civilianPursuit &&
      formationAssaultAction(tactics, position, assaultObjective, time, Boolean(target || hostileRally)) === 'advance';
    let constructionExit = null;
    if (assault) {
      if (tactics.cover) {
        coverClaims.delete(tactics.cover.id);
        tactics.cover = null; tactics.enteredCover = false;
        actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
      }
      tactics.mode = 'assault';
      resetAIRifleAim(actor.aiRifle, 'moving');
      const goal = formationDestination(actor, objective);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt, true);
    } else if (target) {
      actor.buildProgress = 0;
      fightFromCover(actor, target, dt, escort);
    } else if (civilianPursuit && pursueNanjingCivilian(actor, civilianPursuit, dt)) {
      actor.buildProgress = 0;
    } else if (escort) {
      tactics.mode = 'follow-tank';
      if (Math.hypot(position.x - escort.x, position.z - escort.z) > .6) walkActor(actor, escort, 3, dt);
      else tactics.mode = 'tank-cover';
    } else if (tactics.lastSeen && canRiflemanTrackTarget(tactics.threatKind) &&
      (sweeping || !(actor.friendly && (!actor.playerUnit || actor.order === 'advance') && tactics.threatKind !== 'closed-armor'))) {
      if (tactics.cover || tactics.shotMovePending || time < (tactics.relocatedFireUntil ?? 0) ||
        tactics.threatKind === 'closed-armor') fightFromCover(actor, null, dt);
      else {
        tactics.mode = 'search';
        if (actor.playerUnit && actor.order === 'hold') {
          walkActor(actor, floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings), 2.4, dt);
        } else if (Math.hypot(position.x - tactics.lastSeen.x, position.z - tactics.lastSeen.z) > 3 && (tactics.slot % 2 === Math.floor(time / 2.6) % 2)) walkActor(actor, tactics.lastSeen, 2.3, dt);
      }
    } else if (actor.friendly && !tactics.lastSeen && constructionBuilders.length &&
      (constructionExit = constructionExitGoal(actor, constructionBuilders))) {
      tactics.mode = 'clear-construction';
      walkActor(actor, constructionExit, 2.4, dt);
    } else if (actor.friendly) {
      tactics.mode = actor.playerUnit && actor.order === 'hold' ? 'hold' : actor.playerUnit && actor.order === 'follow' ? 'follow' : 'formation-advance';
      if (actor.playerUnit && actor.order === 'hold') {
        walkActor(actor, floorDestination(actor.orderPoint, holdDestination(actor), world.town.buildings), 3, dt);
      } else if (!actor.playerUnit || actor.order === 'advance') {
        if (sweeping) tactics.mode = 'sweep';
        const goal = sweeping ? sweepDestination(actor) : formationDestination(actor, objective);
        if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7 ||
          sweeping && Math.abs(position.y - goal.y) > .3) walkActor(actor, goal, 3, dt);
        else if (gateDefender) {
          tactics.mode = 'guard';
          advanceAITurn(actor, Math.PI, dt);
        }
      } else {
        const guard = followGuardAction(actor, player, assaultObjective);
        if (guard) {
          tactics.mode = 'guard';
          actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
          actor.turningToPath = false;
          tactics.traffic = tactics.personalSlot = tactics.blockedBy = null;
          if (tactics.cover) coverClaims.delete(tactics.cover.id);
          tactics.cover = null; tactics.enteredCover = false;
          const turn = advanceAITurn(actor, guard.heading, dt);
          actor.stance = turn.facing ? guard.stance : 'standing';
          actor.firingPose = actor.stance === 'crouched' ? 'crouched' : null;
          actor.rifleReady = Boolean(tactics.lastSeen && tactics.forgetAt > time) &&
            turn.facing && postureReady(actor) && actor.locomotion.aimRecovery === 0;
        } else {
          const goal = playerOrderDestination(actor, player, yaw);
          if (Math.hypot(position.x - goal.x, position.z - goal.z) > .65) walkActor(actor, goal, 3.5, dt);
        }
      }
    } else {
      tactics.mode = 'advance';
      const goal = formationDestination(actor, objective);
      if (Math.hypot(position.x - goal.x, position.z - goal.z) > .7) walkActor(actor, goal, 3, dt);
    }
    if (actor.nativeMotion && (actor.locomotion.speed > .1 || actor.turningThisStep)) {
      actor.stance = 'standing'; actor.firingPose = null; tactics.postureNeedsChoice = true; tactics.postureUntil = time;
    }
    const atObjective = objectives.some(point => Math.hypot(position.x - point.x, position.z - point.z) < point.radius);
    for (const other of actorGrid.near(position.x, position.z, 2)) {
      if (other === actor || other.health <= 0 || other.vehicleId || Math.abs(position.y - other.position.y) > 1.5) continue;
      const dx = position.x - other.position.x;
      const dz = position.z - other.position.z;
      const distance = Math.hypot(dx, dz);
      const walking = actor.turningThisStep || actor.path?.length || tactics.mode === 'wait-for-spacing';
      const spacing = actor.formation.sihangDemolition ? .9 : walking ? .9 : other === player ? 1.75 : tactics.mode === 'guard' ? 2.2 : actor.tactics.cover ? .92 : atObjective ? 1.1 : 1.45;
      if (distance < spacing) {
        const angle = distance > .01 ? Math.atan2(dz, dx) : tactics.id * 2;
        const push = Math.min(.06, (spacing - distance) * dt * 3);
        const beforeX = position.x, beforeZ = position.z;
        moveInfantry(position, Math.cos(angle) * push, Math.sin(angle) * push, .42, infantryMovementObstacles(actor, position.x, position.z));
        if (actor.locomotion.speed < .1 && Math.hypot(position.x - beforeX, position.z - beforeZ) / dt > .1) {
          actor.locomotion.speed = Math.hypot(position.x - beforeX, position.z - beforeZ) / dt;
          actor.locomotion.mode = 'walk'; actor.rifleReady = false;
          if (tactics.mode === 'guard') { actor.stance = 'standing'; actor.firingPose = null; }
        }
      }
    }
    settleActorSupport(actor);
    if (!['playing', 'transferring', 'dead'].includes(state)) break;
  }
  for (const actor of allForces) {
    if (actor === player || actor.health <= 0 || actor.vehicleId) continue;
    advanceStamina(actor.locomotion, dt, actor.locomotion.sprinting, FOOT_SPEEDS[actor.groundType].load);
  }
  aiCursor = (aiCursor + 12) % Math.max(1, allForces.length);
  if (time >= populationRefreshAt) {
    populationRefreshAt = time + 1;
    const retainActor = actor => {
      if (actor.health > 0) return true;
      if (!corpses.has(actor.id)) clearActors([actor]);
      return false;
    };
    enemies = enemies.filter(retainActor);
    friendlyAI = friendlyAI.filter(retainActor);
    rebuildForces();
    for (const wreck of expiredAircraftWrecks(entities.vehicles.values())) {
      entities.vehicles.delete(wreck.id); entities.weapons.delete(wreck.weapon.id);
    }
    for (const formation of formations.filter(item => !item.player && item.active !== false && item.respawnEnabled !== false)) {
      const aircraft = formation.team === 'enemy' && formation.type === 'plane';
      if (sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat' &&
        (formation.team === 'friendly' || aircraft)) continue;
      if (formation.reserve || formation.evacuated || !aircraft && nanjingCampaignMode &&
        formation.team === 'enemy' && nanjingCampaign.reinforcementStopped) continue;
      if (aircraft && (battleEnding.fading || nanjingCampaignMode && nanjingCampaign.outcome ||
        encirclementMode && encirclement.winner)) continue;
      if (aircraft && [...entities.vehicles.values()].some(vehicle =>
        vehicle.unitId === formation.id && vehicle.type === 'plane' && vehicle.health > 0)) {
        formation.respawnAt = formation.reinforcementStartedAt = null;
        continue;
      }
      if (formation.members.some(actor => actor.health > 0)) continue;
      if (nanjingCampaignMode && formation.team === 'friendly' && nanjingCampaign.stage === 'withdrawal-to-boats') continue;
      if (encirclementMode && formation.team === 'enemy') scheduleEncirclementRespawn(encirclement, formation, time);
      else if (formation.variant !== CHI_HA.id) formation.respawnAt ??= time + BATTLE_RULES.respawnSeconds;
      if (reinforcementDue(formation, time)) spawnFormation(formation);
    }
  }
}

function sihangActorAssemblyGoal(actor) {
  const place = actor.sihangAssemblySlot;
  return sihangAssemblyPosition(place?.slot ?? actor.formation.sihangSlot, place?.index ?? actor.index);
}

function sihangAssemblyFocusAvailable(actor) {
  const order = actor.playerUnit && actor.orderTarget;
  if (!order || sihangCeasefire(actor)) return false;
  const target = order.kind === 'armor' ? entities.vehicles.get(order.id) : entities.soldiers.get(order.id);
  if (!target || target.health <= 0 || target.team === actor.team ||
    order.kind === 'person' && target.vehicleId ||
    !sihangNightVisibility(sihangCampaign, actor.position, target.position)) return false;
  if (order.kind === 'armor' ? actor.grenades.packs <= 0 || Math.abs(actor.position.y - target.position.y) > 1
    : actor.hasFirearm === false || actor.rifle.ammo <= 0 && actor.rifle.reserve <= 0) return false;
  const eye = soldierEyePosition(actor), from = new THREE.Vector3(eye.x, eye.y, eye.z);
  if (order.kind === 'armor') {
    const point = new THREE.Vector3(target.position.x, target.position.y + 1, target.position.z);
    return from.distanceTo(point) <= 75 && hasLine(from, point, 75, target.id);
  }
  return Boolean(visibleTargetPoint(target, point => from.distanceTo(point) <= 75 && hasLine(from, point, 75)));
}

function updateSihangMission(dt) {
  const point = objectives[0], previousStage = sihangCampaign.stage, player = controlledSoldier(entities);
  const previousCounterattack = sihangCampaign.counterattack, previousRetreatOpen = sihangCampaign.playerRetreatOpen;
  if (sihangCampaign.stage === 'sihang-defense' && !sihangCampaign.outcome) {
    const inside = actor => actor.health > 0 && !actor.vehicleId && objectiveContainsPosition(point, actor.position);
    advanceCapture(point, dt, friendlyForces.some(inside), enemies.some(inside));
  }
  advanceSihangCampaign(sihangCampaign, dt, { friendly: friendlyForces, playerSquad: allies,
    settling: friendlyForces.filter(actor => actor !== player && actor.health > 0 &&
      (actor.sihangParadeGoal || sihangSafePosition(actor.position))).length,
    captureLost: point.owner === 'enemy' });
  if (!previousRetreatOpen && sihangCampaign.playerRetreatOpen) sihangVoices?.play(audioContext, 'retreat-open');
  else if (!previousCounterattack && sihangCampaign.counterattack) sihangVoices?.play(audioContext, 'counterattack');
  remaining = sihangCampaign.stageRemaining ?? 0;
  if (previousStage !== sihangCampaign.stage) {
    sihangEnemyPosts = sihangEnemyRegroupPosts(world.obstacles);
    for (let index = 4; index <= SIHANG_RULES.retreatSquads; index++) {
      const formation = sihangRetreatFormation(index);
      formations.push(formation); registerUnit(entities, formation); registerBattleScore(formation);
    }
    let slot = 0;
    for (const formation of formations.filter(formation => formation.team === 'friendly' && !formation.player)) {
      formation.respawnEnabled = true; formation.respawnAt = null;
      formation.spawnId = `sihang-retreat-${slot}`;
      formation.sihangSlot = slot; formation.retreatAssembled = false; formation.withdrawAt = Infinity;
      if (!formation.members.some(actor => actor.health > 0)) formation.respawnAt = time;
      slot++;
    }
    const covering = formations.find(formation => formation.player);
    covering.sihangSlot = SIHANG_RULES.retreatSquads; covering.retreatAssembled = false;
    for (const actor of allForces) {
      releaseEmplacement(actor, false);
      if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
      actor.tactics.cover = actor.path = actor.pathGoal = actor.target = null;
      actor.tactics.lastSeen = null; actor.nextPath = 0;
      pathRequests.delete(actor.tactics.id);
      if (actor.friendly && actor.position.y > .3) {
        actor.tactics.preferredStair = [...SIHANG_STAIRWELLS].sort((a, b) =>
          Math.abs(a.x - actor.position.x) - Math.abs(b.x - actor.position.x))[0].id;
      }
    }
    for (const formation of formations.filter(formation => formation.team === 'enemy' && formation.type === 'plane'))
      formation.respawnEnabled = false;
    toast('撤退命令 · 前往仓库南面，抵达后首批出发。南岸禁火。', 8);
    sihangVoices?.play(audioContext, 'withdrawal');
  }
  if (sihangCampaign.stage === 'sihang-retreat' && !sihangCampaign.outcome) {
    const inAssemblyPosition = position => position.x >= -34 && position.x <= 26 &&
      position.z >= -7.7 && position.z <= -.4 && Math.abs(position.y) < .4;
    const inAssemblyArea = actor => inAssemblyPosition(actor.position);
    const previousWavePhase = sihangCampaign.withdrawalWave?.phase;
    const waveState = advanceSihangWithdrawalWave(sihangCampaign);
    if (waveState === 'refill') sihangCampaign.waveAssemblyAt ??= sihangCampaign.elapsed;
    if (previousWavePhase === 'main' && waveState === 'cover') {
      toast(`第${sihangCampaign.withdrawalWave.number}批 · 掩护队撤离`, 5);
      sihangVoices?.play(audioContext, 'wave-cover');
    }
    if (!sihangCampaign.assemblyReleased && player?.health > 0) {
      const obstructed = friendlyForces.find(actor => {
        if (actor === player || actor.health <= 0) return false;
        const goal = sihangActorAssemblyGoal(actor);
        return inAssemblyPosition(goal) && Math.hypot(player.position.x - goal.x, player.position.z - goal.z) < .7 &&
          Math.abs(player.position.y) < .3;
      });
      if (obstructed) {
        const vacant = player.sihangAssemblySlot ?? { slot: player.formation.sihangSlot, index: player.index };
        player.sihangAssemblySlot = obstructed.sihangAssemblySlot ??
          { slot: obstructed.formation.sihangSlot, index: obstructed.index };
        obstructed.sihangAssemblySlot = vacant; obstructed.sihangAssemblyRoute = null;
        obstructed.path = obstructed.pathGoal = null; pathRequests.delete(obstructed.tactics.id);
      }
    }
    const saved = new Set(sihangCampaign.evacuatedIds), settled = [];
    for (const actor of friendlyForces) if (saved.has(actor.id)) {
      if (!actor.sihangEvacuated) {
        actor.sihangEvacuated = true;
        releaseEmplacement(actor, false); actor.target = null; actor.tactics.cover = null;
        if (actor === player) {
          playerInput.clearFire(); held.primary = held.secondary = held.aiming = false;
          toast('已安全撤离 · 南岸禁止开火，等待其余守军撤离。', 5);
        } else {
          actor.sihangParadeSlot = sihangParadeSerial++;
          actor.sihangParadeGoal = actor.sihangParadeSlot < 40
            ? sihangParadePosition(actor.sihangParadeSlot) : sihangParadeExit(true);
        }
      }
      const goal = actor.sihangParadeGoal;
      if (actor !== player && goal && Math.abs(actor.position.y) < .3) {
        const passed = actor.sihangParadeSlot >= 40 && sihangParadePassage(actor.position, goal);
        if (goal.exit && (actor.sihangFadeAt !== undefined || passed)) {
          actor.sihangFadeAt ??= time;
          actor.sihangEvacuationOpacity = Math.max(0, 1 - (time - actor.sihangFadeAt) / 2);
          if (actor.sihangEvacuationOpacity === 0) settled.push(actor);
        } else if (Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) < .3 &&
          actor.sihangParadeSlot < 40) {
          sihangParade.add(actor, actor.position, 0); settled.push(actor);
        } else if (!goal.exit && passed) {
          actor.sihangParadeGoal = sihangParadeExit();
          actor.path = actor.pathGoal = null; pathRequests.delete(actor.tactics.id);
        }
      }
    }
    if (settled.length) {
      const ids = new Set(settled.map(actor => actor.id)), controlledId = player?.id;
      clearActors(settled);
      friendlyAI = friendlyAI.filter(actor => !ids.has(actor.id));
      allies = allies.filter(actor => !ids.has(actor.id));
      current = allies.findIndex(actor => actor.id === controlledId);
      for (const formation of formations.filter(item => item.player)) formation.members = allies;
      rebuildForces();
    }
    const playerReady = player?.health > 0
      ? inAssemblyArea(player)
      : !sihangDeploymentCount(sihangCampaign) && !allies.some(actor => actor.health > 0);
    if (!sihangCampaign.assemblyPrepared && playerReady) {
      for (const formation of formations.filter(item => item.team === 'friendly' && !item.player)) {
        formation.retreatAssembled = false;
        formation.respawnAt = time;
      }
      for (const actor of friendlyForces) {
        actor.sihangAssemblySlot = null;
        actor.sihangAssemblyRoute = null;
        actor.path = actor.pathGoal = null;
        pathRequests.delete(actor.tactics.id);
      }
      sihangCampaign.assemblyPrepared = true;
      sihangCampaign.assemblyReleased = true;
    }
    const refillOrder = formations.filter(item => item.team === 'friendly' && !item.player)
      .sort((a, b) => (a.sihangSlot - sihangCampaign.retreatNextSpawnSlot + SIHANG_RULES.retreatSquads) % SIHANG_RULES.retreatSquads -
        (b.sihangSlot - sihangCampaign.retreatNextSpawnSlot + SIHANG_RULES.retreatSquads) % SIHANG_RULES.retreatSquads);
    const resolved = new Set([...sihangCampaign.evacuatedIds, ...sihangCampaign.retreatLostIds]);
    const activeWave = sihangCampaign.withdrawalWave;
    const earlyPreparation = activeWave && (['cover', 'interval'].includes(activeWave.phase) ||
      activeWave.phase === 'main' && activeWave.squads.filter(ids =>
        ids.some(id => !resolved.has(id))).length <= 1);
    if (earlyPreparation && sihangRetreatDeploymentCount(sihangCampaign))
      sihangCampaign.waveAssemblyAt ??= sihangCampaign.elapsed;
    for (const formation of refillOrder) {
      formation.members = formation.members.filter(actor => !saved.has(actor.id));
      if (!sihangCampaign.assemblyPrepared) continue;
      const wave = sihangCampaign.withdrawalWave;
      const earlyRefill = earlyPreparation &&
        wave.squads[formation.sihangSlot].every(id => resolved.has(id));
      if (!sihangCampaign.assemblyReleased || !wave || earlyRefill) {
        const count = formation.members.filter(actor => actor.health > 0).length;
        if (count < SIHANG_RULES.squadMembers && sihangRetreatDeploymentCount(sihangCampaign) &&
          time >= sihangCampaign.retreatNextSpawnAt) {
          formation.respawnAt ??= time;
          if (time >= formation.respawnAt && spawnFormation(formation, false, count > 0)) {
            sihangCampaign.retreatNextSpawnAt = time + SIHANG_RULES.retreatSpawnInterval;
            sihangCampaign.retreatNextSpawnSlot = (formation.sihangSlot + 1) % SIHANG_RULES.retreatSquads;
          }
        }
        continue;
      }
    }
    const friendlyUnits = formations.filter(item => item.team === 'friendly');
    for (const formation of friendlyUnits) {
      const members = formation.members.filter(actor => actor.health > 0 && !actor.sihangEvacuated && actor !== player);
      const assembled = members.every(actor => {
        const goal = sihangActorAssemblyGoal(actor);
        return Math.hypot(actor.position.x - goal.x, actor.position.z - goal.z) <= SIHANG_ASSEMBLY_ARRIVAL &&
          Math.abs(actor.position.y) < .3 && actor.stance === 'crouched' &&
          Math.cos(actor.heading + Math.PI / 2) >= .995;
      });
      if (!formation.retreatAssembled && assembled &&
        (members.length || formation.player && player?.health > 0 && inAssemblyArea(player))) {
        formation.retreatAssembled = true;
      }
    }
    const assemblyTimedOut = sihangWaveAssemblyRemaining(sihangCampaign) === 0;
    const aiUnits = friendlyUnits.filter(formation => !formation.player).sort((a, b) => a.sihangSlot - b.sihangSlot);
    if (sihangCampaign.assemblyReleased && !sihangCampaign.withdrawalWave &&
      (sihangCampaign.withdrawalWaveNumber === 0 || assemblyTimedOut ||
        (!sihangRetreatDeploymentCount(sihangCampaign) || aiUnits.every(formation =>
        formation.members.filter(actor => actor.health > 0).length === SIHANG_RULES.squadMembers)) &&
        aiUnits.every(formation => formation.retreatAssembled || !formation.members.some(actor => actor.health > 0)))) {
      const squads = aiUnits.map(formation => formation.members.filter(actor => actor.health > 0).map(actor => actor.id));
      if (squads.some(squad => squad.length)) {
        const wave = startSihangWithdrawalWave(sihangCampaign, squads);
        for (const formation of aiUnits) if (formation.members.some(actor => actor.health > 0))
          formation.retreatAssembled = true;
        sihangCampaign.waveAssemblyAt = null;
        toast(`第${wave.number}批撤退 · ${squads.flat().length}人`, 6);
        if (wave.number > 1) sihangVoices?.play(audioContext, 'wave-start');
      }
    }
  }
  if (sihangCampaign.outcome && !battleEnding.fading && !battleEnding.complete) {
    showOverlay(sihangCampaign.outcome === 'evacuated' ? 'victory' : 'defeat');
  }
}

function updateObjectives(dt) {
  if (encirclementMode && encirclement.phase === 2) resolveEastGateEscapes();
  const capturePoints = encirclementMode && encirclement.phase === 2 ? [] : objectives.filter(point => point.capturePoint !== false);
  for (const point of capturePoints) {
    const inRadius = actor => actor.health > 0 && occupiedVehicle(entities, actor)?.type !== 'plane' &&
      (!point.captureArea || !actor.vehicleId) && objectiveContainsPosition(point, actor.position);
    const owner = point.owner;
    const status = advanceCapture(point, dt, friendlyForces.some(inRadius), enemies.some(inRadius));
    for (const cue of objectiveVoiceTracker.update(point, status)) {
      battleVoiceEvent(cue, { eventKey: `objective:${point.id}:${cue}` });
    }

    if (owner !== point.owner) {
      const flagIndex = capturePoints.findIndex(candidate => candidate.id === point.id);
      const flag = world.flags[flagIndex];
      if (flag && !sihangCampaignMode && !flag.userData.nationalFlag)
        flag.material.color.setHex(point.owner === 'friendly' ? 0x70865d : point.owner === 'enemy' ? 0xb66551 : 0xa19469);
      assaultAssignmentAt = 0;
      if (point.owner === 'friendly') {
        if (encirclementMode) {
          const result = captureEncirclement(encirclement, formations, point.id, time);
          if (result.spawn) spawnPoints.push(result.spawn);
        }
        const next = objectives.filter(candidate => candidate.id !== point.id &&
          (candidate.owner !== 'friendly' || candidate.status === 'contested' || candidate.control < 1))
          .sort((a, b) => Math.hypot(a.x - point.x, a.z - point.z) - Math.hypot(b.x - point.x, b.z - point.z))[0];
        if (next) for (const actor of allies.filter(actor => actor.health > 0 && actor.order === 'advance' && actor.orderObjectiveId === point.id)) {
          if (actor.tactics.cover && coverClaims.get(actor.tactics.cover.id)?.owner === actor.tactics.id) coverClaims.delete(actor.tactics.cover.id);
          pathRequests.delete(actor.tactics.id);
          actor.orderObjectiveId = next.id;
          actor.orderPoint = { x: next.x, y: world.groundHeight(next.x, next.z), z: next.z };
          resetObjectiveMovement(actor, next.id);
        }
      }
      toast(`${point.id} · ${point.name} ${point.owner === 'friendly' ? '我方占领' : point.owner === 'enemy' ? '日军占领' : '已被中和'}`, 4);
    }
  }
  const phase = encirclement.phase;
  const winner = encirclementMode ? advanceEncirclement(encirclement, objectives, formations, dt, { restoreForces: true })
    : advanceConquest(conquest, objectives, dt, remaining);
  if (encirclementMode) {
    const support = advanceEncirclementSupport(encirclement, objectives, formations, time);
    let arrived = 0;
    for (const formation of support.added) {
      registerBattleScore(formation);
      if (spawnFormation(formation)) arrived++;
    }
    if (support.added.length) {
      if (encirclement.phase === 1) assaultAssignmentAt = 0;
      toast(arrived === support.added.length ? `外线援军抵达 · 新增${arrived}队友军`
        : `增援已派出 · ${arrived}队抵达，${support.added.length - arrived}队等待安全集结位置`, 5);
    }
    if (support.supplyChanged && !winner && encirclement.phase === 1) toast(encirclement.supplyInterrupted
      ? 'A点补给已切断 · 日军增援间隔延长至35秒'
      : '日军夺回A点 · 补给恢复，增援间隔17秒', 6);
  }
  if (encirclementMode && phase !== encirclement.phase) {
    assaultAssignmentAt = Infinity;
    for (const formation of formations.filter(unit => unit.team === 'friendly'))
      formation.breakoutDuty = 'intercept';
    for (const actor of enemies) {
      actor.tactics.breakoutGoal = null;
      if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
      actor.tactics.cover = actor.path = actor.pathGoal = null;
      pathRequests.delete(actor.tactics.id);
    }
    for (const actor of friendlyForces.filter(actor => actor.health > 0)) {
      if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
      pathRequests.delete(actor.tactics.id);
      if (actor.playerUnit && actor !== controlledSoldier(entities)) {
        actor.order = 'advance'; actor.orderObjectiveId = 'C';
        actor.orderPoint = { x: 48, y: 0, z: EAST_BREAKOUT.z };
      }
      resetObjectiveMovement(actor, actor.orderObjectiveId ?? actor.formation.objectiveId ?? objectives[0].id);
    }
    toast('第二阶段 · 我军向C点集结！日军补齐后有20秒布防时间，随后冲击东门。', 7);
  }
  if(encirclementMode&&encirclement.phase===2){
    restoreBreakoutForces();
    advanceBreakoutGroups(formations,encirclement,time);
  }
  if (encirclementMode) for (const cue of encirclementVoiceTracker.update(encirclement, objectives, formations, time)) {
    battleVoiceEvent(cue, { eventKey: `encirclement:${cue}:${Math.floor(time)}` });
  }
  if (winner) showOverlay(winner === 'friendly' ? 'victory' : winner === 'enemy' ? 'defeat' : 'draw');
}

function updateNanjingMission(dt) {
  const stage = nanjingCampaign.stage;
  if (stage === 'gate-defense') {
    const gate = objectives.find(point => point.id === 'gate');
    const inside = actor => actor.health > 0 && !actor.vehicleId &&
      Math.abs(actor.position.y) < 2.5 && Math.hypot(actor.position.x - gate.x, actor.position.z - gate.z) < gate.radius;
    advanceNanjingGateCapture(nanjingCampaign, dt, friendlyForces.some(inside), enemies.some(inside));
    gate.enemyProgress = nanjingCampaign.gateCaptureSeconds / NANJING_GATE_CAPTURE_SECONDS;
    gate.progress = 1 - gate.enemyProgress;
    gate.control = gate.progress;
    gate.status = nanjingCampaign.gateContested ? 'contested' : gate.enemyProgress > 0 ? 'capturing' : 'held';
    gate.owner = nanjingCampaign.outcome === 'gate-overrun' ? 'enemy' : 'friendly';
  }
  const voice = nanjingMissionVoice(nanjingCampaign);
  if (voice) battleVoiceEvent(voice, { soldierId: 'nanjing-command', eventKey: voice, command: true });
  if (stage !== nanjingCampaign.presentedStage) {
    nanjingCampaign.presentedStage = stage;
    squadRoutes.clear();
    if (stage === 'withdrawal') {
      toast('中华门坚守完成！掩护百姓撤往上新河渡口。', 6);
      let regroupSlot = 0;
      for (const actor of enemies.filter(actor => actor.health > 0 && !actor.vehicleId)) {
        actor.tactics.nanjingRegroup = nanjingGateRegroupPost(regroupSlot++);
        actor.path = actor.pathGoal = actor.target = null;
        pathRequests.delete(actor.tactics.id);
        if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
        actor.tactics.cover = null;
      }
      nanjingCampaign.requiredAISquads = formations.filter(formation => formation.team === 'friendly' &&
        !formation.player && formation.members.some(actor => actor.health > 0)).length;
      for (const formation of formations.filter(item => item.team === 'friendly' && !item.player)) {
        formation.objectiveId = 'dock';
        for (const actor of formation.members) {
          if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
          actor.tactics.cover = actor.tactics.lastSeen = actor.target = actor.path = actor.pathGoal = null;
          pathRequests.delete(actor.tactics.id);
        }
      }
    } else if (stage === 'dock-defense') {
      toast('抵达上新河渡口！守住阵地，掩护百姓登船。', 6);
      assaultAssignmentAt = 0;
      let reserveIndex = 0;
      for (const formation of formations.filter(item => item.team === 'friendly' && !item.player)) {
        if (formation.reserve) formation.reserveReadyAt = time + 2 + reserveIndex++ * 5;
        else formation.spawnId = `nanjing-west-ai-${formation.index % 2 ? 1 : 2}`;
        formation.objectiveId = 'dock';
      }
      nanjingCampaign.requiredAISquads = formations.filter(formation => formation.team === 'friendly' &&
        !formation.player && (formation.reserve || formation.members.some(actor => actor.health > 0))).length;
      const routes = NANJING_DOCK_ASSAULT_SPAWNS;
      let routeIndex = 0;
      for (const formation of formations.filter(item => item.team === 'enemy' && !item.aerialSupport)) {
        formation.spawnId = formation.variant === CHI_HA.id ? 'nanjing-north-armor' : routes[routeIndex++];
        formation.objectiveId = 'dock';
        const retired = new Set(formation.members);
        for (const actor of retired) {
          if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
          pathRequests.delete(actor.tactics.id);
        }
        clearActors(formation.members, true);
        enemies = enemies.filter(actor => !retired.has(actor));
        if (formation.vehicleId) {
          const transport = entities.vehicles.get(formation.vehicleId);
          if (transport && transport.health > 0) {
            entities.vehicles.delete(transport.id);
            entities.weapons.delete(transport.weapon.id);
            for (const gun of transport.machineGuns ?? []) entities.weapons.delete(gun.id);
          }
          formation.vehicleId = null;
        }
        formation.members = [];
        formation.respawnAt = time;
        rebuildForces();
        if (!spawnFormation(formation, true)) toast(`渡口进攻部队暂时无法集结：${formation.blockedReason}，稍后继续尝试。`, 5);
      }
    } else if (stage === 'withdrawal-to-boats') {
      toast('撤退命令！掩护百姓与友军撤退，准备登船撤离南京。', 7);
      for (const formation of formations.filter(item => item.team === 'friendly' && !item.player)) formation.objectiveId = 'dock';
    }
  }

  if (nanjingCampaign.dockActivated && nanjingCampaign.stage !== 'withdrawal-to-boats')
    for (const formation of formations.filter(item => item.team === 'friendly' && item.reserve)) {
    if (time < formation.reserveReadyAt || time < (formation.reserveCheckAt ?? 0)) continue;
    formation.reserveCheckAt = time + 1;
    const spawn = spawnPoints.find(point => point.id === formation.spawnId);
    const target = new THREE.Vector3(spawn.x, spawn.altitude + 1.2, spawn.z);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const offset = target.clone().sub(camera.position);
    const inSight = offset.length() < 70 && forward.dot(offset.clone().normalize()) > .35 &&
      hasLine(camera.position, target, 70);
    if (inSight || target.distanceTo(controlledSoldier(entities).position) < 28) continue;
    if (spawnFormation(formation, true)) {
      formation.reserve = false; formation.spawnId = `nanjing-west-ai-${formation.index % 2 ? 1 : 2}`;
      toast('城内预备队正在沿街赶往渡口支援。', 5);
    }
  }

  if (nanjingCampaign.stage === 'withdrawal') {
    const position = allies[current]?.position;
    const dock = objectives.find(point => point.id === 'dock');
    if (position && dock && Math.hypot(position.x - dock.x, position.z - dock.z) <= dock.radius) {
      activateNanjingDock(nanjingCampaign);
    }
  }

  if (nanjingCampaign.stage === 'withdrawal-to-boats') {
    const aiFormations = formations.filter(item => item.team === 'friendly' && !item.player);
    const aliveFormations = aiFormations.filter(formation => formation.members.some(actor => actor.health > 0));
    const crossed = nanjingCampaign.evacuatedSquads.filter(squad => !squad.isPlayer);
    nanjingCampaign.requiredAISquads = aliveFormations.length + crossed.length;
    const relevant = new Set([...aliveFormations.map(formation => formation.id), ...crossed.map(squad => squad.id)]);
    nanjingCampaign.boardedAISquads = nanjingCampaign.boardedAISquads.filter(id => relevant.has(id));
    const civiliansSafe = nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready;
    for (const formation of aiFormations) {
      if (nanjingCampaign.evacuatedSquads.some(squad => squad.id === formation.id)) continue;
      const alive = formation.members.filter(actor => actor.health > 0);
      if (civiliansSafe && alive.length &&
        alive.every(actor => ['aboard', 'evacuated'].includes(actor.tactics.nanjingFerry?.phase)))
        recordNanjingAISquadBoarding(nanjingCampaign, formation.id);
      if (civiliansSafe && alive.length &&
        alive.every(actor => actor.tactics.nanjingFerry?.phase === 'evacuated') &&
        recordNanjingSquadEvacuation(nanjingCampaign, formation.id)) {
        formation.members = formation.members.filter(actor => actor.health <= 0);
        formation.evacuated = true;
        rebuildForces();
      }
    }
    const evacuationVoice = nanjingEvacuationVoice(nanjingCampaign, civiliansSafe,
      world.ferries.some(ferry => ferry.userData.troopBoarding?.actor?.health > 0 &&
        !ferry.userData.troopBoarding.actor.playerUnit));
    if (evacuationVoice) battleVoiceEvent(evacuationVoice, { soldierId: 'nanjing-command', eventKey: evacuationVoice });
    const playerBoat = nanjingPlayerFerry(), player = controlledSoldier(entities);
    if (playerBoat?.userData.state === 'outbound' && player?.health > 0 &&
      player.tactics.nanjingFerry?.phase === 'aboard' &&
      player.tactics.nanjingFerry.ferryId === playerBoat.userData.ferryId &&
      playerBoat.position.x <= NANJING_DOCK.ferryX - 1)
      recordNanjingSquadEvacuation(nanjingCampaign, 'friendly-0', true);
  }

  if (nanjingCampaign.dockActivated && !nanjingCampaign.outcome) {
    const dock = objectives.find(point => point.id === 'dock');
    const enemyInside = enemies.some(actor => actor.health > 0 &&
      Math.hypot(actor.position.x - dock.x, actor.position.z - dock.z) < dock.radius);
    const defenderInside = friendlyForces.some(actor => actor.health > 0 &&
      Math.hypot(actor.position.x - dock.x, actor.position.z - dock.z) < dock.radius);
    nanjingCampaign.dockContestedSeconds = enemyInside && !defenderInside
      ? nanjingCampaign.dockContestedSeconds + dt : 0;
    if (nanjingCampaign.dockContestedSeconds >= 20) overrunNanjingDock(nanjingCampaign);
  }

  if (nanjingCampaign.outcome && !nanjingCampaign.overlayShown) {
    nanjingCampaign.overlayShown = true;
    showOverlay(nanjingCampaign.outcome === 'evacuated' ? 'victory' : 'defeat');
  }
}

function nanjingCivilianCombatTargets(){
  if(civilianCombatTime!==time){
    civilianCombatTime=time;civilianCombatList=civilianCombatTargets(world.civilians);
  }
  return civilianCombatList;
}

function nanjingCivilianPursuitTarget(actor) {
  if (!['gate-defense', 'dock-defense', 'withdrawal-to-boats'].includes(nanjingCampaign.stage))return null;
  const tactics = actor.tactics;
  if (time >= (tactics.civilianThinkAt ?? 0)) {
    tactics.civilianThinkAt = time + .5;
    const eye = soldierEyePosition(actor), from = new THREE.Vector3(eye.x, eye.y, eye.z);
    tactics.civilianTarget = nanjingCivilianCombatTargets().filter(target =>
      Math.hypot(target.position.x-actor.position.x,target.position.z-actor.position.z)<34)
      .sort((a,b)=>a.position.distanceToSquared(actor.position)-b.position.distanceToSquared(actor.position))
      .slice(0, 4)
      .find(target=>hasLine(from,target.position.clone().add(new THREE.Vector3(0,target.aimHeight,0)),36))?.civilian??null;
  }
  const person = tactics.civilianTarget;
  return person && person.visible && !person.userData.dead && !person.userData.evacuated &&
    person.parent?.visible && actor.position.distanceTo(person.getWorldPosition(new THREE.Vector3())) < 36 ? person : null;
}

function pursueNanjingCivilian(actor, civilian, dt) {
  if (finalBoardingFireHeld(nanjingCampaign, time)) {
    cancelAIMelee(actor); resetAIRifleAim(actor.aiRifle, 'embark-ceasefire');
    stopLocomotion(actor.locomotion);
    return true;
  }
  const target=civilian.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,civilianAimHeight(civilian),0));
  const distance = actor.position.distanceTo(target), tactics = actor.tactics;
  cancelAIMelee(actor);
  actor.stance = 'standing'; actor.firingPose = null;
  tactics.mode = 'pursue-civilians';
  if (distance > 21) {
    resetAIRifleAim(actor.aiRifle, 'moving');
    const goal = { x: target.x, z: target.z + 7, y: 0 };
    if (actor.position.z > 38 && target.z < 38) { goal.x = -24; goal.z = 37; }
    walkActor(actor, goal, 3, dt);
    return true;
  }
  actor.path = actor.pathGoal = null; pathRequests.delete(tactics.id);
  const facing = advanceAITurn(actor, Math.atan2(actor.position.x - target.x, actor.position.z - target.z), dt).facing;
  updateInfantryAimPitch(actor, target, soldierRifleMuzzle(actor), dt);
  actor.rifleReady = facing && actor.locomotion.aimRecovery === 0;
  const eye = soldierEyePosition(actor), from = new THREE.Vector3(eye.x, eye.y, eye.z);
  let muzzle;
  if (attemptAIRifleShot(actor, { now: time, targetId: `civilian:${civilian.userData.civilianId}`,
    mayFire: facing, postureSettled: postureReady(actor) && nativeAimReady(actor),
    suppressed: time < tactics.suppressedUntil,
    confirmShot: () => { muzzle = clearAIRifleLine(actor, from, target); return muzzle ? muzzle.distanceTo(target) : null; } })) {
    const profile=infantryWeaponProfile(actor.rifle),suppressed=time<tactics.suppressedUntil;
    actor.nextFire=time+(profile.automatic?(actor.rifle.shots%3===0 ? .8 : profile.cycleSeconds):
      rifleAIFireDelay(distance,suppressed,battleRandom()));
    const source = captureAttackSource(entities, actor, actor.rifle);
    const hit = battleRandom() < rifleAIHitChance(distance,suppressed);
    const aim = hit ? target : target.clone().add(new THREE.Vector3(battleRandom() < .5 ? -1.2 : 1.2, .5, 0));
    const delta = aim.sub(muzzle);
    const gun = { settings: { range: RIFLE.range, damage: TYPES.infantry.damage } };
    fireAutomaticShot({ id: null, team: 'enemy' }, { gun }, source, muzzle,
      Math.atan2(-delta.x, -delta.z), Math.atan2(delta.y, Math.hypot(delta.x, delta.z)));
    nanjingCampaign.civilianShots = (nanjingCampaign.civilianShots ?? 0) + 1;
  }
  return true;
}

function applyCivilianDamage(civilian, damage, source) {
  if (source.team === 'enemy' && finalBoardingFireHeld(nanjingCampaign, time)) return;
  const data = civilian.userData;
  if (data.dead || source.team !== 'enemy') return;
  data.health = Math.max(0, (data.health ?? 100) - damage);
  if(source.weaponClass==='plane')nanjingCampaign.civilianAircraftHits=(nanjingCampaign.civilianAircraftHits??0)+1;
  civilianCombatTime=null;
  if (data.health > 0) { data.panicked = true; return; }
  data.dead = true; data.deadAt = time; data.casualtySource = source.soldierId;
  const corpseId = `civilian-${data.civilianId}`;
  civilianCorpses.set(corpseId, { id: corpseId, health: 0, casualty: { time }, civilian });
  const ferry=world.ferries.find(ferry=>ferry.userData.passengers.includes(civilian));
  if(ferry){
    const boat=nanjingCampaign.boats[ferry.userData.ferryId];
    if(boat.passengers<=0||nanjingCampaign.civiliansAboard<=0)throw new Error('Civilian passenger casualty has inconsistent boat counts');
    boat.passengers--;nanjingCampaign.civiliansAboard--;nanjingCampaign.civilianCasualties++;
    ferry.userData.passengers.splice(ferry.userData.passengers.indexOf(civilian),1);
    restoreFerryPassenger(civilian);
    scene.attach(civilian);
  } else {
    const countedArrival = data.arrived && !data.unrescued;
    if (data.unrescued) {
      if (!(nanjingCampaign.civiliansUnrescued > 0)) throw new Error('Unrescued civilian count is inconsistent');
      data.unrescued = false; nanjingCampaign.civiliansUnrescued--;
    }
    registerCivilianCasualties(nanjingCampaign, 1, countedArrival);
  }
  const queued = world.civilianQueue.indexOf(civilian);
  if (queued >= 0) world.civilianQueue.splice(queued, 1);
  for (const ferry of world.ferries) if (ferry.userData.boarding?.civilian === civilian) ferry.userData.boarding = null;
  data.boarding = false;
  civilian.rotation.z = data.civilianId % 2 ? 1.4 : -1.4;
  civilian.position.y += .12;
}

function updateNanjingCivilians(dt) {
  civilianCrowdPlanner.beginStep();
  advanceCivilianFlight(world.civilians, world.civilianFlight, controlledSoldier(entities)?.position,
    nanjingCampaign.stage, nanjingCampaign.dockActivated, time);
  if (world.civilianFlight.encounterAt !== null && !world.civilianFlight.voiceNotified && civilianVoices) {
    civilianVoices.encounter(time);
    world.civilianFlight.voiceNotified = true;
  }
  const threatBudget={remaining:6};
  const queue = world.civilianQueue;
  const leftBehind = expireCivilianShoreWait(nanjingCampaign, world.civilians, world.ferries, queue);
  if (leftBehind) toast(`撤退等待结束：${leftBehind} 名百姓未救出；已登船百姓继续过江。`, 8);
  const peers = world.civilians.filter(other => other.visible && other.parent === scene && !other.userData.dead);
  const visibleThreat = (from, enemy, vehicleId=null) => hasLine(
    new THREE.Vector3(from.x, from.y + 1.1, from.z), new THREE.Vector3(enemy.x, enemy.y + 1.2, enemy.z), 30,vehicleId);
  const concealed = (from, enemy) => !hasLine(
    new THREE.Vector3(from.x, from.y + .65, from.z), new THREE.Vector3(enemy.x, enemy.y + 1.2, enemy.z), 36,enemy.vehicleId);
  const firstCivilian = Math.floor(time / .05) % world.civilians.length;
  for (let index = 0; index < world.civilians.length; index++) {
    const civilian = world.civilians[(index + firstCivilian) % world.civilians.length];
    const data = civilian.userData;
    if (data.dead) {
      continue;
    }
    if (data.boarding || civilian.parent !== scene) continue;
    if (nanjingCampaign.stage === 'withdrawal-to-boats' && !data.arrived && !data.evacuated && !data.unrescued &&
      civilianRecoveryDue(data, civilian.position, time) && civilianCrowdPlanner.take()) {
      const recovery = data.finalRecovery;
      recovery.retryAt = time + 2; recovery.attempts++;
      let path = rejoinCivilianRoute(civilian.position, data.waitingSlot,
        world.civilianNavigate, world.civilianNavigationObstacles, civilianNavigationLookup);
      if (!path?.length && data.streetLife) {
        const exit = rejoinCivilianRoute(civilian.position, data.streetLife.exit,
          data.streetLife.navigate, data.streetLife.navigationObstacles, data.streetLife.navigationLookup);
        const onward = exit?.length ? world.civilianNavigate(data.streetLife.exit, data.waitingSlot) : [];
        if (onward.length) { path = [...exit, ...onward]; data.streetEvacuating = true; }
      }
      if (!path?.length && recovery.attempts >= 3 && circleBlocked(civilian.position.x, civilian.position.z, .36,
        civilianNavigationLookup.at(civilian.position.x, civilian.position.z))) {
        const points = [data.homeRoute?.[0]];
        for (const radius of [.5, 1, 2, 4]) for (let side = 0; side < 8; side++) {
          const angle = side * Math.PI / 4;
          points.push({ x: civilian.position.x + Math.cos(angle) * radius,
            z: civilian.position.z + Math.sin(angle) * radius });
        }
        const clear = points.filter(p => p && Math.hypot(p.x - civilian.position.x, p.z - civilian.position.z) <= 4 &&
          !world.isDeepWater(p.x, p.z) && !circleBlocked(p.x, p.z, .45, movementObstacles(p.x, p.z)) &&
          !circleBlocked(p.x, p.z, .45, civilianNavigationLookup.at(p.x, p.z)) &&
          peers.every(other => other === civilian || Math.hypot(other.position.x - p.x, other.position.z - p.z) >= .74))
          .sort((a, b) => Math.hypot(a.x - civilian.position.x, a.z - civilian.position.z) -
            Math.hypot(b.x - civilian.position.x, b.z - civilian.position.z));
        for (const point of clear.slice(0, 2)) {
          const onward = world.civilianNavigate(point, data.waitingSlot);
          if (!onward.length) continue;
          civilian.position.set(point.x, world.groundHeight(point.x, point.z), point.z);
          recovery.relocations = (recovery.relocations ?? 0) + 1;
          path = onward;
          console.warn('Recovered obstructed civilian near its previous position', data.civilianId);
          break;
        }
      }
      if (path?.length) {
        installCivilianRecovery(data, path, time);
        civilian.visible = true;
        if (!peers.includes(civilian)) peers.push(civilian);
        if (recovery.attempts === 1) console.warn('Replanned stalled final civilian evacuation', data.civilianId);
      } else if (recovery.attempts === 1) console.warn('Final civilian recovery is waiting for a clear route', data.civilianId);
    }
    if (!data.active && civilian.visible && (!data.withdrawalWave || data.fleeReleased) &&
      frightenCivilian(data, civilian.position, combatSounds, time))
      data.releaseAt = Math.min(data.releaseAt, time);
    if (data.streetLife && !data.active && !data.streetEvacuating) {
      if (time < (data.startledUntil ?? 0)) {
        advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'startle' });
        continue;
      }
      const danger = civilian.visible ? updateCivilianThreatResponse(data, civilian.position, data.streetLife.exit,
        enemies, data.streetLife.navigationObstacles, time, visibleThreat, concealed,
        data.streetLife.navigationLookup,threatBudget) : null;
      if (!data.fleeReleased) {
        if (danger?.threats.length) advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'cower' });
        else updateCivilianStreetLife(civilian, time, dt, peers, world.doorSystem);
        continue;
      }
      if (time < data.releaseAt && !danger?.threats.length) {
        updateCivilianStreetLife(civilian, time, dt, peers, world.doorSystem);
        continue;
      }
      if (danger?.threats.length) data.releaseAt = time;
      beginCivilianStreetEvacuation(civilian);
    }
    if (!activateCivilianEvacuation(civilian, time, peers)) continue;
    frightenCivilian(data, civilian.position, combatSounds, time);
    if (time < (data.startledUntil ?? 0)) {
      data.restPoseWeight = Math.max(0, data.restPoseWeight - dt * 3);
      advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'startle' });
      continue;
    }
    if (data.fleeReleased && data.restPoseWeight > 0) {
      data.restPoseWeight = Math.max(0, data.restPoseWeight - dt / .9);
      advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'waiting' });
      continue;
    }
    let response = null;
    const routeTarget = data.arrived ? civilian.position : data.route[data.waypoint] ??
      (data.resting ? data.refugeeRestPoint : null);
    if (routeTarget) response = updateCivilianThreatResponse(data, civilian.position, routeTarget, enemies,
      data.streetEvacuating ? data.streetLife.navigationObstacles : world.civilianNavigationObstacles,
      time, visibleThreat, concealed, data.streetEvacuating ? data.streetLife.navigationLookup : civilianNavigationLookup,threatBudget);
    if (data.finalRecovery?.active) response = null;
    if (!data.arrived && routeTarget && !response?.threats.length &&
      time >= (data.routeRejoinAt ?? 0) &&
      !segmentClear(civilian.position, routeTarget, .36,
        data.streetEvacuating ? data.streetLife.navigationObstacles : world.civilianNavigationObstacles,
        data.streetEvacuating ? (x,z)=>data.streetLife.navigationLookup.at(x,z) : (x, z) => civilianNavigationLookup.at(x, z)) &&
      civilianCrowdPlanner.take()) {
      data.routeRejoinAt = time + 2;
      const path = rejoinCivilianRoute(civilian.position, routeTarget,
        data.streetEvacuating ? data.streetLife.navigate : world.civilianNavigate,
        data.streetEvacuating ? data.streetLife.navigationObstacles : world.civilianNavigationObstacles,
        data.streetEvacuating ? data.streetLife.navigationLookup : civilianNavigationLookup);
      if (path?.length) {
        data.routeRejoins = (data.routeRejoins ?? 0) + 1;
        data.route = [...path, ...data.route.slice(data.waypoint + 1)];
        data.waypoint = 0;
        data.crowdTarget = data.crowdPath = null;
        data.crowdStalled = data.crowdPathStalled = 0;
        if (response) response.nextThinkAt = 0;
      } else {
        data.routeRejoinFailures = (data.routeRejoinFailures ?? 0) + 1;
        if (data.routeRejoinFailures === 1) console.warn(`Civilian ${data.civilianId} cannot yet rejoin its evacuation path`);
      }
    }
    if (response?.mode==='flee'&&response.target&&civilian.position.distanceTo(new THREE.Vector3(response.target.x,
      civilian.position.y,response.target.z))<.3)response.nextThinkAt=Math.min(response.nextThinkAt,time+.15);
    if (response?.mode === 'cower') {
      data.restPoseWeight = Math.max(0, data.restPoseWeight - dt * 3);
      advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'cower' });
      continue;
    }
    if (data.resting && !data.fleeReleased && !response?.threats.length &&
      Math.hypot(civilian.position.x - data.refugeeRestPoint.x, civilian.position.z - data.refugeeRestPoint.z) < .15) {
      data.restPoseWeight = Math.min(1, data.restPoseWeight + dt / .8);
      civilian.rotation.y += Math.atan2(Math.sin(data.restHeading - civilian.rotation.y),
        Math.cos(data.restHeading - civilian.rotation.y)) * Math.min(1, dt * 3);
      advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'waiting' });
      continue;
    }
    if (response?.threats.length) data.restPoseWeight = Math.max(0, data.restPoseWeight - dt * 3);
    if (!data.arrived || response?.mode === 'flee') {
      const waypoints = data.route;
      frightenCivilian(data, civilian.position, combatSounds, time);
      const target = response?.mode === 'flee' ? response.target : waypoints[data.waypoint] ??
        (data.resting ? data.refugeeRestPoint : null);
      if (target) {
        const dx = target.x - civilian.position.x, dz = target.z - civilian.position.z;
        const distance = Math.hypot(dx, dz);
        const travel = Math.min(distance, civilianEscapeSpeed(data.ageGroup, Boolean(data.panicked)) *
          civilianPaceMultiplier(data.civilianId, time) * dt);
        if (distance > .01) {
          if (data.streetEvacuating && !openCivilianHomeDoor(civilian, world.doorSystem)) {
            for (const leg of civilian.civilianLegs) leg.rotation.x = 0;
            continue;
          }
          const beforeX = civilian.position.x, beforeZ = civilian.position.z;
          const threats = response?.threats ?? [];
          const moved = moveCivilianInCrowd(civilian, target, travel, peers,
            data.streetEvacuating ? data.streetLife.movementObstacles : movementObstacles(civilian.position.x, civilian.position.z),
            data.streetEvacuating ? data.streetLife.navigationObstacles : world.civilianNavigationObstacles,
            threats.length ? (from, to) => civilianStepAvoidsThreats(from, to, threats) : null, civilianCrowdPlanner);
          civilian.position.y = world.groundHeight(civilian.position.x, civilian.position.z);
          recordNanjingCivilianCityEntry(nanjingCampaign, civilian);
          advanceCivilianMotion(civilian, { dt, now: time, moved,
            dx: civilian.position.x - beforeX, dz: civilian.position.z - beforeZ,
            mode: threats.length ? moved > .001 ? 'flee' : 'cower' : 'route' });
        } else advanceCivilianMotion(civilian, { dt, now: time, moved: 0, mode: 'route' });
        if (!data.arrived && civilianWaypointReached(civilian.position, waypoints, data.waypoint,
          data.streetEvacuating ? data.streetLife.navigationObstacles : world.obstacles,
          data.streetEvacuating ? data.streetLife.navigationLookup : groundCollision)) data.waypoint++;
      }
      if (!data.arrived && data.waypoint >= waypoints.length) {
        if (data.openingWave && !data.fleeReleased) {
          data.resting = true;
          continue;
        }
        data.arrived = true;
        if (data.unrescued) continue;
        registerCivilianArrival(nanjingCampaign);
        queue.push(civilian);
        continue;
      }
    }
    if (data.arrived && !data.unrescued && civilian.parent === scene && response?.mode !== 'flee') {
      const anchor = data.route.at(-1), target = civilianWaitingDrift(data.civilianId, time, anchor);
      const beforeX = civilian.position.x, beforeZ = civilian.position.z;
      const moved = moveCivilianInCrowd(civilian, target, Math.min(.5 * dt,
        Math.hypot(target.x - beforeX, target.z - beforeZ)), peers,
        movementObstacles(beforeX, beforeZ), world.civilianNavigationObstacles,
        (_from, to) => !circleBlocked(to.x, to.z, .45, movementObstacles(to.x, to.z)));
      civilian.position.y = world.groundHeight(civilian.position.x, civilian.position.z);
      advanceCivilianMotion(civilian, { dt, now: time, moved,
        dx: civilian.position.x - beforeX, dz: civilian.position.z - beforeZ, mode: 'waiting' });
    }
  }

  const allArrivalsResolved = world.civilians.every(civilian => civilian.userData.arrived ||
    civilian.userData.dead || civilian.userData.unrescued);
  if (nanjingCampaign.dockActivated) nanjingCampaign.boardingClock = (nanjingCampaign.boardingClock ?? 0) + dt;
  const civilianSelection = selectCivilianBoarding(nanjingCampaign, world.ferries, queue, time);
  const troopsMayBoard = nanjingCampaign.stage === 'withdrawal-to-boats' &&
    nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready;
  for (const ferry of world.ferries) {
    const boatState = nanjingCampaign.boats[ferry.userData.ferryId];
    if (troopsMayBoard && ferry.userData.state === 'docked') {
      const personal = nanjingPlayerFerry() === ferry, player = controlledSoldier(entities);
      const playerAboard = player?.health > 0 && player.tactics.nanjingFerry?.phase === 'aboard' &&
        player.tactics.nanjingFerry.ferryId === ferry.userData.ferryId;
      const selected = nanjingPlayerFerry();
      const boarders = personal && !playerAboard ? player ? [player] : []
        : selected ? [...friendlyAI, ...allies.filter(actor => actor !== player)] : friendlyAI;
      const reserved = !selected && ferry === world.ferries[0];
      const canStart = !reserved || (ferry.userData.troopPassengers?.length ?? 0) < NANJING_BOAT_CAPACITY - 1;
      const started = !playerAboard && canStart && beginTroopFerryBoarding(ferry, boarders, time, (actor, shore) => {
        const path = rejoinCivilianRoute(actor.position, shore, world.civilianNavigate,
          world.civilianNavigationObstacles, civilianNavigationLookup);
        if (path === null) {
          if (time >= (actor.tactics.ferryRouteWarningAt ?? 0)) {
            actor.tactics.ferryRouteWarningAt = time + 10;
            console.warn(`友军 ${actor.id} 登船路径暂不可达：${world.civilianNavigate.stats.reason}`);
          }
          return null;
        }
        return path.map(point => ({ ...point, y: world.groundHeight(point.x, point.z) }));
      }, Boolean(selected));
      if (started && personal) startFinalBoardingFireBuffer(nanjingCampaign, player, time);
      const step = started ? null : advanceTroopFerryBoarding(ferry, dt);
      if (step?.moved > .001 && Math.floor(step.actor.walkPhase / Math.PI) !==
        Math.floor((step.actor.walkPhase - step.moved * 3.6) / Math.PI))
        tacticalAudio?.emit('deck-step', step.actor.position, time, step.actor.id);
      const ready = personal ? playerTroopFerryReady(ferry, player, nanjingCampaign)
        : !reserved && troopFerryReady(ferry, boarders, time);
      if (ready && !boatState.returning) {
        boatState.returning = true; boatState.departures++;
      }
    }
    if (ferry.userData.state === 'docked') {
      let boardingStarted = false;
      if (civilianSelection?.ferry === ferry) {
        const { civilian } = civilianSelection;
        const shore = { x: -72.2, z: ferry.position.z };
        const path = rejoinCivilianRoute(civilian.position, shore, world.civilianNavigate,
          world.civilianNavigationObstacles, civilianNavigationLookup);
        if (path === null) {
          (ferry.userData.civilianRouteRetry ??= new Map()).set(civilian.userData.civilianId, time + 10);
          console.warn(`No boarding route for civilian ${civilian.userData.civilianId}: ${world.civilianNavigate.stats.reason}`);
        } else {
          ferry.userData.civilianRouteRetry?.delete(civilian.userData.civilianId);
          queue.splice(queue.indexOf(civilian), 1);
          civilian.userData.boarding = true;
          civilian.userData.escapeMotion = null;
          civilian.userData.escapeMode = null;
          civilian.civilianSkin.joints.root.position.y = 0;
          const passengerIndex = ferry.userData.passengers.length;
          const seat = { x: ferry.position.x + (Math.floor(passengerIndex / 2) - 2) * .9,
            z: ferry.position.z + (passengerIndex % 2 ? .4 : -.4), y: ferry.position.y + NANJING_FERRY_FLOOR };
          ferry.userData.boarding = { civilian, path: [...path.map(point => ({ ...point, y: world.groundHeight(point.x, point.z) })),
            { x: -74.3, z: ferry.position.z, y: ferry.position.y + NANJING_FERRY_FLOOR }, seat] };
          boardingStarted = true;
        }
      }
      const boarding = ferry.userData.boarding;
      if (boarding && !boardingStarted) {
        const { civilian, path } = boarding;
        while (path.length > 1 && path[0].x >= -72.2 && path[1].x >= -72.2 &&
          civilianWaypointReached(civilian.position, path, 0, world.civilianNavigationObstacles,civilianNavigationLookup)) path.shift();
        const target = path[0];
        const delta = new THREE.Vector3(target.x, target.y, target.z).sub(civilian.position);
        const distance = delta.length(), travel = Math.min(distance, dt * civilianBoardingSpeed(civilian.userData.ageGroup));
        if (distance > .001) {
          const before = civilian.position.clone();
          if (target.x >= -72.2 && civilian.position.x >= -72.21) {
            const peers = world.civilians.filter(other => other.visible && other.parent === scene &&
              !other.userData.dead);
            moveCivilianInCrowd(civilian, target, travel, peers,
              movementObstacles(civilian.position.x, civilian.position.z), world.civilianNavigationObstacles, null, civilianCrowdPlanner);
            civilian.position.y = world.groundHeight(civilian.position.x, civilian.position.z);
          } else civilian.position.addScaledVector(delta, travel / distance);
          const moved = civilian.position.distanceTo(before);
          civilian.rotation.y = Math.atan2(-delta.x, -delta.z);
          const phaseBefore = civilian.userData.walkPhase;
          advanceCivilianMotion(civilian, { dt, now: time, moved,
            dx: civilian.position.x - before.x, dz: civilian.position.z - before.z, mode: 'boarding' });
          if (Math.floor(civilian.userData.walkPhase / Math.PI) > Math.floor(phaseBefore / Math.PI) && moved > .001 &&
            (world.groundSurface(civilian.position.x, civilian.position.z) === 'wood' || civilian.position.x < -72.2))
            tacticalAudio?.emit('deck-step', civilian.position, time, civilian.userData.civilianId);
        }
        if (civilian.position.distanceTo(new THREE.Vector3(target.x, target.y, target.z)) <
          (path.length === 1 ? 1e-5 : .015)) path.shift();
        if (!path.length && boardCivilian(nanjingCampaign, boatState.id)) {
          if (boatState.passengers === 1) ferry.userData.loadedAt = time;
          civilian.userData.escapeMotion = null; civilian.userData.escapeMode = null;
          for (const limb of [...civilian.civilianArms, ...civilian.civilianLegs]) limb.rotation.x = 0;
          if (civilian.civilianTorso) civilian.civilianTorso.rotation.x = 0;
          if (civilian.civilianTorso) civilian.civilianTorso.rotation.z = 0;
          if (civilian.civilianHead) civilian.civilianHead.rotation.set(0, 0, 0);
          const passengerIndex = ferry.userData.passengers.length;
          ferry.add(civilian);
          civilian.position.set((Math.floor(passengerIndex / 2) - 2) * .9, NANJING_FERRY_FLOOR, passengerIndex % 2 ? .4 : -.4);
          civilian.rotation.y = 0;
          ferry.userData.passengers.push(civilian);
          ferry.userData.boarding = null;
        }
      }
      if (nanjingCampaign.dockActivated && shouldDepartNanjingFerry(ferry, boatState, time, allArrivalsResolved, queue.length)) {
        departNanjingBoat(nanjingCampaign, boatState.id);
      }
      if (boatState.returning) {
        ferry.userData.state = 'outbound';
        ferry.userData.gangplank.visible = false;
      }
    } else if (ferry.userData.state === 'outbound') {
      ferry.position.x = Math.max(NANJING_FERRY_ROUTE.hiddenX, ferry.position.x - dt * NANJING_FERRY_ROUTE.speed);
      updateFerryVisibility(ferry);
      if (ferry.position.x <= NANJING_FERRY_ROUTE.hiddenX) {
        const troops = completeTroopFerryCrossing(ferry);
        if (troops.length) {
          const removed = new Set(troops);
          for (const actor of troops) {
            if (actor.tactics.cover) coverClaims.delete(actor.tactics.cover.id);
            pathRequests.delete(actor.tactics.id);
          }
          clearActors(troops.filter(actor => !actor.playerUnit));
          friendlyAI = friendlyAI.filter(actor => !removed.has(actor));
          rebuildForces();
        }
        completeNanjingCrossing(nanjingCampaign, boatState.id);
        for (const passenger of ferry.userData.passengers) {
          restoreFerryPassenger(passenger);
          passenger.userData.evacuated = true;
          passenger.removeFromParent();
          passenger.visible = false;
        }
        ferry.userData.passengers = [];
        ferry.userData.oar.visible = false;
        ferry.userData.state = 'offscreen';
        ferry.userData.returnAt = time + NANJING_FERRY_ROUTE.offscreenSeconds;
      }
    } else if (ferry.userData.state === 'offscreen') {
      if (time >= ferry.userData.returnAt) ferry.userData.state = 'inbound';
    } else if (ferry.userData.state === 'inbound') {
      ferry.position.x = Math.min(NANJING_DOCK.ferryX, ferry.position.x + dt * NANJING_FERRY_ROUTE.speed);
      updateFerryVisibility(ferry);
      if (ferry.position.x >= NANJING_DOCK.ferryX) {
        returnNanjingBoat(nanjingCampaign, boatState.id);
        ferry.userData.state = 'docked';
        ferry.userData.loadedAt = null;
        ferry.userData.troopsLoadedAt = null;
        ferry.userData.gangplank.visible = true;
      }
    }
    syncTroopFerryPassengers(ferry, entities.control.soldierId);
    syncTroopFerryCorpses(ferry, { dt, groundAt: (x, z, y) => world.walkHeight(x, z, y) });
    updateNanjingFerryRower(ferry, time);
    tacticalAudio?.rower(ferry, time, world.impactHeight, world.isDeepWater);
  }
  if (state === 'playing' && hasFerrySupport(controlledSoldier(entities))) updateCamera(0);
}

function updateProjectiles(dt) {
  for (const shell of [...shells]) {
    const event = shell.kind === 'grenade-discharger'
      ? advanceDischargerShell(shell, dt, (from, to) => traceDischargerSegment(from, to, shell))
      : advanceProjectile(shell, dt, (from, to) => {
      const origin = new THREE.Vector3(from.x, from.y, from.z);
      direction.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const travel = direction.length();
      if (travel <= .001) return null;
      ray.set(origin, direction.normalize()); ray.far = travel;
      const people = shell.source.weaponClass === 'field-gun'
        ? allForces.filter(actor => actor.health > 0 && !actor.vehicleId && actor.id !== shell.source.soldierId &&
          pointSegmentDistance(actor.position, origin, to).distance < 2)
          .map(actor => soldierHits.sync(actor, time)) : [];
      const hit = ray.intersectObjects([...solidIndex.candidates(origin, direction, travel)
        .filter(object => !shell.emplacementId || object.userData.emplacementId !== shell.emplacementId ||
          object.userData.emplacementCover), ...vehicleSolids(shell.source.vehicleId), ...people], true)[0];
      ray.far = Infinity;
      return hit?.point || null;
    });
    const shellView = shellViews.get(shell.id);
    if (shell.kind === 'grenade-discharger') updateGrenadeDischargerShellModel(shellView, shell);
    else shellView.position.copy(shell.position);
    if (event) {
      scene.remove(shellViews.get(shell.id));
      shellViews.delete(shell.id);
      shells.splice(shells.indexOf(shell), 1);
      projectileImpacts.push(event);
      if (projectileImpacts.length > 32) projectileImpacts.shift();
      explode(new THREE.Vector3(event.position.x, event.position.y, event.position.z), event.damage, event.radius, event.source,
        shell.blastKind ?? 'explosion');
    }
  }
}

function updateEffects(dt) {
  for (const effect of [...effects]) {
    if (time >= effect.end) {
      removeEffect(effect);
      continue;
    }
    const t = Math.max(0, (time - effect.bornAt) / effect.life);
    effect.lastAt = Math.max(time, effect.bornAt);
    effect.object.material.opacity = (1 - t) * .8;
  }
  combatFeedback.update(dt);
  $('damage-vignette').style.opacity = graphics.snapshot.effects.damageVignette ? String(combatFeedback.flash) : '0';
  $('hit-marker').style.opacity = time < combatFeedback.markerUntil ? '1' : '0';
  if (time >= toastUntil) $('toast').style.opacity = '0';
  mortarMarker.visible = state === 'playing' && unit.type === 'mortar';
  if (mortarMarker.visible) {
    mortarMarker.position.copy(getMortarTarget());
    $('aim-label').textContent = `弹着点 · ${Math.round(mortarMarker.position.distanceTo(camera.position))} 米`;
  }
}

function drawRadar(ctx = radarContext, deployment = false) {
  ctx.save();
  ctx.setTransform(ctx.canvas.width / 176, 0, 0, ctx.canvas.height / 176, 0, 0);
  const yaw = controlPose.yaw;
  const size = 176;
  const deploymentMap = ctx.canvas === $('deployment-map');
  const view = deploymentMapView(sihangCampaignMode ? 'sihang' : deploymentMap && nanjingCampaignMode ? nanjingCampaign.stage : null);
  const map = (x, z) => deploymentMapPoint(view, x, z, size);
  if (deploymentMap) {
    ctx.canvas.dataset.mapSpan = String(view.span);
    ctx.canvas.dataset.mapCenterX = String(view.x);
    ctx.canvas.dataset.mapCenterZ = String(view.z);
  }
  ctx.fillStyle = nanjingCampaignMode ? '#354435' : '#273328';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#a8b09316';
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 22) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }
  if (!nanjingCampaignMode && !sihangCampaignMode) {
    ctx.fillStyle = '#88785c';
    ctx.beginPath();
    for (const side of [-1, 1]) for (let i = 0; i <= 55; i++) {
      const x = side < 0 ? -110 + i * 4 : 110 - i * 4, section = riverSectionAt(x);
      const [px, pz] = map(x, section.centerZ + side * section.bankHalfWidth);
      if (side < 0 && i === 0) ctx.moveTo(px, pz);
      else ctx.lineTo(px, pz);
    }
    ctx.closePath(); ctx.fill();
  }
  if (sihangCampaignMode) {
    const rect = (minX, minZ, width, depth, color) => {
      const [x, z] = map(minX, minZ);
      ctx.fillStyle = color; ctx.fillRect(x, z, width / view.span * size, depth / view.span * size);
    };
    ctx.beginPath();
    for (let x = SIHANG_MAP_BOUNDS.minX; x <= SIHANG_MAP_BOUNDS.maxX; x += 4) {
      const [px, pz] = map(x, sihangRiverBounds(x).southZ);
      if (x === SIHANG_MAP_BOUNDS.minX) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    ctx.lineTo(...map(SIHANG_MAP_BOUNDS.maxX, SIHANG_MAP_BOUNDS.maxZ));
    ctx.lineTo(...map(SIHANG_MAP_BOUNDS.minX, SIHANG_MAP_BOUNDS.maxZ));
    ctx.closePath(); ctx.fillStyle = '#496f5344'; ctx.fill();
    ctx.beginPath();
    for (let x = SIHANG_MAP_BOUNDS.minX; x <= SIHANG_MAP_BOUNDS.maxX; x += 4) {
      const [px, pz] = map(x, sihangRiverBounds(x).northZ);
      if (x === SIHANG_MAP_BOUNDS.minX) ctx.moveTo(px, pz); else ctx.lineTo(px, pz);
    }
    for (let x = SIHANG_MAP_BOUNDS.maxX; x >= SIHANG_MAP_BOUNDS.minX; x -= 4)
      ctx.lineTo(...map(x, sihangRiverBounds(x).southZ));
    ctx.closePath(); ctx.fillStyle = '#3f788b'; ctx.fill();
    ctx.beginPath();
    for (const [index, [fraction, side]] of [[0, -1], [1, -1], [1, 1], [0, 1]].entries()) {
      const point = sihangBridgePoint(fraction, side * SIHANG_BRIDGE.width / 2), [x, z] = map(point.x, point.z);
      if (index) ctx.lineTo(x, z); else ctx.moveTo(x, z);
    }
    ctx.closePath(); ctx.fillStyle = '#c6b990'; ctx.fill();
    rect(SIHANG_WAREHOUSE.minX, SIHANG_WAREHOUSE.minZ, SIHANG_WAREHOUSE.width, SIHANG_WAREHOUSE.depth, '#9d8b73');
    ctx.fillStyle = '#eee1c2'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    const [wx, wz] = map(-4, -25); ctx.fillText('四行仓库', wx, wz);
    const [sx, sz] = map(-12, 45); ctx.fillText('中立租界', sx, sz);
    const [bx, bz] = map(SIHANG_BRIDGE.x, SIHANG_BRIDGE.z); ctx.fillText(SIHANG_BRIDGE.name, bx, bz);
  }
  ctx.fillStyle = '#abb39744';
  for (const b of world.obstacles) {
    if (sihangCampaignMode && b.water) continue;
    if (b.height < 2) continue;
    const [x, z] = map(b.minX, b.minZ);
    ctx.fillRect(x, z, (b.maxX - b.minX) / view.span * size, (b.maxZ - b.minZ) / view.span * size);
  }
  const [areaX, areaZ] = map(battleArea.minX, battleArea.minZ);
  const areaW = (battleArea.maxX - battleArea.minX) / view.span * size;
  const areaD = (battleArea.maxZ - battleArea.minZ) / view.span * size;
  ctx.fillStyle = '#b9574538';
  ctx.fillRect(0, 0, size, areaZ);
  ctx.fillRect(0, areaZ + areaD, size, size - areaZ - areaD);
  ctx.fillRect(0, areaZ, areaX, areaD);
  ctx.fillRect(areaX + areaW, areaZ, size - areaX - areaW, areaD);
  ctx.strokeStyle = '#e5a078';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(areaX, areaZ, areaW, areaD);
  ctx.setLineDash([]);
  if (nanjingCampaignMode) {
    const mapRect = (x, z, width, depth) => {
      const [left, top] = map(x - width / 2, z - depth / 2);
      return { left, top, width: width / view.span * size, height: depth / view.span * size };
    };
    ctx.fillStyle = '#24505d';
    ctx.strokeStyle = '#a1c0b766';
    ctx.lineWidth = 1;
    for (const river of world.landmarks.rivers) {
      const rect = mapRect(river.x, river.z, river.width, river.depth);
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
    ctx.fillStyle = '#b7c8b7';
    ctx.strokeStyle = '#193034';
    ctx.lineWidth = 2;
    ctx.font = 'bold 8px sans-serif';
    ctx.textAlign = 'center';
    for (const river of world.landmarks.rivers) {
      const [x, z] = map(river.x, river.z);
      if (river.id === 'yangtze-west') {
        ctx.save();
        ctx.translate(x, z);
        ctx.rotate(-Math.PI / 2);
        ctx.strokeText(river.name, 0, 3);
        ctx.fillText(river.name, 0, 3);
        ctx.restore();
      } else {
        ctx.strokeText(river.name, x, z + 3);
        ctx.fillText(river.name, x, z + 3);
      }
    }
    ctx.fillStyle = '#756954';
    for (const street of world.landmarks.cityStreets) {
      ctx.strokeStyle = '#a29475';
      ctx.lineWidth = street.width / view.span * size;
      ctx.beginPath();
      for (const [index, [x, z]] of street.points.entries()) {
        const [px, pz] = map(x, z);
        if (index === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.stroke();
    }
    for (const house of world.landmarks.residentialBuildings) {
      const rect = mapRect(house.x, house.z, house.width, house.depth);
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
    }
    for (const bridge of world.landmarks.bridges) {
      const width = bridge.axis === 'z' ? bridge.width : bridge.length;
      const depth = bridge.axis === 'z' ? bridge.length : bridge.width;
      const rect = mapRect(bridge.x, bridge.z, width, depth);
      ctx.fillStyle = '#aa9670';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = '#ded0a6';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
    const fort = world.landmarks.gatehouse.footprint;
    const fortRect = mapRect(0, world.landmarks.gatehouse.centerZ, fort.width, fort.length);
    ctx.fillStyle = '#344131';
    ctx.fillRect(fortRect.left, fortRect.top, fortRect.width, fortRect.height);
    ctx.strokeStyle = '#ead9ad';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(fortRect.left, fortRect.top, fortRect.width, fortRect.height);
    for (const wall of world.landmarks.cityWallSections) {
      const rect = mapRect((wall.minX + wall.maxX) / 2, (wall.minZ + wall.maxZ) / 2,
        wall.maxX - wall.minX, wall.maxZ - wall.minZ);
      ctx.fillStyle = '#746b51';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = '#c9b991';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
    for (const structure of world.landmarks.flankingStructures ?? []) {
      const rect = mapRect((structure.minX + structure.maxX) / 2, (structure.minZ + structure.maxZ) / 2,
        structure.maxX - structure.minX, structure.maxZ - structure.minZ);
      ctx.fillStyle = '#746b51';
      ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
      ctx.strokeStyle = '#c9b991';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
    for (const courtyard of world.landmarks.courtyards ?? []) {
      const rect = mapRect(0, courtyard.centerZ, courtyard.width, courtyard.depth);
      ctx.strokeStyle = '#d9c99e';
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    }
    ctx.strokeStyle = '#c9b991';
    ctx.lineWidth = 1.5;
    for (const gate of world.landmarks.gatehouse.gates) {
      const [, z] = map(0, gate.z);
      const left = map(-gate.width / 2, 0)[0], right = map(gate.width / 2, 0)[0];
      const gap = gate.opening / view.span * size, center = map(0, gate.z)[0];
      ctx.beginPath();
      ctx.moveTo(left, z); ctx.lineTo(center - gap / 2, z);
      ctx.moveTo(center + gap / 2, z); ctx.lineTo(right, z);
      ctx.stroke();
    }
    ctx.fillStyle = '#efe1bd';
    ctx.font = 'bold 8px sans-serif';
    const [gateX, gateZ] = map(0, 0);
    ctx.fillText('中华门', gateX, gateZ + 3);
  }
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  for (const point of objectives) {
    const [x, z] = map(point.x, point.z);
    ctx.fillStyle = point.status === 'contested' ? '#f6df92' : point.owner === 'friendly' ? '#9aaa78' : point.owner === 'enemy' ? '#ed9d8b' : '#d9bc7e';
    ctx.fillText(nanjingCampaignMode ? point.id === 'gate' ? '门' : '渡' : point.id, x, z);
    if (encirclementMode && encirclement.phase === 2) continue;
    ctx.fillStyle = '#9aaa78';
    ctx.fillRect(x - 6, z + 3, 12 * point.progress, 2);
    ctx.fillStyle = '#ed9d8b';
    ctx.fillRect(x - 6, z + 6, 12 * point.enemyProgress, 2);
  }
  if (encirclementMode && encirclement.phase === 2) {
    const [x, z] = map(EAST_BREAKOUT.x, EAST_BREAKOUT.z);
    ctx.strokeStyle = '#ffcc75'; ctx.fillStyle = '#ffcc75'; ctx.lineWidth = 2;
    ctx.strokeRect(x - 5, z - 7, 10, 14);
    ctx.beginPath(); ctx.moveTo(x + 5, z); ctx.lineTo(x + 16, z);
    ctx.lineTo(x + 12, z - 3); ctx.moveTo(x + 16, z); ctx.lineTo(x + 12, z + 3); ctx.stroke();
    ctx.fillText('东门阻击', x, z - 11);
  }
  const displayedSpawns = deploymentMap ? deploymentSpawnChoices(SQUADS[pendingSquad]?.type) : spawnPoints;
  for (const point of displayedSpawns) {
    if (point.enabled === false) continue;
    if (!deployment && !deploymentMap && point.aiOnly) continue;
    if (!nanjingCampaignMode && !deployment && !point.permanent) continue;
    if (point.kind === 'air' || (point.kind === 'rally' && point.health <= 0)) continue;
    if (point.team === 'enemy' && point.kind === 'rally' && allies[current]?.position.distanceTo(new THREE.Vector3(point.x, 0, point.z)) > 35) continue;
    const [x, z] = map(point.x, point.z);
    const blocked = deploymentMap && spawnBlockReason(point, SQUADS[pendingSquad].type,
      hostilePositions('friendly'), deploymentObstacles());
    ctx.fillStyle = blocked ? '#be8d76' : point.team === 'friendly' ? '#91bca1' : '#be8d76';
    ctx.fillRect(x - 2.5, z - 2.5, 5, 5);
    if (point.permanent) {
      ctx.fillText(point.objectiveId === 'A' ? '10' : point.objectiveId === 'B' ? '12' : '2', x, z - 5);
    }
    if (point.id === pendingSpawn) {
      ctx.strokeStyle = '#f7dfa1';
      ctx.strokeRect(x - 5, z - 5, 10, 10);
    }
  }
  const player = allies[current];
  if (!deployment && player?.health > 0) {
    const [x, z] = map(player.position.x, player.position.z);
    drawFacingSector(ctx, x, z, yaw);
  }
  const pendingRetreatIds = sihangCampaignMode && sihangCampaign.stage === 'sihang-retreat'
    ? new Set(sihangCampaign.retreatIds) : null;
  if (pendingRetreatIds) {
    for (const id of [...sihangCampaign.evacuatedIds, ...sihangCampaign.retreatLostIds]) pendingRetreatIds.delete(id);
  }
  for (const actor of friendlyForces) {
    if (actor.health <= 0) continue;
    const [x, z] = map(actor.position.x, actor.position.z);
    const pendingRetreat = pendingRetreatIds?.has(actor.id) ?? false;
    ctx.fillStyle = pendingRetreat ? '#ffd06a' : actor === allies[current] ? '#f6e0a9' : '#94bea1';
    if (pendingRetreat) {
      ctx.strokeStyle = '#302518';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, z, 4.5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(x, z, actor === allies[current] ? 3 : 2, 0, Math.PI * 2); ctx.fill();
  }
  for (const target of currentMissionTargets()) {
    const [x, z] = map(target.x, target.z);
    drawMissionMarker(ctx, x, z, size, target);
  }
  ctx.restore();
}

function currentMissionTargets() {
  if (sihangCampaignMode) return sihangCampaign.stage === 'sihang-retreat'
    ? !sihangCampaign.assemblyReleased
      ? [{ id: 'sihang-assembly', x: -4, z: -4, primary: true, label: '集', shortName: '前往仓库南面', color: '#ffdc7f' }]
      : [{ id: 'sihang-escape', x: SIHANG_EVACUATION.x, z: SIHANG_EVACUATION.z, primary: true, label: '撤', shortName: '西藏路桥撤离', color: '#ffdc7f' }]
    : [{ ...objectives[0], primary: true, label: '仓', shortName: '坚守仓库', color: '#8bd5ff' }];
  return missionTargets({ map: campaign.id, stage: nanjingCampaign?.stage, phase: encirclement.phase,
    objectives, player: allies[current]?.position, eastGate: EAST_BREAKOUT });
}

function renderMemberRoles(deployedType) {
  const container = $('members'), foot = ['infantry', 'mortar'].includes(deployedType);
  const signature = `${deployedType}:${allies.map(actor => actor.id).join('|')}`;
  if (container.dataset.signature !== signature) {
    container.replaceChildren(...allies.map(() => {
      const member = document.createElement('span'); member.className = 'member'; member.setAttribute('role', 'img'); return member;
    }));
    container.dataset.signature = signature;
  }
  allies.forEach((actor, index) => {
    const member = container.children[index], dead = actor.health <= 0;
    const seat = deployedType === 'tank' ? ['车长', '炮手', '驾驶员'][index] : '飞行员';
    const kind = foot ? actor.role : seat;
    if (member.dataset.kind !== kind) {
      if (foot) {
        const number = document.createElement('small'); number.className = 'member-index'; number.textContent = String(index + 1);
        member.replaceChildren(soldierRoleIcon(kind), number);
      } else member.textContent = seat;
      member.dataset.kind = kind;
    }
    const role = foot ? soldierRoleLabel(actor) : seat;
    member.title = `${index + 1}号 ${role} · ${dead ? '阵亡' : `生命 ${Math.ceil(actor.health)}`} · ${actor.mortar ? '按2选择迫击炮' : infantryWeaponProfile(actor.rifle).name}`;
    member.setAttribute('aria-label', member.title);
    member.setAttribute('aria-current', String(index === current));
    member.classList.toggle('active', index === current); member.classList.toggle('dead', dead);
  });
  const section = $('section-status'), actor = allies[current];
  section.hidden = deployedType !== 'infantry';
  if (!section.hidden) {
    const living = allies.filter(actor => actor.health > 0).length;
    const key = `${actor.role}:${living}:${allies.length}`;
    if (section.dataset.signature !== key) {
      section.replaceChildren(soldierRoleIcon(actor.role), document.createTextNode(`本班 ${living}/${allies.length}`));
      section.dataset.signature = key;
      section.title = soldierRoleLabel(actor); section.setAttribute('aria-label', `${soldierRoleLabel(actor)}，本班 ${living}/${allies.length}`);
    }
  }
}

function renderWeaponReload() {
  const tankReload = $('tank-reload');
  const actor = controlledSoldier(entities), fixed = emplacements.get(actor?.emplacementId);
  const weapon = fixed?.weapon ?? (unit.type === 'tank' ? occupiedVehicle(entities, actor)?.weapon : null);
  const cooldown = fixed ? emplacementCooldown(fixed, time) : null;
  const remaining = fixed ? cooldown?.remaining ?? 0 : weapon ? Math.max(0, weapon.reloadUntil - time) : 0;
  tankReload.hidden = remaining === 0;
  if (remaining > 0) {
    const duration = weapon.settings?.reload ?? TYPES.tank.reload;
    const progress = cooldown?.progress ?? Math.max(0, Math.min(1, 1 - remaining / duration));
    const label = cooldown?.mode === 'cooling' ? '冷却' : '装填';
    const name = fixed ? fixed.profile === 'bofors75' ? '山炮' : '机枪' : '主炮';
    tankReload.setAttribute('aria-label', `${name}${label}`);
    tankReload.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    tankReload.setAttribute('aria-valuetext', `${label}剩余 ${remaining.toFixed(1)} 秒`);
    $('tank-reload-label').textContent = label;
    $('tank-reload-progress').style.strokeDashoffset = String(100 * (1 - progress));
    $('tank-reload-time').textContent = `${remaining.toFixed(1)}s`;
  }

}

function renderAircraftControls() {
  const aircraft = occupiedVehicle(entities, controlledSoldier(entities));
  const visible = state === 'playing' && aircraft?.type === 'plane' && aircraft.health > 0;
  $('flight-status').hidden = !visible;
  $('flight-pointer').hidden = !visible || keys.has('KeyC');
  if (!visible) return;
  const control = aircraft.flightControl;
  $('flight-speed').textContent = `空速 ${Math.round(aircraft.speed * 3.6)} km/h`;
  $('flight-altitude').textContent = `离地 ${Math.max(0, Math.round(aircraft.position.y - world.groundHeight(aircraft.position.x, aircraft.position.z)))} m`;
  $('flight-throttle').textContent = `油门 ${Math.round(aircraft.throttle * 100)}%`;
  $('flight-status').classList.toggle('stalling', control.stalling);
  $('flight-warning').textContent = control.stalling ? '失速危险 · 松杆减小抬头、增加油门' :
    keys.has('KeyC') ? '环顾中 · 飞机继续飞行' : '圆圈为期望方向 · 机体逐渐跟随';
  if (keys.has('KeyC')) return;
  const point = new THREE.Vector3(-Math.sin(control.targetHeading) * Math.cos(control.targetPitch),
    Math.sin(control.targetPitch), -Math.cos(control.targetHeading) * Math.cos(control.targetPitch))
    .multiplyScalar(100).add(camera.position).project(camera);
  $('flight-pointer').style.left = `${THREE.MathUtils.clamp((point.x + 1) * 50, 4, 96)}%`;
  $('flight-pointer').style.top = `${THREE.MathUtils.clamp((1 - point.y) * 50, 4, 96)}%`;
}

function updateHUD() {
  renderSquadScores();
  const reason = currentWeaponRestriction(held.primary ? 'fire' : 'aim');
  const transport = occupiedVehicle(entities, allies[current]);
  const actionStatus = $('action-status');
  actionStatus.hidden = !reason || transport?.type === 'tank' && reason.code === 'reload' ||
    !(held.primary || held.aiming || reason.code === 'reload');
  actionStatus.textContent = actionStatus.hidden ? '' : reason.text;
  actionStatus.dataset.reason = actionStatus.hidden ? '' : reason.code;
  const tank = transport?.type === 'tank' ? transport : null;
  $('tank-orientation').hidden = !tank;
  $('tank-machine-gun').hidden = !tank;
  document.querySelector('.weapon-status .ammo').hidden = Boolean(tank && !occupiedSeat(entities).canFire);
  if (tank) {
    const heading = tankHeading(tank, controlPose.yaw);
    for (const name of ['hull', 'turret', 'north']) {
      $(`tank-${name}`).setAttribute('transform', `rotate(${heading[name]} 44 44)`);
      $(`tank-${name}`).dataset.heading = String(heading[name]);
    }
    const gun = tank.machineGuns.find(gun => gun.mount === 'coax');
    $('tank-machine-gun').textContent = occupiedSeat(entities).canFire
      ? `空格机枪 ${gun.reloadUntil ? '换带中' : `${gun.ammo}/${gun.settings.magazine}`}` : '驾驶席 · Y切换武器席';
  }
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const motion = allies[current].locomotion;
  const actor = allies[current], mount = actor.weaponMount;
  const support = $('weapon-support');
  const canMount = state === 'playing' && weaponSupportAvailable(actor);
  support.hidden = !canMount && !mount.active && actor.traversal.kind !== 'vaulting';
  support.textContent = actor.traversal.kind === 'vaulting' ? '翻越中 · 暂时无法射击'
    : mount.active ? '已架枪 · B 解除 · 移动自动解除'
    : canMount && currentMountCandidate(actor) ? 'B 架枪 · 依托掩体稳定射击' : '';
  if (!support.textContent) support.hidden = true;
  $('movement-status').hidden = !foot || motion.stamina >= .999 && !motion.exhausted;
  if (foot) {
    const names = { idle: '站定', walk: '慢走', jog: '慢跑', sprint: '负重冲刺', crouch: '蹲行', prone: '匍匐', aim: '谨慎移动', turn: '转向' };
    $('pace-label').textContent = motion.aimRecovery > 0 && !motion.sprinting ? '收枪恢复中' : names[motion.mode];
    $('stamina-fill').style.width = `${motion.stamina * 100}%`;
    $('stamina-meter').setAttribute('aria-valuenow', String(Math.round(motion.stamina * 100)));
    $('stamina-label').textContent = `${motion.exhausted ? '体力不足 · 恢复中' : '体力'} ${Math.round(motion.stamina * 100)}%`;
    $('movement-status').classList.toggle('exhausted', motion.exhausted);
  }
  const position = allies[current].position;
  if (sihangCampaignMode) {
    const defense = sihangCampaign.stage === 'sihang-defense', point = objectives[0];
    const wave = sihangCampaign.withdrawalWave;
    const waveIds = wave?.squads.flat() ?? [];
    const waveSaved = waveIds.filter(id => sihangCampaign.evacuatedIds.includes(id)).length;
    const waveLost = waveIds.filter(id => sihangCampaign.retreatLostIds.includes(id)).length;
    $('encirclement-warning').hidden = true;
    const retreat = sihangRetreatStatus(sihangCampaign);
    const assemblyRemaining = sihangWaveAssemblyRemaining(sihangCampaign);
    $('objectives').textContent = defense ? `四行仓库 · 参战 ${sihangCampaign.deployed}/400 · 后备 ${sihangCampaign.reserve}`
      : `将士400 · 牺牲 ${retreat.casualties} · 撤离 ${retreat.saved} · 尚未撤离 ${retreat.unresolved}`;
    $('objective-title').textContent = defense ? '第一阶段 · 坚守仓库' : wave
      ? `第${wave.number}批 · ${waveIds.length}人 · 已撤${waveSaved} · 阵亡${waveLost}`
      : '第二阶段 · 掩护过桥撤离';
    const demolitionDistance = Math.round(Math.hypot(position.x - SIHANG_DEMOLITION_POINT.x,
      position.y - SIHANG_DEMOLITION_POINT.y, position.z - SIHANG_DEMOLITION_POINT.z));
    $('objective-help').textContent = defense
      ? sihangCampaign.demolition.state === 'armed'
        ? `北墙炸药 · ${demolitionDistance}米 · 引信${Math.ceil(sihangCampaign.demolition.fuseRemaining)}秒 · 按住F拆除${SIHANG_RULES.defuseSeconds}秒（拆除时暂停引信）`
        : sihangCampaign.demolition.state === 'installing'
          ? `北墙爆破点 · ${demolitionDistance}米 · 安装${sihangCampaign.demolition.installProgress.toFixed(1)}/${SIHANG_RULES.installSeconds}秒 · 立即阻止！`
          : sihangCampaign.northWallBreached ? '北墙已被炸开 · 日军正从缺口突入！守住一楼，继续坚持到撤退命令'
          : point.status === 'contested' ? '一楼争夺中 · 守军在区域内可中断占领'
            : '守住一楼 · 阻止北墙爆破 · 一楼出生，楼梯通往窗口与屋顶'
      : !sihangCampaign.assemblyReleased
        ? '前往仓库南面 · 抵达后首批撤退'
        : wave?.phase === 'interval'
          ? `本批结束 · 间隔 ${Math.max(0, Math.ceil(wave.completedAt + SIHANG_RULES.waveInterval - sihangCampaign.elapsed))}秒 · 下一批集结${assemblyRemaining === null ? '' : ` ${Math.ceil(assemblyRemaining)}秒`}`
          : wave?.phase === 'main'
            ? assemblyRemaining !== null
              ? `本批撤退 · 下一批集结倒计时 ${Math.ceil(assemblyRemaining)}秒 · 待本批结束后出发`
              : wave.covering ? '其他队过桥 · 掩护队留守 · 南岸禁火' : '本批共同撤退 · 南岸禁火'
            : wave?.phase === 'cover'
                  ? assemblyRemaining !== null
                    ? `掩护队撤离 · 下一批集结倒计时 ${Math.ceil(assemblyRemaining)}秒 · 南岸禁火`
                    : '掩护队撤离 · 南岸禁火'
              : sihangCampaign.withdrawalWaveNumber === 0
                ? '等待友军补充 · 首批人员就绪后撤退 · 南岸禁火'
              : assemblyRemaining !== null && assemblyRemaining > 0
                ? `下一批集结 · 最迟${Math.ceil(assemblyRemaining)}秒后撤退 · 后备 ${retreat.waiting}`
                : `下一批集结 · 等待队员补充 · 后备 ${retreat.waiting} · 南岸禁火`;
    document.querySelector('.objective-banner').hidden = false;
    document.querySelector('.capture-track').hidden = !defense;
    $('capture-fill').style.width = `${Math.max(0, -point.control) * 100}%`;
    $('capture-fill').style.background = '#ed9d8b';
  } else if (!nanjingCampaignMode) {
  const distanceToPoint = point => (position.x - point.x) ** 2 + (position.z - point.z) ** 2;
  const active = objectives.reduce((nearest, point) => distanceToPoint(point) < distanceToPoint(nearest) ? point : nearest);
  const ownerLabel = point => point.owner === 'friendly' ? '我方控制' : point.owner === 'enemy' ? '日军控制' : '中立';
  const controlCount = team => objectives.filter(point => point.owner === team).length;
  const defeatWarning = $('encirclement-warning');
  const showDefeatWarning = encirclementMode && encirclement.phase === 1 && !encirclement.winner && controlCount('enemy') === 3 &&
    ['playing', 'transferring', 'dead'].includes(state);
  defeatWarning.hidden = !showDefeatWarning;
  if (showDefeatWarning) {
    const seconds = Math.max(0, Math.ceil(ENCIRCLEMENT_RULES.defeatGraceSeconds - encirclement.enemyControlSeconds));
    const text = `战线告急 · ${seconds}秒内中和或夺回任一据点，否则作战失败`;
    if (defeatWarning.textContent !== text) defeatWarning.textContent = text;
  }
  $('objectives').innerHTML = `<span class="control-count friendly" aria-label="我方控制${controlCount('friendly')}点">我 ${controlCount('friendly')}</span>` +
    objectives.map(point => {
      const label = `${point.id} ${ownerLabel(point)}${point.status === 'contested' ? ' · 争夺中' : ''} · 我方 ${Math.round(point.progress * 100)}% / 日军 ${Math.round(point.enemyProgress * 100)}%`;
      return `<span class="objective-chip ${point.owner === 'friendly' ? 'captured' : point.owner === 'enemy' ? 'enemy' : 'neutral'} ${point.status === 'contested' ? 'contested' : ''}" role="img" aria-label="${label}" title="${label}">${point.id}<small class="point-progress" aria-hidden="true"><i style="width:${point.progress * 100}%"></i><b style="width:${point.enemyProgress * 100}%"></b></small></span>`;
    }).join('') + `<span class="control-count enemy" aria-label="日军控制${controlCount('enemy')}点">敌 ${controlCount('enemy')}</span>`;
  const inCaptureArea = unit.type !== 'plane' && (!active.captureArea || !transport) && objectiveContainsPosition(active, position);
  document.querySelector('.capture-track').hidden = !(encirclementMode && encirclement.phase === 2) && !inCaptureArea;
  $('objective-title').textContent = encirclementMode && encirclement.phase === 2 ? '第二阶段 · 全歼日军'
    : inCaptureArea ? `${active.id} · ${active.name} · ${ownerLabel(active)}` : encirclementMode ? '第一阶段 · 三点合围' : '三据点争夺';
  const domination = conquest.dominationTeam ? ` · ${conquest.dominationTeam === 'friendly' ? '我方' : '日军'}全控 ${Math.floor(conquest.dominationTime)}/${DOMINATION_SECONDS}秒` : '';
  document.querySelector('.objective-banner').hidden = !encirclementMode && !inCaptureArea && !conquest.dominationTeam;
  $('objective-help').textContent = !encirclementMode
    ? `${inCaptureArea ? '进入范围占领' : '保持全点控制20秒获胜'}${domination}`
    : encirclement.phase === 2 ? `地面残敌 ${encirclementGroundEnemies(formations)} 人`
      : inCaptureArea ? active.status === 'contested' ? '争夺中 · 清除据点内敌军' : '占领 / 反夺据点'
        : active.captureArea && distanceToPoint(active) < 25 ? '进入A高楼内部才能占领' : '';
  $('capture-fill').style.width = `${Math.abs(active.control) * 100}%`;
  $('capture-fill').style.background = active.control < 0 ? '#ed9d8b' : '#9aaa78';
  if (encirclementMode && encirclement.breakout) {
    const breakout = encirclement.breakout;
    $('objectives').textContent = `地面编制 ${breakout.strength}人 · 已歼 ${breakout.killed}/${breakout.requiredKills} · 逃出 ${breakout.escapedIds.length}/${breakout.escapeLimit}`;
    $('objective-title').textContent = breakout.elapsed<EAST_BREAKOUT.regroupSeconds
        ? `C点布防倒计时 ${Math.max(0, Math.ceil(EAST_BREAKOUT.regroupSeconds - breakout.elapsed))}秒`
        : breakout.reinforcing?'日军仍在集结 · 守住C点':'日军分组突围 · 守住C点东门';
    const status=breakout.objectiveStatus==='achieved'?'歼敌目标达成 · 继续清剿':
      breakout.objectiveStatus==='failed'?'阻击目标失败 · 继续作战':'守住东门';
    $('objective-help').textContent = `${status} · 剩余 ${breakout.remaining??encirclementGroundEnemies(formations)}人 · 东门 ${Math.round(Math.hypot(position.x-EAST_BREAKOUT.x,position.z-EAST_BREAKOUT.z))}米`;
    document.querySelector('.objective-banner').hidden = false;
    $('capture-fill').style.width = `${breakout.requiredKills ? Math.min(100, breakout.killed / breakout.requiredKills * 100) : 100}%`;
  }
  } else {
    document.querySelector('.capture-track').hidden = false;
    const stageNames = {
      'gate-defense': ['第一阶段 · 中华门防守', '守住第二道门内西侧阵地 · 坚守3分钟'],
      withdrawal: ['撤退阶段 · 前往西北上新河渡口', '先向北穿过城内街区，再向西抵达渡口 · 抵达后开始第二阶段'],
      'dock-defense': ['第二阶段 · 上新河渡口', '掩护百姓登船 · 坚守3分钟'],
      'withdrawal-to-boats': ['撤退阶段 · 登船撤离', '掩护友军登船，随后撤离南京'],
    };
    const [title, help] = stageNames[nanjingCampaign.stage];
    const aiBoarded = nanjingAIBoardedCount(nanjingCampaign);
    const civilianEvacuation = nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians);
    const gateThreat = nanjingCampaign.gateCaptureSeconds > 0;
    const gateLabel = nanjingCampaign.gateContested ? '门内争夺中 · 占领中断' : gateThreat
      ? `日军正在夺门 · ${Math.ceil(NANJING_GATE_CAPTURE_SECONDS - nanjingCampaign.gateCaptureSeconds)}秒后城门失守`
      : '守住第二道门内左侧（西侧） · 日军独占20秒将失守';
    $('objectives').innerHTML = `<span class="control-count friendly">南京保卫战</span>` +
      `<span class="objective-chip ${gateThreat ? 'enemy' : 'captured'}" aria-label="中华门第二道门内西侧">门</span>` +
      `<span class="objective-chip neutral" aria-label="上新河渡口">渡</span>`;
    $('objective-title').textContent = title;
    document.querySelector('.objective-banner').hidden = false;
    $('objective-help').textContent = nanjingCampaign.stage === 'gate-defense' ? `${gateLabel} · 百姓已安全进城 ${nanjingCampaign.civiliansEnteredCity} · 遭日军残害致死 ${nanjingCampaign.civilianCasualties}`
      : nanjingCampaign.stage === 'dock-defense' ? `百姓撤离 · 已过江 ${civilianEvacuation.evacuated} · 在途 ${civilianEvacuation.enRoute} · 候船 ${civilianEvacuation.waiting} · 在船 ${civilianEvacuation.aboard} · 被日军击毙 ${nanjingCampaign.civilianCasualties}`
        : nanjingCampaign.stage === 'withdrawal-to-boats'
          ? !civilianEvacuation.ready
            ? `百姓撤离 · 已过江 ${civilianEvacuation.evacuated} · 在途 ${civilianEvacuation.enRoute} · 候船 ${civilianEvacuation.waiting} · 在船 ${civilianEvacuation.aboard} · 被日军击毙 ${nanjingCampaign.civilianCasualties}${!nanjingCampaign.finalShoreWaitExpired ? ` · 等待 ${Math.max(0, Math.ceil(NANJING_CIVILIAN_FINAL_WAIT - nanjingCampaign.finalWithdrawalElapsed))}秒` : ''}`
            : nanjingPlayerFerry() ? '正在登船 · 上船后立即离岸'
              : nanjingAISquadsBoarded(nanjingCampaign) ? nanjingCampaign.requiredAISquads === 0
                ? '撤离条件已满足 · 靠近木船按F登船'
                : '友军已登船 · 随后登船撤离南京'
                : `掩护友军登船 ${aiBoarded}/${nanjingCampaign.requiredAISquads} · 随后撤离南京` : help;
    if (nanjingCampaign.stage === 'withdrawal-to-boats' && civilianEvacuation.ready)
      $('objective-help').textContent += ` · 百姓已过江 ${civilianEvacuation.evacuated} · 被日军击毙 ${nanjingCampaign.civilianCasualties}`;
    if (nanjingCampaign.stage === 'withdrawal-to-boats' && nanjingCampaign.civiliansUnrescued > 0)
      $('objective-help').textContent += ` · 未救出 ${nanjingCampaign.civiliansUnrescued}`;
    $('capture-fill').style.width = `${nanjingCampaign.stage === 'gate-defense'
      ? nanjingCampaign.gateCaptureSeconds / NANJING_GATE_CAPTURE_SECONDS * 100
      : Math.min(100, aiBoarded / Math.max(1, nanjingCampaign.requiredAISquads) * 100)}%`;
    $('capture-fill').style.background = gateThreat ? '#ed9d8b' : '#9aaa78';
  }
  $('objective-help').hidden = !$('objective-help').textContent;
  const timedDefense = sihangCampaignMode ? sihangCampaign.stage === 'sihang-defense'
    : !nanjingCampaignMode || ['gate-defense', 'dock-defense'].includes(nanjingCampaign.stage);
  const timerLabel = sihangCampaignMode ? sihangCampaign.stage === 'sihang-defense' ? '仓库防守倒计时' : '夜间撤离 · 无时限'
    : !nanjingCampaignMode ? encirclementMode ? '作战时间' : '剩余作战时间'
    : nanjingCampaign.stage === 'gate-defense' ? '中华门防守倒计时'
      : nanjingCampaign.stage === 'dock-defense' ? '渡口防守倒计时' : '撤退阶段';
  $('timer-label').textContent = timerLabel;
  $('timer').setAttribute('aria-label', timerLabel);
  const clockTime = encirclementMode ? time : remaining;
  $('timer').textContent = timedDefense
    ? `${String(Math.floor(clockTime / 60)).padStart(2, '0')}:${String(Math.floor(clockTime % 60)).padStart(2, '0')}`
    : '--:--';
  $('ammo').textContent = toolEquipped ? String(allies[current].engineer?.kits ?? allies[current].mortar.ammo) : dadaoEquipped ? '近战' : grenadeEquipped ? String(selectedThrowable === 'explosive-pack' ? allies[current].grenades.packs : allies[current].grenades.ammo) : unit.reloadUntil ? '装填' : String(unit.ammo);
  $('ammo-max').textContent = toolEquipped ? `/ ${allies[current].engineer ? ENGINEER.kits : MORTAR.ammo}` : dadaoEquipped ? '3 · 大刀' : `/ ${grenadeEquipped ? GRENADE.count : unit.type === 'infantry' ? infantryWeaponProfile(allies[current].rifle).magazine : TYPES[unit.type].magazine}`;
  const fixed = emplacements.get(actor.emplacementId);
  if (fixed) {
    $('ammo').textContent = fixed.weapon.reloadUntil ? '装填' : fixed.overheated ? '过热' : String(fixed.weapon.ammo);
    $('ammo-max').textContent = `/ 备用 ${fixed.weapon.reserve}${fixed.profile === 'maxim24' ? ` · 热量 ${Math.round(fixed.heat * 100)}%` : ''}`;
    if(fixed.profile==='bofors75')$('weapon-name').textContent=`${fixed.weapon.settings.name} · ${fixed.position==='march'?'行军位 · 1炮手':'炮手位 · 2行军'}`;
    $('weapon-name').textContent = EMPLACEMENT_PROFILES[fixed.profile].name;
  }
  $('ammo').style.fontSize = dadaoEquipped || !grenadeEquipped && unit.reloadUntil ? '25px' : '';
  const health = occupiedVehicle(entities, allies[current])?.health ?? allies[current].health;
  $('health-fill').style.width = `${health / TYPES[unit.type].health * 100}%`;
  $('health-text').textContent = deathTransfer.active && !deathTransfer.handedOff
    ? `队员阵亡${occupiedVehicle(entities, allies[current]) ? ` · 车体 ${Math.ceil(health)}` : ''}`
    : `${unit.type === 'tank' ? '装甲' : '生命'} ${Math.ceil(health)}`;
  const deployedType = entities.units.get(entities.control.unitId).type;
  $('members').classList.toggle('platoon-members', deployedType === 'infantry');
  renderMemberRoles(deployedType);
  const primaryMission = currentMissionTargets().find(target => target.primary), missionLabel = $('minimap-mission');
  missionLabel.hidden = !primaryMission;
  if (primaryMission) {
    const distance = Math.round(Math.hypot(position.x - primaryMission.x, position.z - primaryMission.z));
    const text = `${primaryMission.shortName} · ${distance}米`;
    if (missionLabel.textContent !== text) missionLabel.textContent = text;
    missionLabel.style.color = primaryMission.color;
    $('radar').setAttribute('aria-label', `战术简图，当前目标${primaryMission.shortName}，距离${distance}米，醒目旗标表示任务位置`);
  }
  const scenarioLabel = benchmark?.diagnostic ? benchmark.scenario === 'cover' ? '掩体交互诊断 · 非交火基准　' : benchmark.scenario === 'shop-art' ? '首街美术样例 · 非战斗诊断　' : benchmark.scenario === 'ford' ? '干河床坦克通行诊断 · 非交火基准　' : benchmark.scenario === 'control' ? 'G2控制诊断 · 非正式人口　' : benchmark.scenario === 'bridge' ? '桥面几何诊断 · 非交火基准　' : benchmark.scenario === 'interior' ? '门与室内几何诊断 · 非交火基准　' : '5v5诊断 · 非正式人口　' : '';
  const isolationLabel = benchmark?.renderIsolation && benchmark.renderIsolation !== 'normal'
    ? `渲染隔离诊断 · ${benchmark.renderIsolationAt}秒后${benchmark.renderIsolation === 'no-draw' ? '停止绘制' : '隐藏第三人称人物'} · 战斗模拟继续　` : '';
  const diagnosticLabel = isolationLabel + scenarioLabel;
  const audioLabel = audioUnsupported ? '音效不可用　'
    : `${sihangVoicesFailure ? '四行仓库指挥与百姓语音不可用（文字警报保留）　' : ''}${tacticalAudioFailure ? '弹道与接触音效未加载　' : ''}${vehicleAudioFailure ? '载具引擎未加载　' : ''}${battleSignalsFailure ? '日军进攻哨声未加载　' : ''}${rifleAudioFailure ? '步枪录音未加载（原合成声）　' : ''}${footstepAudioFailure ? '脚步录音未加载（原合成声）　' : ''}${mechanicalAudioFailure ? '步枪机械录音未加载（原合成声）　' : ''}${battleVoicesFailure ? '战场语音不可用　' : ''}${battleReactionsFailure ? '真人战斗反应不可用　' : ''}`;
  $('hud-notice').hidden = !audioLabel && !diagnosticLabel;
  $('hud-notice').textContent = audioLabel + diagnosticLabel;
  if (!$('scoreboard').hidden) {
    $('scoreboard-clock').textContent = $('timer').textContent;
    const points = $('scoreboard-objectives'); points.replaceChildren();
    for (const point of objectives) {
      const chip = document.createElement('span'); chip.className = `score-point ${point.owner ?? 'neutral'}`;
      chip.textContent = point.id; chip.title = `${point.id} ${point.owner === 'friendly' ? '我军' : point.owner === 'enemy' ? '日军' : '中立'}`;
      points.append(chip);
    }
    const summary = $('scoreboard-stats'); summary.replaceChildren();
    const enemyTotal = battleStats.snapshot.filter(row => row.team === 'enemy').reduce((total, row) => total + row.total, 0);
    for (const [kind, value, label] of [['total', kills + teamKills, '我军人员击杀'], ['total', enemyTotal, '日军人员击杀']]) {
      const chip = document.createElement('span'); chip.title = label; chip.setAttribute('aria-label', `${label} ${value}`);
      chip.className = label.startsWith('我军') ? 'friendly-total' : 'enemy-total';
      chip.append(scoreIcon(kind), document.createTextNode(String(value))); summary.append(chip);
    }
  }
  const feedEntries = combatFeedback.entries(time);
  const feedKey = feedEntries.map(entry => `${entry.targetId}:${entry.until}:${entry.text}:${entry.icon}`).join('|');
  if (feedKey !== renderedFeedKey) {
    renderedFeedKey = feedKey;
    $('kill-feed').replaceChildren(...feedEntries.map(entry => {
      const row = document.createElement('span');
      row.className = 'feed-entry'; row.setAttribute('role', 'img'); row.setAttribute('aria-label', entry.text);
      const attacker = document.createElement('span'), target = document.createElement('span');
      attacker.className = `feed-actor ${entry.sourceTeam}`; attacker.textContent = entry.attacker;
      target.className = `feed-actor ${entry.targetTeam}`; target.textContent = entry.target;
      const icon = scoreIcon(entry.icon);
      row.title = entry.weaponLabel;
      row.append(attacker, icon, target);
      return row;
    }));
  }
  drawRadar();
}

function updateDoorPrompt() {
  const prompt = $('interaction-prompt');
  const demolitionPrompt = sihangCampaignMode && state === 'playing' ? sihangCombat.prompt(sihangCampaign, controlledSoldier(entities)) : null;
  if (demolitionPrompt) { prompt.hidden = false; prompt.textContent = demolitionPrompt; return; }
  const usable = state === 'playing' && (unit?.type === 'infantry' || unit?.type === 'mortar') && !toolEquipped;
  const door = usable ? world.doorSystem.focus(camera) : null;
  const transport = state === 'playing' ? occupiedVehicle(entities, allies[current]) : null;
  const nearby = usable && !door ? groundVehicleFocus() : null;
  const fixed = emplacements.get(allies[current]?.emplacementId) ?? focusEmplacement(allies[current]);
  if (fixed && usable) {
    prompt.hidden = false;
    prompt.textContent = allies[current].emplacementId ? 'F 离开阵地 · R 装填 · 右键瞄准'
      : canOperateEmplacement(fixed, allies[current]) ? `F 操作 ${EMPLACEMENT_PROFILES[fixed.profile].name}`
      : '只能操作我军工兵建造的火炮或指定防御炮位';
    return;
  }
  if (usable && nanjingCampaign?.stage === 'withdrawal-to-boats' && world.ferries.some(ferry =>
    ferry.userData.state === 'docked' && ferry.position.distanceTo(allies[current].position) <= 4)) {
    const ready = nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians).ready;
    const alliesReady = nanjingAISquadsBoarded(nanjingCampaign);
    prompt.hidden = false;
    prompt.textContent = nanjingPlayerFerry() ? '正在登船 · 上船后立即离岸'
      : !ready ? '继续掩护百姓过江' : !alliesReady ? '继续掩护友军登船' : 'F 登船 · 上船后立即离岸';
    return;
  }
  prompt.hidden = !door && !transport && !nearby;
  prompt.textContent = transport ? transport.type === 'tank' ? 'F 离开当前席位 · 原车保留' : '空中离机尚未实现'
    : door ? `F  ${Math.abs(door.targetAngle) < .01 ? '开门' : '关门'}${door.blocked ? ' · 门后受阻，移开后继续' : ''}`
    : nearby ? 'F 返回原车空余席位' : '';
}

function menuCamera(now) {
  const t = now * .000035;
  camera.position.set(47 + Math.sin(t) * 4, 19, 70 + Math.cos(t) * 4);
  camera.lookAt(-9, 2, -1);
  camera.fov = 55;
  camera.updateProjectionMatrix();
}

function advanceBattleStep(dt, presentationTime) {
  time += dt;
  for (const actor of allForces) if (actor.health > 0) {
    if (dyingExpired(actor, time)) {
      const dying = actor.dying;
      actor.dying = null; actor.health = 0;
      battleStats.consume(combatEvents.publish('damage', { source: dying.source,
        target: { kind: 'soldier', id: actor.id, unitId: actor.unitId, team: actor.team },
        amount: 1, health: 0, observerId: actor.id }, time));
      beginDeathFeedback(actor, dying.reason);
      finishActorDeath(actor, dying.source);
    } else if (actor.blastReaction) {
      advanceBlastReaction(actor, dt, (dx, dz) => {
        moveGround(actor.position, dx, dz, .46, movementObstacles(actor.position.x, actor.position.z));
        actor.position.y = landingHeight(actor.position, actor.position.y,
          movementObstacles(actor.position.x, actor.position.z), world.walkHeight);
      });
    }
  }
  for (const actor of allForces) if (actor.health > 0 && fatalFallExpired(actor, time))
    hurt(actor, actor.health, { credit: 'environment', cause: 'fall', subjectId: actor.id }, 'fall');
  for (const point of emplacements.values()) {
    advanceEmplacement(point, dt, time); point.view.userData.update();
  }
  if (nanjingCampaignMode) {
    advanceNanjingCampaign(nanjingCampaign, dt);
    remaining = nanjingCampaign.stageRemaining;
  } else if (!sihangCampaignMode) remaining = Math.max(0, remaining - dt);
  let started = benchmark ? performance.now() : 0;
  performanceDiagnostics.measure('doors', () => {
    const doorOccupants = allForces.filter(actor => actor.health > 0 && occupiedVehicle(entities, actor)?.type !== 'plane').map(actor => ({
      x: actor.position.x, y: actor.position.y, z: actor.position.z, radius: actor.vehicleId && occupiedVehicle(entities, actor).type === 'tank' ? 1.9 : .42,
    }));
    if (nanjingCampaignMode || sihangCampaignMode) for (const civilian of world.civilians) {
      if (civilian.visible && civilian.parent === scene && !civilian.userData.dead)
        doorOccupants.push({ x: civilian.position.x, y: civilian.position.y, z: civilian.position.z, radius: .36 });
    }
    world.doorSystem.update(dt, doorOccupants);
  });
  if (benchmark) { telemetry.add('doorsMs', performance.now() - started); started = performance.now(); }
  const tankStarts = new Map([...entities.vehicles.values()].filter(vehicle => vehicle.type === 'tank' && vehicle.health > 0)
    .map(vehicle => [vehicle.id, { ...vehicle.position, heading: vehicle.heading }]));
  performanceDiagnostics.measure('vehicles', () => {
    updateVehicles(dt);
    updateTankContacts(tankStarts, dt);
    vehicleRenderer.update(entities.vehicles.values(), time, occupiedVehicle(entities, controlledSoldier(entities))?.id);
  });
  performanceDiagnostics.measure('player', () => {
    updateWeaponSimulation(dt);
    if (state === 'playing') updatePlayer(dt);
  });
  for (const actor of allForces) if (actor.health > 0 && !actor.vehicleId &&
    actor !== controlledSoldier(entities) && actor.traversal.kind !== 'grounded') updateActorTraversal(actor, dt);
  if (sihangCampaignMode) performanceDiagnostics.measure('sihangDemolition', () => {
    const player = controlledSoldier(entities);
    const defuseKeys = keys.has('KeyF') && (held.primary || player?.locomotion.speed > .1 ||
      player?.traversal.kind !== 'grounded' || player?.grenades.action)
      ? new Set([...keys].filter(key => key !== 'KeyF')) : keys;
    const event = sihangCombat.update(dt, time, { campaign: sihangCampaign, actors: allForces,
      player, keys: defuseKeys, shots: combatEvents.snapshot.history });
    if (event === 'withdrawn') {
      for (const formation of formations.filter(item => item.sihangDemolition)) {
        for (const actor of formation.members) actor.tactics.sihangDemolitionReturned = true;
        replaceSihangDemolition(formation);
      }
      sihangCombat.update(0, time, { campaign: sihangCampaign, actors: allForces, player, keys: defuseKeys });
    } else if (event) {
      toast({ installing: '日军正在北墙安装炸药！', armed: '北墙炸药已安装！靠近按住F拆除。',
        disarmed: '炸药已拆除 · 继续守住北墙', detonated: '北墙被炸开！守住一楼缺口！' }[event], 6);
      if (event === 'detonated') {
        world.breachNorthWall();
        solidIndex.synchronize(world.solids);
        squadRoutes.clear(); pathRequests.clear();
        navigate.refreshMany([{ minX: -5, maxX: 5, minZ: -43, maxZ: -41 }]);
        groundCollision.rebuild(); aircraftCollision.rebuild();
        armorNavigate.refreshMany([{ minX: -5, maxX: 5, minZ: -43, maxZ: -41 }]);
        for (const actor of allForces) {
          actor.path = actor.pathGoal = null; actor.nextPath = 0;
        }
        sihangCombat.update(0, time, { campaign: sihangCampaign, actors: allForces, player, keys: defuseKeys });
        combatEffects.explosion(new THREE.Vector3(SIHANG_DEMOLITION_POINT.x, 1.4, SIHANG_DEMOLITION_POINT.z),
          time, 9, 'tank-destruction');
        sound('blast');
      }
      sihangVoices?.play(audioContext, event);
    }
  });
  if (benchmark) { telemetry.add('playerMs', performance.now() - started); started = performance.now(); }
  if (activeStates.has(state)) {
    // Vehicles have finished moving. Reuse read-only candidates only during this synchronous infantry pass.
    movementCollision.beginStablePass();
    try { performanceDiagnostics.measure('ai', () => frameWork.measureAI(() => updateAI(dt))); }
    finally { movementCollision.endStablePass(); }
  }
  // Sample the completed AI movement/turn, not last step's heading and speed.
  movementCollision.beginStablePass();
  try {
    performanceDiagnostics.measure('motion', () => {
      for (const actor of allForces) if (actor.nativeMotion && actor.health > 0 &&
        (state !== 'playing' || actor !== controlledSoldier(entities))) {
        updateAIWeaponClearance(actor);
        advanceNraMotion(actor, dt);
      }
    });
  } finally { movementCollision.endStablePass(); }
  if (activeStates.has(state)) updateBattleBoundary(dt);
  if (benchmark) { telemetry.add('aiMs', performance.now() - started); started = performance.now(); }
  if (activeStates.has(state)) performanceDiagnostics.measure('objectives', () => {
    if (sihangCampaignMode) {
      world.updateCivilians(dt, time);
      updateSihangMission(dt);
    } else if (nanjingCampaignMode) {
      performanceDiagnostics.measure('civilians', () => updateNanjingCivilians(dt));
      updateNanjingMission(dt);
    } else updateObjectives(dt);
  });
  if (activeStates.has(state)) performanceDiagnostics.measure('projectiles', () => updateProjectiles(dt));
  if (activeStates.has(state)) performanceDiagnostics.measure('grenades', () => updateGrenades(dt));
  cleanupBattleCorpses();
  presentCombatEvents(presentationTime);
  if (activeStates.has(state)) updateEffects(dt);
  updateDeathFeedback(dt);
  presentControlEvents();
  if (benchmark) telemetry.add('effectsMs', performance.now() - started);
}

function cleanupBattleCorpses() {
  if (time >= corpseCleanupAt) {
    corpseCleanupAt = time + 1;
    for (const actor of expiredCorpses([...corpses.values(), ...civilianCorpses.values()], time)) {
      if (actor.civilian) {
        actor.civilian.visible = false; civilianCorpses.delete(actor.id);
      } else {
        actor.corpseRemoved = true; corpses.delete(actor.id); clearActors([actor]);
      }
    }
  }
}

function renderSimulationStatus() {
  const status = simulationClock.snapshot, element = $('simulation-status');
  const reduced = adaptiveAI.snapshot.level > 0;
  const graphicsLevel = automaticQuality.snapshot.level;
  const backlog = status.pendingSeconds >= SIMULATION_CLOCK.lagWarningSeconds;
  element.hidden = !status.active || !backlog && !reduced && !graphicsLevel;
  if (!element.hidden) {
    const text = [backlog ? `模拟积压 ${status.pendingSeconds.toFixed(1)}秒 · 缓慢追赶` : '',
      reduced ? '自动减负 · 远处AI思考降频' : '',
      graphicsLevel ? `${automaticQuality.snapshot.reason === 'restored' ? '沿用上次画面减负' : '自动画面减负'} · ${graphicsLevel}档` : ''].filter(Boolean).join(' · ');
    if (element.textContent !== text) element.textContent = text;
    element.title = `模拟追赶上限${status.limits.maxRecoveryRate.toFixed(1)}倍，未丢弃时间；自动减负不暂停移动、交火、伤害或占点`;
  }
}

const tick = createBattleFrameLoop({
  requestFrame: callback => requestAnimationFrame(callback),
  active: () => !fatal,
  step: tickFrame,
  record: error => recordRecoveredFailure(error, {
    stage: 'battle', details: { component: 'battle-frame', recovery: 'retry-next-frame' },
    ...readFailureContext(),
  }),
});

function tickFrame(now) {
  if (battlePreparing) { lastFrame = now; return; }
  const callbackEnteredAt = benchmark ? performance.now() : 0;
  if (fatal) return;
  battleEnding.update(performance.now(), document.hidden || battleEnding.fading && state === 'pause');
  const ending = battleEnding.snapshot;
  if (battleEnding.fading || battleEnding.black) {
    const screen = $('battle-ending');
    screen.hidden = battleEnding.fading && state === 'pause';
    screen.dataset.phase = ending.phase; screen.style.opacity = String(ending.opacity);
    $('battle-ending-continue').hidden = !ending.canContinue;
    if (battleEnding.black)
      $('battle-ending-page').style.transform = `translate(-50%, -50%) translateY(${(innerHeight + endingPageHeight) * .5 * (1 - ending.pageProgress)}px)`;
  }
  if (battleEnding.black || battleEnding.complete && ['victory', 'defeat', 'draw'].includes(state)) {
    renderSimulationStatus();
    lastFrame = now; return;
  }
  tacticalAudio?.beginFrame();
  footstepAudio?.beginBatch(entities.control.soldierId, state === 'playing' && !controlledSoldier(entities)?.vehicleId);
  const mechanical = mechanicalPlayback();
  mechanicalAudio?.beginBatch(mechanical.owner, mechanical.playing);
  const cpuStarted = benchmark ? performance.now() : 0;
  const frameInterval = now - lastFrame;
  const activeFrame = activeStates.has(state);
  performanceDiagnostics.beginFrame(Math.max(0, frameInterval), state, !document.hidden);
  frameWork.beginFrame(activeFrame && !document.hidden);
  const measuredWork = frameWork.snapshot;
  adaptiveAI.observeFrame(Math.max(0, frameInterval), activeFrame && !document.hidden, measuredWork);
  automaticQuality.observe(Math.max(0, frameInterval), { active: activeFrame && !benchmark?.renderIsolation,
    visible: !document.hidden, backlogSeconds: simulationClock.snapshot.pendingSeconds,
    aiLevel: adaptiveAI.snapshot.level, work: measuredWork, now });
  const presentationTime = time + simulationClock.beginFrame(performance.now());
  stepWorkBudget.beginFrame(performance.now(), { frameMs: Math.max(0, frameInterval),
    active: activeFrame && !document.hidden, emergencyLevel: automaticQuality.snapshot.level,
    backlogSeconds: simulationClock.snapshot.pendingSeconds });
  if (benchmark && activeFrame) telemetry.begin(now, frameInterval, 0);
  if (state === 'playing') {
    frameTimes.push(now - lastFrame);
    if (frameTimes.length > 180) frameTimes.shift();
  }
  lastFrame = now;
  if (state === 'menu') menuCamera(now);
  if (activeFrame) {
    aiDecisions.beginFrame();
    for (let dt; activeStates.has(state) && stepWorkBudget.canTakeStep(performance.now()) &&
      (dt = simulationClock.takeStep()) > 0;) {
      const stepStarted = performance.now();
      if (benchmark) telemetry.add('simulatedDt', dt);
      advanceBattleStep(dt, presentationTime);
      stepWorkBudget.recordStep(stepStarted, performance.now());
    }
    const started = benchmark ? performance.now() : 0;
    if (time >= hudAt) { performanceDiagnostics.measure('hud', updateHUD); hudAt = time + .12; }
    renderWeaponReload();
    if (state === 'dead' && time >= deploymentRefreshAt) { refreshDeployment(); deploymentRefreshAt = time + .25; }
    if (benchmark) telemetry.add('hudMs', performance.now() - started);
  }
  performanceDiagnostics.measure('audio', presentRifleReports);
  const blastMotion = blastFeedback.update(Math.max(0, time - blastFeedbackTime), motionStrength);
  blastFeedbackTime = time;
  const blur = state === 'playing' && preferenceValues.blastBlur && !controlledSoldier(entities)?.vehicleId
    ? sampleBlastBlur(controlledSoldier(entities)) : 0;
  canvas.style.filter = blur > 0 ? `blur(${blur.toFixed(3)}px)` : '';
  const unshakenPosition = camera.position.clone(), unshakenRotation = camera.quaternion.clone();
  camera.translateX(blastMotion.x); camera.translateY(blastMotion.y);
  camera.rotation.x += blastMotion.pitch; camera.rotation.y += blastMotion.yaw; camera.rotation.z += blastMotion.roll;
  camera.updateMatrixWorld(true);
  world.updateWater?.(time);
  world.buildingFire.update(time, { smoke: graphics.snapshot.effects.smoke, low: graphics.snapshot.preset === 'low' });
  for (const puff of world.smoke) {
    if (!puff.visible) continue;
    const phase = (now * .000025 + puff.userData.phase) % 1;
    puff.position.set(puff.userData.originX + phase * 8, (puff.userData.originY ?? 4) + phase * 27, puff.userData.originZ);
    puff.scale.setScalar(5 + phase * 16);
  }
  if (sihangCampaignMode) {
    if (sihangCampaign.stage === 'sihang-defense') daylight.setEnabled(graphics.snapshot.effects.overcast);
    sihangNight.update(sihangCampaign);
    world.setNightLighting(sihangNight.snapshot.transition);
  }
  if (sihangCampaignMode && world.updateFlag) world.updateFlag(time);
  else for (const flag of world.flags) flag.rotation.y = Math.sin(now * .0015) * .08;
  updateDoorPrompt();
  renderGrenades();
  renderSniperScope();
  renderDeathFeedback();
  const feedbackNow = performance.now();
  missionBriefing.update(feedbackNow / 1000);
  $('blast-flash').style.opacity = String(grenadeFlashStrength * Math.min(1, Math.max(0, (grenadeFlashUntil - feedbackNow) / 220)));
  if (feedbackNow >= grenadeFlashUntil) grenadeFlashStrength = 0;
  renderConstruction();
  renderSimulationStatus();
  renderBattleBoundary();
  renderAircraftControls();
  const instancesStarted = benchmark ? performance.now() : 0;
  const isolationMode = benchmark?.renderIsolation && time >= benchmark.renderIsolationAt ? benchmark.renderIsolation : 'normal';
  const charactersVisible = isolationMode !== 'no-characters';
  for (const [id, view] of dischargerViews) {
    const actor = entities.soldiers.get(id), support = actor?.discharger;
    view.visible = charactersVisible && Boolean(actor?.health > 0 && support?.anchor &&
      support.presentationActive && actor.tactics.mode === 'operate-grenade-discharger');
  }
  const displayed = [...new Set([...allForces.filter(actor => actor.health > 0), ...corpses.values()])];
  updateSupportGripMarkers();
  performanceDiagnostics.measure('presentation', () => {
    const settings = graphics.snapshot;
    const detailLimit = settings.automaticLevel === 3 ? 2 : undefined;
    const distantPreset = settings.automaticLevel > 0 ? 'low' : settings.preset;
    const distantScale = settings.automaticLevel >= 2 ? .7 : 1;
    nraCharacter?.update(displayed.filter(actor => actor.team === 'friendly'), time, entities.control.soldierId, settings.preset, { detailLimit, distantPreset, distantScale });
    ijaCharacter?.update(displayed.filter(actor => actor.team === 'enemy'), time, entities.control.soldierId, settings.preset, { detailLimit, distantPreset, distantScale });
  });
  const supportActor = controlledSoldier(entities), supportPoint = emplacements.get(supportActor?.emplacementId);
  if (supportViewHands) {
    supportViewHands.update(['playing', 'pause'].includes(state) ? supportActor : null, camera, supportPoint?.view,
      { appearance: supportActor?.avatarAppearance });
  }
  uniformExcludedIds.clear();
  for (const force of [nraCharacter, ijaCharacter]) for (const id of force?.excludedIds ?? []) uniformExcludedIds.add(id);
  soldierRenderer.update(displayed, graphics.snapshot.preset, time, entities.control.soldierId, uniformExcludedIds, charactersVisible);
  if (nraCharacter) nraCharacter.root.visible = charactersVisible;
  if (sihangParade) sihangParade.root.visible = charactersVisible;
  if (ijaCharacter) ijaCharacter.root.visible = charactersVisible;
  if (nanjingCampaignMode || sihangCampaignMode) updateCivilianAppearance(world.civilianVisuals, camera, graphics.snapshot.preset);
  if (benchmark) telemetry.add('instancesMs', performance.now() - instancesStarted);
  const effectsStarted = benchmark ? performance.now() : 0;
  performanceDiagnostics.measure('effects', () => combatEffects.render(time, entities.vehicles.values()));
  if (benchmark) telemetry.add('effectsMs', performance.now() - effectsStarted);
  const renderStarted = benchmark ? performance.now() : 0;
  performanceDiagnostics.measure('presentation', () => staticRescue?.update({
    enabled: activeFrame && !document.hidden && automaticQuality.snapshot.level === 3, budgetMs: 1, maxChunks: 128,
  }));
  if (isolationMode === 'no-draw') renderer.info.reset();
  else performanceDiagnostics.measure('render', () => frameWork.measureRender(() => {
    graphics.beginFrame();
    renderer.render(scene, camera);
  }));
  camera.position.copy(unshakenPosition); camera.quaternion.copy(unshakenRotation); camera.updateMatrixWorld(true);
  const renderEnded = benchmark ? performance.now() : 0;
  if (benchmark && activeFrame) {
    renderIsolation.mode = isolationMode;
    renderIsolation.characterPresentationFrames++;
    if (!charactersVisible) renderIsolation.hiddenCharacterFrames++;
    if (isolationMode === 'no-draw') renderIsolation.skippedFrames++;
    else renderIsolation.drawFrames++;
    telemetry.add('renderMs', isolationMode === 'no-draw' ? 0 : performance.now() - renderStarted);
    telemetry.add('cpuMs', performance.now() - cpuStarted);
    const frameDetails = { simulationTime: time, state, current, shots: combatStats.aiRifleShots, kills, queuedPaths: pathRequests.size,
      callbackEnteredAt, callbackQueueDelayMs: callbackEnteredAt - now,
      cpuStartedAt: cpuStarted, renderStartedAt: renderStarted, renderEndedAt: renderEnded,
      aiDecisions: aiDecisions.snapshot,
      squadRoutes: squadRoutes.snapshot,
      shaderPrograms: renderer.info.programs.length,
      renderIsolation: isolationMode,
      simulationSteps: simulationClock.snapshot.stepsThisFrame, simulationBacklogSeconds: simulationClock.snapshot.pendingSeconds,
      activeSeconds: simulationClock.snapshot.activeSeconds,
      oldestPathWaitSeconds: pathRequests.size ? Math.max(...[...pathRequests.values()].map(request => time - request.requestedAt)) : 0,
      friendlyAlive: friendlyForces.filter(actor => actor.health > 0).length,
      enemyAlive: enemies.filter(actor => actor.health > 0).length, drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles, effects: effects.length, shells: shells.length };
    frameDetails.callbackEndedAt = performance.now();
    frameDetails.callbackMs = frameDetails.callbackEndedAt - callbackEnteredAt;
    telemetry.end(frameDetails);
  }
  frameWork.finishFrame();
  performanceDiagnostics.finishFrame(state);
}

document.querySelectorAll('.squad-choice').forEach(button => button.addEventListener('click', () => {
  selectedType = button.dataset.type;
  document.querySelectorAll('.squad-choice').forEach(choice => {
    const selected = choice === button;
    choice.classList.toggle('selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });
}));
$('deploy').addEventListener('click', () => beginMatch());
deploymentCards($('redeploy-choices'));
if (nanjingCampaignMode || sihangCampaignMode) for (const button of $('redeploy-choices').querySelectorAll('[data-type]')) {
  if (SQUADS[button.dataset.type].type !== 'infantry') button.remove();
}
$('redeploy-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-type]');
  if (!button) return;
  const id = button.dataset.type;
  if (!chooseDeploymentSquad(id)) return;
  refreshDeployment();
});
$('spawn-choices').addEventListener('click', event => {
  const button = event.target.closest('[data-spawn]');
  if (button) selectDeploymentSpawn(button.dataset.spawn);
});
$('deployment-map').addEventListener('click', event => {
  if (!pendingSquad || state !== 'dead' && !(state === 'menu' && $('overlay').dataset.deploymentStep === 'squad')) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * 176;
  const z = (event.clientY - bounds.top) / bounds.height * 176;
  const view = deploymentMapView(sihangCampaignMode ? 'sihang' : nanjingCampaignMode ? nanjingCampaign.stage : null);
  const points = deploymentSpawnChoices(SQUADS[pendingSquad].type).map(point => {
    const [px, pz] = deploymentMapPoint(view, point.x, point.z);
    return { id: point.id, distance: Math.hypot(px - x, pz - z) };
  }).sort((a, b) => a.distance - b.distance);
  if (points[0]?.distance <= 8) selectDeploymentSpawn(points[0].id);
});
$('confirm-deploy').addEventListener('click', () => {
  if (!pendingSquad || !pendingSpawn) { $('deployment-error').textContent = '请选择小队和重生点'; return; }
  if (state === 'menu' && $('overlay').dataset.deploymentStep === 'squad') {
    selectedType = pendingSquad;
    beginMatch(pendingSpawn);
    return;
  }
  deploy(pendingSquad, pendingSpawn);
});
$('takeover-sihang-squad').addEventListener('click', takeOverSihangSquad);
$('pause-button').addEventListener('click', () => { if (state === 'playing') showOverlay(); });
$('resume').addEventListener('click', () => {
  if (state !== 'pause' || (!allies.some(actor => actor.health > 0) && pausedFrom !== 'transferring')) {
    $('deployment-error').textContent = '整队阵亡后必须选择其他小队出击';
    return;
  }
  setGameState(pausedFrom);
  bindControlInput();
  $('overlay').hidden = true;
  lockMouse();
});
$('end-civilian-wait').addEventListener('click', () => {
  if (state !== 'pause' || !nanjingCampaignMode || nanjingCampaign.stage !== 'withdrawal-to-boats') return;
  const button = $('end-civilian-wait'), count = stalledCivilianCandidates(world.civilians, time).length;
  if (!count) { button.hidden = true; return; }
  if (button.dataset.confirm !== String(count)) {
    button.dataset.confirm = String(count);
    button.textContent = `再次点击确认：${count} 人未救出，不计为死亡或成功撤离`;
    return;
  }
  const recorded = endCivilianRecoveryWait(nanjingCampaign, world.civilians, time);
  button.hidden = true; button.dataset.confirm = '';
  showOverlay('pause');
  toast(`已记录 ${recorded} 人未救出，其余撤退仍须实际登船过江。`, 6);
  updateHUD();
});
$('back-menu').addEventListener('click', () => {
  setGameState('menu');
  simulationClock.reset(performance.now());
  releaseMouse();
  clearActors(allies);
  clearActors(enemies);
  clearActors(friendlyAI);
  clearActors([...corpses.values()]); corpses.clear();
  vehicleRenderer.clear();
  resetEntities(entities); resetDeathTransfer(deathTransfer);
  armorNavigate.reset();
  playerInput.reset(); controlEvents.clear();
  mechanicalAudio?.reset();
  controlBinding = null;
  clearTransient();
  allies = [];
  enemies = [];
  friendlyAI = []; formations = []; pathRequests.clear(); aiDecisions.reset(); adaptiveAI.reset(); rebuildForces();
  if (weapon) { camera.remove(weapon); weapon = null; }
  unit = null;
  resetControlledSimulation();
  resetSpawns();
  mortarMarker.visible = false;
  $('overlay').hidden = true;
  $('hud').hidden = true;
  $('menu').hidden = false;
  $('selected-identity-slot').append($('player-identity'));
  $('player-identity').hidden = false;
  document.getElementById('squad-step').hidden = false;
  document.getElementById('confirm-campaign').hidden = true;
});

function syncPreferenceControls() { getPreferenceControls().sync(); }
getPreferenceControls().subscribe(values => {
  preferenceValues = values;
  motionStrength = preferenceValues.motionStrength;
  audioMixer?.configure(preferenceValues.audio);
});

function syncQualityControls() {
  const settings = graphics.snapshot;
  daylight.setEnabled(settings.effects.overcast);
  combatEffects.configure(settings);
  if (weapon?.userData.rifle && allies[current]) {
    updateRifleModel(weapon, allies[current].rifle);
    weapon.userData.rifle.flash.visible &&= settings.effects.muzzle;
  }
  $('damage-vignette').style.opacity = settings.effects.damageVignette ? String(combatFeedback.flash) : '0';
  for (const selector of document.querySelectorAll('[data-quality-toggle]')) selector.value = settings.requested.preset;
  for (const checkbox of document.querySelectorAll('[data-quality-effect]')) checkbox.checked = settings.requested.effects[checkbox.dataset.qualityEffect];
  $('quality-status').textContent = `${settings.preset === 'high' ? '高' : '低'}画质 · ${settings.pixelRatio.toFixed(2)}× · 阴影${settings.shadowsEnabled ? settings.shadowSize : '关闭'}${settings.lowMemory ? ' · 低内存启动上限（重新加载才能切换资源）' : ''}${settings.automaticLevel ? ` · 自动减负${settings.automaticLevel}档（保留手动偏好）` : ''}`;
}
for (const selector of document.querySelectorAll('[data-quality-toggle]')) selector.addEventListener('change', () => {
  const selectedPreset = selector.value;
  automaticQuality.manualChange();
  graphics.setPreset(selectedPreset);
  const { preset, effects } = graphics.snapshot.requested;
  preferences.update({ quality: { preset, effects } });
  syncPreferenceControls();
  syncQualityControls();
});
for (const checkbox of document.querySelectorAll('[data-quality-effect]')) checkbox.addEventListener('change', () => {
  if (!QUALITY_EFFECTS.includes(checkbox.dataset.qualityEffect)) throw new RangeError('Unknown graphics effect control');
  const enabled = checkbox.checked;
  automaticQuality.manualChange();
  graphics.setEffect(checkbox.dataset.qualityEffect, enabled);
  const { preset, effects } = graphics.snapshot.requested;
  preferences.update({ quality: { preset, effects } });
  syncPreferenceControls();
  syncQualityControls();
});
syncQualityControls();

function performControlCommand(command) {
  const { action, payload } = command;
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  const actor = allies[current];
  if (battleEnding.black) return;
  if (sihangCeasefire(actor) && ['pressFire', 'prepareGrenade', 'mountWeapon'].includes(action)) {
    playerInput.clearFire(); held.primary = held.secondary = held.aiming = false;
    toast('南岸军事禁区 · 禁止开火', 3); return;
  }
  if (nanjingPlayerFerry() && !battleEnding.fading && !['look', 'pause', 'releaseFire', 'releaseAim', 'cycleMember'].includes(action)) {
    toast('正在登船撤离 · 可观察、换人或按Esc暂停', 3);
    return;
  }
  if(actor.emplacementId&&['equipRifle','equipTool'].includes(action)) {
    const point=emplacements.get(actor.emplacementId);
    if(point.profile==='bofors75'&&setArtilleryPosition(point,action==='equipTool'?'march':'gunner')){
      playerInput.clearFire();
      held.primary=false;held.aiming=false;
      controlPose.yaw=point.yaw;controlPose.pitch=point.pitch;
      toast(point.position==='march'?'行军位 · W/S缓推 · A/D转向 · 1返回炮手位':'炮手位 · 2切换行军');
      return;
    }
  }
  if (actor.emplacementId && !['interact', 'reload', 'look', 'pressFire', 'pressAim', 'cycleMember'].includes(action)) {
    toast('先按 F 离开固定武器阵地'); return;
  }
  if (toolEquipped && actor.mortar && actor.mortar.phase !== 'carrying' &&
    ['jump', 'crouch', 'prone', 'mountWeapon'].includes(action)) {
    toast('先收起迫击炮，再改变姿态或移动'); return;
  }
  if (actor.traversal.kind === 'vaulting' && !['look', 'cycleMember'].includes(action)) {
    toast('正在翻越 · 落地后再操作武器或交互');
    return;
  }
  if (['reload', 'equipRifle', 'equipTool', 'equipMelee', 'equipGrenade', 'equipExplosivePack', 'prepareGrenade',
    'crouch', 'prone', 'jump', 'interact'].includes(action)) releaseWeaponMount(actor.weaponMount);
  if (allies[current]?.grenades.action && !['look', 'cycleMember', 'releaseGrenade'].includes(action)) {
    if (action === 'pressFire') return;
    toast('正在操作投掷装备；松开左键投掷，换人会丢下已启动的投掷物');
    return;
  }
  if (action === 'prepareGrenade') { prepareGrenade(); return; }
  if (action === 'equipGrenade') { equipGrenade('grenade'); return; }
  if (action === 'equipExplosivePack') { equipGrenade('explosive-pack'); return; }
  if (action === 'equipMelee') { equipDadao(); return; }
  if (action === 'equipSidearm') { toast('当前士兵未配备手枪'); return; }
  if (action === 'equipSpecial') { toast('尚未配备遥控 TNT；定时炸药包按6选择'); return; }
  if (action === 'callArtillery') { toast('当前未实现通讯兵呼叫炮击'); return; }
  if (action === 'releaseGrenade') { grenades.release(entities.control.soldierId, time); return; }
  if (action === 'interact') {
    if (sihangCampaignMode && sihangCombat.defuseAvailable(sihangCampaign, actor)) return;
    if (actor.emplacementId) { releaseEmplacement(actor); return; }
    updateCamera(0);
    const focusedDoor = !toolEquipped && world.doorSystem.focus(camera);
    if (focusedDoor) { world.doorSystem.interact(focusedDoor, actor.position); return; }
    if (enterEmplacement(actor)) return;
    const dock = objectives.find(point => point.id === 'dock');
    const atNanjingDock = nanjingCampaignMode && dock &&
      Math.hypot(allies[current].position.x - dock.x, allies[current].position.z - dock.z) <= dock.radius + 3;
    if (atNanjingDock && nanjingCampaign.stage === 'withdrawal-to-boats') {
      const civilianEvacuation = nanjingCivilianEvacuationStatus(nanjingCampaign, world.civilians);
      if (!civilianEvacuation.ready) {
        toast(`百姓尚未全部安全过江：在途 ${civilianEvacuation.enRoute}、候船 ${civilianEvacuation.waiting}、在船 ${civilianEvacuation.aboard}。`);
      } else if (!nanjingAISquadsBoarded(nanjingCampaign)) {
        toast('AI友军尚未全部登船，继续掩护渡口。');
      } else if (actor.traversal.kind !== 'grounded') {
        toast('落地后再登船。');
      } else if (toolEquipped && actor.mortar && actor.mortar.phase !== 'carrying') {
        toast('先收起迫击炮，再登船。');
      } else {
        const ferry = world.ferries.filter(candidate => candidate.userData.state === 'docked' &&
          (candidate.userData.troopPassengers?.length ?? 0) < NANJING_BOAT_CAPACITY &&
          Math.hypot(actor.position.x - candidate.position.x, actor.position.z - candidate.position.z) <= 4)
          .sort((a, b) => actor.position.distanceToSquared(a.position) - actor.position.distanceToSquared(b.position))[0];
        if (ferry) {
          nanjingCampaign.playerBoardingBoatId = ferry.userData.ferryId;
          clearControlInputs(); bindControlInput();
          toast('登船撤离 · 日军已停止攻击，上船后立即离岸。', 6);
        } else {
        toast('靠近已返回渡口的木船，再按 F 登船。');
        }
      }
    } else if (occupiedVehicle(entities, allies[current])) interactVehicle();
    else if (toolEquipped) toast('先按1收起工具，再按F操作房门');
    else {
      const door = world.doorSystem.focus(camera);
      if (door) world.doorSystem.interact(door, allies[current].position);
      else if (atNanjingDock && nanjingCampaign.stage !== 'withdrawal-to-boats') toast('船只仍在接运百姓，等待撤退命令。');
      else if (!interactVehicle()) toast('靠近房门或原车，并看向交互目标再按 F');
    }
  } else if (action === 'reload') {
    if (toolEquipped && actor.engineer) {
      selectEngineerEquipment(actor.engineer); playerInput.clearFire();
      selectConstructionBlueprint(actor.engineer.construction, actor.id);
    } else reload();
  }
  else if (action === 'equipRifle' && foot) {
    equipPrimary();
  }
  else if (action === 'equipTool' && unit.type === 'infantry') equipTool(true);
  else if (action === 'cycleMember') {
    const next = nextControllableMember();
    if (next >= 0) changeMember(next);
  } else if (['crouch', 'prone'].includes(action) && foot) {
    const lowered = action === 'prone' ? 'prone' : 'crouched';
    const next = controlPose.stance === lowered ? 'standing' : lowered;
    const height = next === 'standing' ? 1.75 : next === 'crouched' ? 1.2 : .65;
    if (height > soldierPostureHeight(actor, 'body') && circleBlocked(actor.position.x, actor.position.z, .4,
      movementObstacles(actor.position.x, actor.position.z), actor.position.y, height)) {
      toast('上方空间不足，无法抬高身体。'); return;
    }
    controlPose.stance = next;
  }
  else if (action === 'mountWeapon') {
    if (actor.weaponMount.active) { releaseWeaponMount(actor.weaponMount); return; }
    if (!weaponSupportAvailable(actor) || actor.locomotion.speed > .1) { toast('先站定、收起工具或投掷物，再靠近掩体架枪'); return; }
    const candidate = currentMountCandidate(actor);
    if (!candidate) { toast('没有合适的支撑面 · 靠近沙袋、矮墙或窗台，并调整姿态'); return; }
    beginWeaponMount(actor.weaponMount, candidate, actor.position, controlPose.yaw, controlPose.pitch, controlPose.stance);
  }
  else if (action === 'jump' && foot && !actor.vehicleId && actor.traversal.kind === 'grounded') {
    if (controlPose.stance !== 'standing') controlPose.stance = 'standing';
    else if (hasFerrySupport(actor)) { toast('船上不能跳跃或翻越，仍可移动和射击'); return; }
    else {
      const obstacles = deploymentObstacles();
      const insideWarehouse = sihangCampaignMode && actor.position.x > SIHANG_WAREHOUSE.minX &&
        actor.position.x < SIHANG_WAREHOUSE.maxX && actor.position.z > SIHANG_WAREHOUSE.minZ &&
        actor.position.z < SIHANG_WAREHOUSE.maxZ;
      const plan = (insideWarehouse && findSillClimb(actor.position, controlPose.yaw,
        world.landmarks.warehouse.breaches, obstacles, world.walkHeight)) ||
        findVault(actor.position, controlPose.yaw, obstacles, world.walkHeight);
      const cost = plan ? TRAVERSAL.vaultCost : TRAVERSAL.jumpCost;
      if (actor.locomotion.stamina < (plan ? cost : .1)) { toast('体力不足，暂时无法跳跃或翻越'); return; }
      beginTraversal(actor.traversal, actor.position, plan);
      if (plan) { stopLocomotion(actor.locomotion); playerInput.clearFire(); held.primary = held.aiming = held.secondary = false; }
      jumpVelocity = actor.traversal.velocity;
      actor.locomotion.stamina -= cost;
      actor.locomotion.regenDelay = 1.4;
    }
  } else if (action === 'startOrder') held.orderStarted = payload.now;
  else if (action === 'finishOrder' && held.orderStarted !== null) {
    squadCommand(payload.now - held.orderStarted > 450);
    held.orderStarted = null;
  } else if (action === 'pressFire') {
    if (toolEquipped) {
      if (actor.engineer) {
        actor.engineer.heading = controlPose.yaw;
        selectConstructionBlueprint(actor.engineer.construction, actor.id);
        playerInput.pressFire(); return;
      }
      const mortar = actor.mortar;
      if (!mortar) throw new Error('Mortar input requires its equipment owner');
      held.primary = false;
      if (mortar.phase === 'ready') { playerInput.pressFire(); return; }
      if (mortar.phase === 'setting-up') { toast('正在架设迫击炮'); return; }
      if (actor.locomotion.speed > .1 || actor.traversal.kind !== 'grounded') {
        toast('先站定再架设迫击炮'); return;
      }
      const anchor = mortarPlacement(actor.position, controlPose.yaw);
      const base = world.groundHeight(anchor.x, anchor.z);
      const clear = [[0, 0], [.6, 0], [-.6, 0], [0, .6], [0, -.6]].every(([x, z]) =>
        !circleBlocked(anchor.x + x, anchor.z + z, .2, movementObstacles(anchor.x + x, anchor.z + z), base) &&
        Math.abs(world.walkHeight(anchor.x + x, anchor.z + z, base) - base) < .1);
      if (!clear || Math.abs(actor.position.y - base) > .1) toast('架设需要平坦、无遮挡的地面');
      else {
        mortar.phase = 'setting-up'; mortar.setupUntil = time + MORTAR.setupSeconds; mortar.anchor = { ...anchor, y: base };
        controlPose.stance = 'crouched';
        controlPose.pitch = -.45;
      }
    }
    else if (dadaoEquipped) swingDadao();
    else if (grenadeEquipped) prepareGrenade();
    else {
      playerInput.pressFire();
      const reason = currentWeaponRestriction('fire');
      if (reason) toast(reason.text, 1.5);
    }
  }
  else if (action === 'pressAim') {
    held.secondary = true;
    if (toolEquipped) {
      playerInput.clearFire();
      if (actor.engineer) { cancelEngineer(actor.engineer); playerInput.clearFire(); }
      else stowMortar(actor.mortar);
    }
    else if (!dadaoEquipped && !grenadeEquipped) held.aiming = true;
  } else if (action === 'look') {
    const sensitivity = lookSensitivity(preferenceValues, { aiming: held.aiming,
      scopeSensitivity: sniperScopeActive() ? infantryWeaponProfile(allies[current].rifle).aimSensitivity : null });
    const aircraft = occupiedVehicle(entities, actor);
    if (aircraft?.type === 'plane') {
      aircraftMouseLook(aircraft, payload.x, payload.y, sensitivity, keys.has('KeyC'));
      return;
    }
    controlPose.yaw -= payload.x * sensitivity;
    const point = emplacements.get(actor.emplacementId);
    if (point) {
      if(point.position==='march')return;
      const look = emplacementLook(point, controlPose.yaw, point.pitch - payload.y * sensitivity);
      controlPose.yaw = look.yaw; controlPose.pitch = look.pitch;
      point.view.userData.update();
      return;
    }
    if (toolEquipped && actor.mortar?.phase === 'ready') adjustMortarRange(actor.mortar, payload.y);
    else controlPose.pitch -= payload.y * sensitivity;
    const look = mountedLook(actor.weaponMount, controlPose.yaw, controlPose.pitch);
    controlPose.yaw = look.yaw; controlPose.pitch = look.pitch;
  }
}

function dispatchControlCommand(action, payload) {
  const actor = controlledSoldier(entities);
  if (!dyingActionAllowed(actor ?? {}, action) ||
    actor?.blastReaction && !actor.dying && action !== 'look') {
    if (!actor?.dying) toast('爆炸失衡：正在撑地起身');
    return { status: 'rejected', reason: actor?.dying ? 'dying' : 'blast-recovery' };
  }
  if (!fatalFallActionAllowed(controlledSoldier(entities) ?? {}, action)) {
    return { status: 'rejected', reason: 'fatal-fall' };
  }
  const command = playerInput.capture(action, payload);
  const result = playerInput.execute(command, controlOwner(entities), !fatal && state === 'playing' && controlledSoldier(entities)?.health > 0, performControlCommand);
  if (result.status === 'rejected') toast(result.reason === 'stale-owner' ? '控制对象已改变，旧操作已取消' : '当前操作已取消');
  presentControlEvents();
  return result;
}

const keyActions = { KeyF: 'interact', KeyR: 'reload', Digit1: 'equipRifle', Digit2: 'equipTool', KeyY: 'cycleMember',
  ControlLeft: 'crouch', KeyZ: 'prone', Space: 'jump', KeyB: 'mountWeapon', Digit3: 'equipMelee', Digit4: 'equipSidearm',
  Digit5: 'equipGrenade', Digit6: 'equipExplosivePack', Digit7: 'callArtillery', KeyG: 'equipGrenade' };
document.addEventListener('wheel', event => {
  const aircraft = state === 'playing' ? occupiedVehicle(entities, controlledSoldier(entities)) : null;
  if (aircraft?.type === 'plane' && !$('feedback-dialog').open && $('scoreboard').hidden) {
    aircraft.throttle = THREE.MathUtils.clamp(aircraft.throttle - Math.sign(event.deltaY) * .05, 0, 1);
    event.preventDefault(); return;
  }
  if ($('scoreboard').hidden) return;
  const panel = event.target.closest('.score-table-wrap') ?? document.querySelector('.score-table-wrap');
  if (event.shiftKey) panel.scrollLeft += event.deltaY;
  else {
    const before = panel.scrollTop; panel.scrollTop += event.deltaY;
    $('scoreboard').scrollTop += event.deltaY - (panel.scrollTop - before);
  }
  event.preventDefault();
}, { passive: false });

document.addEventListener('keydown', event => {
  if (battleEnding.black) {
    if (event.code === 'Tab' || event.code === 'F11' ||
      ['Enter', 'Space'].includes(event.code) && $('battle-ending').contains(document.activeElement)) return;
    event.preventDefault(); return;
  }
  if (fatal) return;
  if ($('feedback-dialog').open || event.target.closest('input, textarea, select')) return;
  if (['playing', 'transferring'].includes(state) &&
      ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape' && state === 'transferring' && !event.repeat) { showOverlay(); return; }
  if (event.repeat || state !== 'playing') return;
  if (event.code === 'Enter' && !$('mission-briefing').hidden && !event.target.closest('button, a')) {
    event.preventDefault(); missionBriefing.hide(); return;
  }
  keys.add(event.code);
  if (event.code === 'Space' && unit.type === 'plane') { toast('当前航空小队尚未配备炸弹'); return; }
  const action = keyActions[event.code];
  const foot = unit.type === 'infantry' || unit.type === 'mortar';
  if (action && (!['crouch', 'prone', 'jump'].includes(action) || foot) &&
      (action !== 'equipTool' || unit.type === 'infantry')) dispatchControlCommand(action);
  if (event.code === 'KeyX') dispatchControlCommand('startOrder', { now: performance.now() });
  if (event.code === 'Tab') {
    if ($('scoreboard').hidden) scoreboardReturnCapture = document.pointerLockElement === canvas;
    $('scoreboard').hidden = false;
    playerInput.clearFire();
    held.primary = held.secondary = held.aiming = false;
    if (unit?.type === 'tank') keys.delete('Space');
    updateHUD();
  }
  if (['AltLeft', 'AltRight'].includes(event.code) && !$('scoreboard').hidden) {
    event.preventDefault(); scoreboardInteractive = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }
  if (event.code === 'KeyM') $('minimap').classList.toggle('expanded');
  if (event.code === 'Escape') showOverlay();
});
document.addEventListener('keyup', event => {
  if (fatal) return;
  keys.delete(event.code);
  if (event.code === 'Tab') {
    $('scoreboard').hidden = true;
    const restore = scoreboardReturnCapture && state === 'playing' && document.pointerLockElement !== canvas;
    scoreboardInteractive = scoreboardReturnCapture = false;
    if (restore) {
      scoreboardRestoring = true;
      const request = lockMouse();
      if (request?.then) request.then(() => { scoreboardRestoring = false; }, () => { scoreboardRestoring = false; });
    }
  }
  if (event.code === 'KeyX' && held.orderStarted !== null) {
    if (state === 'playing') dispatchControlCommand('finishOrder', { now: performance.now() });
    held.orderStarted = null;
  }
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (!fatal && state === 'playing') initAudio();
  if (fatal || state !== 'playing' || !$('scoreboard').hidden) return;
  if (event.button === 0) {
    if (document.pointerLockElement !== canvas && !held.secondary) lockMouse();
    dispatchControlCommand('pressFire');
  }
  if (event.button === 2) {
    dispatchControlCommand('pressAim');
  }
});
document.addEventListener('mouseup', event => {
  if (event.button === 0) {
    playerInput.releaseFire();
    if (state === 'playing' && controlledSoldier(entities)?.grenades.action) dispatchControlCommand('releaseGrenade');
  }
  if (event.button === 2) { held.secondary = false; held.aiming = false; }
});
document.addEventListener('mousemove', event => {
  const mortarAim = toolEquipped && controlledSoldier(entities)?.mortar?.phase === 'ready';
  if (fatal || $('feedback-dialog').open || state !== 'playing' || !$('scoreboard').hidden ||
    (document.pointerLockElement !== canvas && !held.secondary && !mortarAim)) return;
  dispatchControlCommand('look', { x: event.movementX, y: event.movementY });
});
document.addEventListener('pointerlockchange', () => {
  const previouslyCaptured = hadPointerLock;
  hadPointerLock = document.pointerLockElement === canvas;
  if (hadPointerLock) {
    scoreboardRestoring = false;
    if (!['playing', 'transferring'].includes(state) && !battlePreparing) { document.exitPointerLock(); return; }
  }
  if (scoreboardInteractive || scoreboardRestoring) return;
  if (previouslyCaptured && !hadPointerLock && ['playing', 'transferring'].includes(state)) showOverlay();
});
document.addEventListener('pointerlockerror', () => { scoreboardRestoring = false; });
window.addEventListener('blur', () => { if (['playing', 'transferring'].includes(state)) showOverlay(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && ['playing', 'transferring'].includes(state)) showOverlay(); });
document.addEventListener('visibilitychange', () => battleEnding.update(performance.now(), true));
window.addEventListener('resize', () => {
  if (battleEnding.black) endingPageHeight = $('battle-ending-page').scrollHeight;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  graphics.resize(innerWidth, innerHeight);
  syncQualityControls();
});
if (queryDiagnostics) {
  collisionDiagnostics.setCollisionDiagnostics(queryDiagnostics);
  movementObstacles = queryDiagnostics.wrap('movementCandidates', movementObstacles);
  walkActor = queryDiagnostics.wrap('walkActor', walkActor);
  moveInfantry = queryDiagnostics.wrap('physicalMovement', moveInfantry);
  settleActorSupport = queryDiagnostics.wrap('support', settleActorSupport);
  hasLine = queryDiagnostics.wrap('sight', hasLine);
  fightFromCover = queryDiagnostics.wrap('fightFromCover', fightFromCover);
  postureFireLine = queryDiagnostics.wrap('postureLine', postureFireLine);
  proneSpaceClear = queryDiagnostics.wrap('proneSpace', proneSpaceClear);
  updateAI = queryDiagnostics.wrap('aiOther', updateAI);
  advanceBattleStep = queryDiagnostics.wrap('simulationOther', advanceBattleStep);
}

// A read-only snapshot makes local smoke tests observable without exposing gameplay mutations.
Object.defineProperty(window, '__battle', { get: () => ({
  recoveredErrors: fatalReporter.recoveries,
  startupResources: { ...startupResources, textures: textureBudget.snapshot },
  corpses: { rules: CORPSE_RULES, count: corpses.size, members: [...corpses.values()].map(actor => ({
    id: actor.id, team: actor.team, time: actor.casualty.time, age: time - actor.casualty.time,
    variant: actor.casualty.variant, retainGun: actor.casualty.retainGun,
    offset: actor.casualty.offset ? { ...actor.casualty.offset } : null,
    yaw: actor.casualty.yaw ?? 0, wallLimited: actor.casualty.wallLimited ?? false,
    position: { x: actor.position.x, y: actor.position.y, z: actor.position.z } })) },
  build: { ...buildStamp, development: import.meta.env.DEV },
  preferences: { ...preferences.snapshot, persistence: preferences.status },
  audioMix: audioMixer?.snapshot ?? { contextState: 'not-started', settings: preferenceValues.audio, activeSynthetic: 0 },
  resources: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures,
    programs: renderer.info.programs?.length ?? 0, sceneChildren: scene.children.length,
    cameraChildren: camera.children.length, transientEffects: effects.length, shells: shells.length,
    projectileViews: shellViews.size, pathRequests: pathRequests.size, corpses: corpses.size },
  adaptiveStepBudget: stepWorkBudget.snapshot,
  japaneseSupport: { rules: GRENADE_DISCHARGER,
    activeShells: shells.filter(shell => shell.kind === 'grenade-discharger').map(shell => ({
      id: shell.id, source: shell.source, elapsed: shell.elapsed, duration: shell.duration,
      start: shell.start, target: shell.target, aim: shell.aim, position: { ...shell.position } })),
    modelCount: dischargerViews.size,
    operators: enemies.filter(actor => actor.discharger).map(actor => ({
      ...actor.discharger, id: actor.id, weaponId: actor.discharger.id,
      unitId: actor.unitId, health: actor.health, role: actor.role,
      position: { x: actor.position.x, y: actor.position.y, z: actor.position.z },
      primary: actor.rifle.model ?? 'rifle', handGrenades: actor.grenades.ammo, packs: actor.grenades.packs,
      visible: dischargerViews.get(actor.id)?.visible ?? false })),
    squads: formations.filter(formation => formation.team === 'enemy' && formation.type === 'infantry')
      .map(formation => ({ id: formation.id, demolition: Boolean(formation.sihangDemolition),
        members: formation.members.length, dischargers: formation.members.filter(actor => actor.discharger).length,
        machineGunners: formation.members.filter(actor => actor.rifle.model === 'type11').length })) },
  staticRescue: staticRescue?.snapshot ?? null,
  state, type: unit?.type, squadId: unit?.squadId, time, remaining, kills, teamKills, deployments,
  emplacements: [...emplacements.values()].map(point => ({ id: point.id, profile: point.profile,
    team: point.team, health: point.health, maxHealth: point.maxHealth, engineerBuilt: Boolean(point.engineerBuilt),
    builderId: point.builderId ?? null, lastDamage: point.lastDamage ? { ...point.lastDamage, source: { ...point.lastDamage.source } } : null,
    x: point.x, z: point.z, yaw: point.yaw, pitch: point.pitch, operatorId: point.operatorId, shots: point.shots,
    heat: point.heat, ammo: point.weapon.ammo, reserve: point.weapon.reserve })),
  engineers: allForces.filter(actor => actor.engineer).map(actor => ({ id: actor.id, team: actor.team,
    unitId: actor.unitId, health: actor.health, selected: actor.engineer.selected, materials: { ...actor.engineer.materials },
    progress: actor.engineer.construction.progress, mode: actor.engineer.construction.mode, built: [...actor.engineer.built] })),
  encirclement: !encirclementMode ? null : { ...encirclement, unlocked: [...encirclement.unlocked],
    disabledEnemySpawns: [...encirclement.disabledEnemySpawns], breakout: encirclement.breakout ? {
      ...encirclement.breakout, initialIds: [...encirclement.breakout.initialIds], escapedIds: [...encirclement.breakout.escapedIds],
      ...(encirclement.breakout.groups?{groups:encirclement.breakout.groups.map(group=>({...group}))}:{}),
      ...(encirclement.breakout.restoration?{restoration:encirclement.breakout.restoration.map(task=>({...task}))}:{}) } : null },
  campaign: sihangCampaign ? { ...sihangCampaign, demolition: { ...sihangCampaign.demolition },
    combat: sihangCombat.snapshot, night: sihangNight.snapshot, retreat: sihangRetreatStatus(sihangCampaign),
    warehouseRuined: world.warehouseRuined, civilians: world.civilians.length }
    : nanjingCampaign ? { ...nanjingCampaign, boats: nanjingCampaign.boats.map(boat => ({ ...boat })),
    civilianVisuals: { active: world.civilians.filter(civilian => civilian.userData.active && !civilian.userData.dead).length,
      arrived: world.civilians.filter(civilian => civilian.userData.arrived && !civilian.userData.dead).length },
    airSupport: { count: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.team === 'enemy').length,
      aircraft: [...entities.vehicles.values()].filter(vehicle => vehicle.type === 'plane' && vehicle.team === 'enemy').map(vehicle => ({
        ...vehicle.aiFlight, position: vehicle.position.toArray(), pitch: vehicle.pitch, heading: vehicle.heading, roll: vehicle.roll,
        health: vehicle.health, ammo: vehicle.weapon.ammo, sunk: Boolean(vehicle.fall?.sunk),
        model: vehicle.fall?.sunk ? null : vehicleRenderer.model(vehicle.id).userData.profile.model,
        team: vehicle.team, lastShot: vehicle.weapon.lastShot ?? null })) },
    map: { ferries: world.ferries.length, gateBarbicans: world.landmarks.gatehouse.barbicans,
      bridgeDeckDefenses: world.landmarks.bridgeDeckDefenses,
      wallBreaches: world.landmarks.wallBreaches,
      alignedGateways: world.landmarks.gatehouse.gates.length, bridges: world.landmarks.bridges,
      forwardDefenses: world.landmarks.forwardDefenses, dockDefenses: world.landmarks.dockDefenses,
      cityWalls: world.landmarks.cityWalls,
      gatehouse: world.landmarks.gatehouse, rivers: world.landmarks.rivers,
      residentialBuildings: world.landmarks.residentialBuildings, wallWalk: world.landmarks.wallWalk,
      northernBackdrop: world.landmarks.northernBackdrop,
      courtyards: world.landmarks.courtyards, flankingStructures: world.landmarks.flankingStructures,
      wallRamps: world.landmarks.wallRamps,
      soldierCave: world.landmarks.soldierCave, primaryAssaultRoute: world.landmarks.primaryAssaultRoute } } : null,
  squadScores: battleStats.snapshot,
  control: { ...entities.control },
  controlBinding: controlBinding ? { ...controlBinding } : null,
  controlSimulation: { toolEquipped, dadaoEquipped, grenadeEquipped, selectedThrowable, jumpHeight, jumpVelocity,
    traversal: allies[current] ? { ...allies[current].traversal } : null,
    weaponMount: allies[current] ? { ...allies[current].weaponMount, stability: mountStability(allies[current].weaponMount,
      Boolean(infantryWeaponProfile(allies[current].rifle).automatic)) } : null },
  dadaoMaterials: dadaoSurfaceSnapshot(),
  actionFeedback: { fire: currentWeaponRestriction('fire'), aim: currentWeaponRestriction('aim'),
    displayed: $('action-status').hidden ? null : $('action-status').dataset.reason },
  dadao: controlledSoldier(entities)?.dadao ? { ...controlledSoldier(entities).dadao,
    ...dadaoPhase(controlledSoldier(entities).dadao, time), viewVisible: Boolean(weapon?.visible && weapon?.userData.dadaoHand),
    handSource: dadaoEquipped ? weapon?.userData.handSource : null,
    materialSource: dadaoEquipped ? weapon?.userData.materialSource : null,
    arm: dadaoEquipped && weapon?.userData.dadaoArm.armSnapshot ? { ...weapon.userData.dadaoArm.armSnapshot } : null } : null,
  historicalCharacter: nraCharacter?.focusedSnapshot ?? null,
  historicalForce: nraCharacter?.snapshot ?? null,
  supportView: supportViewHands?.snapshot ?? null,
  enemyHistoricalCharacter: ijaCharacter?.focusedSnapshot ?? null,
  enemyHistoricalForce: ijaCharacter?.snapshot ?? null,
  battleVoices: audioUnsupported ? { status: 'unavailable' } : battleVoices
    ? { ...battleVoices.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'unavailable', error: battleVoicesFailure },
  civilianVoices: civilianVoices ? civilianVoices.snapshot : { status: 'unavailable', error: civilianVoicesFailure },
  sihangVoices: sihangVoices ? sihangVoices.snapshot : { status: 'unavailable', error: sihangVoicesFailure },
  battleSignals: battleSignals ? battleSignals.snapshot : { status: 'unavailable', error: battleSignalsFailure },
  tacticalAudio: tacticalAudio ? tacticalAudio.snapshot : { status: 'unavailable', error: tacticalAudioFailure },
  vehicleAudio: vehicleAudio ? vehicleAudio.snapshot : { status: 'unavailable', error: vehicleAudioFailure },
  battleReactions: audioUnsupported ? { status: 'unavailable' } : battleReactions
    ? battleReactions.snapshot : { status: 'unavailable', error: battleReactionsFailure },
  rifleAudio: audioUnsupported ? { status: 'unavailable' } : rifleAudio
    ? { ...rifleAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: rifleAudioFailure },
  footstepAudio: audioUnsupported ? { status: 'unavailable' } : footstepAudio
    ? { ...footstepAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: footstepAudioFailure },
  mechanicalAudio: audioUnsupported ? { status: 'unavailable' } : mechanicalAudio
    ? { ...mechanicalAudio.snapshot, contextState: audioContext?.state ?? 'not-started' }
    : { status: 'fallback', error: mechanicalAudioFailure },
  simulationClock: simulationClock.snapshot,
  aiDecisions: aiDecisions.snapshot,
  performanceDiagnostics: performanceDiagnostics.snapshot,
  squadRoutes: squadRoutes.snapshot,
  battleWarmup, battlePreparing,
  adaptiveAI: adaptiveAI.snapshot,
  automaticQuality: automaticQuality.snapshot,
  frameWork: frameWork.snapshot,
  battleEnding: battleEnding.snapshot,
  queryDiagnostics: queryDiagnostics?.snapshot ?? null,
  tracers: tracerPool.snapshot,
  renderIsolation: { ...renderIsolation, requested: benchmark?.renderIsolation ?? 'normal',
    activateAtSeconds: benchmark?.renderIsolationAt ?? 0,
    visibleNativeRoots: [nraCharacter, ijaCharacter].filter(character => character?.root.visible).length },
  boundary: { area: { ...battleArea }, airArea: { ...AIR_BATTLE_AREA }, rules: { ...BOUNDARY_RULES },
    ...controlledBoundary(), members: allies.map(actor => ({ id: actor.id, ...boundaryStates.get(actor.id) })) },
  outskirts: { buildings: world.outskirts.buildings.length, nearBuildings: world.outskirts.buildings.filter(house => house.near).length,
    ruinedBuildings: world.outskirts.buildings.filter(house => house.ruined).length, hills: world.outskirts.hills.map(hill => ({ ...hill })) },
  entityCounts: { units: entities.units.size, soldiers: entities.soldiers.size, weapons: entities.weapons.size, vehicles: entities.vehicles.size },
  vehicleViews: vehicleRenderer.snapshot,
  deathTransfer: { ...deathTransfer, mask: deathTransferMask(deathTransfer) },
  dying: allies[current]?.dying ? { ...allies[current].dying } : null,
  blastReaction: allies[current]?.blastReaction ? { ...sampleBlastReaction(allies[current]),
    lethal: allies[current].blastReaction.lethal, direction: { ...allies[current].blastReaction.direction } } : null,
  vehicles: [...entities.vehicles.values()].map(transport => ({ id: transport.id, type: transport.type, unitId: transport.unitId,
    flightControl: transport.flightControl ? { ...transport.flightControl } : null,
    fall: transport.fall ? { ...transport.fall, velocity: { ...transport.fall.velocity } } : null,
    aiFlight: transport.aiFlight ? { ...transport.aiFlight } : null,
    team: transport.team, variant: transport.variant, name: transport.variant === CHI_HA.id ? CHI_HA.name : TYPES[transport.type].name,
    maxHealth: transport.maxHealth, trackDistance: transport.trackDistance, speed: transport.speed,
    ai: transport.ai ? { mode: transport.ai.mode, targetId: transport.ai.targetId, shots: transport.ai.shots,
      objectiveId: transport.ai.objectiveId, goal: transport.ai.goal ? { ...transport.ai.goal } : null,
      distanceToObjective: transport.ai.distanceToObjective, firePauseUntil: transport.ai.firePauseUntil,
      navigation: armorNavigate.stats(transport),
      path: transport.ai.path.map(point => ({ ...point })) } : null,
    health: transport.health, position: { x: transport.position.x, y: transport.position.y, z: transport.position.z },
    heading: transport.heading, pitch: transport.pitch, roll: transport.roll, speed: transport.speed,
    throttle: transport.throttle, turretYaw: transport.turretYaw, turretPitch: transport.turretPitch,
    weapon: { ...transport.weapon }, machineGuns: transport.machineGuns?.map(gun => ({ ...gun })),
    seats: transport.seats.map(seat => ({ ...seat })) })),
  benchmark: benchmark ? { ...benchmark } : null,
  position: allies[current] ? { x: allies[current].position.x, y: allies[current].position.y, z: allies[current].position.z } : null,
  current, ammo: unit?.ammo, health: occupiedVehicle(entities, allies[current])?.health ?? allies[current]?.health,
  weaponVisible: Boolean(weapon?.visible && primaryViewAvailable()),
  vehicleObservationVisible: !$('tank-optics').hidden || Boolean(weapon?.visible && unit?.type === 'tank' && weapon.userData.observationSeat),
  tankObservation: unit?.type === 'tank' ? { role: occupiedSeat(entities)?.role, aperture: $('tank-optics').dataset.view,
    closed: !$('tank-optics').hidden, eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, fov: camera.fov } : null,
  spawnId: unit?.spawnId, pendingSquad, pendingSpawn,
  aiming: held.aiming, fov: camera.fov, stance: controlPose.stance, breath: allies[current]?.breathControl.remaining ?? 1,
  scope: { active: sniperScopeActive(), breath: allies[current] ? { ...allies[current].breathControl } : null },
  controlInput: playerInput.snapshot, controlEvents: controlEvents.snapshot,
  combatEvents: combatEvents.snapshot,
  combatFeedback: combatFeedback.snapshot(time),
  projectiles: shells.map(shell => ({ id: shell.id, source: { ...shell.source }, position: { ...shell.position },
    target: { ...shell.target }, elapsed: shell.elapsed, duration: shell.duration, firedAt: shell.firedAt })),
  projectileViews: shellViews.size,
  projectileSceneObjects: scene.children.filter(object => object.userData.projectileId).length,
  projectileImpacts: projectileImpacts.map(event => ({ ...event, source: { ...event.source }, position: { ...event.position } })),
  grenades: { rules: { ...GRENADE }, packRules: { ...EXPLOSIVE_PACK }, active: grenades.active.map(grenade => ({ ...grenade,
    source: { ...grenade.source }, originalSource: { ...grenade.originalSource },
    position: { ...grenade.position }, velocity: { ...grenade.velocity } })),
    history: grenades.history, renderer: grenadeRenderer.snapshot,
    equipped: grenadeEquipped,
    selected: selectedThrowable,
    inventory: controlledSoldier(entities) ? { ammo: controlledSoldier(entities).grenades.ammo, packs: controlledSoldier(entities).grenades.packs,
      phase: controlledSoldier(entities).grenades.action?.phase ?? null } : null },
  graphics: graphics.snapshot, combatStats: { ...combatStats },
  population: { rules: { ...BATTLE_RULES }, friendly: battleSummary('friendly'), enemy: battleSummary('enemy'),
    renderer: { ...soldierRenderer.snapshot,
      visible: soldierRenderer.snapshot.visible + (nraCharacter?.counts.near ?? 0) + (nraCharacter?.counts.far ?? 0) + (ijaCharacter?.counts.near ?? 0) + (ijaCharacter?.counts.far ?? 0),
      near: soldierRenderer.snapshot.near + (nraCharacter?.counts.near ?? 0) + (ijaCharacter?.counts.near ?? 0),
      far: soldierRenderer.snapshot.far + (nraCharacter?.counts.far ?? 0) + (ijaCharacter?.counts.far ?? 0),
      batches: soldierRenderer.snapshot.batches + (nraCharacter?.counts.batches ?? 0) + (ijaCharacter?.counts.batches ?? 0),
      procedural: soldierRenderer.snapshot, historical: nraCharacter?.counts ?? null, japanese: ijaCharacter?.counts ?? null }, queuedPaths: pathRequests.size,
    units: formations.map(formation => ({ id: formation.id, team: formation.team, type: formation.type, player: formation.player,
      active: formation.active !== false, respawnEnabled: formation.respawnEnabled !== false,
      respawnAt: formation.respawnAt, blockedReason: formation.blockedReason ?? null,
      memberCount: formation.members.length, alive: formation.members.filter(actor => actor.health > 0).length,
      generation: formation.generation, spawnId: formation.spawnId, objectiveId: formation.objectiveId ?? null,
      assaultCrossing: formation.assaultCrossing ?? null,
      members: formation.members.map(actor => ({ id: actor.tactics.id, soldierId: actor.id, role: actor.role, weaponModel: actor.rifle.model ?? 'rifle', ammo: actor.rifle.ammo, shots: actor.rifle.shots,
        x: actor.position.x, y: actor.position.y, z: actor.position.z, health: actor.health, spawnId: actor.spawnId, section: actor.section, spawnClear: actor.spawnClear, spawnPosition: { ...actor.spawnPosition } })) })) },
  performance: { samples: frameTimes.length, averageFrameMs: frameTimes.length ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length : 0,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
  combatEffects: combatEffects.snapshot,
  rifleTextures: rifleTextureSnapshot(),
  sceneArt: { ...world.sceneArt },
  daylight: { sunIntensity: sun.intensity, fillIntensity: hemisphere.intensity, environmentIntensity: scene.environmentIntensity,
    shadowProjection: { width: 2 / sun.shadow.camera.projectionMatrix.elements[0],
      height: 2 / sun.shadow.camera.projectionMatrix.elements[5] } },
  look: { yaw: controlPose.yaw, pitch: controlPose.pitch },
  bridgeSurfaces: { ...world.bridgeSurfaces },
  river: { ...RIVER, surfaces: { ...world.riverSurfaces } },
  staticDamage: { craters: world.staticDamage.craters.map(crater => ({ ...crater })),
    ruinedShops: [...world.staticDamage.ruinedShops], wrecks: world.staticDamage.wrecks.map(wreck => ({ ...wreck })) },
  doors: world.doorSystem.doors.map(({ id, x, z, angle, targetAngle, state, blocked }) => ({ id, x, z, angle, targetAngle, state, blocked })),
  town: { streetWidth: world.town.streetWidth, buildings: world.town.buildings.map(building => ({ ...building })), visibility: { ...world.visibility },
    navigation: navigate.stats, inside: allies[current] ? world.town.buildings.find(building => {
      const p = allies[current].position;
      return Math.abs(p.x - building.x) < building.w / 2 && Math.abs(p.z - building.z) < building.d / 2;
    })?.id || null : null },
  rifle: unit?.type === 'infantry' ? { ...allies[current].rifle, obstruction: weaponObstruction, obstructionBlend, trace: lastRifleTrace,
    model: weapon?.userData.rifle ? {
      boltLift: weapon.userData.rifle.bolt.rotation.z, boltTravel: weapon.userData.rifle.bolt.position.z,
      clipVisible: weapon.userData.rifle.clip.visible, chargerVisible: weapon.userData.rifle.clip.getObjectByName('charger').visible,
      cartridges: weapon.userData.rifle.clip.children.filter(child => child.name.startsWith('cartridge') && child.visible).length,
      reloadContact: weapon.userData.reloadContact ? { ...weapon.userData.reloadContact } : null,
      handContact: weapon.userData.handContact ? structuredClone(weapon.userData.handContact) : null,
      nativeHands: weaponHands?.snapshot ?? null,
      closePose: { blend: obstructionBlend, position: weapon.position.toArray(), rotation: weapon.quaternion.toArray() },
      feedPosition: weapon.getObjectByName('feed')?.position.toArray() ?? null,
      leftHandPosition: weapon.userData.rifle.leftHand.position.toArray(),
      flashVisible: weapon.userData.rifle.flash.visible,
      dimensions: { ...weapon.userData.dimensions },
      arms: weaponHands?.snapshot?.visible ? Object.fromEntries(['left', 'right'].map(side =>
        [side, { upper: weaponHands.snapshot[side].arm.lengths[0], forearm: weaponHands.snapshot[side].arm.lengths[1] }]))
        : weapon.userData.armLengths ? { right: { ...weapon.userData.armLengths.right }, left: { ...weapon.userData.armLengths.left } } : null,
    } : null,
    muzzle: weapon?.userData.rifle ? weapon.userData.rifle.muzzle.getWorldPosition(new THREE.Vector3()).toArray() : null,
    sights: weapon?.userData.rifle ? ['rearSight', 'frontSight'].map(name => {
      const point = weapon.userData.rifle[name].getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: point.x, y: point.y };
    }) : null } : null,
  locomotion: allies[current] ? { ...allies[current].locomotion, motionStrength, footsteps: playerFootsteps, surface: lastFootSurface, eyeHeight,
    cameraHeight: camera.position.y, cameraRoll: camera.rotation.z,
    weaponOffset: weapon ? { x: weapon.position.x, y: weapon.position.y, z: weapon.position.z, pitch: weapon.rotation.x } : null } : null,
  allies: allies.map(actor => ({ id: actor.id, unitId: actor.unitId, vehicleId: actor.vehicleId, seatId: actor.seatId,
    mortar: actor.mortar ? { ...actor.mortar } : null,
    dadao: actor.dadao ? { ...actor.dadao } : null,
    weaponId: actor.rifle.id, health: actor.health, eyeHeight: soldierPostureHeight(actor),
    deathSource: actor.deathSource ? { ...actor.deathSource } : null,
    x: actor.position.x, y: actor.position.y, z: actor.position.z, stance: actor.stance, manualStance: actor.manualStance,
    lookPitch: actor.lookPitch, order: actor.order,
    orderPoint: actor.orderPoint ? { ...actor.orderPoint } : null, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    role: actor.role, targetKind: actor.targetKind, spawnId: actor.spawnId, stamina: actor.locomotion.stamina,
    grenades: { ammo: actor.grenades.ammo, packs: actor.grenades.packs, phase: actor.grenades.action?.phase ?? null }, rifle: { ...actor.rifle } })),
  mortar: controlledSoldier(entities)?.mortar ? { ...controlledSoldier(entities).mortar, equipped: toolEquipped } : null,
  mortarView: { emplaced: emplacedMortar.visible, position: emplacedMortar.position.toArray(),
    muzzle: emplacedMortar.userData.mortar.muzzle.getWorldPosition(new THREE.Vector3()).toArray(),
    carrying: Boolean(toolEquipped && weapon?.visible && weapon.userData.mortar) },
  mortarAudio: { loaded: Boolean(mortarLaunch), error: mortarLaunchFailure, played: mortarLaunchesPlayed,
    contextState: audioContext?.state ?? 'not-started' },
  spawnPoints: spawnPoints.map(({ id, team, kind, name, x, z, health, builderId, permanent, objectiveId, enabled, disabledBy }) =>
    ({ id, team, kind, name, x, z, health, builderId: builderId ?? null, permanent: Boolean(permanent),
      objectiveId: objectiveId ?? null, enabled: enabled !== false, disabledBy: disabledBy ?? null })),
  spawnEvents: spawnEvents.map(event => ({ ...event })),
  enemies: enemies.filter(actor => actor.health > 0).length,
  friendlyPositions: friendlyForces.filter(actor => actor.health > 0 && actor !== controlledSoldier(entities)).map(actor => ({
    dadao: actor.dadao ? { ...actor.dadao, pose: { ...actor.dadao.pose } } : null,
    id: actor.tactics.id, soldierId: actor.id, squad: actor.tactics.squad, slot: actor.tactics.slot,
    formationId: actor.formation.id, pathGoal: actor.pathGoal ? { ...actor.pathGoal } : null, pathLength: actor.path?.length ?? 0,
    pathWaypoint: actor.path?.[0] ? { ...actor.path[0] } : null, pathReason: actor.tactics.pathReason ?? null,
    traffic: actor.tactics.traffic ? { waitSeconds: actor.tactics.traffic.waitSeconds,
      reason: actor.tactics.traffic.reason, yieldPoint: actor.tactics.traffic.yieldPoint ? { ...actor.tactics.traffic.yieldPoint } : null } : null,
    heading: actor.heading, rifleReady: actor.rifleReady, lowReady: actor.nativeMotion?.lowReady ?? null,
    bodyLean: actor.nativeMotion?.bodyLean ?? null,
    turningToPath: Boolean(actor.turningToPath), lastHit: actor.lastHit ? { ...actor.lastHit } : null,
    rifle: { ...actor.rifle }, aiRifle: { ...actor.aiRifle, lastShot: actor.aiRifle.lastShot ? { ...actor.aiRifle.lastShot } : null },
    stance: actor.stance, firingPose: ownedFiringPose(actor), aimWalking: Boolean(actor.aimWalking),
    automaticFireMoving: Boolean(actor.automaticFireMoving),
    automaticFireMode: actor.tactics.automaticFireMotion?.mode ?? null,
    postureReady: postureReady(actor), posture: actor.nativeMotion ? { ...actor.nativeMotion.posture } : null,
    completedShotMoves: actor.tactics.completedShotMoves ?? 0, shotMovePending: Boolean(actor.tactics.shotMovePending),
    wallContact: actor.tactics.wallContact ? { ...actor.tactics.wallContact } : null,
    x: actor.position.x, y: actor.position.y, z: actor.position.z, health: actor.health, order: actor.order, mode: actor.tactics.mode,
    objectiveId: actor.tactics.objectiveId ?? null,
    cover: actor.tactics.cover ? { id: actor.tactics.cover.id, x: actor.tactics.cover.x, z: actor.tactics.cover.z,
      kind: actor.tactics.cover.kind, peek: { ...actor.tactics.cover.peek } } : null, enteredCover: actor.tactics.enteredCover,
    suppressedUntil: actor.tactics.suppressedUntil,
    observation: { sense: actor.tactics.threatSense, targetId: actor.tactics.threatId, time: actor.tactics.observedAt,
      forgetAt: actor.tactics.forgetAt, point: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null },
    engagementPoint: actor.tactics.engagementPoint ? { ...actor.tactics.engagementPoint } : null,
    sightCheck: actor.tactics.lastSightCheck ? { ...actor.tactics.lastSightCheck } : null,
    movement: { speed: actor.locomotion.speed, mode: actor.locomotion.mode, sprinting: actor.locomotion.sprinting, stamina: actor.locomotion.stamina,
      exhausted: actor.locomotion.exhausted, aimRecovery: actor.locomotion.aimRecovery },
    lastShot: actor.tactics.lastShot ? { ...actor.tactics.lastShot, position: { ...actor.tactics.lastShot.position } } : null,
    blockedBy: actor.tactics.blockedBy, bodyScaleY: actor.model.scale.y })),
  enemyPositions: enemies.filter(actor => actor.health > 0).map(actor => ({ x: actor.position.x, z: actor.position.z, health: actor.health,
    stance: actor.stance, firingPose: ownedFiringPose(actor), enteredCover: actor.tactics.enteredCover,
    cover: actor.tactics.cover ? { id: actor.tactics.cover.id, kind: actor.tactics.cover.kind,
      x: actor.tactics.cover.x, z: actor.tactics.cover.z, peek: { ...actor.tactics.cover.peek } } : null,
    bayonet: { ...actor.bayonet },
    armorEscort: actor.tactics.armorEscort ? { ...actor.tactics.armorEscort } : null,
    formationId: actor.formation.id, objectiveId: actor.formation.objectiveId ?? null,
    pathGoal: actor.pathGoal ? { ...actor.pathGoal } : null, pathLength: actor.path?.length ?? 0,
    rifleReady: actor.rifleReady, lowReady: actor.nativeMotion?.lowReady ?? null,
    aimPitch: actor.aimPitch ?? 0,
    bodyLean: actor.nativeMotion?.bodyLean ?? null,
    turningToPath: Boolean(actor.turningToPath), lastHit: actor.lastHit ? { ...actor.lastHit } : null,
    soldierId: actor.id, speed: actor.locomotion.speed, aimRecovery: actor.locomotion.aimRecovery,
    postureReady: postureReady(actor), rifle: { ...actor.rifle },
    aiRifle: { ...actor.aiRifle, lastShot: actor.aiRifle.lastShot ? { ...actor.aiRifle.lastShot } : null },
    lastShot: actor.tactics.lastShot ? { ...actor.tactics.lastShot, position: { ...actor.tactics.lastShot.position } } : null,
    id: actor.tactics.id, squad: actor.tactics.squad, mode: actor.tactics.mode, coverId: actor.tactics.cover?.id || null, bodyScaleY: actor.model.scale.y,
    heading: actor.heading, selectedTargetId: actor.target?.id ?? null, nextSenseAt: actor.nextThink,
    sightCheck: actor.tactics.lastSightCheck ? { ...actor.tactics.lastSightCheck } : null,
    targetKind: actor.target?.targetKind || null, threatKind: actor.tactics.threatKind,
    observation: { sense: actor.tactics.threatSense, targetId: actor.tactics.threatId, time: actor.tactics.observedAt,
      forgetAt: actor.tactics.forgetAt, point: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null },
    engagementPoint: actor.tactics.engagementPoint ? { ...actor.tactics.engagementPoint } : null,
    lastSeen: actor.tactics.lastSeen ? { ...actor.tactics.lastSeen } : null, blockedBy: actor.tactics.blockedBy })),
  coverClaims: [...coverClaims].filter(([, claim]) => claim.until > time).map(([id, claim]) => ({ id, ...claim })),
  objectives: objectives.map(point => ({ ...point })),
  conquest: { ...conquest },
  drawCalls: renderer.info.render.calls,
  shaderPrograms: renderer.info.programs.length,
  collisionAcceleration: solidIndex.acceleration,
}), configurable: false });

if (benchmark) Object.defineProperty(window, '__battleTelemetry', { get: () => telemetry.snapshot, configurable: false });

Object.defineProperty(window, '__battleResourceInventory', { get: () => {
  const textures = new Map(), geometries = new Set(), skeletons = new Set();
  const addTexture = (texture, owner, kind) => {
    if (!texture?.isTexture) return;
    const item = textures.get(texture.uuid) ?? { id: texture.uuid, kind, owners: [] };
    if (!item.owners.includes(owner)) item.owners.push(owner);
    textures.set(texture.uuid, item);
  };
  const scan = (root, label) => root?.traverse(node => {
    if (node.geometry) geometries.add(node.geometry.uuid);
    if (node.skeleton) skeletons.add(node.skeleton.uuid);
    const owner = `${label}:${node.name || node.type}`;
    for (const material of node.material ? Array.isArray(node.material) ? node.material : [node.material] : []) {
      for (const value of Object.values(material)) if (value?.isTexture) addTexture(value, owner, 'surface');
    }
    addTexture(node.skeleton?.boneTexture, owner, 'skeleton');
  });
  addTexture(scene.background, 'scene-background', 'environment');
  addTexture(scene.environment, 'scene-environment', 'environment');
  scan(scene, 'scene'); scan(nraCharacter?.root, 'friendly-force'); scan(ijaCharacter?.root, 'enemy-force');
  scan(weaponHands?.root, 'reusable-weapon-hands');
  return { geometries: [...geometries], textures: [...textures.values()],
    skeletons: [...skeletons], appearance: nraCharacter?.appearanceResources ?? null,
    skeletonTextures: [...textures.values()].filter(item => item.kind === 'skeleton').length };
}, configurable: false });

try {
  setLoadingProgress(92, '最后阶段 · 准备我军人物渲染…');
  reportLoading('friendly-rendering');
  await nraCharacter?.prepare(renderer, { onProgress: ({ completed, total }) =>
    setLoadingProgress(Math.floor(92 + 3 * completed / total), `最后阶段 · 准备我军远景 ${completed}/${total}…`) });
  setLoadingProgress(96, '最后阶段 · 准备日军人物渲染…');
  reportLoading('enemy-rendering');
  await ijaCharacter?.prepare(renderer, { onProgress: ({ completed, total }) =>
    setLoadingProgress(Math.floor(96 + 3 * completed / total), `最后阶段 · 准备日军远景 ${completed}/${total}…`) });
} catch (error) {
  fatalReporter.show(error, { stage: 'character-rendering' });
  throw error;
}
if (fatalReporter.failed) throw new Error('Initialization interrupted; see the original fatal diagnostic');
fatalReporter.ready();
performanceDiagnostics.setContext(() => {
  let allies = 0, enemies = 0, vehicles = 0;
  for (const actor of allForces) if (actor.health > 0) {
    if (actor.team === 'friendly') allies++; else enemies++;
  }
  for (const vehicle of entities.vehicles.values()) if (vehicle.health > 0) vehicles++;
  const clock = simulationClock.snapshot;
  return { map: campaign.id, state, time, stage: sihangCampaignMode ? sihangCampaign.stage : nanjingCampaignMode ? nanjingCampaign.stage :
      encirclementMode ? encirclement.phase === 1 ? 'encirclement' : 'east-breakout' : 'conquest',
    quality: graphics.snapshot.preset, adaptiveLevel: adaptiveAI.snapshot.level,
    automaticLoad: { ...automaticQuality.statistics, aiReductions: adaptiveAI.snapshot.reductions,
      aiRecoveries: adaptiveAI.snapshot.recoveries },
    allies, enemies, corpses: corpses.size, vehicles, reinforcementWaves: encirclement.reinforcementWaves,
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    backlogSeconds: clock.pendingSeconds, simulationSteps: clock.stepsThisFrame, unit: unit?.type ?? 'none',
    ...(nanjingCampaignMode?{civilianCasualties:nanjingCampaign.civilianCasualties,
      civilianShots:nanjingCampaign.civilianShots??0,civilianAircraftHits:nanjingCampaign.civilianAircraftHits??0}:{}) };
}, { onSessionStart() { automaticQuality.resetStatistics(); adaptiveAI.resetStatistics(); } });
setLoadingProgress(100, '加载完成，即将进入战场。');
reportLoading('ready');
$('loading').hidden = true;
$('menu').hidden = false;
getMenuMusic().setState('menu');
// Loading and character preparation are not a rendered frame interval.
lastFrame = performance.now();
requestAnimationFrame(tick);
$('shop-art-entry').hidden = !import.meta.env.DEV;
if (benchmark?.scenario === 'shop-art') {
  const showShopView = name => {
    setGameState('menu');
    beginMatch();
    controlPose.yaw = SHOP_ART_VIEWS[name].yaw; controlPose.pitch = SHOP_ART_VIEWS[name].pitch;
  };
  $('shop-art-tour').hidden = false;
  for (const button of document.querySelectorAll('[data-shop-view]')) {
    button.addEventListener('click', () => showShopView(button.dataset.shopView));
  }
  document.addEventListener('keydown', event => {
    const name = { F1: 'grain', F2: 'cloth', F3: 'ground' }[event.code];
    if (!name || event.repeat) return;
    event.preventDefault(); showShopView(name);
  });
  showShopView('grain');
}
