/**
 * gameLoadRoomPhases.ts
 *
 * Extracted from gameScreen.ts (BUILD 408).
 *
 * Defines `LoadRoomCtx` — a context object that bundles all dependencies
 * needed by the 6-phase room-load generator — and `makeLoadRoomPhases`, the
 * generator itself.
 *
 * Extraction strategy
 * ───────────────────
 * The generator writes back to several `let` closure variables in
 * `gameScreen.ts` (e.g. `currentRoom`, `bgColor`).  Because `startTransitionLoad`
 * intentionally calls `gen.next()` once immediately after creating the generator
 * (so that Phase A completes and `currentRoom` is updated before
 * `onRoomBecameActive()` is called), the write-back must happen *per-phase*, not
 * only when the generator runs to completion.
 *
 * To preserve this contract without keeping the generator inside the closure:
 *  • Object references that the generator mutates in-place (`world`, `camera`,
 *    `roomRuntimeCache`, …) are passed directly as context fields.
 *  • `let` primitives (`currentRoom`, `bgColor`, …) use setter callbacks so
 *    assignments in the generator are immediately reflected in the outer scope.
 *  • `virtualWidthPx` / `virtualHeightPx` use getter callbacks because they
 *    change when the user resizes the window.
 *
 * All non-closure dependencies (module-level constants and imports) are
 * re-imported here.
 */

