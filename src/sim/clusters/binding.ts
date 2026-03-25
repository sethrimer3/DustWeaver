/**
 * Owner-anchor binding forces.
 *
 * Each particle has a unique anchor point relative to its owner cluster:
 *   anchorTarget = ownerPos + (cos(anchorAngleRad), sin(anchorAngleRad)) * anchorRadiusWorld
 *
 * Two forces are applied:
 *   1. Spring (attraction) toward the anchor target, scaled by attractionStrength.
 *   2. Orbital (tangential) force perpendicular to the owner→particle vector,
 *      scaled by orbitalStrength.  This drives circular orbiting without needing
 *      to rotate the anchor angle each tick.
 *
 * Force magnitudes come from the particle's ElementProfile so each element
 * feels differently "attached" to its owner.
 */

import { WorldState } from '../world';
import { getElementProfile } from '../particles/elementProfiles';

export function applyBindingForces(world: WorldState): void {
  const {
    clusters,
    positionXWorld, positionYWorld,
    forceX, forceY,
    ownerEntityId, isAliveFlag,
    kindBuffer,
    anchorAngleRad, anchorRadiusWorld,
    behaviorMode,
    particleCount,
  } = world;

  for (let particleIndex = 0; particleIndex < particleCount; particleIndex++) {
    if (isAliveFlag[particleIndex] === 0) continue;
    if (behaviorMode[particleIndex] !== 0) continue;

    // Find the owning cluster
    const ownerId = ownerEntityId[particleIndex];
    let ownerX = 0.0;
    let ownerY = 0.0;
    let found = false;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusters[ci].entityId === ownerId && clusters[ci].isAliveFlag === 1) {
        ownerX = clusters[ci].positionXWorld;
        ownerY = clusters[ci].positionYWorld;
        found = true;
        break;
      }
    }
    if (!found) continue;

    const profile = getElementProfile(kindBuffer[particleIndex]);

    // ---- 1. Spring toward anchor target --------------------------------
    const aAngle  = anchorAngleRad[particleIndex];
    const aRadius = anchorRadiusWorld[particleIndex];
    const targetX = ownerX + Math.cos(aAngle) * aRadius;
    const targetY = ownerY + Math.sin(aAngle) * aRadius;

    const dax = targetX - positionXWorld[particleIndex];
    const day = targetY - positionYWorld[particleIndex];
    forceX[particleIndex] += dax * profile.attractionStrength;
    forceY[particleIndex] += day * profile.attractionStrength;

    // ---- 2. Orbital tangential force -----------------------------------
    // Perpendicular to the owner→particle vector drives circular orbit.
    // Using a constant-magnitude force so distance doesn't cause runaway.
    const toOwnerX = ownerX - positionXWorld[particleIndex];
    const toOwnerY = ownerY - positionYWorld[particleIndex];
    const dist = Math.sqrt(toOwnerX * toOwnerX + toOwnerY * toOwnerY);
    if (dist > 0.5) {
      // Tangent: rotate toOwner 90° counter-clockwise
      const invDist = 1.0 / dist;
      const tangentX = -toOwnerY * invDist;
      const tangentY =  toOwnerX * invDist;
      forceX[particleIndex] += tangentX * profile.orbitalStrength;
      forceY[particleIndex] += tangentY * profile.orbitalStrength;
    }
  }
}
