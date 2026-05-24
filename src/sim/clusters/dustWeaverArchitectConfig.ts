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
 *   0 = Wall Segment horizontal  (3 blocks)
 *   1 = Wall Segment vertical    (3 blocks)
 *   2 = Step Cluster             (stair, 3 blocks)
 *   3 = Cage Fragment            (L-shape, 3 blocks — always open on one side)
 *   4 = Shard Pillar             (2 blocks vertical)
 */
export const DWA_PATTERNS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  /* 0 */ [[-1, 0], [0, 0], [1, 0]],           // horizontal wall
  /* 1 */ [[0, -1], [0, 0], [0, 1]],            // vertical wall
  /* 2 */ [[-1, 0], [0, -1], [1, -2]],          // step cluster
  /* 3 */ [[-1, 0], [-1, -1], [0, -1]],         // cage fragment (L)
  /* 4 */ [[0, -1], [0, 0]],                     // shard pillar
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

/** Ticks the Architect flashes white when hit. */
export const DWA_HIT_FLASH_TICKS = 6;

// ── Debug ──────────────────────────────────────────────────────────────────────

/** Set to true to enable debug overlay (activation range, state, build sites). */
export const DWA_DEBUG_ENABLED = false;
