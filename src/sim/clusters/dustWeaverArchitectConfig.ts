/**
 * Dust Weaver Architect — tuning constants.
 *
 * All design knobs for AI, block behaviour, and rendering live here so the
 * enemy can be balanced without hunting through logic code.
 */

import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

// ── Capacity ───────────────────────────────────────────────────────────────────

/** Maximum simultaneous Dust Weaver Architect instances per room. */
export const MAX_DUST_WEAVER_ARCHITECTS = 4;

/** Maximum motes per DWA slot (equals large-variant mote count). */
export const MAX_MOTES_PER_DWA = 8;

/** Maximum simultaneous Architect Block entities across all Architects. */
export const MAX_ARCHITECT_BLOCKS = 24;

/** Maximum blocks a single Architect may maintain at once. */
export const DWA_MAX_BLOCKS_PER_ARCHITECT = 8;

// ── Variants ───────────────────────────────────────────────────────────────────

/** Mote count for the small Architect variant. */
export const DWA_SMALL_MOTE_COUNT = 5;

/** Mote count for the large Architect variant. */
export const DWA_LARGE_MOTE_COUNT = 8;

/** Health points for the small Architect. */
export const DWA_SMALL_HP = 18;

/** Health points for the large Architect. */
export const DWA_LARGE_HP = 30;

/** Hitbox half-width for both variants (world units). */
export const DWA_HALF_W = 6.0;

/** Hitbox half-height for both variants (world units). */
export const DWA_HALF_H = 6.0;

// ── AI / movement ─────────────────────────────────────────────────────────────

/** Distance at which the Architect activates and begins building (world units). */
export const DWA_ACTIVATION_RANGE_WORLD = 160.0;

/** Max drift from spawn point (world units). */
export const DWA_LEASH_RADIUS_WORLD = 64.0;

/** Max hover speed toward idle drift target (world units/tick). */
export const DWA_HOVER_SPEED = 0.55;

/** Velocity drag factor applied each tick (1 = no drag). */
export const DWA_VELOCITY_DRAG = 0.88;

/** Ticks spent in Idle (cooldown) between build cycles. */
export const DWA_BUILD_COOLDOWN_TICKS = 220;

/** Ticks spent telegraphing before blocks materialise. */
export const DWA_TELEGRAPH_DURATION_TICKS = 72;

/** Ticks spent in the Build state (materialisation). */
export const DWA_BUILD_DURATION_TICKS = 24;

/** Ticks spent in Recover before returning to Idle. */
export const DWA_RECOVER_DURATION_TICKS = 42;

/** Total ticks of the Dying state (then cluster removed). */
export const DWA_DEATH_DURATION_TICKS = 52;

// ── Motes ──────────────────────────────────────────────────────────────────────

/** Orbit radius around the core during Idle (world units). */
export const DWA_MOTE_ORBIT_RADIUS_WORLD = 13.0;

/** Angular speed during Idle (radians/tick). */
export const DWA_MOTE_ORBIT_SPEED_RAD_PER_TICK = 0.046;

/** Pulse frequency for mote brightness (radians/tick). */
export const DWA_MOTE_PULSE_FREQ_RAD_PER_TICK = 0.072;

/** Bob amplitude of the Architect core (world units). */
export const DWA_BOB_AMPLITUDE_WORLD = 2.5;

/** Bob frequency (radians/tick). */
export const DWA_BOB_FREQ_RAD_PER_TICK = 0.022;

/** Stretch factor for motes toward the build site during Telegraph [0..1]. */
export const DWA_MOTE_STRETCH_FACTOR = 0.55;

// ── Architect Blocks ───────────────────────────────────────────────────────────

/** Half-width of one Architect Block (world units; half of BLOCK_SIZE_SMALL). */
export const DWA_BLOCK_HALF_W = BLOCK_SIZE_SMALL / 2;

/** Half-height of one Architect Block (world units). */
export const DWA_BLOCK_HALF_H = BLOCK_SIZE_SMALL / 2;

/** HP for a block spawned by the small variant. */
export const DWA_BLOCK_HP_SMALL = 3;

/** HP for a block spawned by the large variant. */
export const DWA_BLOCK_HP_LARGE = 5;

/** Ticks before an Architect Block begins its crumble decay. */
export const DWA_BLOCK_LIFETIME_TICKS = 420;

/** Ticks after spawn where the block cannot damage the player. */
export const DWA_BLOCK_GRACE_TICKS = 30;

/** Ticks the forming animation lasts (state 0 → active). */
export const DWA_BLOCK_FORM_TICKS = 22;

/** Ticks the crumble animation lasts before removal. */
export const DWA_BLOCK_CRUMBLE_TICKS = 28;

/** Contact damage dealt to the player by an active block. */
export const DWA_BLOCK_CONTACT_DAMAGE = 2;

/** Player invulnerability ticks after taking block contact damage. */
export const DWA_BLOCK_IFRAMES_TICKS = 45;

/** Radius within which a player-owned particle damages a block (world units). */
export const DWA_BLOCK_HIT_RADIUS_WORLD = 5.5;

// ── Build patterns ─────────────────────────────────────────────────────────────

