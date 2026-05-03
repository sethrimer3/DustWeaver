/**
 * Falling Block system — shared types, constants, and state machine definition.
 *
 * A falling block group is a set of orthogonally-connected same-variant tiles
 * that shake, pause, and then fall as a single rigid body when disturbed.
 *
 * State machine:
 *   idleStable  → warning      (triggered by qualifying disturbance)
 *   warning     → preFallPause (after WARN_DURATION_TICKS)
 *   preFallPause→ falling      (after PRE_FALL_PAUSE_TICKS)
 *   falling     → landedStable (landed on solid terrain / stable group)
 *   falling     → crumbling    (crumbling variant only, after top speed reached
 *                               for CRUMBLE_DELAY_TICKS)
 *   crumbling   → removed      (after CRUMBLE_DURATION_TICKS)
 */

// ── Variant identifiers ──────────────────────────────────────────────────────

/** The three falling block variants. */
export type FallingBlockVariant = 'tough' | 'sensitive' | 'crumbling';

// ── State machine ────────────────────────────────────────────────────────────

export const FB_STATE_IDLE_STABLE   = 0;
export const FB_STATE_WARNING       = 1;
export const FB_STATE_PRE_FALL_PAUSE= 2;
export const FB_STATE_FALLING       = 3;
export const FB_STATE_LANDED_STABLE = 4;
export const FB_STATE_CRUMBLING     = 5;
export const FB_STATE_REMOVED       = 6;

export type FallingBlockState =
  | typeof FB_STATE_IDLE_STABLE
  | typeof FB_STATE_WARNING
  | typeof FB_STATE_PRE_FALL_PAUSE
  | typeof FB_STATE_FALLING
  | typeof FB_STATE_LANDED_STABLE
  | typeof FB_STATE_CRUMBLING
  | typeof FB_STATE_REMOVED;

// ── Trigger type (for debug) ─────────────────────────────────────────────────

export const FB_TRIGGER_NONE            = 0;
export const FB_TRIGGER_PLAYER_TOP_LAND = 1; // player landed on top with enough velocity
export const FB_TRIGGER_PLAYER_TOUCH    = 2; // player touched any side (sensitive)
export const FB_TRIGGER_GRAPPLE_DOWN    = 3; // grapple downward pull (tough)
export const FB_TRIGGER_GRAPPLE_ANY     = 4; // any grapple contact (sensitive)
export const FB_TRIGGER_ENEMY_TOUCH     = 5; // enemy contact
export const FB_TRIGGER_BLOCK_LAND      = 6; // another falling block landed on top

// ── Tuning constants (timing at 60 ticks/s) ──────────────────────────────────

/** Ticks the warning shake plays before the pre-fall pause (~0.35 s). */
export const WARN_DURATION_TICKS = 21;
/** Ticks in the brief freeze between shaking and falling (~0.2 s). */
export const PRE_FALL_PAUSE_TICKS = 12;

/** Fall acceleration (world units / s²). Smooth, not instant. */
export const FALL_ACCEL_WORLD_PER_SEC2 = 280.0;
/** Terminal fall velocity (world units / s). Deliberately slow but threatening. */
export const FALL_TERMINAL_SPEED_WORLD_PER_SEC = 180.0;

/**
 * Minimum player downward landing velocity to trigger a *tough* block.
 * Normal walking off a ledge reaches ~90 wu/s; a full-height fall approaches
 * 360 wu/s.  Set to 130 wu/s so a short hop doesn't trigger it but a real
 * landing or fast fall does.
 */
export const TOUGH_LAND_VELOCITY_THRESHOLD_WORLD = 130.0;

/**
 * Dot-product threshold for grapple downward pull on tough blocks.
 * cos(30°) ≈ 0.866.  Pull direction must have a downward component at least
 * this large (positive Y = down in world space).
 */
export const TOUGH_GRAPPLE_DOWN_DOT_THRESHOLD = 0.866;

