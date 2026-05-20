/**
 * Radiant Tether — tunable configuration for the first boss.
 *
 * A floating spherical entity made of light that uses rotating laser
 * telegraphs followed by chains of light anchored to walls.  The boss
 * moves by changing chain lengths (winch behavior) and gains more
 * simultaneous chains as health drops.
 *
 * All timing values are in ticks (60 ticks/sec) unless noted.
 * All distances are in world units (1 wu ≈ 1 pixel at 1× zoom).
 */

// ── Attack-loop phase durations ─────────────────────────────────────────────

// RT_TELEGRAPH_DURATION_TICKS removed — replaced by beam-grow attack system.
// RT_LOCK_DURATION_TICKS removed — replaced by branch-grow phase.

/** Ticks it takes for chains to reach their anchor after firing. */
export const RT_FIRE_DURATION_TICKS = 6; // ~0.1 s (near-instant)

/** Ticks the boss moves via chain winching before retracting. */
export const RT_MOVEMENT_DURATION_TICKS = 300; // 5 s

/** Ticks of pause between movement end and the next beam attack cycle. */
export const RT_RESET_DURATION_TICKS = 30; // 0.5 s

// ── Telegraph / laser rotation — REMOVED ──────────────────────────────────
// RT_TELEGRAPH_ROTATION_SPEED_RAD removed.
// RT_TELEGRAPH_LINE_WIDTH_PX removed.
// RT_TELEGRAPH_MAX_RANGE_WORLD removed.

// ── Wall repulsion ──────────────────────────────────────────────────────────

/** Distance at which wall repulsion begins (world units). */
export const RT_WALL_REPEL_DIST_WORLD = 35.0;

/** Per-tick impulse strength at zero distance (world units/tick). */
export const RT_WALL_REPEL_ACCEL_WORLD = 0.15;

/** Maximum repulsion-induced speed (world units/tick). */
export const RT_WALL_REPEL_MAX_SPEED_WORLD = 4.0;

// ── Main beams (attack) ─────────────────────────────────────────────────────

/** Number of simultaneously active main attack beams. */
export const RT_MAIN_BEAM_COUNT = 3;

/** World units per tick that a main beam grows. */
export const RT_MAIN_BEAM_GROW_SPEED_WORLD = 3.5;

/** Alpha of main beams while growing. */
export const RT_MAIN_BEAM_ALPHA = 0.25;

/** Visual width of main beams (screen px). */
export const RT_MAIN_BEAM_WIDTH_PX = 2.5;

/** Maximum raycast range for main beams (world units). */
export const RT_MAIN_BEAM_MAX_RANGE_WORLD = 350.0;

// ── Branch beams ────────────────────────────────────────────────────────────

/** Number of branch beams per main beam. */
export const RT_BRANCH_BEAMS_PER_MAIN = 2;

/** Angle offset from wall normal for each branch (radians). */
export const RT_BRANCH_BEAM_ANGLE_OFFSET_RAD = Math.PI / 4;

/** World units per tick that a branch beam grows. */
export const RT_BRANCH_BEAM_GROW_SPEED_WORLD = 2.5;

/** Visual width of branch beams (screen px). */
export const RT_BRANCH_BEAM_WIDTH_PX = 1.5;

/** Maximum raycast range for branch beams (world units). */
export const RT_BRANCH_BEAM_MAX_RANGE_WORLD = 200.0;

// ── Energized damage phase ──────────────────────────────────────────────────

/** Ticks branch beams charge up before they can deal damage. */
export const RT_BRANCH_ENERGIZE_DELAY_TICKS = 20;

/** Ticks branch beams stay energized and deal damage. */
export const RT_BRANCH_DAMAGE_TICKS = 90;

/** Damage dealt per hit by an energized or rope branch beam. */
export const RT_BRANCH_DAMAGE = 1;

/** Hitbox half-width of branch beams for player collision (world units). */
export const RT_BRANCH_HITBOX_HALF_WIDTH_WORLD = 3.5;

