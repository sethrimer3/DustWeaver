/**
 * roomPreparationCostModel.ts — measured cost of preparing a room, and the
 * deadline arithmetic that decides how a room crossing falls back.
 *
 * ## Why this exists
 *
 * Before this module the transition coordinator's fallback was binary: a
 * destination was either fully resident (seamless hot-swap) or it was not (hard
 * loading cover, gameplay blocked).  There was no notion of *how far* from ready
 * the destination actually was, so a room needing three cheap generator phases
 * paid exactly the same visible cover as a room needing a full cold build.
 *
 * The fix is not a new loader — it is arithmetic.  The resident build generator
 * (`residentWorldBuilder.createResidentBuildGenerator`) already yields a stable,
 * ordered set of phase labels.  If we measure what each label actually costs on
 * *this* machine, we can ask the only question that matters at a boundary:
 *
 *     "can the destination reach ENTRY_READY inside the budget we have?"
 *
 * and grade the fallback on the answer instead of on a boolean.
 *
 * ## What is measured, and by whom
 *
 * `noteMeasuredPhase(label, ms)` is called from the two places that actually
 * step the generator — `ResidentBuildScheduler.advanceFrame` (background
 * builds) and `RoomTransitionLoadCoordinator`'s drain loop.  Both already had
 * the timing in hand; this module only accumulates it.
 *
 * Costs are tracked per *phase label*, not per room.  Per-room history would
 * be mostly cold (a room is typically built once per session), whereas phase
 * cost generalises well across rooms of similar weight and is warm within a few
 * seconds of any zone load — which always builds every room in the zone.
 *
 * ## Bootstrapping is deliberately pessimistic
 *
 * Until a label has been measured it uses `SEED_PHASE_COST_MS`, chosen high
 * enough that an unmeasured build never qualifies for inline completion.  The
 * model therefore *starts* behaving exactly like the pre-existing covered path
 * and only unlocks the seamless inline path once it has real evidence.  Wrong
 * in the safe direction: an unnecessary cover is a cosmetic cost, an inline
 * drain that overruns is a dropped frame.
 *
 * ## Node-safe
 *
 * No DOM, no renderer imports, no module-level side effects beyond the counters
 * themselves.  This is what lets the deadline logic be unit tested under plain
 * `node --test` alongside the coordinator state machine.
 */

// ── Generator phase order ─────────────────────────────────────────────────────

/**
 * The labels `createResidentBuildGenerator` yields, in order.
 *
 * Each label is emitted AFTER the work it names completes, so the label most
 * recently returned by `gen.next()` identifies the last *finished* phase — and
 * everything strictly after it in this list is what remains.  Keep in sync with
 * the `yield` statements in `residentWorldBuilder.ts`.
 *
 * `phaseD_walls_merge` is the one repeating label: the incremental wall-merge
 * pass emits it zero or more times (4 ms budget per slice) before the final
 * `phaseD_walls_build`.  Its repeat count is tracked separately — see
 * `_mergeRepeatsEwma`.
 */
export const RESIDENT_BUILD_PHASE_ORDER: readonly string[] = [
  'phaseA',
  'phaseC',
  'phaseD_fluid',
  'phaseD_chains',
  'phaseD_walls_lookup',
  'phaseD_walls_merge',
  'phaseD_walls_build',
  'phaseE_sim',
  'phaseE_dust',
];

/** Index of the repeating wall-merge label within `RESIDENT_BUILD_PHASE_ORDER`. */
const MERGE_PHASE_INDEX = RESIDENT_BUILD_PHASE_ORDER.indexOf('phaseD_walls_merge');

/**
 * Cost assumed for a phase label with no measurement yet.
 *
 * Strictly above `INLINE_COMPLETION_BUDGET_MS` on purpose: a single unmeasured
 * phase must be enough to disqualify inline completion, so the model cannot
 * gamble on guesses.  See the bootstrapping note in the file header.
 *
 * The value is `residentWorldBuilder`'s own `LONG_PHASE_WARN_MS` — the
 * threshold that module already treats as "this phase is suspiciously long".
 * Assuming an unmeasured phase sits exactly at the warning line is the right
 * kind of pessimism: it is the cost above which the codebase already considers
 * a phase a problem.
 */
export const SEED_PHASE_COST_MS = 8;

/** Smoothing factor for phase-cost EWMA.  Low = stable, slow to chase outliers. */
const PHASE_COST_ALPHA = 0.25;

