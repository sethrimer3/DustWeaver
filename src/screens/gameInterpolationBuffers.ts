import type { WorldState } from '../sim/world';
import { MAX_FALLING_BLOCK_GROUPS } from '../sim/fallingBlocks/fallingBlockTypes';

export interface GameInterpolationBuffers {
  prevClusterPosX: Float32Array;
  prevClusterPosY: Float32Array;
  prevFallingBlockOffsetY: Float32Array;
}

export function createGameInterpolationBuffers(): GameInterpolationBuffers {
  return {
    prevClusterPosX: new Float32Array(64),
    prevClusterPosY: new Float32Array(64),
    prevFallingBlockOffsetY: new Float32Array(MAX_FALLING_BLOCK_GROUPS),
  };
}

export function captureClusterInterpolationState(
  world: WorldState,
  buffers: GameInterpolationBuffers,
): void {
  const clusterCount = world.clusters.length;
  if (buffers.prevClusterPosX.length < clusterCount) {
    buffers.prevClusterPosX = new Float32Array(clusterCount * 2);
    buffers.prevClusterPosY = new Float32Array(clusterCount * 2);
  }
  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex++) {
    buffers.prevClusterPosX[clusterIndex] = world.clusters[clusterIndex].positionXWorld;
    buffers.prevClusterPosY[clusterIndex] = world.clusters[clusterIndex].positionYWorld;
  }
}

export function captureFallingBlockInterpolationState(
  world: WorldState,
  buffers: GameInterpolationBuffers,
): void {
  const fallingBlockGroupCount = Math.min(world.fallingBlockGroups.length, MAX_FALLING_BLOCK_GROUPS);
  for (let groupIndex = 0; groupIndex < fallingBlockGroupCount; groupIndex++) {
    buffers.prevFallingBlockOffsetY[groupIndex] = world.fallingBlockGroups[groupIndex].offsetYWorld;
  }
}
