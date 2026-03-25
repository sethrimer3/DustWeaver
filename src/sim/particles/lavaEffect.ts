/**
 * Lava AoE burn effect.
 *
 * Each alive Lava particle periodically damages all non-ally particles
 * within a burn radius.  This represents the intense heat radiating from
 * molten rock — enemy particles close to lava slowly lose durability.
 *
 * Called as step 4.6 in the tick pipeline (after combat, before inter-particle).
 */

import { WorldState } from '../world';
import { ParticleKind } from './kinds';
import { getElementProfile } from './elementProfiles';

/** Radius around each lava particle that deals burn damage (world units). */
export const LAVA_BURN_RADIUS_WORLD = 24.0;

/** Damage per tick to each affected particle within the burn radius. */
const LAVA_BURN_DAMAGE_PER_TICK = 0.035;

export function applyLavaEffect(world: WorldState): void {
  const {
    isAliveFlag, kindBuffer, positionXWorld, positionYWorld,
    ownerEntityId, particleDurability, respawnDelayTicks,
    particleCount,
  } = world;

  const burnRadiusSq = LAVA_BURN_RADIUS_WORLD * LAVA_BURN_RADIUS_WORLD;

  // For each alive Lava particle, burn nearby enemy-owned particles
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (kindBuffer[i] !== ParticleKind.Lava) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];
    const ownerI = ownerEntityId[i];

    for (let j = 0; j < particleCount; j++) {
      if (j === i) continue;
      if (isAliveFlag[j] === 0) continue;
      if (ownerEntityId[j] === ownerI) continue;      // same team — no friendly burn
      if (ownerEntityId[j] === -1) continue;          // Fluid / unowned — skip
      if (kindBuffer[j] === ParticleKind.Fluid) continue;

      const dx = positionXWorld[j] - px;
      const dy = positionYWorld[j] - py;
      if (dx * dx + dy * dy > burnRadiusSq) continue;

      // Apply burn damage
      particleDurability[j] -= LAVA_BURN_DAMAGE_PER_TICK;
      if (particleDurability[j] <= 0) {
        isAliveFlag[j] = 0;
        respawnDelayTicks[j] = getElementProfile(kindBuffer[j]).regenerationRateTicks;
      }
    }
  }
}