/** Smoothing factor for the observed wall-merge slice count. */
const MERGE_REPEAT_ALPHA = 0.25;

// ── Frame headroom ────────────────────────────────────────────────────────────

/**
 * Frame cost at or above which background streaming work stops being started.
 *
 * Matches the long-standing `RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS` value so
 * this model is a smoothing layer over the existing policy, not a retune of it.
 */
export const FRAME_BUDGET_HIGH_MS = 10;

/**
 * Frame cost the smoothed signal must fall back below before background work
 * resumes.  The gap between this and `FRAME_BUDGET_HIGH_MS` is the hysteresis
 * band: without it, a frame time oscillating around a single threshold makes
 * streaming stutter on and off every frame, which is worse than either state.
 */
export const FRAME_BUDGET_LOW_MS = 8;

/** Smoothing factor for frame time.  ~10-frame effective window at 60 Hz. */
const FRAME_MS_ALPHA = 0.2;

/**
 * Ceiling, as a multiple of the current average, applied to a frame sample
 * before it is folded into the EWMA.
 *
 * Plain exponential smoothing is not outlier-resistant: at a steady 4 ms, a
 * single 120 ms GC pause drags the average to 27 ms and shuts streaming down
 * even though the machine is fine.  Clamping each sample means one spike can
 * only ever move the average by a bounded step, while a *sustained* regression
 * still ratchets past the threshold within a few frames — responsive to real
 * load, immune to noise.
 */
const FRAME_MS_OUTLIER_CLAMP = 2;

/**
 * Wall-clock ceiling for completing a destination inline on the crossing frame.
 *
 * This is the whole safety story for the seamless fallback path.  Gameplay is
 * NOT covered while this runs, so overrunning it means a visible hitch — the
 * exact thing the covered path exists to prevent.  6 ms leaves the rest of a
 * 16.7 ms frame for the sim and render work that still has to happen on the
 * transition frame, and the drain loop re-checks the clock between every
 * `gen.next()` so a mis-estimated phase costs one overrun, not a freeze.
 */
export const INLINE_COMPLETION_BUDGET_MS = 6;

// ── Fallback causes ───────────────────────────────────────────────────────────

/**
 * Why a crossing was not seamless.
 *
 * Recorded on every non-seamless crossing so missed deadlines can be attributed
 * to a subsystem rather than guessed at.  These are causes, not severities: the
 * visible presentation is decided separately by `decideTransitionFallback`.
 */
export type TransitionFallbackCause =
  /** Crossing was seamless — no fallback occurred. */
  | 'NONE'
  /** Destination runtime build had not finished in time. */
  | 'CPU_BUILD_LATE'
  /** Destination render chunks / entry viewport were not warm in time. */
  | 'GPU_WARMUP_LATE'
  /** Destination sprites or background had not decoded in time. */
  | 'ASSET_IO_LATE'
  /** Destination was resident but its world was dropped or mis-paired. */
  | 'MEMORY_EVICTED'
  /** Destination was never queued for preparation — prediction missed it. */
  | 'UNPREDICTED_DESTINATION'
  /** Zone boundary whose target zone had not been preloaded. */
  | 'CROSS_ZONE'
  /** Cause not classifiable from the available signals. */
  | 'OTHER';

/**
 * Maps the coordinator's existing hot-swap miss reasons onto structured causes.
 *
 * The miss-reason strings predate this module and are load-bearing in
 * diagnostics and tests, so they are translated rather than replaced.
 */
export function classifyFallbackCause(missReason: string): TransitionFallbackCause {
  if (missReason === 'none' || missReason === '') return 'NONE';
  if (missReason === 'residentMissing') return 'UNPREDICTED_DESTINATION';
  if (missReason === 'runtimeNotReady' || missReason === 'buildQueued') return 'CPU_BUILD_LATE';
  if (missReason.startsWith('buildInProgress')) return 'CPU_BUILD_LATE';
  if (missReason === 'worldNull' || missReason === 'roomIdMismatch') return 'MEMORY_EVICTED';
  if (missReason === 'entryViewportNotCovered') return 'GPU_WARMUP_LATE';
  if (missReason === 'spritesNotDecoded' || missReason === 'backgroundNotDecoded') return 'ASSET_IO_LATE';
  if (missReason === 'crossZone') return 'CROSS_ZONE';
  return 'OTHER';
}

// ── Graded fallback decision ──────────────────────────────────────────────────

