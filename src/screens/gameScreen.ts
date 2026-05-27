import { createWorldState, type WorldState } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { createRng } from '../sim/rng';
import { createReusableSnapshot, updateSnapshotInPlace } from '../render/snapshot';
import { PlayerCloak } from '../render/clusters/playerCloak';
import { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { HudState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import { GuideDustPathRenderer } from '../render/effects/guideDustPathRenderer';
import { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';
import { WeakWallJumpDebrisRenderer } from '../render/weakWallJumpDebrisRenderer';
import { ArrowWeaveRenderer } from '../render/effects/arrowWeaveRenderer';
import { SwordWeaveRenderer } from '../render/effects/swordWeaveRenderer';
import { FallingBlockDustRenderer } from '../render/fallingBlocks/fallingBlockRenderer';
import { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import { createInputState, attachInputListeners } from '../input/handler';
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ROOM_REGISTRY, STARTING_ROOM_ID } from '../levels/rooms';
import { createCameraState, getCameraOffset } from '../render/camera';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';
import { getMusicVolume, getSelectedRenderSize, getActiveWorldViewPreset, getGraphicsQuality } from '../ui/renderSettings';
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
import { renderFrame } from './gameRender';
import { createCombatTextSystem } from '../render/hud/combatText';
import { processLargeSlimeSplits } from '../sim/clusters/slimeAi';
import { DecorationWaveState } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { MAX_CRUMBLE_BLOCKS } from '../sim/world';
import { processPlayerCommands } from './gameCommandProcessor';
import { createPlayerSfxState, updatePlayerSfx } from './gamePlayerSfx';
import { processRoomPickups } from './gamePickups';
import { createDialogueState } from '../dialogue/dialogueState';
import { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';
import { handleDialogueAdvance, checkDialogueTriggers } from './gameDialogueHandler';
import { updatePlayerCloaks } from './gamePlayerCloakUpdate';
import { tickCrumbleDebrisEvents } from './gameCrumbleDebrisEvents';
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
import { type PreloadScheduleHandle } from './roomPreloadScheduler';
import {
  getPrewarmStats,
  ensureChunkPrewarmQueued,
  invalidateRoomChunkPrewarm,
  recordTransitionOutcome,
  getRoomPrewarmReadiness,
  getLastAdoptionResult,
  type TransitionReadinessDiagnostic,
  type WarmScheduleHandle,
} from './roomRenderChunkWarmScheduler';
import type { TransitionDebugStats } from '../render/transitions/transitionState';
import { GameLoadingOverlay } from './gameLoadingOverlay';
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
import { createGameEditorDebugControls } from './gameEditorDebugControls';
import { createGamePauseController } from './gamePauseController';
import { createGameLambdaAnchorState } from './gameLambdaAnchorState';
import { renderEditorBackdrop } from './gameScreenEditorBackdrop';
import { orchestrateRoomTransitions, type TransitionDebugState } from './gameRoomTransitionOrchestrator';
import type { TransitionDirection } from './gameTransitions';
import { PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';
import * as FP from '../debug/perfFreezeProfiler';
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
import { buildResidentWorldState, createResidentBuildGenerator } from './residentWorldBuilder';
import { PLAYER_INITIAL_HEALTH } from './gameSpawn';

const FIXED_DT_MS = 16.666;

/** Baseline virtual width at 16:9; height is authoritative for fixed zoom. */
const BASE_VIRTUAL_WIDTH_PX = 480;
/** Fixed virtual height so world-to-pixel zoom stays constant on every display. */
const FIXED_VIRTUAL_HEIGHT_PX = 270;
/** Vite base URL for assets. */
const BASE = import.meta.env.BASE_URL;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

/**
 * Fraction of `PLAYER_JUMP_SPEED_WORLD` subtracted from upward-transition
 * vertical velocity to prevent over-boosted launch into the next room above.
 * (BUILD 367: reduced from 1.0 to 0.5.)
 */
const UPWARD_TRANSITION_VY_REDUCTION = 0.5;

/**
 * Number of medium blocks from a room boundary at which the urgent preloader
 * kicks in for unprepared transition targets.  Chosen to give ~166ms lead time
 * at a brisk walk speed (~1 block/10ms) before the transition can fire.
 */
const URGENT_PRELOAD_PROXIMITY_BLOCKS = 10;

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
    const deviceScale = window.devicePixelRatio || 1;
    const selectedRenderSize = getSelectedRenderSize();
    canvas.width = Math.round(selectedRenderSize.widthPx * deviceScale);
    canvas.height = Math.round(selectedRenderSize.heightPx * deviceScale);
    // Read the active World View preset to determine virtual canvas height.
    virtualHeightPx = getActiveWorldViewPreset().virtualHeight;
    virtualWidthPx = Math.max(1, Math.round((canvas.width / canvas.height) * virtualHeightPx));
    virtualCanvas.width = virtualWidthPx;
    virtualCanvas.height = virtualHeightPx;
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

  /** Keys in the format `${roomId}:${xBlock}:${yBlock}` for already-consumed skill tombs. */
  const consumedSkillTombKeySet: Set<string> = new Set();

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
  // hot-swap transitions (see startTransitionLoad: world = targetResident.world).
  let world = createWorldState(FIXED_DT_MS, 42);
  // Set the selected character on the world for rendering
  world.characterId = progress?.characterId ?? 'knight';
  const levelRng = createRng(12345);
  // Stable numeric seed for background resident world builds (BUILD 417).
  // Intentionally a DIFFERENT value from the levelRng seed so it is visually
  // clear that resident builds are decoupled from active gameplay randomness.
  // Per-room RNG is further derived inside buildResidentWorldState() via
  // createResidentRoomRng(room, RESIDENT_CAMPAIGN_SEED), which mixes in the
  // room id hash and world number so each room gets a distinct RNG stream.
  const RESIDENT_CAMPAIGN_SEED = 0xd457_0417; // distinct from levelRng seed (12345)
  const residentRoomManager = new ResidentRoomManager();

  // ── Resident build queue (BUILD 418) ────────────────────────────────────────
  // Explicit priority queue for background resident world builds.
  // Replaces the ad-hoc inline loop that checked getLastFrameMs() < 10.
  //
  // Priority (lower number = built first):
  //   1 — hot-swap transition target (closest boundary)
  //   2 — velocity-direction target  (room the player is heading toward)
  //   3 — radius-1 adjacent room
  //   4 — radius-2 adjacent room
  //   5 — rebuildAfterEdit
  //
  // Invariants:
  //   - Deduplicated by roomId.
  //   - Active room is never in the queue.
  //   - Rooms already runtimeReady are skipped at dequeue time.
  //   - At most one incremental build session active at a time; one phase per frame.
  interface ResidentBuildTask {
    roomId:   string;
    room:     import('../levels/roomDef').RoomDef;
    priority: 1 | 2 | 3 | 4 | 5;
    reason:   'initial' | 'adjacent' | 'proximity' | 'backtrack' | 'rebuildAfterEdit';
  }
  const _residentBuildQueue: ResidentBuildTask[] = [];
  const _residentBuildQueueIds = new Set<string>();
  let _residentBuildQueueDirty = false; // true when new items or priority changes require a re-sort

  /**
   * Per-room version counter.  Incremented when a room is edited so that
   * in-progress incremental build sessions that started before the edit can be
   * detected and discarded (stale-build guard).
   */
  const _roomVersions = new Map<string, number>();

  /**
   * Active incremental build session.  One session is active at a time;
   * the generator is advanced one phase per frame until complete.
   */
  interface ResidentBuildSession {
    task:           ResidentBuildTask;
    /** Generator from createResidentBuildGenerator — yields a phase label each step. */
    gen:            Generator<string, WorldState, void>;
    t0:             number;
    /** Room version at the time the session was dequeued — used for stale-build detection. */
    capturedVersion: number;
    /** Last phase label yielded by the generator, for diagnostics. */
    currentPhase:   string;
  }
  let _activeBuildSession: ResidentBuildSession | null = null;

  /**
   * Enqueue a resident build task.  Deduplicates by roomId and ignores the
   * active room.  If the room is already in the queue with a higher priority
   * number (lower urgency), replace the entry with the new higher-priority one.
   *
   * Also cancels any active build session for the same room so a fresh session
   * (with the current room version) is started.
   */
  function _enqueueResidentBuild(
    task: Omit<ResidentBuildTask, 'room'> & { room?: import('../levels/roomDef').RoomDef },
  ): void {
    if (task.roomId === currentRoom.id) return; // Never build active room.
    const room = task.room ?? ROOM_REGISTRY.get(task.roomId);
    if (room === undefined) return;
    // Cancel an active session for this room so it restarts with fresh version.
    if (_activeBuildSession !== null && _activeBuildSession.task.roomId === task.roomId) {
      _activeBuildSession = null;
    }
    if (_residentBuildQueueIds.has(task.roomId)) {
      // Update priority if new task is more urgent.
      const idx = _residentBuildQueue.findIndex(t => t.roomId === task.roomId);
      if (idx >= 0 && task.priority < _residentBuildQueue[idx].priority) {
        _residentBuildQueue[idx].priority = task.priority;
        _residentBuildQueue[idx].reason   = task.reason;
        _residentBuildQueueDirty = true;
      }
      return;
    }
    _residentBuildQueueIds.add(task.roomId);
    _residentBuildQueue.push({ roomId: task.roomId, room, priority: task.priority, reason: task.reason });
    _residentBuildQueueDirty = true;
  }

  /**
   * Repopulate the build queue from radius-2 BFS of the current room.
   * Called after every transition and after the initial load so the
   * queue always reflects the player's current neighbourhood.
   * Radius-1 rooms get priority 3; radius-2 rooms get priority 4.
   */
  function _refreshResidentBuildQueue(): void {
    for (const [adjId, adjDist] of bfsNearbyRooms(currentRoom.id, ROOM_REGISTRY, 2)) {
      const adjResident = residentRoomManager.getResident(adjId);
      if (adjResident !== undefined && adjResident.runtimeReady) continue;
      _enqueueResidentBuild({ roomId: adjId, priority: adjDist === 1 ? 3 : 4, reason: 'adjacent' });
    }
  }

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
  const atmosphericLightDust = new AtmosphericLightDust();
  const guideDustPathRenderer = new GuideDustPathRenderer();
  const skidDebris = new SkidDebrisRenderer();
  const crumbleDebris = new CrumbleDebrisRenderer();
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
  const decorationWaveState = new DecorationWaveState();
  const arrowWeaveRenderer = new ArrowWeaveRenderer();
  const swordWeaveRenderer = new SwordWeaveRenderer();
  const fallingBlockDust = new FallingBlockDustRenderer();

  // ── Dialogue system ──────────────────────────────────────────────────────
  // The dialogue overlay renders at full device resolution (not the virtual
  // 480×270 canvas) so that text is always crisp regardless of screen DPI.
  // See src/render/ui/dialogueOverlayRenderer.ts for the full rationale.
  const dialogueState = createDialogueState();
  const dialogueRenderer = new DialogueOverlayRenderer(uiRoot);
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

  // Handle for the current idle preload schedule so it can be cancelled when
  // the player switches rooms before the previous schedule completes.
  let _preloadScheduleHandle: PreloadScheduleHandle | null = null;
  // Handle for the current idle chunk prewarm schedule.
  let _warmScheduleHandle: WarmScheduleHandle | null = null;

  // ── Async room load state ─────────────────────────────────────────────────
  // When a room transition fires and the target is not in the prepared cache,
  // the load is spread across multiple RAF frames (one generator phase per
  // frame) while the loading overlay is shown.  This prevents a single large
  // blocking spike during transitions to cold rooms.
  //
  // The player velocity captured before the transition is stored here and
  // applied once the generator completes and the new player cluster exists.
  interface AsyncRoomLoadState {
    isActive: boolean;
    gen: Generator<void, void, void> | null;
    preTransVX: number;
    preTransVY: number;
    transitionDir: TransitionDirection | null;
    /** Spawn block coordinates stored for startEntryWarm() (async generator done and instant transition paths). */
    spawnXBlock: number;
    spawnYBlock: number;
  }
  const asyncLoadState: AsyncRoomLoadState = {
    isActive: false,
    gen: null,
    preTransVX: 0,
    preTransVY: 0,
    transitionDir: null,
    spawnXBlock: 0,
    spawnYBlock: 0,
  };

  // Pre-transition velocity: the player's velocity at the moment the transition
  // was triggered.  Captured in startTransitionLoad (both instant and async paths)
  // and exposed to the load-room generator so Phase F can order the prewarm queue.
  let _preTransVX = 0;
  let _preTransVY = 0;

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
    decorationWaveState,
    environmentalDust,
    sunbeamRenderer,
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
    getPreTransitionVelocity:   () => ({ vx: _preTransVX, vy: _preTransVY }),
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

  // ── Initial resident build phase state (BUILD 418) ───────────────────────
  // Holds state for the pre-gameplay radius-2 build phase.  Gameplay, sim,
  // input, and transitions remain blocked until isActive = false.
  // The loading overlay is shown BEFORE this phase starts so the user sees
  // a black screen with "Loading…" while builds happen.
  const _initialResidentBuildPhase = {
    isActive:    false,
    rooms:       [] as Array<[string, number, number]>,
    idx:         0,
    built:       0,
    failed:      0,
    total:       0,
    t0:          0,
    /** Frames remaining before builds start (allow overlay to paint first). */
    yieldFrames: 2,
  };

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

  /** Hides the overlay once sprites are ready, the minimum show time has passed,
   *  no async room load is in progress, the initial resident build phase is done,
   *  and the entry viewport warm completed. */
  function tickLoadingOverlay(): void {
    loadingOverlay.tick(() =>
      !asyncLoadState.isActive
      && !_initialResidentBuildPhase.isActive
      && areRoomSpritesReady(currentRoom)
      && isRoomBackgroundDecodeReady(currentRoom)
      && isEntryWarmReadyOrTimedOut(entryWarmState),
    );
  }

  // ── Dust container state (armor system) ─────────────────────────────────
  /** Number of dust particles the player currently has. */
  function getPlayerDustCount(): number {
    const player = world.clusters[0];
    if (player === undefined || player.isAliveFlag === 0) return 0;
    let count = 0;
    for (let i = 0; i < world.particleCount; i++) {
      if (world.ownerEntityId[i] === player.entityId && world.isAliveFlag[i] === 1 && world.isTransientFlag[i] === 0) {
        count++;
      }
    }
    return count;
  }

  /**
   * Called by `orchestrateRoomTransitions` when a room transition fires.
   *
   * Fast path (cache hit): calls `loadRoom()` synchronously (the target room is
   * fully prepared so all phases finish in < 1ms) and applies player velocity
   * immediately.
   *
   * Async path (cache miss): spreads the six load phases across six RAF frames,
   * shows the loading overlay while in progress, and defers velocity application
   * until the generator completes.
   */
  function startTransitionLoad(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    vx: number,
    vy: number,
    dir: TransitionDirection,
  ): void {
    const t0 = import.meta.env.DEV ? performance.now() : 0;
    // Capture pre-transition velocity for Phase F prewarm queue ordering.
    _preTransVX = vx;
    _preTransVY = vy;
    const cacheEntry = roomRuntimeCache.get(room.id);
    const isPrepared = cacheEntry !== undefined && isEntryFullyPrepared(cacheEntry);

    // ── True resident world hot-swap (no loadRoom) ────────────────────────
    const targetResident = residentRoomManager.getResident(room.id);
    if (targetResident !== undefined && targetResident.runtimeReady && targetResident.world !== null) {
      if (import.meta.env.DEV) {
        console.log(`[transition] ${room.id}: residentWorldHot — skipping loadRoom`);
      }
      // Record the outgoing room id for the backtrackHot diagnostic.
      const outgoingRoomId = currentRoom.id;
      // Capture player state (health, facing, owned dust particles) BEFORE detach.
      const playerTransferSnap = capturePlayerTransferState(world);
      const carryHealthPoints  = playerTransferSnap?.healthPoints ?? PLAYER_INITIAL_HEALTH;
      // Detach player: kills owned particles, removes cluster, clears grapple flags.
      detachPlayerFromResidentWorld(world);
      // Freeze outgoing world snapshot AFTER removing player (enemies only).
      // Pass playerDetached:true so freezeRoom asserts the player is gone.
      residentRoomManager.ensureResident(currentRoom);
      residentRoomManager.freezeRoom(world, outgoingRoomId, currentRoom, { playerDetached: true });
      residentRoomManager.freezeSimState(world, outgoingRoomId);
      // Preserve the detached outgoing world as a frozen resident so immediate
      // backtracking (B → A) can hot-swap without calling loadRoom.
      const outgoingWorld = world;
      // Switch active world to the target resident's pre-built WorldState.
      world = targetResident.world;
      loadRoomCtx.world = world;
      // Store the detached outgoing world as a frozen resident (runtimeReady=true).
      // This enables instant backtracking: the outgoing room is ready to hot-swap
      // without a loadRoom rebuild.
      residentRoomManager.setResidentWorld(outgoingRoomId, outgoingWorld, false);
      residentRoomManager.recordOutgoingRoom(outgoingRoomId);
      // Apply Phase-A renderer, Phase-B player spawn (with particle transfer),
      // Phase-F env/camera.
      const { particlesRestored, particlesSkipped } = applyResidentRoomActivation(
        loadRoomCtx, room, spawnXBlock, spawnYBlock, carryHealthPoints,
        playerTransferSnap ?? undefined,
      );
      const player = world.clusters[0];
      if (player !== undefined && player.isPlayerFlag === 1) {
        player.velocityXWorld = vx;
        player.velocityYWorld = dir === 'up' ? vy - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION : vy;
      }
      residentRoomManager.setResidentWorld(room.id, world, true);
      residentRoomManager.setActiveResidentId(room.id);
      residentRoomManager.evictDistant(room.id);
      residentRoomManager.recordTransitionMode('residentWorldHot', '', import.meta.env.DEV ? performance.now() - t0 : 0, true);
      residentRoomManager.recordPlayerTransfer(
        playerTransferSnap?.ownedParticles.length ?? 0,
        particlesRestored,
        particlesSkipped,
      );
      if (import.meta.env.DEV) {
        residentRoomManager.scanOwnershipInvariant();
      }
      for (const [adjId] of bfsNearbyRooms(room.id, ROOM_REGISTRY, 2)) {
        const adjRoom = ROOM_REGISTRY.get(adjId);
        if (adjRoom !== undefined) residentRoomManager.ensureResident(adjRoom);
      }
      const { wallPresent: hwWallPresent, bgPresent: hwBgPresent, bgRequired: hwBgRequired } = getRoomPrewarmReadiness(room.id, room);
      const hwAdoptResult = getLastAdoptionResult();
      const hwWallStatus = hwAdoptResult?.wall.status ?? 'missing';
      const hwBgStatus   = hwAdoptResult?.bg.status   ?? 'missing';
      const hwRenderKeyMatches: boolean | null =
        hwWallStatus === 'staleRenderState' || hwBgStatus === 'staleRenderState' ? false :
        hwWallStatus === 'adopted' || hwBgStatus === 'adopted' ? true : null;
      entryWarmState = createEntryWarmState();
      const hwViewportCovered = canSkipEntryWarm(currentRoom, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom);
      if (!hwViewportCovered) {
        startEntryWarm(entryWarmState, currentRoom, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom);
        loadingOverlay.showEntryWarm();
        recordTransitionOutcome('entryWarm', {
          roomId: room.id,
          runtimeReady: true,
          wallPrewarmPresent: hwWallPresent,
          bgPrewarmPresent:   hwBgPresent,
          bgPrewarmRequired:  hwBgRequired,
          renderStateKeyMatches: hwRenderKeyMatches,
          entryViewportCovered: false,
          outcome: 'entryWarm',
          spritesDecoded: areRoomSpritesReady(room),
          backgroundDecoded: isRoomBackgroundDecodeReady(room),
          missReason: 'entryViewportNotCovered',
        });
      } else {
        recordTransitionOutcome('residentWorldHot', {
          roomId: room.id,
          runtimeReady: true,
          wallPrewarmPresent: hwWallPresent,
          bgPrewarmPresent:   hwBgPresent,
          bgPrewarmRequired:  hwBgRequired,
          renderStateKeyMatches: hwRenderKeyMatches,
          entryViewportCovered: true,
          outcome: 'residentWorldHot',
          spritesDecoded: areRoomSpritesReady(room),
          backgroundDecoded: isRoomBackgroundDecodeReady(room),
          missReason: 'none',
        });
      }
      if (import.meta.env.DEV) {
        console.log(`[transition] ${room.id}: residentWorldHot done in ${(performance.now() - t0).toFixed(1)}ms`);
      }
      // Refresh build queue so newly adjacent rooms are queued after transition.
      _refreshResidentBuildQueue();
      _updateRadiusReadyCounts();
      return;
    }

    if (isPrepared) {
      // ── Instant path (fully prepared cache hit + snapshot restore) ─────────
      if (import.meta.env.DEV) {
        console.log(`[transition] ${room.id}: prepared cache HIT — instant load (residentRestore/fallback)`);
      }
      // Freeze the outgoing room before loadRoom destroys its state.
      // playerDetached is NOT set (false/omitted) — the player is still present
      // at this point; this is the legacy snapshot path, not a true hot-swap.
      residentRoomManager.ensureResident(currentRoom);
      residentRoomManager.freezeRoom(world, currentRoom.id, currentRoom);
      residentRoomManager.freezeSimState(world, currentRoom.id);
      // Invalidate outgoing resident world — loadRoom will corrupt it.
      residentRoomManager.invalidateResidentWorld(currentRoom.id);
      // Capture prewarm-store state BEFORE loadRoom (Phase A adoption clears it).
      const { wallPresent, bgPresent, bgRequired } = getRoomPrewarmReadiness(room.id, room);
      const frozenEnemies = residentRoomManager.getFrozenEnemies(room.id);
      const frozenSimState = residentRoomManager.getFrozenSimState(room.id);
      loadRoom(room, spawnXBlock, spawnYBlock);
      // Restore frozen enemy state if this room was previously visited.
      residentRoomManager.ensureResident(room);
      let residentMode: 'residentRestore' | 'residentFallback' = 'residentFallback';
      if (frozenEnemies !== null) {
        try {
          const restored = residentRoomManager.restoreFrozenEnemies(world, frozenEnemies, levelRng);
          if (restored > 0) residentMode = 'residentRestore';
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[resident] restoreFrozenEnemies failed — keeping fresh spawn', err);
          }
        }
      }
      if (frozenSimState !== null) {
        try {
          residentRoomManager.restoreSimState(world, frozenSimState);
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn('[resident] restoreSimState failed — keeping fresh sim state', err);
          }
        }
      }
      // Store the newly loaded world in the resident for future hot-swap.
      residentRoomManager.setResidentWorld(room.id, world, true);
      residentRoomManager.setActiveResidentId(room.id);
      residentRoomManager.evictDistant(room.id);
      residentRoomManager.recordTransitionMode(residentMode, '', import.meta.env.DEV ? performance.now() - t0 : 0);
      // Pre-register adjacent rooms (radius ≤ 2) as resident shells for future freeze snapshots.
      for (const [adjId] of bfsNearbyRooms(room.id, ROOM_REGISTRY, 2)) {
        const adjRoom = ROOM_REGISTRY.get(adjId);
        if (adjRoom !== undefined) residentRoomManager.ensureResident(adjRoom);
      }
      // Retrieve the structured adoption result set by Phase A (adoptPrewarmedChunksForRoom).
      const adoptResult = getLastAdoptionResult();
      const wallAdoptStatus = adoptResult?.wall.status ?? 'missing';
      const bgAdoptStatus   = adoptResult?.bg.status   ?? 'missing';
      const renderStateKeyMatches: boolean | null =
        wallAdoptStatus === 'staleRenderState' || bgAdoptStatus === 'staleRenderState' ? false :
        wallAdoptStatus === 'adopted'          || bgAdoptStatus === 'adopted'          ? true  :
        null;
      const spritesDecoded: boolean | null    = areRoomSpritesReady(room);
      const backgroundDecoded: boolean | null = isRoomBackgroundDecodeReady(room);
      const player = world.clusters[0];
      if (player !== undefined && player.isPlayerFlag === 1) {
        player.velocityXWorld = vx;
        player.velocityYWorld = dir === 'up' ? vy - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION : vy;
      }
      // Start the entry warm for the instant path.  Do NOT tick eagerly here:
      // chunk building inside the transition callback (before the overlay is
      // visible) can cause a hitch on the room-boundary frame.  Instead, show
      // a lightweight textless cover and let the normal RAF loop advance the
      // warm in the dedicated 'entryWarm' early branch.
      //
      // Probe the active chunk caches first: if the entry viewport is already
      // fully covered (e.g. the room was prewarmed before the player arrived),
      // skip the overlay entirely — no visible flash, no warm work needed.
      entryWarmState = createEntryWarmState();
      const viewportCovered = canSkipEntryWarm(currentRoom, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom);
      if (!viewportCovered) {
        startEntryWarm(entryWarmState, currentRoom, spawnXBlock, spawnYBlock, virtualWidthPx, virtualHeightPx, camera.zoom);
        loadingOverlay.showEntryWarm();
        const missReason: TransitionReadinessDiagnostic['missReason'] =
          wallAdoptStatus === 'staleRenderState' || bgAdoptStatus === 'staleRenderState' ? 'staleRenderState' :
          !wallPresent ? 'wallChunksMissing' :
          !bgPresent   ? 'bgChunksMissing'   :
          wallAdoptStatus === 'empty' ? 'wallAdoptEmpty' :
          (bgRequired && bgAdoptStatus === 'empty') ? 'bgAdoptEmpty' :
                         'entryViewportNotCovered';
        if (import.meta.env.DEV) {
          console.warn(
            `[transition] ${room.id}: entryWarm — missReason: ${missReason}` +
            ` wallPresent:${wallPresent} bgPresent:${bgPresent} bgReq:${bgRequired}` +
            ` wall:${wallAdoptStatus} bg:${bgAdoptStatus}`,
          );
        }
        recordTransitionOutcome('entryWarm', {
          roomId: room.id,
          runtimeReady: true,
          wallPrewarmPresent: wallPresent,
          bgPrewarmPresent:   bgPresent,
          bgPrewarmRequired:  bgRequired,
          renderStateKeyMatches,
          entryViewportCovered: false,
          outcome: 'entryWarm',
          spritesDecoded,
          backgroundDecoded,
          missReason,
        });
      } else {
        recordTransitionOutcome(residentMode, {
          roomId: room.id,
          runtimeReady: true,
          wallPrewarmPresent: wallPresent,
          bgPrewarmPresent:   bgPresent,
          bgPrewarmRequired:  bgRequired,
          renderStateKeyMatches,
          entryViewportCovered: true,
          outcome: residentMode,
          spritesDecoded,
          backgroundDecoded,
          missReason: 'none',
        });
      }
      if (import.meta.env.DEV) {
        const warmStatus = entryWarmState.phase === 'idle' ? ' (entryWarm skipped — viewport covered)' : ' (entryWarm started — overlay shown)';
        console.log(
          `[transition] ${room.id}: instant load done in ${(performance.now() - t0).toFixed(1)}ms` + warmStatus,
        );
      }
      // Refresh build queue so newly adjacent rooms are queued after transition.
      _refreshResidentBuildQueue();
      _updateRadiusReadyCounts();
    } else {
      // ── Async path (cache miss — spread over RAF frames) ──────────────────
      if (import.meta.env.DEV) {
        const status = cacheEntry === undefined ? 'cold' : 'partial';
        console.warn(`[transition] ${room.id}: cache MISS (${status}) — async load`);
      }
      // Freeze outgoing room before the async generator destroys world state.
      // playerDetached is NOT set (false/omitted) — the player is still present
      // on the legacy async path; no false duplicate-player diagnostic should fire.
      residentRoomManager.ensureResident(currentRoom);
      residentRoomManager.freezeRoom(world, currentRoom.id, currentRoom);
      residentRoomManager.freezeSimState(world, currentRoom.id);
      residentRoomManager.recordTransitionMode('legacyLoad');
      asyncLoadState.preTransVX    = vx;
      asyncLoadState.preTransVY    = vy;
      asyncLoadState.transitionDir = dir;
      asyncLoadState.spawnXBlock   = spawnXBlock;
      asyncLoadState.spawnYBlock   = spawnYBlock;
      asyncLoadState.gen           = _makeLoadRoomPhases(room, spawnXBlock, spawnYBlock, false);
      asyncLoadState.isActive      = true;
      recordTransitionOutcome('loading', {
        roomId: room.id,
        runtimeReady: false,
        wallPrewarmPresent: false,
        bgPrewarmPresent:   false,
        bgPrewarmRequired:  (room.backgroundBlocks?.length ?? 0) > 0,
        renderStateKeyMatches: null,
        entryViewportCovered: false,
        outcome: 'loading',
        spritesDecoded: null,
        backgroundDecoded: null,
        missReason: 'runtimeNotReady',
      });
      showLoadingOverlay();
      // Advance Phase A immediately (room metadata + world reset, < 1ms).
      // This sets `currentRoom = room` so `onRoomBecameActive()` — called by
      // the orchestrator right after this function returns — will trigger sprite
      // preloads for the NEW room, not the stale one.
      asyncLoadState.gen.next();
    }
  }

  // Track explored rooms
  if (progress && !progress.exploredRoomIds.includes(currentRoom.id)) {
    progress.exploredRoomIds.push(currentRoom.id);
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

  // ── Initial radius-2 resident build (BUILD 418+) ─────────────────────────
  // Build full frozen WorldStates for radius-2 neighbours INSIDE the RAF loop
  // so the loading overlay is visible and progress is shown to the player.
  // Gameplay, sim, input, and transitions remain blocked until the phase ends.
  //
  // The loading overlay is shown BEFORE the RAF loop starts so the browser
  // paints it before the first build frame.  Two yield frames are inserted at
  // the start of the RAF phase to ensure the overlay is visible on screen.
  {
    const _initR2Rooms = bfsNearbyRooms(currentRoom.id, ROOM_REGISTRY, 2);
    const _initR2NeedBuild = _initR2Rooms.filter(([adjId]) => {
      const r = residentRoomManager.getResident(adjId);
      return r === undefined || !r.runtimeReady;
    });
    if (_initR2NeedBuild.length > 0) {
      _initialResidentBuildPhase.isActive    = true;
      _initialResidentBuildPhase.rooms       = _initR2Rooms;
      _initialResidentBuildPhase.idx         = 0;
      _initialResidentBuildPhase.built       = 0;
      _initialResidentBuildPhase.failed      = 0;
      _initialResidentBuildPhase.total       = _initR2NeedBuild.length;
      _initialResidentBuildPhase.t0          = 0; // set on first build frame
      _initialResidentBuildPhase.yieldFrames = 2;
      residentRoomManager.setInitialRadius2Progress(_initR2NeedBuild.length, 0, 0, 0, false);
    } else {
      // Nothing to build — mark complete immediately.
      residentRoomManager.setInitialRadius2Progress(0, 0, 0, 0, true);
      _refreshResidentBuildQueue();
      _updateRadiusReadyCounts();
    }
  }
  // Start the entry warm immediately after the initial load so the overlay
  // holds until the entry viewport has shaded chunks available.
  startEntryWarm(entryWarmState, currentRoom, initialSpawnBlock[0], initialSpawnBlock[1], virtualWidthPx, virtualHeightPx, camera.zoom);

  // Preload sprites for adjacent rooms in the background.
  preloadAdjacentRoomAssets(currentRoom);

  // Show the loading overlay BEFORE the RAF loop begins so the browser paints
  // it before the first initial-resident-build frame fires.  This ensures the
  // "Loading…" screen is visible while radius-2 residents are built.
  // areRoomSpritesReady returns true instantly for rooms with no folder-based
  // themes (legacy sprites load at module init), so the overlay won't flash.
  showLoadingOverlay();

  const inputState = createInputState();
  const detachInput = attachInputListeners(canvas, inputState);

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
  const editorController: EditorController = createEditorController(canvas, uiRoot, (roomDef, spawnX, spawnY, preserveCamera) => {
    // When playing from the editor the room's playerSpawnBlock may be inside a
    // wall (e.g. in a newly-created room or after heavy edits).  Always resolve
    // to an open position so the player isn't stuck on entry.
    const [validX, validY] = resolveSpawnBlock(roomDef, spawnX, spawnY);
    // Bump the room version so any in-flight incremental build for this room
    // will be detected as stale and discarded (BUILD 418+ stale-build guard).
    _roomVersions.set(roomDef.id, (_roomVersions.get(roomDef.id) ?? 0) + 1);
    // Invalidate this room's cached runtime data so edits take effect immediately.
    roomRuntimeCache.invalidate(roomDef.id);
    // Also evict any pre-warmed render chunks so stale canvas data is not adopted.
    invalidateRoomChunkPrewarm(roomDef.id);
    // Invalidate the resident world for the edited room and queue a rebuild so
    // stale frozen state is never hot-swapped after an edit (BUILD 418).
    residentRoomManager.invalidateResidentWorld(roomDef.id);
    // Also invalidate radius-1 neighbours — their transition data may reference
    // this room's geometry, enemies, or walls.
    const editedNeighbours = bfsNearbyRooms(roomDef.id, ROOM_REGISTRY, 1);
    for (const [adjId] of editedNeighbours) {
      residentRoomManager.invalidateResidentWorld(adjId);
      _residentBuildQueueIds.delete(adjId); // allow re-enqueue at high priority
      // Also evict pre-warmed render chunks for neighbours whose geometry may
      // depend on the edited room (e.g. shared boundary walls).
      invalidateRoomChunkPrewarm(adjId);
    }
    // IDs must be deleted from the queue-id set BEFORE calling _enqueueResidentBuild
    // below, because _enqueueResidentBuild skips rooms whose ID is still present.
    _residentBuildQueueIds.delete(roomDef.id); // allow re-enqueue at high priority
    // Queue rebuilds for the edited room and its radius-1 neighbours.
    _enqueueResidentBuild({ roomId: roomDef.id, priority: 5, reason: 'rebuildAfterEdit' });
    for (const [adjId] of editedNeighbours) {
      _enqueueResidentBuild({ roomId: adjId, priority: 5, reason: 'rebuildAfterEdit' });
    }
    loadRoom(roomDef, validX, validY, preserveCamera);
    // After loadRoom(), the module-level `world` holds the newly loaded room.
    // Update the active resident record to point at this fresh world so that
    // subsequent hot-swaps see the correct state.  Without this, the resident
    // for the edited room would remain null/stale and the next hot-swap would
    // fall back to a cold load or hot-swap an outdated world.
    residentRoomManager.ensureResident(roomDef);
    residentRoomManager.setActiveResidentId(roomDef.id);
    residentRoomManager.setResidentWorld(roomDef.id, world, true);
    // Editor loads are not transitions — transition reveal state is removed (legacy).
  }, () => {
    // Called when editor closes (confirm or cancel)
    editorDebugControls?.handleEditorClosed();
  }, campaignSession ?? null);

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

  // ── Speedrun timer state ──────────────────────────────────────────────────
  // runTimerMs:                 accumulated active gameplay time this run.
  // checkpointRunTimerMs:       timer value at the last save point (used for
  //                             death/respawn restoration).
  // timerWaitingForMovement:    true after load/respawn until intentional player
  //                             input is detected; prevents the timer from
  //                             ticking during physics settling or room init.
  /** Clamp a raw timer value from save data: treats NaN/Infinity/negative as 0. */
  const _clampTimerMs = (ms: number | undefined): number => Math.max(0, isFinite(ms ?? 0) ? (ms ?? 0) : 0);
  let runTimerMs: number = _clampTimerMs(runOptions?.initialRunTimerMs);
  let checkpointRunTimerMs: number = _clampTimerMs(runOptions?.initialCheckpointRunTimerMs);
  let timerWaitingForMovement = true; // start in "waiting" state so the timer doesn't
  //                                    tick on first load before the player moves.

  // Set assist mode flag on the world so the grapple system can check it.
  world.isAssistModeFlag = (runOptions?.assistMode === true) ? 1 : 0;

  let lastTimestampMs = 0;
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
    onResetTransitionReveal: () => { /* no-op: transition reveal system removed */ },
    onResetFrameClock: () => { lastTimestampMs = 0; },
    onExitToMainMenu: () => {
      isRunning = false;
      detachInput();
      callbacks.onReturnToMenu();
    },
    onSave: callbacks.onSave,
    onCheckpointReached: () => {
      // Snapshot the current timer as the checkpoint value.
      checkpointRunTimerMs = runTimerMs;
      if (callbacks.onCheckpointReached) callbacks.onCheckpointReached(runTimerMs);
    },
    onRespawn: () => {
      // Restore the timer to the checkpoint value and wait for player movement.
      runTimerMs = checkpointRunTimerMs;
      timerWaitingForMovement = true;
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
      isRunning = false;
      detachInput();
      callbacks.onReturnToMenu();
    },
    onDebugModeChanged: (isDebugMode) => {
      if (isDebugMode) {
        editorDebugControls?.ensureEditorButton();
      } else {
        editorDebugControls?.removeEditorButton();
      }
    },
    onResizeCanvas: resizeCanvas,
  });

  function onResize(): void {
    resizeCanvas();
  }
  window.addEventListener('resize', onResize);

  function frame(timestampMs: number): void {
    if (!isRunning) return;

    const elapsedMs = lastTimestampMs === 0 ? FIXED_DT_MS : timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;

    // Reset per-frame freeze-profiler counters (works in both dev and production
    // because it also resets the production-safe sprite-bake budget counter).
    FP.beginFrame(elapsedMs);

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

    // ── Editor mode gate ──────────────────────────────────────────────────
    // When the editor is active, it takes over camera and input; skip gameplay.
    if (editorController.state.isActive) {
      // Use CSS display dimensions for mouse coordinate mapping (not buffer dimensions)
      const canvasRect = canvas.getBoundingClientRect();
      const isEditorConsuming = editorController.update(
        elapsedMs / 1000, camera, offsetXPx, offsetYPx, zoom,
        canvasRect.width, canvasRect.height, virtualWidthPx, virtualHeightPx,
      );

      if (isEditorConsuming) {
        // Still render the game world (walls, particles, etc.) as backdrop
        const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
        const eox = camOff.offsetXPx;
        const eoy = camOff.offsetYPx;
        updateSnapshotInPlace(
          reusableSnapshot,
          world,
          1.0,
          interpolationBuffers.prevClusterPosX,
          interpolationBuffers.prevClusterPosY,
        );
        renderEditorBackdrop(
          ctx,
          deviceCtx,
          virtualCanvas,
          canvas,
          webglRenderer,
          bloomSystem,
          world,
          reusableSnapshot,
          currentRoom,
          bgColor,
          eox,
          eoy,
          zoom,
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
    }

    // ── Initial resident build phase (BUILD 418+) ────────────────────────────
    // Pre-gameplay phase that builds radius-2 resident WorldStates one room per
    // RAF frame.  The loading overlay is already visible (shown before the RAF
    // loop started).  Gameplay, sim, input, and transitions remain blocked.
    //
    // Two "yield" frames are inserted first so the browser has time to paint
    // the overlay before any build work begins.
    if (_initialResidentBuildPhase.isActive) {
      if (_initialResidentBuildPhase.yieldFrames > 0) {
        _initialResidentBuildPhase.yieldFrames--;
        tickLoadingOverlay();
        if (import.meta.env.DEV) FP.setFrameGameContext('loading');
        FP.setBakeForbiddenInGameplay(false);
        FP.endFrame();
        rafHandle = requestAnimationFrame(frame);
        return;
      }
      // First real build frame — record start time.
      if (_initialResidentBuildPhase.t0 === 0) {
        _initialResidentBuildPhase.t0 = performance.now();
      }
      // Advance through rooms until we find one that needs a build (skip
      // already-ready rooms in O(1) per frame without any build cost).
      let builtOne = false;
      while (!builtOne && _initialResidentBuildPhase.idx < _initialResidentBuildPhase.rooms.length) {
        const [adjId] = _initialResidentBuildPhase.rooms[_initialResidentBuildPhase.idx];
        _initialResidentBuildPhase.idx++;
        const adjResident = residentRoomManager.getResident(adjId);
        if (adjResident !== undefined && adjResident.runtimeReady) {
          // Already built (start room or duplicate) — count and skip.
          _initialResidentBuildPhase.built++;
          continue;
        }
        const adjRoom = ROOM_REGISTRY.get(adjId);
        if (adjRoom === undefined) continue;
        try {
          const _bT0 = performance.now();
          const _builtWorld = buildResidentWorldState(adjRoom, RESIDENT_CAMPAIGN_SEED, roomRuntimeCache);
          const _buildMs = performance.now() - _bT0;
          residentRoomManager.ensureResident(adjRoom);
          residentRoomManager.setResidentWorld(adjId, _builtWorld, false);
          residentRoomManager.setLastBuildInfo(adjId, _buildMs);
          _initialResidentBuildPhase.built++;
          if (import.meta.env.DEV) {
            console.log(
              `[startup] initial resident ${_initialResidentBuildPhase.built}/${_initialResidentBuildPhase.total}:` +
              ` ${adjId} in ${_buildMs.toFixed(1)}ms`,
            );
          }
        } catch (_buildErr) {
          _initialResidentBuildPhase.failed++;
          if (import.meta.env.DEV) {
            console.warn(`[startup] initial resident FAILED: ${adjId}`, _buildErr);
          }
        }
        builtOne = true; // one full room per frame
      }
      const _initDone = _initialResidentBuildPhase.idx >= _initialResidentBuildPhase.rooms.length;
      const _initElapsed = performance.now() - _initialResidentBuildPhase.t0;
      residentRoomManager.setInitialRadius2Progress(
        _initialResidentBuildPhase.total,
        _initialResidentBuildPhase.built,
        _initialResidentBuildPhase.failed,
        _initElapsed,
        _initDone,
      );
      if (_initDone) {
        _initialResidentBuildPhase.isActive = false;
        if (import.meta.env.DEV) {
          console.log(
            `[startup] initial radius-2 residents done: ${_initialResidentBuildPhase.built}/${_initialResidentBuildPhase.total} built` +
            (_initialResidentBuildPhase.failed > 0 ? `, ${_initialResidentBuildPhase.failed} failed` : '') +
            ` in ${_initElapsed.toFixed(0)}ms`,
          );
        }
        _refreshResidentBuildQueue();
        _updateRadiusReadyCounts();
      }
      // Update diagnostics every initial-build frame so the overlay text stays current.
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
    // the generator is advanced one phase per RAF frame while the loading overlay
    // is displayed.  Gameplay is frozen until loading completes.
    if (asyncLoadState.isActive) {
      const _asyncPhaseT0 = import.meta.env.DEV ? performance.now() : 0;
      const _asyncResult = asyncLoadState.gen!.next();
      if (import.meta.env.DEV && _asyncPhaseT0 > 0) {
        const _asyncPhaseMs = performance.now() - _asyncPhaseT0;
        if (_asyncPhaseMs > 16) {
          console.warn(`[perf] async load phase took ${_asyncPhaseMs.toFixed(1)}ms`);
        }
      }
      if (_asyncResult.done) {
        asyncLoadState.isActive = false;
        asyncLoadState.gen = null;
        // Apply the deferred player velocity now that the new cluster exists.
        const _playerAfterLoad = world.clusters[0];
        if (_playerAfterLoad !== undefined && _playerAfterLoad.isPlayerFlag === 1) {
          _playerAfterLoad.velocityXWorld = asyncLoadState.preTransVX;
          _playerAfterLoad.velocityYWorld =
            asyncLoadState.transitionDir === 'up'
              ? asyncLoadState.preTransVY - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION
              : asyncLoadState.preTransVY;
        }
        // Register the newly loaded room as an active resident and store the world.
        residentRoomManager.ensureResident(currentRoom);
        residentRoomManager.setActiveResidentId(currentRoom.id);
        residentRoomManager.setResidentWorld(currentRoom.id, world, true);
        residentRoomManager.evictDistant(currentRoom.id);
        // Pre-register adjacent rooms (radius ≤ 2).
        for (const [adjId] of bfsNearbyRooms(currentRoom.id, ROOM_REGISTRY, 2)) {
          const adjRoom = ROOM_REGISTRY.get(adjId);
          if (adjRoom !== undefined) residentRoomManager.ensureResident(adjRoom);
        }
        // Start the entry warm now that all load phases are complete.
        // The warm advances in subsequent gameplay frames (before bake is
        // forbidden) and holds the overlay until coverage is confirmed or
        // the timeout fires.
        entryWarmState = createEntryWarmState();
        startEntryWarm(
          entryWarmState, currentRoom,
          asyncLoadState.spawnXBlock, asyncLoadState.spawnYBlock,
          virtualWidthPx, virtualHeightPx, camera.zoom,
        );
        if (import.meta.env.DEV) {
          console.log('[transition] async load complete — velocity applied, resuming gameplay');
        }
        // Refresh build queue so newly adjacent rooms are queued after async transition.
        _refreshResidentBuildQueue();
        _updateRadiusReadyCounts();
      }
      // Keep the overlay visible and skip gameplay sim/render this frame.
      tickLoadingOverlay();
      if (import.meta.env.DEV) FP.setFrameGameContext('loading');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Entry viewport warm phase ─────────────────────────────────────────────
    // When a new room's entry viewport is being warmed (shaded chunks being
    // built), advance the warm in a loading-style frame — before command
    // processing, before sim ticks, and without marking the frame as gameplay.
    // The loading overlay covers the player while the warm is active so no
    // simulation, movement, or player input is processed.
    if (entryWarmState.phase === 'warming') {
      if (import.meta.env.DEV) FP.setFrameGameContext('entryWarm');
      FP.setBakeForbiddenInGameplay(false);
      tickEntryWarm(entryWarmState, currentRoom, roomRuntimeCache);
      tickLoadingOverlay();
      FP.endFrame();
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
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Dialogue advance input (capture before collectCommands drains the flag)
    const dialogueAdvanceRequested = inputState.isDialogueAdvanceTriggeredFlag;

    const { moveDx, jumpTriggered, openPause, interactTriggered, interactInputPulseTrigger, grappleFireTriggered } =
      processPlayerCommands({
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
      });

    let pendingGrappleFireSfx = grappleFireTriggered;

    // ── Dialogue advance ───────────────────────────────────────────────────
    // When dialogue is active, advance (or close) the overlay and suppress
    // normal gameplay logic for this frame (player movement is blocked below).
    handleDialogueAdvance(dialogueAdvanceRequested, dialogueState, dialogueRenderer);

    if (interactInputPulseTrigger) {
      interactInputPulseMs = 150;
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
      if (import.meta.env.DEV) FP.setFrameGameContext('paused');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // While dead, still render the frozen scene but skip sim
    if (gameOverlayController.state.isPlayerDead) {
      if (import.meta.env.DEV) FP.setFrameGameContext('paused');
      FP.setBakeForbiddenInGameplay(false);
      FP.endFrame();
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // ── Speedrun timer tick ─────────────────────────────────────────────────
    // The timer is paused: in menus (handled by early returns above), while
    // loading (asyncLoadState check above returns early), and while waiting
    // for the player to move after a load or respawn.
    //
    // Movement detection: only intentional horizontal directional input or
    // jump input counts.  Passive physics (gravity settling, camera, particles,
    // room init) do NOT count.  This matches the spirit of "the player has
    // not moved yet" for the waiting state.
    {
      const _player = world.clusters[0];
      const _playerAlive = _player !== undefined && _player.isAliveFlag === 1;
      if (timerWaitingForMovement) {
        // Arm the timer once the player provides any deliberate input
        // (horizontal movement or jump). Passive physics such as gravity
        // settling, camera motion, and room init do not qualify.
        const hasIntentionalInput = (moveDx !== 0) || jumpTriggered || inputState.isJumpHeldFlag;
        if (hasIntentionalInput && _playerAlive) {
          timerWaitingForMovement = false;
        }
      }
      if (!timerWaitingForMovement && _playerAlive) {
        runTimerMs = Math.max(0, runTimerMs + elapsedMs);
      }
    }

    // ── Room transition check ──────────────────────────────────────────────
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
      startTransitionLoad,
      resolveSpawnBlock,
      camera,
      currentRoomOriginXWorld,
      currentRoomOriginYWorld,
      preloadAdjacentCurrentRoomAssets,
      transitionDebugState,
    );

    // ── Proximity-based priority preload ───────────────────────────────────
    // When the player is within URGENT_PRELOAD_PROXIMITY_BLOCKS of a room
    // boundary, boost the preload priority for that transition target.
    //
    // - Runtime-cache boost (`prioritize`): only needed while the runtime entry
    //   is still being computed.
    // - Chunk-prewarm boost (`ensureChunkPrewarmQueued`): ensures a prewarm task
    //   exists and is at the front of the queue.  Unlike the old prioritize-only
    //   call, this also creates a new task if the room was already completed,
    //   evicted, or never scheduled — preventing a silent no-op near the boundary.
    //
    // We never block the gameplay frame here — if the player crosses before
    // preparation finishes the async overlay path will handle it.
    {
      const _proxPlayer = world.clusters[0];
      if (_proxPlayer !== undefined && _proxPlayer.isAliveFlag === 1) {
        const _px = _proxPlayer.positionXWorld - currentRoomOriginXWorld;
        const _py = _proxPlayer.positionYWorld - currentRoomOriginYWorld;
        for (let _ti = 0; _ti < currentRoom.transitions.length; _ti++) {
          const _t = currentRoom.transitions[_ti];
          const _tId = _t.targetRoomId;

          let _isNear = false;
          switch (_t.direction) {
            case 'right': _isNear = _px >= (currentRoom.widthBlocks - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
            case 'left':  _isNear = _px <= URGENT_PRELOAD_PROXIMITY_BLOCKS * BLOCK_SIZE_MEDIUM; break;
            case 'down':  _isNear = _py >= (currentRoom.heightBlocks - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
            case 'up':    _isNear = _py <= URGENT_PRELOAD_PROXIMITY_BLOCKS * BLOCK_SIZE_MEDIUM; break;
          }
          if (_isNear) {
            const _tEntry = roomRuntimeCache.get(_tId);
            // Boost runtime-cache build if not yet fully prepared.
            if (_tEntry === undefined || !isEntryFullyPrepared(_tEntry)) {
              _preloadScheduleHandle?.prioritize(_tId);
              // Also aggressively decode sprites for this exact target room so
              // they are GPU-rasterized before the player crosses. Fire-and-forget.
              const _tRoom = ROOM_REGISTRY.get(_tId);
              if (_tRoom !== undefined) void decodeRoomThemeSprites(_tRoom);
              if (_tRoom !== undefined) decodeRoomBackground(_tRoom);
            }
            // Always boost chunk prewarm when near — this ensures that rooms
            // whose prewarm task completed, was never queued, or was evicted
            // get a new task created rather than silently skipped.
            ensureChunkPrewarmQueued(_tId, 'proximity');
            // Boost resident build to priority 1 (hot-swap transition target)
            // so it is built as soon as possible in the incremental scheduler.
            {
              const _tResident = residentRoomManager.getResident(_tId);
              if (_tResident === undefined || !_tResident.runtimeReady) {
                _enqueueResidentBuild({ roomId: _tId, priority: 1, reason: 'proximity' });
              }
            }
            break; // one priority boost per frame is sufficient
          }
        }

        // ── Velocity-direction resident pre-build (priority 2) ──────────────
        // If the player is moving fast enough in a direction that matches a
        // room transition, enqueue the target at priority 2 so the incremental
        // scheduler works on it before radius-1/2 background entries.
        {
          const _pvx = _proxPlayer.velocityXWorld;
          const _pvy = _proxPlayer.velocityYWorld;
          const _absVx = Math.abs(_pvx);
          const _absVy = Math.abs(_pvy);
          const MIN_VEL_DIRECTION_WORLD = 1.0; // world units/tick
          if (_absVx > MIN_VEL_DIRECTION_WORLD || _absVy > MIN_VEL_DIRECTION_WORLD) {
            const _velDir = _absVx >= _absVy
              ? (_pvx > 0 ? 'right' : 'left')
              : (_pvy > 0 ? 'down'  : 'up');
            for (const _vt of currentRoom.transitions) {
              if (_vt.direction === _velDir) {
                const _vtResident = residentRoomManager.getResident(_vt.targetRoomId);
                if (_vtResident === undefined || !_vtResident.runtimeReady) {
                  _enqueueResidentBuild({ roomId: _vt.targetRoomId, priority: 2, reason: 'proximity' });
                }
                break;
              }
            }
          }
        }
      }
    }

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
    }

    // During active dialogue, freeze player movement (suppress moveDx/jump inputs).
    const isDialogueBlockingInput = dialogueState.isDialogueActiveFlag;

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
    world.playerJumpHeldFlag = !isDialogueBlockingInput && inputState.isJumpHeldFlag ? 1 : 0;


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
        world.playerMoveInputDyWorld = (!isDialogueBlockingInput && inputState.isKeyS) ? 1.0 : 0.0;
      }
      // Pass sprint and crouch input to the sim
      world.playerSprintHeldFlag = (!isDialogueBlockingInput && inputState.isSprintHeldFlag) ? 1 : 0;
      world.playerCrouchHeldFlag = (!isDialogueBlockingInput && inputState.isKeyS) ? 1 : 0;
      tick(world);
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
      updatePlayerSfx(playerSfx, playerSfxState, world, pendingGrappleFireSfx, FIXED_DT_MS / 1000);
      pendingGrappleFireSfx = false;

      // ── Crumble block debris events & ambient lighting rebuild ────────────
      tickCrumbleDebrisEvents(world, crumbleDebris, prevCrumbleActive, prevCrumbleHits, FIXED_DT_MS);
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
      gameOverlayController.showPlayerDeathScreen();
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
        currentRoomOriginXWorld, currentRoomOriginYWorld);
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
    );

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
    renderFrame({
      ctx, deviceCtx, virtualCanvas, canvas,
      webglRenderer, environmentalDust, skidDebris, crumbleDebris, weakWallJumpDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
      playerCloak, phantomCloak, darkRoomOverlay, decorationWaveState, arrowWeaveRenderer, swordWeaveRenderer,
      sunbeamRenderer, atmosphericLightDust, guideDustPathRenderer, fallingBlockDust,
      world, currentRoom,
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
      getPlayerDustCount,
      playerContainerCount: progress?.dustContainerCount ?? 0,
      runTimerMs,
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
    });
    FP.recordRenderMs(import.meta.env.DEV ? performance.now() - _renderT0 : 0);

    // Tick the loading overlay — hides it once sprites are ready.
    tickLoadingOverlay();

    // ── Resident build queue scheduler (BUILD 418+) ──────────────────────────
    // Incremental multi-phase build scheduler.  One generator phase per frame so
    // no single frame bears the full cost of a synchronous build (~15–25 ms).
    //
    // Session lifecycle:
    //   1. If a session is active, advance one phase per frame unconditionally.
    //      Each phase is bounded (< ~10 ms) so the per-phase cost is tolerable.
    //   2. When the session generator is exhausted, check the room version to
    //      detect stale builds (room was edited after session started) and
    //      discard if stale.
    //   3. If no session is active and the queue is non-empty, start a new
    //      session only when the previous frame was fast (< 10 ms).
    {
      // Sort the queue only when dirty.  Lower number = more urgent.
      if (_residentBuildQueueDirty) {
        _residentBuildQueue.sort((a, b) => a.priority - b.priority);
        _residentBuildQueueDirty = false;
      }

      // Step 1: advance active session one phase.
      if (_activeBuildSession !== null) {
        const _sess = _activeBuildSession;
        try {
          const _phaseResult = _sess.gen.next();
          if (_phaseResult.done) {
            // Generator returned the completed WorldState.
            const _buildMs = performance.now() - _sess.t0;
            const _currentVer = _roomVersions.get(_sess.task.roomId) ?? 0;
            if (_sess.capturedVersion === _currentVer) {
              residentRoomManager.ensureResident(_sess.task.room);
              residentRoomManager.setResidentWorld(_sess.task.roomId, _phaseResult.value, false);
              residentRoomManager.setLastBuildInfo(_sess.task.roomId, _buildMs);
              if (import.meta.env.DEV) {
                console.log(
                  `[resident] incremental build done: ${_sess.task.roomId}` +
                  ` (reason=${_sess.task.reason} pri=${_sess.task.priority}) in ${_buildMs.toFixed(1)}ms`,
                );
              }
              _updateRadiusReadyCounts();
            } else {
              if (import.meta.env.DEV) {
                console.warn(
                  `[resident] incremental build DISCARDED (stale): ${_sess.task.roomId}` +
                  ` ver=${_sess.capturedVersion} but current=${_currentVer}`,
                );
              }
            }
            _activeBuildSession = null;
            residentRoomManager.setCurrentBuildInfo(null, null);
          } else {
            _sess.currentPhase = _phaseResult.value;
          }
        } catch (_sessErr) {
          if (import.meta.env.DEV) {
            console.warn(`[resident] incremental build FAILED: ${_activeBuildSession.task.roomId}`, _sessErr);
          }
          _activeBuildSession = null;
          residentRoomManager.setCurrentBuildInfo(null, null);
        }
      }

      // Step 2: start a new session if idle, queue is non-empty, and frame budget allows.
      if (_activeBuildSession === null && _residentBuildQueue.length > 0
          && renderProfiler.getLastFrameMs() < 10) {
        // Purge already-built or active-room entries from the front of the queue.
        let _dequeued: ResidentBuildTask | null = null;
        while (_residentBuildQueue.length > 0) {
          const _candidate = _residentBuildQueue[0];
          if (_candidate.roomId === currentRoom.id) {
            _residentBuildQueue.shift();
            _residentBuildQueueIds.delete(_candidate.roomId);
            continue;
          }
          const _existing = residentRoomManager.getResident(_candidate.roomId);
          if (_existing !== undefined && _existing.runtimeReady) {
            _residentBuildQueue.shift();
            _residentBuildQueueIds.delete(_candidate.roomId);
            continue;
          }
          _dequeued = _residentBuildQueue.shift()!;
          _residentBuildQueueIds.delete(_dequeued.roomId);
          break;
        }
        if (_dequeued !== null) {
          _activeBuildSession = {
            task:            _dequeued,
            gen:             createResidentBuildGenerator(_dequeued.room, RESIDENT_CAMPAIGN_SEED, roomRuntimeCache),
            t0:              performance.now(),
            capturedVersion: _roomVersions.get(_dequeued.roomId) ?? 0,
            currentPhase:    'starting',
          };
          residentRoomManager.setCurrentBuildInfo(_dequeued.roomId, _dequeued.reason);
        }
      }

      // Step 3: update diagnostics each frame.
      const _qByPri: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      for (const _qt of _residentBuildQueue) {
        const _pi = (_qt.priority - 1) as 0 | 1 | 2 | 3 | 4;
        _qByPri[_pi]++;
      }
      residentRoomManager.setResidentBuildQueueLength(_residentBuildQueue.length, _qByPri);
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
    pauseController.destroy();
    gameOverlayController.destroy();
    // Stop background music and release resources
    musicManager.dispose();
    editorController.destroy();
    editorDebugControls?.destroy();
    detachInput();
    webglRenderer.dispose();
    dialogueRenderer.destroy();
    window.removeEventListener('resize', onResize);
    loadingOverlay.destroy();
    if (menuButton !== null && menuButton.parentElement !== null) {
      menuButton.parentElement.removeChild(menuButton);
    }
  };
}
