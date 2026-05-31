/**
 * transitionProfiler.ts — DEV-only per-room-transition profiling aggregator.
 *
 * Captures, for each room transition, a compact structured record:
 *   - target roomId + transition mode (residentWorldHot / instant / async / cross-zone)
 *   - total wall-clock time spent inside startTransitionLoad (and async completion)
 *   - per-phase timings (forwarded from FP.recordLoadPhaseStep + Resident:* phases)
 *   - the longest single phase if any exceeds LONG_PHASE_WARN_MS
 *   - room dimensions, wall count, enemy/object/liquid/blocker counts
 *   - prewarm cache hit/miss summary (wall + bg) + entry-viewport coverage
 *
 * Emits a single compact one-line summary log per transition.  All scattered
 * `[transition] …` console.log lines in gameScreen.ts are suppressed unless
 * `setTransitionVerboseLogging(true)` is called from the dev console.
 *
 * All exports are no-ops when `import.meta.env.DEV` is false so they
 * tree-shake out of production builds.
 *
 * Public dev helpers (attached to `window` only in DEV):
 *   window.__dwTransitionStats(count?)   — dump last N transitions to console
 *   window.__dwLastTransition()          — return the most recent record
 *   window.__dwTransitionVerbose(on)     — toggle the per-phase verbose logs
 *
 * BUILD 428
 */

import { setLoadPhaseHook } from './perfFreezeProfiler';

/** Per-phase log line ms threshold (matches residentWorldBuilder LONG_PHASE_WARN_MS). */
export const LONG_PHASE_WARN_MS = 8;

/** Max number of completed transition records held in memory (ring buffer). */
const HISTORY_CAPACITY = 32;

/** Transition mode taxonomy (mirrors residentRoomManager.lastTransitionMode plus async). */
export type TransitionProfileMode =
  | 'residentWorldHot'
  | 'preparedInstant'
  | 'asyncCacheMiss'
  | 'crossZoneDeferred'
  | 'unknown';

/** Optional room-content counters captured at transition end. */
export interface TransitionProfileRoomCounts {
  widthBlocks:   number;
  heightBlocks:  number;
  wallCount:     number;
  enemyCount:    number;
  objectCount:   number;
  liquidCount:   number;
  lightCount:    number;
  blockerCount:  number;
  bgBlockCount:  number;
}

/** Optional prewarm/cache hit summary captured at transition end. */
export interface TransitionProfilePrewarm {
  wallPresent:           boolean;
  bgPresent:             boolean;
  bgRequired:            boolean;
  renderStateKeyMatches: boolean | null;
  entryViewportCovered:  boolean;
  missReason:            string;
}

/** Completed per-transition record. */
export interface TransitionProfile {
  roomId:           string;
  mode:             TransitionProfileMode;
  totalMs:          number;
  phases:           ReadonlyArray<{ name: string; ms: number }>;
  longestPhase:     { name: string; ms: number } | null;
  exceededLongWarn: boolean;
  residentReady:    boolean;
  counts:           TransitionProfileRoomCounts | null;
  prewarm:          TransitionProfilePrewarm | null;
}

// ── Internal state ────────────────────────────────────────────────────────────

interface ActiveTransition {
  roomId:        string;
  mode:          TransitionProfileMode;
  startMs:       number;
  phases:        { name: string; ms: number }[];
  residentReady: boolean;
}

let _active: ActiveTransition | null = null;
const _history: TransitionProfile[] = [];
let _verbose = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Begin capturing a transition.  Must be paired with `endTransition`.
 * Subsequent calls to `recordPhase` (and `recordLoadPhaseStep` in
 * perfFreezeProfiler.ts) feed the active capture until end.
 */
export function beginTransition(roomId: string, mode: TransitionProfileMode, residentReady: boolean): void {
  if (!import.meta.env.DEV) return;
  _active = {
    roomId,
    mode,
    startMs: performance.now(),
    phases:  [],
    residentReady,
  };
}

/**
 * Record a phase timing into the active transition (if any).  Safe to call
 * when no transition is active — it is then a no-op.
 *
 * Called both directly (from gameScreen.ts for non-phase steps) and indirectly
 * via `perfFreezeProfiler.recordLoadPhaseStep` which forwards to this module.
 */
export function recordPhase(name: string, ms: number): void {
  if (!import.meta.env.DEV) return;
  if (_active === null) return;
  if (ms <= 0) return;
  _active.phases.push({ name, ms });
}

/**
 * Finish the active transition, append it to history, and emit a compact
 * one-line summary log.  Safe to call with `_active === null` — no-op.
 */
