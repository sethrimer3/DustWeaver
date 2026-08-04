/**
 * seamlessMetrics.ts — Per-crossing measurement of the properties that decide
 * whether a room boundary *feels* like a transition.
 *
 * The existing transition profiler measures the work a transition does
 * (`totalMs`, phase breakdown, prewarm readiness).  It cannot answer the
 * question this instrumentation exists for: **did the player perceive a loading
 * event?**  That is decided by things the profiler never counted —
 *
 *   - how many RAF frames skipped simulation and input;
 *   - how long a cover was on screen;
 *   - how many entry-warm frames ran;
 *   - whether momentum survived the swap.
 *
 * A crossing is `seamless` only when all four are clean.  Everything here is
 * DEV-only and allocation-light (one small record per crossing, ring-buffered).
 *
 * Console API:
 *   window.__dwSeamlessStats(n?)    — last n crossing records
 *   window.__dwSeamlessSummary(n?)  — aggregate verdict over the last n
 *   window.__dwSeamlessReset()      — clear the buffer
 */

const MAX_RECORDS = 200;

/** One boundary crossing, from trigger to the first unblocked gameplay frame. */
export interface SeamlessCrossingRecord {
  roomId: string;
  sourceRoomId: string;
  /** Transition path taken (`residentWorldHot`, `asyncCacheMiss`, …). */
  mode: string;
  /** Readiness miss reason, or `'none'`. */
  missReason: string;
  /** True when source and target share a worldNumber. */
  intraZone: boolean;
  /** Wall-clock ms from the transition firing to gameplay resuming. */
  interruptionMs: number;
  /** CPU ms spent inside the transition/activation call itself. */
  activationMs: number;
  /** RAF frames that skipped sim + input because of loading work. */
  blockedFrames: number;
  /** RAF frames on which any loading cover was on screen. */
  overlayFrames: number;
  /** Wall-clock ms any cover was on screen. */
  overlayMs: number;
  /** RAF frames spent in the entry-warm phase. */
  entryWarmFrames: number;
  /** Generator phases stepped on the fallback path (0 on the hot path). */
  generatorPhases: number;
  /** Longest single generator phase, ms. */
  longestPhaseMs: number;
  /** Player velocity captured at the trigger. */
  velocityIn: readonly [number, number];
  /** Player velocity observed on the first gameplay frame after the swap. */
  velocityOut: readonly [number, number] | null;
  /** True when velocityOut matches velocityIn (within float tolerance). */
  velocityPreserved: boolean | null;
  /**
   * The headline verdict: zero blocked frames, zero overlay frames, zero
   * entry-warm frames, and preserved momentum.
   */
  seamless: boolean;
}

interface OpenCrossing {
  rec: SeamlessCrossingRecord;
  startedAtMs: number;
  overlayStartedAtMs: number;
}

const _records: SeamlessCrossingRecord[] = [];
let _open: OpenCrossing | null = null;

/** Velocity equality tolerance — physics is float32-ish, so exact fails. */
const VELOCITY_EPSILON = 1e-4;

/** Begins a crossing record.  Safe to call when one is already open (replaces it). */
export function beginCrossing(
  sourceRoomId: string,
  roomId: string,
  mode: string,
  intraZone: boolean,
  vx: number,
  vy: number,
  nowMs: number,
): void {
  _open = {
    startedAtMs: nowMs,
    overlayStartedAtMs: 0,
    rec: {
      roomId, sourceRoomId, mode, intraZone,
      missReason: 'none',
      interruptionMs: 0,
      activationMs: 0,
      blockedFrames: 0,
      overlayFrames: 0,
      overlayMs: 0,
      entryWarmFrames: 0,
      generatorPhases: 0,
      longestPhaseMs: 0,
      velocityIn: [vx, vy],
      velocityOut: null,
      velocityPreserved: null,
      seamless: false,
    },
  };
}

/** Records the synchronous cost of the activation call. */
export function noteActivationMs(ms: number): void {
  if (_open !== null) _open.rec.activationMs = ms;
}

export function noteMissReason(reason: string): void {
  if (_open !== null) _open.rec.missReason = reason;
}

/** Records the transition path actually selected, once it is known. */
export function noteMode(mode: string): void {
  if (_open !== null) _open.rec.mode = mode;
}

/** One RAF frame that skipped simulation and input because of loading work. */
export function noteBlockedFrame(): void {
  if (_open !== null) _open.rec.blockedFrames++;
}

