/**
 * Main simulation tick pipeline.
 *
 * Order matters — each pass reads forces accumulated by previous passes:
 *   1. Clear forces
 *   2. Per-element forces (noise, curl, buoyancy)          → elementForces.ts
 *   3. Fluid disturbance: decay + push from fast neighbours → disturbance.ts
 *   4. Owner-anchor binding + orbital swirl                → binding.ts
 *   5. Inter-particle (repulsion, cohesion, sep, align)    → forces.ts
 *   6. Euler integration with drag                         → integration.ts
 *   7. Lifetime update + respawn                           → lifetime.ts
 *   8. Increment tick counter
 */

import { WorldState } from './world';
import { applyElementForces } from './particles/elementForces';
import { applyFluidDisturbance } from './particles/disturbance';
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

  // 3. Fluid disturbance: decay + excite from fast nearby particles
  applyFluidDisturbance(world);

  // 4. Owner-anchor spring + orbital tangential force
  applyBindingForces(world);

  // 5. Inter-particle: repulsion (different owners) + boid (same owner)
  applyInterParticleForces(world);

  // 6. Euler integration with per-element drag
  integrateParticles(world);

  // 7. Lifetime: age particles; respawn expired ones
  updateParticleLifetimes(world);

  world.tick++;
}