/** Invulnerability ticks granted after a branch beam hit. */
export const RT_BRANCH_IFRAMES_TICKS = 60;

// ── Dust puffs ──────────────────────────────────────────────────────────────

/** Number of dust puffs at main beam impact points. */
export const RT_MAIN_BEAM_PUFF_COUNT = 5;

/** Lifetime of each dust puff (ticks). */
export const RT_MAIN_BEAM_PUFF_LIFETIME_TICKS = 30;

/** Alpha of dust puffs. */
export const RT_MAIN_BEAM_PUFF_ALPHA = 0.6;

/** Radius of each dust puff (world units). */
export const RT_MAIN_BEAM_PUFF_RADIUS_WORLD = 6.0;

// ── Rope decay chains ───────────────────────────────────────────────────────

/** Ticks before a decaying rope fully fades. */
export const RT_BRANCH_ROPE_LIFETIME_TICKS = 180;

/** Gravity on the free end of a decaying rope (world units/tick²). */
export const RT_BRANCH_ROPE_GRAVITY_WORLD = 0.22;

/** Drag on the free-end velocity of a decaying rope (per tick). */
export const RT_BRANCH_ROPE_DRAG = 0.985;

/** Visual segments for rope rendering (integer). */
export const RT_BRANCH_ROPE_SEGMENTS = 12;

// ── Beam launch angles ───────────────────────────────────────────────────────

/** Max random jitter for the first beam direction (radians = ±15°). */
export const RT_BEAM_JITTER_RAD = Math.PI / 6;

/** Angular spacing between the three beams (radians = 120°). */
export const RT_BEAM_ANGLE_SPACING_RAD = (Math.PI * 2) / 3;

/** Extra per-beam jitter applied to beams 1 and 2 (radians). */
export const RT_SECONDARY_BEAM_JITTER_RAD = 0.3;

// ── Chain anchoring ─────────────────────────────────────────────────────────

/** Maximum raycast range when searching for anchor terrain (world units). */
export const RT_CHAIN_MAX_RANGE_WORLD = 400.0;

/** Step size for raycasting toward walls (world units). */
export const RT_CHAIN_RAYCAST_STEP_WORLD = 2.0;

/** How far chains extend past the wall surface to ensure solid anchor. */
export const RT_ANCHOR_EMBED_WORLD = 4.0;

// ── Chain visuals ───────────────────────────────────────────────────────────

/** Visual sag factor for the catenary curve — higher = more droop. */
export const RT_CHAIN_SAG_FACTOR = 0.15;

/** Number of line segments per chain for the catenary approximation. */
export const RT_CHAIN_VISUAL_SEGMENTS = 16;

/** Line width of active chains (screen px). */
export const RT_CHAIN_LINE_WIDTH_PX = 3.0;

/** Line width of broken chains swinging from walls (screen px). */
export const RT_BROKEN_CHAIN_LINE_WIDTH_PX = 2.5;

// ── Chain movement (winch) ────────────────────────────────────────────────

/** Minimum chain-length change speed (world units/tick). */
export const RT_REEL_SPEED_MIN_WORLD = 0.4;

/** Maximum chain-length change speed (world units/tick). */
export const RT_REEL_SPEED_MAX_WORLD = 1.3;

/**
 * Probability that an individual chain is assigned to "tighten" during
 * a movement cycle.  The rest loosen.  Re-rolled each movement cycle.
 */
export const RT_TIGHTEN_PROBABILITY = 0.5;

/** Minimum allowed chain length during movement (world units). */
export const RT_MIN_CHAIN_LENGTH_WORLD = 20.0;

/** Boss acceleration toward the net force from chain tensions (wu/tick²). */
export const RT_BOSS_ACCEL_WORLD = 0.27;

/** Drag coefficient applied to boss velocity each tick. */
export const RT_BOSS_DRAG = 0.97;

