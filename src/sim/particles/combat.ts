/**
 * Combat forces — attack launch and block shield positioning.
 *
 * This module is the public-facing orchestrator.  The implementation is split
 * across playerCombat.ts and enemyCombat.ts for maintainability.
 */

import { WorldState } from '../world';
import { triggerAttackLaunch, tickAttackMode, applyBlockForces } from './playerCombat';
import { triggerEnemyAttackLaunch, applyEnemyBlockForces } from './enemyCombat';

/**
 * Main entry point called from tick.ts.
 * Handles attack trigger, attack mode tick-down, and block shield forces
 * for both the player and all enemy clusters.
 */
export function applyCombatForces(world: WorldState): void {
  // ---- Player attack trigger (one-shot) -----------------------------------
  if (world.playerAttackTriggeredFlag === 1) {
    triggerAttackLaunch(world);
    world.playerAttackTriggeredFlag = 0;
  }

  // ---- Enemy attack triggers (set each tick by enemyAi.ts) ---------------
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isPlayerFlag === 1 || cluster.isAliveFlag === 0) continue;
    if (cluster.enemyAttackTriggeredFlag === 1) {
      triggerEnemyAttackLaunch(world, cluster.entityId,
        cluster.enemyAttackDirXWorld, cluster.enemyAttackDirYWorld);
      cluster.enemyAttackTriggeredFlag = 0;
    }
  }

  // ---- Per-tick attack mode forces (fire loops, spirals, etc.) -----------
  tickAttackMode(world);

  // ---- Block shield forces (player + blocking enemies) -------------------
  applyBlockForces(world);
  applyEnemyBlockForces(world);
}
