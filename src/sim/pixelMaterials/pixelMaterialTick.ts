/**
 * Tick entry point for the pixel-material simulation, called once per fixed
 * sim step from `sim/tick.ts` (the tick pipeline itself is already the fixed
 * timestep — see ARCHITECTURE.md's accumulator loop in gameScreen.ts).
 */

import type { WorldState } from '../world';

export function tickPixelMaterials(world: WorldState): void {
  world.pixelMaterialSystem.step();
}
