import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles } from '../sim/clusters/grapple';
import { ParticleKind } from '../sim/particles/kinds';
import { tick } from '../sim/tick';
import { createRng } from '../sim/rng';
import { createReusableSnapshot, updateSnapshotInPlace, resetReusableSnapshot } from '../render/snapshot';
import { PlayerCloak } from '../render/clusters/playerCloak';
import { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { HudState } from '../render/hud/overlay';
import { EnvironmentalDustLayer } from '../render/environmentalDust';
import { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
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
import { createCameraState, snapCamera, getCameraOffset } from '../render/camera';
// BUILD 297: ENABLE_TWO_ROOM_CAMERA_CROSSING is false, so isCrossingComplete /
// getCrossingUnionBounds are only reachable via the preserved dead-code guard
// block that allows easy re-enablement of the crossing system in the future.
import {
  createTwoRoomCrossingState,
  isCrossingComplete,
  getCrossingUnionBounds,
  type TwoRoomCrossingState,
} from './twoRoomCrossing';
import {
  type SeamlessStagingState,
  createSeamlessStagingState,
  resetSeamlessStagingState,
  // finalizeCrossingSeamless is only reached when ENABLE_TWO_ROOM_CAMERA_CROSSING
  // is true.  Preserved so the crossing system can be re-enabled without
  // additional import surgery.
  finalizeCrossingSeamless,
  computeStagingUnionBounds,
} from './gameSeamlessStaging';
import {
  ENABLE_TWO_ROOM_CAMERA_CROSSING,
  ENABLE_TRANSITION_CAMERA_REVEAL,
} from '../render/transitions/transitionConfig';
import { setActiveBlockSpriteWorld, setActiveBlockSpriteTheme, setActiveBlockLighting, setActiveDarkAmbientBlockers } from '../render/walls/blockSpriteRenderer';
import { SkillTombRenderer } from '../render/skillTombRenderer';
import { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import { PlayerProgress } from '../progression/playerProgress';
import { createEditorController, EditorController } from '../editor/editorController';
import { PlayerWeaveLoadout, createDefaultWeaveLoadout } from '../sim/weaves/playerLoadout';
import { WEAVE_STORM } from '../sim/weaves/weaveDefinition';
import { resetRadiantTetherState } from '../sim/clusters/radiantTetherAi';
import { resetRadiantWebState } from '../sim/clusters/radiantWebAi';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import { getMusicVolume, getSelectedRenderSize } from '../ui/renderSettings';
import { createMusicManager, MusicManager } from '../audio/musicManager';
import { PlayerSfxManager } from '../audio/playerSfx';
import { BloomSystem } from '../render/effects/bloomSystem';
import { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import { DEFAULT_BLOOM_CONFIG } from '../render/effects/bloomConfig';
import { RenderProfiler } from '../render/hud/renderProfiler';
import { getTotalCapacity, getMaxParticlesForDust } from '../progression/dustCapacity';
import {
  spawnClusterParticles,
  spawnWeaveLoadoutParticles,
  spawnBackgroundFluidParticles,
  spawnEnemyClusters,
  spawnAllDustPiles,
  PARTICLE_COUNT_PER_CLUSTER,
  BACKGROUND_FLUID_COUNT,
  PLAYER_INITIAL_HEALTH,
} from './gameSpawn';
import {
  loadRoomHazards,
  loadRoomRopes,
  loadRoomFallingBlocks,
  loadRoomGrasshoppers,
  worldBgColor,
  resolveSpawnBlock,
} from './gameRoom';
import { renderFrame } from './gameRender';
import { createCombatTextSystem } from '../render/hud/combatText';
import { processLargeSlimeSplits } from '../sim/clusters/slimeAi';
import { DecorationWaveState, buildRoomDecorations } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { MAX_CRUMBLE_BLOCKS } from '../sim/world';
import { processPlayerCommands } from './gameCommandProcessor';
import { createPlayerSfxState, updatePlayerSfx } from './gamePlayerSfx';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import { resetSwordWeaveState } from '../sim/weaves/swordWeave';
import { processRoomPickups } from './gamePickups';
import { createDialogueState } from '../dialogue/dialogueState';
import { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';
import { handleDialogueAdvance, checkDialogueTriggers, prepareRoomDialogueVisitState } from './gameDialogueHandler';
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
  preloadRoomThemeSprites,
  preloadAdjacentRoomAssets,
  areRoomSpritesReady,
} from '../render/roomAssetPreloader';
import { buildEdgeExtensionCache, EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { buildRoomWallTemplate, applyRoomWallTemplate } from './gameRoomWalls';
import { RoomRuntimeCache, isEntryFullyPrepared } from './roomRuntimeCache';
import { scheduleRoomPreloads, type PreloadScheduleHandle } from './roomPreloadScheduler';
import { computePreviewBubbles, PreviewBubbleState } from '../render/transitions/previewBubbleState';
import {
  createTransitionRevealState,
  notifyFreshRoomLoaded,
  updateTransitionReveal,
  getTransitionRevealOffset,
} from '../render/transitions/transitionCameraReveal';
import {
  createTransitionPreviewContext,
  updateTransitionPreviewContext,
  TransitionPreviewContext,
} from '../render/transitions/transitionPreviewContext';
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
  cancelCameraTransition,
  resetCameraEffBoundsForRoom,
  updateCameraFollow,
  CAM_TRANS_DURATION_SEC,
} from './gameCameraState';
import { createGameOverlayController } from './gameOverlayController';
import { createGameEditorDebugControls } from './gameEditorDebugControls';
import { createGamePauseController } from './gamePauseController';
import { createGameLambdaAnchorState } from './gameLambdaAnchorState';
import { renderEditorBackdrop } from './gameScreenEditorBackdrop';
import { orchestrateRoomTransitions, type TransitionDebugState } from './gameRoomTransitionOrchestrator';
import type { TransitionDirection } from './gameTransitions';
import { PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';
import { loadRoomForGameplayAsync, isRoomFileCacheActive } from '../levels/roomFileLoader';

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
  const virtualHeightPx = FIXED_VIRTUAL_HEIGHT_PX;
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

  /** BUILD 279: Two-room smooth camera crossing state. */
  const crossingState: TwoRoomCrossingState = createTwoRoomCrossingState();

  /**
   * BUILD 284: Seamless room staging state.
   * BUILD 286: Logic extracted to gameSeamlessStaging.ts.
   *
   * After a seamless crossing finalises, the previous room's walls are kept in
   * `world.walls[]` as a "staged" adjacent room.  `stagingState.currentRoomOriginXWorld/Y`
   * tracks where the active room starts in world-space (non-zero after a
   * right/down crossing because we shift the world to keep coordinates
   * positive).  These are reset to zero by any full `loadRoom` call.
   */
  const stagingState: SeamlessStagingState = createSeamlessStagingState();
  const dustContainerSprite = new Image();
  dustContainerSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainer.png`;
  let isDustContainerSpriteLoaded = false;
  dustContainerSprite.onload = () => { isDustContainerSpriteLoaded = true; };
  const dustContainerShardSprite = new Image();
  dustContainerShardSprite.src = `${BASE}SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainerShard.png`;
  let isDustContainerShardSpriteLoaded = false;
  dustContainerShardSprite.onload = () => { isDustContainerShardSpriteLoaded = true; };
  /** Keys in the format `${roomId}:${containerIndex}` for already-collected dust containers. */
  const collectedDustContainerKeySet: Set<string> = new Set();
  /** Keys in the format `${roomId}:dustswarm:${index}` for already-collected dust swarms.
   * Initialized from progress.collectedDustSwarmKeys so swarms stay collected after save/load. */
  const collectedDustSwarmKeySet: Set<string> = progress?.collectedDustSwarmKeys
    ? new Set(progress.collectedDustSwarmKeys)
    : new Set();

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

    // ── Phase A: room metadata + world reset ──────────────────────────────
    currentRoom = room;
    bgColor = worldBgColor(room.worldNumber);
    roomWidthWorld = room.widthBlocks * BLOCK_SIZE_MEDIUM;
    roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

    // BUILD 279: Always clear any in-progress two-room crossing on room load.
    // This handles death recovery, save-load, and any other loadRoom call.
    crossingState.phase       = 'inactive';
    crossingState.nextRoom    = null;
    crossingState.currentRoom = null;

    // BUILD 284: Reset seamless-staging state on any full room load.
    resetSeamlessStagingState(stagingState);

    // BUILD 297: Cancel any in-progress camera transition so non-transition
    // room loads (death respawn, editor reload, lambda teleport) do not
    // inherit the interpolation.  The transition callback sets it true AFTER
    // loadRoom returns, so clearing it here is always safe.
    cancelCameraTransition(camState);

    // Apply world-specific block sprites and background
    if (room.blockTheme) {
      setActiveBlockSpriteTheme(room.blockTheme);
    } else {
      setActiveBlockSpriteWorld(room.worldNumber);
    }

    // Use cached blocker keys if the entry has already been prepared (avoids
    // re-allocating Sets on every room visit after the first preload).
    const _phaseAEntry = roomRuntimeCache.get(room.id);
    let blockerKeys: Set<string> | undefined;
    let darkBlockerKeys: Set<string> | undefined;
    if (_phaseAEntry !== undefined && _phaseAEntry.blockerKeys !== null) {
      // null = not computed; undefined = no blockers (valid); Set = populated.
      blockerKeys     = _phaseAEntry.blockerKeys;
      darkBlockerKeys = _phaseAEntry.darkBlockerKeys ?? undefined;
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} blockerKeys: cache HIT`);
      }
    } else {
      // Build from scratch and store back into the cache entry if one exists.
      const _blockerT0 = import.meta.env.DEV ? performance.now() : 0;
      if (room.ambientLightBlockers && room.ambientLightBlockers.length > 0) {
        blockerKeys = new Set<string>();
        for (const b of room.ambientLightBlockers) {
          const key = `${b.xBlock},${b.yBlock}`;
          blockerKeys.add(key);
          if (b.isDark) {
            if (!darkBlockerKeys) darkBlockerKeys = new Set<string>();
            darkBlockerKeys.add(key);
          }
        }
      }
      // Add light-blocking background blocks to the ambient blocker set.
      if (room.backgroundBlocks) {
        for (const b of room.backgroundBlocks) {
          if (b.isLightBlockingFlag !== 1) continue;
          if (!blockerKeys) blockerKeys = new Set<string>();
          for (let dy = 0; dy < b.hBlock; dy++) {
            for (let dx = 0; dx < b.wBlock; dx++) {
              blockerKeys.add(`${b.xBlock + dx},${b.yBlock + dy}`);
            }
          }
        }
      }
      if (_phaseAEntry !== undefined) {
        // Store `undefined` (not `null`) so `isEntryFullyPrepared` can see these
        // fields are computed.  `null` is the "not yet computed" sentinel.
        _phaseAEntry.blockerKeys     = blockerKeys;
        _phaseAEntry.darkBlockerKeys = darkBlockerKeys;
      }
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} blockerKeys: cache MISS (build ${(performance.now() - _blockerT0).toFixed(1)}ms)`);
      }
    }
    setActiveBlockLighting(
      room.lightingEffect ?? 'Ambient',
      room.widthBlocks,
      room.heightBlocks,
      room.ambientLightDirection,
      blockerKeys,
    );
    setActiveDarkAmbientBlockers(darkBlockerKeys);
    musicManager.notifyRoomEntered(room.songId ?? '_continue');

    let carryHealthPoints = PLAYER_INITIAL_HEALTH;
    if (
      world.clusters.length > 0 &&
      world.clusters[0].isPlayerFlag === 1 &&
      world.clusters[0].isAliveFlag === 1 &&
      world.clusters[0].healthPoints > 0
    ) {
      carryHealthPoints = world.clusters[0].healthPoints;
    } else if (world.clusters.length === 0 && progress?.startingHealth !== undefined) {
      // First room load of a new campaign session — use campaign spawn's starting health.
      carryHealthPoints = Math.max(1, Math.min(progress.startingHealth, PLAYER_INITIAL_HEALTH));
    }

    world.tick = 0;
    world.particleCount = 0;
    world.clusters.length = 0;
    world.wallCount = 0;
    world.worldWidthWorld = roomWidthWorld;
    world.worldHeightWorld = roomHeightWorld;

    world.isGrappleActiveFlag     = 0;
    world.isGrappleMissActiveFlag = 0;
    world.isGrappleRetractingFlag = 0;
    world.isGrappleZipActiveFlag  = 0;
    world.isGrappleStuckFlag      = 0;
    world.hasGrappleChargeFlag    = 1;
    world.grappleParticleStartIndex = -1;

    resetRadiantTetherState();
    resetRadiantWebState();

    yield; // ── Phase A complete ─────────────────────────────────────────────

    // ── Phase B: spawn player + particles + mote queue ───────────────────
    const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
    const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
    const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, PLAYER_INITIAL_HEALTH);
    playerCluster.healthPoints = Math.min(carryHealthPoints, playerCluster.maxHealthPoints);
    world.clusters.push(playerCluster);

    const playerCapacity = progress ? getTotalCapacity(progress.dustContainerCount) : 0;
    const hasWeaveBoundDust = playerWeaveLoadout.primary.boundDust.length > 0
      || playerWeaveLoadout.secondary.boundDust.length > 0;

    if (hasWeaveBoundDust) {
      spawnWeaveLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, playerWeaveLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);
    } else if (progress && progress.unlockedDustKinds.length > 0 && playerCapacity > 0) {
      const dustKind = progress.unlockedDustKinds[0];
      const particleCount = getMaxParticlesForDust(dustKind, playerCapacity);
      if (particleCount > 0) {
        spawnClusterParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, dustKind, particleCount, levelRng);
      }
    }

    world.playerPrimaryWeaveId = playerWeaveLoadout.primary.weaveId;
    world.playerSecondaryWeaveId = playerWeaveLoadout.secondary.weaveId;
    world.isMoteSourceOrbitFlag = world.playerPrimaryWeaveId === WEAVE_STORM ? 1 : 0;

    initMoteQueueFromParticles(world, playerCluster.entityId);
    resetSwordWeaveState(world);

    yield; // ── Phase B complete ─────────────────────────────────────────────

    // ── Phase C: spawn enemies (5–15 ms on complex rooms) ────────────────
    spawnEnemyClusters(world, room.enemies, 2, levelRng);

    yield; // ── Phase C complete ─────────────────────────────────────────────

    // ── Phase D: background particles + grapple chains + walls ───────────
    spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);

    initGrappleChainParticles(world, 1);

    for (let ci = 0; ci < world.clusters.length; ci++) {
      const cl = world.clusters[ci];
      if (cl.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(world, cl);
      }
    }

    // Use cached wall template if available (avoids O(n²) merge pass).
    const _wallCacheEntry = roomRuntimeCache.get(room.id);
    const _wallT0 = import.meta.env.DEV ? performance.now() : 0;
    if (_wallCacheEntry !== undefined) {
      applyRoomWallTemplate(world, _wallCacheEntry.wallTemplate);
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} walls: cache HIT (apply ${(performance.now() - _wallT0).toFixed(1)}ms)`);
      }
    } else {
      const wallTemplate = buildRoomWallTemplate(room);
      const _buildMs = import.meta.env.DEV ? performance.now() - _wallT0 : 0;
      applyRoomWallTemplate(world, wallTemplate);
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} walls: cache MISS (build ${_buildMs.toFixed(1)}ms)`);
      }
      // Store in cache so subsequent visits to this room are fast.
      // Remaining fields (edgeExtension, wallDecorations) are filled in Phase F.
      // blockerKeys and darkBlockerKeys were computed in Phase A of this same generator
      // run and are in scope; storing them here avoids a second rebuild on next visit.
      roomRuntimeCache.set(room.id, {
        wallTemplate,
        edgeExtension: null,
        blockerKeys,
        darkBlockerKeys,
        wallDecorations: null,
      });
    }

    yield; // ── Phase D complete ─────────────────────────────────────────────

    // ── Phase E: hazards + ropes + blocks + grasshoppers + dialogue ──────
    loadRoomHazards(world, room);
    loadRoomRopes(world, room);
    loadRoomFallingBlocks(world, room);
    loadRoomGrasshoppers(world, room);

    const dialogueVisitState = prepareRoomDialogueVisitState(room, dialogueState, dialogueRenderer);
    firedDialogueTriggerUids = dialogueVisitState.firedDialogueTriggerUids;
    cachedRoomConversations = dialogueVisitState.cachedRoomConversations;

    spawnAllDustPiles(world);

    yield; // ── Phase E complete ─────────────────────────────────────────────

    // ── Phase F: environment effects + rendering state + camera setup ─────
    environmentalDust.initFromWorld(world, room.worldNumber);
    sunbeamRenderer.initFromRoom(room);
    atmosphericLightDust.initFromRoom(room);

    playerCloak.reset();
    phantomCloak.reset();

    decorationWaveState.reset(room.decorations?.length ?? 0);

    // Use cached wall decorations if available (pure geometry, no mutable state).
    const _decorEntry = roomRuntimeCache.get(room.id);
    if (_decorEntry !== undefined && _decorEntry.wallDecorations !== null) {
      cachedWallDecorations = _decorEntry.wallDecorations;
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} decorations: cache HIT`);
      }
    } else {
      const _decorT0 = import.meta.env.DEV ? performance.now() : 0;
      cachedWallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
      if (_decorEntry !== undefined) {
        _decorEntry.wallDecorations = cachedWallDecorations;
      }
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} decorations: cache MISS (build ${(performance.now() - _decorT0).toFixed(1)}ms)`);
      }
    }
    for (let _di = 0; _di < cachedWallDecorations.length; _di++) {
      const _d = cachedWallDecorations[_di];
      cachedDecorationCenterX[_di] = _d.worldLeftPx + BLOCK_SIZE_SMALL / 2;
      cachedDecorationCenterY[_di] = _d.worldAnchorYPx;
    }

    resetReusableSnapshot(reusableSnapshot, world);

    captureClusterInterpolationState(world, interpolationBuffers);

    skillTombRenderer.init(room.saveTombs, room.walls);
    skillTombEffectRenderer.init(room.skillTombs);
    const roomSkillTombsForInit = room.skillTombs ?? [];
    for (let i = roomSkillTombsForInit.length - 1; i >= 0; i--) {
      const st = roomSkillTombsForInit[i];
      if (consumedSkillTombKeySet.has(`${room.id}:${st.xBlock}:${st.yBlock}`)) {
        skillTombEffectRenderer.removeTomb(i);
      }
    }

    if (progress && !progress.exploredRoomIds.includes(room.id)) {
      progress.exploredRoomIds.push(room.id);
    }

    if (!preserveCamera) {
      snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, virtualWidthPx, virtualHeightPx);
    }

    // Reset effective camera clamp bounds to the new room's single-room bounds.
    // If this load preserves the camera (seamless crossing), the next frame will
    // snap these bounds to the staging union bounds when stagingState is updated.
    resetCameraEffBoundsForRoom(camState, roomWidthWorld, roomHeightWorld);

    preloadRoomThemeSprites(room);

    // Use cached edge extension if available; build and store otherwise.
    // Must run after walls are applied (Phase D) so wall geometry is finalised.
    const _cachedEntry = roomRuntimeCache.get(room.id);
    if (_cachedEntry !== undefined && _cachedEntry.edgeExtension !== null) {
      edgeExtensionCache = _cachedEntry.edgeExtension;
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} edge: cache HIT`);
      }
    } else {
      const _edgeT0 = import.meta.env.DEV ? performance.now() : 0;
      const built = buildEdgeExtensionCache(room);
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} edge: cache MISS (build ${(performance.now() - _edgeT0).toFixed(1)}ms)`);
      }
      edgeExtensionCache = built;
      // Update the cache entry (or create a new one if Phase D somehow cleared it).
      const wallEntry = roomRuntimeCache.get(room.id);
      if (wallEntry !== undefined) {
        wallEntry.edgeExtension = built;
      } else {
        // Should not normally happen; build missing fields too.
        roomRuntimeCache.set(room.id, {
          wallTemplate: buildRoomWallTemplate(room),
          edgeExtension: built,
          blockerKeys: null,
          darkBlockerKeys: null,
          wallDecorations: null,
        });
      }
    }

    // Cancel any in-flight preload schedule from the previous room and start
    // a new one for the rooms adjacent to the newly loaded room.
    _preloadScheduleHandle?.cancel();
    _preloadScheduleHandle = scheduleRoomPreloads(
      room,
      ROOM_REGISTRY,
      roomRuntimeCache,
      import.meta.env.DEV,
      // In file-cache mode (Electron lazy loading): also load room DATA for
      // adjacent rooms that are not yet in ROOM_REGISTRY.
      // In packed-campaign / browser mode: omit — all rooms are already loaded.
      isRoomFileCacheActive() ? loadRoomForGameplayAsync : undefined,
    );

    // Generator complete — Phase F has no trailing yield.
  }

  const world = createWorldState(FIXED_DT_MS, 42);
  // Set the selected character on the world for rendering
  world.characterId = progress?.characterId ?? 'knight';
  const levelRng = createRng(12345);
  const environmentalDust = new EnvironmentalDustLayer();
  const sunbeamRenderer = new SunbeamRenderer();
  const atmosphericLightDust = new AtmosphericLightDust();
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

  // ── Edge extension cache ──────────────────────────────────────────────────
  // Built once per loadRoom() call.  Rendered as visual tiles beyond the
  // room edge boundary to prevent a hard black cutoff at room walls.
  let edgeExtensionCache: EdgeExtensionCache | null = null;

  // ── Room runtime cache (wall templates + edge extensions) ─────────────────
  // Precomputed static room data keyed by room ID.  Allows _makeLoadRoomPhases
  // to skip the expensive merge pass when a room has already been preloaded.
  // Bounded LRU with 10 slots (current room + 2-hop radius + headroom).
  const roomRuntimeCache = new RoomRuntimeCache(10);

  // Handle for the current idle preload schedule so it can be cancelled when
  // the player switches rooms before the previous schedule completes.
  let _preloadScheduleHandle: PreloadScheduleHandle | null = null;

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
  }
  const asyncLoadState: AsyncRoomLoadState = {
    isActive: false,
    gen: null,
    preTransVX: 0,
    preTransVY: 0,
    transitionDir: null,
  };

  // ── Preview bubble state ──────────────────────────────────────────────────
  // Pre-allocated array of per-bubble state, updated each frame via
  // computePreviewBubbles().  Only entries [0, previewBubbleCount) are valid.
  const previewBubbles: PreviewBubbleState[] = [];
  let previewBubbleCount = 0;

  // ── Camera transition reveal state ───────────────────────────────────────
  // Tracks a smooth camera offset applied on top of the normal follow-and-clamp
  // camera to reveal edge-extension tiles as the player approaches or crosses
  // a room transition.  No fade overlay is used — transitions feel like a
  // camera pan toward the room boundary.
  const transitionRevealState = createTransitionRevealState();
  const lambdaAnchorState = createGameLambdaAnchorState(() => {
    notifyFreshRoomLoaded(transitionRevealState);
  });

  // ── Transition preview context ────────────────────────────────────────────
  // Updated each frame from the reveal state.  Provides the connected room's
  // 2-block facing-edge tiles for rendering, and is the attachment point for
  // future dual-room rendering.  See transitionPreviewContext.ts.
  const transitionPreviewCtx: TransitionPreviewContext = createTransitionPreviewContext();

  // ── Camera transition state ───────────────────────────────────────────────
  // BUILD 297: After every room switch the camera smoothly interpolates from
  // its world-space position in the old room to the clamped target position in
  // the new room.  Logic extracted to gameCameraState.ts.
  const camState: GameCameraState = createGameCameraState(roomWidthWorld, roomHeightWorld);

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
   *  and no async room load is in progress. */
  function tickLoadingOverlay(): void {
    loadingOverlay.tick(() => !asyncLoadState.isActive && areRoomSpritesReady(currentRoom));
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
    const cacheEntry = roomRuntimeCache.get(room.id);
    const isPrepared = cacheEntry !== undefined && isEntryFullyPrepared(cacheEntry);

    if (isPrepared) {
      // ── Instant path (fully prepared cache hit) ───────────────────────────
      if (import.meta.env.DEV) {
        console.log(`[transition] ${room.id}: prepared cache HIT — instant load`);
      }
      loadRoom(room, spawnXBlock, spawnYBlock);
      const player = world.clusters[0];
      if (player !== undefined && player.isPlayerFlag === 1) {
        player.velocityXWorld = vx;
        player.velocityYWorld = dir === 'up' ? vy - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION : vy;
      }
      if (import.meta.env.DEV) {
        console.log(
          `[transition] ${room.id}: instant load done in ${(performance.now() - t0).toFixed(1)}ms`,
        );
      }
    } else {
      // ── Async path (cache miss — spread over RAF frames) ──────────────────
      if (import.meta.env.DEV) {
        const status = cacheEntry === undefined ? 'cold' : 'partial';
        console.warn(`[transition] ${room.id}: cache MISS (${status}) — async load`);
      }
      asyncLoadState.preTransVX    = vx;
      asyncLoadState.preTransVY    = vy;
      asyncLoadState.transitionDir = dir;
      asyncLoadState.gen           = _makeLoadRoomPhases(room, spawnXBlock, spawnYBlock, false);
      asyncLoadState.isActive      = true;
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

  // Preload sprites for adjacent rooms in the background.
  preloadAdjacentRoomAssets(currentRoom);

  // Show the loading overlay if the spawn room's sprites aren't ready yet, OR
  // always show it on the initial campaign load to produce the fade-from-black effect.
  // areRoomSpritesReady returns true instantly for rooms with no folder-based
  // themes (legacy sprites load at module init), so the overlay won't flash.
  // Capture the flag value before calling showLoadingOverlay() (which resets it)
  // so the intent is explicit regardless of future call ordering.
  const isCampaignStart = isInitialCampaignLoad;
  if (!areRoomSpritesReady(currentRoom) || isCampaignStart) {
    showLoadingOverlay();
  }

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
    // Invalidate this room's cached runtime data so edits take effect immediately.
    roomRuntimeCache.invalidate(roomDef.id);
    loadRoom(roomDef, validX, validY, preserveCamera);
    // Editor loads are not transitions — reset reveal to neutral.
    notifyFreshRoomLoaded(transitionRevealState);
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
    world,
    roomRegistry: ROOM_REGISTRY,
    progress,
    campaignSpawnRoom,
    campaignSpawnBlock,
    skillTombRenderer,
    getCurrentRoom: () => currentRoom,
    getCurrentRoomOrigin: () => [stagingState.currentRoomOriginXWorld, stagingState.currentRoomOriginYWorld],
    loadRoom,
    onResetTransitionReveal: () => { notifyFreshRoomLoaded(transitionRevealState); },
    onResetFrameClock: () => { lastTimestampMs = 0; },
    onExitToMainMenu: () => {
      isRunning = false;
      detachInput();
      callbacks.onReturnToMenu();
    },
    onSave: callbacks.onSave,
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
  });

  function onResize(): void {
    resizeCanvas();
  }
  window.addEventListener('resize', onResize);

  function frame(timestampMs: number): void {
    if (!isRunning) return;

    // DEV: record frame start for long-frame detection.
    const _devFrameT0 = import.meta.env.DEV ? performance.now() : 0;

    const elapsedMs = lastTimestampMs === 0 ? FIXED_DT_MS : timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;

    // Record raw frame time to the profiler ring buffer unconditionally so
    // frame-pacing stats are available immediately when debug mode is enabled.
    renderProfiler.recordFrameTime(elapsedMs);

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
        return;
      }
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
        if (import.meta.env.DEV) {
          console.log('[transition] async load complete — velocity applied, resuming gameplay');
        }
      }
      // Keep the overlay visible and skip gameplay sim/render this frame.
      tickLoadingOverlay();
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
      rafHandle = requestAnimationFrame(frame);
      return;
    }

    // While dead, still render the frozen scene but skip sim
    if (gameOverlayController.state.isPlayerDead) {
      rafHandle = requestAnimationFrame(frame);
      return;
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
      crossingState.phase === 'inactive',
      preTransVX,
      preTransVY,
      startTransitionLoad,
      resolveSpawnBlock,
      camera,
      transitionRevealState,
      stagingState.currentRoomOriginXWorld,
      stagingState.currentRoomOriginYWorld,
      preloadAdjacentCurrentRoomAssets,
      transitionDebugState,
    );

    // ── Proximity-based priority preload ───────────────────────────────────
    // When the player is within URGENT_PRELOAD_PROXIMITY_BLOCKS of a room
    // boundary that has an unprepared transition target, move that room to the
    // front of the async preload queue.  We never block the gameplay frame here
    // — if the player crosses before preparation finishes the async overlay path
    // will handle it.
    {
      const _proxPlayer = world.clusters[0];
      if (_proxPlayer !== undefined && _proxPlayer.isAliveFlag === 1) {
        const _px = _proxPlayer.positionXWorld - stagingState.currentRoomOriginXWorld;
        const _py = _proxPlayer.positionYWorld - stagingState.currentRoomOriginYWorld;
        for (let _ti = 0; _ti < currentRoom.transitions.length; _ti++) {
          const _t = currentRoom.transitions[_ti];
          const _tId = _t.targetRoomId;
          const _tEntry = roomRuntimeCache.get(_tId);
          if (_tEntry !== undefined && isEntryFullyPrepared(_tEntry)) continue;

          let _isNear = false;
          switch (_t.direction) {
            case 'right': _isNear = _px >= (currentRoom.widthBlocks - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
            case 'left':  _isNear = _px <= URGENT_PRELOAD_PROXIMITY_BLOCKS * BLOCK_SIZE_MEDIUM; break;
            case 'down':  _isNear = _py >= (currentRoom.heightBlocks - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
            case 'up':    _isNear = _py <= URGENT_PRELOAD_PROXIMITY_BLOCKS * BLOCK_SIZE_MEDIUM; break;
          }
          if (_isNear) {
            // Boost priority in the async queue — never block the frame.
            _preloadScheduleHandle?.prioritize(_tId);
            break; // one priority boost per frame is sufficient
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
      const playerXBlock = player ? Math.floor((player.positionXWorld - stagingState.currentRoomOriginXWorld) / BLOCK_SIZE_SMALL) : -1;
      const playerYBlock = player ? Math.floor((player.positionYWorld - stagingState.currentRoomOriginYWorld) / BLOCK_SIZE_SMALL) : -1;
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

    // ── Check for player death ───────────────────────────────────────────────
    const playerForDeath = world.clusters[0];
    if (playerForDeath !== undefined
      && playerForDeath.isAliveFlag === 0
      && !gameOverlayController.state.isPlayerDead) {
      gameOverlayController.showPlayerDeathScreen();
    }

    // ── Crossing finalization check ──────────────────────────────────────────
    // BUILD 297: ENABLE_TWO_ROOM_CAMERA_CROSSING is false, so this block is
    // never entered.  Kept as a guard so re-enabling the flag would still work.
    if (crossingState.phase === 'crossing' && ENABLE_TWO_ROOM_CAMERA_CROSSING) {
      const playerForCrossing = world.clusters[0];
      if (playerForCrossing !== undefined && playerForCrossing.isAliveFlag === 1 &&
          isCrossingComplete(crossingState, playerForCrossing.positionXWorld, playerForCrossing.positionYWorld)) {
        finalizeCrossingSeamless(
          stagingState,
          world,
          camera,
          interpolationBuffers.prevClusterPosX,
          interpolationBuffers.prevClusterPosY,
          crossingState,
          loadRoom,
        );
        notifyFreshRoomLoaded(transitionRevealState);
        preloadAdjacentRoomAssets(currentRoom);
      }
    }

    // ── Update skill tomb renderer ──────────────────────────────────────────
    const playerForTomb = world.clusters[0];
    if (playerForTomb !== undefined && playerForTomb.isAliveFlag === 1) {
      // Convert to room-local coords since tomb positions are room-local.
      const tombPx = playerForTomb.positionXWorld - stagingState.currentRoomOriginXWorld;
      const tombPy = playerForTomb.positionYWorld - stagingState.currentRoomOriginYWorld;
      skillTombRenderer.update(tombPx, tombPy, elapsedMs / 1000);
      skillTombEffectRenderer.update(tombPx, tombPy, elapsedMs / 1000);

      processRoomPickups(world, currentRoom, collectedDustContainerKeySet, progress, playerForTomb, levelRng,
        stagingState.currentRoomOriginXWorld, stagingState.currentRoomOriginYWorld);
    }

    // ── Update camera to follow player ──────────────────────────────────────
    // BUILD 297: isCrossing is always false (ENABLE_TWO_ROOM_CAMERA_CROSSING=false),
    // renderUnionBounds is always null, effective bounds are single-room bounds.
    const isCrossing = crossingState.phase === 'crossing' && ENABLE_TWO_ROOM_CAMERA_CROSSING;
    const crossingBounds = isCrossing ? getCrossingUnionBounds(crossingState) : null;
    const stagingUnionBounds = isCrossing ? null : computeStagingUnionBounds(stagingState, currentRoom);
    const renderUnionBounds = isCrossing ? crossingBounds : stagingUnionBounds;

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
        renderUnionBounds,
        roomWidthWorld,
        roomHeightWorld,
        virtualWidthPx,
        virtualHeightPx,
        elapsedMs,
        pauseController.state.pauseMenuState.alwaysCenterCamera,
      );
    }

    // ── Update camera transition reveal offset ──────────────────────────────
    // Compute the NearTransition and PostTransition reveal each frame and ease
    // the current offset smoothly toward the target.  Applied to ox/oy below.
    // Use room-local coordinates (subtract stagingState.currentRoomOriginXWorld/Y).
    const playerForReveal = world.clusters[0];
    if (ENABLE_TRANSITION_CAMERA_REVEAL && playerForReveal !== undefined) {
      updateTransitionReveal(
        transitionRevealState,
        playerForReveal.positionXWorld - stagingState.currentRoomOriginXWorld,
        playerForReveal.positionYWorld - stagingState.currentRoomOriginYWorld,
        currentRoom,
        elapsedMs / 1000,
      );
    }

    // ── Update transition preview context ────────────────────────────────────
    // Reads reveal state (updated above) to resolve the connected room and
    // build/cache the 2-block facing-edge strip for the next-room renderer.
    updateTransitionPreviewContext(transitionPreviewCtx, transitionRevealState, currentRoom);

    // ── Recompute camera offset after update ─────────────────────────────────
    // During two-room crossing or staged-room mode the camera position already
    // tracks world space correctly, so no reveal offset is applied.  In normal
    // single-room mode the reveal offset peeks past the room boundary to show
    // edge-extension tiles.
    const camOff = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);
    let ox = camOff.offsetXPx;
    let oy = camOff.offsetYPx;
    if (ENABLE_TRANSITION_CAMERA_REVEAL && crossingState.phase === 'inactive' && stagingState.stagedRooms.length === 0) {
      const revealOff = getTransitionRevealOffset(transitionRevealState);
      ox -= revealOff.revealXWorld * camera.zoom;
      oy -= revealOff.revealYWorld * camera.zoom;
    }

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
    // Compute proximity-based preview bubble state for nearby transitions.
    // Subtract stagingState.currentRoomOriginXWorld/Y to convert to room-local coordinates,
    // which is what computePreviewBubbles expects.
    const playerForBubbles = world.clusters[0];
    if (playerForBubbles !== undefined) {
      previewBubbleCount = computePreviewBubbles(
        playerForBubbles.positionXWorld - stagingState.currentRoomOriginXWorld,
        playerForBubbles.positionYWorld - stagingState.currentRoomOriginYWorld,
        currentRoom,
        ox, oy, zoom,
        previewBubbles,
      );
    } else {
      previewBubbleCount = 0;
    }

    // ── Transition debug stats ────────────────────────────────────────────
    if (pauseController.state.isDebugMode && renderProfiler !== undefined) {
      const camTransProgress = camState.isTransitionActive ? Math.min(1, camState.transitionElapsedSec / CAM_TRANS_DURATION_SEC) : 0;
      const debugStats: TransitionDebugStats = {
        currentRoomId: currentRoom.id,
        isTransitioning: camState.isTransitionActive,
        lastDurationMs: Math.round(CAM_TRANS_DURATION_SEC * 1000),
        lastPlayerSpeedWorld: transitionDebugState.lastTransitionPlayerSpeedWorld,
        activeBubbleCount: previewBubbleCount,
        edgeCacheFilled: edgeExtensionCache !== null,
        isCameraTransitioning: camState.isTransitionActive,
        cameraTransProgress: camTransProgress,
        cameraTransStartXWorld: camState.transitionStartXWorld,
        cameraTransStartYWorld: camState.transitionStartYWorld,
        cameraTransTargetXWorld: camState.transitionTargetXWorld,
        cameraTransTargetYWorld: camState.transitionTargetYWorld,
        destinationRoomId: transitionDebugState.lastTransitionDestRoomId,
        isAdjacentRoomRenderingDisabled: !ENABLE_TWO_ROOM_CAMERA_CROSSING,
      };
      renderProfiler.updateTransitionStats(debugStats);
    }

    renderFrame({
      ctx, deviceCtx, virtualCanvas, canvas,
      webglRenderer, environmentalDust, skidDebris, crumbleDebris, weakWallJumpDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
      playerCloak, phantomCloak, darkRoomOverlay, decorationWaveState, arrowWeaveRenderer, swordWeaveRenderer,
      sunbeamRenderer, atmosphericLightDust, fallingBlockDust,
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
      graphicsQuality: pauseController.state.pauseMenuState.graphicsQuality,
      isAdaptiveReductionActive: aqState.isAdaptiveReductionActive,
      isDeepReductionActive: aqState.isDeepReductionActive,
      renderProfiler,
      renderAlpha,
      prevFallingBlockOffsetY: interpolationBuffers.prevFallingBlockOffsetY,
      edgeExtensionCache,
      previewBubbles,
      previewBubbleCount,
      transitionPreviewCtx,
      // BUILD 279/284: two-room crossing or staged-room clip rect
      isCrossing: isCrossing || stagingState.stagedRooms.length > 0,
      crossingUnionMinXWorld: renderUnionBounds?.minXWorld ?? 0,
      crossingUnionMinYWorld: renderUnionBounds?.minYWorld ?? 0,
      crossingUnionMaxXWorld: renderUnionBounds?.maxXWorld ?? roomWidthWorld,
      crossingUnionMaxYWorld: renderUnionBounds?.maxYWorld ?? roomHeightWorld,
      alwaysCenterCamera: pauseController.state.pauseMenuState.alwaysCenterCamera,
      // Staged room background info for seamless crossing rendering.
      stagedRoom: stagingState.stagedRooms.length > 0 ? stagingState.stagedRooms[0] : null,
    });

    // Tick the loading overlay — hides it once sprites are ready.
    tickLoadingOverlay();

    if (import.meta.env.DEV && _devFrameT0 > 0) {
      const _frameMs = performance.now() - _devFrameT0;
      if (_frameMs > 50) {
        console.warn(`[perf] LONG FRAME (gameplay): ${_frameMs.toFixed(1)}ms`);
      }
    }

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
