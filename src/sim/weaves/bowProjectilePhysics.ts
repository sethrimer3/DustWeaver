/**
 * Bow Projectile Physics — shared tier-based speed/gravity/lifetime tables.
 *
 * Extracted so the real fired arrow (arrowWeave.ts / bowWeave.ts) and the
 * future trajectory preview (Stage 5 rendering) both derive their numbers
 * from the exact same source. Deterministic, allocation-free, pure.
 *
 * Tiering is by mote count: 2 = weakest/most-arced, 3 = mid, 4 = strongest
 * straight-line shot. Any other integer count clamps to the nearest tier.
 */

/** Initial speed (world units/s) for each arrow tier. */
const BOW_SPEED_2_WORLD = 180.0;
const BOW_SPEED_3_WORLD = 260.0;
const BOW_SPEED_4_WORLD = 320.0;

/** Downward gravity acceleration (world units/s²) per tier. 0 = straight-line (4-mote). */
const BOW_GRAVITY_2_WS2 = 200.0;
const BOW_GRAVITY_3_WS2 = 140.0;
const BOW_GRAVITY_4_WS2 = 0.0;

/** Stuck-arrow lifetime (ticks) per tier. */
const BOW_LIFETIME_2_TICKS = 300; // 5 s @ 60fps
const BOW_LIFETIME_3_TICKS = 420; // 7 s
const BOW_LIFETIME_4_TICKS = 600; // 10 s

/** Returns the initial launch speed (world units/s) for a given mote-count tier. */
export function getBowSpeedForMoteCount(moteCount: number): number {
  if (moteCount >= 4) return BOW_SPEED_4_WORLD;
  if (moteCount === 3) return BOW_SPEED_3_WORLD;
  return BOW_SPEED_2_WORLD;
}

/** Returns the downward gravity acceleration (world units/s²) for a given mote-count tier. */
export function getBowGravityForMoteCount(moteCount: number): number {
  if (moteCount >= 4) return BOW_GRAVITY_4_WS2;
  if (moteCount === 3) return BOW_GRAVITY_3_WS2;
  return BOW_GRAVITY_2_WS2;
}

/** Returns the stuck-arrow lifetime (ticks) for a given mote-count tier. */
export function getBowLifetimeForMoteCount(moteCount: number): number {
  if (moteCount >= 4) return BOW_LIFETIME_4_TICKS;
  if (moteCount === 3) return BOW_LIFETIME_3_TICKS;
  return BOW_LIFETIME_2_TICKS;
}
