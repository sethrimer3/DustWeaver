import { WorldState, MAX_WALLS } from '../sim/world';
import { RoomDef, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  SPIKE_DIR_UP,
  SPIKE_DIR_DOWN,
  SPIKE_DIR_LEFT,
  SPIKE_DIR_RIGHT,
} from '../sim/hazards';

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

  // Convert block units to world units
  for (let wi = 0; wi < rawCount; wi++) {
    const def = room.walls[wi];
    xs.push(def.xBlock * BLOCK_SIZE_MEDIUM);
    ys.push(def.yBlock * BLOCK_SIZE_MEDIUM);
    ws.push(Math.max(BLOCK_SIZE_MEDIUM, def.wBlock * BLOCK_SIZE_MEDIUM));
    hs.push(Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM));
  }

  // ── Iterative merge pass ─────────────────────────────────────────────────
  // Two rectangles may merge if they share a complete face:
  //   - Same Y and height, contiguous on X (horizontal merge)
  //   - Same X and width,  contiguous on Y (vertical merge)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < xs.length; i++) {
      for (let j = i + 1; j < xs.length; j++) {
        // Horizontal merge: same Y, same H, contiguous on X axis
        if (ys[i] === ys[j] && hs[i] === hs[j]) {
          const rightI = xs[i] + ws[i];
          const rightJ = xs[j] + ws[j];
          if (rightI === xs[j]) {
            // i is left of j — extend i to cover j
            ws[i] += ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
          if (rightJ === xs[i]) {
            // j is left of i — extend i leftward to cover j
            xs[i] = xs[j];
            ws[i] += ws[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
        }
        // Vertical merge: same X, same W, contiguous on Y axis
        if (xs[i] === xs[j] && ws[i] === ws[j]) {
          const bottomI = ys[i] + hs[i];
          const bottomJ = ys[j] + hs[j];
          if (bottomI === ys[j]) {
            // i is above j — extend i downward to cover j
            hs[i] += hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
            merged = true;
            break;
          }
          if (bottomJ === ys[i]) {
            // j is above i — extend i upward to cover j
            ys[i] = ys[j];
            hs[i] += hs[j];
            xs.splice(j, 1); ys.splice(j, 1); ws.splice(j, 1); hs.splice(j, 1);
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
  world.dustBoostJarCount = 0;
  world.fireflyJarCount = 0;
  world.fireflyCount = 0;
  world.isPlayerInWaterFlag = 0;

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
  const roomWidthWorld = room.widthBlocks * BLOCK_SIZE_MEDIUM;
  const fadeDepthWorld = 4 * BLOCK_SIZE_MEDIUM; // 4 blocks of fade

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];
    const openTopWorld = t.positionBlock * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

    if (t.direction === 'left') {
      // Fade from left room edge inward
      const x0Screen = 0 * zoom + offsetXPx;
      const x1Screen = fadeDepthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(x0Screen, 0, x1Screen, 0);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen - 200, y0Screen, x1Screen - x0Screen + 200, y1Screen - y0Screen);
    } else if (t.direction === 'right') {
      // Fade from right room edge inward
      const x0Screen = (roomWidthWorld - fadeDepthWorld) * zoom + offsetXPx;
      const x1Screen = roomWidthWorld * zoom + offsetXPx;
      const y0Screen = (openTopWorld - BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;
      const y1Screen = (openBottomWorld + BLOCK_SIZE_MEDIUM) * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(x0Screen, 0, x1Screen, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen, y0Screen, x1Screen - x0Screen + 200, y1Screen - y0Screen);
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