import type { WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles } from '../sim/clusters/grapple';
import type { RngState } from '../sim/rng';
import { resetReusableSnapshot } from '../render/snapshot';
import type { ReusableWorldSnapshot } from '../render/snapshot';
import type { PlayerCloak } from '../render/clusters/playerCloak';
import type { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import type { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import type { GuideDustPathRenderer } from '../render/effects/guideDustPathRenderer';
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ROOM_REGISTRY } from '../levels/rooms';
import type { CameraState } from '../render/camera';
import { snapCamera } from '../render/camera';
import {
  setActiveBlockSpriteWorld,
  setActiveBlockSpriteTheme,
  setActiveBlockLighting,
  setActiveDarkAmbientBlockers,
  setActiveSeamBlending,
} from '../render/walls/blockSpriteRenderer';
import { computeRenderStateKey } from '../render/walls/roomRenderCacheStore';
import {
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
  DEFAULT_BACKGROUND_LIGHT_SPILL,
  DEFAULT_SOLID_LIGHT_SOFTNESS,
} from '../render/walls/ambientLightDepths';
import { preloadTransitionSprites } from '../render/walls/seamBlending';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { PlayerProgress } from '../progression/playerProgress';
import {
  type PlayerWeaveLoadout,
  sanitizePlayerWeaveLoadoutForProgress,
} from '../sim/weaves/playerLoadout';
import { WEAVE_NONE, WEAVE_STORM } from '../sim/weaves/weaveDefinition';
import { resetRadiantTetherState } from '../sim/clusters/radiantTetherAi';
import { resetRadiantWebState } from '../sim/clusters/radiantWebAi';
import { initGrappleHunterChainParticles } from '../sim/clusters/grappleHunterAi';
import type { GraphicsQuality } from '../ui/renderSettings';
import type { MusicManager } from '../audio/musicManager';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import { getTotalCapacity, getMaxParticlesForDust } from '../progression/dustCapacity';
import {
  spawnClusterParticles,
  spawnWeaveLoadoutParticles,
  spawnBackgroundFluidParticles,
  spawnAllDustPiles,
  PARTICLE_COUNT_PER_CLUSTER,
  BACKGROUND_FLUID_COUNT,
  PLAYER_INITIAL_HEALTH,
} from './gameSpawn';
import { spawnEnemyClusters } from './gameEnemySpawn';
import {
  loadRoomHazards,
  loadRoomRopes,
  loadRoomFallingBlocks,
  loadRoomGrasshoppers,
  worldBgColor,
} from './gameRoom';
import {
  captureClusterInterpolationState,
} from './gameInterpolationBuffers';
import type { GameInterpolationBuffers } from './gameInterpolationBuffers';
import { buildRoomDecorations } from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import { resetSwordWeaveState } from '../sim/weaves/swordWeave';
import type { DialogueState } from '../dialogue/dialogueState';
import type { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';
import { prepareRoomDialogueVisitState } from './gameDialogueHandler';
import type { Conversation } from '../dialogue/dialogueTypes';
import {
  preloadRoomThemeSprites,
  decodeRoomThemeSprites,
  decodeRoomBackground,
} from '../render/roomAssetPreloader';
import { applyRoomWallTemplate, buildRoomWallTemplateIncremental } from './gameRoomWalls';
import type { RoomRuntimeCache, RoomRuntimeEntry } from './roomRuntimeCache';
import { scheduleRoomPreloads, type PreloadScheduleHandle } from './roomPreloadScheduler';
import {
  scheduleChunkPrewarms,
  adoptPrewarmedChunksForRoom,
  type WarmScheduleHandle,
} from './roomRenderChunkWarmScheduler';
import {
  type GameCameraState,
  cancelCameraTransition,
  resetCameraEffBoundsForRoom,
} from './gameCameraState';
import { resetSnakeRuntimeState } from '../sim/clusters/snakeAi';
import {
  type PlayerTransferSnapshot,
  restoreTransferredPlayerParticles,
} from './playerTransfer';
import {
  loadRoomForGameplayAsync,
  isRoomFileCacheActive,
  getActiveRoomAdjacency,
} from '../levels/roomFileLoader';
import * as FP from '../debug/perfFreezeProfiler';

/**
 * All dependencies required by `makeLoadRoomPhases`.
 *
 * Object references are passed directly (the generator mutates them in-place).
 * Mutable primitive `let` variables from the outer `startGameScreen` closure
 * use setter callbacks so Phase-A write-backs are visible immediately.
 * Read-only `let` primitives that change over time use getter callbacks.
 */
export interface LoadRoomCtx {
  // ── Object references (mutated in-place or method-called) ───────────────
  world: WorldState;
  camState: GameCameraState;
  camera: CameraState;
  roomRuntimeCache: RoomRuntimeCache;
  musicManager: MusicManager;
  playerWeaveLoadout: PlayerWeaveLoadout;
  progress: PlayerProgress | undefined;
  playerCloak: PlayerCloak;
  phantomCloak: PhantomCloakExtension;
  decorationWaveState: import('../render/effects/wallDecorations').DecorationWaveState;
  environmentalDust: EnvironmentalDustLayer;
  sunbeamRenderer: SunbeamRenderer;
  atmosphericLightDust: AtmosphericLightDust;
  guideDustPathRenderer: GuideDustPathRenderer;
  reusableSnapshot: ReusableWorldSnapshot;
  interpolationBuffers: GameInterpolationBuffers;
  skillTombRenderer: SkillTombRenderer;
  skillTombEffectRenderer: SkillTombEffectRenderer;
  consumedSkillTombKeySet: ReadonlySet<string>;
  dialogueState: DialogueState;
  dialogueRenderer: DialogueOverlayRenderer;
  levelRng: RngState;
  renderProfiler: RenderProfiler;
  /** Pre-allocated Float32Array; mutated in-place each room load. */
  cachedDecorationCenterX: Float32Array;
  /** Pre-allocated Float32Array; mutated in-place each room load. */
  cachedDecorationCenterY: Float32Array;

  // ── Getters for mutable primitives ──────────────────────────────────────
  /** Returns the current virtual canvas width (may change on window resize). */
  getVirtualWidthPx: () => number;
  /** Returns the current virtual canvas height (may change on window resize). */
  getVirtualHeightPx: () => number;
  /** Returns the current graphics quality setting. */
  getGraphicsQuality: () => GraphicsQuality;

  // ── Setters for closure variables written by the generator ───────────────
  /**
   * Called at the very start of Phase A.
   * `startTransitionLoad` calls `gen.next()` once immediately after creating
   * the generator so that this setter fires before `onRoomBecameActive()`,
   * allowing sprite preloads to target the *new* room.
   */
  setCurrentRoom: (room: RoomDef) => void;
  setBgColor: (color: string) => void;
  setRoomWidthWorld: (w: number) => void;
  setRoomHeightWorld: (h: number) => void;
  setFiredDialogueTriggerUids: (uids: Set<number>) => void;
  setCachedRoomConversations: (convs: Conversation[]) => void;
  setCachedWallDecorations: (decorations: WallDecoration[]) => void;
  getPreloadScheduleHandle: () => PreloadScheduleHandle | null;
  setPreloadScheduleHandle: (h: PreloadScheduleHandle | null) => void;
  getWarmScheduleHandle: () => WarmScheduleHandle | null;
  setWarmScheduleHandle: (h: WarmScheduleHandle | null) => void;
  /**
   * Returns the player's velocity at the moment the room transition was
   * triggered.  Used by Phase F to order the chunk prewarm queue so the
   * room in the travel direction is built first.
   */
  getPreTransitionVelocity: () => { vx: number; vy: number };
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
 *
 * Extracted from `gameScreen.ts` in BUILD 409.
 * Called by the thin wrapper `_makeLoadRoomPhases` in `gameScreen.ts`.
 */
export function* makeLoadRoomPhases(
  ctx: LoadRoomCtx,
  room: RoomDef,
  spawnXBlock: number,
  spawnYBlock: number,
  preserveCamera: boolean,
): Generator<void, void, void> {
  // Destructure frequently-accessed read-only references for ergonomics.
  const {
    world,
    camera,
    camState,
    musicManager,
    roomRuntimeCache,
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
  } = ctx;

  // ── Phase A: room metadata + world reset ──────────────────────────────
  // These local variables shadow the outer-scope lets only within this
  // generator; setters propagate the values back to gameScreen.ts immediately.
  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

  ctx.setCurrentRoom(room);
  ctx.setBgColor(worldBgColor(room.worldNumber));
  ctx.setRoomWidthWorld(roomWidthWorld);
  ctx.setRoomHeightWorld(roomHeightWorld);

  // Reset camera transition state on any full room load.
  // The transition callback sets isTransitionActive true AFTER
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
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
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
      room.directionalBias,
      room.sideExposureStrength,
      room.minimumWallLight,
      room.falloffPower,
      room.backgroundLightSpill,
      room.solidLightSoftness,
    );
    setActiveDarkAmbientBlockers(darkBlockerKeys);
    setActiveSeamBlending(room.blockSeamBlending ?? 'off');
    // Adopt any pre-warmed chunks that were built during idle time for this
    // room.  Must be called after lighting/theme setters but before the first
    // render frame so the active chunk caches are seeded with pre-built data.
    // Compute the same renderStateKey that the prewarm scheduler used so the
    // adoption can detect and discard snapshots built for a stale render state.
    const adoptRenderStateKey = computeRenderStateKey(
      room.blockTheme ?? null,
      room.worldNumber ?? 1,
      room.lightingEffect ?? 'Ambient',
      room.ambientLightDirection ?? 'omni',
      room.blockSeamBlending ?? 'off',
      blockerKeys ?? new Set<string>(),
      room.widthBlocks,
      room.heightBlocks,
      room.directionalBias    ?? DEFAULT_DIRECTIONAL_BIAS,
      room.sideExposureStrength ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
      room.minimumWallLight   ?? DEFAULT_MINIMUM_WALL_LIGHT,
      room.falloffPower       ?? DEFAULT_FALLOFF_POWER,
      room.backgroundLightSpill ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
      room.solidLightSoftness ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
    );
    adoptPrewarmedChunksForRoom(room, camera.zoom, adoptRenderStateKey);
    FP.recordLoadPhaseStep('A:blockers+lighting', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
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
  resetSnakeRuntimeState();

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

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    const effectiveWeaveLoadout = sanitizePlayerWeaveLoadoutForProgress(
      progress?.weaveLoadout ?? playerWeaveLoadout,
      progress,
    );
    const playerCapacity = progress ? getTotalCapacity(progress.dustContainerCount) : 0;
    const hasWeaveBoundDust = effectiveWeaveLoadout.primary.boundDust.length > 0
      || effectiveWeaveLoadout.secondary.boundDust.length > 0;

    if (hasWeaveBoundDust) {
      spawnWeaveLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, effectiveWeaveLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);
    } else if (progress && progress.unlockedDustKinds.length > 0 && playerCapacity > 0) {
      const dustKind = progress.unlockedDustKinds[0];
      const particleCount = getMaxParticlesForDust(dustKind, playerCapacity);
      if (particleCount > 0) {
        spawnClusterParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, dustKind, particleCount, levelRng);
      }
    }

    world.playerPrimaryWeaveId = effectiveWeaveLoadout.primary.weaveId;
    world.playerSecondaryWeaveId = effectiveWeaveLoadout.secondary.weaveId;
    world.canUsePlayerSecondaryWeaveFlag = effectiveWeaveLoadout.secondary.weaveId === WEAVE_NONE ? 0 : 1;
    world.isMoteSourceOrbitFlag = world.playerPrimaryWeaveId === WEAVE_STORM ? 1 : 0;

    initMoteQueueFromParticles(world, playerCluster.entityId);
    resetSwordWeaveState(world);
    FP.recordLoadPhaseStep('B:playerParticles+moteQueue', import.meta.env.DEV ? performance.now() - _t0 : 0);

    if (import.meta.env.DEV) {
      let spawnedPlayerParticleCount = 0;
      for (let particleIndex = 0; particleIndex < world.particleCount; particleIndex++) {
        if (world.ownerEntityId[particleIndex] === playerCluster.entityId &&
            world.isAliveFlag[particleIndex] === 1 &&
            world.isTransientFlag[particleIndex] === 0) {
          spawnedPlayerParticleCount++;
        }
      }
      console.log(
        `[gameScreen:roomLoad] room="${room.id}"` +
        `\n  dustContainerCount  = ${progress?.dustContainerCount ?? 0}` +
        `\n  playerCapacity      = ${playerCapacity}` +
        `\n  unlockedDustKinds   = [${(progress?.unlockedDustKinds ?? []).join(', ')}]` +
        `\n  spawnedParticles    = ${spawnedPlayerParticleCount}` +
        (progress?.dustContainerCount && !(progress?.unlockedDustKinds?.length)
          ? '\n  ⚠ player owns containers but has no unlocked dust types — HUD shows empty containers'
          : ''),
      );
    }
  }

  yield; // ── Phase B complete ─────────────────────────────────────────────

  // ── Phase C: spawn enemies ────────────────────────────────────────────
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    world.bgWallGridWidth  = room.widthBlocks;
    world.bgWallGridHeight = room.heightBlocks;
    const bgWallCellCount = room.widthBlocks * room.heightBlocks;
    if (world.bgWallGrid.length !== bgWallCellCount) {
      world.bgWallGrid = new Uint8Array(bgWallCellCount);
    } else {
      world.bgWallGrid.fill(0);
    }
    let occupiedCells = 0;
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            const row = b.yBlock + dy;
            if (
              col >= 0 && col < room.widthBlocks &&
              row >= 0 && row < room.heightBlocks
            ) {
              const idx = col + row * room.widthBlocks;
              if (world.bgWallGrid[idx] === 0) occupiedCells++;
              world.bgWallGrid[idx] = 1;
            }
          }
        }
      }
    }
    if (import.meta.env.DEV && bgWallCellCount > 65536) {
      const bgBlockCount = room.backgroundBlocks?.length ?? 0;
      const sparsePct = bgWallCellCount > 0 ? ((occupiedCells / bgWallCellCount) * 100).toFixed(2) : '0';
      console.log(
        `[largeRoom] loadRoom bgWallGrid: roomId=${room.id}` +
        ` ${room.widthBlocks}×${room.heightBlocks} area=${bgWallCellCount}` +
        ` bgBlocks=${bgBlockCount} occupiedCells=${occupiedCells} (${sparsePct}%)`,
      );
    }
    spawnEnemyClusters(world, room.enemies, 2, levelRng);
    FP.recordLoadPhaseStep('C:enemySpawn', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  yield; // ── Phase C complete ─────────────────────────────────────────────

  // ── Phase D: background particles + grapple chains + walls ───────────
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    spawnBackgroundFluidParticles(world, BACKGROUND_FLUID_COUNT, levelRng);
    FP.recordLoadPhaseStep('D:bgFluidParticles', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    initGrappleChainParticles(world, 1);
    for (let ci = 0; ci < world.clusters.length; ci++) {
      const cl = world.clusters[ci];
      if (cl.isGrappleHunterFlag === 1) {
        initGrappleHunterChainParticles(world, cl);
      }
    }
    FP.recordLoadPhaseStep('D:grappleChains', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  // Use resolveRoomWallTemplate for cache → baked hits; on a cache+baked miss
  // drive buildRoomWallTemplateIncremental() across frames to stay under 8 ms.
  {
    const _wallT0 = import.meta.env.DEV ? performance.now() : 0;
    const cacheEntry = roomRuntimeCache.get(room.id);
    if (cacheEntry !== undefined) {
      // Fast path: already in runtime cache.
      applyRoomWallTemplate(world, cacheEntry.wallTemplate);
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _wallT0;
        console.log(`[wallTemplate] roomId=${room.id} source=cache wallCount=${cacheEntry.wallTemplate.wallCount} (apply ${_ms.toFixed(1)}ms)`);
        FP.recordLoadPhaseStep('D:wallTemplate', _ms);
      } else { FP.recordLoadPhaseStep('D:wallTemplate', 0); }
    } else if (room.bakedWallTemplate !== undefined) {
      // Baked template present — apply and store so subsequent transitions are fast.
      applyRoomWallTemplate(world, room.bakedWallTemplate);
      roomRuntimeCache.set(room.id, {
        wallTemplate:    room.bakedWallTemplate,
        edgeExtension:   null,
        blockerKeys,
        darkBlockerKeys,
        wallDecorations: null,
      } satisfies RoomRuntimeEntry);
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _wallT0;
        console.log(`[wallTemplate] roomId=${room.id} source=baked wallCount=${room.bakedWallTemplate.wallCount} (apply ${_ms.toFixed(1)}ms)`);
        FP.recordLoadPhaseStep('D:wallTemplate', _ms);
      } else { FP.recordLoadPhaseStep('D:wallTemplate', 0); }
    } else {
      // Fallback: run the incremental merge generator.  Each slice that exceeds
      // the 4 ms budget yields back to the RAF loop so we never spike a frame.
      if (import.meta.env.DEV) FP.recordLoadPhaseStep('D:wallTemplate_lookup', performance.now() - _wallT0);

      yield; // ── Phase D walls lookup complete; merge starts next frame ────

      const _mergeT0 = import.meta.env.DEV ? performance.now() : 0;
      const mergeGen = buildRoomWallTemplateIncremental(room);
      let mergeStep = mergeGen.next();
      while (!mergeStep.done) {
        if (import.meta.env.DEV) FP.recordLoadPhaseStep('D:wallTemplate_merge_slice', performance.now() - _mergeT0);
        yield; // ── Merge budget elapsed — resume next frame ────────────────
        mergeStep = mergeGen.next();
      }
      const wallTemplate = mergeStep.value;
      applyRoomWallTemplate(world, wallTemplate);
      roomRuntimeCache.set(room.id, {
        wallTemplate,
        edgeExtension:   null,
        blockerKeys,
        darkBlockerKeys,
        wallDecorations: null,
      } satisfies RoomRuntimeEntry);
      if (import.meta.env.DEV) {
        const _ms = performance.now() - _mergeT0;
        console.log(`[wallTemplate] roomId=${room.id} source=fallback wallCount=${wallTemplate.wallCount} (build ${_ms.toFixed(1)}ms)`);
        FP.recordLoadPhaseStep('D:wallTemplate', _ms);
      } else { FP.recordLoadPhaseStep('D:wallTemplate', 0); }
    }
  }

  yield; // ── Phase D complete ─────────────────────────────────────────────

  // ── Phase E: hazards + ropes + blocks + grasshoppers + dialogue ──────
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    loadRoomHazards(world, room);
    FP.recordLoadPhaseStep('E:hazards', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    loadRoomRopes(world, room);
    FP.recordLoadPhaseStep('E:ropes', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    loadRoomFallingBlocks(world, room);
    FP.recordLoadPhaseStep('E:fallingBlocks', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    loadRoomGrasshoppers(world, room);
    FP.recordLoadPhaseStep('E:grasshoppers', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    const dialogueVisitState = prepareRoomDialogueVisitState(room, dialogueState, dialogueRenderer);
    ctx.setFiredDialogueTriggerUids(dialogueVisitState.firedDialogueTriggerUids);
    ctx.setCachedRoomConversations(dialogueVisitState.cachedRoomConversations);
    FP.recordLoadPhaseStep('E:dialoguePrep', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    spawnAllDustPiles(world);
    FP.recordLoadPhaseStep('E:dustPiles', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  yield; // ── Phase E complete ─────────────────────────────────────────────

  // ── Phase F: environment effects + rendering state + camera setup ─────
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    environmentalDust.initFromWorld(world, room.worldNumber);
    FP.recordLoadPhaseStep('F:environmentalDust', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    sunbeamRenderer.initFromRoom(room);
    FP.recordLoadPhaseStep('F:sunbeamRenderer', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    atmosphericLightDust.initFromRoom(room);
    FP.recordLoadPhaseStep('F:atmosphericLightDust', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }
  guideDustPathRenderer.initFromRoom(room);

  playerCloak.reset();
  phantomCloak.reset();

  decorationWaveState.reset(room.decorations?.length ?? 0);

  // Use cached wall decorations if available (pure geometry, no mutable state).
  const _decorEntry = roomRuntimeCache.get(room.id);
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    let _localWallDecorations: WallDecoration[];
    if (_decorEntry !== undefined && _decorEntry.wallDecorations !== null) {
      _localWallDecorations = _decorEntry.wallDecorations;
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} decorations: cache HIT`);
      }
    } else {
      const _decorT0 = import.meta.env.DEV ? performance.now() : 0;
      _localWallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
      if (_decorEntry !== undefined) {
        _decorEntry.wallDecorations = _localWallDecorations;
      }
      if (import.meta.env.DEV) {
        console.log(`[loadRoom] ${room.id} decorations: cache MISS (build ${(performance.now() - _decorT0).toFixed(1)}ms)`);
      }
    }
    ctx.setCachedWallDecorations(_localWallDecorations);
    for (let _di = 0; _di < _localWallDecorations.length; _di++) {
      const _d = _localWallDecorations[_di];
      cachedDecorationCenterX[_di] = _d.worldLeftPx + BLOCK_SIZE_SMALL / 2;
      cachedDecorationCenterY[_di] = _d.worldAnchorYPx;
    }
    FP.recordLoadPhaseStep('F:wallDecorations', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  resetReusableSnapshot(reusableSnapshot, world);

  captureClusterInterpolationState(world, interpolationBuffers);

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    skillTombRenderer.init(room.saveTombs, room.walls);
    skillTombEffectRenderer.init(room.skillTombs);
    const roomSkillTombsForInit = room.skillTombs ?? [];
    for (let i = roomSkillTombsForInit.length - 1; i >= 0; i--) {
      const st = roomSkillTombsForInit[i];
      if (consumedSkillTombKeySet.has(`${room.id}:${st.xBlock}:${st.yBlock}`)) {
        skillTombEffectRenderer.removeTomb(i);
      }
    }
    FP.recordLoadPhaseStep('F:skillTombInit', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  if (progress && !progress.exploredRoomIds.includes(room.id)) {
    progress.exploredRoomIds.push(room.id);
  }

  if (!preserveCamera) {
    snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, ctx.getVirtualWidthPx(), ctx.getVirtualHeightPx());
  }

  // Reset effective camera clamp bounds to the new room's single-room bounds.
  resetCameraEffBoundsForRoom(camState, roomWidthWorld, roomHeightWorld);

  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    preloadRoomThemeSprites(room);
    // Fire decode() for the current room's sprites so they are GPU-rasterized
    // before the first wall chunks render. Fire-and-forget — never blocks the frame.
    void decodeRoomThemeSprites(room);
    decodeRoomBackground(room);
    FP.recordLoadPhaseStep('F:preloadRoomThemeSprites', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  // Warm the transition sprite cache for all non-none profile kinds.
  // Missing sprites are cached as misses after the first 404 — no per-frame cost.
  if (room.blockSeamBlending && room.blockSeamBlending !== 'off') {
    preloadTransitionSprites(['mossy', 'crumbly', 'cracked', 'rooted', 'dusty', 'veined', 'corrupted']);
  }

  // Cancel any in-flight preload schedule from the previous room and start
  // a new one for the rooms adjacent to the newly loaded room.
  ctx.getPreloadScheduleHandle()?.cancel();
  {
    const _t0 = import.meta.env.DEV ? performance.now() : 0;
    ctx.setPreloadScheduleHandle(scheduleRoomPreloads(
      room,
      ROOM_REGISTRY,
      roomRuntimeCache,
      import.meta.env.DEV,
      // In file-cache mode (Electron lazy loading): also load room DATA for
      // adjacent rooms that are not yet in ROOM_REGISTRY.
      // In packed-campaign / browser mode: omit — all rooms are already loaded.
      isRoomFileCacheActive() ? loadRoomForGameplayAsync : undefined,
      // Pass manifest adjacency index so the scheduler can discover radius-2
      // rooms via BFS even when intermediate rooms are not yet in ROOM_REGISTRY.
      // Absent when no file cache is active or the manifest lacks adjacency
      // (old manifests) — falls back to registry-only BFS.
      getActiveRoomAdjacency() ?? undefined,
    ));
    FP.recordLoadPhaseStep('F:scheduleRoomPreloads', import.meta.env.DEV ? performance.now() - _t0 : 0);
  }

  // Start render-chunk prewarm scheduler for nearby rooms.
  // Runs only during idle time after room data and sprites are ready.
  ctx.getWarmScheduleHandle()?.cancel();
  ctx.setWarmScheduleHandle(scheduleChunkPrewarms(
    room,
    ROOM_REGISTRY,
    roomRuntimeCache,
    ctx.getGraphicsQuality,
    () => renderProfiler.getLastFrameMs(),
    ctx.getVirtualWidthPx(),
    ctx.getVirtualHeightPx(),
    camera.zoom,
    ctx.getPreTransitionVelocity(),
  ));

  // Generator complete — Phase F has no trailing yield.
}

// ── applyResidentRoomActivation ───────────────────────────────────────────────

/**
 * Apply Phase-A renderer state, Phase-B player spawn, and Phase-F environment
 * effects to `ctx.world` for a resident-room hot-swap transition.
 *
 * **Preconditions (caller's responsibility before calling):**
 *  - `ctx.world` has already been updated to the target resident's WorldState.
 *  - The player cluster and all player-owned particles have been removed from
 *    the outgoing world (so the frozen outgoing resident has no player).
 *  - `carryHealthPoints` was captured from the outgoing world's player cluster.
 *
 * **What this does:**
 *  - Applies block theme/lighting/seams to the renderer (Phase A equivalent).
 *  - Resets module-level singletons (snake, radiantTether, radiantWeb).
 *  - Inserts the player cluster at `world.clusters[0]` (Phase B equivalent).
 *  - Spawns player particles and inits the mote queue.
 *  - Initialises environment effects, resets cloaks, sets wall decorations.
 *  - Snaps the camera to the spawn point and resets camera eff-bounds.
 *  - Schedules room preloads and chunk prewarms.
 *
 * **What this does NOT do:**
 *  - Does not touch Phases C, D, E — enemies/hazards/ropes/blocks are already
 *    in the resident WorldState.
 *  - Does not reset `world.clusters.length` or `world.particleCount`.
 *  - Does not call any yielding / async operation — fully synchronous.
 *
 * BUILD 416
 *
 * @param ctx                LoadRoomCtx with `ctx.world` pointing to the
 *                           target resident WorldState.
 * @param room               Room definition for the target room.
 * @param spawnXBlock        Horizontal spawn block (from the transition).
 * @param spawnYBlock        Vertical spawn block (from the transition).
 * @param carryHealthPoints  Player HP captured from the outgoing world.
 * @param playerTransfer     Optional transfer snapshot from the outgoing world's
 *                           player.  When provided, carried dust particles are
 *                           restored instead of spawning a fresh loadout.
 */
export interface ResidentActivationResult {
  /** Number of carried player particles restored in the target world. 0 if fresh spawn was used. */
  particlesRestored: number;
  /** Number of carried player particles skipped (buffer full). 0 if fresh spawn was used. */
  particlesSkipped:  number;
}

export function applyResidentRoomActivation(
  ctx: LoadRoomCtx,
  room: RoomDef,
  spawnXBlock: number,
  spawnYBlock: number,
  carryHealthPoints: number,
  playerTransfer?: PlayerTransferSnapshot,
): ResidentActivationResult {
  const {
    world,
    camera,
    camState,
    musicManager,
    roomRuntimeCache,
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
  } = ctx;

  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;

  // ── Phase A equivalent: room metadata + renderer setup ───────────────────
  ctx.setCurrentRoom(room);
  ctx.setBgColor(worldBgColor(room.worldNumber));
  ctx.setRoomWidthWorld(roomWidthWorld);
  ctx.setRoomHeightWorld(roomHeightWorld);

  cancelCameraTransition(camState);

  if (room.blockTheme) {
    setActiveBlockSpriteTheme(room.blockTheme);
  } else {
    setActiveBlockSpriteWorld(room.worldNumber);
  }

  let blockerKeys: Set<string> | undefined;
  let darkBlockerKeys: Set<string> | undefined;
  {
    const cacheEntry = roomRuntimeCache.get(room.id);
    if (cacheEntry !== undefined && cacheEntry.blockerKeys !== null) {
      blockerKeys     = cacheEntry.blockerKeys;
      darkBlockerKeys = cacheEntry.darkBlockerKeys ?? undefined;
    } else {
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
      if (cacheEntry !== undefined) {
        cacheEntry.blockerKeys     = blockerKeys;
        cacheEntry.darkBlockerKeys = darkBlockerKeys;
      }
    }
    setActiveBlockLighting(
      room.lightingEffect ?? 'Ambient',
      room.widthBlocks,
      room.heightBlocks,
      room.ambientLightDirection,
      blockerKeys,
      room.directionalBias,
      room.sideExposureStrength,
      room.minimumWallLight,
      room.falloffPower,
      room.backgroundLightSpill,
      room.solidLightSoftness,
    );
    setActiveDarkAmbientBlockers(darkBlockerKeys);
    setActiveSeamBlending(room.blockSeamBlending ?? 'off');
    const adoptRenderStateKey = computeRenderStateKey(
      room.blockTheme ?? null,
      room.worldNumber ?? 1,
      room.lightingEffect ?? 'Ambient',
      room.ambientLightDirection ?? 'omni',
      room.blockSeamBlending ?? 'off',
      blockerKeys ?? new Set<string>(),
      room.widthBlocks,
      room.heightBlocks,
      room.directionalBias    ?? DEFAULT_DIRECTIONAL_BIAS,
      room.sideExposureStrength ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
      room.minimumWallLight   ?? DEFAULT_MINIMUM_WALL_LIGHT,
      room.falloffPower       ?? DEFAULT_FALLOFF_POWER,
      room.backgroundLightSpill ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
      room.solidLightSoftness ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
    );
    adoptPrewarmedChunksForRoom(room, camera.zoom, adoptRenderStateKey);
  }
  musicManager.notifyRoomEntered(room.songId ?? '_continue');

  // Reset module-level singletons (must run on the frame this world becomes active).
  resetSnakeRuntimeState();
  resetRadiantTetherState();
  resetRadiantWebState();

  // Reset world-level grapple state (player arrives in the new room with no active grapple).
  world.isGrappleActiveFlag      = 0;
  world.isGrappleMissActiveFlag  = 0;
  world.isGrappleRetractingFlag  = 0;
  world.isGrappleZipActiveFlag   = 0;
  world.isGrappleStuckFlag       = 0;
  world.hasGrappleChargeFlag     = 1;
  world.grappleParticleStartIndex = -1;

  // ── Phase B equivalent: insert player at clusters[0] ─────────────────────
  const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
  const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
  const playerCluster = createClusterState(1, spawnXWorld, spawnYWorld, 1, Math.min(carryHealthPoints, PLAYER_INITIAL_HEALTH));
  // Preserve sprite facing direction from the outgoing room so the player
  // does not snap to the default (right-facing) on entry.
  if (playerTransfer !== undefined) {
    playerCluster.isFacingLeftFlag = playerTransfer.isFacingLeftFlag;
  }
  // Enemies are already in the world from the pre-build; insert player at index 0.
  world.clusters.unshift(playerCluster);

  let particlesRestored = 0;
  let particlesSkipped  = 0;
  {
    if (playerTransfer !== undefined && playerTransfer.ownedParticles.length > 0) {
      // Restore transferred dust particles rather than spawning a fresh loadout.
      const result = restoreTransferredPlayerParticles(
        world, playerTransfer, playerCluster.entityId, spawnXWorld, spawnYWorld,
      );
      particlesRestored = result.restored;
      particlesSkipped  = result.skipped;
    } else {
      // Fresh spawn path: first visit or no particles to carry.
      const effectiveWeaveLoadout = sanitizePlayerWeaveLoadoutForProgress(
        progress?.weaveLoadout ?? playerWeaveLoadout,
        progress,
      );
      const playerCapacity = progress ? getTotalCapacity(progress.dustContainerCount) : 0;
      const hasWeaveBoundDust = effectiveWeaveLoadout.primary.boundDust.length > 0
        || effectiveWeaveLoadout.secondary.boundDust.length > 0;

      if (hasWeaveBoundDust) {
        spawnWeaveLoadoutParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, effectiveWeaveLoadout, PARTICLE_COUNT_PER_CLUSTER, levelRng);
      } else if (progress && progress.unlockedDustKinds.length > 0 && playerCapacity > 0) {
        const dustKind = progress.unlockedDustKinds[0];
        const particleCount = getMaxParticlesForDust(dustKind, playerCapacity);
        if (particleCount > 0) {
          spawnClusterParticles(world, playerCluster.entityId, spawnXWorld, spawnYWorld, dustKind, particleCount, levelRng);
        }
      }
    }

    const effectiveWeaveLoadout = sanitizePlayerWeaveLoadoutForProgress(
      progress?.weaveLoadout ?? playerWeaveLoadout,
      progress,
    );
    world.playerPrimaryWeaveId   = effectiveWeaveLoadout.primary.weaveId;
    world.playerSecondaryWeaveId = effectiveWeaveLoadout.secondary.weaveId;
    world.canUsePlayerSecondaryWeaveFlag = effectiveWeaveLoadout.secondary.weaveId === WEAVE_NONE ? 0 : 1;
    world.isMoteSourceOrbitFlag  = world.playerPrimaryWeaveId === WEAVE_STORM ? 1 : 0;
    world.characterId            = ctx.progress?.characterId ?? 'knight';

    initMoteQueueFromParticles(world, playerCluster.entityId);
    resetSwordWeaveState(world);
  }

  // ── Dialogue reset (Phase E equivalent) ──────────────────────────────────
  const dialogueVisitState = prepareRoomDialogueVisitState(room, dialogueState, dialogueRenderer);
  ctx.setFiredDialogueTriggerUids(dialogueVisitState.firedDialogueTriggerUids);
  ctx.setCachedRoomConversations(dialogueVisitState.cachedRoomConversations);

  // ── Phase F equivalent: environment effects + rendering state + camera ────
  environmentalDust.initFromWorld(world, room.worldNumber);
  sunbeamRenderer.initFromRoom(room);
  atmosphericLightDust.initFromRoom(room);
  guideDustPathRenderer.initFromRoom(room);

  playerCloak.reset();
  phantomCloak.reset();
  decorationWaveState.reset(room.decorations?.length ?? 0);

  {
    const decorCacheEntry = roomRuntimeCache.get(room.id);
    let wallDecorations: import('../render/effects/wallDecorations').WallDecoration[];
    if (decorCacheEntry !== undefined && decorCacheEntry.wallDecorations !== null) {
      wallDecorations = decorCacheEntry.wallDecorations;
    } else {
      wallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
      if (decorCacheEntry !== undefined) {
        decorCacheEntry.wallDecorations = wallDecorations;
      }
    }
    ctx.setCachedWallDecorations(wallDecorations);
    for (let di = 0; di < wallDecorations.length; di++) {
      const decoration = wallDecorations[di];
      cachedDecorationCenterX[di] = decoration.worldLeftPx + BLOCK_SIZE_SMALL / 2;
      cachedDecorationCenterY[di] = decoration.worldAnchorYPx;
    }
  }

  resetReusableSnapshot(reusableSnapshot, world);
  captureClusterInterpolationState(world, interpolationBuffers);

  skillTombRenderer.init(room.saveTombs, room.walls);
  skillTombEffectRenderer.init(room.skillTombs);
  const roomSkillTombs = room.skillTombs ?? [];
  for (let i = roomSkillTombs.length - 1; i >= 0; i--) {
    const st = roomSkillTombs[i];
    if (consumedSkillTombKeySet.has(`${room.id}:${st.xBlock}:${st.yBlock}`)) {
      skillTombEffectRenderer.removeTomb(i);
    }
  }

  if (progress && !progress.exploredRoomIds.includes(room.id)) {
    progress.exploredRoomIds.push(room.id);
  }

  snapCamera(camera, spawnXWorld, spawnYWorld, roomWidthWorld, roomHeightWorld, ctx.getVirtualWidthPx(), ctx.getVirtualHeightPx());
  resetCameraEffBoundsForRoom(camState, roomWidthWorld, roomHeightWorld);

  preloadRoomThemeSprites(room);
  void decodeRoomThemeSprites(room);
  decodeRoomBackground(room);

  if (room.blockSeamBlending && room.blockSeamBlending !== 'off') {
    preloadTransitionSprites(['mossy', 'crumbly', 'cracked', 'rooted', 'dusty', 'veined', 'corrupted']);
  }

  ctx.getPreloadScheduleHandle()?.cancel();
  ctx.setPreloadScheduleHandle(scheduleRoomPreloads(
    room,
    ROOM_REGISTRY,
    roomRuntimeCache,
    import.meta.env.DEV,
    isRoomFileCacheActive() ? loadRoomForGameplayAsync : undefined,
    getActiveRoomAdjacency() ?? undefined,
  ));

  ctx.getWarmScheduleHandle()?.cancel();
  ctx.setWarmScheduleHandle(scheduleChunkPrewarms(
    room,
    ROOM_REGISTRY,
    roomRuntimeCache,
    ctx.getGraphicsQuality,
    () => renderProfiler.getLastFrameMs(),
    ctx.getVirtualWidthPx(),
    ctx.getVirtualHeightPx(),
    camera.zoom,
    ctx.getPreTransitionVelocity(),
  ));

  return { particlesRestored, particlesSkipped };
}
