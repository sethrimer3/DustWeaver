/**
 * cloakConstants.ts — Tunable constants for the two-layer procedural cloak.
 *
 * All values are in world units (= virtual pixels at zoom 1) unless otherwise noted.
 * Gather every tunable in one place so art-direction iteration is fast.
 *
 * The cloak is a single connected garment with two rendered surfaces:
 *   • Back cloak  — darker, renders behind the player body
 *   • Front cloak — lighter, renders in front of the player body
 * Both are driven by one shared cloak state.
 */

// ── Anchor points (sprite-local, top-left origin, unflipped) ──────────────

/** Sprite-local X of the cloak attach point (upper back / shoulder blade). */
export const CLOAK_ANCHOR_LOCAL_X = 7;
/** Sprite-local Y of the cloak attach point. */
export const CLOAK_ANCHOR_LOCAL_Y = 12;

/** Secondary shoulder reference for shaping / debug. */
export const CLOAK_SHOULDER_LOCAL_X = 8;
export const CLOAK_SHOULDER_LOCAL_Y = 14;

// ── Chain geometry (internal simulation) ──────────────────────────────────

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
/** Strength of the rest-pose bias that pulls points toward their preferred direction. */
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
/** How many seconds the turn overshoot effect lasts. */
export const CLOAK_TURN_OVERSHOOT_DURATION_SEC = 0.25;
/** Multiplier on spread during turn overshoot. */
export const CLOAK_TURN_OVERSHOOT_SPREAD_MULTIPLIER = 1.4;

// ── Landing impulse ───────────────────────────────────────────────────────

/** Downward impulse on landing (world units / sec). */
export const CLOAK_LANDING_IMPULSE_WORLD_PER_SEC = 18.0;
/** How many seconds the landing compression effect lasts. */
export const CLOAK_LANDING_DURATION_SEC = 0.18;
/** Compression multiplier on cloak width during landing. */
export const CLOAK_LANDING_COMPRESSION = 0.7;

// ── Constraint solver ─────────────────────────────────────────────────────

/** Number of constraint-relaxation iterations per frame. */
export const CLOAK_CONSTRAINT_ITERATIONS = 3;

// ── Shape spread values (controls how wide the cloak opens per state) ─────

/** Spread when idle (0–1). */
export const CLOAK_SPREAD_IDLE = 0.15;
/** Spread when running (0–1). */
export const CLOAK_SPREAD_RUNNING = 0.3;
/** Spread when sprinting (0–1). */
export const CLOAK_SPREAD_SPRINTING = 0.4;
/** Spread when jumping upward (0–1). */
export const CLOAK_SPREAD_JUMPING = 0.2;
/** Spread during normal falling (0–1). */
export const CLOAK_SPREAD_FALLING = 0.5;
/** Spread during fast fall — dramatic widening (0–1). */
export const CLOAK_SPREAD_FAST_FALL = 0.9;
/** Spread while wall sliding (0–1). */
export const CLOAK_SPREAD_WALL_SLIDE = 0.25;
/** Spread while crouching (0–1). */
export const CLOAK_SPREAD_CROUCHING = 0.1;

// ── Openness values (how much the front-to-back gap is visible) ───────────

/** Openness when idle (0–1). */
export const CLOAK_OPENNESS_IDLE = 0.1;
/** Openness when running (0–1). */
export const CLOAK_OPENNESS_RUNNING = 0.25;
/** Openness when jumping (0–1). */
export const CLOAK_OPENNESS_JUMPING = 0.15;
/** Openness during normal fall (0–1). */
export const CLOAK_OPENNESS_FALLING = 0.4;
/** Openness during fast fall (0–1). */
export const CLOAK_OPENNESS_FAST_FALL = 0.65;
/** Openness while wall sliding (0–1). */
export const CLOAK_OPENNESS_WALL_SLIDE = 0.2;

// ── Shape lerp speed ──────────────────────────────────────────────────────

/** How quickly spread/openness values approach their targets per second. */
export const CLOAK_SHAPE_LERP_SPEED = 8.0;

// ── Front cloak sizing ratios ─────────────────────────────────────────────

/** Width of front cloak relative to back cloak (0–1). */
export const CLOAK_FRONT_WIDTH_RATIO = 0.55;
/** Projection amount: how far forward (toward player front) the front cloak extends (world units). */
export const CLOAK_FRONT_PROJECTION_WORLD = 1.5;
/** Front cloak length ratio relative to back cloak (0–1). */
export const CLOAK_FRONT_LENGTH_RATIO = 0.65;
/** How quickly the front fold projection tapers from root to tip (0–1). */
export const CLOAK_FRONT_PROJECTION_TAPER = 0.6;

// ── Fast-fall sharp corner intensity ──────────────────────────────────────

/** How much the outer corners sharpen during fast fall (0–1). */
export const CLOAK_FAST_FALL_CORNER_SHARPNESS = 0.7;

// ── Back cloak render constants ───────────────────────────────────────────

/** Width of the back cloak at the root (world units). */
export const CLOAK_BACK_WIDTH_ROOT_WORLD = 5;
/** Width of the back cloak at the tip (world units). */
export const CLOAK_BACK_WIDTH_TIP_WORLD = 2;
/** Additional widening at tip during fast fall (world units). */
export const CLOAK_BACK_FAST_FALL_TIP_EXTRA_WORLD = 4;
/** Fill colour of the back cloak — darker blue tones. */
export const CLOAK_BACK_FILL_COLOR = '#0f1a2e';
/** Outline colour for the back cloak. */
export const CLOAK_BACK_OUTLINE_COLOR = '#000000';

// ── Front cloak render constants ──────────────────────────────────────────

/** Fill colour of the front cloak — very light blue / white tones. */
export const CLOAK_FRONT_FILL_COLOR = '#b8d4e8';
/** Outline colour for the front cloak. */
export const CLOAK_FRONT_OUTLINE_COLOR = '#1a1028';
/** Outline width for the front cloak (world units). */
export const CLOAK_FRONT_OUTLINE_WIDTH_WORLD = 1;

// ── Shared outline ────────────────────────────────────────────────────────

/** Outline width for the back cloak (world units). */
export const CLOAK_BACK_OUTLINE_WIDTH_WORLD = 1;

// ── Debug ─────────────────────────────────────────────────────────────────

/** Debug point radius (screen pixels). */
export const CLOAK_DEBUG_POINT_RADIUS_PX = 2;

// ── Simulation thresholds ─────────────────────────────────────────────────

/** Maximum render-frame dt (seconds) — clamps large gaps from tab-switch. */
export const CLOAK_MAX_FRAME_DT_SEC = 0.05;
/** Minimum dt divisor (seconds) — avoids division by near-zero. */
export const CLOAK_MIN_DT_SEC = 0.001;
/** Minimum distance for constraint normalisation (world units). */
export const CLOAK_MIN_DISTANCE_WORLD = 0.001;
/** Minimum tangent length for perpendicular calculation (screen px). */
export const CLOAK_MIN_TANGENT_LENGTH = 0.001;

// ── State detection thresholds ────────────────────────────────────────────

/** Vertical velocity below which the player is considered jumping upward (world units/sec). */
export const CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD = -10;
/** Horizontal speed above which the player is considered running (world units/sec). */
export const CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD = 15;
/** Vertical velocity above which fast-fall state activates (world units/sec, downward positive). */
export const CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD = 180;
