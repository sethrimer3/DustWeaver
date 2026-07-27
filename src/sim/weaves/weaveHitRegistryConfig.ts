/**
 * Shared capacity for per-swipe / per-shot enemy hit registries used by the
 * Sword and Bow Weaves (each "how many distinct enemies can this single
 * swipe/shot possibly register a hit against" bitmap).
 *
 * Capacity invariant: clusters at or beyond this index in `world.clusters`
 * are silently excluded from weave hit detection for that tick/swipe/shot —
 * every hit-detection loop in swordWeave.ts and bowArrow.ts explicitly clamps
 * its iteration to `Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS)`
 * so this is a documented, enforced degrade (no out-of-bounds access, no
 * crash), not a silent unbounded risk. No known room configuration in this
 * project approaches 64 simultaneous enemy clusters; raise this constant if
 * that ever changes.
 */
export const MAX_HIT_REGISTRY_SLOTS = 64;
