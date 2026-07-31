/**
 * poisonFieldConfig.ts — Named tuning constants for the Poison Field hazard.
 * Centralised here so no magic numbers are scattered across the exposure
 * controller or the (render-only) cloud renderer.
 */

/** Seconds of continuous vulnerable exposure before the first (and each subsequent) damage tick. */
export const POISON_TICK_INTERVAL_SECONDS = 3.0;

/** Damage dealt per scheduled poison tick and per Verdant-switch-away immediate hit. */
export const POISON_DAMAGE_PER_TICK = 1;
