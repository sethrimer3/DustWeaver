/**
 * transitionConfig.ts — Named tunable constants for room-transition visual features.
 *
 * All configurable values live here so designers can tweak feel without
 * hunting through render and screen logic files.
 */

// ── Edge extension layer ──────────────────────────────────────────────────────

/**
 * How many blocks beyond every room edge the visual extension renders.
 * These tiles have no collision; they prevent visible void at room edges.
 */
export const EDGE_EXTENSION_EXTRA_BLOCKS = 6;

// ── Camera transition reveal ──────────────────────────────────────────────────

/**
 * World-unit distance from a transition edge at which the NearTransition
 * camera reveal begins.  The camera starts easing outward once the player
 * is closer than this distance to any room exit.
 */
export const TRANSITION_REVEAL_START_DIST_WORLD = 48;  // 6 blocks × 8 px

/**
 * Maximum blocks of edge-extension content revealed by the camera on each side.
 * The camera shifts up to (TRANSITION_REVEAL_MAX_BLOCKS × BLOCK_SIZE_SMALL)
 * world units past the room boundary to show this many extension tiles.
 */
export const TRANSITION_REVEAL_MAX_BLOCKS = 2;

/**
 * World-unit distance from the entry edge within which the PostTransition
 * reveal is active.  Beyond this distance the camera has fully returned to
 * normal clamped behaviour and reveals no extra edge content.
 */
export const TRANSITION_REVEAL_DECAY_DIST_WORLD = 48;  // 6 blocks × 8 px

/**
 * Easing speed (per second) for smoothing the reveal camera offset.
 * Higher = snappier response; lower = more gentle lag.
 */
export const TRANSITION_REVEAL_EASE_SPEED = 6.0;

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

// ── Two-room camera crossing feature flags ────────────────────────────────────

/**
 * When true, the two-room smooth camera crossing system is active:
 * both rooms are rendered side-by-side and the camera slides naturally
 * across the seam as the player crosses a transition.
 *
 * Introduced in BUILD 279.  Replaces the old edge-extension + reveal system
 * for the transition crossing window.
 */
export const ENABLE_TWO_ROOM_CAMERA_CROSSING = true;

/**
 * When true, procedural edge-extension tiles (wall tiles rendered beyond
 * the room boundary to fill the void) are drawn during normal gameplay.
 *
 * Disabled for BUILD 279 so only actual room geometry is visible when
 * ENABLE_TWO_ROOM_CAMERA_CROSSING is active.
 */
export const ENABLE_EDGE_EXTENSION_RENDERING = false;

/**
 * When true, the 2-block next-room facing-edge strip is rendered just
 * outside the current room's boundary during a transition reveal.
 *
 * Disabled for BUILD 279 — the two-room crossing system renders the
 * full next room instead.
 */
export const ENABLE_NEXT_ROOM_EDGE_PREVIEW = false;
