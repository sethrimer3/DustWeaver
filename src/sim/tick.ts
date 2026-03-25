/**
 * Main simulation tick pipeline.
 *
 * Order matters — each pass reads forces accumulated by previous passes:
 *   1. Clear forces
 *   2. Per-element forces (noise, curl, buoyancy)          → elementForces.ts
 *   3. Owner-anchor binding + orbital swirl                → binding.ts
 *   4. Inter-particle (repulsion, cohesion, sep, align)    → forces.ts
 *   5. Euler integration with drag                         → integration.ts
 *   6. Lifetime update + respawn                           → lifetime.ts
 *   7. Increment tick counter
 */

import { WorldState } from './world';
import { applyElementForces } from './particles/elementForces';
import { applyBindingForces } from './clusters/binding';
import { applyInterParticleForces } from './particles/forces';
import { integrateParticles } from './particles/integration';
import { updateParticleLifetimes } from './particles/lifetime';

export function tick(world: WorldState): void {
  // 1. Clear accumulated forces from previous tick
  for (let i = 0; i < world.particleCount; i++) {
    world.forceX[i] = 0;
    world.forceY[i] = 0;
  }

  // 2. Per-element forces (noise, curl, diffusion, buoyancy)
  applyElementForces(world);

  // 3. Owner-anchor spring + orbital tangential force
  applyBindingForces(world);

  // 4. Inter-particle: repulsion (different owners) + boid (same owner)
  applyInterParticleForces(world);

  // 5. Euler integration with per-element drag
  integrateParticles(world);

  // 6. Lifetime: age particles; respawn expired ones at their owner
  updateParticleLifetimes(world);

  world.tick++;
}
