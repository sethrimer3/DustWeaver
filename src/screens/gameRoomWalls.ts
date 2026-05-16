/**
 * gameRoomWalls.ts — Room wall loader.
 *
 * Converts editor-placed wall tiles into runtime AABB wall arrays, running an
 * iterative merge pass to eliminate internal seam edges that cause ghost
 * collisions.  Also exports `resolveWallSoundHardnessIndex`, shared by the
 * hazard and falling-block loaders.
 *
 * Extracted from gameRoom.ts to keep each loading concern in its own module.
 */

import type { WorldState } from '../sim/world';
import { MAX_WALLS } from '../sim/world';
import {
  type RoomDef,
  BLOCK_SIZE_MEDIUM,
  blockThemeToIndex,
  blockSoundHardnessToIndex,
  blockThemeToSoundHardness,
  WALL_THEME_DEFAULT_INDEX,
} from '../levels/roomDef';

/** Epsilon used when deciding whether wall edges are contiguous during merge. */
const WALL_MERGE_EPSILON_WORLD = 0.001;

/**
 * Returns the packed sound-hardness index for a wall, resolving in priority
 * order: explicit per-wall override → room-level override → theme-derived default.
 */
export function resolveWallSoundHardnessIndex(
  room: RoomDef,
  wallTheme: string | undefined,
  explicitHardness: RoomDef['soundHardness'],
): number {
  if (explicitHardness !== undefined) return blockSoundHardnessToIndex(explicitHardness);
  if (room.soundHardness !== undefined) return blockSoundHardnessToIndex(room.soundHardness);
  return blockSoundHardnessToIndex(blockThemeToSoundHardness(wallTheme ?? room.blockTheme));
}

/**
 * Loads wall definitions from a RoomDef into the WorldState wall buffers.
 * After converting block units to world units, runs an iterative merge pass
 * that combines axis-aligned, contiguous wall rectangles into larger AABBs.
 * This eliminates internal seam edges that cause ghost collisions.
 *
 * COLLISION AUTHORITY:
 *   The merged rectangles produced here are the AUTHORITATIVE source of solid
 *   geometry at runtime.  Individual tile boundaries are not stored separately.
 *   Merging produces exact integer boundaries (BLOCK_SIZE_MEDIUM = 6 wu), so
 *   there are no subpixel gaps between adjacent merged solids.
 *
 *   Raycasts, grapple anchor placement, and LOS checks use these merged AABBs
 *   directly — they are NOT a "broad-phase only" approximation.  The merged
 *   representation is exact for solid walls because same-theme neighbours are
 *   fused into a single rectangle, and different-theme neighbours share integer
 *   boundaries with zero gap.
 *
 *   The only scenario where a merged rectangle is less precise than the tile
 *   grid is when two tiles of DIFFERENT themes share a face (they are not
 *   merged); in that case the shared face is an exact integer boundary so
 *   raycasts still return the correct normal.
 */