/**
 * How a crossing whose destination is not yet resident should be presented.
 *
 * `inlineCompletion` is the new grade: finish the destination on the crossing
 * frame and hot-swap without ever showing a cover.  `covered` is the
 * pre-existing behaviour — block gameplay behind the loading overlay while the
 * generator drains across frames.
 */
export type TransitionFallbackGrade = 'inlineCompletion' | 'covered';

export interface FallbackDecisionInput {
  /** Model estimate of the work left before the destination is enterable. */
  estimatedRemainingMs: number;
  /** Wall-clock the inline path is allowed to spend this frame. */
  inlineBudgetMs: number;
  /**
   * Whether a generator for the destination exists (adopted from an in-flight
   * background build, or freshly created).  Without one there is nothing to
   * drain and the covered path is the only option.
   */
  hasGenerator: boolean;
  /**
   * Whether the destination's assets are decoded.  Inline completion cannot
   * wait on I/O — a decode that has not landed will not land inside 6 ms — so
   * an undecoded destination always takes the covered path regardless of how
   * cheap its remaining CPU work looks.
   */
  assetsReady: boolean;
}

export interface FallbackDecision {
  grade: TransitionFallbackGrade;
  /** Why the inline path was rejected, for diagnostics.  Empty when taken. */
  rejectedBecause: string;
}

/**
 * Decide how to present a crossing to a not-yet-resident destination.
 *
 * Pure and total: every rejection carries a reason, so a crossing that fell back
 * can always be explained without a repro.
 */
export function decideTransitionFallback(input: FallbackDecisionInput): FallbackDecision {
  if (!input.hasGenerator) {
    return { grade: 'covered', rejectedBecause: 'noGenerator' };
  }
  if (!input.assetsReady) {
    return { grade: 'covered', rejectedBecause: 'assetsNotReady' };
  }
  if (!(input.inlineBudgetMs > 0)) {
    return { grade: 'covered', rejectedBecause: 'noFrameHeadroom' };
  }
  if (input.estimatedRemainingMs > input.inlineBudgetMs) {
    return {
      grade: 'covered',
      rejectedBecause:
        `estimate ${input.estimatedRemainingMs.toFixed(1)}ms > budget ${input.inlineBudgetMs.toFixed(1)}ms`,
    };
  }
  return { grade: 'inlineCompletion', rejectedBecause: '' };
}

// ── The model ─────────────────────────────────────────────────────────────────

/**
 * Measured preparation costs and the adaptive streaming budget derived from
 * them.
 *
 * One instance per game screen.  Deliberately a class rather than module state
 * so tests can exercise a fresh model without cross-test contamination, and so
 * a screen teardown drops its measurements with it.
 */
export class RoomPreparationCostModel {
  /** EWMA cost per phase label; absent until the label is first measured. */
  private readonly _phaseCostMs = new Map<string, number>();
  /** EWMA of wall-merge slices observed per build.  Seeded pessimistically. */
  private _mergeRepeatsEwma = 4;
  /** Merge slices counted in the build currently being observed. */
  private _mergeRepeatsThisBuild = 0;
  /** EWMA of gameplay frame cost. */
  private _frameMsEwma = 0;
  /** Whether background work is currently permitted (hysteresis state). */
  private _backgroundAllowed = true;
  /** Total phase measurements taken, for diagnostics. */
  private _sampleCount = 0;

  // ── Measurement ─────────────────────────────────────────────────────────────

  /**
   * Record the wall-clock cost of one completed generator phase.
   *
   * `label` is the value `gen.next()` returned — i.e. the phase that just
   * finished, not the one about to run.
   */
  noteMeasuredPhase(label: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this._sampleCount++;
    const prev = this._phaseCostMs.get(label);
    this._phaseCostMs.set(label, prev === undefined ? ms : prev + (ms - prev) * PHASE_COST_ALPHA);
    if (label === 'phaseD_walls_merge') {
      this._mergeRepeatsThisBuild++;
    } else if (label === 'phaseD_walls_build') {
      // The merge run for this build just ended — fold its length into the EWMA
      // and reset.  Rooms with a baked or cached wall template emit zero merge
      // slices, which correctly pulls the average down.
      this._mergeRepeatsEwma +=
        (this._mergeRepeatsThisBuild - this._mergeRepeatsEwma) * MERGE_REPEAT_ALPHA;
      this._mergeRepeatsThisBuild = 0;
    }
  }

