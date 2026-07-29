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
import { applyRadiantWebAI } from './clusters/radiantWebAi';
import { applyCrimsonWizardAI } from './clusters/crimsonWizardAi';
import { tickCrimsonWizardEffects } from './clusters/crimsonWizardEffects';
import { applyHeraldAI } from './clusters/heraldAi';
import { tickPhantasmalGeometry, tickVoidSpheres } from './clusters/heraldEffects';
import { applyIceWizardAI } from './clusters/iceWizardAi';
import { tickIceSpikes } from './clusters/iceWizardEffects';
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
import { updateMomentumCombatState, applyMomentumCombatCollisionDamage } from './momentumCombat';
import { getCombatMode } from './combatMode';
import { applyHazards, computePlayerWaterState } from './hazards';
import { updateTimeStopFieldPlayerState } from './timeStopField/timeStopFieldPlayerState';
import { tickGrasshoppers } from './critters/grasshopper';
import { applySlimeAI, applyLargeSlimeAI } from './clusters/slimeAi';
import { applyWheelEnemyAI } from './clusters/wheelEnemyAi';
import { applyBeetleAI } from './clusters/beetleAi';
import { applyBubbleAI, applyBubblePopForces } from './clusters/bubbleAi';
import { applySquareStampedeAI } from './clusters/squareStampedeAi';
import { applyGoldenMimicAI } from './clusters/goldenMimicAi';
import { applyGridBlockEnemyAI, applyGridSnakeEnemyAI } from './clusters/gridBlockEnemyAi';
import { applySlimeSnailAI, tickSlimeSnailTrails } from './clusters/slimeSnailAi';
import { recordAndMoveShadowEnemies, resolveShadowFatalContacts } from './clusters/shadowEnemyAi';
import { applyNeedleUrchinAI, tickNeedleUrchinProjectiles } from './clusters/needleUrchinAi';
import { applyMomentumTurretAI } from './clusters/momentumTurretAi';
import { applyBeeSwarmAI } from './clusters/beeSwarmAi';
import { applyWebSpiderAI } from './clusters/webSpiderAi';
import { applyDustConstellationAI } from './clusters/dustConstellationAi';
import { applyOrbitalDustCoreAI } from './clusters/orbitalDustCoreAi';
import { applyDustBlockMimicAI } from './clusters/dustBlockMimicAi';
import { applyDustWeaverArchitectAI } from './clusters/dustWeaverArchitectAi';
import { applyVoidSingularityAI } from './clusters/voidSingularityAi';
import { applyDustLeechAI } from './clusters/dustLeechAi';
import { applySnakeAI } from './clusters/snakeAi';
import { tickGrappleDisplayRadius } from './clusters/grappleShared';
import { tickRopes } from './ropes/ropeSim';
import { tickFallingBlocks } from './fallingBlocks/fallingBlockSim';
import { tickKineticBlocks } from './kineticBlocks/kineticBlockSim';
import { tickGrappleCarryBlocks } from './grappleCarryBlocks';
import { tickZipMoveBlocks } from './zipMoveBlocks/zipMoveBlockSim';
import { tickIceMoteAura } from './iceMoteAura';
import { tickIceFrostAnimation } from './iceFrost';
import { tickPixelMaterials } from './pixelMaterials/pixelMaterialTick';
import { syncPixelMaterialSolidGeometry } from './pixelMaterials/pixelMaterialSolidSync';
import { applyMovementWindToPixelMaterials } from './pixelMaterials/pixelMaterialMovementWind';
import { applyCustomBlockWindVents } from './pixelMaterials/customBlockWindVents';
import { updateShieldWeaveState } from './stormweave/shieldWeave';
import { getStormweaveMoteCount } from './stormweave/lifeMotes';

