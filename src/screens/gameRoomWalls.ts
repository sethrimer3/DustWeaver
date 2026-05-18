/**
 * gameRoomWalls.ts — Room wall loader.
 *
 * Converts editor-placed wall tiles into runtime AABB wall arrays, running an
 * iterative merge pass to eliminate internal seam edges that cause ghost
 * collisions.  Also exports `resolveWallSoundHardnessIndex`, shared by the
 * hazard and falling-block loaders.
 *
 * Extracted from gameRoom.ts to keep each loading concern in its own module.
 *
 * BUILD 357: Added `RoomWallTemplate`, `buildRoomWallTemplate`, and
 * `applyRoomWallTemplate` to support caching the expensive merge-pass result.
 * `loadRoomWalls` is retained as a compatibility wrapper that builds and
 * immediately applies a fresh template.
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

// ── RoomWallTemplate ──────────────────────────────────────────────────────────

/**
 * Immutable snapshot of the merged wall geometry for a single room.
 * Produced by `buildRoomWallTemplate()` and consumed by `applyRoomWallTemplate()`.
 * Arrays are sized to `wallCount` (the actual post-merge count), not MAX_WALLS,
 * so cached templates are memory-efficient even for large rooms.
 */
export interface RoomWallTemplate {
  readonly wallCount: number;
  readonly xWorld: Float32Array;
  readonly yWorld: Float32Array;
  readonly wWorld: Float32Array;
  readonly hWorld: Float32Array;
  readonly isPlatformFlag: Uint8Array;
  readonly platformEdge: Uint8Array;
  readonly themeIndex: Uint8Array;
  readonly soundHardnessIndex: Uint8Array;
  readonly isInvisibleFlag: Uint8Array;
  readonly rampOrientationIndex: Uint8Array;
  readonly isPillarHalfWidthFlag: Uint8Array;
}

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
 * Builds a `RoomWallTemplate` by running the full conversion + iterative merge
 * pass on `room`.  The result is immutable and safe to cache across frames.
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
 *
 * Call once per room (or once per editor edit) and cache the result.
 * Use `applyRoomWallTemplate()` to copy the cached data into `WorldState`.
 */
export function buildRoomWallTemplate(room: RoomDef): RoomWallTemplate {
  const rawCount = Math.min(room.walls.length, MAX_WALLS);

  // Merge workspace — plain arrays; this runs once per cache miss, not per tick.
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

  // Pack into compact typed arrays sized to the actual merged count.
  const finalCount = Math.min(xs.length, MAX_WALLS);
  const template: RoomWallTemplate = {
    wallCount: finalCount,
    xWorld:               new Float32Array(finalCount),
    yWorld:               new Float32Array(finalCount),
    wWorld:               new Float32Array(finalCount),
    hWorld:               new Float32Array(finalCount),
    isPlatformFlag:       new Uint8Array(finalCount),
    platformEdge:         new Uint8Array(finalCount),
    themeIndex:           new Uint8Array(finalCount),
    soundHardnessIndex:   new Uint8Array(finalCount),
    isInvisibleFlag:      new Uint8Array(finalCount),
    rampOrientationIndex: new Uint8Array(finalCount),
    isPillarHalfWidthFlag: new Uint8Array(finalCount),
  };
  for (let wi = 0; wi < finalCount; wi++) {
    template.xWorld[wi]               = xs[wi];
    template.yWorld[wi]               = ys[wi];
    template.wWorld[wi]               = ws[wi];
    template.hWorld[wi]               = hs[wi];
    template.isPlatformFlag[wi]       = fs[wi];
    template.platformEdge[wi]         = pe[wi];
    template.themeIndex[wi]           = ts[wi];
    template.soundHardnessIndex[wi]   = sh[wi];
    template.isInvisibleFlag[wi]      = iv[wi];
    template.rampOrientationIndex[wi] = ro[wi];
    template.isPillarHalfWidthFlag[wi] = ph[wi];
  }
  return template;
}

/**
 * Copies a pre-built `RoomWallTemplate` into the `WorldState` wall buffers.
 *
 * This is a fast O(n) copy — no merge pass runs here.  Call after retrieving
 * a cached template from `RoomRuntimeCache`.
 *
 * `wallIsBouncePadFlag` and `wallBouncePadSpeedFactorIndex` are reset to 0
 * for all copied walls; `loadRoomHazards` (Phase E) will overwrite specific
 * indices for any bounce-pad hazards in the room.
 */
export function applyRoomWallTemplate(world: WorldState, template: RoomWallTemplate): void {
  const n = template.wallCount;
  world.wallCount = n;
  for (let wi = 0; wi < n; wi++) {
    world.wallXWorld[wi]               = template.xWorld[wi];
    world.wallYWorld[wi]               = template.yWorld[wi];
    world.wallWWorld[wi]               = template.wWorld[wi];
    world.wallHWorld[wi]               = template.hWorld[wi];
    world.wallIsPlatformFlag[wi]       = template.isPlatformFlag[wi];
    world.wallPlatformEdge[wi]         = template.platformEdge[wi];
    world.wallThemeIndex[wi]           = template.themeIndex[wi];
    world.wallSoundHardnessIndex[wi]   = template.soundHardnessIndex[wi];
    world.wallIsInvisibleFlag[wi]      = template.isInvisibleFlag[wi];
    world.wallRampOrientationIndex[wi] = template.rampOrientationIndex[wi];
    world.wallIsPillarHalfWidthFlag[wi] = template.isPillarHalfWidthFlag[wi];
    world.wallIsBouncePadFlag[wi]      = 0;
    world.wallBouncePadSpeedFactorIndex[wi] = 0;
  }
}

/**
 * Loads wall definitions from a RoomDef into the WorldState wall buffers.
 * Compatibility wrapper around `buildRoomWallTemplate` + `applyRoomWallTemplate`.
 * Prefer `buildRoomWallTemplate` when you want to cache the result.
 */
export function loadRoomWalls(world: WorldState, room: RoomDef): void {
  applyRoomWallTemplate(world, buildRoomWallTemplate(room));
}
