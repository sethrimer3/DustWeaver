/**
 * Tunable numeric constants for cluster movement physics.
 *
 * Extracted from movement.ts so the main movement module stays focused on logic.
 * Every constant here was previously a module-private `const` (or exported symbol)
 * inside movement.ts — names, values, and doc-comments are preserved verbatim.
 */

// ============================================================================
// Debug overrides — mutable values that can be live-tuned from the debug panel.
// When a value is NaN, the default constant is used. When set to a finite
// number, it overrides the constant for playtesting.
// ============================================================================

export const debugSpeedOverrides = {
  walkSpeedWorld: NaN,
  jumpSpeedWorld: NaN,
  gravityWorld: NaN,
  normalFallCapWorld: NaN,
  fastFallCapWorld: NaN,
  sprintMultiplier: NaN,
  groundAccelWorld: NaN,
  groundDecelWorld: NaN,
  airAccelWorld: NaN,
  airDecelWorld: NaN,
  wallJumpXWorld: NaN,
  wallJumpYWorld: NaN,
};

/** Helper: return override if finite, else fallback. */
export function ov(override: number, fallback: number): number {
  return Number.isFinite(override) ? override : fallback;
}

// ============================================================================
// Jump physics — Celeste-inspired tuning
// ============================================================================

/**
 * Unified normal gravity (px/s²).  Used for both rise and fall in the base
 * case.  Rise / fall asymmetry is achieved through jump-cut and apex modifiers,
 * not separate base gravities.
 *
 * Increased by 50% from original 600.0 for faster, snappier feel.
 */
export const NORMAL_GRAVITY_WORLD_PER_SEC2 = 900.0;

/**
 * Initial upward jump velocity (positive value; negated when applied).
 * Chosen to pair with NORMAL_GRAVITY for a clean Celeste-like arc.
 *
 * Tuned to target roughly 6 medium blocks of jump height.
 */
export const PLAYER_JUMP_SPEED_WORLD = 255.0;

/**
 * Jump-cut gravity multiplier.
 * While the player is still rising (velocityY < 0) and the jump key is NOT
 * held, gravity is scaled by this factor — producing a shorter hop on early
 * release without any abrupt velocity clamp.
 */
export const JUMP_CUT_GRAVITY_MULTIPLIER = 2.5;

// ── Variable jump sustain (Celeste-style) ────────────────────────────────────
// While the sustain timer is active AND jump is held, vertical velocity is
// prevented from decaying past the initial launch speed.  This creates a real,
// expressive difference between short hops and full jumps.

/** Duration of the variable-jump sustain window (seconds). */
export const VAR_JUMP_TIME_SEC = 0.20;
/** Variable jump sustain window in ticks (60 fps). */
export const VAR_JUMP_TIME_TICKS = Math.round(VAR_JUMP_TIME_SEC * 60.0);

// ── Apex half-gravity ────────────────────────────────────────────────────────
// Near the top of the jump arc, gravity is halved for a brief "floaty apex"
// feel — only when vertical speed is near zero and jump is held.

/** Gravity multiplier applied at the apex of a jump. */
export const APEX_GRAVITY_MULTIPLIER = 0.5;

/**
 * Vertical speed threshold (px/s) below which the apex gravity kicks in.
 * Only active when abs(vy) < this value and jump is held.
 */
export const APEX_THRESHOLD_WORLD_PER_SEC = 33.0;

// ── Fall system (normal fall + fast fall) ────────────────────────────────────
// By default gravity approaches normalMaxFall.  If the player holds down
// while falling, the cap smoothly approaches fastMaxFall.

/** Default maximum downward fall speed (px/s). Increased by 50% from 107.0. */
export const NORMAL_MAX_FALL_WORLD_PER_SEC = 160.5;

/** Maximum downward fall speed when holding down (px/s). Increased by 50% from 160.0. */
export const FAST_MAX_FALL_WORLD_PER_SEC = 240.0;

/**
 * Rate at which the current fall cap approaches fastMaxFall when holding
 * down (px/s per second — a speed-of-approach value, not acceleration).
 * Increased by 50% from 200.0.
 */
export const FAST_MAX_FALL_APPROACH_PER_SEC = 300.0;

// ============================================================================
// Coyote time & jump buffer
// ============================================================================

/**
 * Ticks after leaving a grounded surface during which a jump is still allowed
 * (coyote time).  At 60 fps, 6 ticks ≈ 0.10 s.
 */
export const COYOTE_TIME_TICKS = 6;

/**
 * Ticks a jump input is remembered while airborne (jump buffer).
 * When the player lands while bufferTicks > 0 the jump fires immediately.
 * At 60 fps, 6 ticks ≈ 0.10 s.
 */
export const JUMP_BUFFER_TICKS = 6;

// ============================================================================
// Horizontal movement
// ============================================================================

/** Maximum horizontal run speed (px/s). Increased by 50% from 70.0. */
export const MAX_RUN_SPEED_WORLD_PER_SEC = 105.0;

/** Ground acceleration: how quickly the player builds up speed on the ground (px/s²). */
export const GROUND_ACCELERATION_PER_SEC2 = 800.0;

/** Ground deceleration: how quickly the player stops on the ground when no input (px/s²). */
export const GROUND_DECELERATION_PER_SEC2 = 1000.0;

/** Air acceleration: slightly reduced control while airborne (px/s²). */
export const AIR_ACCELERATION_PER_SEC2 = 520.0;

/** Air deceleration: gentle slowdown while airborne with no input (px/s²). */
export const AIR_DECELERATION_PER_SEC2 = 600.0;

/**
 * Turn acceleration: applied when reversing horizontal direction (px/s²).
 * Higher than ground acceleration so direction changes feel crisp and snappy.
 */
