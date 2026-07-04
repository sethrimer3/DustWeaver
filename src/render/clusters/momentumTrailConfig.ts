/**
 * momentumTrailConfig.ts — Tuning constants for the golden momentum-combat trail.
 *
 * The trail activates using the SAME threshold as the sim's momentum-combat
 * invulnerability state (cluster.isHighVelocityAttacking, driven by
 * MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED in sim/momentumCombatConfig.ts) — this
 * file only controls how the trail LOOKS, not when it activates.
 */

import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../../sim/momentumCombatConfig';

/** Re-exported so trail code has one import site for the activation threshold. */
export const MOMENTUM_TRAIL_ACTIVATION_SPEED_WORLD_PER_SEC = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;

/**
 * Speed range (px/s) above the activation threshold over which the trail
 * grows from minimum to maximum length.  Reaching MIN_SPEED + this range
 * maxes out speedFactor at 1.0.
 */
export const MOMENTUM_TRAIL_SPEED_RANGE_WORLD_PER_SEC = 230;

/** Trail length (world px) right at activation speed (speedFactor = 0). */
export const MOMENTUM_TRAIL_MIN_LENGTH_WORLD = 26;

/** Trail length (world px) at/above max speed factor — clamps overall length. */
export const MOMENTUM_TRAIL_MAX_LENGTH_WORLD = 190;

/** How quickly the smoothed trail length grows toward its target (per second, exponential). */
export const MOMENTUM_TRAIL_GROW_RATE_PER_SEC = 7;

/** How quickly the smoothed trail length shrinks toward its target when slowing down. */
export const MOMENTUM_TRAIL_SHRINK_RATE_PER_SEC = 2.6;

/** Seconds for the trail's overall opacity to fade out after dropping below threshold. */
export const MOMENTUM_TRAIL_FADE_OUT_DURATION_SEC = 0.4;

/** Seconds for the trail's overall opacity to fade in when activating. */
export const MOMENTUM_TRAIL_FADE_IN_DURATION_SEC = 0.08;

/** Maximum width (world px) of the trail at the player (head). Tapers to a point at the tail. */
export const MOMENTUM_TRAIL_MAX_HALF_WIDTH_WORLD = 6.5;

/**
 * Number of position samples kept in the trail history ring buffer.
 * Must be large enough that even at moderate grapple speeds the recorded
 * path covers MOMENTUM_TRAIL_MAX_LENGTH_WORLD of arc length (one sample is
 * recorded per render frame).
 */
export const MOMENTUM_TRAIL_HISTORY_CAPACITY = 96;

/** Per-quality segment counts used to build the tapered polygon (fewer on low). */
export const MOMENTUM_TRAIL_SEGMENTS_LOW = 8;
export const MOMENTUM_TRAIL_SEGMENTS_MED = 14;
export const MOMENTUM_TRAIL_SEGMENTS_HIGH = 20;

/** Base peak alpha of the outer glow layer. */
export const MOMENTUM_TRAIL_OUTER_ALPHA = 0.32;
/** Base peak alpha of the mid gold layer. */
export const MOMENTUM_TRAIL_MID_ALPHA = 0.5;
/** Base peak alpha of the bright inner core streak. */
export const MOMENTUM_TRAIL_CORE_ALPHA = 0.85;

/** Warm gold palette. */
export const MOMENTUM_TRAIL_OUTER_COLOR = '255,170,40';
export const MOMENTUM_TRAIL_MID_COLOR = '255,210,80';
export const MOMENTUM_TRAIL_CORE_COLOR = '255,246,200';

/** Shimmer oscillation speed (radians/sec) and amount (0-1 alpha multiplier swing). */
export const MOMENTUM_TRAIL_SHIMMER_SPEED_RAD_PER_SEC = 10;
export const MOMENTUM_TRAIL_SHIMMER_AMOUNT = 0.18;
