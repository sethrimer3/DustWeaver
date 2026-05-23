/**
 * Dust Constellation Sentinel — tuning constants.
 *
 * All numeric design knobs for both AI and rendering live here so the enemy
 * can be balanced without hunting through logic code.
 */

// ── Variants ──────────────────────────────────────────────────────────────────

/** Mote count for the small variant. */
export const DC_SMALL_MOTE_COUNT = 6;
/** Mote count for the large variant. */
export const DC_LARGE_MOTE_COUNT = 10;

/** HP for the small variant. */
export const DC_SMALL_HP = 8;
/** HP for the large variant. */
export const DC_LARGE_HP = 18;

/** Base mote spacing (world units) for formation offsets — small variant. */
export const DC_SMALL_FORMATION_SCALE = 18.0;
/** Base mote spacing (world units) for formation offsets — large variant. */
export const DC_LARGE_FORMATION_SCALE = 28.0;

// ── Movement ─────────────────────────────────────────────────────────────────

/** Maximum distance from spawn the sentinel will drift (world units). */
export const DC_LEASH_RADIUS_WORLD = 200.0;

/** Slow idle drift speed (world units/s). */
export const DC_IDLE_DRIFT_SPEED_WORLD = 20.0;

/** Bob amplitude (world units). */
export const DC_BOB_AMPLITUDE_WORLD = 5.0;

/** Bob frequency (radians/tick). ~0.35 s period at 60 fps. */
export const DC_BOB_FREQ_RAD_PER_TICK = 0.035;

// ── Mote motion ───────────────────────────────────────────────────────────────

/** Radius around the formation offset within which motes drift freely (world units). */
export const DC_IDLE_DRIFT_RADIUS_WORLD = 12.0;

/** Spring constant pulling motes toward their idle-drift target (per tick, exponential). */
export const DC_MOTE_SPRING_BLEND = 0.06;

/** Jitter impulse applied per tick (world units/s per unit of noise). */
export const DC_MOTE_JITTER_SPEED = 18.0;

/** Mote drift orbit radius (extra orbital offset, world units). */
export const DC_MOTE_ORBIT_RADIUS_WORLD = 8.0;

/** Mote orbit angular speed (radians/tick). */
export const DC_MOTE_ORBIT_RAD_PER_TICK = 0.022;

/** Mote pulse frequency (radians/tick). */
export const DC_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.08;

/** Mote gather spring blend — stronger than idle, pulls into formation. */
export const DC_GATHER_SPRING_BLEND = 0.12;

// ── Attack timing ─────────────────────────────────────────────────────────────

/** Range at which the sentinel activates and begins an attack (world units). */
export const DC_ACTIVATION_RANGE_WORLD = 240.0;

/** Minimum ticks between attacks. */
export const DC_ATTACK_COOLDOWN_TICKS = 180;

/** Ticks for the gather phase (motes converging into formation). */
export const DC_GATHER_DURATION_TICKS = 50;

/** Ticks for the telegraph phase (frozen formation + glowing lines). */
export const DC_TELEGRAPH_DURATION_TICKS = 60;

/** Ticks each individual beam segment is active. */
export const DC_BEAM_SEGMENT_DURATION_TICKS = 30;

/** Ticks for the recover phase (beams fade, motes loosen). */
export const DC_RECOVER_DURATION_TICKS = 40;

// ── Beam appearance ──────────────────────────────────────────────────────────

/** Beam thickness (screen pixels) at virtual resolution. */
export const DC_BEAM_WIDTH_PX = 3;

/** Outer glow width (screen pixels). */
export const DC_BEAM_GLOW_WIDTH_PX = 7;

/** Beam damage applied per hit (health points). */
export const DC_BEAM_DAMAGE = 1;

/** Half-thickness of the beam hitbox (world units). */
export const DC_BEAM_HITBOX_HALF_WORLD = 4.0;

/** Invulnerability ticks after a beam hit (reuses player invulnerability). */
export const DC_BEAM_IFRAMES_TICKS = 60;

// ── Mote appearance ──────────────────────────────────────────────────────────

/** Mote render radius (world units). */
export const DC_MOTE_RADIUS_WORLD = 2.5;

/** Hit area radius around the constellation center (world units). */
export const DC_HIT_RADIUS_WORLD = 20.0;

// ── Death burst ───────────────────────────────────────────────────────────────

/** How many death-burst spark particles to emit. */
export const DC_DEATH_BURST_COUNT = 12;

/** Death-burst particle speed (world units/s). */
export const DC_DEATH_BURST_SPEED = 90.0;

/** Ticks the death-burst sparks last before fading. */
export const DC_DEATH_BURST_LIFETIME_TICKS = 40;

// ── Capacity ─────────────────────────────────────────────────────────────────

/** Maximum simultaneous Dust Constellation Sentinel instances. */
export const MAX_DUST_CONSTELLATIONS = 6;

/** Maximum motes per constellation (matches large variant count). */
export const MAX_MOTES_PER_CONSTELLATION = DC_LARGE_MOTE_COUNT;

// ── Debug ─────────────────────────────────────────────────────────────────────

/** Set to true to draw debug overlays (activation range, hitboxes, state name). */
export const DC_DEBUG_ENABLED = false;
