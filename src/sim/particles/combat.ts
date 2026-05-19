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
 *
 * ARCHITECTURE NOTE — Legacy player attack/block paths:
 *   `triggerAttackLaunch` fires only when `playerAttackTriggeredFlag === 1`.
 *   `applyBlockForces` fires only when `isPlayerBlockingFlag === 1`.
 *   As of BUILD 359, neither flag is set by any input handler — all
 *   player-facing combat now routes through `applyPlayerWeaveCombat` (weaves)
 *   and `applyInterParticleForces` (core contact + enemy-to-player damage).
 *   These two functions remain in the pipeline because:
 *     • `tickAttackMode` is still needed to drive enemy attack-mode particles
 *       (mode=1, set by enemy AI in enemyAi.ts).
 *     • The flag-gated player paths are no-ops every tick and impose
 *       negligible cost.
 *   See combatDustPolishDecisions.md for the full audit.
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
