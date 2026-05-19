/**
 * kineticBlockSim.ts — Per-tick kinetic block simulation.
 * Advances animation phase for each active kinetic block.
 */

import type { WorldState } from '../world';

/**
 * Advances kinetic block animation state by one tick.
 * Each block's animPhase increments by 3, wrapping at 256.
 */
export function tickKineticBlocks(world: WorldState): void {
  const count = world.kineticBlockCount;
  for (let i = 0; i < count; i++) {
    world.kineticBlockAnimPhase[i] = (world.kineticBlockAnimPhase[i] + 3) & 255;
  }
}
