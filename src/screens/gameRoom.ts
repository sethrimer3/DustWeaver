import { WorldState, MAX_WALLS, MAX_DUST_PILES, MAX_FIREFLIES } from '../sim/world';
import { nextFloat, nextFloatTriangle } from '../sim/rng';
import {
  RoomDef,
  BLOCK_SIZE_MEDIUM,
  blockThemeToIndex,
  WALL_THEME_DEFAULT_INDEX,
  PLAYER_HALF_WIDTH_WORLD,
  PLAYER_HALF_HEIGHT_WORLD,
  CrumbleVariant,
} from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';

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
    const spreadRadiusWorld = (p.spreadBlocks ?? 0) * 0.5 * BLOCK_SIZE_MEDIUM;
    world.dustPileXWorld[pi] = (p.xBlock + 0.5) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadRadiusWorld;
    world.dustPileYWorld[pi] = (p.yBlock + 1.0) * BLOCK_SIZE_MEDIUM
      + nextFloatTriangle(world.rng) * spreadRadiusWorld;
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


/** Background fill colour for each world number. */
export function worldBgColor(worldNumber: number): string {
  switch (worldNumber) {
    case 0:  return '#0d1a0f'; // pale dark green
    case 1:  return '#051408'; // deep dark green
    case 2:  return '#080c1a'; // dark blue
    case 3:  return '#1a0500'; // deep dark red-orange (fire/lava world)
    default: return '#0a0a12';
  }
}


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


/**
 * Draws a gradient darkness overlay at room transition tunnel edges.
 * The gradient goes from transparent to 100% black at the very edge.
 */
export function drawTunnelDarkness(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;
  const DEFAULT_FADE_BLOCKS = 6;

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];

    // Use per-transition gradient width when set; default to 6 blocks.
    // A value of 0 means no gradient should be drawn for this transition.
    const fadeBlocks = t.gradientWidthBlocks ?? DEFAULT_FADE_BLOCKS;
    if (fadeBlocks <= 0) continue;
    const fadeDepthWorld = fadeBlocks * BLOCK_SIZE_MEDIUM;

    const openTopWorld    = t.positionBlock * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

    // Determine fade colors based on transition fadeColor
    let fadeOpaqueColor: string;
    let fadeTransparentColor: string;
    const fc = t.fadeColor;
    if (fc && fc.length === 7 && fc[0] === '#' && fc !== '#000000') {
      // Parse hex color to rgba (validated 7-char hex format)
      const r = parseInt(fc.slice(1, 3), 16);
      const g = parseInt(fc.slice(3, 5), 16);
      const b = parseInt(fc.slice(5, 7), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        fadeOpaqueColor = `rgba(${r},${g},${b},1)`;
        fadeTransparentColor = `rgba(${r},${g},${b},0)`;
      } else {
        fadeOpaqueColor = 'rgba(0,0,0,1)';
        fadeTransparentColor = 'rgba(0,0,0,0)';
      }
    } else {
      fadeOpaqueColor = 'rgba(0,0,0,1)';
      fadeTransparentColor = 'rgba(0,0,0,0)';
    }

    const y0Screen = openTopWorld    * zoom + offsetYPx;
    const y1Screen = openBottomWorld * zoom + offsetYPx;
    const x1Screen = roomWidthWorld  * zoom + offsetXPx;

    if (t.direction === 'left') {
      // Zone starts at depthBlock (or room left edge) and extends inward 6 blocks
      const zoneLeft  = (t.depthBlock !== undefined ? t.depthBlock * BLOCK_SIZE_MEDIUM : 0);
      const zoneRight = zoneLeft + fadeDepthWorld;
      const zlScreen  = zoneLeft  * zoom + offsetXPx;
      const zrScreen  = zoneRight * zoom + offsetXPx;

      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill leftward past the room boundary to cover the tunnel corridor.
      const fillLeft = t.depthBlock !== undefined ? zlScreen : 0;
      ctx.fillRect(fillLeft, y0Screen, zrScreen - fillLeft, y1Screen - y0Screen);

    } else if (t.direction === 'right') {
      // Zone starts 6 blocks from right (or at depthBlock) and exits right
      const zoneLeft  = t.depthBlock !== undefined
        ? t.depthBlock * BLOCK_SIZE_MEDIUM
        : roomWidthWorld - fadeDepthWorld;
      const zoneRight = zoneLeft + fadeDepthWorld;
      const zlScreen  = zoneLeft  * zoom + offsetXPx;
      const zrScreen  = zoneRight * zoom + offsetXPx;

      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill rightward past the room boundary to cover the tunnel corridor.
      const fillRight = t.depthBlock !== undefined ? zrScreen : x1Screen;
      ctx.fillRect(zlScreen, y0Screen, fillRight - zlScreen, y1Screen - y0Screen);

    } else if (t.direction === 'up') {
      const openLeftWorld  = t.positionBlock * BLOCK_SIZE_MEDIUM;
      const openRightWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;
      const x0s = openLeftWorld  * zoom + offsetXPx;
      const x1s = openRightWorld * zoom + offsetXPx;

      const zoneTop    = (t.depthBlock !== undefined ? t.depthBlock * BLOCK_SIZE_MEDIUM : 0);
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill upward past the room boundary.
      const fillTop = t.depthBlock !== undefined ? ztScreen : 0;
      ctx.fillRect(x0s, fillTop, x1s - x0s, zbScreen - fillTop);

    } else if (t.direction === 'down') {
      const openLeftWorld  = t.positionBlock * BLOCK_SIZE_MEDIUM;
      const openRightWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;
      const x0s = openLeftWorld  * zoom + offsetXPx;
      const x1s = openRightWorld * zoom + offsetXPx;

      const zoneTop    = t.depthBlock !== undefined
        ? t.depthBlock * BLOCK_SIZE_MEDIUM
        : roomHeightWorld - fadeDepthWorld;
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill downward past the room boundary.
      const fillBottom = t.depthBlock !== undefined ? zbScreen : roomHeightWorld * zoom + offsetYPx;
      ctx.fillRect(x0s, ztScreen, x1s - x0s, fillBottom - ztScreen);
    }
  }

  ctx.restore();
}

/**
 * Converts a device-space aim position (mouse/touch in device pixels)
 * back to world coordinates given the current camera transform.
 * First maps device coords to virtual canvas space, then applies camera inverse.
 */
export function screenToWorld(
  deviceXPx: number,
  deviceYPx: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  deviceWidthPx: number,
  deviceHeightPx: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
): { xWorld: number; yWorld: number } {
  // Map device pixels to virtual canvas pixels
  const virtualXPx = (deviceXPx / deviceWidthPx)  * virtualWidthPx;
  const virtualYPx = (deviceYPx / deviceHeightPx) * virtualHeightPx;
  return {
    xWorld: (virtualXPx - offsetXPx) / zoom,
    yWorld: (virtualYPx - offsetYPx) / zoom,
  };
}
