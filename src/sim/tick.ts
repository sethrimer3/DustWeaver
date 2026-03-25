import { WorldState } from './world';
import { applyBindingForces } from './clusters/binding';
import { applyInterParticleForces } from './particles/forces';
import { integrateParticles } from './particles/integration';

export function tick(world: WorldState): void {
  for (let i = 0; i < world.particleCount; i++) {
    world.forceX[i] = 0;
    world.forceY[i] = 0;
  }

  applyBindingForces(world);
  applyInterParticleForces(world);
  integrateParticles(world);

  world.tick++;
}
