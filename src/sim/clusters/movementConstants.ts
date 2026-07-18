/**
 * Tunable numeric constants for cluster movement physics.
 *
 * Extracted from movement.ts so the main movement module stays focused on logic.
 * Every constant here was previously a module-private `const` (or exported symbol)
 * inside movement.ts — names, values, and doc-comments are preserved verbatim.
 */

import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

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
  groundAccelWorld: NaN,
  groundDecelWorld: NaN,
  airAccelWorld: NaN,
  airDecelWorld: NaN,
  wallJumpXWorld: NaN,
  wallJumpYWorld: NaN,
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
 * At 60 fps, 7 ticks ≈ 117 ms (quantized from the 120 ms source value).
 */
export const JUMP_BUFFER_TICKS = Math.round(JUMP_BUFFER_MS / 1000.0 * 60);

// ============================================================================
// Horizontal movement
// ============================================================================

/** Maximum horizontal run speed (px/s). Increased by 50% from 70.0. */
export const MAX_RUN_SPEED_WORLD_PER_SEC = 105.0;

// ============================================================================
// Movement V2 — input accelerates up to a per-surface speed target (only
// while below it — momentum above the target is never clamped down by the
// mere act of accelerating), ground/air speed is otherwise uncapped, and
// deceleration behaves differently per surface:
//   • Ground, no input: friction applies immediately.
//   • Ground, holding input, above GROUND_MAX_INPUT_SPEED: once the player
//     has been continuously grounded for GROUND_DECEL_GRACE_TICKS, held-input
//     deceleration bleeds excess speed back down toward the cap.  Repeated
//     jumping resets groundedTicks to 0 every airborne tick, so bunny-hopping
//     never triggers this.
//   • Air, holding input: never decelerates — only accelerates while below
//     AIR_MAX_INPUT_SPEED.
//   • Air, no input: a slight constant air-friction deceleration applies.
// ============================================================================

/** Speed target for grounded player-input horizontal acceleration (px/s). */
export const GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC = 120.0;

/** Speed target for airborne player-input horizontal acceleration (px/s). */
export const AIR_MAX_INPUT_SPEED_WORLD_PER_SEC = 100.0;

/**
 * Continuous grounded contact time (seconds) required before held-input
 * deceleration of over-cap ground speed begins. Repeated jumping resets the
 * grounded-contact timer each tick the player is airborne, so a player who
 * keeps jumping never triggers deceleration.
 */
export const GROUND_DECEL_GRACE_SEC = 0.75;

/** GROUND_DECEL_GRACE_SEC expressed in ticks (60 fps). */
export const GROUND_DECEL_GRACE_TICKS = Math.round(GROUND_DECEL_GRACE_SEC * 60.0);

/**
 * Passive air friction (px/s²) applied while airborne with no horizontal
 * input. Much gentler than ground friction — a light deceleration, not a
 * hard stop.
 */
export const AIR_FRICTION_PER_SEC2 = 60.0;

// ── Rocket blocks ────────────────────────────────────────────────────────────
// Jumping off a rocket block grants uncapped horizontal acceleration (no
// speed ceiling) at half the normal air acceleration rate, until the player
// next lands.

/** Fraction of normal air acceleration applied while rocket-boosted. */
export const ROCKET_BOOST_AIR_ACCEL_MULTIPLIER = 0.5;

/** Extra speed (px/s) the charged trail particles travel above the player's own velocity. */
export const ROCKET_BOOST_PARTICLE_EXTRA_SPEED_WORLD_PER_SEC = 50.0;

/** Ground acceleration: how quickly the player builds up speed on the ground (px/s²). */
export const GROUND_ACCELERATION_PER_SEC2 = 800.0;

/** Ground deceleration: how quickly the player stops on the ground when no input (px/s²). */
export const GROUND_DECELERATION_PER_SEC2 = 800.0;

// ── Ice surface movement ─────────────────────────────────────────────────────
// Ice is effectively frictionless.  Acceleration and deceleration are both
// dramatically reduced relative to normal ground movement, giving the player
// limited traction and preserving horizontal momentum.

/**
 * Ground acceleration while standing on an ice surface (px/s²).
 * ~10× slower than normal ground accel — player can steer but cannot rapidly
 * build speed.
 */
export const ICE_GROUND_ACCELERATION_PER_SEC2 = 80.0;

/**
 * Ground deceleration while standing on an ice surface with no input (px/s²).
 * Near-zero friction — player continues sliding at nearly the same speed.
 */
export const ICE_GROUND_DECELERATION_PER_SEC2 = 35.0;

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
 * Multiplier applied to the first-wall-jump Y speed for the second wall jump.
 * Produces a launch speed 20% below the first jump but well above the 0.5×
 * subsequent-jump floor, giving a noticeable but not harsh step-down.
 *
 * first  = wallJumpYBase + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD = 152
 * second = first × 0.80                                        = ~122
 * rest   = wallJumpYBase × WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER   =  71
 */
export const WALL_JUMP_SECOND_Y_MULTIPLIER = 0.80;

/**
 * Multiplier applied to wallJumpYBase for wall jumps after the second;
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
 * Ticks derived from WALL_JUMP_GRACE_MS.  At 60 fps, 6 ticks = 100 ms (exact at this rate).
 */
export const WALL_JUMP_GRACE_TICKS = Math.round(WALL_JUMP_GRACE_MS / 1000.0 * 60);