export function endTransition(
  counts: TransitionProfileRoomCounts | null,
  prewarm: TransitionProfilePrewarm | null,
): TransitionProfile | null {
  if (!import.meta.env.DEV) return null;
  if (_active === null) return null;

  const totalMs = performance.now() - _active.startMs;
  let longest: { name: string; ms: number } | null = null;
  for (const p of _active.phases) {
    if (longest === null || p.ms > longest.ms) longest = p;
  }
  const exceededLongWarn = longest !== null && longest.ms >= LONG_PHASE_WARN_MS;

  const profile: TransitionProfile = {
    roomId:           _active.roomId,
    mode:             _active.mode,
    totalMs,
    phases:           _active.phases,
    longestPhase:     longest,
    exceededLongWarn,
    residentReady:    _active.residentReady,
    counts,
    prewarm,
  };

  _history.push(profile);
  if (_history.length > HISTORY_CAPACITY) _history.shift();
  _active = null;

  _emitSummary(profile);
  return profile;
}

/** Discard the active transition without recording it (used on early-return guards). */
export function abortTransition(): void {
  if (!import.meta.env.DEV) return;
  _active = null;
}

/** Returns the most recently completed transition record, or null. */
export function getLastTransition(): TransitionProfile | null {
  if (!import.meta.env.DEV) return null;
  return _history.length > 0 ? _history[_history.length - 1] : null;
}

/** Returns the last N transition records (most recent last). */
export function getRecentTransitions(count: number): readonly TransitionProfile[] {
  if (!import.meta.env.DEV) return [];
  if (count <= 0) return [];
  return _history.slice(Math.max(0, _history.length - count));
}

/** Toggle verbose per-step transition console logs. */
export function setTransitionVerboseLogging(on: boolean): void {
  _verbose = on;
}

/** True when verbose per-step logs are enabled. */
export function isTransitionVerboseLogging(): boolean {
  return _verbose;
}

// ── Internal: summary formatter + log ────────────────────────────────────────

function _emitSummary(p: TransitionProfile): void {
  const t = p.totalMs.toFixed(1);
  const longestStr = p.longestPhase !== null ? `${p.longestPhase.name}=${p.longestPhase.ms.toFixed(1)}ms` : 'none';
  const c = p.counts;
  const countsStr = c === null ? '' :
    ` dims=${c.widthBlocks}x${c.heightBlocks}` +
    ` w=${c.wallCount} e=${c.enemyCount} o=${c.objectCount}` +
    ` liq=${c.liquidCount} lit=${c.lightCount} bg=${c.bgBlockCount}`;
  const w = p.prewarm;
  const prewarmStr = w === null ? '' :
    ` prewarm[wall=${w.wallPresent ? 'Y' : 'N'}` +
    ` bg=${w.bgRequired ? (w.bgPresent ? 'Y' : 'N') : '-'}` +
    ` key=${w.renderStateKeyMatches === null ? '?' : (w.renderStateKeyMatches ? 'Y' : 'N')}` +
    ` view=${w.entryViewportCovered ? 'Y' : 'N'}` +
    (w.missReason !== 'none' ? ` miss=${w.missReason}` : '') + ']';
  const warn = p.exceededLongWarn ? ' ⚠' : '';
  const msg =
    `[transition${warn}] ${p.roomId} mode=${p.mode} total=${t}ms` +
    ` longest=${longestStr} phases=${p.phases.length}` +
    ` resReady=${p.residentReady ? 'Y' : 'N'}` +
    countsStr + prewarmStr;
  if (p.exceededLongWarn) {
    console.warn(msg);
  } else {
    console.log(msg);
  }
}

// ── DEV global hooks ──────────────────────────────────────────────────────────

// Register with the perfFreezeProfiler so the existing
// `FP.recordLoadPhaseStep` instrumentation feeds per-transition profiles
// automatically without callers needing to know about both modules.
if (import.meta.env.DEV) {
  setLoadPhaseHook(recordPhase);
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Attach lazily; safe to overwrite if re-imported.
  type DwWindow = Window & {
    __dwTransitionStats?: (count?: number) => readonly TransitionProfile[];
    __dwLastTransition?:  () => TransitionProfile | null;
    __dwTransitionVerbose?: (on: boolean) => void;
  };
  const w = window as DwWindow;
  w.__dwTransitionStats = (count?: number) => {
    const n = count !== undefined ? count : 8;
    const out = getRecentTransitions(n);
    console.table(out.map(p => ({
      room:      p.roomId,
      mode:      p.mode,
      totalMs:   +p.totalMs.toFixed(1),
      longest:   p.longestPhase ? `${p.longestPhase.name}=${p.longestPhase.ms.toFixed(1)}ms` : '-',
      phases:    p.phases.length,
      resReady:  p.residentReady,
      wallCnt:   p.counts?.wallCount ?? null,
      missReason: p.prewarm?.missReason ?? null,
    })));
    return out;
  };
  w.__dwLastTransition  = getLastTransition;
  w.__dwTransitionVerbose = setTransitionVerboseLogging;
}