export function tick(world: WorldState): void {
  // Sync world.combatMode from the module singleton (which is updated by the pause menu toggle).
  // world.combatMode is the source of truth for all sim code; the singleton is the persistence layer.
  world.combatMode = getCombatMode();
  if (world.grappleAttachFxTicks > 0) world.grappleAttachFxTicks -= 1;
  if (world.grappleProximityBounceTicksLeft > 0) world.grappleProximityBounceTicksLeft -= 1;
  if (world.grappleFailBeamTicksLeft > 0) world.grappleFailBeamTicksLeft -= 1;
  if (world.grappleEmptyFxTicksLeft > 0) world.grappleEmptyFxTicksLeft -= 1;
  if (world.zipImpactFxTicksLeft > 0) world.zipImpactFxTicksLeft -= 1;
  if (world.grappleRechargeRingTicksLeft > 0) world.grappleRechargeRingTicksLeft -= 1;
  if (world.grappleIceBounceTicksLeft > 0) world.grappleIceBounceTicksLeft -= 1;

  // Drain last tick's cracked-block shatter events before this tick's
  // collision sweep (in applyClusterMovement, below) can record new ones.
  // gameScreen reads world.shatterEvent* right after tick() returns.
  world.shatterEventCount = 0;

  // Capture the player's downward velocity BEFORE movement/collision zeroes it
  // on landing.  The tough falling block trigger reads this to detect hard landings.
  {
    const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
    world.playerPrevVelocityYWorld =
      (player !== undefined && player.isPlayerFlag === 1 && player.isAliveFlag === 1)
        ? player.velocityYWorld
        : 0;
  }

  // -0.2. Ice Mote freeze aura — update frozen water zone walls BEFORE
  //        computePlayerWaterState so the frozen mask is current this tick.
  tickIceMoteAura(world);
  tickIceFrostAnimation(world.dtMs);

  // -0.1. Pre-compute water state so playerMovement reads correct flag this tick.
  //        (applyHazards runs after movement and re-applies physics, but the flag
  //         must be set BEFORE movement so gravity reduction uses the current state.)
  computePlayerWaterState(world);

  // 0. Cluster movement — smooth acceleration/deceleration for player and enemies
  applyClusterMovement(world);

  // 0.05. Falling block simulation — state machine tick (after movement so
  //        wall slots are current and playerPrevVelocityYWorld is set)
  if (world.fallingBlockGroups.length > 0) {
    tickFallingBlocks(world, world.dtMs);
  }

  // 0.06. Kinetic block animation phase advancement
  tickKineticBlocks(world);
  tickGrappleCarryBlocks(world);
  tickZipMoveBlocks(world, world.dtMs);

  // 0.065. Keep the pixel-material solid mask in sync with dynamic wall
  //         geometry (falling blocks moving, crumble/breakable blocks being
  //         destroyed) and wake sand near any changed region.
  syncPixelMaterialSolidGeometry(world);

  // 0.066. Movement-driven wind — convert player/enemy velocity into local
  //         wind impulses BEFORE sand steps this tick, so disturbance and
  //         settling happen in the same visual frame.
  world.pixelMaterialSystem.resetWindDiagnostics();
  applyMovementWindToPixelMaterials(world);

  // 0.066b. Custom-block wind vents (Phase 2H) — continuous directional
  //          emitters, same fixed-step wind phase as movement wind, before
  //          sand/water/sandstone step this tick.
  applyCustomBlockWindVents(world);

  // 0.07. Pixel-material simulation (falling sand) — fixed-step, deterministic.
  tickPixelMaterials(world);

  // 0.09. TimeStop Field — connected-region membership + suspended-momentum
  //        capture/release. Runs after this tick's movement/collision has
  //        finalised position and velocity, and before hazards/grapple can
  //        further modify velocity.
  updateTimeStopFieldPlayerState(world);

  // 0.095. Shield Weave geometry — computed after post-movement cluster position
  // is final and before applyHazards so that liquid-surface contact detection
  // this tick uses the current shield arc. Also serves hostile projectile blocking
  // later in this same tick (AI / combat steps).
  {
    const player = world.clusters[0];
    if (player !== undefined && player.isAliveFlag === 1) {
      updateShieldWeaveState(
        world.shieldWeave,
        world.dtMs * 0.001,
        getStormweaveMoteCount(player.healthPoints),
        player.positionXWorld,
        player.positionYWorld,
        player.halfHeightWorld * 2,
        world.playerWeaveAimDirXWorld,
        world.playerWeaveAimDirYWorld,
      );
    } else {
      world.shieldWeave.isHeldRequested = false;
      world.shieldWeave.isActive = false;
      world.shieldWeave.moteCount = 0;
    }
  }

  // 0.1. Environmental hazards — spikes, springs, water buoyancy, lava, breakables, jars, fireflies
  applyHazards(world);

  // 0.15. Rope physics — Verlet integration + constraint relaxation
  tickRopes(world);

  // 0.2. Grapple rope anchor tracking — keep anchor moving with rope segment
  updateGrappleRopeAnchor(world);

  // 0.25. Grapple rope constraint — corrects player cluster position/velocity
  applyGrappleClusterConstraint(world);

  // 0.25b. Grid Block Enemy AI — runs early so momentum combat (below) reads
  //         this tick's grid-aligned positions rather than last tick's.
  applyGridBlockEnemyAI(world);
  applyGridSnakeEnemyAI(world);

  // 0.25c. Slime Snail movement + trail lifetime — runs before momentum combat
  //         so momentum hits use this tick's crawl position; trail lifetime
  //         ticks independent of whether any snail is still alive.
  applySlimeSnailAI(world);
  tickSlimeSnailTrails(world);
  recordAndMoveShadowEnemies(world);

  // 0.26. Momentum combat — must run AFTER grapple so it reads final-frame
  //        post-grapple horizontal velocity.  Phase 1 sets isHighVelocityAttacking;
  //        Phase 2 applies AABB collision damage to overlapping enemies.
  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world);
  resolveShadowFatalContacts(world);
  applyMomentumTurretAI(world);
  applyNeedleUrchinAI(world);
  tickNeedleUrchinProjectiles(world);

  // 0.5. Enemy AI — decide attack / block / dodge for each enemy cluster
  applyEnemyAI(world);

  // 0.5b. Rock Elemental AI — state machine transitions
  applyRockElementalAI(world);

  // 0.5d. Radiant Tether AI — light-chain boss state machine
  applyRadiantTetherAI(world);

  // 0.5d2. Radiant Web AI — web-beam boss state machine
  applyRadiantWebAI(world);

  // 0.5d3. Crimson Wizard AI — hovering fire boss state machine
  applyCrimsonWizardAI(world);

  // 0.5d4. The Herald AI — void wizard boss state machine
  applyHeraldAI(world);

  // 0.5d5. Ice Wizard AI — grid-aligned slam boss state machine
  applyIceWizardAI(world);

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
  applyWebSpiderAI(world);
  applyDustConstellationAI(world);
  applyOrbitalDustCoreAI(world);
  applyDustBlockMimicAI(world);
  applyDustWeaverArchitectAI(world);
  applyVoidSingularityAI(world);
  applyDustLeechAI(world);
  applySnakeAI(world);

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

  // 4.57. Crimson Wizard fire/smoke/projectile buffers
  tickCrimsonWizardEffects(world);

  // 4.58. The Herald — Void Sphere projectile movement/despawn/damage
  tickVoidSpheres(world);
  tickPhantasmalGeometry(world);
  tickIceSpikes(world);

  // 4.6. Lava AoE burn — heat damage to nearby enemy particles
  applyLavaEffect(world);

  // 5. Inter-particle: repulsion (different owners) + boid (same owner)
  applyInterParticleForces(world);

  // 5.5. Wall repulsion forces — push particles away from obstacle geometry
  applyWallForces(world);

  // 6. Euler integration with per-element drag
  integrateParticles(world);

  // 6.5. Wall velocity bounce — reflect particles off wall faces with damping;
  //      stone shatter events are processed here too.
  applyWallBounce(world);

  // 6.8. Floor settle — hard-snap unowned Golden (gold dust pile) particles
  //      to the nearest wall surface so they don't fall through block seams.
  settleFloorDust(world);

  // 6.75. Grapple chain particle update — reposition Gold chain particles along rope
  updateGrappleChainParticles(world);
  // 7. Lifetime: age particles; cycle owned particles or respawn combat-killed ones
  updateParticleLifetimes(world);

  // 7.5. Mote display radius lerp — smooth the grapple influence circle
  tickGrappleDisplayRadius(world);

  world.tick++;
}

// ── Momentum trail helpers ────────────────────────────────────────────────────
