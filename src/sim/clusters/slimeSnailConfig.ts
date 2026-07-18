/**
 * slimeSnailConfig.ts — centralized tuning constants for the Slime Snail enemy.
 *
 * `MAX_SLIME_SNAILS` and `SLIME_SNAIL_TRAIL_STRIDE` intentionally mirror the
 * raw numbers used to size the WorldState trail ring-buffer arrays in
 * `src/sim/worldHazardState.ts` (`MAX_SLIME_SNAILS`, `SLIME_SNAIL_TRAIL_COUNT`).
 * They're duplicated rather than imported to avoid a circular import between
 * worldHazardState.ts (which must allocate arrays eagerly) and this file;
 * a test in slimeSnail.test.ts asserts the two stay in sync.
 */

/** Maximum number of slime snails alive per room. */
export const MAX_SLIME_SNAILS = 8;

/** Number of trail ring-buffer slots per slime snail. */
export const SLIME_SNAIL_TRAIL_STRIDE = 20;

/** Starting/max health points of a slime snail. */
export const SLIME_SNAIL_HP = 2;

/** Half-width of the snail's AABB (world units). */
export const SLIME_SNAIL_HALF_WIDTH_WORLD = 4;

/** Half-height of the snail's AABB (world units). */
export const SLIME_SNAIL_HALF_HEIGHT_WORLD = 3;

/** Crawl speed along a surface, world units per second. ~1 tile (8 world units) per second. */
export const SLIME_SNAIL_CRAWL_SPEED_WORLD_PER_SEC = 8;

/** Distance the snail's body center is held out from the surface it's attached to (world units). */
export const SLIME_SNAIL_SURFACE_OFFSET_WORLD = 3;

/** Radius of the quarter-circle arc used to round corners (world units). */
export const SLIME_SNAIL_CORNER_RADIUS_WORLD = 3;

/** Slime trail record lifetime, in sim ticks. 15 sec @ 60 ticks/sec. */
export const SLIME_SNAIL_TRAIL_LIFETIME_TICKS = 15 * 60;

/** Visual thickness of a freshly-deposited slime segment, world pixels. */
export const SLIME_SNAIL_TRAIL_FRESH_THICKNESS_WORLD = 3;

/** Epsilon (world units) used when testing whether a grapple hit point lies within an active slime segment. */
export const SLIME_SNAIL_TRAIL_HIT_EPSILON_WORLD = 0.35;
