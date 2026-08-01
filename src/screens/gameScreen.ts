import { createWorldState } from '../sim/world';
import { onRoomCleared } from '../progression/achievementTracker';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { createRng } from '../sim/rng';
import { createReusableSnapshot, updateSnapshotInPlace } from '../render/snapshot';
import { PlayerCloak } from '../render/clusters/playerCloak';
import { MomentumTrail } from '../render/clusters/momentumTrail';
import { StormweaveLifeMotes, getStormweaveMoteCount } from '../sim/stormweave/lifeMotes';
import { deactivateShieldWeave, updateShieldWeaveState } from '../sim/stormweave/shieldWeave';
import { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { HudState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import { SunraysRenderer } from '../render/effects/sunraysRenderer';
import { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import { GuideDustPathRenderer } from '../render/effects/guideDustPathRenderer';
import { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';
import { CrackedBlockShatterRenderer } from '../render/crackedBlockShatterRenderer';
import { BreakEffectRenderer } from '../render/breakEffectRenderer';
import { WeakWallJumpDebrisRenderer } from '../render/weakWallJumpDebrisRenderer';
import { FallingBlockDustRenderer } from '../render/fallingBlocks/fallingBlockRenderer';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners, clearAllTriggeredInputFlags, pollGamepadInput } from '../input/handler';
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { spawnHeraldForTesting, spawnIceWizardForTesting } from './gameEnemySpawn';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { createCameraState, getCameraOffset } from '../render/camera';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import { handleGateRoomExit, handleGateSaveCompleted, interactWithNearbyChallengeTotem, updateRoomChallengeElements } from './gameRoomChallenge';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';
import { getMusicVolume, getSelectedRenderSize, getActiveWorldViewPreset, getGraphicsQuality, getCombatModeFromStorage, getEffectiveRenderAdjacentRooms } from '../ui/renderSettings';
import { AdjacentRoomRenderCoordinator } from './adjacentRoomRenderCoordinator';
import { productionAdjacentRoomDrawImpl } from './gameRenderAdjacentRoomsImpl';
import type { AdjacentRoomDrawPorts } from './gameRenderAdjacentRooms';
import { wallTemplateToSnapshot } from '../render/walls/roomRenderState';
import { computeRenderViewportMetrics, resizeCanvasBackingStore } from '../render/canvasViewport';
import { getCombatMode, setCombatMode } from '../sim/combatMode';
import { createMusicManager, MusicManager } from '../audio/musicManager';
import { PlayerSfxManager } from '../audio/playerSfx';
import { BloomSystem } from '../render/effects/bloomSystem';
import { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import { DEFAULT_BLOOM_CONFIG } from '../render/effects/bloomConfig';
import { RenderProfiler } from '../render/hud/renderProfiler';
import {
  worldBgColor,
  resolveSpawnBlock,
} from './gameRoom';
import { renderFrame, type RenderFrameContext } from './gameRender';
import { createCombatTextSystem } from '../render/hud/combatText';
import { processLargeSlimeSplits } from '../sim/clusters/slimeAi';
import { DecorationWaveState } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { MAX_CRUMBLE_BLOCKS } from '../sim/world';
import { processPlayerCommands } from './gameCommandProcessor';
import { createPlayerSfxState, updatePlayerSfx } from './gamePlayerSfx';
import { processRoomPickups } from './gamePickups';
import { DustContainerPickupEffect } from '../render/dustContainerPickupEffect';
import { VerdantAfterimageTrail } from '../render/clusters/verdantAfterimageTrail';
import { VerdantFlowerTrail } from '../render/verdantFlowerTrail';
import { createDialogueState } from '../dialogue/dialogueState';
import { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';
import { PlayerSpeedometerOverlayRenderer } from '../render/ui/playerSpeedometerOverlayRenderer';
import { PlayerSpeedGraphOverlayRenderer } from '../render/ui/playerSpeedGraphOverlayRenderer';
import { handleDialogueAdvance, checkDialogueTriggers } from './gameDialogueHandler';
import { updatePlayerCloaks, updateVerdantAfterimageTrailFrame } from './gamePlayerCloakUpdate';
import { tickCrumbleDebrisEvents } from './gameCrumbleDebrisEvents';
import { tickCrackedBlockShatterEvents } from './gameCrackedBlockShatterEvents';
import { tickBreakEvents } from './gameBreakEvents';
import {
  createGameInterpolationBuffers,
  captureClusterInterpolationState,
  captureFallingBlockInterpolationState,
} from './gameInterpolationBuffers';
import { buildHudDebugState } from './gameHudDebugState';
import type { Conversation } from '../dialogue/dialogueTypes';
import {
  preloadAdjacentRoomAssets,
  areRoomSpritesReady,
  isRoomBackgroundDecodeReady,
  decodeRoomThemeSprites,
  decodeRoomBackground,
} from '../render/roomAssetPreloader';
import { RoomRuntimeCache, isEntryFullyPrepared } from './roomRuntimeCache';
import { getSpriteAtlasDebugInfo, getSpriteAtlasStats, type SpriteAtlasBenchUnavailable } from '../render/atlases/spriteAtlasLoader';
import type { SpriteAtlasStats } from '../render/atlases/spriteAtlasTypes';
import { type PreloadScheduleHandle } from './roomPreloadScheduler';
import {
  getPrewarmStats,
  ensureChunkPrewarmQueued,
  invalidateRoomChunkPrewarm,
  recordTransitionOutcome,
  getRoomPrewarmReadiness,
  getLastAdoptionResult,
  addZoneEntryViewportTasks,
  runChunkPrewarmSliceNow,
  type TransitionReadinessDiagnostic,
  type WarmScheduleHandle,
} from './roomRenderChunkWarmScheduler';
import * as TP from '../debug/transitionProfiler';
import type { TransitionDebugStats } from '../render/transitions/transitionState';
import { GameLoadingOverlay } from './gameLoadingOverlay';
import { GameEntryFadeOverlay } from './gameEntryFadeOverlay';
import {
  createEntryFadeState,
  armEntryFade,
  cancelEntryFade,
  isEntryFadeActive,
  tickEntryFade,
} from './gameEntryFadeController';
import {
  createAdaptiveQualityState,
  updateAdaptiveQuality,
  type AdaptiveQualityState,
} from './gameAdaptiveQuality';
import { resolveGameStartRoomSelection } from './gameStartRoom';
import {
  type GameCameraState,
  createGameCameraState,
  updateCameraFollow,
} from './gameCameraState';
import { createGameOverlayController } from './gameOverlayController';
import { DustSelectionWheelController, isDustWheelAvailable } from './gameDustSelectionState';
import { createDustWheelGestureState, updateDustWheelGesture } from '../input/dustWheelInput';
import {
  PlayerDeathDustEffect,
  triggerPlayerDeathDustFromSprite,
} from '../render/playerDeathDust';
import { resetPlayerLuminantLight } from './gamePlayerLuminantLight';
import {
  getCharacterSprites,
  getPlayerSprite,
  preloadActiveCharacterSprites,
  PLAYER_SPRITE_WIDTH_WORLD,
  PLAYER_SPRITE_HEIGHT_WORLD,
  PLAYER_SPRITE_PIVOT_X_WORLD,
} from '../render/clusters/characterSprites';
import type { ClusterSnapshot } from '../render/clusterSnapshotTypes';
import { createGameEditorDebugControls } from './gameEditorDebugControls';
import {
  applyGameEditorRoomActivation,
  type GameEditorRoomActivationPorts,
} from './gameEditorRoomActivationCoordinator';
import { createGamePauseController } from './gamePauseController';
import { createGameLambdaAnchorState } from './gameLambdaAnchorState';
import { renderEditorBackdrop } from './gameScreenEditorBackdrop';
import { orchestrateRoomTransitions, type TransitionDebugState } from './gameRoomTransitionOrchestrator';
import type { TransitionDirection } from './gameTransitions';
import { RoomTransitionLoadCoordinator } from './roomTransitionLoadCoordinator';
import * as FP from '../debug/perfFreezeProfiler';
import { resetLegacyShadingFrameStats } from '../render/walls/legacyBlockShading';
import { type LoadRoomCtx, makeLoadRoomPhases, applyResidentRoomActivation } from './gameLoadRoomPhases';
import {
  capturePlayerTransferState,
  detachPlayerFromResidentWorld,
} from './playerTransfer';
import {
  createEntryWarmState,
  startEntryWarm,
  tickEntryWarm,
  isEntryWarmReadyOrTimedOut,
  canSkipEntryWarm,
  type EntryWarmState,
} from './entryViewportWarm';
import { ResidentRoomManager } from './residentRoomManager';
import { bfsNearbyRooms } from './roomPrewarmNeighborhood';
import { createResidentBuildGenerator } from './residentWorldBuilder';
import {
  ResidentBuildScheduler,
  InitialZoneLoadProgress,
  RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS,
} from './residentBuildScheduler';
import { PLAYER_INITIAL_HEALTH } from './gameSpawn';
import { logWallTemplateDiagnosticsSummary } from './preparedRoomRuntime';
import { ZoneResidentLoader } from './zoneResidentLoader';
import {
  applyRoomPreloadAnticipationPolicy,
  type RoomPreloadAnticipationPorts,
} from './roomPreloadAnticipationPolicy';
import { createGameRunTimer } from './gameRunTimer';

const FIXED_DT_MS = 16.666;

/** Baseline virtual width at 16:9; height is authoritative for fixed zoom. */
const BASE_VIRTUAL_WIDTH_PX = 480;
/** Fixed virtual height so world-to-pixel zoom stays constant on every display. */
const FIXED_VIRTUAL_HEIGHT_PX = 270;
/** Vite base URL for assets. */
const BASE = import.meta.env.BASE_URL;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;


import type { EditableCampaignSession } from '../editor/editableCampaignSession';

export interface GameScreenCallbacks {
  onReturnToMenu: () => void;
  onSave?: () => void;
  /**
   * Called when the player activates a save point.
   * The timer state (runTimerMs) is passed so the caller can persist the
   * checkpoint timer value in the save slot data.
   */
  onCheckpointReached?: (runTimerMs: number) => void;
}

/** Options for the speedrun timer and assist mode feature. */
export interface GameScreenRunOptions {
  /** Initial run timer value in ms, restored from save data (default 0). */
  initialRunTimerMs?: number;
  /** Initial checkpoint timer value in ms, restored from save data (default 0). */
  initialCheckpointRunTimerMs?: number;
  /** When true, Assist Mode is active for this session (unlimited air grapples). */
  assistMode?: boolean;
}

export function startGameScreen(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  _legacyPlayerLoadout: ParticleKind[],
  startRoomId: string | null,
  callbacks: GameScreenCallbacks,
  progress?: PlayerProgress,
  campaignSession?: EditableCampaignSession | null,
  openEditorImmediately?: boolean,
  campaignSpawnBlockOverride?: readonly [number, number] | null,
  runOptions?: GameScreenRunOptions,
): () => void {
  const webglRenderer = new WebGLParticleRenderer();
  (webglRenderer as { isAvailable: boolean }).isAvailable = false; // DWDEBUG: force 2D-only compositing to test wall visibility
  const bloomSystem = new BloomSystem({ ...DEFAULT_BLOOM_CONFIG });
  const darkRoomOverlay = new DarkRoomOverlay();
  const renderProfiler = new RenderProfiler();
  const playerSfx = new PlayerSfxManager();
  const playerSfxState = createPlayerSfxState();

  // ── Audio unlock on first trusted user gesture ───────────────────────────
  // Browsers suspend AudioContext until the user interacts with the page.
  // Register one-time listeners for the three most common first-gesture events
  // so audio starts playing as soon as possible without further intervention.
  function _onAudioUnlockGesture(): void {
    playerSfx.unlock();
  }
  window.addEventListener('pointerdown', _onAudioUnlockGesture, { once: true, passive: true });
  window.addEventListener('keydown',     _onAudioUnlockGesture, { once: true, passive: true });
  window.addEventListener('touchstart',  _onAudioUnlockGesture, { once: true, passive: true });

  // ── Weave loadout (replaces flat particle loadout for combat) ──────────
  // Initialize from progress if available, otherwise create default
  const playerWeaveLoadout: PlayerWeaveLoadout = progress?.weaveLoadout
    ?? createDefaultWeaveLoadout();

  // ── Virtual resolution pipeline ──────────────────────────────────────────
  // Stage 1: All game content is drawn to a fixed-height offscreen canvas.
  // Stage 2: The offscreen canvas is upscaled to the device canvas each frame.
  const virtualCanvas = document.createElement('canvas');
  let virtualWidthPx = BASE_VIRTUAL_WIDTH_PX;
  // Height is driven by the active World View preset (normal/wide/far).
  // Declared as `let` so resizeCanvas() can update it when the preset changes.
  let virtualHeightPx = FIXED_VIRTUAL_HEIGHT_PX;
  virtualCanvas.width  = virtualWidthPx;
  virtualCanvas.height = virtualHeightPx;
  const virtualCtx = virtualCanvas.getContext('2d')!;
  virtualCtx.imageSmoothingEnabled = false;

  // The device-facing canvas is used only as the upscale target.
  const deviceCtx = canvas.getContext('2d')!;

  function resizeCanvas(): void {
    const selectedRenderSize = getSelectedRenderSize();
    const rect = canvas.getBoundingClientRect();
    const metrics = computeRenderViewportMetrics(
      rect.width || window.innerWidth || selectedRenderSize.widthPx,
      rect.height || window.innerHeight || selectedRenderSize.heightPx,
      selectedRenderSize.widthPx,
      selectedRenderSize.heightPx,
      window.devicePixelRatio || 1,
      getActiveWorldViewPreset().virtualHeight,
    );
    resizeCanvasBackingStore(canvas, metrics.backingWidthPx, metrics.backingHeightPx);
    virtualWidthPx = metrics.logicalWidthPx;
    virtualHeightPx = metrics.logicalHeightPx;
    resizeCanvasBackingStore(virtualCanvas, virtualWidthPx, virtualHeightPx);
    // Canvas resize resets 2D context state, so enforce nearest-neighbour
    // sampling again for pixel-art sprite rendering.
    virtualCtx.imageSmoothingEnabled = false;
    // WebGL particle canvas also renders at virtual resolution
    if (webglRenderer.isAvailable) {
      webglRenderer.resize(virtualWidthPx, virtualHeightPx);
    }
    bloomSystem.resize(virtualWidthPx, virtualHeightPx);
    darkRoomOverlay.resize(virtualWidthPx, virtualHeightPx);
  }

  resizeCanvas();

  if (webglRenderer.isAvailable) {
    // Hide the WebGL canvas from display — we'll drawImage it onto the device canvas
    webglRenderer.canvas.style.display = 'none';
  }

  const ctx = virtualCtx;
  const camera = createCameraState();

  // ── Background music manager ─────────────────────────────────────────────
  const musicManager: MusicManager = createMusicManager(BASE);
  musicManager.setVolume(getMusicVolume());

  // ── Combat mode — restore persisted setting into the sim module ───────────
  setCombatMode(getCombatModeFromStorage());

  // ── Room state ────────────────────────────────────────────────────────────
  const {
    configuredSpawnRoom,
    requestedStartRoom,
    campaignSpawnRoom,
    initialRoom,
    campaignSpawnBlock,
    shouldOpenFailsafeEditor,
  } = resolveGameStartRoomSelection({
    roomRegistry: ROOM_REGISTRY,
    startingRoomId: STARTING_ROOM_ID,
    startRoomId,
    hasCampaignSession: campaignSession != null,
    openEditorImmediately,
    campaignSpawnBlockOverride,
  });
  if (requestedStartRoom === null || configuredSpawnRoom === null) {
    console.error('[gameScreen] No rooms were loaded. Starting in fallback room.');
  }

  let currentRoom: RoomDef = initialRoom;
  let bgColor = worldBgColor(currentRoom.worldNumber);
  let roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_MEDIUM;
  let roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_MEDIUM;

  // Room origin is always 0 — no seamless staging/crossing active.
  const currentRoomOriginXWorld = 0;
  const currentRoomOriginYWorld = 0;

  const dustContainerSprite = new Image();
  dustContainerSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainer.png`;
  let isDustContainerSpriteLoaded = false;
  dustContainerSprite.onload = () => { isDustContainerSpriteLoaded = true; };
  const dustContainerShardSprite = new Image();
  dustContainerShardSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainerShard.png`;
  let isDustContainerShardSpriteLoaded = false;
  dustContainerShardSprite.onload = () => { isDustContainerShardSpriteLoaded = true; };
  /** Keys in the format `${roomId}:container:${index}` and `${roomId}:containerShard:${index}`
   * for already-collected dust containers and shards.
   * Initialized from progress.collectedDustContainerKeys so they stay collected after save/load. */
  const collectedDustContainerKeySet: Set<string> = new Set(progress?.collectedDustContainerKeys ?? []);
  /** Keys in the format `${roomId}:dustswarm:${index}` for already-collected dust swarms.
   * Initialized from progress.collectedDustSwarmKeys so swarms stay collected after save/load. */
  const collectedDustSwarmKeySet: Set<string> = new Set(progress?.collectedDustSwarmKeys ?? []);

  /** Keys in the format `${roomId}:${xBlock}:${yBlock}` for already-consumed skill tombs.
   * Initialized from progress.collectedSkillTombKeys so collected skill books stay
   * consumed (and never re-grant their weave) after save/load. */
  const consumedSkillTombKeySet: Set<string> = new Set(progress?.collectedSkillTombKeys ?? []);

  /** Initialises (or re-initialises) world state for the given room.
   *
   * Internally runs _makeLoadRoomPhases() to completion synchronously.
   * For room transitions, prefer startAsyncLoadRoom() so the work is
   * spread across multiple RAF frames while the screen is blacked out.
   */
  function loadRoom(room: RoomDef, spawnXBlock: number, spawnYBlock: number, preserveCamera = false): void {
    const gen = _makeLoadRoomPhases(room, spawnXBlock, spawnYBlock, preserveCamera);
    // Run all phases synchronously (for initial load / save-load paths).
    let result = gen.next();
    while (!result.done) result = gen.next();
    dustContainerPickupEffect.reset();
    playerDeathDust.reset();
    verdantAfterimageTrail.reset();
    verdantFlowerTrail.reset();
    resetPlayerLuminantLight();
  }

  /**
   * Generator that executes the room-load in 6 incremental phases.
   * Yields between each phase so the RAF loop can interleave rendering
   * (keeping the screen black with the fade overlay) while loading.
   *
   * Phase A — room metadata + world reset   (~1 ms)
   * Phase B — spawn player + particles      (~1 ms)
   * Phase C — spawn enemies                 (~5–15 ms on complex rooms)
   * Phase D — background particles + walls  (~5–10 ms)
   * Phase E — hazards/ropes/blocks/dialogue (~2–5 ms)
   * Phase F — env effects + rendering setup (~1 ms)
   */
  function* _makeLoadRoomPhases(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    preserveCamera: boolean,
  ): Generator<void, void, void> {
    yield* makeLoadRoomPhases(loadRoomCtx, room, spawnXBlock, spawnYBlock, preserveCamera);
  }

  // `world` is `let` because it gets reassigned during resident WorldState
  // hot-swap transitions (via the transition coordinator's setWorld port).
  let world = createWorldState(FIXED_DT_MS, 42);
  const levelRng = createRng(12345);
  // Stable numeric seed for background resident world builds (BUILD 417).
  // Intentionally a DIFFERENT value from the levelRng seed so it is visually
  // clear that resident builds are decoupled from active gameplay randomness.
  // Per-room RNG is further derived inside buildResidentWorldState() via
  // createResidentRoomRng(room, RESIDENT_CAMPAIGN_SEED), which mixes in the
  // room id hash and world number so each room gets a distinct RNG stream.
  const RESIDENT_CAMPAIGN_SEED = 0xd457_0417; // distinct from levelRng seed (12345)
  const residentRoomManager = new ResidentRoomManager();

  // ── Frame-budget-driven background preload slice ────────────────────────
  // `roomPreloadScheduler` and `roomRenderChunkWarmScheduler` schedule their
  // work via `requestIdleCallback`, which is an unreliable cadence source in a
  // continuously-rendering canvas game: genuine idle slots between animation
  // frames are rare, so real progress often only happened when each
  // scheduler's multi-second forced timeout fired — long enough that a player
  // could reach a "preloaded" room while it was still cold, producing a
  // visible hitch despite the preload systems reporting success.
  // Driving both schedulers here, once per frame, from *measured* spare frame
  // time (last frame's cost vs. this budget) gives deterministic, far more
  // frequent progress with no added risk of a frame overrun: the budget below
  // already matches the same conservative threshold the resident-build
  // scheduler above uses for its own background work.
  const preloadSliceFrameBudgetMs = RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS;
  const preloadSliceMaxMs = 8;

  /**
   * Recompute and push radius-1/2 readiness counts to the manager.
   * Called after each transition and after each idle build to keep
   * diagnostics accurate.
   */
  function _updateRadiusReadyCounts(): void {
    let r1 = 0, r2 = 0, r1Total = 0, r2Total = 0;
    for (const [adjId, adjDist] of bfsNearbyRooms(currentRoom.id, ROOM_REGISTRY, 2)) {
      const adj = residentRoomManager.getResident(adjId);
      if (adjDist === 1) {
        r1Total++;
        if (adj !== undefined && adj.runtimeReady) r1++;
      } else if (adjDist === 2) {
        r2Total++;
        if (adj !== undefined && adj.runtimeReady) r2++;
      }
    }
    residentRoomManager.setRadiusReadyCounts(r1, r2, r1Total, r2Total);
  }
  const environmentalDust = new EnvironmentalDustLayer();
  const sunbeamRenderer = new SunbeamRenderer();
  const sunraysRenderer = new SunraysRenderer();
  const atmosphericLightDust = new AtmosphericLightDust();
  const guideDustPathRenderer = new GuideDustPathRenderer();
  const skidDebris = new SkidDebrisRenderer();
  const crumbleDebris = new CrumbleDebrisRenderer();
  const crackedBlockShatter = new CrackedBlockShatterRenderer();
  const breakEffects = new BreakEffectRenderer();
  const weakWallJumpDebris = new WeakWallJumpDebrisRenderer();
  // Wire real audio for debris thud impacts. The callback uses jump_impact_soft
  // at the per-particle volume so thuds are subtle and not spammy.
  weakWallJumpDebris.setThudCallback((opts) => {
    try { playerSfx.play('jump_impact_soft', opts.volumeLinear); } catch { /* guard */ }
  });
  const skillTombRenderer = new SkillTombRenderer();
  const skillTombEffectRenderer = new SkillTombEffectRenderer();
  const playerCloak = new PlayerCloak();
  const phantomCloak = new PhantomCloakExtension();
  const momentumTrail = new MomentumTrail();
  const stormweaveLifeMotes = new StormweaveLifeMotes();
  const decorationWaveState = new DecorationWaveState();
  const fallingBlockDust = new FallingBlockDustRenderer();
  const dustContainerPickupEffect = new DustContainerPickupEffect();
  const playerDeathDust = new PlayerDeathDustEffect();
  const verdantAfterimageTrail = new VerdantAfterimageTrail();
  const verdantFlowerTrail = new VerdantFlowerTrail();
  let deathDustTriggerSeed = 1;

  // ── Dialogue system ──────────────────────────────────────────────────────
  // The dialogue overlay renders at full device resolution (not the virtual
  // 480×270 canvas) so that text is always crisp regardless of screen DPI.
  // See src/render/ui/dialogueOverlayRenderer.ts for the full rationale.
  const dialogueState = createDialogueState();
  const dialogueRenderer = new DialogueOverlayRenderer(uiRoot);
  const playerSpeedometerOverlay = new PlayerSpeedometerOverlayRenderer(uiRoot);
  const playerSpeedGraphOverlay = new PlayerSpeedGraphOverlayRenderer(uiRoot);
  /**
   * UIDs of dialogue triggers that have already fired this room visit.
   * Cleared on every room load so each trigger fires once per visit.
   * Retrigger rule: a trigger fires once per room visit; it fires again if the
   * player leaves and re-enters the room (the Set is reset in loadRoom).
   */
  let firedDialogueTriggerUids = new Set<number>();
  /**
   * Pre-converted runtime Conversation objects for the current room.
   * Built once in loadRoom() from RoomConversationDef → Conversation to avoid
   * per-frame allocations in the trigger detection hot path (Section 5 guideline).
   */
  let cachedRoomConversations: Conversation[] = [];

  // ── Per-frame allocation-free state ─────────────────────────────────────
  // All three are populated once per room load in loadRoom() and reused every
  // frame so renderFrame() never allocates decorations or snapshots on the heap.
  let cachedWallDecorations: WallDecoration[] = [];
  const cachedDecorationCenterX = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const cachedDecorationCenterY = new Float32Array(DecorationWaveState.MAX_DECORATIONS);
  const reusableSnapshot = createReusableSnapshot(world);

  // ── Editor backdrop snapshot freeze ─────────────────────────────────────
  // While the editor is open, gameplay simulation is not ticked (the editor
  // branch returns early each frame), so the gameplay world underlying the
  // backdrop is invariant. Recomputing `updateSnapshotInPlace()` every editor
  // frame is pure waste at scale. We capture it once per editor session
  // (and again if the underlying `world` reference is swapped, e.g. a
  // resident hot-swap) and reuse it thereafter until the editor closes.
  let editorBackdropSnapshotFresh = false;
  let editorBackdropSnapshotWorld: typeof world | null = null;
  let wasEditorActiveLastFrame = false;

  // ── Crumble block prev-state tracking ───────────────────────────────────
  // Snapshot of per-block hit state from the previous tick so we can detect
  // damage and destruction transitions and fire visual events + lighting rebuild.
  const prevCrumbleActive = new Uint8Array(MAX_CRUMBLE_BLOCKS);
  const prevCrumbleHits   = new Uint8Array(MAX_CRUMBLE_BLOCKS);

  // ── Render-interpolation buffers ─────────────────────────────────────────
  const interpolationBuffers = createGameInterpolationBuffers();

  // ── Health bar state ─────────────────────────────────────────────────────
  /** Map of entityId -> tick when health bar should hide. */
  const healthBarDisplayUntilTick: Map<number, number> = new Map();
  /** Previous health values to detect damage. */
  const prevHealthMap: Map<number, number> = new Map();

  // ── Combat text system (floating damage numbers) ─────────────────────────
  const combatText = createCombatTextSystem();
  /** Tracks the last seen world.lastPlayerBlockedTick to detect new BLOCKED events. */
  const prevLastPlayerBlockedTick = { value: -1 };

  // ── Room runtime cache (wall templates) ──────────────────────────────────
  // Precomputed static room data keyed by room ID.  Allows _makeLoadRoomPhases
  // to skip the expensive merge pass when a room has already been preloaded.
  // Edge-extension caches are no longer built here — see legacy README.
  // Bounded LRU with 16 slots (current room + 3-hop radius + headroom).
  const roomRuntimeCache = new RoomRuntimeCache();
  // Zone loader initialized here after roomRuntimeCache is available.
  const _zoneLoader = new ZoneResidentLoader(ROOM_REGISTRY, roomRuntimeCache);

  // ── Resident build scheduler (BUILD 418; extracted BUILD 441) ─────────────
  // Owns the background resident-build priority queue, the single active
  // incremental build session, per-room version counters (stale-build guard),
  // and the frame-budget gating.  See residentBuildScheduler.ts for the
  // priority levels and invariants.
  const residentBuildScheduler = new ResidentBuildScheduler({
    registry: ROOM_REGISTRY,
    manager: residentRoomManager,
    createBuildGenerator: (room, opts) =>
      createResidentBuildGenerator(room, RESIDENT_CAMPAIGN_SEED, roomRuntimeCache, {
        reason:      opts.reason,
        priority:    opts.priority,
        onLongPhase: (phase, ms) => { residentRoomManager.recordLongPhase(phase, ms, room.id); },
      }),
    getCurrentRoomId: () => currentRoom.id,
    getLastFrameMs:   () => renderProfiler.getLastFrameMs(),
    onBuildPublished: () => { _updateRadiusReadyCounts(); },
    isDevMode: import.meta.env.DEV,
  });

  // ── Preload anticipation policy ports (BUILD 443) ────────────────────────
  // Created once here; passed by reference into applyRoomPreloadAnticipationPolicy
  // each frame.  No per-frame allocation.
  const preloadAnticipationPorts: RoomPreloadAnticipationPorts = {
    getRuntimeEntry: (id) => {
      const e = roomRuntimeCache.get(id);
      return e === undefined ? undefined : { fullyPrepared: isEntryFullyPrepared(e) };
    },
    prioritizeRuntime: (id) => { _preloadScheduleHandle?.prioritize(id); },
    decodeThemeSprites: (id) => {
      const r = ROOM_REGISTRY.get(id);
      if (r !== undefined) void decodeRoomThemeSprites(r);
    },
    decodeBackground: (id) => {
      const r = ROOM_REGISTRY.get(id);
      if (r !== undefined) decodeRoomBackground(r);
    },
    ensureChunkPrewarm: (id) => { ensureChunkPrewarmQueued(id, 'proximity'); },
    getResident: (id) => residentRoomManager.getResident(id),
    enqueueResidentBuild: (id, priority, reason) => {
      residentBuildScheduler.enqueue({ roomId: id, priority, reason });
    },
  };

  // ── Adjacent-room render coordinator (render-only radius-1 view) ─────────
  // Owns the live ConnectedRoomRenderState. Does zero work when the effective
  // "Render Adjacent Rooms" setting (CAMERA ALWAYS CENTERED && the child) is
  // off, so the normal render path is untouched by default.
  const adjacentRoomCoordinator = new AdjacentRoomRenderCoordinator({
    isEffectiveEnabled: () => getEffectiveRenderAdjacentRooms(),
    resolveRoomDef: (id) => ROOM_REGISTRY.get(id) ?? null,
    getResidentWorld: (id) => {
      const res = residentRoomManager.getResident(id);
      const w = res?.world;
      if (res === undefined || w === undefined || w === null) return null;
      return { builtForRoomId: w.builtForRoomId, runtimeReady: res.runtimeReady };
    },
    requestNeighborLoad: (id) => {
      if (ROOM_REGISTRY.has(id)) {
        residentBuildScheduler.enqueue({ roomId: id, priority: 3, reason: 'adjacent' });
      }
    },
  });
  // Draw-side ports: resolve each neighbour's non-building wall snapshot
  // (runtime cache -> baked template; never a synchronous merge in a frame) and
  // its background colour. Returns null to keep the void/transition look until
  // safe render data exists.
  const adjacentRoomDrawPorts: AdjacentRoomDrawPorts = {
    resolveRoomDef: (id) => ROOM_REGISTRY.get(id) ?? null,
    resolveWallSnapshot: (id, def) => {
      const cached = roomRuntimeCache.get(id);
      if (cached !== undefined) return wallTemplateToSnapshot(cached.wallTemplate);
      if (def.bakedWallTemplate !== undefined) return wallTemplateToSnapshot(def.bakedWallTemplate);
      return null;
    },
    resolveBgColor: (def) => worldBgColor(def.worldNumber),
  };

  // Handle for the current idle preload schedule so it can be cancelled when
  // the player switches rooms before the previous schedule completes.
  let _preloadScheduleHandle: PreloadScheduleHandle | null = null;
  // Handle for the current idle chunk prewarm schedule.
  let _warmScheduleHandle: WarmScheduleHandle | null = null;

  // ── Entry viewport warm state ─────────────────────────────────────────────
  // Tracks progress of the shaded-chunk warm pass for the current room's
  // entry viewport.  Holds the loading overlay until the pass completes or
  // a conservative timeout is reached.  Restarted on every room load.
  let entryWarmState: EntryWarmState = createEntryWarmState();

  // ── Camera transition state ───────────────────────────────────────────────
  // After every room switch the camera smoothly interpolates from
  // its world-space position in the old room to the clamped target position in
  // the new room.  Logic extracted to gameCameraState.ts.
  const camState: GameCameraState = createGameCameraState(roomWidthWorld, roomHeightWorld);

  // ── Room-load context object ──────────────────────────────────────────────
  // Bundles all dependencies for makeLoadRoomPhases (gameLoadRoomPhases.ts).
  // Object references are passed directly; mutable let-primitives use setters
  // so Phase-A write-backs in the generator are immediately visible here.
  const loadRoomCtx: LoadRoomCtx = {
    world,
    camState,
    camera,
    roomRuntimeCache,
    musicManager,
    playerWeaveLoadout,
    progress,
    playerCloak,
    phantomCloak,
    momentumTrail,
    verdantAfterimageTrail,
    verdantFlowerTrail,
    stormweaveLifeMotes,
    decorationWaveState,
    environmentalDust,
    sunbeamRenderer,
    sunraysRenderer,
    atmosphericLightDust,
    guideDustPathRenderer,
    reusableSnapshot,
    interpolationBuffers,
    skillTombRenderer,
    skillTombEffectRenderer,
    consumedSkillTombKeySet,
    dialogueState,
    dialogueRenderer,
    levelRng,
    renderProfiler,
    cachedDecorationCenterX,
    cachedDecorationCenterY,
    getVirtualWidthPx:  () => virtualWidthPx,
    getVirtualHeightPx: () => virtualHeightPx,
    getGraphicsQuality,
    getPersistentPlayerWorldConfig: () => ({
      assistMode: runOptions?.assistMode === true,
      combatMode: getCombatMode(),
    }),
    setCurrentRoom:             (r) => { currentRoom     = r; },
    setBgColor:                 (c) => { bgColor          = c; },
    setRoomWidthWorld:          (w) => { roomWidthWorld   = w; },
    setRoomHeightWorld:         (h) => { roomHeightWorld  = h; },
    setFiredDialogueTriggerUids:(u) => { firedDialogueTriggerUids = u; },
    setCachedRoomConversations: (v) => { cachedRoomConversations  = v; },
    setCachedWallDecorations:   (d) => { cachedWallDecorations    = d; },
    getPreloadScheduleHandle:   () => _preloadScheduleHandle,
    setPreloadScheduleHandle:   (h) => { _preloadScheduleHandle   = h; },
    getWarmScheduleHandle:      () => _warmScheduleHandle,
    setWarmScheduleHandle:      (h) => { _warmScheduleHandle      = h; },
    getPreTransitionVelocity:   () => transitionCoordinator.getPreTransitionVelocity(),
  };

  // ── Transition cooldown ───────────────────────────────────────────────────
  // After a room switch, block checkRoomTransitions for this many milliseconds
  // so the spawn point's proximity to the return transition does not
  // immediately fire another room switch (double-trigger bug).
  // TRANSITION_COOLDOWN_MS constant is imported from gameCameraState.ts.

  // ── Transition debug stats ────────────────────────────────────────────────
  // Populated each frame and forwarded to the render profiler debug panel.
  const transitionDebugState: TransitionDebugState = {
    lastTransitionPlayerSpeedWorld: 0,
    lastTransitionDestRoomId: '',
  };

  const lambdaAnchorState = createGameLambdaAnchorState(() => {
    // No-op: transition reveal system removed (legacy feature).
  });

  // ── Initial zone-load progress (BUILD 430; extracted BUILD 441) ───────────
  // Gameplay, sim, input, and transitions remain blocked while isActive.
  // The zone overlay is shown BEFORE the RAF loop starts so the user sees a
  // progress screen while the ZoneResidentLoader builds the starting zone.
  const initialZoneLoad = new InitialZoneLoadProgress();

  // ── Initial loading overlay ───────────────────────────────────────────────
  // Shown when gameplay first starts (or when a room's sprites are not yet
  // loaded).  Polled each frame and dismissed once areRoomSpritesReady().
  const loadingOverlay = new GameLoadingOverlay(uiRoot);
  // Flag to track whether this is the very first room load (campaign start).
  // Used to trigger the longer "fade from black" effect on initial campaign load.
  let isInitialCampaignLoad = true;

  function showLoadingOverlay(): void {
    loadingOverlay.show(isInitialCampaignLoad);
    isInitialCampaignLoad = false; // subsequent room loads use the standard fade
  }

  // ── Post-load entry fade (todo #11) ───────────────────────────────────────
  // Deterministic 0.75s fade-to-black / 0.5s hold / 0.75s fade-in cover for full
  // campaign entry/re-entry (new game, load save, Return to Last Save,
  // restart). Every startGameScreen() call is itself one such entry (a fresh
  // gameplay session), except an immediate editor-playtest open, which skips
  // the effect since gameplay is never actually shown first.
  const entryFadeOverlay = new GameEntryFadeOverlay(uiRoot);
  const entryFadeState = createEntryFadeState();
  if (openEditorImmediately !== true) {
    armEntryFade(entryFadeState);
  }

  /** Hides the overlay once sprites are ready, the minimum show time has passed,
   *  no async room load is in progress, the initial resident build phase is done,
   *  the zone transition load is done, and the entry viewport warm completed. */
  function tickLoadingOverlay(): void {
    loadingOverlay.tick(() =>
      !transitionCoordinator.isBlockingGameplay()
      && !initialZoneLoad.isActive
      && areRoomSpritesReady(currentRoom)
      && isRoomBackgroundDecodeReady(currentRoom)
      && isEntryWarmReadyOrTimedOut(entryWarmState),
    );
  }

  // ── Dust container state (armor system) ─────────────────────────────────
  /** Number of dust particles the player currently has. */
  // ── DEV-only transition profiler helpers ─────────────────────────────────
  /** Build the room-content counters surfaced in transition summaries. */
  function _buildRoomCounts(room: RoomDef): TP.TransitionProfileRoomCounts {
    const lightCount =
      (room.lightSources?.length    ?? 0) +
      (room.sceneLights?.length     ?? 0) +
      (room.sunbeams?.length        ?? 0);
    const liquidCount =
      (room.waterZones?.length      ?? 0) +
      (room.lavaZones?.length       ?? 0);
    const objectCount =
      (room.skillTombs?.length      ?? 0) +
      (room.dustContainers?.length  ?? 0) +
      (room.dustContainerPieces?.length ?? 0) +
      (room.dustSwarms?.length      ?? 0) +
      (room.lambdaAnchors?.length   ?? 0) +
      (room.spikes?.length          ?? 0) +
      (room.springboards?.length    ?? 0) +
      (room.breakableBlocks?.length ?? 0) +
      (room.crumbleBlocks?.length   ?? 0) +
      (room.bouncePads?.length      ?? 0) +
      (room.kineticBlocks?.length   ?? 0) +
      (room.dustBoostJars?.length   ?? 0) +
      (room.fireflyJars?.length     ?? 0) +
      (room.dustPiles?.length       ?? 0) +
      (room.ropes?.length           ?? 0) +
      (room.fallingBlocks?.length   ?? 0) +
      (room.dialogueTriggers?.length ?? 0) +
      (room.guideDustPaths?.length  ?? 0) +
      (room.decorations?.length     ?? 0);
    return {
      widthBlocks:  room.widthBlocks,
      heightBlocks: room.heightBlocks,
      wallCount:    room.walls.length,
      enemyCount:   room.enemies.length,
      objectCount,
      liquidCount,
      lightCount,
      blockerCount: room.ambientLightBlockers?.length ?? 0,
      bgBlockCount: room.backgroundBlocks?.length    ?? 0,
    };
  }

  /** Convert a TransitionReadinessDiagnostic into the compact prewarm summary. */
  function _buildPrewarmFromDiag(d: TransitionReadinessDiagnostic | null): TP.TransitionProfilePrewarm | null {
    if (d === null) return null;
    return {
      wallPresent:           d.wallPrewarmPresent,
      bgPresent:             d.bgPrewarmPresent,
      bgRequired:            d.bgPrewarmRequired,
      renderStateKeyMatches: d.renderStateKeyMatches,
      entryViewportCovered:  d.entryViewportCovered,
      missReason:            d.missReason,
    };
  }

  // ── Room-transition execution coordinator (BUILD 442) ────────────────────
  // Owns transition-path selection (cross-zone deferral → resident hot-swap →
  // prepared instant → async cache-miss), the async room-load generator state,
  // the captured pre-transition velocity, the pending cross-zone activation,
  // and the blocking-gameplay contract.  See roomTransitionLoadCoordinator.ts
  // for the full responsibility/ordering documentation.  Dependencies still
  // owned by this screen (world reference, current room, entry-warm state,
  // loading overlay, viewport/zoom, profiler glue) are injected as narrow
  // ports below.
  const transitionCoordinator = new RoomTransitionLoadCoordinator({
    registry: ROOM_REGISTRY,
    manager: residentRoomManager,
    buildScheduler: residentBuildScheduler,
    zoneLoader: {
      startZoneLoad: (worldNumber) => { _zoneLoader.startZoneLoad(worldNumber, residentRoomManager); },
      getZoneRoomIds: (worldNumber) => _zoneLoader.getZoneRoomIds(worldNumber),
      tickZoneLoad: () => _zoneLoader.tickZoneLoad(residentRoomManager, RESIDENT_CAMPAIGN_SEED, virtualWidthPx, virtualHeightPx, camera.zoom),
      getZoneProgress: () => _zoneLoader.getZoneProgress(residentRoomManager),
      buildZoneRoomIdSet: (worldNumber) => _zoneLoader.buildZoneRoomIdSet(worldNumber),
      evictInactiveZoneResidents: (activeWorldNumber, previousWorldNumber) => {
        _zoneLoader.evictInactiveZoneResidents(activeWorldNumber, previousWorldNumber, residentRoomManager);
      },
    },
    overlay: {
      showLoadingOverlay: () => { showLoadingOverlay(); },
      showEntryWarm: () => { loadingOverlay.showEntryWarm(); },
      showZoneLoad: (worldNumber, totalRooms, isInitialLoad) => {
        loadingOverlay.showZoneLoad(worldNumber, totalRooms, isInitialLoad);
      },
      updateZoneProgress: (worldNumber, residentsReady, totalRooms) => {
        loadingOverlay.updateZoneProgress(worldNumber, residentsReady, totalRooms);
      },
    },
    profiler: {
      begin: (roomId, mode, residentReady) => {
        if (import.meta.env.DEV) TP.beginTransition(roomId, mode, residentReady);
      },
      end: (room, diag) => {
        if (import.meta.env.DEV) TP.endTransition(_buildRoomCounts(room), _buildPrewarmFromDiag(diag));
      },
      isVerbose: () => import.meta.env.DEV && TP.isTransitionVerboseLogging(),
    },
    levelRng,
    getCurrentRoom: () => currentRoom,
    getWorld: () => world,
    setWorld: (w) => {
      // Active-world replacement (resident hot-swap).  loadRoomCtx.world must
      // be updated in the same step so activation helpers target the new world.
      world = w;
      loadRoomCtx.world = w;
    },
    getRoomPreparedState: (roomId) => {
      const cacheEntry = roomRuntimeCache.get(roomId);
      if (cacheEntry === undefined) return 'cold';
      return isEntryFullyPrepared(cacheEntry) ? 'prepared' : 'partial';
    },
    loadRoomSync: (room, spawnXBlock, spawnYBlock) => { loadRoom(room, spawnXBlock, spawnYBlock); },
    createResidentBuildGenerator: (room) =>
      createResidentBuildGenerator(room, RESIDENT_CAMPAIGN_SEED, roomRuntimeCache, undefined),
    capturePlayerTransfer: (sourceWorld) => {
      handleGateRoomExit(sourceWorld);
      return capturePlayerTransferState(sourceWorld);
    },
    detachPlayerFromWorld: detachPlayerFromResidentWorld,
    defaultPlayerHealth: PLAYER_INITIAL_HEALTH,
    applyResidentActivation: (room, spawnXBlock, spawnYBlock, carryHealthPoints, playerTransfer) =>
      applyResidentRoomActivation(loadRoomCtx, room, spawnXBlock, spawnYBlock, carryHealthPoints, playerTransfer),
    canSkipEntryWarm: (room, spawnXBlock, spawnYBlock) =>
      canSkipEntryWarm(room, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom),
    resetEntryWarm: () => { entryWarmState = createEntryWarmState(); },
    startEntryWarm: (room, spawnXBlock, spawnYBlock) => {
      startEntryWarm(entryWarmState, room, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom);
    },
    getRoomPrewarmReadiness,
    getLastAdoptionResult,
    recordTransitionOutcome,
    queueZoneEntryViewportTasks: (zoneRoomIds) => {
      addZoneEntryViewportTasks(zoneRoomIds, ROOM_REGISTRY, runtimeCache, virtualWidthPx, virtualHeightPx, camera.zoom);
    },
    areRoomSpritesReady,
    isRoomBackgroundDecodeReady,
    updateRadiusReadyCounts: () => { _updateRadiusReadyCounts(); },
    isDevMode: import.meta.env.DEV,
  });

  // Track explored rooms
  if (progress && !progress.exploredRoomIds.includes(currentRoom.id)) {
    progress.exploredRoomIds.push(currentRoom.id);
    onRoomCleared();
  }

  // Initial room load — use saved spawn point if returning to a save.
  // If a campaign spawn override was provided (from campaignSpawn in the packed campaign)
  // and no save data overrides, use the campaign spawn position.
  // resolveSpawnBlock clamps to bounds and finds an open spot if the position
  // is inside a solid wall (handles out-of-bounds saves, new rooms, etc.).
  const desiredSpawnBlock = (progress && progress.lastSaveSpawnBlock && progress.lastSaveRoomId === currentRoom.id)
    ? progress.lastSaveSpawnBlock
    : (campaignSpawnBlockOverride ?? currentRoom.playerSpawnBlock);
  const initialSpawnBlock = resolveSpawnBlock(currentRoom, desiredSpawnBlock[0], desiredSpawnBlock[1]);
  if (import.meta.env.DEV) {
    const _initLoadT0 = performance.now();
    loadRoom(currentRoom, initialSpawnBlock[0], initialSpawnBlock[1]);
    console.log(
      `[startup] initial loadRoom(${currentRoom.id}) done in ` +
      `${(performance.now() - _initLoadT0).toFixed(1)}ms`,
    );
  } else {
    loadRoom(currentRoom, initialSpawnBlock[0], initialSpawnBlock[1]);
  }
  // Register the start room as the initial active resident and store the world.
  residentRoomManager.ensureResident(currentRoom);
  residentRoomManager.setActiveResidentId(currentRoom.id);
  residentRoomManager.setResidentWorld(currentRoom.id, world, true);
  // Pre-register adjacent rooms (radius ≤ 2) as resident shells.
  for (const [adjId] of bfsNearbyRooms(currentRoom.id, ROOM_REGISTRY, 2)) {
    const adjRoom = ROOM_REGISTRY.get(adjId);
    if (adjRoom !== undefined) residentRoomManager.ensureResident(adjRoom);
  }

  // ── Initial zone-load phase (BUILD 430) ──────────────────────────────────
  // Replaces the old radius-2 startup build.  Builds resident WorldStates,
  // decodes sprites, and prewarms entry viewports for EVERY room in the
  // starting world/zone.  The loading overlay is shown before the RAF loop
  // starts.  Gameplay, sim, input, and transitions remain blocked until the
  // zone is ready.
  //
  // The initial zone load is driven inside the RAF loop, ticking the
  // ZoneResidentLoader (which handles yield frames internally) and reporting
  // progress through `initialZoneLoad`.
  {
    const _startWorldNumber = currentRoom.worldNumber ?? 1;
    _zoneLoader.startZoneLoad(_startWorldNumber, residentRoomManager);
    const _zoneRoomIds = _zoneLoader.getZoneRoomIds(_startWorldNumber);
    const _hasWork = !_zoneLoader.isZoneReady(_startWorldNumber, residentRoomManager);
    if (_hasWork) {
      initialZoneLoad.begin(_zoneRoomIds.length);
      residentRoomManager.setInitialRadius2Progress(_zoneRoomIds.length, 0, 0, 0, false);
    } else {
      residentRoomManager.setInitialRadius2Progress(0, 0, 0, 0, true);
      residentBuildScheduler.refreshFromNeighborhood();
      _updateRadiusReadyCounts();
    }
  }
  // Start the entry warm immediately after the initial load so the overlay
  // holds until the entry viewport has shaded chunks available.
  startEntryWarm(entryWarmState, currentRoom, initialSpawnBlock[0], initialSpawnBlock[1], virtualWidthPx, virtualHeightPx, camera.zoom);

  // Preload sprites for adjacent rooms in the background.
  preloadAdjacentRoomAssets(currentRoom);

  // Decode the active character's sprite set before gameplay becomes visible,
  // and log a diagnostic (with the character ID and failed URL) rather than
  // leaving a silent green placeholder box if any file is missing.
  void preloadActiveCharacterSprites(progress?.characterId ?? 'knight');

  // Show the zone-load overlay BEFORE the RAF loop begins so the browser paints
  // it before the first zone-build frame fires.
  {
    const _startWorldNumber = currentRoom.worldNumber ?? 1;
    const _zoneTotal = _zoneLoader.getZoneRoomIds(_startWorldNumber).length;
    if (initialZoneLoad.isActive) {
      loadingOverlay.showZoneLoad(_startWorldNumber, _zoneTotal, isInitialCampaignLoad);
      isInitialCampaignLoad = false;
    } else {
      showLoadingOverlay();
    }
  }

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

  // ── Dust selection wheel ────────────────────────────────────────────────
  const dustWheelController = new DustSelectionWheelController();
  const dustWheelGestureState = createDustWheelGestureState();
  const onDustWheelBlur = (): void => {
    dustWheelController.cancel(performance.now());
  };
  window.addEventListener('blur', onDustWheelBlur);

  function preloadAdjacentCurrentRoomAssets(): void {
    preloadAdjacentRoomAssets(currentRoom);
  }

  let menuButton: HTMLButtonElement | null = null;
  if (IS_TOUCH_DEVICE) {
    menuButton = document.createElement('button');
    menuButton.textContent = 'MENU';
    menuButton.style.cssText = `
      position: absolute; top: 16px; right: 16px;
      background: rgba(0,0,0,0.6); border: 2px solid #00cfff; color: #00cfff;
      padding: 10px 20px; font-size: 1rem; font-family: 'Cinzel', serif;
      cursor: pointer; border-radius: 6px; touch-action: manipulation;
    `;
    menuButton.addEventListener('click', () => {
      inputState.isEscapePressed = true;
    });
    uiRoot.appendChild(menuButton);
  }

  // ── World Editor ────────────────────────────────────────────────────────
  let editorDebugControls: ReturnType<typeof createGameEditorDebugControls> | null = null;
  const editorRoomActivationPorts: GameEditorRoomActivationPorts = {
    resolveSpawn: resolveSpawnBlock,
    bumpRoomVersion: roomId => { residentBuildScheduler.bumpRoomVersion(roomId); },
    invalidateRuntime: roomId => { roomRuntimeCache.invalidate(roomId); },
    invalidateChunkPrewarm: invalidateRoomChunkPrewarm,
    invalidateResidentWorld: roomId => { residentRoomManager.invalidateResidentWorld(roomId); },
    invalidateZone: worldNumber => { _zoneLoader.invalidateZone(worldNumber); },
    queueRebuildAfterEdit: roomId => { residentBuildScheduler.queueRebuildAfterEdit(roomId); },
    loadRoom: (room, spawnX, spawnY, preserveCamera) => {
      loadRoom(room, spawnX, spawnY, preserveCamera);
    },
    getActiveWorld: () => world,
    ensureResident: room => { residentRoomManager.ensureResident(room); },
    setActiveResidentId: roomId => { residentRoomManager.setActiveResidentId(roomId); },
    setResidentWorld: (roomId, residentWorld, isActive) => {
      residentRoomManager.setResidentWorld(roomId, residentWorld, isActive);
    },
  };
  const editorController: EditorController = createEditorController(canvas, uiRoot, (roomDef, spawnX, spawnY, preserveCamera) => {
    applyGameEditorRoomActivation(
      roomDef,
      spawnX,
      spawnY,
      preserveCamera,
      ROOM_REGISTRY,
      editorRoomActivationPorts,
    );
  }, () => {
    // Called when editor closes (confirm or cancel)
    // Prevent an editor M-key press from leaking into gameplay and opening the map.
    inputState.isMapKeyTriggeredFlag = false;
    editorDebugControls?.handleEditorClosed();
  }, campaignSession ?? null);

  function requestReturnToMainMenu(): void {
    editorController.requestExit(() => {
      isRunning = false;
      detachInput();
      callbacks.onReturnToMenu();
    });
  }

  editorDebugControls = createGameEditorDebugControls({
    uiRoot,
    editorController,
    getCurrentRoom: () => currentRoom,
  });

  // Failsafe: if campaign start wiring looks broken, force-open editor visual map.
  if (shouldOpenFailsafeEditor) {
    editorController.toggle(currentRoom);
    editorController.openVisualMap();
  }

  const hudState: HudState = { fps: 0, frameTimeMs: 0, particleCount: 0 };

  // Owns normalized current/checkpoint values and waiting-for-intent state.
  // Screen-level early returns still decide which frames are eligible to tick.
  const runTimer = createGameRunTimer(
    runOptions?.initialRunTimerMs,
    runOptions?.initialCheckpointRunTimerMs,
  );

  let lastTimestampMs = 0;
  /** Last full renderFrame() args — reused by the death-freeze branch to keep
   * redrawing the frozen scene (with an updated death-dust pool) each frame
   * without advancing world.tick or any other gameplay/input state. */
  let lastRenderFrameArgs: RenderFrameContext | null = null;
  let accumulatorMs = 0;
  let frameCount = 0;
  let fpsAccMs = 0;
  let isRunning = true;
  let rafHandle = 0;
  let interactInputPulseMs = 0;

  // ── Adaptive quality state ───────────────────────────────────────────────
  // Monitors rolling average frame time and toggles a quality-reduction mode
  // when the average is persistently over budget.  Logic extracted to
  // gameAdaptiveQuality.ts so the state machine can be reasoned about in isolation.
  const aqState: AdaptiveQualityState = createAdaptiveQualityState();

  const gameOverlayController = createGameOverlayController({
    uiRoot,
    getWorld: () => world,
    roomRegistry: ROOM_REGISTRY,
    progress,
    campaignSpawnRoom,
    campaignSpawnBlock,
    skillTombRenderer,
    getCurrentRoom: () => currentRoom,
    getCurrentRoomOrigin: () => [currentRoomOriginXWorld, currentRoomOriginYWorld],
    loadRoom,
    onResetTransitionReveal: () => { armEntryFade(entryFadeState); },
    onResetFrameClock: () => { lastTimestampMs = 0; },
    onExitToMainMenu: () => {
      requestReturnToMainMenu();
    },
    onSave: () => {
      residentRoomManager.resetSecretBlocks(world, currentRoom.id);
      callbacks.onSave?.();
      handleGateSaveCompleted(world);
    },
    onCheckpointReached: () => {
      // Snapshot the current timer as the checkpoint value.
      const checkpointMs = runTimer.captureCheckpoint();
      if (callbacks.onCheckpointReached) callbacks.onCheckpointReached(checkpointMs);
    },
    onRespawn: () => {
      residentRoomManager.resetSecretBlocks(world, currentRoom.id);
      // Restore the timer to the checkpoint value and wait for player movement.
      runTimer.restoreCheckpoint();
    },
  });

  const pauseController = createGamePauseController({
    uiRoot,
    canOpenPauseMenu: () => !gameOverlayController.state.isPlayerDead
      && !gameOverlayController.state.isSkillTombMenuOpen
      && !gameOverlayController.state.isMapOnlyOpen,
    onResetFrameClock: () => {
      lastTimestampMs = 0;
    },
    onExitToMainMenu: () => {
      requestReturnToMainMenu();
    },
    onDebugModeChanged: (isDebugMode) => {
      if (isDebugMode) {
        editorDebugControls?.ensureEditorButton();
      } else {
        editorDebugControls?.removeEditorButton();
      }
    },
    onEnterWorldEditor: () => {
      editorController.toggle(currentRoom);
    },
    onResizeCanvas: resizeCanvas,
  });

  function onResize(): void {
    resizeCanvas();
  }
  window.addEventListener('resize', onResize);

  // Thin error boundary around the real per-frame work below. Without this,
  // an uncaught exception anywhere in frameImpl() (sim tick, snapshot build,
  // any renderer) propagates out of the rAF callback and the loop simply
  // stops rescheduling itself — the game silently freezes on whatever was
  // last drawn, in every room, with no console output pointing at the cause.
  // Catching here logs the real stack trace and keeps the loop alive so a
  // single bad frame degrades gracefully instead of permanently hanging.
  function frame(timestampMs: number): void {
    try {
      frameImpl(timestampMs);
    } catch (err) {
      console.error('[gameScreen] Uncaught error in frame(); loop continues.', err);
      if (isRunning) rafHandle = requestAnimationFrame(frame);
    }
  }

  function frameImpl(timestampMs: number): void {
    if (!isRunning) return;
    playerSpeedometerOverlay.hide();
    playerSpeedGraphOverlay.hide();

    const elapsedMs = lastTimestampMs === 0 ? FIXED_DT_MS : timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;

    // Reset per-frame freeze-profiler counters (works in both dev and production
    // because it also resets the production-safe sprite-bake budget counter).
    FP.beginFrame(elapsedMs);
    if (import.meta.env.DEV) resetLegacyShadingFrameStats();

    // Record raw frame time to the profiler ring buffer unconditionally so
    // frame-pacing stats are available immediately when debug mode is enabled.
    renderProfiler.recordFrameTime(elapsedMs);

    // Advance resident room frame counter (used for LRU eviction timestamps).
    residentRoomManager.tickFrame();

    // ── Adaptive quality update ───────────────────────────────────────────
    // Reads the profiler's EMA average frame time and adjusts quality caps
    // when the average is persistently over/under budget.
    updateAdaptiveQuality(aqState, renderProfiler);

    hudState.frameTimeMs = elapsedMs;
    fpsAccMs += elapsedMs;
    frameCount++;
    if (fpsAccMs >= 500) {
      hudState.fps = (frameCount / fpsAccMs) * 1000;
      fpsAccMs = 0;
      frameCount = 0;
    }

    // ── Compute camera offset for screen → world conversion ──────────────
    const { offsetXPx, offsetYPx } = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
    const zoom = camera.zoom;
    const player = world.clusters[0];
    const playerAimOriginXPx = player === undefined
      ? canvas.width * 0.5
      : ((player.positionXWorld * zoom + offsetXPx) / virtualWidthPx) * canvas.width;
    const playerAimOriginYPx = player === undefined
      ? canvas.height * 0.5
      : ((player.positionYWorld * zoom + offsetYPx) / virtualHeightPx) * canvas.height;
    pollGamepadInput(
      inputState,
      canvas.width,
      canvas.height,
      timestampMs,
      playerAimOriginXPx,
      playerAimOriginYPx,
    );

    // ── Editor mode gate ──────────────────────────────────────────────────
    // When the editor is active, it takes over camera and input; skip gameplay.
    if (editorController.state.isActive) {
      if (!wasEditorActiveLastFrame) {
        // Editor just opened this frame — force a fresh backdrop snapshot.
        editorBackdropSnapshotFresh = false;
      }
      wasEditorActiveLastFrame = true;
      // Use CSS display dimensions for mouse coordinate mapping (not buffer dimensions)
      const canvasRect = canvas.getBoundingClientRect();
      const isEditorConsuming = editorController.update(
        elapsedMs / 1000, camera, offsetXPx, offsetYPx, zoom,
        canvasRect.width, canvasRect.height, virtualWidthPx, virtualHeightPx,
      );

      if (isEditorConsuming) {
        // Still render the game world (walls, particles, etc.) as backdrop.
        // Recompute offset AND zoom fresh from camera post-update, since the
        // editor may have changed camera.zoom this frame (mismatching the
        // stale `zoom` local captured above would misalign the backdrop).
        const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
        const eox = camOff.offsetXPx;
        const eoy = camOff.offsetYPx;
        const editorZoom = camera.zoom;
        if (!editorBackdropSnapshotFresh || editorBackdropSnapshotWorld !== world) {
          updateSnapshotInPlace(
            reusableSnapshot,
            world,
            1.0,
            interpolationBuffers.prevClusterPosX,
            interpolationBuffers.prevClusterPosY,
          );
          editorBackdropSnapshotFresh = true;
          editorBackdropSnapshotWorld = world;
        }
        // Item E: the lightweight backdrop view, NOT getRoomDef() — the
        // latter forces a full whole-room RoomDef reconversion after every
        // ordinary edit. See editor/editorBackdropRoom.ts.
        const editorBackdropRoom = editorController.getBackdropRoom() ?? currentRoom;
        renderEditorBackdrop(
          ctx,
          deviceCtx,
          virtualCanvas,
          canvas,
          webglRenderer,
          bloomSystem,
          world,
          reusableSnapshot,
          editorBackdropRoom,
          bgColor,
          eox,
          eoy,
          editorZoom,
          virtualWidthPx,
          virtualHeightPx,
          environmentalDust,
          skillTombRenderer,
          skillTombEffectRenderer,
          editorController,
          hudState,
          renderProfiler,
          pauseController.state.isDebugMode,
        );

        rafHandle = requestAnimationFrame(frame);
        // endFrame covers editor-backdrop frames too.
        if (import.meta.env.DEV) FP.setFrameGameContext('editor');
        FP.setBakeForbiddenInGameplay(false);
        FP.endFrame();
        return;
      }
    } else {
      wasEditorActiveLastFrame = false;
    }

    // ── Initial zone-load phase (BUILD 430) ─────────────────────────────────
    // Drives the ZoneResidentLoader one tick per RAF frame.  The zone loader
    // handles its own yield frames internally.  The loading overlay is updated
    // with progress text each frame.
    if (initialZoneLoad.isActive) {
      const _zoneDone = _zoneLoader.tickZoneLoad(residentRoomManager, RESIDENT_CAMPAIGN_SEED, virtualWidthPx, virtualHeightPx, camera.zoom);

      // Update overlay progress text.
      const _zoneProgress = _zoneLoader.getZoneProgress(residentRoomManager);
      if (_zoneProgress !== null) {
        loadingOverlay.updateZoneProgress(
          _zoneProgress.worldNumber,
          _zoneProgress.residentsReady,
          _zoneProgress.totalRooms,
        );
        initialZoneLoad.recordProgress(_zoneProgress.residentsReady, _zoneProgress.totalRooms);
      }

      const _initElapsed = initialZoneLoad.elapsedMs(performance.now());
      residentRoomManager.setInitialRadius2Progress(
        initialZoneLoad.total,
        initialZoneLoad.built,
        initialZoneLoad.failed,
        _initElapsed,
        _zoneDone,
      );
      if (_zoneDone) {
        initialZoneLoad.finish();
        if (import.meta.env.DEV) {
          console.log(
            `[startup] initial zone load done: ${initialZoneLoad.built}/${initialZoneLoad.total} built` +
            (initialZoneLoad.failed > 0 ? `, ${initialZoneLoad.failed} failed` : '') +
            ` in ${_initElapsed.toFixed(0)}ms`,
          );
          logWallTemplateDiagnosticsSummary('startup');
        }
        // Zone entry viewport tasks are now queued exactly once internally by ZoneResidentLoader
        residentBuildScheduler.refreshFromNeighborhood();
        _updateRadiusReadyCounts();
      }
      // Update diagnostics every zone-build frame.
      if (pauseController.state.isDebugMode) {
        renderProfiler.updateResidentDiagnostics(residentRoomManager.getDiagnostics());
      }
      tickLoadingOverlay();
      if (import.meta.env.DEV) FP.setFrameGameContext('loading');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Async room load advancement ──────────────────────────────────────────
    // When a room transition fired but the target was not in the prepared cache,
    // the coordinator advances the load generator one phase per RAF frame while
    // the loading overlay is displayed.  Gameplay is frozen until loading
    // completes; on completion the coordinator applies the deferred velocity,
    // registers the resident world, starts the entry warm, and refreshes
    // neighborhood build work.
    if (transitionCoordinator.isAsyncLoadActive()) {
      transitionCoordinator.advanceAsyncLoad();
      // Keep the overlay visible and skip gameplay sim/render this frame.
      tickLoadingOverlay();
      if (import.meta.env.DEV) FP.setFrameGameContext('loading');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      // Reset the frame-delta accumulator so the first gameplay frame after
      // loading does not charge elapsed time from this (frozen) frame to the
      // speedrun timer or physics simulation.
      lastTimestampMs = 0;
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Entry viewport warm phase ─────────────────────────────────────────────
    // When a new room's entry viewport is being warmed (shaded chunks being
    // built), advance the warm in a loading-style frame — before command
    // processing, before sim ticks, and without marking the frame as gameplay.
    // The loading overlay covers the player while the warm is active so no
    // simulation, movement, or player input is processed.

    // ── Cross-zone transition load phase (BUILD 430) ──────────────────────────
    // When the player crosses a zone boundary the coordinator defers the
    // activation and drives the zone loader one tick per RAF frame until the
    // target zone is fully ready, then re-activates the target room through
    // the normal transition path (see roomTransitionLoadCoordinator.ts).
    if (transitionCoordinator.isZoneTransitionActive()) {
      transitionCoordinator.tickZoneTransition();
      if (transitionCoordinator.isZoneTransitionActive()) {
        // Still loading — hold overlay, skip gameplay.
        tickLoadingOverlay();
        if (import.meta.env.DEV) FP.setFrameGameContext('loading');
        FP.setBakeForbiddenInGameplay(false);
        FP.endFrame();
        lastTimestampMs = 0;
        rafHandle = requestAnimationFrame(frame);
        return;
      }
      // Zone just became ready and the deferred activation ran above.
      // If the transition was instant (hot-swap), gameplay resumes this frame.
      // If it spawned another async/entryWarm state, those branches will catch it.
      // Fall through to the normal gameplay path.
    }

    if (entryWarmState.phase === 'warming') {
      if (import.meta.env.DEV) FP.setFrameGameContext('entryWarm');
      FP.setBakeForbiddenInGameplay(false);
      tickEntryWarm(entryWarmState, currentRoom, roomRuntimeCache);
      tickLoadingOverlay();
      FP.endFrame();
      // Reset the frame-delta accumulator so the first gameplay frame after
      // entry warm does not charge the warm duration to the speedrun timer.
      lastTimestampMs = 0;
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Room entry hold ───────────────────────────────────────────────────────
    // Entry warm has completed (or was never needed), but the loading overlay
    // may still be visible while source sprites or the background image finish
    // decoding.  Hold simulation and input until the overlay self-dismisses to
    // prevent gameplay advancing while the screen is still covered.
    if (loadingOverlay.isVisible() &&
        (!areRoomSpritesReady(currentRoom) || !isRoomBackgroundDecodeReady(currentRoom))) {
      if (import.meta.env.DEV) FP.setFrameGameContext('loading');
      FP.setBakeForbiddenInGameplay(false);
      tickLoadingOverlay();
      FP.endFrame();
      // Reset the frame-delta accumulator so the first gameplay frame after
      // the entry hold does not charge hold time to the speedrun timer.
      lastTimestampMs = 0;
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Post-load entry fade (todo #11) ───────────────────────────────────────
    // All readiness gates above have cleared (initial zone load, async/zone
    // room load, entry warm, sprite/background decode) — only now may the
    // deterministic fade-to-black / hold / fade-in sequence begin timing.
    // Ordinary room-to-room transitions never arm this state, so they fall
    // straight through here every frame with no effect.
    if (isEntryFadeActive(entryFadeState)) {
      const fadeResult = tickEntryFade(entryFadeState, elapsedMs);
      entryFadeOverlay.setAlpha(fadeResult.overlayAlpha);
      if (fadeResult.didJustResumeGameplay) {
        // Resume normal simulation/input/timers starting this frame while the
        // cover continues fading away on top; no loading/fade time may become
        // a catch-up tick, and no input buffered while blocked may fire now.
        lastTimestampMs = 0;
        clearAllTriggeredInputFlags(inputState);
      }
      if (fadeResult.blocksGameplay) {
        if (import.meta.env.DEV) FP.setFrameGameContext('loading');
        FP.setBakeForbiddenInGameplay(false);
        FP.endFrame();
        rafHandle = requestAnimationFrame(frame);
        return;
      }
    }

    // ── Dialogue advance input (capture before collectCommands drains the flag)
    const dialogueAdvanceRequested = inputState.isDialogueAdvanceTriggeredFlag;

    // ── Dust selection wheel: Interact gesture recognition ─────────────────
    // Runs before collectCommands (called inside processPlayerCommands) so a
    // wheel-open/cancel decision is already resolved into inputState by the
    // time normal command collection sees it.
    {
      const isWheelEligible = isDustWheelAvailable(world, progress);
      const wasWheelOpen = dustWheelController.isOpen();
      // Escape cancels the open wheel without changing dust, and must not
      // also open the pause menu this frame.
      if (wasWheelOpen && inputState.isEscapePressed) {
        dustWheelController.cancel(timestampMs);
        inputState.isEscapePressed = false;
      }
      const gestureResult = updateDustWheelGesture(
        dustWheelGestureState, inputState, timestampMs, isWheelEligible, dustWheelController.isOpen(),
      );
      if (gestureResult.cancelWheel) dustWheelController.cancel(timestampMs);
      if (gestureResult.openWheel) dustWheelController.open(progress, timestampMs);
      if (gestureResult.fireNormalInteract) inputState.isInteractTriggeredFlag = true;
    }

    const commandResult = processPlayerCommands({
        inputState, world, canvas,
        offsetXPx, offsetYPx, zoom,
        virtualWidthPx, virtualHeightPx,
        skillTombRenderer, skillTombEffectRenderer,
        progress, consumedSkillTombKeySet, combatText,
        currentRoomId: currentRoom.id,
        openMapOnly: gameOverlayController.openMapOnly,
        currentRoom,
        collectedDustSwarmKeySet,
        levelRng,
        nowMs: timestampMs,
        linkedAnchorIndex: lambdaAnchorState.linkedAnchorIndex,
        linkedAnchorRoomId: lambdaAnchorState.linkedAnchorRoomId,
        setLambdaAnchorLink: lambdaAnchorState.setLambdaAnchorLink,
        clearLambdaAnchorLink: lambdaAnchorState.clearLambdaAnchorLink,
        lambdaTeleportFlash: lambdaAnchorState.lambdaTeleportFlash,
        dustWheel: dustWheelController,
      });
    const { moveDx, jumpTriggered, openPause, interactInputPulseTrigger, grappleFireTriggered } = commandResult;
    let { interactTriggered } = commandResult;

    let pendingGrappleFireSfx = grappleFireTriggered;

    // ── Dialogue advance ───────────────────────────────────────────────────
    // When dialogue is active, advance (or close) the overlay and suppress
    // normal gameplay logic for this frame (player movement is blocked below).
    handleDialogueAdvance(dialogueAdvanceRequested, dialogueState, dialogueRenderer);

    if (interactInputPulseTrigger) {
      interactInputPulseMs = 150;
      if (interactWithNearbyChallengeTotem(world)) interactTriggered = false;
    }

    if (openPause) {
      pauseController.openPauseMenu();
    }

    if (interactTriggered && progress) {
      gameOverlayController.openSkillTombMenu();
    }

    // Update music volume from pause menu settings
    musicManager.setVolume(pauseController.state.pauseMenuState.musicVolume);

    // While paused or in a menu, still render the frozen scene but skip sim and transitions
    if (pauseController.state.isPaused
      || gameOverlayController.state.isSkillTombMenuOpen
      || gameOverlayController.state.isMapOnlyOpen) {
      playerSfx.stopWind();
      dustWheelController.cancel(timestampMs);
      deactivateShieldWeave(world.shieldWeave);
      if (import.meta.env.DEV) FP.setFrameGameContext('paused');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // While dead, still render the frozen scene but skip sim. The player-death
    // dust burst keeps animating using this frame's real elapsedMs (a
    // dedicated visual-effect clock), redrawing the last full frozen frame
    // via the cached renderFrame() args so it visibly blows away instead of
    // vanishing into a single static frame. world.tick, physics, input, and
    // every other simulation/gameplay update remain frozen.
    if (gameOverlayController.state.isPlayerDead) {
      playerSfx.stopWind();
      dustWheelController.cancel(timestampMs);
      deactivateShieldWeave(world.shieldWeave);
      playerDeathDust.update(elapsedMs);
      if (lastRenderFrameArgs !== null) {
        renderFrame(lastRenderFrameArgs);
      }
      if (import.meta.env.DEV) FP.setFrameGameContext('paused');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Speedrun timer tick ─────────────────────────────────────────────────
    // The timer is paused: in menus (handled by early returns above), while
    // loading (the async-load check above returns early), and while waiting
    // for the player to move after a load or respawn.
    //
    // Movement detection: only intentional horizontal directional input or
    // jump input counts.  Passive physics (gravity settling, camera, particles,
    // room init) do NOT count.  This matches the spirit of "the player has
    // not moved yet" for the waiting state.
    const _player = world.clusters[0];
    runTimer.tick(
      elapsedMs,
      _player !== undefined && _player.isAliveFlag === 1,
      moveDx,
      jumpTriggered,
      inputState.isJumpHeldFlag || inputState.isGamepadJumpHeldFlag,
    );

    // ── Room transition check ──────────────────────────────────────────────
    // NOTE: the TimeStop Field release-on-transition hook does NOT live here.
    // This block runs every frame regardless of whether a transition is about
    // to fire, so releasing here would release stored momentum continuously
    // (within one frame of capture) instead of only at an actual transition.
    // The release is performed inside orchestrateRoomTransitions' fire
    // callback (gameRoomTransitionOrchestrator.ts), which only runs at the
    // moment a transition is confirmed — see that file for the hook.
    const preTransVX = world.clusters[0]?.velocityXWorld ?? 0;
    const preTransVY = world.clusters[0]?.velocityYWorld ?? 0;

    orchestrateRoomTransitions(
      world,
      currentRoom,
      roomWidthWorld,
      roomHeightWorld,
      camState,
      elapsedMs,
      true, // isCrossingInactive: always true (instant transitions only)
      preTransVX,
      preTransVY,
      (room, spawnXBlock, spawnYBlock, vx, vy, dir) => {
        // A room transition beginning always closes the wheel safely — the
        // new room's mote queue is rebuilt from scratch on load anyway.
        dustWheelController.cancel(timestampMs);
        transitionCoordinator.submitTransition(room, spawnXBlock, spawnYBlock, vx, vy, dir);
      },
      resolveSpawnBlock,
      camera,
      currentRoomOriginXWorld,
      currentRoomOriginYWorld,
      preloadAdjacentCurrentRoomAssets,
      transitionDebugState,
    );

    // ── Room preload anticipation policy (BUILD 443) ──────────────────────
    // Extracted to roomPreloadAnticipationPolicy.ts.  Handles proximity-based
    // and velocity-direction-based preload boosting for transition targets.
    applyRoomPreloadAnticipationPolicy(
      world.clusters[0],
      currentRoom,
      currentRoomOriginXWorld,
      currentRoomOriginYWorld,
      preloadAnticipationPorts,
    );

    // ── Dialogue trigger check ─────────────────────────────────────────────
    // Each trigger fires once per room visit (firedDialogueTriggerUids is
    // reset on room load). A trigger fires only when dialogue is not already
    // open to prevent repeated starts while standing still.
    {
      const player = world.clusters[0];
      // Convert to room-local block coords (triggers are defined in room space).
      const playerXBlock = player ? Math.floor((player.positionXWorld - currentRoomOriginXWorld) / BLOCK_SIZE_SMALL) : -1;
      const playerYBlock = player ? Math.floor((player.positionYWorld - currentRoomOriginYWorld) / BLOCK_SIZE_SMALL) : -1;
      checkDialogueTriggers(
        playerXBlock, playerYBlock,
        currentRoom, firedDialogueTriggerUids, cachedRoomConversations,
        dialogueState, dialogueRenderer,
      );
      // Dialogue opening (via trigger or otherwise) closes an open wheel safely.
      if (dialogueState.isDialogueActiveFlag) {
        dustWheelController.cancel(timestampMs);
      }
    }

    // During active dialogue, freeze player movement (suppress moveDx/jump inputs).
    const isDialogueBlockingInput = dialogueState.isDialogueActiveFlag;
    const isDownHeld = inputState.isKeyS || inputState.isGamepadDownHeldFlag;

    // Latch one-shot jump and down inputs into world state before ticking.
    // This preserves edge-triggered inputs on high-refresh frames where no
    // fixed sim tick runs (accumulator < FIXED_DT_MS).
    // Suppress movement inputs while dialogue is active so the player stands still.
    if (jumpTriggered && !isDialogueBlockingInput) {
      world.playerJumpTriggeredFlag = 1;
    }
    if (inputState.isDownTriggeredFlag && !isDialogueBlockingInput) {
      world.playerDownTriggeredFlag = 1;
      inputState.isDownTriggeredFlag = false;
    } else if (isDialogueBlockingInput) {
      inputState.isDownTriggeredFlag = false;
    }
    world.playerJumpHeldFlag = !isDialogueBlockingInput
      && (inputState.isJumpHeldFlag || inputState.isGamepadJumpHeldFlag) ? 1 : 0;


    // ── Sim ticks ──────────────────────────────────────────────────────────
    // Cap the catch-up budget to 5 fixed ticks so that long pauses (tab switch,
    // DevTools breakpoint, OS sleep) cannot drive hundreds of unconstrained ticks
    // in a single render frame, which would cause instant death, runaway enemy AI,
    // and multi-second browser stalls.
    accumulatorMs = Math.min(accumulatorMs + elapsedMs, FIXED_DT_MS * 5);

    let _simTickCount = 0;
    while (accumulatorMs >= FIXED_DT_MS) {
      // Capture cluster positions just before THIS tick so that after the loop,
      // prevClusterPos holds the positions from the start of the LAST tick that
      // ran.  Combined with renderAlpha (the remaining accumulator fraction),
      // this enables smooth sub-tick interpolation at any display refresh rate:
      // the renderer blends from prevPos to currentPos as renderAlpha grows from
      // 0 toward 1 between ticks, producing continuous motion with no lurching.
      // Capturing before ALL ticks (the old approach) caused the sprite to freeze
      // at currentPos on no-tick frames then snap back when a tick finally fired.
      captureClusterInterpolationState(world, interpolationBuffers);

      // Capture falling block Y offsets before this tick so the renderer can
      // smoothly interpolate tile positions between physics steps.
      // Cap at MAX_FALLING_BLOCK_GROUPS — the buffer is pre-allocated to that size.
      captureFallingBlockInterpolationState(world, interpolationBuffers);

      const player = world.clusters[0];
      if (player !== undefined) {
        // Suppress horizontal movement during active dialogue.
        world.playerMoveInputDxWorld = (!isDialogueBlockingInput && moveDx !== 0) ? (moveDx > 0 ? 1.0 : -1.0) : 0.0;
        world.playerMoveInputDyWorld = (!isDialogueBlockingInput && isDownHeld) ? 1.0 : 0.0;
      }
      // Pass crouch input to the sim
      world.playerCrouchHeldFlag = (!isDialogueBlockingInput && isDownHeld) ? 1 : 0;
      updateRoomChallengeElements(world, progress);
      tick(world);
      // Consume this tick's deterministic Verdant flower-bloom events right
      // away so multiple sim ticks per rendered frame never overwrite each
      // other's events before the render-only pool sees them.
      verdantFlowerTrail.consumeSpawnEvents(world);
      const stormweavePlayer = world.clusters[0];
      if (stormweavePlayer !== undefined && stormweavePlayer.isAliveFlag === 1) {
        const currentMoteCount = getStormweaveMoteCount(stormweavePlayer.healthPoints);
        if (world.shieldWeave.isActive && world.shieldWeave.moteCount !== currentMoteCount) {
          updateShieldWeaveState(
            world.shieldWeave,
            0,
            currentMoteCount,
            stormweavePlayer.positionXWorld,
            stormweavePlayer.positionYWorld,
            stormweavePlayer.halfHeightWorld * 2,
            world.playerWeaveAimDirXWorld,
            world.playerWeaveAimDirYWorld,
          );
        }
        stormweaveLifeMotes.reconcile(
          currentMoteCount,
          stormweavePlayer.positionXWorld,
          stormweavePlayer.positionYWorld,
        );
        stormweaveLifeMotes.update(
          FIXED_DT_MS / 1000,
          stormweavePlayer.positionXWorld,
          stormweavePlayer.positionYWorld,
          stormweavePlayer.velocityXWorld,
          stormweavePlayer.velocityYWorld,
          getGraphicsQuality() === 'high',
          world.shieldWeave,
          world.selectedDustKind,
        );
      } else {
        deactivateShieldWeave(world.shieldWeave);
        stormweaveLifeMotes.reconcile(0, 0, 0);
      }
      _simTickCount++;
      // If the player died during this tick, stop processing further ticks in
      // this frame.  Continuing to run enemy AI, spike contact, and force
      // accumulation on a dead cluster produces erratic post-death effects.
      if (world.clusters[0]?.isAliveFlag === 0) {
        accumulatorMs -= FIXED_DT_MS;
        break;
      }
      // Process large slime splits (spawn child slimes when large slime dies)
      const newSlimes = processLargeSlimeSplits(world);
      for (let s = 0; s < newSlimes.length; s++) {
        world.clusters.push(newSlimes[s]);
      }
      environmentalDust.update(world, FIXED_DT_MS);
      atmosphericLightDust.update(FIXED_DT_MS);
      guideDustPathRenderer.update(FIXED_DT_MS);
      skidDebris.update(world, FIXED_DT_MS);
      weakWallJumpDebris.update(world, FIXED_DT_MS);
      updatePlayerSfx(playerSfx, playerSfxState, world, pendingGrappleFireSfx, FIXED_DT_MS / 1000, crackedBlockShatter);
      pendingGrappleFireSfx = false;

      // ── Crumble block debris events & ambient lighting rebuild ────────────
      tickCrumbleDebrisEvents(world, crumbleDebris, prevCrumbleActive, prevCrumbleHits, FIXED_DT_MS);

      // ── Cracked-block momentum shatter particles ───────────────────────────
      tickCrackedBlockShatterEvents(world, crackedBlockShatter, FIXED_DT_MS);

      // ── Fragile custom-block break events (Phase 2C) ──────────────────────
      tickBreakEvents(world, breakEffects, playerSfx, getGraphicsQuality(), FIXED_DT_MS);
      accumulatorMs -= FIXED_DT_MS;
    }

    // Fraction of a tick remaining in the accumulator — used to blend rendered
    // cluster positions between the pre-tick and post-tick physics positions.
    const renderAlpha = accumulatorMs / FIXED_DT_MS;

    // Record sim-tick count in the freeze profiler (dev-only no-op in production).
    FP.recordSimTicks(_simTickCount);

    // ── Check for player death ───────────────────────────────────────────────
    const playerForDeath = world.clusters[0];
    if (playerForDeath !== undefined
      && playerForDeath.isAliveFlag === 0
      && !gameOverlayController.state.isPlayerDead) {
      const deathCharSprites = getCharacterSprites(world.characterId);
      // getPlayerSprite only reads flag/velocity fields that ClusterState already
      // has (isCrouchingFlag, isGroundedFlag, velocityXWorld/YWorld,
      // playerIdleAnimState) — cast past the render-only ClusterSnapshot shape
      // (which adds interpolated renderPositionXWorld/YWorld) rather than
      // constructing an interpolated snapshot for a one-shot death effect.
      const deathSprite = getPlayerSprite(
        deathCharSprites,
        playerForDeath as unknown as ClusterSnapshot,
        world.isGrappleActiveFlag === 1,
      );
      triggerPlayerDeathDustFromSprite(
        playerDeathDust,
        deathSprite,
        playerForDeath.positionXWorld,
        playerForDeath.positionYWorld,
        playerForDeath.isFacingLeftFlag === 1,
        PLAYER_SPRITE_WIDTH_WORLD,
        PLAYER_SPRITE_HEIGHT_WORLD,
        PLAYER_SPRITE_PIVOT_X_WORLD,
        deathDustTriggerSeed++,
      );
      gameOverlayController.showPlayerDeathScreen();
      dustWheelController.cancel(timestampMs);
    }

    // ── Update skill tomb renderer ──────────────────────────────────────────
    const playerForTomb = world.clusters[0];
    if (playerForTomb !== undefined && playerForTomb.isAliveFlag === 1) {
      // Convert to room-local coords since tomb positions are room-local.
      const tombPx = playerForTomb.positionXWorld - currentRoomOriginXWorld;
      const tombPy = playerForTomb.positionYWorld - currentRoomOriginYWorld;
      skillTombRenderer.update(tombPx, tombPy, elapsedMs / 1000);
      skillTombEffectRenderer.update(tombPx, tombPy, elapsedMs / 1000);

      processRoomPickups(world, currentRoom, collectedDustContainerKeySet, progress, playerForTomb, levelRng,
        currentRoomOriginXWorld, currentRoomOriginYWorld,
        (kind, xWorld, yWorld) => dustContainerPickupEffect.spawnPickupBurst(kind, xWorld, yWorld));
      dustContainerPickupEffect.update(FIXED_DT_MS / 1000, playerForTomb.positionXWorld, playerForTomb.positionYWorld);
    }

    // ── Update camera to follow player ──────────────────────────────────────
    const playerForCamera = world.clusters[0];
    if (playerForCamera !== undefined && playerForCamera.isAliveFlag === 1) {
      // Use the render-interpolated player position so the camera tracks the
      // same sub-tick position that the sprite will be drawn at.  This keeps
      // the player visually centred and prevents background/wall parallax
      // jitter relative to the sprite.
      const camTargetX = interpolationBuffers.prevClusterPosX[0]
        + (playerForCamera.positionXWorld - interpolationBuffers.prevClusterPosX[0]) * renderAlpha;
      const camTargetY = interpolationBuffers.prevClusterPosY[0]
        + (playerForCamera.positionYWorld - interpolationBuffers.prevClusterPosY[0]) * renderAlpha;

      updateCameraFollow(
        camState,
        camera,
        camTargetX,
        camTargetY,
        null, // renderUnionBounds: always null (instant transitions, no staged rooms)
        roomWidthWorld,
        roomHeightWorld,
        virtualWidthPx,
        virtualHeightPx,
        elapsedMs,
        pauseController.state.pauseMenuState.alwaysCenterCamera,
      );
    }

    // ── Recompute camera offset after update ─────────────────────────────────
    const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
    const ox = camOff.offsetXPx;
    const oy = camOff.offsetYPx;

    // Record room/camera context for structured freeze warnings (dev-only).
    if (import.meta.env.DEV) {
      const _fp_player = world.clusters[0];
      const _fp_pxBlock = _fp_player ? Math.floor(_fp_player.positionXWorld / BLOCK_SIZE_SMALL) : -1;
      const _fp_pyBlock = _fp_player ? Math.floor(_fp_player.positionYWorld / BLOCK_SIZE_SMALL) : -1;
      FP.setFrameContext(
        currentRoom.id,
        `ox=${ox.toFixed(0)}px,oy=${oy.toFixed(0)}px`,
        `${_fp_pxBlock},${_fp_pyBlock}`,
      );
      // Mark this as an active-gameplay frame so freeze warnings highlight it.
      FP.setFrameGameContext('gameplay');
    }

    // Forbid expensive derived-sprite baking during active gameplay to prevent
    // getImageData/putImageData stalls.  Cheap unshaded fallbacks are used
    // instead.  This flag is cleared in all non-gameplay early-return paths.
    FP.setBakeForbiddenInGameplay(true);

    let aliveCount = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1) aliveCount++;
    }
    hudState.particleCount = aliveCount;

    // ── Populate movement debug state from the player cluster ─────────────────
    if (pauseController.state.isDebugMode) {
      hudState.debug = buildHudDebugState(world, inputState, interactInputPulseMs);
    } else {
      hudState.debug = undefined;
    }

    if (interactInputPulseMs > 0) {
      interactInputPulseMs = Math.max(0, interactInputPulseMs - elapsedMs);
    }

    // ── Update procedural cloak (per-frame visual, not per-tick sim) ──────
    updatePlayerCloaks(
      playerCloak,
      phantomCloak,
      world,
      interpolationBuffers.prevClusterPosX,
      interpolationBuffers.prevClusterPosY,
      renderAlpha,
      elapsedMs,
      momentumTrail,
    );
    updateVerdantAfterimageTrailFrame(
      verdantAfterimageTrail,
      world,
      interpolationBuffers.prevClusterPosX,
      interpolationBuffers.prevClusterPosY,
      renderAlpha,
      elapsedMs,
    );
    verdantFlowerTrail.update(elapsedMs / 1000);

    // ── Render frame (all canvas draw calls delegated to gameRender.ts) ───
    updateSnapshotInPlace(
      reusableSnapshot,
      world,
      renderAlpha,
      interpolationBuffers.prevClusterPosX,
      interpolationBuffers.prevClusterPosY,
    );

    // ── Preview bubble computation ────────────────────────────────────────
    // Removed: preview bubbles are a legacy feature (not rendered in instant transitions).

    // ── Transition debug stats ────────────────────────────────────────────
    if (pauseController.state.isDebugMode && renderProfiler !== undefined) {
      const debugStats: TransitionDebugStats = {
        currentRoomId: currentRoom.id,
        lastPlayerSpeedWorld: transitionDebugState.lastTransitionPlayerSpeedWorld,
        transitionCooldownMs: camState.transitionCooldownMs,
        destinationRoomId: transitionDebugState.lastTransitionDestRoomId,
      };
      renderProfiler.updateTransitionStats(debugStats);
    }

    // Feed prewarm stats to profiler each frame (cheap — reads cached data).
    if (pauseController.state.isDebugMode) {
      renderProfiler.updatePrewarmStats(getPrewarmStats());
      renderProfiler.updateEntryWarmState(entryWarmState);
      renderProfiler.updateResidentDiagnostics(residentRoomManager.getDiagnostics());
    }

    const _renderT0 = import.meta.env.DEV ? performance.now() : 0;
    // Advance the wheel's cosmetic open/close animation for this render.
    dustWheelController.tick(timestampMs);

    const renderFrameArgs = {
      ctx, deviceCtx, virtualCanvas, canvas,
      webglRenderer, environmentalDust, skidDebris, crumbleDebris, crackedBlockShatter, breakEffects, weakWallJumpDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem, dustContainerPickupEffect, playerDeathDust,
      playerCloak, phantomCloak, momentumTrail, verdantAfterimageTrail, verdantFlowerTrail, stormweaveLifeMotes, darkRoomOverlay, decorationWaveState,
      sunbeamRenderer, sunraysRenderer, atmosphericLightDust, guideDustPathRenderer, fallingBlockDust,
      world, currentRoom, isChallengeModeActive: world.challengeMode.isActive,
      snapshot: reusableSnapshot,
      cachedDecorations: cachedWallDecorations,
      cachedDecorationCenterX,
      cachedDecorationCenterY,
      ox, oy, zoom, virtualWidthPx, virtualHeightPx,
      bgColor, isDebugMode: pauseController.state.isDebugMode, hudState, inputState,
      prevHealthMap, healthBarDisplayUntilTick,
      combatText, prevLastPlayerBlockedTick,
      collectedDustContainerKeySet,
      isDustContainerSpriteLoaded,
      dustContainerSprite,
      isDustContainerShardSpriteLoaded,
      dustContainerShardSprite,
      collectedDustSwarmKeySet,
      linkedAnchorIndex: lambdaAnchorState.linkedAnchorIndex,
      linkedAnchorRoomId: lambdaAnchorState.linkedAnchorRoomId,
      teleportFlashAlpha: lambdaAnchorState.teleportFlashAlpha,
      setTeleportFlashAlpha: lambdaAnchorState.setTeleportFlashAlpha,
      runTimerMs: runTimer.getCurrentMs(),
      graphicsQuality: pauseController.state.pauseMenuState.graphicsQuality,
      isAdaptiveReductionActive: aqState.isAdaptiveReductionActive,
      isDeepReductionActive: aqState.isDeepReductionActive,
      renderProfiler,
      renderAlpha,
      prevFallingBlockOffsetY: interpolationBuffers.prevFallingBlockOffsetY,
      // isCrossing is always false — instant transitions only.
      isCrossing: false,
      crossingUnionMinXWorld: 0,
      crossingUnionMinYWorld: 0,
      crossingUnionMaxXWorld: roomWidthWorld,
      crossingUnionMaxYWorld: roomHeightWorld,
      alwaysCenterCamera: pauseController.state.pauseMenuState.alwaysCenterCamera,
      stagedRoom: null,
      dustWheel: dustWheelController,
      // Render-only radius-1 adjacent-room view. getRenderState is cached and
      // returns the shared empty state (no work) when the effective setting is off.
      connectedRoomState: adjacentRoomCoordinator.getRenderState(currentRoom),
      adjacentRoomDrawPorts,
      adjacentRoomDrawImpl: productionAdjacentRoomDrawImpl,
      adjacentMaxChunksPerRoom: 6,
    };
    renderFrame(renderFrameArgs);
    // Cached so the death-freeze branch above can redraw this exact frozen
    // frame on subsequent frames while advancing only the death-dust effect
    // (world.tick stays frozen — see the isPlayerDead early return).
    lastRenderFrameArgs = renderFrameArgs;
    playerSpeedometerOverlay.update({
      world,
      playerRenderXWorld: reusableSnapshot.clusters[0]?.renderPositionXWorld ?? world.clusters[0]?.positionXWorld ?? 0,
      playerRenderYWorld: reusableSnapshot.clusters[0]?.renderPositionYWorld ?? world.clusters[0]?.positionYWorld ?? 0,
      canvas,
      nativeWidthPx: virtualWidthPx,
      nativeHeightPx: virtualHeightPx,
      offsetXPx: ox,
      offsetYPx: oy,
      zoom,
    });
    playerSpeedGraphOverlay.update({
      world,
      nowMs: timestampMs,
    });
    FP.recordRenderMs(import.meta.env.DEV ? performance.now() - _renderT0 : 0);

    // Tick the loading overlay — hides it once sprites are ready.
    tickLoadingOverlay();

    // ── Resident build queue scheduler (BUILD 418+; extracted BUILD 441) ─────
    // Advances at most one incremental build phase per frame, then starts a
    // new session budget-permitting.  Session lifecycle, stale-build
    // rejection, and budget gating live in residentBuildScheduler.ts.
    //
    // Scheduling note (BUILD 419): build phases execute post-render, before
    // FP.endFrame(), so their cost is included in the current frame's wall time
    // but NOT attributed to the gameplay sim or render buckets.  A true
    // post-paint path (requestIdleCallback) would avoid contributing to frame
    // latency, but requires additional synchronisation to ensure builds never
    // read/write the active room's WorldState or roomRuntimeCache from a
    // callback that races with the RAF loop.  Deferred to a future pass;
    // the per-phase debug overlay (currentBuildPhase) gives sufficient
    // visibility into the cost of individual phases in the interim.
    residentBuildScheduler.advanceFrame();

    // ── Frame-budget-driven background preload slice ────────────────────────
    // Supplements the requestIdleCallback-based schedulers with deterministic
    // progress driven by this frame's actual measured spare time — see the
    // constants declared above for rationale.  Gated on the previous frame
    // having genuine headroom so this can never itself cause a frame to blow
    // its budget; each scheduler further self-limits internally (chunk/room
    // count and per-room cost thresholds).
    {
      const _lastFrameMsForPreload = renderProfiler.getLastFrameMs();
      const _preloadSpareMs = preloadSliceFrameBudgetMs - _lastFrameMsForPreload;
      if (_preloadSpareMs > 0) {
        const _sliceMs = Math.min(_preloadSpareMs, preloadSliceMaxMs);
        _preloadScheduleHandle?.runSliceNow(_sliceMs);
        runChunkPrewarmSliceNow(_sliceMs);
      }
    }

    // Clear the gameplay-bake-forbidden flag before ending the frame so it
    // does not persist into the next non-gameplay frame (e.g. paused frames
    // that render immediately after a gameplay frame).
    FP.setBakeForbiddenInGameplay(false);

    // Commit freeze-profiler frame data; emits structured [freeze] LONG FRAME
    // console warning (dev-only) when the frame exceeds LONG_FRAME_WARN_MS.
    FP.endFrame();

    rafHandle = requestAnimationFrame(frame);
  }

  // ── DEV-only bench hook for transition profiling ────────────────────────
  // Exposes `window.__dwBenchTransition(roomId, opts?)` for the dev console.
  // Triggers a synthetic transition into `roomId` by invoking the same code
  // path used by orchestrateRoomTransitions.  Each call produces one entry
  // in the transition profiler history (visible via __dwTransitionStats()).
  //
  // opts.spawnBlock  — [x,y] block coords (defaults to room.playerSpawnBlock)
  // opts.dir         — 'left' | 'right' | 'up' | 'down' (defaults to 'right')
  // opts.iterations  — repeat count; for back-and-forth use ['A','B']
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    type BenchOpts = {
      spawnBlock?: readonly [number, number];
      dir?:        TransitionDirection;
      vx?:         number;
      vy?:         number;
      waitFrames?: number;
    };
    type SpriteAtlasBenchSummary = {
      ok: true;
      roomId: string;
      atlasEnabled: boolean;
      transition: TP.TransitionProfile | null;
      transitionTotalMs: number | null;
      longestPhase: { name: string; ms: number } | null;
      prewarm: TP.TransitionProfilePrewarm | null;
      atlasBefore: SpriteAtlasStats;
      atlasAfter: SpriteAtlasStats;
      atlasDelta: {
        lookups: number;
        hits: number;
        misses: number;
        fallbacks: number;
          unsupportedPaths: number;
      };
    };
    type SpriteAtlasBenchResult = SpriteAtlasBenchSummary | SpriteAtlasBenchUnavailable;
    type DwWin = Window & {
      __dwBenchTransition?: (roomId: string, opts?: BenchOpts) => boolean;
      __dwBenchPingPong?: (roomIdA: string, roomIdB: string, iterations: number) => void;
      __dwBenchSpriteAtlasRoom?: (roomId: string, opts?: BenchOpts) => Promise<SpriteAtlasBenchResult>;
    };
    const w = window as DwWin;
    w.__dwBenchTransition = (roomId: string, opts?: BenchOpts): boolean => {
      const targetRoom = ROOM_REGISTRY.get(roomId);
      if (targetRoom === undefined) {
        console.warn(`[bench] unknown roomId: ${roomId}`);
        return false;
      }
      const sp = opts?.spawnBlock ?? targetRoom.playerSpawnBlock;
      const dir = opts?.dir ?? 'right';
      transitionCoordinator.submitTransition(targetRoom, sp[0], sp[1], opts?.vx ?? 0, opts?.vy ?? 0, dir);
      return true;
    };
    w.__dwBenchPingPong = (a: string, b: string, iterations: number): void => {
      // Best-effort: schedules transitions one per RAF frame so each completes
      // before the next is issued.  Not robust if a transition uses the async
      // multi-frame path — caller should warm both rooms first.
      let i = 0;
      const tick = (): void => {
        if (i >= iterations) return;
        const target = (i % 2 === 0) ? b : a;
        w.__dwBenchTransition?.(target);
        i++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const waitForFrames = (frames: number): Promise<void> => new Promise(resolve => {
      let remaining = Math.max(1, Math.floor(frames));
      const tick = (): void => {
        remaining--;
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    w.__dwBenchSpriteAtlasRoom = async (roomId: string, opts?: BenchOpts): Promise<SpriteAtlasBenchResult> => {
      if (ROOM_REGISTRY.get(roomId) === undefined) {
        return {
          ok: false,
          roomId,
          error: `Unknown roomId: ${roomId}`,
          prerequisite: 'Pass a room id that exists in ROOM_REGISTRY for the active campaign.',
          debug: getSpriteAtlasDebugInfo(),
        };
      }
      if (typeof w.__dwBenchTransition !== 'function') {
        return {
          ok: false,
          roomId,
          error: 'Transition benchmark helper is unavailable.',
          prerequisite: 'window.__dwBenchTransition must be installed by startGameScreen.',
          debug: getSpriteAtlasDebugInfo(),
        };
      }
      const before = getSpriteAtlasStats();
      const started = w.__dwBenchTransition?.(roomId, opts) ?? false;
      if (!started) {
        return {
          ok: false,
          roomId,
          error: `Transition benchmark did not start for roomId: ${roomId}`,
          prerequisite: 'The target room must exist and the game screen must be ready to start a synthetic transition.',
          debug: getSpriteAtlasDebugInfo(),
        };
      }
      await waitForFrames(opts?.waitFrames ?? 3);
      const after = getSpriteAtlasStats();
      const transition = TP.getLastTransition();
      const summary: SpriteAtlasBenchSummary = {
        ok: true,
        roomId,
        atlasEnabled: after.enabled,
        transition: transition?.roomId === roomId ? transition : null,
        transitionTotalMs: transition?.roomId === roomId ? transition.totalMs : null,
        longestPhase: transition?.roomId === roomId ? transition.longestPhase : null,
        prewarm: transition?.roomId === roomId ? transition.prewarm : null,
        atlasBefore: before,
        atlasAfter: after,
        atlasDelta: {
          lookups: after.lookups - before.lookups,
          hits: after.hits - before.hits,
          misses: after.misses - before.misses,
          fallbacks: after.fallbacks - before.fallbacks,
          unsupportedPaths: after.unsupportedPaths - before.unsupportedPaths,
        },
      };
      console.table([{
        room: summary.roomId,
        atlas: summary.atlasEnabled ? 'on' : 'off',
        totalMs: summary.transitionTotalMs !== null ? +summary.transitionTotalMs.toFixed(1) : null,
        longest: summary.longestPhase !== null ? `${summary.longestPhase.name}=${summary.longestPhase.ms.toFixed(1)}ms` : '-',
        lookups: summary.atlasDelta.lookups,
        hits: summary.atlasDelta.hits,
        misses: summary.atlasDelta.misses,
        fallbacks: summary.atlasDelta.fallbacks,
        unsupported: summary.atlasDelta.unsupportedPaths,
        prewarmMiss: summary.prewarm?.missReason ?? null,
      }]);
      return summary;
    };

    // ── DEV-only spawn hook for The Void Herald boss ─────────────────────
    // `window.__dwSpawnHerald(xBlock?, yBlock?)` — spawns The Void Herald directly
    // into the running world at the given block position (defaults to the
    // room center), bypassing the room-def enemy list entirely.
    (w as DwWin & { __dwSpawnHerald?: (xBlock?: number, yBlock?: number) => number }).__dwSpawnHerald =
      (xBlock?: number, yBlock?: number): number => {
        const bx = xBlock ?? Math.floor(world.worldWidthWorld / BLOCK_SIZE_MEDIUM / 2);
        const by = yBlock ?? Math.floor(world.worldHeightWorld / BLOCK_SIZE_MEDIUM / 2);
        const entityId = spawnHeraldForTesting(world, bx * BLOCK_SIZE_MEDIUM, by * BLOCK_SIZE_MEDIUM);
        console.log(`[dev] spawned The Void Herald (entityId=${entityId}) at block (${bx}, ${by})`);
        return entityId;
      };

    (w as DwWin & { __dwSpawnIceWizard?: (xBlock?: number, yBlock?: number) => number }).__dwSpawnIceWizard =
      (xBlock?: number, yBlock?: number): number => {
        const bx = xBlock ?? Math.floor(world.worldWidthWorld / BLOCK_SIZE_MEDIUM / 2);
        const by = yBlock ?? Math.floor(world.worldHeightWorld / BLOCK_SIZE_MEDIUM / 2);
        const entityId = spawnIceWizardForTesting(world, bx * BLOCK_SIZE_MEDIUM, by * BLOCK_SIZE_MEDIUM);
        console.log(`[dev] spawned Ice Wizard (entityId=${entityId}) at block (${bx}, ${by})`);
        return entityId;
      };
  }

  rafHandle = requestAnimationFrame(frame);

  return () => {
    playerSfx.stop();
    // Remove audio unlock listeners in case the user never interacted
    // (they are registered with { once: true } so this is a no-op if they fired).
    window.removeEventListener('pointerdown', _onAudioUnlockGesture);
    window.removeEventListener('keydown',     _onAudioUnlockGesture);
    window.removeEventListener('touchstart',  _onAudioUnlockGesture);
    isRunning = false;
    if (rafHandle !== 0) cancelAnimationFrame(rafHandle);
    _preloadScheduleHandle?.cancel();
    _preloadScheduleHandle = null;
    _warmScheduleHandle?.cancel();
    _warmScheduleHandle = null;
    // Discard queued/in-flight resident builds — the screen (and its worlds)
    // is going away, so no result could ever be adopted.
    residentBuildScheduler.reset();
    // Abandon any in-progress transition work (async load generator, pending
    // cross-zone activation) for the same reason.
    transitionCoordinator.reset();
    pauseController.destroy();
    gameOverlayController.destroy();
    // Stop background music and release resources
    musicManager.dispose();
    editorController.destroy();
    editorDebugControls?.destroy();
    detachInput();
    window.removeEventListener('blur', onDustWheelBlur);
    webglRenderer.dispose();
    dialogueRenderer.destroy();
    playerSpeedometerOverlay.destroy();
    playerSpeedGraphOverlay.destroy();
    window.removeEventListener('resize', onResize);
    loadingOverlay.destroy();
    cancelEntryFade(entryFadeState);
    entryFadeOverlay.destroy();
    if (menuButton !== null && menuButton.parentElement !== null) {
      menuButton.parentElement.removeChild(menuButton);
    }
  };
}
