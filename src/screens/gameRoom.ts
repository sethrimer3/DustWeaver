import { WorldState, MAX_WALLS, MAX_DUST_PILES, MAX_FIREFLIES, MAX_BOUNCE_PADS, MAX_ROPES, MAX_ROPE_SEGMENTS, MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS } from '../sim/world';
import { nextFloat, nextFloatTriangle } from '../sim/rng';
import {
  RoomDef,
  BLOCK_SIZE_MEDIUM,
  BLOCK_SIZE_SMALL,
  blockThemeToIndex,
  WALL_THEME_DEFAULT_INDEX,
  PLAYER_HALF_WIDTH_WORLD,
  PLAYER_HALF_HEIGHT_WORLD,
  CrumbleVariant,
  DEFAULT_ROPE_SEGMENT_COUNT,
  ROPE_THICKNESS_HALF_WORLD,
  type FallingBlockVariant,
} from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';
import { initRopeSegments, presettleRopes } from '../sim/ropes/ropeSim';
import { MAX_TILES_PER_GROUP, MAX_LANDING_CONTACTS } from '../sim/fallingBlocks/fallingBlockTypes';
import type { FallingBlockGroup } from '../sim/fallingBlocks/fallingBlockTypes';

const FIREFLY_AREA_SPAWN_SPEED_WORLD = 30.0;

/** Duration (ms) to show health bar after taking damage. */
export const HEALTH_BAR_DISPLAY_MS = 3000;

/** Half-width and half-height (world units) of a flying eye cluster hitbox. */
export const FLYING_EYE_HALF_SIZE_WORLD = 2.8;

/** Blocks of transition tunnel extending past room boundary. */
export const TUNNEL_DETECT_MARGIN_WORLD = 2 * BLOCK_SIZE_MEDIUM;
/** Skillbook sprite size in world units (24×24 px; 3×3 tiles). */
export const SKILLBOOK_SIZE_WORLD = 3 * BLOCK_SIZE_MEDIUM;
/** Pickup radius for skillbook collection. */
export const SKILLBOOK_PICKUP_RADIUS_WORLD = 2.2 * BLOCK_SIZE_MEDIUM;
/** Dust container sprite size in world units (24×24 px). */
export const DUST_CONTAINER_SIZE_WORLD = 3 * BLOCK_SIZE_MEDIUM;
/** Pickup radius for dust container collection. */
export const DUST_CONTAINER_PICKUP_RADIUS_WORLD = 2.2 * BLOCK_SIZE_MEDIUM;
/** Dust particles granted by one Dust Container collectible. */
export const DUST_CONTAINER_DUST_GAIN = 4;
/** Epsilon used when deciding whether wall edges are contiguous during merge. */
const WALL_MERGE_EPSILON_WORLD = 0.001;

/**
 * Maps a `CrumbleVariant` string to a packed integer stored in `crumbleBlockVariant[]`.
 * 0=normal, 1=fire, 2=water, 3=void, 4=ice, 5=lightning, 6=poison, 7=shadow, 8=nature.
 */
const CRUMBLE_VARIANT_INDEX: Readonly<Record<CrumbleVariant, number>> = {
  normal:    0,
  fire:      1,
  water:     2,
  void:      3,
  ice:       4,
  lightning: 5,
  poison:    6,
  shadow:    7,
  nature:    8,
};

/**
 * Loads wall definitions from a RoomDef into the WorldState wall buffers.
 * After converting block units to world units, runs an iterative merge pass
 * that combines axis-aligned, contiguous wall rectangles into larger AABBs.
 * This eliminates internal seam edges that cause ghost collisions.
 *
 * COLLISION AUTHORITY:
 *   The merged rectangles produced here are the AUTHORITATIVE source of solid
 *   geometry at runtime.  Individual tile boundaries are not stored separately.
 *   Merging produces exact integer boundaries (BLOCK_SIZE_MEDIUM = 8 wu), so
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
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); iv.splice(j, 1);
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
            fs.splice(j, 1); pe.splice(j, 1); ts.splice(j, 1); iv.splice(j, 1);
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
    world.wallIsInvisibleFlag[wi] = iv[wi];
    world.wallRampOrientationIndex[wi] = ro[wi];
    world.wallIsPillarHalfWidthFlag[wi] = ph[wi];
    world.wallIsBouncePadFlag[wi] = 0;
    world.wallBouncePadSpeedFactorIndex[wi] = 0;
  }
}


/**
 * Loads environmental hazards from a RoomDef into the WorldState hazard buffers.
 * Called once at room load time, after walls are loaded so breakable blocks can
 * be added as walls and cross-referenced.
 */