export const TURN_ACCELERATION_PER_SEC2 = 1466.7;

// ============================================================================
// Wall slide
// ============================================================================

/**
 * Maximum downward speed while wall-sliding (px/s).
 * Slow enough for deliberate, readable wall interaction (Celeste-like).
 * Only active when the player is pushing toward the wall and the
 * wall-jump lockout is not running.
 */
export const WALL_SLIDE_MAX_FALL_SPEED = 17.0;

// ============================================================================
// Wall jump
// ============================================================================

/**
 * Horizontal launch speed away from the wall on a wall jump (px/s).
 * Strong outward push prevents rapid same-wall climbing.
 */
export const WALL_JUMP_X_SPEED_WORLD = 147.0;

/**
 * Vertical launch speed on a wall jump (px/s, applied upward).
 * Reduced from full ground-jump speed — paired with the strong horizontal
 * push to prevent net altitude gain on same-wall wall-jump chains.
 */
export const WALL_JUMP_Y_SPEED_WORLD = 147.0;

/**
 * Ticks after a wall jump during which horizontal input is overridden by
 * the outward launch direction (force-time window).
 * This prevents the player from immediately steering back to the wall.
 * At 60 fps, ~10 ticks ≈ 0.16 s.
 */
export const WALL_JUMP_FORCE_TIME_TICKS = 10;

/**
 * Ticks after a wall jump during which the same-side wall sensor is suppressed.
 * Prevents instant re-grab and ensures the player is physically away from the
 * wall before another wall jump becomes available.
 * At 60 fps, 12 ticks ≈ 0.20 s — enough time for the forced outward trajectory.
 */
export const WALL_JUMP_LOCKOUT_TICKS = 12;

// ============================================================================
// Enemy movement
// ============================================================================

/** Maximum horizontal chase speed for enemy clusters (px/s). */
export const ENEMY_MAX_SPEED_WORLD_PER_SEC = 60.0;

/** Enemy horizontal acceleration rate (exponential blend factor per second). */
export const ENEMY_ACCEL_PER_SEC = 8.0;

/**
 * Horizontal distance (px) below which enemies stop advancing.
 * Keeps them in a comfortable attack range.
 */
export const ENEMY_ENGAGE_DIST_WORLD = 40.0;

/**
 * Maximum line-of-sight range for rolling enemies (world units).
 * Rolling enemies only chase the player when within this distance,
 * or when recently damaged (rollingEnemyAggressiveTicks > 0).
 * ~25 blocks at BLOCK_SIZE_SMALL = 8.
 */
export const ROLLING_ENEMY_SIGHT_RANGE_WORLD = 200.0;

/**
 * Effective rolling radius (world units) used to convert horizontal
 * displacement to sprite rotation.  A smaller value = spins faster.
 */
export const ROLLING_ENEMY_SPRITE_RADIUS_WORLD = 5.0;

// ── Player sprint ───────────────────────────────────────────────────────────

/** Sprint speed multiplier applied to MAX_RUN_SPEED when sprinting on ground.
 * Adds another 50% on top of the base run speed when holding shift.
 */
export const SPRINT_SPEED_MULTIPLIER = 1.5;

/** Ground deceleration multiplier when holding shift (50% less friction). */
export const SPRINT_FRICTION_MULTIPLIER = 0.5;

/** Ground deceleration multiplier when skidding (50% more friction than default). */
export const SKID_FRICTION_MULTIPLIER = 1.5;

/** Jump speed multiplier when jumping out of a skid (50% higher jump). */
export const SKID_JUMP_MULTIPLIER = 1.5;

/** Velocity threshold (px/s) below which a player is considered "not moving" for skid detection. */
export const SKID_VELOCITY_THRESHOLD_WORLD = 5.0;

// ── Player crouch ───────────────────────────────────────────────────────────

/** Half-height of the player hitbox when crouching (world units). */
export const CROUCH_HALF_HEIGHT_WORLD = 7;

// ── Player idle animation ───────────────────────────────────────────────────

/** Ticks of no movement before the idle animation cycle begins (1 second at 60fps). */
export const IDLE_TRIGGER_TICKS = 60;

/** Ticks for idleBlink animation duration (0.5 seconds at 60fps). */
export const IDLE_BLINK_DURATION_TICKS = 30;

// ============================================================================
// Flying eye movement
// ============================================================================

/** Maximum 2D flight speed of flying eye clusters (world units/s). */
export const FLYING_EYE_SPEED_WORLD_PER_SEC = 63.0;

/** Acceleration alpha per second for flying eye 2D steering (exponential blend). */
export const FLYING_EYE_ACCEL_PER_SEC = 5.5;

/**
 * Preferred hover distance from the player.
 * The eye will approach if farther and retreat if closer.
 */
export const FLYING_EYE_PREFERRED_DIST_WORLD = 117.0;

/** Dead-band half-width around preferred hover distance.  Inside the band the eye orbits. */
export const FLYING_EYE_PREFERRED_BAND_WORLD = 23.0;

/** Angular rate (radians/second) at which the facing angle tracks the velocity direction. */
export const FLYING_EYE_TURN_RATE_PER_SEC = 7.0;

/** Vertical margin from world top/bottom within which flying eyes are clamped. */
export const FLYING_EYE_VERTICAL_MARGIN_WORLD = 20.0;

// ============================================================================
// World bounds
// ============================================================================

/** Horizontal margin from world edges within which clusters are clamped. */
export const CLUSTER_EDGE_MARGIN_WORLD = 7.0;

// ============================================================================
// Collision helpers
// ============================================================================

/** Epsilon for sweep direction checks to absorb floating-point error. */
export const COLLISION_EPSILON = 0.5;
