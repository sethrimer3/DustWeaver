/**
 * cloakConstants.ts — Tunable constants for the procedural player cloak.
 *
 * All values are in world units (= virtual pixels at zoom 1) unless otherwise noted.
 * Gather every tunable in one place so art-direction iteration is fast.
 */

// ── Anchor points (sprite-local, top-left origin, unflipped) ──────────────

/** Sprite-local X of the cloak attach point (upper back / shoulder blade). */
export const CLOAK_ANCHOR_LOCAL_X = 7;
/** Sprite-local Y of the cloak attach point. */
export const CLOAK_ANCHOR_LOCAL_Y = 12;

/** Secondary shoulder reference (debug / future shaping). */
export const CLOAK_SHOULDER_LOCAL_X = 8;
export const CLOAK_SHOULDER_LOCAL_Y = 14;

// ── Chain geometry ────────────────────────────────────────────────────────

/** Number of simulated trailing points after the root anchor. */
export const CLOAK_SEGMENT_COUNT = 3;
/** Rest distance between consecutive chain points (world units). */
export const CLOAK_SEGMENT_LENGTH_WORLD = 3.0;
/** Maximum total extension before clamping (world units). */
export const CLOAK_MAX_EXTENSION_WORLD = CLOAK_SEGMENT_COUNT * CLOAK_SEGMENT_LENGTH_WORLD * 1.15;

// ── Simulation dynamics ──────────────────────────────────────────────────

/** Damping factor applied to point velocity each frame (0 = no drag, 1 = freeze). */
export const CLOAK_DAMPING = 0.82;
/** Gravity applied to trailing points (world units / sec²). Mild — purely stylistic. */
export const CLOAK_GRAVITY_WORLD_PER_SEC2 = 55.0;
/** How much of the player's velocity is inherited by each trailing point (0–1). */
export const CLOAK_VELOCITY_INHERITANCE = 0.45;
/** Strength of the rest-pose bias that pulls points toward their preferred direction (0–1). */
export const CLOAK_REST_BIAS_STRENGTH = 0.22;

// ── State-aware directional bias (rest-pose target offsets per segment) ───
//    Each entry is [dx, dy] per segment relative to the previous point,
//    in facing-direction local space (positive X = backward, positive Y = down).

/** Idle: hang down and slightly backward. */
export const CLOAK_REST_IDLE: readonly [number, number] = [0.3, 2.8];
/** Running: trail backward more strongly. */
export const CLOAK_REST_RUNNING: readonly [number, number] = [1.6, 2.2];
/** Sprinting: extra trailing. */
export const CLOAK_REST_SPRINTING: readonly [number, number] = [2.2, 1.8];
/** Jumping upward: lag slightly downward / backward. */
export const CLOAK_REST_JUMPING: readonly [number, number] = [0.6, 2.6];
/** Falling: lift a little from air resistance. */
export const CLOAK_REST_FALLING: readonly [number, number] = [0.3, 2.0];
/** Wall sliding: flow outward from wall. */
export const CLOAK_REST_WALL_SLIDE: readonly [number, number] = [1.0, 2.4];
/** Crouching: compress slightly. */
export const CLOAK_REST_CROUCHING: readonly [number, number] = [0.4, 2.0];

// ── Turn response ─────────────────────────────────────────────────────────

/** Extra lateral impulse applied on turn (world units). */
export const CLOAK_TURN_IMPULSE_WORLD = 2.5;

// ── Landing impulse ───────────────────────────────────────────────────────

/** Downward impulse on landing (world units / sec). */
export const CLOAK_LANDING_IMPULSE_WORLD_PER_SEC = 18.0;

// ── Constraint solver ─────────────────────────────────────────────────────

/** Number of constraint-relaxation iterations per frame. */
export const CLOAK_CONSTRAINT_ITERATIONS = 3;

// ── Rendering ─────────────────────────────────────────────────────────────

/** Fill colour of the cloak silhouette. */
export const CLOAK_FILL_COLOR = '#1a1028';
/** Outline colour matching the player sprite's dark outline. */
export const CLOAK_OUTLINE_COLOR = '#000000';
/** Outline width in world units (virtual px). */
export const CLOAK_OUTLINE_WIDTH_WORLD = 1;
/** Width of the cloak at the root (world units). */
export const CLOAK_WIDTH_ROOT_WORLD = 5;
/** Width of the cloak at the tip (world units). Narrows for a tapered silhouette. */
export const CLOAK_WIDTH_TIP_WORLD = 2;

// ── Debug ─────────────────────────────────────────────────────────────────

/** Debug point radius (screen pixels). */
export const CLOAK_DEBUG_POINT_RADIUS_PX = 2;
