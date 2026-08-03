/**
 * Authoritative dust kind selection setter.
 *
 * Replaces the legacy queue-animation based dust type switch mechanism.
 * Setting selectedDustKind immediately updates the elemental effects (e.g. Ice Aura)
 * and UI display without triggering per-slot particle animations.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import { releaseGrapple } from '../clusters/grappleShared';

export function setSelectedDustKind(world: WorldState, kind: ParticleKind): void {
  world.selectedDustKind = kind;
  // Dust-specific grapple replacements: equipping Verdant (grapple disabled)
  // or Void (directional dash) while a grapple is active must release it
  // immediately and safely. Uses the existing
  // authoritative release path (same one used by jump-off-grapple, wall
  // hits, etc.) so particle ownership/anchors/constraints/recharge state and
  // release effects are never duplicated or corrupted. `grantCoyoteTime` is
  // left at its default (true) to match ordinary release behavior, and this
  // never consumes/grants a grapple charge — `releaseGrapple` does not touch
  // `hasGrappleChargeFlag`.
  if ((kind === ParticleKind.Nature || kind === ParticleKind.Void) && world.isGrappleActiveFlag === 1) {
    releaseGrapple(world);
  }
}
