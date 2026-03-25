import { WorldState } from '../world';
import { createSpatialGrid, clearGrid, insertParticle, queryNeighbors } from '../spatial/grid';
import type { SpatialGrid } from '../spatial/grid';

export const PARTICLE_RADIUS_WORLD = 4.0;
const REPEL_RANGE_WORLD = 20.0;
const REPEL_STRENGTH = 50.0;
const CONTACT_DIST_WORLD = PARTICLE_RADIUS_WORLD * 2.0;

// Module-level singleton spatial grid - allocated once, never per-frame
const sharedSpatialGrid: SpatialGrid = createSpatialGrid(REPEL_RANGE_WORLD * 2);

// Pre-allocated scratch for pending destruction
const scratchDestroyA = new Int32Array(512);
const scratchDestroyB = new Int32Array(512);
let scratchDestroyCount = 0;

export function applyInterParticleForces(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    forceX, forceY, isAliveFlag, ownerEntityId, particleCount, clusters
  } = world;

  clearGrid(sharedSpatialGrid);
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 1) {
      insertParticle(sharedSpatialGrid, i, positionXWorld[i], positionYWorld[i]);
    }
  }

  scratchDestroyCount = 0;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];
    const ownerI = ownerEntityId[i];

    const neighborCount = queryNeighbors(sharedSpatialGrid, px, py, REPEL_RANGE_WORLD);

    for (let ni = 0; ni < neighborCount; ni++) {
      const j = sharedSpatialGrid.queryResult[ni];
      if (j <= i) continue;
      if (isAliveFlag[j] === 0) continue;

      const ownerJ = ownerEntityId[j];

      const dx = positionXWorld[j] - px;
      const dy = positionYWorld[j] - py;
      const distSq = dx * dx + dy * dy;
      if (distSq < 0.0001) continue;
      const dist = Math.sqrt(distSq);

      if (dist < CONTACT_DIST_WORLD && ownerI !== ownerJ) {
        if (scratchDestroyCount < 512) {
          scratchDestroyA[scratchDestroyCount] = i;
          scratchDestroyB[scratchDestroyCount] = j;
          scratchDestroyCount++;
        }
        continue;
      }

      if (dist < REPEL_RANGE_WORLD) {
        const force = REPEL_STRENGTH * (1.0 - dist / REPEL_RANGE_WORLD) / dist;
        const fx = -dx * force;
        const fy = -dy * force;
        forceX[i] += fx;
        forceY[i] += fy;
        forceX[j] -= fx;
        forceY[j] -= fy;
      }
    }
  }

  for (let k = 0; k < scratchDestroyCount; k++) {
    const ai = scratchDestroyA[k];
    const bi = scratchDestroyB[k];
    if (isAliveFlag[ai] === 1 && isAliveFlag[bi] === 1) {
      isAliveFlag[ai] = 0;
      isAliveFlag[bi] = 0;
      const ownerA = ownerEntityId[ai];
      const ownerB = ownerEntityId[bi];
      for (let ci = 0; ci < clusters.length; ci++) {
        if (clusters[ci].entityId === ownerA || clusters[ci].entityId === ownerB) {
          if (clusters[ci].healthPoints > 0) clusters[ci].healthPoints -= 1;
          if (clusters[ci].healthPoints <= 0) clusters[ci].isAliveFlag = 0;
        }
      }
    }
  }
}