/** One RAF frame spent in the entry-warm phase. */
export function noteEntryWarmFrame(): void {
  if (_open !== null) _open.rec.entryWarmFrames++;
}

/** One RAF frame on which a loading cover was on screen. */
export function noteOverlayFrame(nowMs: number): void {
  if (_open === null) return;
  _open.rec.overlayFrames++;
  if (_open.overlayStartedAtMs === 0) _open.overlayStartedAtMs = nowMs;
  _open.rec.overlayMs = nowMs - _open.overlayStartedAtMs;
}

/** Generator progress on the cold fallback path. */
export function noteGeneratorProgress(phases: number, longestPhaseMs: number): void {
  if (_open === null) return;
  _open.rec.generatorPhases = phases;
  if (longestPhaseMs > _open.rec.longestPhaseMs) _open.rec.longestPhaseMs = longestPhaseMs;
}

/**
 * Closes the open crossing on the first gameplay frame after the swap.
 * `vx`/`vy` are the player's velocity on that frame, used for the
 * momentum-preservation check.
 */
export function endCrossing(vx: number, vy: number, nowMs: number): void {
  if (_open === null) return;
  const rec = _open.rec;
  rec.interruptionMs = nowMs - _open.startedAtMs;
  rec.velocityOut = [vx, vy];
  rec.velocityPreserved =
    Math.abs(vx - rec.velocityIn[0]) < VELOCITY_EPSILON &&
    Math.abs(vy - rec.velocityIn[1]) < VELOCITY_EPSILON;
  rec.seamless =
    rec.blockedFrames === 0 &&
    rec.overlayFrames === 0 &&
    rec.entryWarmFrames === 0 &&
    rec.velocityPreserved === true;

  _records.push(rec);
  if (_records.length > MAX_RECORDS) _records.shift();
  _open = null;
}

/** True while a crossing record is open (i.e. gameplay has not resumed). */
export function isCrossingOpen(): boolean {
  return _open !== null;
}

export function getRecords(count = 20): readonly SeamlessCrossingRecord[] {
  return _records.slice(-count);
}

export function resetRecords(): void {
  _records.length = 0;
  _open = null;
}

/** Aggregate verdict over the last `count` crossings. */
export function summarize(count = 50): Record<string, unknown> {
  const rows = _records.slice(-count);
  if (rows.length === 0) return { crossings: 0 };
  const intra = rows.filter(r => r.intraZone);
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const pick = (rs: SeamlessCrossingRecord[], f: (r: SeamlessCrossingRecord) => number): {
    mean: number; max: number;
  } => ({
    mean: rs.length === 0 ? 0 : +(sum(rs.map(f)) / rs.length).toFixed(2),
    max:  rs.length === 0 ? 0 : +Math.max(...rs.map(f)).toFixed(2),
  });
  const modes: Record<string, number> = {};
  for (const r of rows) modes[r.mode] = (modes[r.mode] ?? 0) + 1;
  const misses: Record<string, number> = {};
  for (const r of rows) if (r.missReason !== 'none') misses[r.missReason] = (misses[r.missReason] ?? 0) + 1;

  return {
    crossings: rows.length,
    intraZoneCrossings: intra.length,
    seamlessIntraZone: `${intra.filter(r => r.seamless).length}/${intra.length}`,
    blockedFrames:   pick(rows, r => r.blockedFrames),
    overlayFrames:   pick(rows, r => r.overlayFrames),
    overlayMs:       pick(rows, r => r.overlayMs),
    entryWarmFrames: pick(rows, r => r.entryWarmFrames),
    interruptionMs:  pick(rows, r => r.interruptionMs),
    activationMs:    pick(rows, r => r.activationMs),
    longestPhaseMs:  pick(rows, r => r.longestPhaseMs),
    velocityPreserved: `${rows.filter(r => r.velocityPreserved === true).length}/${rows.length}`,
    modes,
    missReasons: Object.keys(misses).length > 0 ? misses : 'none',
  };
}

// ── DEV console bindings ──────────────────────────────────────────────────────

declare global {
  interface Window {
    __dwSeamlessStats?:   (count?: number) => readonly SeamlessCrossingRecord[];
    __dwSeamlessSummary?: (count?: number) => Record<string, unknown>;
    __dwSeamlessReset?:   () => void;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__dwSeamlessStats   = (count = 20) => getRecords(count);
  window.__dwSeamlessSummary = (count = 50) => summarize(count);
  window.__dwSeamlessReset   = () => { resetRecords(); };
}
