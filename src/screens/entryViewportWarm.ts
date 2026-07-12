/**
 * entryViewportWarm.ts — Entry viewport visual warm controller.
 *
 * Warms the first visible area (entry viewport + natural chunk margin) of the
 * current room before the loading overlay releases.  Ensures shaded wall and
 * background tile variants are baked during the loading phase so the player
 * sees fully-shaded tiles immediately on room entry.
 *
 * Key guarantee (BUILD 404): tickEntryWarm() is called ONLY from the dedicated
 * early branch in gameScreen.ts — before processPlayerCommands, sim ticks,
 * camera update, and FP.setFrameGameContext('gameplay').  The frame context is
 * set to 'entryWarm' so freeze-profiler warnings correctly attribute warm work.
 * setBakeForbiddenInGameplay(false) is set explicitly in the branch, so shaded
 * sprites can be baked freely.  Player cannot move or simulate while phase is
 * 'warming'.
 *
 * startTransitionLoad() starts the warm (startEntryWarm) and shows a lightweight
 * textless overlay (loadingOverlay.showEntryWarm()), but does NOT call
 * tickEntryWarm().  Chunk building only happens in the RAF loop's entryWarm branch,
 * never synchronously inside the transition callback.
 *
 * BUILD 404
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  prewarmWallChunksForRoom,
  adoptPrewarmedWallChunks,
  isWallActiveViewportCovered,
  isWallCoreViewportCovered,
  getWallChunkFallbackCounts,
  retryWallGameplayFallbackChunksNow,
} from '../render/walls/blockSpriteRenderer';
import {
  prewarmBgChunksForRoom,
  adoptPrewarmedBgChunks,
  isBgActiveViewportCovered,
  isBgCoreViewportCovered,
  getBgChunkFallbackCounts,
  retryBgGameplayFallbackChunksNow,
} from '../render/walls/backgroundBlockRenderer';
import {
  computeRoomRenderStateKey,
  makeWallPrewarmCtx,
  wallTemplateToSnapshot,
} from '../render/walls/roomRenderState';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import {
  decideEntryWarm,
  type EntryWarmCoverageSnapshot,
  type EntryWarmDecision,
} from './entryWarmDecision';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Soft frame limit. Once reached, the overlay is allowed to release ONLY if
 * the core (no-margin) visible viewport is already covered — see
 * `isEntryCoreViewportCovered()`. It is not, by itself, permission to release
 * while the player would see broken/unshaded wall or background chunks.
 * This is loading-phase only and has no effect on simulation determinism.
 */
const ENTRY_WARM_MAX_FRAMES = 8;

/**
 * Soft wall-clock budget (ms). Same "soft" semantics as ENTRY_WARM_MAX_FRAMES
 * — exceeding it only releases the overlay if the core viewport is covered.
 * Loading-phase only — wall-clock timing is acceptable here because the
 * entry warm runs outside gameplay frames, with no effect on simulation.
 */
const ENTRY_WARM_BUDGET_MS = 120;

/**
 * Absolute wall-clock ceiling (ms). Unlike the soft budget above, this always
 * releases the overlay regardless of core-viewport coverage. It exists purely
 * as a safety net against a pathological room (or runtime data that never
 * becomes ready) hanging room entry forever — reaching it always logs a
 * warning (not DEV-gated) since it means the soft-timeout extension path
 * failed to converge and the player may see incomplete shading.
 */
const ENTRY_WARM_HARD_BUDGET_MS = 2000;

/** Wall + background chunks built per warm step. */
const ENTRY_WARM_CHUNKS_PER_STEP = 6;

// ── Entry-warm diagnostics (window.__dwEntryWarmStats) ────────────────────────

/** Diagnostic snapshot recorded each time a room-entry warm finishes (ready or timed out). */
export interface EntryWarmDiagSnapshot {
  roomId: string;
  finishReason: 'ready' | 'softTimedOut' | 'hardTimedOut';
  wallCoreCovered: boolean;
  bgCoreCovered: boolean;
  wallMarginCovered: boolean;
  bgMarginCovered: boolean;
  fullReady: boolean;
  wallFallback: { hadFallbacksCount: number; gameplayFallbackCount: number };
  bgFallback: { hadFallbacksCount: number; gameplayFallbackCount: number };
  elapsedMs: number;
  frameCount: number;
  hardTimedOut: boolean;
}

