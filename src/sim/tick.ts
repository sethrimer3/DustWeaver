/**
 * Main simulation tick pipeline.
 *
 * Order matters — each pass reads forces accumulated by previous passes:
 *   0.   Cluster movement — smooth acceleration/deceleration   → clusters/movement.ts
 *   0.5. Enemy AI — attack / block / dodge decisions                          → clusters/enemyAi.ts
 *   1.   Clear forces
 *   2.   Per-element forces (noise, curl, buoyancy)                           → elementForces.ts
 *   3.   Fluid disturbance: decay + push from fast neighbours                 → disturbance.ts
 *   4.   Owner-anchor binding + orbital swirl                                 → binding.ts
 *   4.5. Combat forces — attack launch impulse + block shield positioning     → combat.ts
 *   4.6. Lava AoE burn — deals heat damage to nearby enemies                 → lavaEffect.ts
 *   5.   Inter-particle (repulsion, cohesion, sep, align)                     → forces.ts
 *   5.5. Wall repulsion forces — push particles away from obstacle geometry   → walls.ts
 *   6.   Euler integration with drag                                          → integration.ts
 *   6.5. Wall bounce — reflect velocities off wall faces                      → walls.ts
 *   7.   Lifetime update + respawn                                            → lifetime.ts
 *   8.   Increment tick counter
 */

import { WorldState } from './world';
import { applyClusterMovement } from './clusters/movement';
import { applyGrappleClusterConstraint, updateGrappleChainParticles, updateGrappleRopeAnchor } from './clusters/grapple';
import { applyEnemyAI } from './clusters/enemyAi';
import { applyRockElementalAI } from './clusters/rockElementalAi';
import { applyRadiantTetherAI } from './clusters/radiantTetherAi';
import { applyGrappleHunterAI } from './clusters/grappleHunterAi';
import { applyElementForces } from './particles/elementForces';
import { applyFluidDisturbance } from './particles/disturbance';
import { applyBindingForces } from './clusters/binding';
import { applyCombatForces } from './particles/combat';
import { applyLavaEffect } from './particles/lavaEffect';
import { applyInterParticleForces } from './particles/forces';
import { applyWallForces, applyWallBounce, settleFloorDust } from './particles/walls';
import { integrateParticles } from './particles/integration';
import { updateParticleLifetimes } from './particles/lifetime';
import { applyPlayerWeaveCombat } from './weaves/weaveCombat';
import { tickArrows } from './weaves/arrowWeave';
import { applyHazards } from './hazards';
import { tickGrasshoppers } from './critters/grasshopper';
import { applySlimeAI, applyLargeSlimeAI } from './clusters/slimeAi';
import { applyWheelEnemyAI } from './clusters/wheelEnemyAi';
import { applyBeetleAI } from './clusters/beetleAi';
import { applyBubbleAI, applyBubblePopForces } from './clusters/bubbleAi';
import { applySquareStampedeAI } from './clusters/squareStampedeAi';
import { applyGoldenMimicAI } from './clusters/goldenMimicAi';
import { applyBeeSwarmAI } from './clusters/beeSwarmAi';
import {
  syncMoteQueueWithParticles,
  tickMoteSlotRegeneration,
  tickMoteGrappleDisplayRadius,
} from './motes/orderedMoteQueue';
import { tickRopes } from './ropes/ropeSim';
import { tickFallingBlocks } from './fallingBlocks/fallingBlockSim';

