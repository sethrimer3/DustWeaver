/**
 * transitionConfig.ts — Named tunable constants for room-transition visual features.
 *
 * All configurable values live here so designers can tweak feel without
 * hunting through render and screen logic files.
 */

// ── Fade timing (speed-based) ─────────────────────────────────────────────────

/**
 * Total transition duration (fade-out + fade-in) at normal walking speed (ms).
 * Feels intentional and readable without being too sluggish.
 */
export const TRANSITION_MAX_DURATION_MS = 280;

/**
 * Total transition duration when moving faster than sprint (grappling, etc.) (ms).
 * Should feel nearly seamless at peak speed.
 */
export const TRANSITION_MIN_DURATION_MS = 70;

/**
 * Fraction of the total duration used for fade-OUT (black out).
 * The remaining fraction is used for fade-IN (black to game).
 * >0.5 means fade-out is longer than fade-in, which feels more natural.
 */
export const TRANSITION_FADE_OUT_FRACTION = 0.55;

/**
 * Player speed (world units/sec) that maps to TRANSITION_MID_DURATION_MS.
 * Approximately equal to sprint speed.
 */
export const TRANSITION_SPRINT_SPEED_WORLD = 170;

/**
 * Player speed (world units/sec) at which TRANSITION_MIN_DURATION_MS is used.
 * Represents grapple/dash speed.
 */
export const TRANSITION_FAST_SPEED_WORLD = 380;

// ── Camera entry offset ───────────────────────────────────────────────────────

/**
 * Camera offset in blocks applied after loading the new room.
 * The camera starts this many blocks "behind" the spawn direction and
 * then lerps naturally to the player.  Gives a sense of entering from a
 * direction without requiring a separate slide animation.
 */
export const TRANSITION_CAMERA_ENTRY_OFFSET_BLOCKS = 4;

// ── Edge extension layer ──────────────────────────────────────────────────────

/**
 * How many blocks beyond every room edge the visual extension renders.
 * These tiles have no collision; they prevent visible void at room edges.
 */
export const EDGE_EXTENSION_EXTRA_BLOCKS = 6;

// ── Preview bubble tunables ───────────────────────────────────────────────────

/**
 * Distance from the transition edge (world units) at which the preview
 * bubble becomes fully visible.  Beyond this distance the bubble is hidden.
 */
export const PREVIEW_START_DISTANCE_WORLD = 56;

/**
 * Minimum preview bubble screen radius (virtual pixels) at max distance.
 */
export const PREVIEW_MIN_RADIUS_PX = 3;

/**
 * Maximum preview bubble screen radius (virtual pixels) at zero distance.
 */
export const PREVIEW_MAX_RADIUS_PX = 22;

/**
 * Glow opacity at the start (max distance from transition).
 */
export const PREVIEW_MIN_OPACITY = 0.0;

/**
 * Glow opacity when the player stands right at the transition edge.
 */
export const PREVIEW_MAX_OPACITY = 0.6;

/**
 * Feathering of the preview bubble radial gradient: inner stop as fraction
 * of the bubble radius (0 = full-colour core, 1 = fully feathered).
 */
export const PREVIEW_INNER_STOP = 0.35;

/**
 * Maximum number of preview bubbles rendered in a single frame.
 * Only the nearest transitions contribute when more are in range.
 */
export const PREVIEW_MAX_BUBBLES = 2;