let _lastEntryWarmDiag: EntryWarmDiagSnapshot | null = null;

declare global {
  interface Window {
    /**
     * Returns the most recent room-entry warm diagnostic snapshot, or `null`
     * if no room entry has finished warming yet this session.
     *
     * Debug-only — never consulted by gameplay logic. Use this to investigate
     * a "lighting was broken when I entered the room" report: check
     * `finishReason` (did it release via a soft or hard timeout instead of
     * genuine completion?), the coverage booleans, and the fallback counts
     * (were any chunks still sitting on a gameplay-fallback build when the
     * overlay released?).
     */
    __dwEntryWarmStats?: () => EntryWarmDiagSnapshot | null;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__dwEntryWarmStats = () => _lastEntryWarmDiag;
}

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
  /**
   * One-shot guard so the "soft timeout reached before core viewport was
   * shaded; extending warm" DEV warning fires once per room entry rather than
   * every tick while the soft budget stays exceeded.
   */
  warnedSoftTimeoutExtend: boolean;
  /**
   * Wall-clock timestamp (performance.now()) captured in startEntryWarm().
   * Used only for the ENTRY_WARM_HARD_BUDGET_MS safety-net check, which must
   * keep counting real elapsed time even while ticks are being spent waiting
   * on runtime data (that branch does not otherwise advance `msSpent`, which
   * tracks cumulative time spent actually building chunks).
   */
  enteredAtMs: number;
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
    warnedSoftTimeoutExtend: false,
    enteredAtMs: 0,
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
  state.warnedSoftTimeoutExtend = false;
  state.enteredAtMs        = performance.now();

  // Force any chunk left over from a previous gameplay session (or a prior
  // visit to this same room) that was built via the cheap gameplay-fallback
  // path to rebuild with real shading now that baking is allowed again for
  // this warm pass. Without this, such chunks stay stuck showing broken/
  // unshaded lighting until some unrelated render call happens to trigger
  // the passive bake-unlock-generation retry (see RoomChunkCache).
  retryWallGameplayFallbackChunksNow();
  retryBgGameplayFallbackChunksNow();
}

/**
 * Advances the entry warm by one step (one frame budget of chunk building).
 *
 * MUST be called while isBakeForbiddenInGameplay() is false — i.e. from the
 * dedicated 'entryWarm' early branch in gameScreen.ts (before gameplay sim).
 * This guarantees shaded sprites can be baked during the warm pass.
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

  // Guard: pre-build timing check. `fullReady` is always false here — if the
  // entry viewport were already fully covered, a prior tick's post-build
  // check below would have already finished the warm and this function would
  // have returned at the top-of-function phase check. This call exists so a
  // room that never gets a build step (e.g. runtime data never becomes ready)
  // still converges to a soft/hard timeout instead of warming forever.
  const preBuildDecision = decideEntryWarm(_buildDecisionInput(state, room, /* fullReady */ false));
  if (_applyDecision(preBuildDecision, state, room, undefined)) return;

  const entry = runtimeCache.get(room.id);
  if (entry === undefined || entry.blockerKeys === null) {
    // Runtime data not yet ready — defer, counting against frame budget.
    // (The timing checks above will eventually release the overlay via a
    // soft or hard timeout if this never becomes ready.)
    state.framesWarmed++;
    return;
  }

  // Compute the current render-state key for adoption-time validation.
  // Derived from the same canonical mapping used by makeLoadRoomPhases and
  // prewarmWallChunksForRoom (see roomRenderState.ts), ensuring chunks built
  // here are adopted with the correct key and stale chunks are rejected.
  const currentRenderStateKey = computeRoomRenderStateKey(room, entry.blockerKeys);

  const t0 = performance.now();

  const wallSnap = wallTemplateToSnapshot(entry.wallTemplate);
  const wallCtx  = makeWallPrewarmCtx(room, wallSnap, entry.blockerKeys);

  const wallResult = prewarmWallChunksForRoom(
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

  const bgResult = prewarmBgChunksForRoom(
    room,
    state.scalePx,
    state.entryOffsetXPx,
    state.entryOffsetYPx,
    state.vpWPx,
    state.vpHPx,
    ENTRY_WARM_CHUNKS_PER_STEP,
  );

  state.chunksWarmed += wallResult.rebuilt + bgResult.rebuilt;
  state.msSpent      += performance.now() - t0;
  state.framesWarmed++;

  // Viewport is fully covered when neither pass rebuilt nor skipped any chunk.
  // Using both fields rather than rebuilt === 0 alone makes intent explicit.
  // This is the authoritative "nothing left to prewarm" signal — it reads the
  // temporary prewarm caches' just-built progress, which is why it can't be
  // folded into the coverage-snapshot helper (that reads the ACTIVE caches,
  // which haven't been adopted into yet at this point in the tick).
  const fullReady =
    wallResult.rebuilt === 0 && wallResult.skipped === 0 &&
    bgResult.rebuilt   === 0 && bgResult.skipped   === 0;

  const postBuildDecision = decideEntryWarm(_buildDecisionInput(state, room, fullReady));
  _applyDecision(postBuildDecision, state, room, currentRenderStateKey);
}

