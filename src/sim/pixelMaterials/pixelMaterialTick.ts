/**
 * Tick entry point for the pixel-material simulation, called once per fixed
 * sim step from `sim/tick.ts` (the tick pipeline itself is already the fixed
 * timestep — see ARCHITECTURE.md's accumulator loop in gameScreen.ts).
 */

import type { WorldState } from '../world';
import { PLAYER_HALF_WIDTH_WORLD, PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';

export function tickPixelMaterials(world: WorldState): void {
  // Player-impact sandstone fracture — runs before the material step so
  // newly fractured sand particles start falling in the same tick.
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  if (
    player !== undefined &&
    player.isPlayerFlag === 1 &&
    player.isAliveFlag === 1
  ) {
    world.pixelMaterialSystem.applyPlayerImpactFracture(
      player.positionXWorld,
      player.positionYWorld,
      player.halfWidthWorld > 0 ? player.halfWidthWorld : PLAYER_HALF_WIDTH_WORLD,
      player.halfHeightWorld > 0 ? player.halfHeightWorld : PLAYER_HALF_HEIGHT_WORLD,
      player.velocityXWorld,
      player.velocityYWorld,
      world.tick,
    );
  }

  world.pixelMaterialSystem.step();
}
