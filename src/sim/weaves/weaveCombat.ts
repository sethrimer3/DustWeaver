/**
 * Weave Combat System — Storm, Shield, and Arrow weaves.
 *
 * Storm Weave: passive attraction of nearby unowned Gold Dust to the player.
 * Shield Weave: crescent formation of player dust in the aimed direction.
 * Arrow Weave: charge-and-release arrow that sticks into terrain and damages enemies.
 */

import { WorldState } from '../world';
import { tickSecondaryWeaveCoordinator } from './secondaryWeaveCoordinator';

/**
 * Applies weave combat forces and state updates for the player each tick.
 * Called from tick.ts.
 *
 * Routes player secondary action gestures through the canonical SecondaryWeaveCoordinator.
 * Legacy combat-mote queue and ordinary-particle shield crescent have been abolished.
 */
export function applyPlayerWeaveCombat(world: WorldState): void {
  tickSecondaryWeaveCoordinator(world);
}