// ============================================================================
// Wall-jump intent filtering (Celeste-like deliberate wall jump)
// ============================================================================

/**
 * Master toggle for wall-jump intent filtering.
 * When true, wall jumps require at least one deliberate intent signal to fire.
 * Set to false to revert to the old any-touch/grace/proximity behavior.
 */
export const WALL_JUMP_REQUIRE_INTENT = true;

/**
 * Minimum consecutive airborne ticks before a direct-touch or grace-timer wall
 * jump is allowed without an away-from-wall input.
 * Prevents wall jumps immediately after hopping over a small stair step or
 * ledge (where airborneTicks would still be low).
 * At 60 fps, 4 ticks ≈ 67 ms.
 */
export const WALL_JUMP_MIN_AIRBORNE_TICKS = 4;

/**
 * Minimum vertical overlap (world units) between the player AABB and a wall
 * face required for the wall to count as a valid wall-jump surface.
 * Rejects tiny ledge blocks and stair steps whose side barely overlaps the player.
 * BLOCK_SIZE_SMALL = 8 wu — a single block fails this threshold (overlap ≤ 8).
 * Multi-block merged walls can comfortably reach 8+ units of overlap.
 */
export const WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD = 8;

/**
 * Ledge suppression range (world units).
 * A wall whose top edge is within this distance ABOVE the player's feet is
 * treated as a ledge lip, not a jumpable wall face.
 * Prevents wall jumps off stair-step tops and block edges near foot level.
 */
export const WALL_JUMP_LEDGE_SUPPRESS_WORLD = 4;

/**
 * Minimum wall face height (in small blocks) required for a side face to be
 * considered a real jumpable wall.
 * 1-3 block rises feel like floor terrain to the player, not intentional walls.
 * At 4 blocks (32 world units) the wall is tall enough to register as a distinct
 * vertical surface.
 */
export const WALL_JUMP_MIN_FACE_HEIGHT_BLOCKS = 4;

/**
 * Minimum wall face height in world units.
 * Derived from WALL_JUMP_MIN_FACE_HEIGHT_BLOCKS * BLOCK_SIZE_SMALL (8 wu each).
 * A wall rectangle whose total height is less than this value cannot trigger a
 * wall jump, regardless of how much the player's AABB overlaps it.
 * Prevents accidental backwards launches when the player clips a 1–3-block
 * step, rise, or ledge while running or jumping forward.
 */
export const WALL_JUMP_MIN_FACE_HEIGHT_WORLD = WALL_JUMP_MIN_FACE_HEIGHT_BLOCKS * BLOCK_SIZE_SMALL;

/**
 * When true, proximity-only wall jumps (not touching, no grace timer) require
 * the player to be pressing away from the wall OR actively wall-sliding.
 * Direct touch and grace timer jumps use a looser intent check.
 */
export const WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT = true;


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

// ── Player skid (speed-scaled direction-reversal technique) ─────────────────
// Movement V2: skidding is no longer a sprint side-effect. Reversing input
// while grounded and moving at or above walking speed latches the entry
// velocity (see ClusterState.skidEntryVelocityXWorld), granting a
// speed-scaled jump-height bonus and speed-scaled debris. State machine
// lives in playerSkid.ts; the jump-height solver lives in skidJumpHeight.ts.

/**
 * Floating-point tolerance (world units/s) applied when checking whether the
 * velocity at skid entry meets the walking-speed qualification threshold.
 * Absorbs rounding error from repeated per-tick float accumulation.
 */
export const SKID_ENTRY_SPEED_EPSILON_WORLD = 0.01;

/**
 * Speed increment (world units/s) above walking speed required for each
 * additional +1 small block of skid-jump bonus apex height. Continuous
 * interpolation, not stepped — see computeSkidJumpBonusBlocks.
 */
export const SKID_JUMP_HEIGHT_SPEED_PER_BLOCK_WORLD = 30.0;

/**
 * Bonus apex height (in small blocks) granted at exactly the minimum
 * qualifying skid-entry speed (walking speed). Continuous interpolation
 * above this baseline is driven by SKID_JUMP_HEIGHT_SPEED_PER_BLOCK_WORLD.
 */
export const SKID_JUMP_BASE_BONUS_BLOCKS = 1.0;

/**
 * Soft-knee constant (world units/s) for skid-particle visual-intensity
 * scaling (see computeSkidVisualSpeedWorld in skidDebrisRenderer.ts). Chosen
 * so the curve reads as close to linear from walking speed through
 * grapple-zip range (~210 units/s) and only visibly compresses well above
 * that, at the rare very-high grapple-launch speeds this game reaches.
 */
export const SKID_VISUAL_SOFT_KNEE_WORLD_PER_SEC = 90.0;

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
 * dust when the player touches the ground. Roughly 1.3x walking speed
 * (GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC = 120) — below this threshold no
 * extra dust appears.
 */
export const LANDING_SKID_SPEED_THRESHOLD_WORLD = 157.5;

/**
 * Maximum scale factor for landing-skid dust (capped multiplier at very high
 * speeds).  Above threshold, factor = (speed − threshold) / threshold, capped
 * here.  At cap, spawn rate, spread, and velocity variance are 5× baseline.
 */
export const LANDING_SKID_SPEED_FACTOR_MAX = 4.0;

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
