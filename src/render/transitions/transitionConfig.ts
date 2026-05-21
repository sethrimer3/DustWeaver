/**
 * transitionConfig.ts — Active runtime constants for instant room transitions.
 *
 * Only constants that affect current gameplay are exported here.
 * Legacy fancy-transition constants (edge extension, camera reveal, two-room
 * crossing, preview bubbles) have been removed from this file.  See
 * src/render/transitions/legacy/README.md for details.
 */

/**
 * The only supported room-transition mode: instant room switching.
 * Camera snaps to the destination spawn immediately via snapCamera().
 * No smooth pan, no camera interpolation, no reveal offset.
 */
export const ENABLE_SIMPLE_ROOM_TRANSITIONS = true;

// ── Constants still referenced by legacy files (do not remove) ───────────────
// These are consumed by files in src/render/transitions/ that are no longer
// imported by gameplay but are preserved for historical/reference purposes.

/** @legacy Used by edgeExtensionCache.ts (editor-only). */
export const EDGE_EXTENSION_EXTRA_BLOCKS = 6;
/** @legacy Used by transitionCameraReveal.ts. */
export const TRANSITION_REVEAL_START_DIST_WORLD = 48;
/** @legacy Used by transitionCameraReveal.ts. */
export const TRANSITION_REVEAL_MAX_BLOCKS = 2;
/** @legacy Used by transitionCameraReveal.ts. */
export const TRANSITION_REVEAL_DECAY_DIST_WORLD = 48;
/** @legacy Used by transitionCameraReveal.ts. */
export const TRANSITION_REVEAL_EASE_SPEED = 6.0;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_START_DISTANCE_WORLD = 56;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_MIN_RADIUS_PX = 3;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_MAX_RADIUS_PX = 22;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_MIN_OPACITY = 0.0;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_MAX_OPACITY = 0.6;
/** @legacy Used by previewBubbleRenderer.ts. */
export const PREVIEW_INNER_STOP = 0.35;
/** @legacy Used by previewBubbleState.ts. */
export const PREVIEW_MAX_BUBBLES = 2;
