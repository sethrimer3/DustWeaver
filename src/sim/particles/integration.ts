/**
 * Euler integration with per-element drag.
 *
 * Each tick:
 *   1. Apply drag:    velocity *= max(0, 1 − drag × dtSec)
 *   2. Accelerate:    velocity += (force / mass) × dtSec
 *   3. Translate:     position += velocity × dtSec
 *
 * Drag is applied first so it doesn't cancel the forces accumulated this
 * tick, giving more responsive feel at high drag values.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';
import { BEHAVIOR_MODE_DUST_SWITCH_RECALL } from './dustSwitchBehaviorMode';
import { BEHAVIOR_MODE_BOW_ARROW } from './bowArrowBehaviorMode';
import { BEHAVIOR_MODE_SWORD_SLASH } from './swordSlashBehaviorMode';

export function integrateParticles(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    massKg, kindBuffer,
    isAliveFlag, behaviorMode,
    particleCount,
    dtMs,
  } = world;

  const dtSec = dtMs / 1000.0;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    // Recalling dust-switch motes are fully position/velocity-managed by
    // dustTypeSwitch.ts's custom steering (with its own segment-crossing
    // test) — skip normal integration so the two systems don't fight.
    if (behaviorMode[i] === BEHAVIOR_MODE_DUST_SWITCH_RECALL) continue;
    // Bow arrow motes are fully position/velocity-managed by bowArrow.ts
    // (assembly line + outbound flight) — skip normal integration.
    if (behaviorMode[i] === BEHAVIOR_MODE_BOW_ARROW) continue;
    // Sword crescent motes are fully position-managed by swordWeave.ts.
    if (behaviorMode[i] === BEHAVIOR_MODE_SWORD_SLASH) continue;

    const profile = getElementProfile(kindBuffer[i]);

    // ---- Drag -----------------------------------------------------------
    const dragFactor = Math.max(0.0, 1.0 - profile.drag * dtSec);
    velocityXWorld[i] *= dragFactor;
    velocityYWorld[i] *= dragFactor;

    // ---- Acceleration ---------------------------------------------------
    const invMass = massKg[i] > 0 ? 1.0 / massKg[i] : 0;
    velocityXWorld[i] += forceX[i] * invMass * dtSec;
    velocityYWorld[i] += forceY[i] * invMass * dtSec;

    // ---- Translation ----------------------------------------------------
    positionXWorld[i] += velocityXWorld[i] * dtSec;
    positionYWorld[i] += velocityYWorld[i] * dtSec;
  }
}