/**
 * Checks whether the core (no-margin) visible viewport is already covered by
 * the ACTIVE wall and background chunk caches — i.e. what the player would
 * actually see this frame. Exported for diagnostics/tests; `tickEntryWarm`
 * itself goes through `_buildCoverageSnapshot` → `decideEntryWarm` instead of
 * calling this directly.
 */
export function isEntryCoreViewportCovered(state: EntryWarmState, room: RoomDef): boolean {
  const wallCoreCovered = isWallCoreViewportCovered(
    state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx, BLOCK_SIZE_MEDIUM,
  );
  const bgCoreCovered = isBgCoreViewportCovered(
    room, state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx,
  );
  return wallCoreCovered && bgCoreCovered;
}

/**
 * Builds the live coverage snapshot (from the ACTIVE wall/background chunk
 * caches) and packages it with the current timing state into the input shape
 * `decideEntryWarm()` (entryWarmDecision.ts) expects. This is the only place
 * that reads real chunk-cache/DOM state for the decision — the decision logic
 * itself stays pure and unit-testable.
 *
 * @param fullReady  Caller-supplied "nothing left to prewarm this tick"
 *                   signal — see the comment at its call site in
 *                   `tickEntryWarm` for why this can't be derived from the
 *                   margin-coverage booleans computed here.
 */
function _buildDecisionInput(
  state: EntryWarmState,
  room: RoomDef,
  fullReady: boolean,
): import('./entryWarmDecision').EntryWarmDecisionInput {
  const wallCoreCovered = isWallCoreViewportCovered(
    state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx, BLOCK_SIZE_MEDIUM,
  );
  const bgCoreCovered = isBgCoreViewportCovered(
    room, state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx,
  );
  const wallMarginCovered = isWallActiveViewportCovered(
    state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx, BLOCK_SIZE_MEDIUM,
  );
  const bgMarginCovered = isBgActiveViewportCovered(
    room, state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx,
  );
  const coverage: EntryWarmCoverageSnapshot = {
    wallCoreCovered, bgCoreCovered, wallMarginCovered, bgMarginCovered, fullReady,
  };
  return {
    nowMs: performance.now(),
    enteredAtMs: state.enteredAtMs,
    frameCount: state.framesWarmed,
    softMaxFrames: ENTRY_WARM_MAX_FRAMES,
    softBudgetMs: ENTRY_WARM_BUDGET_MS,
    hardBudgetMs: ENTRY_WARM_HARD_BUDGET_MS,
    coverage,
  };
}

/**
 * Applies an `EntryWarmDecision` to `state`: finishes the warm (ready/timed
 * out) or, for `continue`, logs the one-shot "extending warm" DEV warning
 * when a soft/hard timeout would otherwise have applied.
 *
 * @returns `true` when the decision finished the warm (caller should stop
 *          processing this tick), `false` for `continue`.
 */
function _applyDecision(
  decision: EntryWarmDecision,
  state: EntryWarmState,
  room: RoomDef,
  currentRenderStateKey: string | undefined,
): boolean {
  switch (decision.kind) {
    case 'ready':
      _finishWarm(state, room, /* timedOut */ false, false, currentRenderStateKey, undefined);
      return true;
    case 'softTimedOut':
      _finishWarm(state, room, /* timedOut */ true, false, currentRenderStateKey, decision.reason);
      return true;
    case 'hardTimedOut':
      _finishWarm(state, room, /* timedOut */ true, true, currentRenderStateKey, decision.reason);
      return true;
    case 'continue':
      _warnSoftTimeoutExtend(state, room);
      return false;
  }
}

