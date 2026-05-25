/**
 * entryViewportWarm.ts — Entry viewport visual warm controller.
 *
 * Warms the first visible area (entry viewport + natural chunk margin) of the
 * current room before the loading overlay releases.  Ensures shaded wall and
 * background tile variants are baked during the loading phase so the player
 * sees fully-shaded tiles immediately on room entry.
 *
 * Key guarantee: all warm work runs while isBakeForbiddenInGameplay() is false
 * (i.e. before setBakeForbiddenInGameplay(true) is called for that gameplay
 * frame).  The loading overlay is held until the warm completes or a
 * conservative timeout is reached.
 *
 * BUILD 402
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { WallSnapshot } from '../render/snapshotTypes';
import type { WallPrewarmContext } from '../render/walls/blockSpriteRenderer';
import {
  prewarmWallChunksForRoom,
  adoptPrewarmedWallChunks,
} from '../render/walls/blockSpriteRenderer';
import {
  prewarmBgChunksForRoom,
  adoptPrewarmedBgChunks,
} from '../render/walls/backgroundBlockRenderer';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import {
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
  DEFAULT_BACKGROUND_LIGHT_SPILL,
  DEFAULT_SOLID_LIGHT_SOFTNESS,
} from '../render/walls/ambientLightDepths';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum frames before the entry warm releases the overlay regardless.
 * 8 frames ≈ 133 ms at 60 fps — enough for two or three prewarm steps on
 * most rooms without producing a noticeable loading delay.
 */
const ENTRY_WARM_MAX_FRAMES = 8;

/** Hard wall-clock budget (ms).  Releases overlay if exceeded. */
const ENTRY_WARM_BUDGET_MS = 120;

/** Wall + background chunks built per warm step. */
const ENTRY_WARM_CHUNKS_PER_STEP = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntryWarmPhase = 'idle' | 'warming' | 'ready' | 'timedOut';

