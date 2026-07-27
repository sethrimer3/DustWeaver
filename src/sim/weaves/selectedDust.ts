/**
 * Authoritative dust kind selection setter.
 *
 * Replaces the legacy queue-animation based dust type switch mechanism.
 * Setting selectedDustKind immediately updates the elemental effects (e.g. Ice Aura)
 * and UI display without triggering per-slot particle animations.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';

export function setSelectedDustKind(world: WorldState, kind: ParticleKind): void {
  world.selectedDustKind = kind;
}