/**
 * One-shot (per room entry) DEV warning that the soft timeout is being
 * extended, i.e. `decideEntryWarm` returned `continue` because core coverage
 * wasn't ready yet even though the soft budget was exceeded. Cheap to call
 * every `continue` tick — it no-ops after the first one via `warnedSoftTimeoutExtend`.
 */
function _warnSoftTimeoutExtend(state: EntryWarmState, room: RoomDef): void {
  if (state.warnedSoftTimeoutExtend) return;
  const elapsedMs = performance.now() - state.enteredAtMs;
  const softExceeded = state.framesWarmed >= ENTRY_WARM_MAX_FRAMES || elapsedMs >= ENTRY_WARM_BUDGET_MS;
  if (!softExceeded) return;
  if (isEntryCoreViewportCovered(state, room)) return; // decideEntryWarm would have finished, not continued
  state.warnedSoftTimeoutExtend = true;
  if (import.meta.env.DEV) {
    console.warn(
      `[entryWarm] soft timeout reached before core viewport was shaded; extending warm for room ${state.roomId}`,
    );
  }
}

/**
 * Cheap read-only probe: returns `true` when the entry viewport is already
 * fully covered by the active chunk caches — including the `CHUNK_MARGIN`
 * safety ring used by `renderVisibleChunks` — and no warm work is needed.
 *
 * Intended to be called from the instant-transition path in startTransitionLoad()
 * AFTER loadRoom() has run (which adopts any pre-warmed chunks).  If this
 * returns `true`, startEntryWarm() and loadingOverlay.showEntryWarm() can be
 * skipped entirely — saving the 80 ms textless overlay for an already-warm room.
 *
 * This function does NOT build any canvases.  It is pure-read and safe to call
 * during a transition callback.
 */