export interface EntryWarmState {
  phase: EntryWarmPhase;
  /** Warm steps (frames) elapsed since startEntryWarm(). */
  framesWarmed: number;
  /** Cumulative ms spent in warm steps. */
  msSpent: number;
  /** Total chunks built across all steps. */
  chunksWarmed: number;
  /** True when the overlay was released due to timeout instead of completion. */
  usedFallbackRelease: boolean;
  // Viewport parameters captured at warm start
  entryOffsetXPx: number;
  entryOffsetYPx: number;
  vpWPx: number;
  vpHPx: number;
  scalePx: number;
  /** Room ID this state applies to (used for logging). */
  roomId: string;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createEntryWarmState(): EntryWarmState {
  return {
    phase: 'idle',
    framesWarmed: 0,
    msSpent: 0,
    chunksWarmed: 0,
    usedFallbackRelease: false,
    entryOffsetXPx: 0,
    entryOffsetYPx: 0,
    vpWPx: 480,
    vpHPx: 270,
    scalePx: 1,
    roomId: '',
  };
}

/**
 * Starts (or resets) the entry warm for a newly loaded room.
 *
 * Call after loadRoom() completes (initial load, instant transition, or async
 * load generator done) and BEFORE the first gameplay frame.
 *
 * @param spawnXBlock  Player spawn column in block units.
 * @param spawnYBlock  Player spawn row in block units.
 * @param vpWPx        Virtual viewport width (virtualWidthPx).
 * @param vpHPx        Virtual viewport height (virtualHeightPx).
 * @param scalePx      Camera zoom factor (camera.zoom).
 */
export function startEntryWarm(
  state: EntryWarmState,
  room: RoomDef,
  spawnXBlock: number,
  spawnYBlock: number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): void {
  const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
  const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
  state.phase              = 'warming';
  state.framesWarmed       = 0;
  state.msSpent            = 0;
  state.chunksWarmed       = 0;
  state.usedFallbackRelease = false;
  state.entryOffsetXPx     = vpWPx / 2 - spawnXWorld * scalePx;
  state.entryOffsetYPx     = vpHPx / 2 - spawnYWorld * scalePx;
  state.vpWPx              = vpWPx;
  state.vpHPx              = vpHPx;
  state.scalePx            = scalePx;
  state.roomId             = room.id;
}

/**
 * Advances the entry warm by one step (one frame budget of chunk building).
 *
 * MUST be called while isBakeForbiddenInGameplay() is false — i.e. before the
 * `setBakeForbiddenInGameplay(true)` call at the top of the gameplay render
 * path.  This guarantees shaded sprites can be baked during the warm pass.
 *
 * Transitions to 'ready' when the entry viewport is fully covered, or to
 * 'timedOut' when the frame/ms budget is exhausted.
 */
export function tickEntryWarm(
  state: EntryWarmState,
  room: RoomDef,
  runtimeCache: RoomRuntimeCache,
): void {
  if (state.phase !== 'warming') return;

  // Guard: max-frame timeout
  if (state.framesWarmed >= ENTRY_WARM_MAX_FRAMES || state.msSpent >= ENTRY_WARM_BUDGET_MS) {
    _finishWarm(state, room, /* timedOut */ true);
    return;
  }

  const entry = runtimeCache.get(room.id);
  if (entry === undefined || entry.blockerKeys === null) {
    // Runtime data not yet ready — defer, counting against frame budget.
    state.framesWarmed++;
    if (state.framesWarmed >= ENTRY_WARM_MAX_FRAMES) {
      _finishWarm(state, room, /* timedOut */ true);
    }
    return;
  }

  const t0 = performance.now();

  const wallSnap = _wallTemplateToSnapshot(entry.wallTemplate);
  const wallCtx  = _makeWallPrewarmCtx(room, wallSnap, entry.blockerKeys);

  const wallBuilt = prewarmWallChunksForRoom(
    room.id,
    wallCtx,
    state.entryOffsetXPx,
    state.entryOffsetYPx,
    state.vpWPx,
    state.vpHPx,
    state.scalePx,
    BLOCK_SIZE_MEDIUM,
    ENTRY_WARM_CHUNKS_PER_STEP,
  );

  const bgBuilt = prewarmBgChunksForRoom(
    room,
    state.scalePx,
    state.entryOffsetXPx,
    state.entryOffsetYPx,
    state.vpWPx,
    state.vpHPx,
    ENTRY_WARM_CHUNKS_PER_STEP,
  );

  state.chunksWarmed += wallBuilt + bgBuilt;
  state.msSpent      += performance.now() - t0;
  state.framesWarmed++;

  // When both sources returned 0 new chunks the viewport is fully covered.
  if (wallBuilt === 0 && bgBuilt === 0) {
    _finishWarm(state, room, /* timedOut */ false);
    return;
  }

  // Check budget after this step.
  if (state.msSpent >= ENTRY_WARM_BUDGET_MS || state.framesWarmed >= ENTRY_WARM_MAX_FRAMES) {
    _finishWarm(state, room, /* timedOut */ true);
  }
}

/**
 * Returns true when the loading overlay may be released.
 *
 * Always true for 'idle' (no warm started), 'ready', or 'timedOut'.
 * Returns false while the warm is still in progress ('warming').
 */
export function isEntryWarmReadyOrTimedOut(state: EntryWarmState): boolean {
  return state.phase !== 'warming';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Finalise the warm: adopt all built chunks, update phase, log in DEV. */
function _finishWarm(state: EntryWarmState, room: RoomDef, timedOut: boolean): void {
  adoptPrewarmedWallChunks(room.id, state.scalePx);
  adoptPrewarmedBgChunks(room, state.scalePx);

  state.phase              = timedOut ? 'timedOut' : 'ready';
  state.usedFallbackRelease = timedOut;

  if (import.meta.env.DEV) {
    console.log(
      `[entryWarm] ${state.phase} — room: ${state.roomId}, ` +
      `chunks: ${state.chunksWarmed}, frames: ${state.framesWarmed}, ` +
      `ms: ${state.msSpent.toFixed(1)}${timedOut ? ' (timeout)' : ''}`,
    );
  }
}

/**
 * Wraps a RoomWallTemplate as a WallSnapshot (zero-copy — shares typed arrays).
 */
function _wallTemplateToSnapshot(t: {
  readonly wallCount:            number;
  readonly xWorld:               Float32Array;
  readonly yWorld:               Float32Array;
  readonly wWorld:               Float32Array;
  readonly hWorld:               Float32Array;
  readonly isPlatformFlag:       Uint8Array;
  readonly platformEdge:         Uint8Array;
  readonly themeIndex:           Uint8Array;
  readonly isInvisibleFlag:      Uint8Array;
  readonly rampOrientationIndex: Uint8Array;
  readonly isPillarHalfWidthFlag: Uint8Array;
}): WallSnapshot {
  return {
    count:                 t.wallCount,
    xWorld:                t.xWorld,
    yWorld:                t.yWorld,
    wWorld:                t.wWorld,
    hWorld:                t.hWorld,
    isPlatformFlag:        t.isPlatformFlag,
    platformEdge:          t.platformEdge,
    themeIndex:            t.themeIndex,
    isInvisibleFlag:       t.isInvisibleFlag,
    rampOrientationIndex:  t.rampOrientationIndex,
    isPillarHalfWidthFlag: t.isPillarHalfWidthFlag,
  };
}

/**
 * Builds a WallPrewarmContext from a room def and pre-computed runtime data.
 * Mirrors the private `_makeWallPrewarmCtx` in roomRenderChunkWarmScheduler.ts.
 */
function _makeWallPrewarmCtx(
  room: RoomDef,
  wallSnapshot: WallSnapshot,
  blockerKeys: Set<string> | undefined,
): WallPrewarmContext {
  return {
    wallSnapshot,
    worldNumber:          room.worldNumber ?? 1,
    blockTheme:           room.blockTheme ?? null,
    lightingEffect:       room.lightingEffect ?? 'Ambient',
    ambientDirection:     room.ambientLightDirection ?? 'omni',
    roomWidthBlocks:      room.widthBlocks,
    roomHeightBlocks:     room.heightBlocks,
    blockerKeys:          blockerKeys ?? new Set<string>(),
    directionalBias:      room.directionalBias      ?? DEFAULT_DIRECTIONAL_BIAS,
    sideExposureStrength: room.sideExposureStrength  ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
    minimumWallLight:     room.minimumWallLight      ?? DEFAULT_MINIMUM_WALL_LIGHT,
    falloffPower:         room.falloffPower          ?? DEFAULT_FALLOFF_POWER,
    backgroundLightSpill: room.backgroundLightSpill  ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
    solidLightSoftness:   room.solidLightSoftness    ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
    seamBlending:         room.blockSeamBlending     ?? 'off',
  };
}
