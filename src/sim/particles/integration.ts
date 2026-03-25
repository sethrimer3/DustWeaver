import { WorldState } from '../world';

export function integrateParticles(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    massKg,
    isAliveFlag,
    particleCount,
    dtMs,
  } = world;

  const dtSec = dtMs / 1000.0;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const invMass = massKg[i] > 0 ? 1.0 / massKg[i] : 0;

    velocityXWorld[i] += forceX[i] * invMass * dtSec;
    velocityYWorld[i] += forceY[i] * invMass * dtSec;

    positionXWorld[i] += velocityXWorld[i] * dtSec;
    positionYWorld[i] += velocityYWorld[i] * dtSec;
  }
}
