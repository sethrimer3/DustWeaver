/**
 * gameAdaptiveQuality.ts — Adaptive render-quality state machine.
 *
 * Monitors a rolling average frame time (from RenderProfiler) and toggles
 * a quality-reduction mode when the average is persistently over budget.
 * Decoupled from the game loop so it can be reasoned about in isolation.
 *
 * Thresholds:
 *   Over budget  : avg > 33 ms (~30 fps) for 90 consecutive frames (~1.5 s)
 *   Recovery     : avg < 20 ms (~50 fps) for 180 consecutive frames (~3 s)
 */

import type { RenderProfiler } from '../render/hud/renderProfiler';

/** Target budget for one render frame (33 ms ≈ 30 fps minimum). */
const ADAPTIVE_OVER_BUDGET_MS = 33;
/** Recovery threshold: avg frame must drop below this to restore quality. */
const ADAPTIVE_RECOVERY_MS = 20;
/** Consecutive frames over budget before reducing quality. */
const ADAPTIVE_TRIGGER_FRAMES = 90;
/** Consecutive frames under recovery threshold before restoring quality. */
const ADAPTIVE_RECOVERY_FRAMES = 180;

export interface AdaptiveQualityState {
  /** True when persistent frame-time budget overrun has activated quality reduction. */
  isAdaptiveReductionActive: boolean;
  /** @internal Consecutive frames the rolling average has been above the over-budget threshold. */
  _overBudgetStreak: number;
  /** @internal Consecutive frames the rolling average has been below the recovery threshold. */
  _recoveryStreak: number;
}

export function createAdaptiveQualityState(): AdaptiveQualityState {
  return {
    isAdaptiveReductionActive: false,
    _overBudgetStreak: 0,
    _recoveryStreak: 0,
  };
}

/**
 * Reads the profiler's EMA average frame time and advances the streak counters.
 * When persistently over/under budget, toggles adaptive reduction and notifies
 * the profiler so the HUD overlay can show the warning badge.
 *
 * @param state   Mutable adaptive quality state (created by createAdaptiveQualityState).
 * @param profiler RenderProfiler instance whose EMA average is read this frame.
 */
export function updateAdaptiveQuality(
  state: AdaptiveQualityState,
  profiler: RenderProfiler,
): void {
  const avgMs = profiler.getAvgFrameMs();
  if (avgMs <= 0) return;

  if (avgMs > ADAPTIVE_OVER_BUDGET_MS) {
    state._overBudgetStreak++;
    state._recoveryStreak = 0;
  } else if (avgMs < ADAPTIVE_RECOVERY_MS) {
    state._recoveryStreak++;
    state._overBudgetStreak = 0;
  } else {
    // Between thresholds: neither streak accumulates.
    state._overBudgetStreak = 0;
    state._recoveryStreak = 0;
  }

  if (!state.isAdaptiveReductionActive && state._overBudgetStreak >= ADAPTIVE_TRIGGER_FRAMES) {
    state.isAdaptiveReductionActive = true;
    state._overBudgetStreak = 0;
    profiler.setAdaptiveReduction(true);
  } else if (state.isAdaptiveReductionActive && state._recoveryStreak >= ADAPTIVE_RECOVERY_FRAMES) {
    state.isAdaptiveReductionActive = false;
    state._recoveryStreak = 0;
    profiler.setAdaptiveReduction(false);
  }
}