/**
 * Build patterns as arrays of [dxBlocks, dyBlocks] offsets from the build-site
 * center.  Each unit equals one BLOCK_SIZE_SMALL (8 world units).
 *
 * Small/normal variant patterns (indices 0–4):
 *   0 = Wall Segment horizontal  (3 blocks)
 *   1 = Wall Segment vertical    (3 blocks)
 *   2 = Step Cluster             (stair, 3 blocks)
 *   3 = Cage Fragment            (L-shape, 3 blocks — always open on one side)
 *   4 = Shard Pillar             (2 blocks vertical)
 *
 * Large variant patterns (indices 5–10, 5+ blocks each):
 *   5 = Wide Wall                (5-block horizontal — broad barrier)
 *   6 = Staggered Barricade      (5-block offset horizontal pair — always a gap)
 *   7 = Partial Cage             (5-block U with escape gap on top)
 *   8 = Stepped Wall             (4-block ascending stair — always navigable)
 *   9 = Wide Broken Barrier      (4-block with 1-block gap in the middle)
 *  10 = Two-Part Pressure        (2 + 2 separated pillars)
 *
 * Patterns MUST always leave a navigable escape: no enclosed cages.
 */
export const DWA_PATTERNS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  /* 0 */ [[-1, 0], [0, 0], [1, 0]],                                 // horizontal wall
  /* 1 */ [[0, -1], [0, 0], [0, 1]],                                  // vertical wall
  /* 2 */ [[-1, 0], [0, -1], [1, -2]],                               // step cluster
  /* 3 */ [[-1, 0], [-1, -1], [0, -1]],                              // cage fragment (L)
  /* 4 */ [[0, -1], [0, 0]],                                          // shard pillar
  /* 5 */ [[-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0]],               // wide wall (5 horizontal)
  /* 6 */ [[-2, 0], [-1, 0], [1, -1], [2, -1], [0, 0]],             // staggered barricade (two rows offset)
  /* 7 */ [[-2, 0], [-2, -1], [-1, -1], [1, -1], [2, 0]],           // partial cage U (open top — always escapable)
  /* 8 */ [[-2, 1], [-1, 0], [0, -1], [1, -2]],                     // stepped wall (4 blocks ascending)
  /* 9 */ [[-2, 0], [-1, 0], [1, 0], [2, 0]],                       // wide broken barrier (4 blocks, 1-block gap at center)
  /* 10 */ [[-2, -1], [-2, 0], [2, -1], [2, 0]],                    // two-part pressure (two pillars)
];

/**
 * Pattern indices available to the normal/small variant.
 * Small patterns only — keeps normal Architects from placing oversized structures.
 */
export const DWA_NORMAL_PATTERN_INDICES: ReadonlyArray<number> = [0, 1, 2, 3, 4];

/**
 * Pattern indices available to the large variant.
 * Weighted toward the large patterns (5–10) but occasionally uses small ones.
 * The large patterns appear twice to raise their relative probability.
 */
export const DWA_LARGE_PATTERN_INDICES: ReadonlyArray<number> = [
  5, 5, 6, 6, 7, 7, 8, 8, 9, 10,  // large patterns (weighted 2×)
  0, 1, 2, 3,                       // small patterns (occasional variety)
];

// ── Placement validation ────────────────────────────────────────────────────────

/** Minimum distance between a new block center and the player center (world units). */
export const DWA_BLOCK_MIN_DIST_FROM_PLAYER_WORLD = 18.0;

/** Margin kept from room edges (world units). */
export const DWA_ROOM_EDGE_MARGIN_WORLD = 10.0;

/** Maximum distance of build site from the Architect (world units). */
export const DWA_BUILD_SITE_MAX_DIST_WORLD = 100.0;

/** Minimum distance of build site from the Architect (world units). */
export const DWA_BUILD_SITE_MIN_DIST_WORLD = 28.0;

// ── Hit flash ──────────────────────────────────────────────────────────────────

/** Ticks the Architect flashes bright when hit (core glow pulse). */
export const DWA_HIT_FLASH_TICKS = 8;

// ── Dust Nail secondary attack ─────────────────────────────────────────────────

/**
 * Maximum simultaneous Dust Nail projectiles per Architect slot.
 * Total nail slots = MAX_DUST_WEAVER_ARCHITECTS * MAX_NAILS_PER_DWA.
 */
export const MAX_NAILS_PER_DWA = 3;

/**
 * Minimum player distance (world units) before the range-pressure timer starts.
 * Roughly 10 medium blocks.  Below this distance the nail attack does not trigger.
 */
export const DWA_NAIL_MIN_RANGE_WORLD = 80.0;

/**
 * Ticks the player must stay outside DWA_NAIL_MIN_RANGE_WORLD before a nail fires.
 * ~2 seconds at 60 fps.
 */
export const DWA_NAIL_RANGE_PRESSURE_TICKS = 120;

/**
 * Cooldown ticks after firing a nail before the next one can be fired.
 * ~3 seconds at 60 fps — keeps nail attacks infrequent.
 */
export const DWA_NAIL_COOLDOWN_TICKS = 180;

/** Speed of a Dust Nail projectile (world units/tick). */
export const DWA_NAIL_SPEED_WORLD = 1.6;

/** Lifetime of a Dust Nail (ticks) before it despawns. */
export const DWA_NAIL_LIFETIME_TICKS = 240;

/** Radius of a Dust Nail for player-hit detection (world units). */
export const DWA_NAIL_HIT_RADIUS_WORLD = 4.0;

/** Damage dealt to the player by a Dust Nail hit. */
export const DWA_NAIL_DAMAGE = 2;

/** Player invulnerability ticks after a Dust Nail hit. */
export const DWA_NAIL_IFRAMES_TICKS = 45;

// ── Debug ──────────────────────────────────────────────────────────────────────

/** Set to true to enable debug overlay (activation range, state, build sites, nail cooldowns). */
export const DWA_DEBUG_ENABLED = false;
