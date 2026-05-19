/**
 * kineticBlockSim.ts — Per-tick kinetic block simulation.
 * Advances animation phase for each active kinetic block.
 */

import type { WorldState } from '../world';
import { KINETIC_BLOCK_ANIM_SPEED_PER_TICK } from './kineticBlockTypes';

/**
 * Advances kinetic block animation state by one tick.
 * Each block's animPhase increments, wrapping at 256.
 */
export function tickKineticBlocks(world: WorldState): void {
  const count = world.kineticBlockCount;
  for (let i = 0; i < count; i++) {
    world.kineticBlockAnimPhase[i] = (world.kineticBlockAnimPhase[i] + KINETIC_BLOCK_ANIM_SPEED_PER_TICK) & 255;
  }
}
