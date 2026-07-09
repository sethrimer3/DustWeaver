/**
 * entryWarmDecision.ts — Pure entry-warm readiness decision logic.
 *
 * Extracted from entryViewportWarm.ts so the core "should warm finish, keep
 * going, soft-timeout, or hard-timeout" decision is a plain, dependency-free
 * function — unit-testable with plain `node --test` (no DOM, canvas, Vite
 * `import.meta.glob`, or renderer modules required).
 *
 * entryViewportWarm.ts is the only intended caller: it builds the coverage
 * snapshot from the live wall/background chunk caches and timing state each
 * tick, hands it to `decideEntryWarm()`, and applies the returned decision
 * (finish as ready/timedOut, or keep warming). This module knows nothing
 * about chunks, canvases, or rooms — only the four booleans it's given.
 */

export interface EntryWarmCoverageSnapshot {
  /** Core (no safety-margin) wall viewport coverage — what the player is about to see. */
  wallCoreCovered: boolean;
  /** Core (no safety-margin) background viewport coverage. */
  bgCoreCovered: boolean;
  /** Full viewport-plus-safety-margin wall coverage. */
  wallMarginCovered: boolean;
  /** Full viewport-plus-safety-margin background coverage. */
  bgMarginCovered: boolean;
  /**
   * True when there is genuinely no more warm work left to do this tick —
   * i.e. the caller's own build-progress signal (not re-derived here) shows
   * both the wall and background prewarm passes rebuilt and skipped nothing.
   * Set by the caller; not computed from the other four fields, since
   * "margin covered" (a post-adoption active-cache read) and "nothing left to
   * prewarm" (a pre-adoption temp-cache read) are checked against different
   * caches at different points in the warm tick — see entryViewportWarm.ts.
   */
  fullReady: boolean;
}

export interface EntryWarmDecisionInput {
  /** Current wall-clock timestamp (performance.now()). */
  nowMs: number;
  /** Wall-clock timestamp warm started (performance.now() at warm start). */
  enteredAtMs: number;
  /** Warm ticks elapsed so far. */
  frameCount: number;
  /** Soft frame-count budget — see entryViewportWarm.ts ENTRY_WARM_MAX_FRAMES. */
  softMaxFrames: number;
  /** Soft wall-clock budget (ms) — see entryViewportWarm.ts ENTRY_WARM_BUDGET_MS. */
  softBudgetMs: number;
  /** Hard wall-clock ceiling (ms) — see entryViewportWarm.ts ENTRY_WARM_HARD_BUDGET_MS. */
  hardBudgetMs: number;
  coverage: EntryWarmCoverageSnapshot;
}

export type EntryWarmDecision =
  | { kind: 'continue' }
  | { kind: 'ready' }
  | { kind: 'softTimedOut'; reason: string }
  | { kind: 'hardTimedOut'; reason: string };

/**
 * Decides whether entry warm should finish (ready/softTimedOut/hardTimedOut)
 * or keep going (continue), given the current timing state and a coverage
 * snapshot of the wall/background chunk caches.
 *
 * Priority order:
 *   1. `coverage.fullReady` → always `ready`, regardless of timing — there is
 *      no more work to do.
 *   2. Hard budget exceeded → always `hardTimedOut`, regardless of coverage.
 *      This is an unconditional safety net against a pathological room (or
 *      runtime data that never becomes ready) hanging room entry forever.
 *   3. Soft budget (frames or ms) exceeded:
 *        - both wall and background CORE coverage true  → `softTimedOut`
 *          (the safety-margin ring may still be warming, but that's fine —
 *          it isn't visible yet).
 *        - either core coverage false                   → `continue`
 *          (soft limits are not, by themselves, permission to release while
 *          the player would see broken/unshaded chunks).
 *   4. Otherwise → `continue`.
 */
export function decideEntryWarm(input: EntryWarmDecisionInput): EntryWarmDecision {
  const { nowMs, enteredAtMs, frameCount, softMaxFrames, softBudgetMs, hardBudgetMs, coverage } = input;
  const elapsedMs = nowMs - enteredAtMs;

  if (coverage.fullReady) {
    return { kind: 'ready' };
  }

  if (elapsedMs >= hardBudgetMs) {
    return {
      kind: 'hardTimedOut',
      reason:
        `hard timeout (${hardBudgetMs}ms) reached after ${elapsedMs.toFixed(1)}ms / ${frameCount} frames — ` +
        `core wall=${coverage.wallCoreCovered} bg=${coverage.bgCoreCovered}, ` +
        `margin wall=${coverage.wallMarginCovered} bg=${coverage.bgMarginCovered}`,
    };
  }

  const softBudgetExceeded = frameCount >= softMaxFrames || elapsedMs >= softBudgetMs;
  if (softBudgetExceeded) {
    if (coverage.wallCoreCovered && coverage.bgCoreCovered) {
      return {
        kind: 'softTimedOut',
        reason:
          `soft timeout (frames=${frameCount}/${softMaxFrames}, ms=${elapsedMs.toFixed(1)}/${softBudgetMs}) ` +
          'reached with core viewport covered — releasing with the safety-margin ring still warming.',
      };
    }
    return { kind: 'continue' };
  }

  return { kind: 'continue' };
}
