/**
 * timeStopFieldConfig.ts — Named tuning constants for the TimeStop Field
 * mechanic. Centralised here so no magic numbers are scattered across the
 * momentum-suspension, arrow-rendering, and inversion-compositor code.
 */

// ── Momentum arrow ────────────────────────────────────────────────────────────

/** World units of arrow length per 1 world-unit/s of stored momentum magnitude. */
export const TIME_STOP_ARROW_LENGTH_PER_SPEED = 0.22;
/** Minimum arrow length (world units) before it is treated as "no arrow". */
export const TIME_STOP_ARROW_MIN_LENGTH_WORLD = 2.5;
/** Maximum arrow length (world units), regardless of stored speed. */
export const TIME_STOP_ARROW_MAX_LENGTH_WORLD = 26;
/** Stored-momentum speed (world units/s) below which no arrow is drawn at all. */
export const TIME_STOP_ARROW_MIN_SPEED_WORLD = 4;
/** Arrow fill/stroke opacity (0-1). */
export const TIME_STOP_ARROW_OPACITY = 0.55;
/** Arrow glow blur radius in (unscaled) pixels. */
export const TIME_STOP_ARROW_GLOW_STRENGTH_PX = 6;

// ── Field visual (translucent connected fill) ──────────────────────────────────

/** Base fill opacity (0-1) of the inactive/idle TimeStop Field visual. */
export const TIME_STOP_FIELD_OPACITY = 0.24;
/** Additional opacity added at the field's rounded boundary (glow ring). */
export const TIME_STOP_FIELD_EDGE_GLOW_STRENGTH = 0.5;
/** Corner radius, as a fraction of one tile's pixel size, used for exterior rounding. */
export const TIME_STOP_FIELD_CORNER_RADIUS_FRACTION = 0.45;
/** Angular speed (radians/tick) of the internal shimmer/ripple animation. */
export const TIME_STOP_FIELD_ANIMATION_SPEED = 0.035;

// ── Entry/exit visual transition ────────────────────────────────────────────────

/** Ticks for the field-active visual state (glow + inversion) to fade in on entry. */
export const TIME_STOP_ENTRY_TRANSITION_TICKS = 18;
/** Ticks for the field-active visual state to fade out on exit. */
export const TIME_STOP_EXIT_TRANSITION_TICKS = 24;

// ── Inversion compositor ────────────────────────────────────────────────────────

/** Maximum alpha (0-1) of the inverted-outside overlay at full intensity. */
export const TIME_STOP_INVERSION_MAX_ALPHA = 1.0;

// ── Momentum capture ─────────────────────────────────────────────────────────

/** Speed (world units/s) below which captured/stored momentum is treated as exactly zero. */
export const TIME_STOP_ZERO_VELOCITY_EPSILON = 0.001;
