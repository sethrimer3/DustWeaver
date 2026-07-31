/**
 * poisonFieldConfig.ts — Named tuning constants for the Poison Field hazard.
 * Centralised here so no magic numbers are scattered across the exposure
 * controller or the (render-only) cloud renderer.
 */

/** Seconds of continuous vulnerable exposure before the first (and each subsequent) damage tick. */
export const POISON_TICK_INTERVAL_SECONDS = 3.0;

/** Damage dealt per scheduled poison tick and per Verdant-switch-away immediate hit. */
export const POISON_DAMAGE_PER_TICK = 1;

/**
 * Tiny epsilon subtracted from each 3.0s threshold comparison so repeated
 * floating-point dt accumulation (e.g. 180 additions of 1/60, which does not
 * sum to exactly 3.0 in IEEE 754 double precision) can never delay a
 * scheduled tick by a full extra frame. Far smaller than one tick (~16.6ms
 * at 60fps), so it never lets a hit fire early relative to design intent.
 */
export const POISON_THRESHOLD_EPSILON_SECONDS = 1e-6;
