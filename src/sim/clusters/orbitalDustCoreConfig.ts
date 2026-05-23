/**
 * Orbital Dust Core — tuning constants.
 *
 * All numeric design knobs for both AI and rendering live here so the enemy
 * can be balanced without hunting through logic code.
 */

// ── Variants ─────────────────────────────────────────────────────────────────

/** Number of orbital rings for the small variant. */
export const ODC_SMALL_RING_COUNT = 2;
/** Number of orbital rings for the large variant. */
export const ODC_LARGE_RING_COUNT = 4;

/** Motes in each ring for the small variant (index 0 = outermost ring). */
export const ODC_SMALL_MOTES_PER_RING: readonly number[] = [6, 5];
/** Motes in each ring for the large variant. */
export const ODC_LARGE_MOTES_PER_RING: readonly number[] = [8, 7, 6, 5];

/** Base orbital radius per ring for the small variant (world units, index 0 = outer). */
export const ODC_SMALL_RING_RADII: readonly number[] = [32, 20];
/** Base orbital radius per ring for the large variant (world units). */
export const ODC_LARGE_RING_RADII: readonly number[] = [52, 40, 28, 18];

/**
 * Angular velocity per ring for the small variant (radians/tick).
 * Inner rings orbit faster (higher index = faster).
 */
export const ODC_SMALL_RING_ANG_VEL: readonly number[] = [0.018, 0.030];
/** Angular velocity per ring for the large variant. */
export const ODC_LARGE_RING_ANG_VEL: readonly number[] = [0.012, 0.018, 0.026, 0.038];

/** Health per ring for the small variant. */
export const ODC_SMALL_RING_HEALTH: readonly number[] = [4, 4];
/** Health per ring for the large variant. */
export const ODC_LARGE_RING_HEALTH: readonly number[] = [6, 5, 5, 4];

/** Core HP for the small variant. */
export const ODC_SMALL_CORE_HP = 5;
/** Core HP for the large variant. */
export const ODC_LARGE_CORE_HP = 12;

// ── Hitbox ───────────────────────────────────────────────────────────────────

/** Logical hit-area radius for the currently exposed ring (world units). */
export const ODC_RING_HIT_BAND_THICKNESS_WORLD = 12.0;
/** Core hit radius when vulnerable (world units). */
export const ODC_CORE_HIT_RADIUS_WORLD = 8.0;

// ── Movement ─────────────────────────────────────────────────────────────────

/** Maximum drift from spawn point (world units). */
export const ODC_LEASH_RADIUS_WORLD = 160.0;

/** Bob amplitude (world units). */
export const ODC_BOB_AMPLITUDE_WORLD = 4.0;

/** Bob frequency (radians/tick). */
export const ODC_BOB_FREQ_RAD_PER_TICK = 0.028;

/** Range at which the enemy activates (world units). */
export const ODC_ACTIVATION_RANGE_WORLD = 220.0;

// ── Mote appearance ───────────────────────────────────────────────────────────

/** Mote render radius (world units). */
export const ODC_MOTE_RADIUS_WORLD = 2.0;

/** Radius wobble amplitude (world units). */
export const ODC_RADIUS_WOBBLE_WORLD = 2.5;

/** Radius wobble frequency multiplier per mote (radians/tick). */
export const ODC_RADIUS_WOBBLE_FREQ_RAD_PER_TICK = 0.055;

/** Mote brightness pulse frequency (radians/tick). */
export const ODC_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.07;

// ── Ring collapse ─────────────────────────────────────────────────────────────

/** Ticks for inner motes to drift outward into the new exposed ring radius. */
export const ODC_RING_TRANSITION_TICKS = 50;

/** Blend speed (per tick) for mote radius transitions. */
export const ODC_MOTE_RADIUS_BLEND = 0.06;

/** Ticks for the core pulse flash when a ring collapses. */
export const ODC_COLLAPSE_CORE_PULSE_TICKS = 30;

// ── Gravity Pulse attack ──────────────────────────────────────────────────────

/** Minimum ticks between attacks. */
export const ODC_ATTACK_COOLDOWN_TICKS = 200;

/** Ticks for the telegraph/charge phase (motes tighten, core brightens). */
export const ODC_CHARGE_DURATION_TICKS = 50;

/** How far motes tighten inward during charge (fraction of base radius). */
export const ODC_CHARGE_TIGHTEN_FRACTION = 0.18;

/** Ticks the pulse ring expands. */
export const ODC_PULSE_DURATION_TICKS = 80;

/** Maximum radius the gravity pulse expands to (world units). */
export const ODC_PULSE_MAX_RADIUS_WORLD = 96.0;

/** Small-variant pulse max radius. */
export const ODC_PULSE_MAX_RADIUS_SMALL_WORLD = 72.0;

/** Thickness of the pulse ring hitbox (world units). */
export const ODC_PULSE_THICKNESS_WORLD = 10.0;

/** Damage dealt by the pulse. */
export const ODC_PULSE_DAMAGE = 1;

/** Invulnerability ticks granted after a pulse hit. */
export const ODC_PULSE_IFRAMES_TICKS = 60;

/** Ticks for the recover phase. */
export const ODC_RECOVER_DURATION_TICKS = 45;

// ── Core visuals ──────────────────────────────────────────────────────────────

/** Core glow radius at full rings (world units). */
export const ODC_CORE_RADIUS_OCCLUDED_WORLD = 3.5;

/** Core glow radius when fully vulnerable (world units). */
export const ODC_CORE_RADIUS_VULNERABLE_WORLD = 5.5;

/** Core pulse frequency when vulnerable (radians/tick). */
export const ODC_CORE_VULNERABLE_PULSE_FREQ = 0.12;

// ── Shield flash ──────────────────────────────────────────────────────────────

/** Ticks the shield flash indicator lasts. */
export const ODC_SHIELD_FLASH_TICKS = 25;

// ── Death burst ───────────────────────────────────────────────────────────────

/** Ticks for the death collapse inward then burst outward. */
export const ODC_DEATH_BURST_DURATION_TICKS = 40;

// ── Capacity ─────────────────────────────────────────────────────────────────

/** Maximum simultaneous Orbital Dust Core instances. */
export const MAX_ORBITAL_DUST_CORES = 4;

/** Maximum rings per Orbital Dust Core slot (equals large variant ring count). */
export const MAX_RINGS_PER_ODC = ODC_LARGE_RING_COUNT;

/** Maximum motes per ring (equals large variant max). */
export const MAX_MOTES_PER_RING_ODC = 8;

/** Total mote slots per ODC slot (rings × motes). */
export const MOTES_PER_ODC_SLOT = MAX_RINGS_PER_ODC * MAX_MOTES_PER_RING_ODC;

// ── Debug ─────────────────────────────────────────────────────────────────────

/** Set to true to draw debug overlays. */
export const ODC_DEBUG_ENABLED = false;
