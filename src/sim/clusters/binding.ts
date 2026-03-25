import { WorldState } from '../world';

const ORBIT_SPRING = 0.8;
const ORBIT_DAMPING = 0.05;

export function applyBindingForces(world: WorldState): void {
  const { clusters, positionXWorld, positionYWorld, velocityXWorld, velocityYWorld, forceX, forceY, ownerEntityId, isAliveFlag, particleCount } = world;

  for (let particleIndex = 0; particleIndex < particleCount; particleIndex++) {
    if (isAliveFlag[particleIndex] === 0) continue;

    const ownerId = ownerEntityId[particleIndex];
    let ownerCluster = null;
    for (let ci = 0; ci < clusters.length; ci++) {
      if (clusters[ci].entityId === ownerId) {
        ownerCluster = clusters[ci];
        break;
      }
    }
    if (ownerCluster === null || ownerCluster.isAliveFlag === 0) continue;

    const dx = ownerCluster.positionXWorld - positionXWorld[particleIndex];
    const dy = ownerCluster.positionYWorld - positionYWorld[particleIndex];

    forceX[particleIndex] += dx * ORBIT_SPRING;
    forceY[particleIndex] += dy * ORBIT_SPRING;

    forceX[particleIndex] -= velocityXWorld[particleIndex] * ORBIT_DAMPING;
    forceY[particleIndex] -= velocityYWorld[particleIndex] * ORBIT_DAMPING;
  }
}
