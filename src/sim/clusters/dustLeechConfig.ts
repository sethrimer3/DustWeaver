/**
 * Dust Leech / Dust Echo — tuning constants.
 *
 * Shared design knobs for both the parent siphon enemy and its runtime-spawned
 * echo minion live here so AI and rendering stay in sync.
 */

// ── Capacity ──────────────────────────────────────────────────────────────────

export const MAX_DUST_LEECHES = 4;
export const MAX_DUST_ECHOES = 4;
export const MAX_MOTES_PER_DL = 8;
export const MAX_MOTES_PER_DE = 14;

// ── Leech health ──────────────────────────────────────────────────────────────

export const DL_HP = 8;
export const DL_HALF_W = 6.0;
export const DL_HALF_H = 6.0;

// ── Leech movement ────────────────────────────────────────────────────────────

export const DL_ACTIVATION_RANGE_WORLD = 180.0;
export const DL_SIPHON_RANGE_WORLD = 55.0;
export const DL_LEASH_RADIUS_WORLD = 140.0;
export const DL_HOVER_SPEED = 0.22;
export const DL_VELOCITY_DRAG = 0.88;
export const DL_BOB_AMPLITUDE_WORLD = 2.5;
export const DL_BOB_FREQ_RAD_PER_TICK = 0.022;

// ── Leech siphon ──────────────────────────────────────────────────────────────

export const DL_SIPHON_TELEGRAPH_TICKS = 55;
export const DL_SIPHON_ACTIVE_TICKS = 90;
export const DL_SIPHON_CHARGE_REQUIRED = 3.0;
export const DL_SIPHON_CHARGE_PER_TICK = 0.05;
export const DL_SIPHON_CHARGE_DECAY_PER_TICK = 0.015;
export const DL_SIPHON_COOLDOWN_TICKS = 240;
export const DL_MAX_ACTIVE_ECHOES = 1;

// ── Leech visual ──────────────────────────────────────────────────────────────

export const DL_CORE_RADIUS_WORLD = 5.0;
export const DL_MOTE_START_RADIUS_WORLD = 18.0;
export const DL_MOTE_ANG_VEL_RAD_PER_TICK = 0.035;
export const DL_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.058;
export const DL_HIT_FLASH_TICKS = 6;
export const DL_DEATH_DURATION_TICKS = 45;

// ── Echo health / lifetime ────────────────────────────────────────────────────

export const DE_HP = 6;
export const DE_HALF_W = 5.0;
export const DE_HALF_H = 8.0;
export const DE_LIFETIME_TICKS = 480;

// ── Echo movement ─────────────────────────────────────────────────────────────

export const DE_HOVER_SPEED = 0.32;
export const DE_VELOCITY_DRAG = 0.86;

// ── Echo lunge attack ─────────────────────────────────────────────────────────

export const DE_LUNGE_COOLDOWN_TICKS = 150;
export const DE_LUNGE_TELEGRAPH_TICKS = 45;
export const DE_LUNGE_ACTIVE_TICKS = 25;
export const DE_LUNGE_RECOVER_TICKS = 50;
export const DE_LUNGE_SPEED_WORLD = 4.5;
export const DE_LUNGE_DISTANCE_WORLD = 90.0;
export const DE_LUNGE_DAMAGE = 1;
export const DE_LUNGE_IFRAMES_TICKS = 55;

// ── Echo visual ───────────────────────────────────────────────────────────────

export const DE_BODY_MOTE_COUNT = 14;
export const DE_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.07;
export const DE_HIT_FLASH_TICKS = 5;
export const DE_DEATH_FADE_TICKS = 35;

// ── Leech visual (rendering constants) ───────────────────────────────────────

export const DL_HALO_RADIUS_WORLD = 14.0;
export const DL_RIM_THICKNESS_WORLD = 2.0;
export const DL_MOTE_ORBIT_BASE_WORLD = 16.0;
export const DL_MOTE_ORBIT_EXPANSION_WORLD = 6.0;
export const DL_MOTE_BRIGHTNESS_BASE = 0.5;
export const DL_MOTE_BRIGHTNESS_AMPLITUDE = 0.5;
export const DL_MOTE_BRIGHT_THRESHOLD = 0.65;
export const DL_MOTE_SATED_CHARGE_THRESHOLD = 0.7;
export const DL_TELEGRAPH_STEP_PX = 5;
export const DL_TELEGRAPH_ALPHA_BASE = 0.6;
export const DL_TELEGRAPH_ALPHA_STEP = 0.12;
export const DL_ECHO_RING_STEP_WORLD = 3.0;
export const DL_ECHO_RING_SCALE = 1.2;
export const DL_ECHO_RING_ALPHA_BASE = 0.28;
export const DL_ECHO_RING_ALPHA_STEP = 0.06;

// ── Echo visual (rendering constants) ────────────────────────────────────────

export const DE_CORE_RADIUS_WORLD = 3.0;
export const DE_MOTE_BRIGHTNESS_BASE = 0.5;
export const DE_MOTE_BRIGHTNESS_AMPLITUDE = 0.5;
export const DE_MOTE_BRIGHT_THRESHOLD = 0.55;

// ── AI internal constants ─────────────────────────────────────────────────────

/** Max blend factor for Leech hover movement each tick. */
export const DL_HOVER_MAX_BLEND = 0.05;
/** Max blend factor for Echo hover movement each tick. */
export const DE_HOVER_MAX_BLEND = 0.08;
/** Fraction of siphon charge lost when hit interrupts siphon. */
export const DL_SIPHON_HIT_PENALTY_RATIO = 0.5;
/** Inner radius multiplier for siphon contact damage. */
export const DL_SIPHON_DAMAGE_RADIUS_RATIO = 0.7;
/** Ticks spent in Recover state before returning to Approach. */
export const DL_RECOVER_DURATION_TICKS = 60;
/** Velocity drag applied to the Leech each tick while dying. */
export const DL_DEATH_DRAG = 0.85;
/** Velocity drag applied to the Echo each tick while dying. */
export const DE_DEATH_DRAG = 0.80;
/** Amplitude of per-mote body jitter on the Echo (world units). */
export const DE_MOTE_JITTER_WORLD = 0.35;
/** Lerp factor for Echo mote position smoothing. */
export const DE_MOTE_LERP_FACTOR = 0.22;
/** Bob frequency for the Echo (radians/tick). */
export const DE_BOB_FREQ_RAD_PER_TICK = 0.05;
/** Bob amplitude for the Echo (world units). */
export const DE_BOB_AMPLITUDE_WORLD = 1.8;
/** Distance within which the Echo will attempt a lunge (world units). */
export const DE_LUNGE_ACTIVATION_RANGE_WORLD = 80.0;
/** Hit detection radius for the Echo lunge (world units). */
export const DE_LUNGE_HIT_RADIUS_WORLD = 12.0;
/** Small epsilon to guard against division by zero in distance checks. */
export const EPSILON_DISTANCE_WORLD = 0.001;

// ── Death burst constants ─────────────────────────────────────────────────────

export const BURST_ANGLE_JITTER_RAD = 0.45;
export const BURST_SPEED_MIN_WORLD = 0.9;
export const BURST_SPEED_RANGE_WORLD = 1.8;
export const BURST_GRAVITY_BIAS_WORLD = 0.2;
export const BURST_LIFETIME_MIN_TICKS = 18;
export const BURST_LIFETIME_RANGE_TICKS = 16;