  /** Record one gameplay frame's wall-clock cost and update the hysteresis state. */
  noteFrameMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this._frameMsEwma === 0) {
      this._frameMsEwma = ms;
    } else {
      // Clamp before smoothing so a single spike cannot swing the signal —
      // see FRAME_MS_OUTLIER_CLAMP.
      const sample = Math.min(ms, this._frameMsEwma * FRAME_MS_OUTLIER_CLAMP);
      this._frameMsEwma += (sample - this._frameMsEwma) * FRAME_MS_ALPHA;
    }
    // Hysteresis: cross HIGH to disallow, fall below LOW to re-allow.  Between
    // the two thresholds the previous decision stands.
    if (this._backgroundAllowed) {
      if (this._frameMsEwma >= FRAME_BUDGET_HIGH_MS) this._backgroundAllowed = false;
    } else if (this._frameMsEwma < FRAME_BUDGET_LOW_MS) {
      this._backgroundAllowed = true;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  /** Smoothed gameplay frame cost (ms).  Zero before the first sample. */
  smoothedFrameMs(): number {
    return this._frameMsEwma;
  }

  /**
   * Whether speculative background preparation may run this frame.
   *
   * Hysteretic — see `noteFrameMs`.  Callers that must never starve (urgent
   * priority-1/2 builds) intentionally ignore this.
   */
  isBackgroundWorkAllowed(): boolean {
    return this._backgroundAllowed;
  }

  /**
   * Wall-clock the inline completion path may spend on the crossing frame.
   *
   * Scales down with measured frame pressure and reaches zero once the frame is
   * already at budget: on a machine that cannot afford the extra milliseconds,
   * the covered fallback is the correct answer and this returns 0 to force it.
   */
  inlineCompletionBudgetMs(): number {
    const headroom = FRAME_BUDGET_HIGH_MS - this._frameMsEwma;
    if (headroom <= 0) return 0;
    return Math.min(INLINE_COMPLETION_BUDGET_MS, headroom);
  }

  /** EWMA cost of one phase label, or the pessimistic seed if never measured. */
  phaseCostMs(label: string): number {
    return this._phaseCostMs.get(label) ?? SEED_PHASE_COST_MS;
  }

  /**
   * Estimated wall-clock remaining for a build whose last completed phase was
   * `lastCompletedPhase`.
   *
   * Pass `null` (or any unrecognised label, e.g. the scheduler's `'starting'`)
   * for a build that has not yielded yet — the estimate then covers the whole
   * generator.
   */
  estimateRemainingMs(lastCompletedPhase: string | null): number {
    const idx = lastCompletedPhase === null
      ? -1
      : RESIDENT_BUILD_PHASE_ORDER.indexOf(lastCompletedPhase);
    let total = 0;
    for (let i = idx + 1; i < RESIDENT_BUILD_PHASE_ORDER.length; i++) {
      const label = RESIDENT_BUILD_PHASE_ORDER[i];
      const cost = this.phaseCostMs(label);
      if (i === MERGE_PHASE_INDEX) {
        // The merge label repeats; price the whole remaining run.  When the
        // build is already inside the merge run we cannot know how many slices
        // are left, so the full expected run is charged — pessimistic, which is
        // the safe direction for an inline-completion decision.
        total += cost * Math.max(0, this._mergeRepeatsEwma);
      } else {
        total += cost;
      }
    }
    return total;
  }

  /** Diagnostic snapshot for the developer overlay and structured logging. */
  snapshot(): {
    sampleCount: number;
    smoothedFrameMs: number;
    backgroundAllowed: boolean;
    inlineBudgetMs: number;
    mergeRepeats: number;
    phaseCostMs: Record<string, number>;
  } {
    const phaseCostMs: Record<string, number> = {};
    for (const label of RESIDENT_BUILD_PHASE_ORDER) {
      phaseCostMs[label] = +this.phaseCostMs(label).toFixed(3);
    }
    return {
      sampleCount:       this._sampleCount,
      smoothedFrameMs:   +this._frameMsEwma.toFixed(3),
      backgroundAllowed: this._backgroundAllowed,
      inlineBudgetMs:    +this.inlineCompletionBudgetMs().toFixed(3),
      mergeRepeats:      +this._mergeRepeatsEwma.toFixed(2),
      phaseCostMs,
    };
  }

  /** Drop all measurements.  Called on game-screen teardown. */
  reset(): void {
    this._phaseCostMs.clear();
    this._mergeRepeatsEwma = 4;
    this._mergeRepeatsThisBuild = 0;
    this._frameMsEwma = 0;
    this._backgroundAllowed = true;
    this._sampleCount = 0;
  }
}
