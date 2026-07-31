/**
 * Verdant Dust mobility identity — shared predicate and tuning multipliers.
 *
 * While Verdant Dust (`ParticleKind.Nature`) is the player's authoritative
 * equipped/selected dust type, ground movement becomes faster (grounded max
 * speed and grounded horizontal acceleration are doubled) and skid-jump /
 * wall-jump launch velocities are boosted (1.5x on both axes), while the
 * grapple becomes unusable — input does nothing, and equipping Verdant while
 * an existing grapple is active triggers an immediate, safe release.
 *
 * Centralizing the predicate and multiplier constants here (rather than
 * scattering `world.selectedDustKind === ParticleKind.Nature` checks and
 * magic numbers across movement/grapple files) keeps the multipliers easy to
 * audit and guarantees every call site derives from the same authoritative
 * "is Verdant equipped" definition and the same normal tuned constants.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';

/** Grounded walking max speed and grounded horizontal acceleration multiplier. */
export const VERDANT_GROUND_SPEED_MULTIPLIER = 2.0;

/** Skid-jump and wall-jump launch velocity multiplier (both axes). */
export const VERDANT_JUMP_LAUNCH_MULTIPLIER = 1.5;

/**
 * True when Verdant Dust is the player's authoritative equipped/selected
 * dust type. This is the single predicate every Verdant mobility system
 * (grapple suppression, ground-speed doubling, jump-launch boosting, and the
 * render-only afterimage trail / flower cosmetics) must derive from.
 */
export function isVerdantDustEquipped(world: WorldState): boolean {
  return world.selectedDustKind === ParticleKind.Nature;
}