export function loadRoomHazards(world: WorldState, room: RoomDef): void {
  // ── Reset all hazard state ────────────────────────────────────────────────
  world.spikeCount = 0;
  world.spikeInvulnTicks = 0;
  world.springboardCount = 0;
  world.waterZoneCount = 0;
  world.lavaZoneCount = 0;
  world.lavaInvulnTicks = 0;
  world.breakableBlockCount = 0;
  world.crumbleBlockCount = 0;
  world.bouncePadCount = 0;
  world.dustBoostJarCount = 0;
  world.fireflyJarCount = 0;
  world.fireflyCount = 0;
  world.isPlayerInWaterFlag = 0;
  world.dustPileCount = 0;

  // ── Spikes ────────────────────────────────────────────────────────────────
  const spikeDefs = room.spikes ?? [];
  for (let i = 0; i < spikeDefs.length && world.spikeCount < world.spikeXWorld.length; i++) {
    const s = spikeDefs[i];
    const si = world.spikeCount++;
    world.spikeXWorld[si] = (s.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.spikeYWorld[si] = (s.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    switch (s.direction) {
      case 'up':    world.spikeDirection[si] = SPIKE_DIR_UP; break;
      case 'down':  world.spikeDirection[si] = SPIKE_DIR_DOWN; break;
      case 'left':  world.spikeDirection[si] = SPIKE_DIR_LEFT; break;
      case 'right': world.spikeDirection[si] = SPIKE_DIR_RIGHT; break;
    }
  }

  // ── Springboards ──────────────────────────────────────────────────────────
  const springDefs = room.springboards ?? [];
  for (let i = 0; i < springDefs.length && world.springboardCount < world.springboardXWorld.length; i++) {
    const s = springDefs[i];
    const si = world.springboardCount++;
    world.springboardXWorld[si] = (s.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.springboardYWorld[si] = (s.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.springboardAnimTicks[si] = 0;
  }

  // ── Water zones ───────────────────────────────────────────────────────────
  const waterDefs = room.waterZones ?? [];
  for (let i = 0; i < waterDefs.length && world.waterZoneCount < world.waterZoneXWorld.length; i++) {
    const w = waterDefs[i];
    const wi = world.waterZoneCount++;
    world.waterZoneXWorld[wi] = w.xBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneYWorld[wi] = w.yBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneWWorld[wi] = w.wBlock * BLOCK_SIZE_MEDIUM;
    world.waterZoneHWorld[wi] = w.hBlock * BLOCK_SIZE_MEDIUM;
  }

  // ── Lava zones ────────────────────────────────────────────────────────────
  const lavaDefs = room.lavaZones ?? [];
  for (let i = 0; i < lavaDefs.length && world.lavaZoneCount < world.lavaZoneXWorld.length; i++) {
    const l = lavaDefs[i];
    const li = world.lavaZoneCount++;
    world.lavaZoneXWorld[li] = l.xBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneYWorld[li] = l.yBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneWWorld[li] = l.wBlock * BLOCK_SIZE_MEDIUM;
    world.lavaZoneHWorld[li] = l.hBlock * BLOCK_SIZE_MEDIUM;
  }

  // ── Breakable blocks ──────────────────────────────────────────────────────
  // Each breakable block is added as a wall AND tracked in the breakable arrays.
  const breakDefs = room.breakableBlocks ?? [];
  for (let i = 0; i < breakDefs.length && world.breakableBlockCount < world.breakableBlockXWorld.length; i++) {
    const b = breakDefs[i];
    const bx = (b.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (b.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;

    // Add as a wall
    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = BLOCK_SIZE_MEDIUM;
    }

    const bi = world.breakableBlockCount++;
    world.breakableBlockXWorld[bi] = bx;
    world.breakableBlockYWorld[bi] = by;
    world.isBreakableBlockActiveFlag[bi] = 1;
    world.breakableBlockWallIndex[bi] = wallIdx;
  }

  // ── Crumble blocks ────────────────────────────────────────────────────────
  // Each crumble block is added as a wall AND tracked in the crumble arrays.
  const crumbleDefs = room.crumbleBlocks ?? [];
  for (let i = 0; i < crumbleDefs.length && world.crumbleBlockCount < world.crumbleBlockXWorld.length; i++) {
    const b = crumbleDefs[i];
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const bx = (b.xBlock + wBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
    const by = (b.yBlock + hBlocks * 0.5) * BLOCK_SIZE_MEDIUM;

    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = wBlocks * BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = hBlocks * BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = b.blockTheme !== undefined
        ? blockThemeToIndex(b.blockTheme)
        : WALL_THEME_DEFAULT_INDEX;
      world.wallIsInvisibleFlag[wallIdx] = 0;
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = 255;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
    }

    const ci = world.crumbleBlockCount++;
    world.crumbleBlockXWorld[ci] = bx;
    world.crumbleBlockYWorld[ci] = by;
    world.isCrumbleBlockActiveFlag[ci] = 1;
    world.crumbleBlockHitsRemaining[ci] = 2;
    world.crumbleBlockHitCooldownTicks[ci] = 0;
    world.crumbleBlockWallIndex[ci] = wallIdx;
    world.crumbleBlockVariant[ci] = CRUMBLE_VARIANT_INDEX[b.variant ?? 'normal'];
  }

  // ── Bounce pads ──────────────────────────────────────────────────────────
  // Each bounce pad is added as a wall AND tracked in the bouncePad* arrays
  // for the renderer. The wall gets wallIsBouncePadFlag=1 so the collision
  // resolver reflects velocity instead of stopping the player.
  const bouncePadDefs = room.bouncePads ?? [];
  for (let i = 0; i < bouncePadDefs.length && world.bouncePadCount < MAX_BOUNCE_PADS; i++) {
    const b = bouncePadDefs[i];
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const sfIndex = b.speedFactorIndex ?? 0;
    const rampOri = b.rampOrientation !== undefined ? b.rampOrientation : 255;

    let wallIdx = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIdx = world.wallCount++;
      world.wallXWorld[wallIdx] = b.xBlock * BLOCK_SIZE_MEDIUM;
      world.wallYWorld[wallIdx] = b.yBlock * BLOCK_SIZE_MEDIUM;
      world.wallWWorld[wallIdx] = wBlocks * BLOCK_SIZE_MEDIUM;
      world.wallHWorld[wallIdx] = hBlocks * BLOCK_SIZE_MEDIUM;
      world.wallThemeIndex[wallIdx] = WALL_THEME_DEFAULT_INDEX;
      world.wallIsInvisibleFlag[wallIdx] = 0;
      world.wallIsPlatformFlag[wallIdx] = 0;
      world.wallPlatformEdge[wallIdx] = 0;
      world.wallRampOrientationIndex[wallIdx] = rampOri;
      world.wallIsPillarHalfWidthFlag[wallIdx] = 0;
      world.wallIsBouncePadFlag[wallIdx] = 1;
      world.wallBouncePadSpeedFactorIndex[wallIdx] = sfIndex;
    }

    const pi = world.bouncePadCount++;
    world.bouncePadXWorld[pi] = b.xBlock * BLOCK_SIZE_MEDIUM;
    world.bouncePadYWorld[pi] = b.yBlock * BLOCK_SIZE_MEDIUM;
    world.bouncePadWWorld[pi] = wBlocks * BLOCK_SIZE_MEDIUM;
    world.bouncePadHWorld[pi] = hBlocks * BLOCK_SIZE_MEDIUM;
    world.bouncePadSpeedFactorIndex[pi] = sfIndex;
    world.bouncePadRampOrientationIndex[pi] = rampOri;
    void wallIdx;
  }

  // ── Dust boost jars ───────────────────────────────────────────────────────
  const dustJarDefs = room.dustBoostJars ?? [];
  for (let i = 0; i < dustJarDefs.length && world.dustBoostJarCount < world.dustBoostJarXWorld.length; i++) {
    const j = dustJarDefs[i];
    const ji = world.dustBoostJarCount++;
    world.dustBoostJarXWorld[ji] = (j.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.dustBoostJarYWorld[ji] = (j.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.isDustBoostJarActiveFlag[ji] = 1;
    world.dustBoostJarKind[ji] = j.dustKind;
    world.dustBoostJarDustCount[ji] = j.dustCount;
  }

  // ── Firefly jars ──────────────────────────────────────────────────────────
  const fireflyJarDefs = room.fireflyJars ?? [];
  for (let i = 0; i < fireflyJarDefs.length && world.fireflyJarCount < world.fireflyJarXWorld.length; i++) {
    const j = fireflyJarDefs[i];
    const ji = world.fireflyJarCount++;
    world.fireflyJarXWorld[ji] = (j.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.fireflyJarYWorld[ji] = (j.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    world.isFireflyJarActiveFlag[ji] = 1;
  }

  // ── Dust piles ──────────────────────────────────────────────────────────
  const dustPileDefs = room.dustPiles ?? [];
  for (let i = 0; i < dustPileDefs.length && world.dustPileCount < MAX_DUST_PILES; i++) {
    const p = dustPileDefs[i];
    const pi = world.dustPileCount++;
    // spreadBlocks is the full width of the spread zone; half of it is used as
    // the triangle distribution amplitude, so positions land within ±(spreadBlocks/2) blocks.
    const spreadHalfWidthWorld = (p.spreadBlocks ?? 0) * 0.5 * BLOCK_SIZE_MEDIUM;
    world.dustPileXWorld[pi] = (p.xBlock + 0.5) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadHalfWidthWorld;
    world.dustPileYWorld[pi] = (p.yBlock + 1.0) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadHalfWidthWorld;
    world.dustPileDustCount[pi] = p.dustCount;
    world.isDustPileActiveFlag[pi] = 1;
  }

  // ── Firefly areas ────────────────────────────────────────────────────────
  const fireflyAreaDefs = room.fireflyAreas ?? [];
  for (const area of fireflyAreaDefs) {
    const halfWidthWorld  = area.wBlock * BLOCK_SIZE_MEDIUM * 0.5;
    const halfHeightWorld = area.hBlock * BLOCK_SIZE_MEDIUM * 0.5;
    const centerXWorld = area.xBlock * BLOCK_SIZE_MEDIUM + halfWidthWorld;
    const centerYWorld = area.yBlock * BLOCK_SIZE_MEDIUM + halfHeightWorld;
    for (let f = 0; f < area.count && world.fireflyCount < MAX_FIREFLIES; f++) {
      const fi = world.fireflyCount++;
      world.fireflyXWorld[fi] = centerXWorld
        + nextFloatTriangle(world.rng) * halfWidthWorld;
      world.fireflyYWorld[fi] = centerYWorld
        + nextFloatTriangle(world.rng) * halfHeightWorld;
      const angleRad = nextFloat(world.rng) * Math.PI * 2;
      world.fireflyVelXWorld[fi] = Math.cos(angleRad) * FIREFLY_AREA_SPAWN_SPEED_WORLD;
      world.fireflyVelYWorld[fi] = Math.sin(angleRad) * FIREFLY_AREA_SPAWN_SPEED_WORLD;
    }
  }
}

/**
 * Converts editor-placed falling block tiles into runtime FallingBlockGroup
 * objects, reserving a wall slot per group in the world wall arrays.
 *
 * Algorithm:
 *  1. Collect all tile positions by variant.
 *  2. Run a flood-fill (BFS) to find orthogonally-connected components of the
 *     same variant — each component becomes one group.
 *  3. For each group, compute the bounding box, reserve a wall slot, and
 *     populate the FallingBlockGroup.
 *
 * Must be called AFTER loadRoomWalls so wall slots start past the static geometry.
 */
export function loadRoomFallingBlocks(world: WorldState, room: RoomDef): void {
  world.fallingBlockGroups = [];

  const tileDefs = room.fallingBlocks ?? [];
  if (tileDefs.length === 0) return;

  // Build a tile lookup by "x,y" key
  type TileEntry = { xBlock: number; yBlock: number; variant: string };
  const tileMap = new Map<string, TileEntry>();
  for (const t of tileDefs) {
    tileMap.set(`${t.xBlock},${t.yBlock}`, { xBlock: t.xBlock, yBlock: t.yBlock, variant: t.variant });
  }

  const visited = new Set<string>();
  let nextGroupId = 0;

  for (const [_key, tile] of tileMap) {
    const startKey = `${tile.xBlock},${tile.yBlock}`;
    if (visited.has(startKey)) continue;

    // BFS to collect the orthogonally-connected component of the same variant
    const queue: TileEntry[] = [tile];
    const component: TileEntry[] = [];
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = [
        { xBlock: current.xBlock + 1, yBlock: current.yBlock },
        { xBlock: current.xBlock - 1, yBlock: current.yBlock },
        { xBlock: current.xBlock,     yBlock: current.yBlock + 1 },
        { xBlock: current.xBlock,     yBlock: current.yBlock - 1 },
      ];
      for (const nb of neighbors) {
        const nk = `${nb.xBlock},${nb.yBlock}`;
        if (visited.has(nk)) continue;
        const nbTile = tileMap.get(nk);
        if (nbTile === undefined || nbTile.variant !== tile.variant) continue;
        visited.add(nk);
        queue.push(nbTile);
      }
    }

    // Compute bounding box of the component
    let minX = component[0].xBlock;
    let minY = component[0].yBlock;
    let maxX = component[0].xBlock;
    let maxY = component[0].yBlock;
    for (const t of component) {
      if (t.xBlock < minX) minX = t.xBlock;
      if (t.yBlock < minY) minY = t.yBlock;
      if (t.xBlock > maxX) maxX = t.xBlock;
      if (t.yBlock > maxY) maxY = t.yBlock;
    }

    const restXWorld = minX * BLOCK_SIZE_MEDIUM;
    const restYWorld = minY * BLOCK_SIZE_MEDIUM;
    const wWorld     = (maxX - minX + 1) * BLOCK_SIZE_MEDIUM;
    const hWorld     = (maxY - minY + 1) * BLOCK_SIZE_MEDIUM;

    // Reserve a wall slot for this group (bounding-box AABB — used by the
    // movement system so the player can stand on the group).
    let wallIndex = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIndex = world.wallCount++;
      world.wallXWorld[wallIndex]              = restXWorld;
      world.wallYWorld[wallIndex]              = restYWorld;
      world.wallWWorld[wallIndex]              = wWorld;
      world.wallHWorld[wallIndex]              = hWorld;
      world.wallIsPlatformFlag[wallIndex]      = 0;
      world.wallPlatformEdge[wallIndex]        = 0;
      world.wallThemeIndex[wallIndex]          = WALL_THEME_DEFAULT_INDEX;
      // Falling block groups render through renderFallingBlocks(). This wall
      // slot exists only for broad collision/movement integration and must
      // stay invisible or the group's bounding box will be drawn as terrain.
      world.wallIsInvisibleFlag[wallIndex]     = 1;
      world.wallRampOrientationIndex[wallIndex]    = 255;
      world.wallIsPillarHalfWidthFlag[wallIndex]   = 0;
      world.wallIsBouncePadFlag[wallIndex]         = 0;
      world.wallBouncePadSpeedFactorIndex[wallIndex] = 0;
    }

    // Clamp to hard cap (editor/importer should enforce this, but be safe)
    const tileCount = Math.min(component.length, MAX_TILES_PER_GROUP);

    // Allocate exact-size arrays so collision shape matches rendered shape.
    const tileRelXWorld = new Float32Array(tileCount);
    const tileRelYWorld = new Float32Array(tileCount);
    const colliderRelXWorld = new Float32Array(tileCount);
    const colliderRelYWorld = new Float32Array(tileCount);
    const colliderWWorld    = new Float32Array(tileCount);
    const colliderHWorld    = new Float32Array(tileCount);

    for (let ti = 0; ti < tileCount; ti++) {
      const relX = (component[ti].xBlock - minX) * BLOCK_SIZE_MEDIUM;
      const relY = (component[ti].yBlock - minY) * BLOCK_SIZE_MEDIUM;
      tileRelXWorld[ti] = relX;
      tileRelYWorld[ti] = relY;
      colliderRelXWorld[ti] = relX;
      colliderRelYWorld[ti] = relY;
      colliderWWorld[ti]    = BLOCK_SIZE_MEDIUM;
      colliderHWorld[ti]    = BLOCK_SIZE_MEDIUM;
    }

    const group: FallingBlockGroup = {
      groupId:               nextGroupId++,
      variant:               tile.variant as FallingBlockVariant,
      restXWorld,
      restYWorld,
      wWorld,
      hWorld,
      tileCount,
      tileRelXWorld,
      tileRelYWorld,
      colliderRectCount:     tileCount,
      colliderRelXWorld,
      colliderRelYWorld,
      colliderWWorld,
      colliderHWorld,
      offsetYWorld:          0,
      velocityYWorld:        0,
      shakeOffsetXWorld:     0,
      state:                 0, // FB_STATE_IDLE_STABLE
      stateTimerTicks:       0,
      hasReachedTopSpeedFlag: 0,
      crumbleTimerTicks:     0,
      lastLandingContactCount: 0,
      lastLandingContactX1World: new Float32Array(MAX_LANDING_CONTACTS),
      lastLandingContactX2World: new Float32Array(MAX_LANDING_CONTACTS),
      lastLandingContactYWorld:  new Float32Array(MAX_LANDING_CONTACTS),
      wallIndex,
      lastTriggerType:       0,
    };

    world.fallingBlockGroups.push(group);
  }
}


// ── Rendering/utility helpers re-exported from gameRoomHelpers.ts ─────────────
// These were previously defined in this file but have been moved to keep
// data-loading code separate from rendering and coordinate utilities.
export { worldBgColor, drawTunnelDarkness, screenToWorld } from './gameRoomHelpers';


// ── Spawn-block safety helpers ────────────────────────────────────────────────

/**
 * Inset from each room edge (in blocks) used when clamping and scanning for a
 * valid player spawn position.  The boundary walls occupy the outermost block
 * strip, so this keeps the spawn clear of them.
 */
const SPAWN_MARGIN_BLOCKS = 2;

/**
 * Returns true if the player's AABB, centred on the given block position,
 * overlaps any solid (non-platform, non-invisible) wall in the room.
 * Ramp walls are treated as solid for the purpose of this check.
 */
function isSpawnBlockInSolidWall(room: RoomDef, xBlock: number, yBlock: number): boolean {
  const cx = xBlock * BLOCK_SIZE_MEDIUM;
  const cy = yBlock * BLOCK_SIZE_MEDIUM;
  const pLeft   = cx - PLAYER_HALF_WIDTH_WORLD;
  const pRight  = cx + PLAYER_HALF_WIDTH_WORLD;
  const pTop    = cy - PLAYER_HALF_HEIGHT_WORLD;
  const pBottom = cy + PLAYER_HALF_HEIGHT_WORLD;

  for (let wi = 0; wi < room.walls.length; wi++) {
    const wall = room.walls[wi];
    if (wall.isPlatformFlag === 1)  continue; // platforms don't block vertical spawn
    if (wall.isInvisibleFlag === 1) continue; // invisible boundary walls are passable

    // Half-width pillars use half the declared block-width; full walls scale 1:1.
    const wallWidthScale = wall.isPillarHalfWidthFlag === 1 ? 0.5 : 1;
    const wLeft   = wall.xBlock * BLOCK_SIZE_MEDIUM;
    const wTop    = wall.yBlock * BLOCK_SIZE_MEDIUM;
    const wRight  = wLeft + wall.wBlock * BLOCK_SIZE_MEDIUM * wallWidthScale;
    const wBottom = wTop  + wall.hBlock * BLOCK_SIZE_MEDIUM;

    if (pLeft < wRight && pRight > wLeft && pTop < wBottom && pBottom > wTop) {
      return true;
    }
  }
  return false;
}

/**
 * Scans the room (inside the SPAWN_MARGIN_BLOCKS border) and returns the first
 * block position whose player AABB does not overlap any solid wall.
 * Falls back to the room centre if every candidate block is blocked.
 */
export function findOpenSpawnBlock(room: RoomDef): [number, number] {
  const maxX = room.widthBlocks  - 1 - SPAWN_MARGIN_BLOCKS;
  const maxY = room.heightBlocks - 1 - SPAWN_MARGIN_BLOCKS;
  for (let y = SPAWN_MARGIN_BLOCKS; y <= maxY; y++) {
    for (let x = SPAWN_MARGIN_BLOCKS; x <= maxX; x++) {
      if (!isSpawnBlockInSolidWall(room, x, y)) {
        return [x, y];
      }
    }
  }
  // Absolute fallback: room centre
  return [Math.floor(room.widthBlocks / 2), Math.floor(room.heightBlocks / 2)];
}

/**
 * Resolves a desired spawn block to a valid, open position.
 *
 * 1. Clamps the position to the playable bounds
 *    ([SPAWN_MARGIN_BLOCKS, dimension − 1 − SPAWN_MARGIN_BLOCKS] on each axis).
 * 2. If the clamped position is inside a solid wall, falls back to
 *    `findOpenSpawnBlock` and logs a warning.
 */
export function resolveSpawnBlock(
  room: RoomDef,
  xBlock: number,
  yBlock: number,
): readonly [number, number] {
  const maxX = room.widthBlocks  - 1 - SPAWN_MARGIN_BLOCKS;
  const maxY = room.heightBlocks - 1 - SPAWN_MARGIN_BLOCKS;
  const cx = Math.min(Math.max(SPAWN_MARGIN_BLOCKS, xBlock), maxX);
  const cy = Math.min(Math.max(SPAWN_MARGIN_BLOCKS, yBlock), maxY);

  if (!isSpawnBlockInSolidWall(room, cx, cy)) {
    return [cx, cy] as const;
  }

  console.warn(
    `[gameRoom] Spawn block [${xBlock}, ${yBlock}] is inside a wall in room '${room.id}'. Finding open spawn.`,
  );
  return findOpenSpawnBlock(room);
}


// ── Rope destructibility index constants ──────────────────────────────────────
const ROPE_DESTR_INDESTRUCTIBLE = 0;
const ROPE_DESTR_PLAYER_ONLY = 1;
const ROPE_DESTR_ANY = 2;

/**
 * Loads rope definitions from a RoomDef into the WorldState rope buffers.
 * Initialises Verlet segment positions as a straight line from anchor A to B,
 * then pre-settles the rope by running many Verlet iterations so it starts in
 * its natural sagged shape on first render.
 */
export function loadRoomRopes(world: WorldState, room: RoomDef): void {
  const ropes = room.ropes ?? [];
  const count = Math.min(ropes.length, MAX_ROPES);
  world.ropeCount = count;
  // Reset grapple-to-rope attachment state
  world.grappleRopeIndex = -1;
  world.grappleRopeAttachSegF = 0.0;

  for (let r = 0; r < count; r++) {
    const def = ropes[r];
    const segCount = Math.max(2, Math.min(def.segmentCount ?? DEFAULT_ROPE_SEGMENT_COUNT, MAX_ROPE_SEGMENTS));
    world.ropeSegmentCount[r] = segCount;

    // All room elements use block units where 1 block = BLOCK_SIZE_SMALL world units.
    // BLOCK_SIZE_MEDIUM and BLOCK_SIZE_LARGE are aliased to BLOCK_SIZE_SMALL in the
    // current codebase (all tiers = 8), so BLOCK_SIZE_SMALL is the canonical multiplier.
    const ax = def.anchorAXBlock * BLOCK_SIZE_SMALL;
    const ay = def.anchorAYBlock * BLOCK_SIZE_SMALL;
    const bx = def.anchorBXBlock * BLOCK_SIZE_SMALL;
    const by = def.anchorBYBlock * BLOCK_SIZE_SMALL;

    world.ropeAnchorAXWorld[r] = ax;
    world.ropeAnchorAYWorld[r] = ay;
    world.ropeAnchorBXWorld[r] = bx;
    world.ropeAnchorBYWorld[r] = by;
    // Default: both anchors fixed (isAnchorBFixed undefined or true → pinned).
    world.ropeIsAnchorBFixedFlag[r] = def.isAnchorBFixed !== false ? 1 : 0;

    const destr = def.destructibility ?? 'indestructible';
    world.ropeDestructibilityIndex[r] =
      destr === 'playerOnly' ? ROPE_DESTR_PLAYER_ONLY :
      destr === 'any'        ? ROPE_DESTR_ANY :
                               ROPE_DESTR_INDESTRUCTIBLE;

    // Thickness: half-world-units from ROPE_THICKNESS_HALF_WORLD table.
    const thickIdx = def.thicknessIndex ?? 0;
    world.ropeHalfThickWorld[r] = ROPE_THICKNESS_HALF_WORLD[thickIdx];

    // Rest length = straight-line distance / (segCount - 1)
    const dx = bx - ax;
    const dy = by - ay;
    const totalLen = Math.sqrt(dx * dx + dy * dy);
    world.ropeSegRestLenWorld[r] = segCount > 1 ? totalLen / (segCount - 1) : totalLen;

    initRopeSegments(world, r);
  }

  // Pre-settle all ropes: run Verlet iterations so they appear sagged on first frame.
  if (count > 0) {
    presettleRopes(world);
  }
}

/**
 * Resets and spawns all grasshoppers for the given room into world state.
 * Grasshoppers are placed randomly within each authored grasshopper area.
 */
export function loadRoomGrasshoppers(world: WorldState, room: RoomDef): void {
  world.grasshopperCount = 0;
  if (!room.grasshopperAreas) return;

  for (const area of room.grasshopperAreas) {
    const areaXWorld = area.xBlock * BLOCK_SIZE_MEDIUM;
    const areaYWorld = area.yBlock * BLOCK_SIZE_MEDIUM;
    const areaWidthWorld = area.wBlock * BLOCK_SIZE_MEDIUM;
    const areaHeightWorld = area.hBlock * BLOCK_SIZE_MEDIUM;
    for (let g = 0; g < area.count && world.grasshopperCount < MAX_GRASSHOPPERS; g++) {
      const gi = world.grasshopperCount++;
      world.grasshopperXWorld[gi] = areaXWorld + areaWidthWorld  * 0.5
        + nextFloatTriangle(world.rng) * areaWidthWorld  * 0.5;
      world.grasshopperYWorld[gi] = areaYWorld + areaHeightWorld * 0.5
        + nextFloatTriangle(world.rng) * areaHeightWorld * 0.5;
      world.grasshopperVelXWorld[gi] = 0;
      world.grasshopperVelYWorld[gi] = 0;
      world.grasshopperHopTimerTicks[gi] = nextFloat(world.rng) * GRASSHOPPER_INITIAL_TIMER_MAX_TICKS;
      world.isGrasshopperAliveFlag[gi] = 1;
    }
  }
}
