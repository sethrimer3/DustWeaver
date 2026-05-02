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
  skidJumpMultiplier: NaN,
  grappleSuperJumpMultiplier: NaN,
  wallJumpAirAccelMultiplier: NaN,
  airMoveSpeedWorld: NaN,
  airBrakingWorld: NaN,
  momentumDecayWorld: NaN,
  highSpeedSteeringFactor: NaN,
  upwardBrakeStrengthWorld: NaN,
  // Forgiveness mechanics
  jumpBufferMs: NaN,
  apexFloatVelocityThreshold: NaN,
  apexFloatGravityMultiplier: NaN,
  jumpCornerCorrectionPixels: NaN,
  blockPopMaxPixels: NaN,
  wallJumpProximityPixels: NaN,
  wallJumpGraceTicks: NaN,
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

// ── Apex half-gravity (apex float) ──────────────────────────────────────────
// Near the top of the jump arc, gravity is halved for a brief "floaty apex"
// feel — only when vertical speed is near zero, jump is held, and the player
// is not in committed fast-fall mode.

/**
 * Vertical speed threshold (world units/s) below which apex float kicks in.
 * Only active when abs(vy) < this value, jump is held, and not fast-falling.
 */
export const APEX_FLOAT_VELOCITY_THRESHOLD = 35;

/** Gravity multiplier applied at the apex of a jump (apex float). */
export const APEX_FLOAT_GRAVITY_MULTIPLIER = 0.5;

// Legacy aliases preserved for backward compatibility
export const APEX_THRESHOLD_WORLD_PER_SEC  = APEX_FLOAT_VELOCITY_THRESHOLD;
export const APEX_GRAVITY_MULTIPLIER       = APEX_FLOAT_GRAVITY_MULTIPLIER;

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
 * Milliseconds a jump input is remembered while airborne (jump buffer).
 * When the player lands while the buffer is active, the jump fires immediately.
 */
export const JUMP_BUFFER_MS = 120;

/**
 * Ticks a jump input is remembered while airborne (derived from JUMP_BUFFER_MS).
 * At 60 fps, 7 ticks ≈ 116 ms.
 */
export const JUMP_BUFFER_TICKS = Math.round(JUMP_BUFFER_MS / 1000.0 * 60);

// ============================================================================
// Horizontal movement
// ============================================================================

/** Maximum horizontal run speed (px/s). Increased by 50% from 70.0. */
export const MAX_RUN_SPEED_WORLD_PER_SEC = 105.0;

/** Ground acceleration: how quickly the player builds up speed on the ground (px/s²). */
export const GROUND_ACCELERATION_PER_SEC2 = 800.0;

/** Ground deceleration: how quickly the player stops on the ground when no input (px/s²). */
export const GROUND_DECELERATION_PER_SEC2 = 800.0;

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
// Air-momentum preservation system
// ============================================================================
// These constants govern post-grapple and high-speed airborne movement.
// The design goal: earned momentum (from grapple swings, bounces, etc.) is
// preserved unless the player intentionally brakes, lands, or re-grapples.
// Normal air input cannot push the player above AIR_MOVE_SPEED_WORLD_PER_SEC.

/**
 * Soft cap for input-generated air speed (px/s).
 * Matches MAX_RUN_SPEED_WORLD_PER_SEC so normal aerial movement feels
 * consistent with ground movement.  Externally generated momentum (grapple
 * launch, bounce pads, etc.) may legitimately exceed this value; input alone
 * may not push the player above it.
 */
export const AIR_MOVE_SPEED_WORLD_PER_SEC = 105.0;

/**
 * Intentional air braking rate (px/s²).
 * Applied when the player holds input *opposite* their current high-speed
 * movement direction.  Faster than MOMENTUM_DECAY_PER_SEC2 so braking feels
 * deliberate.  At 1000 px/s² the player can brake from 300 px/s to
 * AIR_MOVE_SPEED in about 0.2 seconds — responsive but not jarring.
 */
export const AIR_BRAKING_PER_SEC2 = 1000.0;

/**
 * Passive momentum decay rate (px/s²) while airborne, no input, above
 * AIR_MOVE_SPEED_WORLD_PER_SEC.  Subtle enough that a grapple launch feels
 * rewarding for many seconds, but non-zero so momentum is never truly infinite.
 * Decay stops once speed reaches AIR_MOVE_SPEED so normal-range air movement
 * is not affected.
 */
export const MOMENTUM_DECAY_PER_SEC2 = 25.0;

/**
 * Fraction of AIR_ACCELERATION_PER_SEC2 applied when holding input in the
 * same direction as high-speed movement.  Allows subtle arc-shaping without
 * adding meaningful speed.  The player's abs(vx) is hard-capped to its value
 * before the steering impulse so this can never push speed above the launch.
 */
export const HIGH_SPEED_STEERING_FACTOR = 0.35;

/**
 * Rate at which holding jump brakes the player's downward velocity when in
 * committed fast-fall mode (px/s²).  At 350 px/s² the player can bleed from
 * fastFallCap (240) to normalFallCap (160.5) in ~0.23 s — intentional and
 * expressive but not punishing.
 */
export const UPWARD_BRAKE_STRENGTH_PER_SEC2 = 350.0;

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
export const WALL_JUMP_Y_SPEED_WORLD = 142.0;

/**
 * Extra upward launch speed applied only to the first wall jump after a reset.
 * Reset conditions: touching ground or attaching a grapple.
 */
export const WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD = 10.0;

/**
 * Ticks after a wall jump during which horizontal input is overridden by
 * the outward launch direction (force-time window).
 * This prevents the player from immediately steering back to the wall.
 * At 60 fps, ~10 ticks ≈ 0.16 s.
 */
