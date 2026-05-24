/**
 * Dust Block Mimic — tuning constants.
 *
 * All numeric design knobs for both AI and rendering live here so the enemy
 * can be balanced without hunting through logic code.
 */

// ── Variants ──────────────────────────────────────────────────────────────────

/** Mote count for the small (1×1) variant. */
export const DBM_SMALL_MOTE_COUNT = 8;
/** Mote count for the large (2×2) variant. */
export const DBM_LARGE_MOTE_COUNT = 14;

/** HP for the small variant. */
export const DBM_SMALL_HP = 6;
/** HP for the large variant. */
export const DBM_LARGE_HP = 14;

/** Dormant hitbox half-width for the small variant (world units, ~1 block). */
export const DBM_SMALL_BLOCK_HALF_W = 8.0;
/** Dormant hitbox half-width for the large variant (world units, ~2 blocks). */
export const DBM_LARGE_BLOCK_HALF_W = 16.0;
/** Dormant hitbox half-height (same as half-width for square blocks). */
export const DBM_SMALL_BLOCK_HALF_H = 8.0;
export const DBM_LARGE_BLOCK_HALF_H = 16.0;

// ── Activation ────────────────────────────────────────────────────────────────

/** Range at which a dormant mimic wakes up (world units). */
export const DBM_ACTIVATION_RANGE_WORLD = 80.0;

// ── Wake shake ────────────────────────────────────────────────────────────────

/** Duration of the wake shake animation (ticks). */
export const DBM_WAKE_DURATION_TICKS = 35;

/** Peak pixel shake amplitude during wake (world units). */
export const DBM_WAKE_SHAKE_AMP_WORLD = 2.5;

// ── Burst ─────────────────────────────────────────────────────────────────────

/** Ticks for motes to fly outward from block centre before settling. */
export const DBM_BURST_DURATION_TICKS = 30;

/** Outward burst speed applied to each mote at burst start (world units/tick). */
export const DBM_BURST_SPEED = 4.0;

// ── Active idle ───────────────────────────────────────────────────────────────

/** Active swarm hitbox radius (world units). */
export const DBM_ACTIVE_HITBOX_RADIUS = 14.0;

/** Bob amplitude (world units). */
export const DBM_BOB_AMPLITUDE_WORLD = 3.0;

/** Bob frequency (radians/tick). */
export const DBM_BOB_FREQ_RAD_PER_TICK = 0.032;

/** Leash distance: swarm returns to spawn if farther than this (world units). */
export const DBM_LEASH_RADIUS_WORLD = 56.0;

// ── Mote motion ───────────────────────────────────────────────────────────────

/** Spring blend pulling active motes toward their formation targets (per tick). */
export const DBM_MOTE_SPRING_BLEND = 0.08;

/** Jitter impulse magnitude (world units/tick). */
export const DBM_MOTE_JITTER_SPEED = 10.0;

/** Mote pulse frequency (radians/tick). */
export const DBM_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.08;

/** Extra orbital radius layered on top of formation during active idle. */
export const DBM_MOTE_ORBIT_RADIUS_WORLD = 5.0;

/** Mote orbit angular speed (radians/tick). */
export const DBM_MOTE_ORBIT_RAD_PER_TICK = 0.025;

// ── Telegraph ─────────────────────────────────────────────────────────────────

/** Ticks for the pre-attack telegraph (motes compress into a wedge). */
export const DBM_TELEGRAPH_DURATION_TICKS = 40;

/** Attack cooldown ticks between attacks. */
export const DBM_ATTACK_COOLDOWN_TICKS = 160;

// ── Shard Rush attack ─────────────────────────────────────────────────────────

/** Speed of the shard rush lunge (world units/tick). */
export const DBM_SHARD_RUSH_SPEED = 5.0;

/** Maximum distance of the lunge (world units). */
export const DBM_SHARD_RUSH_DISTANCE_WORLD = 44.0;

/** Damage dealt during the shard rush. */
export const DBM_SHARD_RUSH_DAMAGE = 1;

/** Invulnerability ticks granted after a shard rush hit. */
export const DBM_SHARD_RUSH_IFRAMES_TICKS = 60;

/** Half-width of the shard rush damage hitbox (world units). */
export const DBM_SHARD_RUSH_HIT_HALF_W = 10.0;
/** Half-height of the shard rush damage hitbox (world units). */
export const DBM_SHARD_RUSH_HIT_HALF_H = 8.0;

// ── Recover ───────────────────────────────────────────────────────────────────

/** Ticks for the post-attack recovery (motes slow and rejoin). */
export const DBM_RECOVER_DURATION_TICKS = 50;

// ── Hit feedback ──────────────────────────────────────────────────────────────

/** Ticks the core flash lasts on a hit. */
export const DBM_HIT_FLASH_TICKS = 20;

/** Mote scatter impulse on hit (world units/tick). */
export const DBM_HIT_SCATTER_SPEED = 1.8;

// ── Death burst ───────────────────────────────────────────────────────────────

/** Particle count for the death burst. */
export const DBM_DEATH_BURST_COUNT = 18;

/** Speed of death burst particles (world units/tick). */
export const DBM_DEATH_BURST_SPEED = 3.2;

/** Ticks for the death animation (inward collapse then outward burst). */
export const DBM_DEATH_DURATION_TICKS = 45;

/** Ticks until the outward burst fires (inward collapse phase). */
export const DBM_DEATH_BURST_TICK = 18;

// ── Capacity ──────────────────────────────────────────────────────────────────

/** Maximum simultaneous Dust Block Mimic instances. */
export const MAX_DUST_BLOCK_MIMICS = 4;

/** Maximum motes per slot (equals large variant count). */
export const MAX_MOTES_PER_DBM = DBM_LARGE_MOTE_COUNT;

// ── Formation offsets (normalised, −1..1; multiply by half-size at runtime) ──

/**
 * Small variant mote formation — 8 motes arranged as corners + edge-midpoints
 * of a 1×1 block, treated as dust fragments.
 * Index layout: 0=TL, 1=TC, 2=TR, 3=ML, 4=MR, 5=BL, 6=BC, 7=BR
 * (T=top, B=bottom, M=mid, L=left, C=centre, R=right)
 */
export const DBM_SMALL_FORMATION_X: readonly number[] = [
  -0.80,  0.00,  0.80,  -0.90,  0.90, -0.80,  0.00,  0.80,
];
export const DBM_SMALL_FORMATION_Y: readonly number[] = [
  -0.80, -0.90, -0.80,   0.00,  0.00,  0.80,  0.90,  0.80,
];

/**
 * Large variant mote formation — 14 motes arranged as fragments of a 2×2 block.
 */
export const DBM_LARGE_FORMATION_X: readonly number[] = [
  -0.85, -0.40,  0.10,  0.55,  0.85,
  -0.85,  0.85,
  -0.85, -0.20,  0.45,  0.85,
  -0.55,  0.00,  0.55,
];
export const DBM_LARGE_FORMATION_Y: readonly number[] = [
  -0.85, -0.85, -0.85, -0.85, -0.85,
  -0.25,  0.25,
   0.55,  0.70,  0.60,  0.55,
  -0.25,  0.00,  0.30,
];

// ── Debug ─────────────────────────────────────────────────────────────────────

/** Set to true to draw debug overlays (activation range, hitboxes, state). */
export const DBM_DEBUG_ENABLED = false;