// ── Damage ──────────────────────────────────────────────────────────────────

/** Damage dealt to the player by chain contact (HP). */
export const RT_CHAIN_DAMAGE = 1;

/**
 * Hitbox half-width of each chain segment for player collision (world units).
 * Slightly generous so the visual and hitbox match.
 */
export const RT_CHAIN_HITBOX_HALF_WIDTH_WORLD = 4.0;

/**
 * Invulnerability ticks granted to the player after a chain hit.
 * Prevents rapid multi-hit from overlapping segments.
 */
export const RT_CHAIN_IFRAMES_TICKS = 60; // 1 s

// ── Boss body ───────────────────────────────────────────────────────────────

/** Visual radius of the boss sphere (world units). */
export const RT_BODY_RADIUS_WORLD = 8.0;

/** Half-size of the boss hitbox (world units, square). */
export const RT_BODY_HALF_SIZE_WORLD = 6.0;

// ── Chain-count health thresholds ───────────────────────────────────────────

/**
 * Health percentage thresholds (descending) that trigger chain-count increases.
 * At ≥ threshold[0] HP% → 3 chains, < threshold[0] → 4 chains, etc.
 * 6 thresholds → chain counts 3,4,5,6,7,8
 */
export const RT_CHAIN_COUNT_THRESHOLDS: readonly number[] = [
  0.85, // ≥85% → 3 chains
  0.70, // ≥70% → 4 chains
  0.55, // ≥55% → 5 chains
  0.40, // ≥40% → 6 chains
  0.25, // ≥25% → 7 chains
  // < 25% → 8 chains
];

/** Minimum simultaneous chains. */
export const RT_CHAIN_COUNT_MIN = 3;

/** Maximum simultaneous chains. */
export const RT_CHAIN_COUNT_MAX = 8;

// ── Opposing-chain snap detection ───────────────────────────────────────────

/**
 * Two chains are "opposing" if the angle between their directions from
 * the boss is within π ± this tolerance (radians).
 */
export const RT_SNAP_OPPOSING_ANGLE_TOLERANCE_RAD = 0.35; // ~20°

/**
 * Straightness threshold: if the sum of the two chain current lengths
 * is within this fraction of the boss-to-boss straight-line distance
 * through the anchors, consider it straight.
 */
export const RT_SNAP_STRAIGHTNESS_THRESHOLD = 0.92;

/**
 * Both chains must have their current length below this fraction of
 * their natural length for snap to trigger.
 */
export const RT_SNAP_TENSION_RATIO = 0.55;

// ── Broken-chain behavior ───────────────────────────────────────────────────

/** Lifetime of a broken chain segment before it fades (ticks). */
export const RT_BROKEN_CHAIN_LIFETIME_TICKS = 240; // 4 s

/** Gravity applied to the free end of a broken chain (world units/tick²). */
export const RT_BROKEN_CHAIN_GRAVITY_WORLD = 0.25;

/** Drag on the broken chain's free-end velocity (per tick). */
export const RT_BROKEN_CHAIN_DRAG = 0.98;

/** Maximum number of simultaneously tracked broken chains. */
export const RT_MAX_BROKEN_CHAINS = 16;

// ── Boss HP ─────────────────────────────────────────────────────────────────

/** Particle count for the boss (used with BOSS_HP_MULTIPLIER for total HP). */
export const RT_PARTICLE_COUNT = 50;

// ── Debug visualization ─────────────────────────────────────────────────────

/** When true, draw anchor rays, chain tension arrows, snap detection, and phase label. */
export const RT_DEBUG_ENABLED = false;

// ── Retry / fallback for chains that miss terrain ───────────────────────────

/** Number of rotation offsets to try if a chain direction misses terrain. */
export const RT_FIRE_RETRY_COUNT = 4;

/** Angle offset per retry attempt (radians). */
export const RT_FIRE_RETRY_OFFSET_RAD = 0.15;