export function canSkipEntryWarm(
  room: RoomDef,
  spawnXBlock: number,
  spawnYBlock: number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): boolean {
  const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
  const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
  const offsetXPx = vpWPx / 2 - spawnXWorld * scalePx;
  const offsetYPx = vpHPx / 2 - spawnYWorld * scalePx;

  const wallCovered = isWallActiveViewportCovered(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, BLOCK_SIZE_MEDIUM);
  const bgCovered   = isBgActiveViewportCovered(room, offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx);
  const result      = wallCovered && bgCovered;

  if (import.meta.env.DEV && !result) {
    // Log once per transition — not per frame.  Distinguishes missing
    // safety-margin chunks from missing core viewport chunks to aid tuning
    // of prewarm radius/budget.
    const wallCoreCovered = isWallCoreViewportCovered(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, BLOCK_SIZE_MEDIUM);
    const bgCoreCovered   = isBgCoreViewportCovered(room, offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx);
    const marginOnly = wallCoreCovered && bgCoreCovered;
    console.log(
      `[canSkipEntryWarm] false — room: ${room.id}, ` +
      (marginOnly
        ? 'reason: missing safety-margin chunks (core covered)'
        : `reason: missing core chunks (wall:${wallCovered ? 'ok' : 'miss'}, bg:${bgCovered ? 'ok' : 'miss'})`),
    );
  }

  return result;
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

/** Finalize the warm: adopt all built chunks (with render-state validation), update phase, log in DEV. */
function _finishWarm(
  state: EntryWarmState,
  room: RoomDef,
  timedOut: boolean,
  hardTimedOut: boolean,
  currentRenderStateKey: string | undefined,
  reason: string | undefined,
): void {
  // Pass the current render-state key so that adoptPrewarmedWallChunks and
  // adoptPrewarmedBgChunks can reject any snapshot whose key does not match
  // (e.g. if a lighting/theme change happened mid-warm).
  adoptPrewarmedWallChunks(room.id, state.scalePx, currentRenderStateKey);
  adoptPrewarmedBgChunks(room, state.scalePx, currentRenderStateKey);

  state.phase              = timedOut ? 'timedOut' : 'ready';
  state.usedFallbackRelease = timedOut;

  // Read coverage/fallback state AFTER adoption above, so this reflects what
  // the player is about to see, not the pre-adoption snapshot. Recorded
  // unconditionally (not DEV-gated) so `window.__dwEntryWarmStats()` and the
  // hard-timeout warning below have real data to work with even in a
  // production build being used to chase down a field report.
  const wallCoreCovered = isWallCoreViewportCovered(
    state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx, BLOCK_SIZE_MEDIUM,
  );
  const bgCoreCovered = isBgCoreViewportCovered(
    room, state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx,
  );
  const wallMarginCovered = isWallActiveViewportCovered(
    state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx, BLOCK_SIZE_MEDIUM,
  );
  const bgMarginCovered = isBgActiveViewportCovered(
    room, state.entryOffsetXPx, state.entryOffsetYPx, state.vpWPx, state.vpHPx, state.scalePx,
  );
  const wallFallback = getWallChunkFallbackCounts();
  const bgFallback   = getBgChunkFallbackCounts();
  const elapsedMs    = performance.now() - state.enteredAtMs;

  _lastEntryWarmDiag = {
    roomId: state.roomId,
    finishReason: hardTimedOut ? 'hardTimedOut' : timedOut ? 'softTimedOut' : 'ready',
    wallCoreCovered,
    bgCoreCovered,
    wallMarginCovered,
    bgMarginCovered,
    fullReady: wallMarginCovered && bgMarginCovered,
    wallFallback,
    bgFallback,
    elapsedMs,
    frameCount: state.framesWarmed,
    hardTimedOut,
  };

  if (import.meta.env.DEV) {
    // This is the log to grep for when a "lighting looks broken on entry"
    // report comes in: it distinguishes whether the core viewport was
    // actually covered when the overlay released, and how many chunks (if
    // any) were still sitting on a hadFallbacksFlag/gameplay-fallback build.
    console.log(
      `[entryWarm] ${state.phase} — room: ${state.roomId}, ` +
      `chunks: ${state.chunksWarmed}, frames: ${state.framesWarmed}, ` +
      `ms: ${state.msSpent.toFixed(1)}${timedOut ? ' (timeout)' : ''}, ` +
      `wallCoreCovered: ${wallCoreCovered}, bgCoreCovered: ${bgCoreCovered}, ` +
      `wallMarginCovered: ${wallMarginCovered}, bgMarginCovered: ${bgMarginCovered}, ` +
      `hadFallbacks: wall=${wallFallback.hadFallbacksCount} bg=${bgFallback.hadFallbacksCount}, ` +
      `gameplayFallback: wall=${wallFallback.gameplayFallbackCount} bg=${bgFallback.gameplayFallbackCount}` +
      (reason !== undefined ? `, reason: ${reason}` : ''),
    );
  }

  // Hard-timeout diagnostics: always logged (not DEV-gated), one-shot per
  // room entry (this function only runs once per warm, since it transitions
  // `state.phase` away from 'warming'). This is the message to search for
  // when a "lighting was broken when I entered the room" report comes in —
  // it has every field needed to tell whether the safety-net actually fired
  // and, if so, exactly what was still incomplete.
  if (hardTimedOut) {
    console.warn(
      `[entryWarm] HARD TIMEOUT — releasing room "${state.roomId}" with incomplete visual readiness. ` +
      `elapsedMs=${elapsedMs.toFixed(1)} frames=${state.framesWarmed} ` +
      `wallCoreCovered=${wallCoreCovered} bgCoreCovered=${bgCoreCovered} ` +
      `wallMarginCovered=${wallMarginCovered} bgMarginCovered=${bgMarginCovered} ` +
      `fullReady=${wallMarginCovered && bgMarginCovered} ` +
      `wallFallback(hadFallbacks=${wallFallback.hadFallbacksCount},gameplayFallback=${wallFallback.gameplayFallbackCount}) ` +
      `bgFallback(hadFallbacks=${bgFallback.hadFallbacksCount},gameplayFallback=${bgFallback.gameplayFallbackCount}) ` +
      `anyGameplayFallbackChunks=${wallFallback.gameplayFallbackCount > 0 || bgFallback.gameplayFallbackCount > 0} ` +
      `anyHadFallbacksChunks=${wallFallback.hadFallbacksCount > 0 || bgFallback.hadFallbacksCount > 0}` +
      (reason !== undefined ? ` reason: ${reason}` : ''),
    );
  }
}