/** Ticks after reaching terminal velocity before a crumbling block disappears. */
export const CRUMBLE_DELAY_TICKS = 36; // ~0.6 s
/** Ticks for the crumble particle burst animation. */
export const CRUMBLE_DURATION_TICKS = 20;

/**
 * Epsilon for vertical contact detection (world units).
 * Prevents float imprecision from missing contact at seam boundaries.
 */
export const FB_COLLISION_EPSILON = 0.5;

/** Maximum number of falling block groups per room. */
export const MAX_FALLING_BLOCK_GROUPS = 64;

/** Maximum tiles in a single falling block group (bounds the pre-allocated array). */
export const MAX_TILES_PER_GROUP = 128;

// ── Shake animation ──────────────────────────────────────────────────────────

/** Peak horizontal shake displacement during warning state (world units). */
export const SHAKE_AMPLITUDE_WORLD = 1.5;
/** Shake frequency (ticks per full cycle). */
export const SHAKE_PERIOD_TICKS = 4;

// ── Runtime group state ──────────────────────────────────────────────────────

/**
 * Runtime state for one falling block group.
 *
 * All geometry is in world units.  The group stores the initial (rest)
 * top-left corner as `restXWorld`/`restYWorld` plus the current offset
 * `offsetYWorld` (increases as the group falls).  The effective position is:
 *   xWorld = restXWorld
 *   yWorld = restYWorld + offsetYWorld
 *
 * tile{Rel}X/Y store tile positions relative to the group's rest top-left,
 * so rendering tiles is just: restX + offsetX(shake), restY + offsetY + relY.
 */
export interface FallingBlockGroup {
  /** Stable unique identifier within this room load. */
  groupId: number;

  variant: FallingBlockVariant;

  // ── Geometry ──────────────────────────────────────────────────────────────

  /** Rest left edge of the group bounding box (world units, constant). */
  restXWorld: number;
  /** Rest top edge of the group bounding box (world units, constant). */
  restYWorld: number;
  /** Width of the bounding box (world units, constant). */
  wWorld: number;
  /** Height of the bounding box (world units, constant). */
  hWorld: number;

  /** Number of individual tiles in this group. */
  tileCount: number;
  /**
   * Tile left edges relative to restXWorld (world units).
   * Length = MAX_TILES_PER_GROUP; only [0..tileCount-1] are valid.
   */
  tileRelXWorld: Float32Array;
  /**
   * Tile top edges relative to restYWorld (world units).
   * Length = MAX_TILES_PER_GROUP; only [0..tileCount-1] are valid.
   */
  tileRelYWorld: Float32Array;

  // ── Dynamic state ─────────────────────────────────────────────────────────

  /** Current vertical fall offset (0 = at rest, increases downward). */
  offsetYWorld: number;
  /** Current downward velocity (world units/s, 0 at rest). */
  velocityYWorld: number;

  /** Current shake X displacement (renderer reads this, sim writes it). */
  shakeOffsetXWorld: number;

  // ── State machine ─────────────────────────────────────────────────────────

  state: FallingBlockState;
  /** Ticks elapsed in the current state. */
  stateTimerTicks: number;

  // ── Crumbling variant ─────────────────────────────────────────────────────

  /**
   * 1 once the group has reached terminal fall velocity.
   * For the crumbling variant, starts the crumble countdown.
   */
  hasReachedTopSpeedFlag: 0 | 1;
  /** Countdown ticks until crumble removes the group. */
  crumbleTimerTicks: number;

  // ── Wall slot ─────────────────────────────────────────────────────────────

  /**
   * Index in the world wall arrays that provides the group's solid collision
   * surface.  -1 means not yet assigned (should never happen at runtime).
   */
  wallIndex: number;

  // ── Debug ─────────────────────────────────────────────────────────────────

  /** Last trigger type that caused the transition from idleStable to warning. */
  lastTriggerType: number;
}
