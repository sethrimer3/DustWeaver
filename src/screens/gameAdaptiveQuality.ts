/**
 * gameAdaptiveQuality.ts — Adaptive render-quality state machine.
 *
 * Monitors a rolling average frame time (from RenderProfiler) and toggles
 * quality-reduction tiers when the average is persistently over budget.
 * Decoupled from the game loop so it can be reasoned about in isolation.
 *
 * Tier 1 (existing):
 *   Over budget  : avg > 33 ms (~30 fps) for 90 consecutive frames (~1.5 s)
 *   Recovery     : avg < 20 ms (~50 fps) for 180 consecutive frames (~3 s)
 *   Effect       : halve dust/light/bloom caps.
 *
 * Tier 2 (BUILD 288):
 *   Over budget  : avg > 50 ms (~20 fps) for 60 consecutive frames (~1 s)
 *                  while tier-1 is already active.
 *   Recovery     : avg < 30 ms (~33 fps) for 240 consecutive frames (~4 s)
 *                  while tier-1 is still active.
 *   Effect       : also disables sunbeam rendering and bloom.
 */

import type { RenderProfiler } from '../render/hud/renderProfiler';

/** Target budget for one render frame (33 ms ≈ 30 fps minimum). */
const ADAPTIVE_OVER_BUDGET_MS = 33;
/** Recovery threshold: avg frame must drop below this to restore tier-1. */
const ADAPTIVE_RECOVERY_MS = 20;
/** Consecutive frames over budget before activating tier-1. */
const ADAPTIVE_TRIGGER_FRAMES = 90;
/** Consecutive frames under recovery threshold before restoring tier-1. */
const ADAPTIVE_RECOVERY_FRAMES = 180;

/** Tier-2 threshold: severe overrun while tier-1 is already active. */
const ADAPTIVE_DEEP_BUDGET_MS = 50;
/** Consecutive frames over tier-2 threshold before activating tier-2. */
const ADAPTIVE_DEEP_TRIGGER_FRAMES = 60;
/** Recovery threshold for tier-2 → tier-1. */
const ADAPTIVE_DEEP_RECOVERY_MS = 30;
/** Consecutive frames under tier-2 recovery threshold before reverting to tier-1. */
const ADAPTIVE_DEEP_RECOVERY_FRAMES = 240;

export interface AdaptiveQualityState {
  /** True when persistent frame-time overrun has activated quality reduction (tier 1). */
  isAdaptiveReductionActive: boolean;
  /**
   * True when an even more severe frame-time overrun has activated deep reduction (tier 2).
   * Only active while `isAdaptiveReductionActive` is also true.
   * Tier 2 additionally disables sunbeam rendering and bloom.
   */
  isDeepReductionActive: boolean;
  /** @internal Consecutive frames the rolling average has been above the over-budget threshold. */
  _overBudgetStreak: number;
  /** @internal Consecutive frames the rolling average has been below the recovery threshold. */
  _recoveryStreak: number;
  /** @internal Consecutive frames over the tier-2 threshold (while tier-1 is active). */
  _deepBudgetStreak: number;
  /** @internal Consecutive frames under the tier-2 recovery threshold. */
  _deepRecoveryStreak: number;
}

export function createAdaptiveQualityState(): AdaptiveQualityState {
  return {
    isAdaptiveReductionActive: false,
    isDeepReductionActive:     false,
    _overBudgetStreak:         0,
    _recoveryStreak:           0,
    _deepBudgetStreak:         0,
    _deepRecoveryStreak:       0,
  };
}

/**
 * Reads the profiler's EMA average frame time and advances the streak counters.
 * When persistently over/under budget, toggles adaptive reduction tiers and
 * notifies the profiler so the HUD overlay can show the appropriate badge.
 */
export function updateAdaptiveQuality(
  state: AdaptiveQualityState,
  profiler: RenderProfiler,
): void {
  const avgMs = profiler.getAvgFrameMs();
  if (avgMs <= 0) return;

  // ── Tier-1 logic (unchanged from BUILD 280) ──────────────────────────────
  if (avgMs > ADAPTIVE_OVER_BUDGET_MS) {
    state._overBudgetStreak++;
    state._recoveryStreak = 0;
  } else if (avgMs < ADAPTIVE_RECOVERY_MS) {
    state._recoveryStreak++;
    state._overBudgetStreak = 0;
  } else {
    state._overBudgetStreak = 0;
    state._recoveryStreak   = 0;
  }

  if (!state.isAdaptiveReductionActive && state._overBudgetStreak >= ADAPTIVE_TRIGGER_FRAMES) {
    state.isAdaptiveReductionActive = true;
    state._overBudgetStreak         = 0;
  } else if (state.isAdaptiveReductionActive && state._recoveryStreak >= ADAPTIVE_RECOVERY_FRAMES) {
    state.isAdaptiveReductionActive = false;
    state.isDeepReductionActive     = false;  // tier-2 clears when tier-1 clears
    state._recoveryStreak           = 0;
    state._deepBudgetStreak         = 0;
    state._deepRecoveryStreak       = 0;
  }

  // ── Tier-2 logic: only while tier-1 is active ────────────────────────────
  if (state.isAdaptiveReductionActive) {
    if (avgMs > ADAPTIVE_DEEP_BUDGET_MS) {
      state._deepBudgetStreak++;
      state._deepRecoveryStreak = 0;
    } else if (avgMs < ADAPTIVE_DEEP_RECOVERY_MS) {
      state._deepRecoveryStreak++;
      state._deepBudgetStreak = 0;
    } else {
      state._deepBudgetStreak   = 0;
      state._deepRecoveryStreak = 0;
    }

    if (!state.isDeepReductionActive && state._deepBudgetStreak >= ADAPTIVE_DEEP_TRIGGER_FRAMES) {
      state.isDeepReductionActive = true;
      state._deepBudgetStreak     = 0;
    } else if (state.isDeepReductionActive && state._deepRecoveryStreak >= ADAPTIVE_DEEP_RECOVERY_FRAMES) {
      state.isDeepReductionActive = false;
      state._deepRecoveryStreak   = 0;
    }
  } else {
    // Tier-1 not active → ensure tier-2 is also clear.
    state.isDeepReductionActive = false;
    state._deepBudgetStreak     = 0;
    state._deepRecoveryStreak   = 0;
  }

  // ── Notify profiler ───────────────────────────────────────────────────────
  const tier: 0 | 1 | 2 = state.isDeepReductionActive ? 2
    : state.isAdaptiveReductionActive ? 1 : 0;
  profiler.setAdaptiveReduction(tier > 0);
  profiler.setAdaptiveReductionTier(tier);
}
