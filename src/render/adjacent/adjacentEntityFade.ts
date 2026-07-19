/**
 * adjacentEntityFade.ts — Pure, Node-testable controller for the room-transition
 * entity crossfade.
 *
 * When the player crosses a *normal* rendered connection:
 *   - the newly-active room's non-player entity layer fades 0 → 1 quickly
 *     (~180 ms, smooth eased curve),
 *   - the outgoing room's non-player entities fade 1 → 0 over the same interval
 *     at their old room-space position (drawn from a retained read-only
 *     snapshot),
 *   - the player and player-owned visuals never fade,
 *   - terrain never fades during ordinary transitions.
 *
 * Robustness requirements handled here:
 *   - Rapid transitions replace/retire the prior fade without accumulating
 *     snapshots (only one outgoing snapshot is ever retained; the previous one
 *     is handed back through `onRetireSnapshot`).
 *   - A blocking loading/zone overlay clears the stale outgoing ghost and lets
 *     the incoming entities fade in once gameplay becomes visible.
 *   - Timing advances on *gameplay* delta time, so pausing (dt = 0) freezes the
 *     fade instead of advancing it from wall-clock time.
 *
 * The controller is generic over an opaque snapshot handle `S` (the actual
 * read-only render snapshot lives in the render layer); this module only tracks
 * alpha and lifecycle.
 */

/** Default crossfade duration in gameplay milliseconds. */
export const DEFAULT_ENTITY_FADE_MS = 180;

/** Smooth ease-in-out curve for a normalized progress `t` in [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export interface AdjacentEntityFadeOptions<S> {
  /** Crossfade duration in gameplay ms. Defaults to {@link DEFAULT_ENTITY_FADE_MS}. */
  readonly durationMs?: number;
  /**
   * Called with any previously-retained outgoing snapshot when it is replaced or
   * released, so the render layer can free canvases/snapshots and never
   * accumulate. Always called exactly once per retained snapshot.
   */
  readonly onRetireSnapshot?: (snapshot: S) => void;
}

/**
 * Tracks the crossfade for the active-room entity layer and the outgoing ghost.
 * Instance-local; no wall-clock, no globals.
 */
export class AdjacentEntityFadeController<S> {
  private readonly durationMs: number;
  private readonly onRetire: ((snapshot: S) => void) | undefined;

  /** Elapsed gameplay ms since the current crossfade began. */
  private elapsedMs = 0;
  /** True while a crossfade is in progress. */
  private active = false;
  /** Retained read-only snapshot of the outgoing room's entity layer (or null). */
  private outgoing: S | null = null;

  constructor(options: AdjacentEntityFadeOptions<S> = {}) {
    this.durationMs = options.durationMs ?? DEFAULT_ENTITY_FADE_MS;
    this.onRetire = options.onRetireSnapshot;
  }

  /**
   * Begin a crossfade after a normal rendered activation. `outgoingSnapshot` is
   * the read-only render snapshot of the room the player just left (or null when
   * none is available — the incoming layer still fades in). Any prior retained
   * snapshot is retired first so nothing accumulates across rapid transitions.
   */
  beginCrossing(outgoingSnapshot: S | null): void {
    this.retireOutgoing();
    this.outgoing = outgoingSnapshot;
    this.elapsedMs = 0;
    this.active = true;
  }

  /**
   * A blocking loading/zone overlay is covering gameplay. Drop the stale
   * outgoing ghost and restart a clean incoming-only fade so the incoming
   * entities fade in once gameplay becomes visible again (no drifting ghost held
   * across the loading interval).
   */
  clearForBlockingOverlay(): void {
    this.retireOutgoing();
    this.elapsedMs = 0;
    this.active = true;
  }

  /**
   * Advance the crossfade by `gameplayDtMs`. Callers pass gameplay-clock delta
   * (0 while paused), so pausing freezes the fade automatically. Completes and
   * releases the outgoing snapshot once the duration elapses.
   */
  advance(gameplayDtMs: number): void {
    if (!this.active) return;
    if (gameplayDtMs > 0) this.elapsedMs += gameplayDtMs;
    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.active = false;
      this.retireOutgoing();
    }
  }

  /** Normalized eased progress of the incoming entity layer, in [0, 1]. */
  get incomingAlpha(): number {
    if (!this.active && this.outgoing === null) return 1;
    return easeInOutCubic(this.progress());
  }

  /**
   * Alpha for the outgoing entity ghost, in [0, 1]. Zero when no outgoing
   * snapshot is retained (nothing to draw).
   */
  get outgoingAlpha(): number {
    if (this.outgoing === null) return 0;
    return 1 - easeInOutCubic(this.progress());
  }

  /** The retained read-only outgoing snapshot, or null. */
  get outgoingSnapshot(): S | null {
    return this.outgoing;
  }

  /** True while a crossfade is in progress. */
  get isActive(): boolean {
    return this.active;
  }

  /** True once the crossfade has completed (or was never started). */
  get isComplete(): boolean {
    return !this.active;
  }

  /**
   * Hard reset used by non-transition activations (death respawn, save load,
   * editor jumps, teleports, debug warps, campaign start, long/failed
   * transitions). Retires any snapshot and returns to the fully-visible state.
   */
  reset(): void {
    this.retireOutgoing();
    this.elapsedMs = 0;
    this.active = false;
  }

  private progress(): number {
    if (this.durationMs <= 0) return 1;
    return this.elapsedMs / this.durationMs;
  }

  private retireOutgoing(): void {
    if (this.outgoing !== null) {
      if (this.onRetire) this.onRetire(this.outgoing);
      this.outgoing = null;
    }
  }
}
