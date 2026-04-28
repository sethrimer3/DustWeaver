/**
 * Combat forces — attack launch and block shield positioning.
 *
 * This module is the public-facing orchestrator.  The implementation is split
 * into playerCombat.ts for maintainability.
 */

import { WorldState } from '../world';
import { triggerAttackLaunch, tickAttackMode, applyBlockForces } from './playerCombat';

/**
 * Main entry point called from tick.ts.
 * Handles attack trigger, attack mode tick-down, and block shield forces
 * for the player.
 */
export function applyCombatForces(world: WorldState): void {
  // ---- Player attack trigger (one-shot) -----------------------------------
  if (world.playerAttackTriggeredFlag === 1) {
    triggerAttackLaunch(world);
    world.playerAttackTriggeredFlag = 0;
  }

  // ---- Per-tick attack mode forces (fire loops, spirals, etc.) -----------
  tickAttackMode(world);

  // ---- Block shield forces (player) ---------------------------------------
  applyBlockForces(world);
}