export const WALL_JUMP_FORCE_TIME_TICKS = 10;

/**
 * Multiplier applied to horizontal air acceleration after any wall jump until
 * the player lands.  Doubles air steering speed for snappier control away from
 * the wall without affecting ground or pre-wall-jump air movement.
 */
export const WALL_JUMP_AIR_ACCEL_MULTIPLIER = 2.0;

/**
 * Multiplier applied to wallJumpYBase for wall jumps after the first;
 * produces half the vertical launch speed to prevent altitude gain from
 * chained wall-jumps.
 */
export const WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER = 0.5;

/**
 * Ticks after a wall jump during which the same-side wall sensor is suppressed.
 * Prevents instant re-grab and ensures the player is physically away from the
 * wall before another wall jump becomes available.
 * At 60 fps, 12 ticks ≈ 0.20 s — enough time for the forced outward trajectory.
 */
export const WALL_JUMP_LOCKOUT_TICKS = 12;

// ============================================================================
// Wall-jump forgiveness
// ============================================================================

/**
 * Horizontal proximity distance (world units) within which the player can
 * trigger a wall jump even without physically touching the wall.
 * Allows wall jumps when 1–3 pixels away from a solid wall face.
 */
export const WALL_JUMP_PROXIMITY_PIXELS = 3;

/**
 * Milliseconds after leaving a wall during which a wall jump is still allowed
 * (wall coyote time).
 */
export const WALL_JUMP_GRACE_MS = 100;

/**
 * Ticks derived from WALL_JUMP_GRACE_MS.  At 60 fps, 6 ticks ≈ 100 ms.
 */
export const WALL_JUMP_GRACE_TICKS = Math.round(WALL_JUMP_GRACE_MS / 1000.0 * 60);

// ============================================================================
// Jump corner correction
// ============================================================================

/**
 * Maximum horizontal nudge (world units) applied when the player bonks the
 * underside corner of a block while jumping upward.  The engine tests offsets
 * 1, 2, … JUMP_CORNER_CORRECTION_PIXELS in the player's movement direction to
 * find a clear path around the corner.
 */
export const JUMP_CORNER_CORRECTION_PIXELS = 3;

// ============================================================================
// Block pop (ledge lip assist)
// ============================================================================

/**
 * Maximum upward pop distance (world units) for the ledge lip assist.
 * If the player's feet are within this distance below a block's top edge
 * while moving horizontally into it, the player is gently placed on top.
 * Kept small to prevent stair-climbing exploits.
 */
export const BLOCK_POP_MAX_PIXELS = 2;

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

/** Jump speed multiplier when jumping out of a skid; targets ~6 small blocks of height. */
export const SKID_JUMP_MULTIPLIER = 1.153;

/** Velocity threshold (px/s) below which a player is considered "not moving" for skid detection. */
export const SKID_VELOCITY_THRESHOLD_WORLD = 5.0;

/**
 * Jump speed multiplier for the zip-jump (zip super jump).
 * Applied to PLAYER_JUMP_SPEED_WORLD in the direction of the surface normal.
 * At 1.331× the total speed magnitude is 1.331 × 255 ≈ 340 world units/s,
 * giving ~8 small blocks of effective height when launched vertically.
 */
export const GRAPPLE_SUPER_JUMP_MULTIPLIER = 1.331;

// ── Landing skid dust ────────────────────────────────────────────────────────

/**
 * Minimum horizontal speed (world units/s) required to trigger landing-skid
 * dust when the player touches the ground.
 * Set just above sprint speed (MAX_RUN_SPEED × SPRINT_SPEED_MULTIPLIER =
 * 105 × 1.5 = 157.5).  Below this threshold no extra dust appears.
 */
export const LANDING_SKID_SPEED_THRESHOLD_WORLD = 157.5;

/**
 * Maximum scale factor for landing-skid dust (capped multiplier at very high
 * speeds).  Above threshold, factor = (speed − threshold) / threshold, capped
 * here.  At cap, spawn rate, spread, and velocity variance are 5× baseline.
 */
export const LANDING_SKID_SPEED_FACTOR_MAX = 4.0;

// ── Grapple zip double-tap ───────────────────────────────────────────────────

/**
 * Maximum ticks between two successive down presses for a double-tap to be
 * recognised and trigger the grapple zip.  At 60 fps, 18 ticks ≈ 0.3 s —
 * wide enough to be comfortably hittable but narrow enough to feel intentional.
 */
export const GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS = 18;

// ── Player crouch ───────────────────────────────────────────────────────────

/** Half-height of the player hitbox when crouching (world units). Sprite y 8–24 = 16 px, half = 8. */
export const CROUCH_HALF_HEIGHT_WORLD = 8;

// ── Fast-fall hitbox ────────────────────────────────────────────────────────

/**
 * Downward velocity threshold (world units/sec) above which the player is
 * considered to be fast-falling.  Matches the cloak renderer's threshold.
 */
export const FAST_FALL_VELOCITY_THRESHOLD_WORLD = 180;

/**
 * Half-width of the player hitbox when fast-falling (world units).
 * Sprite x 7–12 = 5 px, half = 2.5.
 */
export const FAST_FALL_HALF_WIDTH_WORLD = 2.5;

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
export const CLUSTER_EDGE_MARGIN_WORLD = 0.0;

// ============================================================================
// Collision helpers
// ============================================================================

/** Epsilon for sweep direction checks to absorb floating-point error. */
export const COLLISION_EPSILON = 0.5;