export function tick(world: WorldState): void {
  if (world.grappleAttachFxTicks > 0) world.grappleAttachFxTicks -= 1;
  if (world.grappleProximityBounceTicksLeft > 0) world.grappleProximityBounceTicksLeft -= 1;

  // Capture the player's downward velocity BEFORE movement/collision zeroes it
  // on landing.  The tough falling block trigger reads this to detect hard landings.
  {
    const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
    world.playerPrevVelocityYWorld =
      (player !== undefined && player.isPlayerFlag === 1 && player.isAliveFlag === 1)
        ? player.velocityYWorld
        : 0;
  }

  // 0. Cluster movement — smooth acceleration/deceleration for player and enemies
  applyClusterMovement(world);

  // 0.05. Falling block simulation — state machine tick (after movement so
  //        wall slots are current and playerPrevVelocityYWorld is set)
  if (world.fallingBlockGroups.length > 0) {
    tickFallingBlocks(world, world.dtMs);
  }

  // 0.1. Environmental hazards — spikes, springs, water buoyancy, lava, breakables, jars, fireflies
  applyHazards(world);

  // 0.15. Rope physics — Verlet integration + constraint relaxation
  tickRopes(world);

  // 0.2. Grapple rope anchor tracking — keep anchor moving with rope segment
  updateGrappleRopeAnchor(world);

  // 0.25. Grapple rope constraint — corrects player cluster position/velocity
  applyGrappleClusterConstraint(world);

  // 0.5. Enemy AI — decide attack / block / dodge for each enemy cluster
  applyEnemyAI(world);

  // 0.5b. Rock Elemental AI — state machine transitions
  applyRockElementalAI(world);

  // 0.5d. Radiant Tether AI — light-chain boss state machine
  applyRadiantTetherAI(world);

  // 0.5e. Grapple Hunter AI — grapple attack state machine
  applyGrappleHunterAI(world);

  // 0.5f. Slime AI — hop toward player
  applySlimeAI(world);

  // 0.5g. Large Dust Slime AI — slower hops + dust orbit
  applyLargeSlimeAI(world);

  // 0.5h. Wheel Enemy AI — roll along surfaces toward player
  applyWheelEnemyAI(world);

  // 0.5i_pre. Golden Beetle AI — crawl/fly state machine with contact damage
  applyBeetleAI(world);

  // 0.5i. Grasshopper critters — ambient hop + flee
  tickGrasshoppers(world);

  // 0.5j. Bubble Enemy AI — orbit ring maintenance, drift, regen, pop detection
  applyBubbleAI(world);

  // 0.5k. Square Stampede AI — orthogonal dashing, trail update, contact damage
  applySquareStampedeAI(world);

  // 0.5l. Golden Mimic AI — mirror player movement, heap/fade state, contact damage
  applyGoldenMimicAI(world);

  // 0.5m. Bee Swarm AI — orbit swarm pattern, charge/contact damage
  applyBeeSwarmAI(world);

  // 1. Clear accumulated forces from previous tick
  for (let i = 0; i < world.particleCount; i++) {
    world.forceX[i] = 0;
    world.forceY[i] = 0;
  }

  // 1.5. Bubble pop forces — gravity + heat-seeking for popped water particles
  applyBubblePopForces(world);

  // 2. Per-element forces (noise, curl, diffusion, buoyancy)
  applyElementForces(world);

  // 3. Fluid disturbance: decay + excite from fast nearby particles
  applyFluidDisturbance(world);

  // 4. Owner-anchor spring + orbital tangential force
  applyBindingForces(world);

  // 4.5. Combat forces — attack launch and block shield positioning
  applyCombatForces(world);

  // 4.55. Player Weave combat — applies weave activation patterns for bound dust
  applyPlayerWeaveCombat(world);

  // 4.56. Arrow Weave flight update — move arrows, detect wall sticking, apply enemy hit sequences
  tickArrows(world);
  // 4.6. Lava AoE burn — heat damage to nearby enemy particles
  applyLavaEffect(world);

  // 5. Inter-particle: repulsion (different owners) + boid (same owner)
  applyInterParticleForces(world);

  // 5.1. Mote queue sync — detect player particle combat kills → deplete slots
  syncMoteQueueWithParticles(world);

  // 5.5. Wall repulsion forces — push particles away from obstacle geometry
  applyWallForces(world);

  // 6. Euler integration with per-element drag
  integrateParticles(world);

  // 6.5. Wall velocity bounce — reflect particles off wall faces with damping;
  //      stone shatter events are processed here too.
  applyWallBounce(world);

  // 6.8. Floor settle — hard-snap unowned Physical (gold dust pile) particles
  //      to the nearest wall surface so they don't fall through block seams.
  settleFloorDust(world);

  // 6.75. Grapple chain particle update — reposition Gold chain particles along rope
  updateGrappleChainParticles(world);
  // 7. Lifetime: age particles; cycle owned particles or respawn combat-killed ones
  updateParticleLifetimes(world);

  // 7.5. Mote queue regeneration — count down depletion cooldowns → restore slots
  tickMoteSlotRegeneration(world);

  // 7.6. Mote display radius lerp — smooth the grapple influence circle
  tickMoteGrappleDisplayRadius(world);

  world.tick++;
}
