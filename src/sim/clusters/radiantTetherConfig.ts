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

/** Ticks the telegraph laser lines rotate before locking. */
export const RT_TELEGRAPH_DURATION_TICKS = 90; // 1.5 s

/** Ticks the lasers stay fixed so the player can react. */
export const RT_LOCK_DURATION_TICKS = 30; // 0.5 s

/** Ticks it takes for chains to reach their anchor after firing. */
export const RT_FIRE_DURATION_TICKS = 6; // ~0.1 s (near-instant)

/** Ticks the boss moves via chain winching before retracting. */
export const RT_MOVEMENT_DURATION_TICKS = 300; // 5 s

/** Ticks of pause between movement end and the next telegraph cycle. */
export const RT_RESET_DURATION_TICKS = 30; // 0.5 s

// ── Telegraph / laser rotation ──────────────────────────────────────────────

/** Angular speed of telegraph lasers (radians/tick). */
export const RT_TELEGRAPH_ROTATION_SPEED_RAD = 0.035;

/** Visual width of telegraph laser line (screen px). */
export const RT_TELEGRAPH_LINE_WIDTH_PX = 1.5;

/** Maximum draw length of telegraph laser (world units). */
export const RT_TELEGRAPH_MAX_RANGE_WORLD = 600.0;

// ── Chain anchoring ─────────────────────────────────────────────────────────

/** Maximum raycast range when searching for anchor terrain (world units). */
export const RT_CHAIN_MAX_RANGE_WORLD = 600.0;

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
export const RT_REEL_SPEED_MIN_WORLD = 0.6;

/** Maximum chain-length change speed (world units/tick). */
export const RT_REEL_SPEED_MAX_WORLD = 2.0;

/**
 * Probability that an individual chain is assigned to "tighten" during
 * a movement cycle.  The rest loosen.  Re-rolled each movement cycle.
 */
export const RT_TIGHTEN_PROBABILITY = 0.5;

/** Minimum allowed chain length during movement (world units). */
export const RT_MIN_CHAIN_LENGTH_WORLD = 30.0;

/** Boss acceleration toward the net force from chain tensions (wu/tick²). */
export const RT_BOSS_ACCEL_WORLD = 0.4;

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
