/**
 * Wall repulsion forces.
 *
 * Each wall is an axis-aligned rectangle.  Particles within `WALL_MARGIN_WORLD`
 * units of a wall face receive a repulsion force proportional to their
 * penetration depth.  Particles already inside a wall are pushed out with
 * maximum force to prevent tunnelling.
 *
 * This is step 5.5 of the tick pipeline (after inter-particle forces,
 * before Euler integration).
 */

import { WorldState } from '../world';

/** Distance at which wall repulsion starts (world units). */
const WALL_MARGIN_WORLD = 18.0;
/** Force magnitude at the wall face (fully penetrated). */
const WALL_FORCE_MAX = 2800.0;

export function applyWallForces(world: WorldState): void {
  if (world.wallCount === 0) return;

  const {
    positionXWorld, positionYWorld,
    forceX, forceY,
    isAliveFlag, particleCount,
    wallXWorld, wallYWorld, wallWWorld, wallHWorld, wallCount,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];

    for (let wi = 0; wi < wallCount; wi++) {
      const wx = wallXWorld[wi];
      const wy = wallYWorld[wi];
      const ww = wallWWorld[wi];
      const wh = wallHWorld[wi];

      // Closest point on wall AABB to particle
      const clampedX = px < wx ? wx : px > wx + ww ? wx + ww : px;
      const clampedY = py < wy ? wy : py > wy + wh ? wy + wh : py;

      const dx = px - clampedX;
      const dy = py - clampedY;
      const dist2 = dx * dx + dy * dy;

      if (dist2 >= WALL_MARGIN_WORLD * WALL_MARGIN_WORLD) continue;

      const dist = Math.sqrt(dist2);

      if (dist < 0.001) {
        // Particle is at/inside wall center — push away from wall center
        const wcx = wx + ww * 0.5;
        const wcy = wy + wh * 0.5;
        const fwx = positionXWorld[i] - wcx;
        const fwy = positionYWorld[i] - wcy;
        const fwLen = Math.sqrt(fwx * fwx + fwy * fwy);
        if (fwLen > 0.001) {
          forceX[i] += (fwx / fwLen) * WALL_FORCE_MAX;
          forceY[i] += (fwy / fwLen) * WALL_FORCE_MAX;
        } else {
          forceX[i] += WALL_FORCE_MAX; // degenerate fallback
        }
        continue;
      }

      // Linear ramp: force is WALL_FORCE_MAX at dist=0, 0 at dist=WALL_MARGIN_WORLD
      const strength = WALL_FORCE_MAX * (1.0 - dist / WALL_MARGIN_WORLD);
      forceX[i] += (dx / dist) * strength;
      forceY[i] += (dy / dist) * strength;
    }
  }
}