export function loadRoomWalls(world: WorldState, room: RoomDef): void {
  const rawCount = Math.min(room.walls.length, MAX_WALLS);

  // Pre-allocated merge workspace (avoid per-call allocation)
  // We use simple arrays here because this runs only at room load, not per-tick.
  const xs: number[] = [];
  const ys: number[] = [];
  const ws: number[] = [];
  const hs: number[] = [];
  const fs: number[] = []; // isPlatformFlag (0 or 1)
  const pe: number[] = []; // platformEdge (0=top,1=bottom,2=left,3=right)
  const ts: number[] = []; // themeIndex
  const sh: number[] = []; // soundHardnessIndex
  const iv: number[] = []; // isInvisibleFlag (0 or 1)
  const ro: number[] = []; // rampOrientationIndex (255 = not a ramp)
  const ph: number[] = []; // isPillarHalfWidthFlag (0 or 1)

  // Convert block units to world units
  for (let wi = 0; wi < rawCount; wi++) {
    const def = room.walls[wi];
    const isHalfWidthPillar = def.isPillarHalfWidthFlag === 1;
    // Half-width pillars use half BLOCK_SIZE_MEDIUM for width; minimum is still enforced per-axis.
    const rawWWorld = isHalfWidthPillar
      ? Math.max(BLOCK_SIZE_MEDIUM / 2, def.wBlock * (BLOCK_SIZE_MEDIUM / 2))
      : Math.max(BLOCK_SIZE_MEDIUM, def.wBlock * BLOCK_SIZE_MEDIUM);
    xs.push(def.xBlock * BLOCK_SIZE_MEDIUM);
    ys.push(def.yBlock * BLOCK_SIZE_MEDIUM);
    ws.push(rawWWorld);
    hs.push(Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM));
    fs.push(def.isPlatformFlag === 1 ? 1 : 0);
    pe.push(def.platformEdge ?? 0);
    ts.push(def.blockTheme !== undefined ? blockThemeToIndex(def.blockTheme) : WALL_THEME_DEFAULT_INDEX);
    sh.push(resolveWallSoundHardnessIndex(room, def.blockTheme, def.soundHardness));
    iv.push(def.isInvisibleFlag === 1 ? 1 : 0);
    ro.push(def.rampOrientation !== undefined ? def.rampOrientation : 255);
    ph.push(isHalfWidthPillar ? 1 : 0);
  }

  // ── Iterative merge pass ─────────────────────────────────────────────────
  // Two rectangles may merge if they share a complete face AND have the same
  // isPlatformFlag (platform walls must not merge with solid walls).
  // Ramps (ro !== 255) and half-width pillars (ph === 1) are never merged.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        // Only merge walls of the same type (both solid or both platform) and same theme
        if (fs[i] !== fs[j]) continue;
        if (ts[i] !== ts[j]) continue;
        if (sh[i] !== sh[j]) continue;
        if (iv[i] !== iv[j]) continue;
        // Never merge ramps or half-width pillars
        if (ro[i] !== 255 || ro[j] !== 255) continue;
        if (ph[i] !== 0 || ph[j] !== 0) continue;
        // Horizontal merge: same Y, same H, contiguous on X axis
        if (
          Math.abs(ys[i] - ys[j]) <= WALL_MERGE_EPSILON_WORLD &&
          Math.abs(hs[i] - hs[j]) <= WALL_MERGE_EPSILON_WORLD
        ) {
          const leftI = xs[i];
          const rightI = xs[i] + ws[i];
          const leftJ = xs[j];
          const rightJ = xs[j] + ws[j];
          const hasOverlapOrTouch =
            rightI >= leftJ - WALL_MERGE_EPSILON_WORLD &&
            rightJ >= leftI - WALL_MERGE_EPSILON_WORLD;
          if (hasOverlapOrTouch) {
            const mergedLeft = leftI < leftJ ? leftI : leftJ;
            const mergedRight = rightI > rightJ ? rightI : rightJ;
            xs[i] = mergedLeft;
            ws[i] = mergedRight - mergedLeft;
            ys[i] = ys[i] < ys[j] ? ys[i] : ys[j];
            hs[i] = hs[i] > hs[j] ? hs[i] : hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); sh.splice(j, 1); iv.splice(j, 1);
            ro.splice(j, 1); ph.splice(j, 1);
            merged = true;
            break;
          }
        }
        // Vertical merge: same X, same W, contiguous on Y axis
        if (
          Math.abs(xs[i] - xs[j]) <= WALL_MERGE_EPSILON_WORLD &&
          Math.abs(ws[i] - ws[j]) <= WALL_MERGE_EPSILON_WORLD
        ) {
          const topI = ys[i];
          const bottomI = ys[i] + hs[i];
          const topJ = ys[j];
          const bottomJ = ys[j] + hs[j];
          const hasOverlapOrTouch =
            bottomI >= topJ - WALL_MERGE_EPSILON_WORLD &&
            bottomJ >= topI - WALL_MERGE_EPSILON_WORLD;
          if (hasOverlapOrTouch) {
            const mergedTop = topI < topJ ? topI : topJ;
            const mergedBottom = bottomI > bottomJ ? bottomI : bottomJ;
            ys[i] = mergedTop;
            hs[i] = mergedBottom - mergedTop;
            xs[i] = xs[i] < xs[j] ? xs[i] : xs[j];
            ws[i] = ws[i] > ws[j] ? ws[i] : ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); sh.splice(j, 1); iv.splice(j, 1);
            ro.splice(j, 1); ph.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
      if (merged) break;
    }
  }

  // Write merged rectangles into wall buffers
  const finalCount = Math.min(xs.length, MAX_WALLS);
  world.wallCount = finalCount;
  for (let wi = 0; wi < finalCount; wi++) {
    world.wallXWorld[wi] = xs[wi];
    world.wallYWorld[wi] = ys[wi];
    world.wallWWorld[wi] = ws[wi];
    world.wallHWorld[wi] = hs[wi];
    world.wallIsPlatformFlag[wi] = fs[wi];
    world.wallPlatformEdge[wi] = pe[wi];
    world.wallThemeIndex[wi] = ts[wi];
    world.wallSoundHardnessIndex[wi] = sh[wi];
    world.wallIsInvisibleFlag[wi] = iv[wi];
    world.wallRampOrientationIndex[wi] = ro[wi];
    world.wallIsPillarHalfWidthFlag[wi] = ph[wi];
    world.wallIsBouncePadFlag[wi] = 0;
    world.wallBouncePadSpeedFactorIndex[wi] = 0;
  }
}
