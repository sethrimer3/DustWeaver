/**
 * liquidBodyCache.ts — Liquid Body Meshing and Bubble Emitter System.
 *
 * Implements the Liquid Body Renderer cache layer:
 *  - Finds connected components of same-type liquid tiles (BFS).
 *  - Greedy-meshes each body into a minimal set of merged rectangles for
 *    efficient batched interior fill (no per-tile animation).
 *  - Extracts exposed top-edge horizontal runs for wave-surface rendering.
 *  - Manages sparse rising-bubble emitters per liquid body.
 *
 * Design notes:
 *  - This module lives in render/ (not sim/), so Math.random() is acceptable
 *    for cosmetic bubble emission. Bubbles have no impact on gameplay state.
 *  - The cache is a module-level singleton marked dirty whenever liquid tile
 *    data changes (room load, editor paint/delete). The rebuild runs once and
 *    is cached until the next dirty flag set.
 *  - No per-frame allocations in the hot render path. All arrays are
 *    pre-allocated or pre-built during the cache rebuild phase.
 */

import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum liquid tiles per room (water + lava combined). */
export const MAX_LIQUID_TILES_PER_ROOM = 6000;

/** Global cap on active bubbles across all liquid bodies. */
export const LIQUID_BUBBLE_GLOBAL_CAP = 64;

/** Maximum active bubbles per liquid body. */
export const LIQUID_BUBBLE_BODY_CAP = 12;

/** Minimum ticks between bubble spawns per body. */
export const LIQUID_BUBBLE_SPAWN_RATE_MIN = 45;

/** Maximum ticks between bubble spawns per body. */
export const LIQUID_BUBBLE_SPAWN_RATE_MAX = 180;

/** Upward rise speed for bubbles (world units per tick; negative = upward). */
export const LIQUID_BUBBLE_RISE_SPEED = 0.18;

/** Maximum horizontal drift amplitude (world units). */
export const LIQUID_BUBBLE_DRIFT_AMOUNT = 1.2;

/** Wave amplitude on exposed top edges (world units). */
export const LIQUID_EDGE_WAVE_AMPLITUDE = 0.55;

/** Wave angular speed (radians per tick). */
export const LIQUID_EDGE_WAVE_SPEED = 0.065;

/** Spatial wave frequency (radians per world unit). */
export const LIQUID_EDGE_WAVE_SPATIAL_FREQ = 0.32;

/** Maximum bubble lifetime in ticks. */
const BUBBLE_MAX_AGE_TICKS = 600;

/**
 * Minimum blocks below the top surface at which a bubble fades out.
 * Randomised per-bubble to prevent all bubbles dying at the same height.
 * (1 block = one BLOCK_SIZE_MEDIUM distance unit)
 */
const BUBBLE_SURFACE_FADE_MIN_BLOCKS = 1;

/** Maximum blocks below top surface at which a bubble fades out. */
const BUBBLE_SURFACE_FADE_MAX_BLOCKS = 15;

// ── Tile key encoding ─────────────────────────────────────────────────────────

/**
 * Encodes a (gridX, gridY) pair into a single integer key for Set lookups.
 * Supports grid coordinates up to ±4095 in each axis — adequate for rooms
 * up to 32 768 world units wide/tall (far beyond any current room size).
 */
function encodeKey(gx: number, gy: number): number {
  // Pack as (gx+4096)*8192 + (gy+4096) so both axes can be negative.
  return (gx + 4096) * 8192 + (gy + 4096);
}

// ── Interfaces ────────────────────────────────────────────────────────────────

/** One filled rectangle that is part of a liquid body (world units). */
export interface MergedRect {
  xWorld: number;
  yWorld: number;
  wWorld: number;
  hWorld: number;
}

/** A horizontal run of exposed top-edge cells (world units). */
export interface TopEdgeRun {
  /** Left edge of run in world units. */
  xWorld: number;
  /** Top of the tile row in world units (wave drawn here). */
  yWorld: number;
  /** Total width of run in world units. */
  wWorld: number;
}

/** A single rising bubble inside a liquid body. */
export interface LiquidBubble {
  /** Current X position (world units). */
  xWorld: number;
  /** Current Y position (world units). */
  yWorld: number;
  /** X world coordinate where this bubble was originally spawned (drift anchor). */
  originXWorld: number;
  /** Horizontal drift phase (radians, drives sinusoidal drift). */
  driftPhaseRad: number;
  /** Ticks since this bubble was spawned. */
  ageTicks: number;
  /** Bubble lifetime cap in ticks. */
  maxAgeTicks: number;
  /** X grid column index where this bubble was spawned (used for surface lookup). */
  originGridX: number;
  /**
   * Y world coordinate of the top surface in this bubble's column.
   * Cached at spawn time so no per-tick upward scan is needed.
   */
  surfaceYWorld: number;
  /**
   * Distance below the surface (world units) at which this bubble fades out.
   * Randomised at spawn (1–15 blocks) so bubbles disappear at natural depths
   * rather than hard-popping at the exact tile surface.
   */
  fadeBelowSurfaceWorld: number;
}

/** A connected group of same-type liquid tiles. */
export interface LiquidBody {
  /** Liquid type. */
  kind: 'water' | 'lava';
  /** Number of tiles in this body. */
  tileCount: number;
  /** Tile set for fast neighbour lookup (encoded keys). */
  readonly tileSet: Set<number>;
  /** Bounding box (world units). */
  minXWorld: number;
  maxXWorld: number;
  minYWorld: number;
  maxYWorld: number;
  /** Greedy-meshed rectangles covering the body interior (world units). */
  readonly mergedRects: MergedRect[];
  /** Horizontal runs of exposed top-edge tiles (world units). */
  readonly topEdgeRuns: TopEdgeRun[];
  /**
   * X-positions (world units) of the bottom-most tile in each tile column.
   * Used for bubble spawn: maps from column gridX → bottom-tile world Y.
   */
  readonly bottomByColumn: Map<number, number>;
  /**
   * Y world coordinate of the top-surface tile top edge in each column.
   * Maps column gridX → world Y of the tile's top edge at the exposed surface.
   * Pre-cached during body construction so bubble spawn is O(1) (no upward scan).
   */
  readonly topByColumn: Map<number, number>;
  /** Active bubbles for this body. */
  readonly bubbles: LiquidBubble[];
  /** Ticks until the next bubble spawn attempt. */
  nextBubbleSpawnTicks: number;
  /**
   * Maximum bubbles allowed for this body, scaled to body size.
   * Smaller bodies have a lower cap than LIQUID_BUBBLE_BODY_CAP.
   */
  bubbleCap: number;
}

// ── Module-level cache state ───────────────────────────────────────────────────

let _isDirty = true;
let _bodies: LiquidBody[] = [];
let _rebuildCount = 0;
let _lastBubbleTick = -1;

// Scratch arrays used during rebuild — pre-allocated, reused each rebuild.
// BFS queue: each entry is one encoded tile key.
const _bfsQueue = new Int32Array(MAX_LIQUID_TILES_PER_ROOM * 2);

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Marks the liquid body cache as stale so it will be rebuilt on the next
 * call to getLiquidBodies(). Call this whenever liquid tiles are added,
 * removed, or a new room is loaded.
 */
export function markLiquidBodiesDirty(): void {
  _isDirty = true;
}

/**
 * Returns the current array of liquid bodies, rebuilding if dirty.
 * Safe to call every frame — rebuilds are amortised to room-change events.
 */
export function getLiquidBodies(world: WorldState): readonly LiquidBody[] {
  if (_isDirty) {
    rebuildLiquidBodies(world);
    _isDirty = false;
  }
  return _bodies;
}

/**
 * Debug stats snapshot — call only when debug mode is active.
 */
export interface LiquidDebugStats {
  liquidTileCount: number;
  liquidBodyCount: number;
  mergedRectCount: number;
  activeBubbleCount: number;
  cacheRebuildCount: number;
}

export function getLiquidDebugStats(): LiquidDebugStats {
  let tileCount = 0;
  let rectCount = 0;
  let bubbleCount = 0;
  for (const b of _bodies) {
    tileCount += b.tileCount;
    rectCount += b.mergedRects.length;
    bubbleCount += b.bubbles.length;
  }
  return {
    liquidTileCount: tileCount,
    liquidBodyCount: _bodies.length,
    mergedRectCount: rectCount,
    activeBubbleCount: bubbleCount,
    cacheRebuildCount: _rebuildCount,
  };
}

/**
 * Advances all bubble physics for one tick. Call once per render frame.
 * Despawns expired bubbles and spawns new ones.
 */
export function tickLiquidBubbles(tick: number): void {
  if (tick === _lastBubbleTick) return; // Already ticked this tick
  _lastBubbleTick = tick;

  let globalBubbleCount = 0;
  for (const body of _bodies) {
    globalBubbleCount += body.bubbles.length;
  }

  for (const body of _bodies) {
    const { bubbles, tileSet, bottomByColumn, topByColumn } = body;
    const B = BLOCK_SIZE_MEDIUM;

    // ── Tick existing bubbles ──────────────────────────────────────────────
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const bub = bubbles[i];
      bub.ageTicks++;
      // Rise upward
      bub.yWorld -= LIQUID_BUBBLE_RISE_SPEED;
      // Stable origin-based sinusoidal horizontal drift.
      // xWorld is always offset from originXWorld — drift never accumulates.
      bub.xWorld = bub.originXWorld
        + Math.sin(bub.driftPhaseRad + bub.ageTicks * 0.04) * LIQUID_BUBBLE_DRIFT_AMOUNT;

      // Despawn: exceeded lifetime
      if (bub.ageTicks >= bub.maxAgeTicks) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
        continue;
      }

      // Despawn: bubble has risen within fadeBelowSurfaceWorld of the top surface.
      // Using the pre-cached surfaceYWorld avoids a per-tick tile scan.
      if (bub.yWorld <= bub.surfaceYWorld + bub.fadeBelowSurfaceWorld) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
        continue;
      }

      // Safety despawn: bubble left the liquid body (e.g., body was reshaped)
      const gx = Math.floor(bub.xWorld / B);
      const gy = Math.floor(bub.yWorld / B);
      if (!tileSet.has(encodeKey(gx, gy))) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
      }
    }

    // ── Spawn new bubbles ─────────────────────────────────────────────────
    body.nextBubbleSpawnTicks--;
    if (body.nextBubbleSpawnTicks <= 0
      && bubbles.length < body.bubbleCap
      && globalBubbleCount < LIQUID_BUBBLE_GLOBAL_CAP
      && bottomByColumn.size > 0
    ) {
      // Pick a random column
      const cols = Array.from(bottomByColumn.keys());
      const col = cols[Math.floor(Math.random() * cols.length)];
      const bottomY = bottomByColumn.get(col)!;

      // Spawn near bottom of that column
      const spawnX = col * B + Math.random() * B;
      const spawnY = bottomY - Math.random() * B * 0.5; // within the bottom tile

      // Verify it's actually inside the body
      const spawnGX = Math.floor(spawnX / B);
      const spawnGY = Math.floor(spawnY / B);
      if (tileSet.has(encodeKey(spawnGX, spawnGY))) {
        // Retrieve pre-cached surface Y for this column (O(1), no scan needed).
        const surfaceYWorld = topByColumn.get(col) ?? spawnY;
        const fadeBelowSurfaceWorld =
          (BUBBLE_SURFACE_FADE_MIN_BLOCKS +
            Math.random() * (BUBBLE_SURFACE_FADE_MAX_BLOCKS - BUBBLE_SURFACE_FADE_MIN_BLOCKS)) * B;

        bubbles.push({
          xWorld: spawnX,
          yWorld: spawnY,
          originXWorld: spawnX,
          driftPhaseRad: Math.random() * Math.PI * 2,
          ageTicks: 0,
          maxAgeTicks: Math.floor(BUBBLE_MAX_AGE_TICKS * (0.5 + Math.random() * 0.5)),
          originGridX: col,
          surfaceYWorld,
          fadeBelowSurfaceWorld,
        });
        globalBubbleCount++;
      }

      // Schedule next spawn
      body.nextBubbleSpawnTicks = Math.floor(
        LIQUID_BUBBLE_SPAWN_RATE_MIN
        + Math.random() * (LIQUID_BUBBLE_SPAWN_RATE_MAX - LIQUID_BUBBLE_SPAWN_RATE_MIN),
      );
    }
  }
}

// ── Rebuild implementation ─────────────────────────────────────────────────────

/**
 * Full rebuild of the liquid body cache from the current WorldState.
 *
 * Algorithm:
 *   1. Expand all water/lava zone rectangles into individual tile-grid cells.
 *   2. BFS connected components (4-connected) separately for water and lava.
 *   3. Per component: greedy-mesh into merged rectangles; extract exposed
 *      top-edge runs; compute per-column bottom-most tiles for bubble spawns.
 */
function rebuildLiquidBodies(world: WorldState): void {
  _rebuildCount++;
  const B = BLOCK_SIZE_MEDIUM;

  // Re-use the bodies array by clearing it (preserves heap allocation of the
  // array itself, though individual body objects are recreated).
  _bodies.length = 0;

  // ── Step 1: build tile key sets for water and lava ─────────────────────
  const waterSet = new Set<number>();
  const lavaSet  = new Set<number>();

  for (let i = 0; i < world.waterZoneCount; i++) {
    expandZoneIntoSet(
      world.waterZoneXWorld[i], world.waterZoneYWorld[i],
      world.waterZoneWWorld[i], world.waterZoneHWorld[i],
      B, waterSet,
    );
  }
  for (let i = 0; i < world.lavaZoneCount; i++) {
    expandZoneIntoSet(
      world.lavaZoneXWorld[i], world.lavaZoneYWorld[i],
      world.lavaZoneWWorld[i], world.lavaZoneHWorld[i],
      B, lavaSet,
    );
  }

  // ── Step 2: connected components for each liquid type ─────────────────
  extractBodies('water', waterSet);
  extractBodies('lava',  lavaSet);
}

/**
 * Expands a zone rectangle (in world units) into individual tile cells in
 * the set. A zone of width=16, height=8 at (0,0) yields tiles at (0,0),(1,0).
 */
function expandZoneIntoSet(
  xWorld: number, yWorld: number,
  wWorld: number, hWorld: number,
  B: number,
  out: Set<number>,
): void {
  const gx0 = Math.round(xWorld / B);
  const gy0 = Math.round(yWorld / B);
  const gx1 = Math.round((xWorld + wWorld) / B);
  const gy1 = Math.round((yWorld + hWorld) / B);
  for (let gy = gy0; gy < gy1; gy++) {
    for (let gx = gx0; gx < gx1; gx++) {
      out.add(encodeKey(gx, gy));
    }
  }
}

/** Decode grid X from an encoded key. */
function decodeGX(key: number): number {
  return Math.floor(key / 8192) - 4096;
}

/** Decode grid Y from an encoded key. */
function decodeGY(key: number): number {
  return (key % 8192) - 4096;
}

/**
 * Finds all connected components in the provided tile set and pushes
 * fully-initialised LiquidBody objects into `_bodies`.
 */
function extractBodies(kind: 'water' | 'lava', tileSet: Set<number>): void {
  const visited = new Set<number>();

  for (const startKey of tileSet) {
    if (visited.has(startKey)) continue;

    // BFS
    const componentKeys: number[] = [];
    let qHead = 0, qTail = 0;
    _bfsQueue[qTail++] = startKey;
    visited.add(startKey);

    while (qHead < qTail) {
      const key = _bfsQueue[qHead++];
      componentKeys.push(key);
      const gx = decodeGX(key);
      const gy = decodeGY(key);

      const neighbours = [
        encodeKey(gx - 1, gy),
        encodeKey(gx + 1, gy),
        encodeKey(gx, gy - 1),
        encodeKey(gx, gy + 1),
      ];
      for (const nk of neighbours) {
        if (tileSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          _bfsQueue[qTail++] = nk;
        }
      }
    }

    const body = buildBody(kind, componentKeys);
    _bodies.push(body);
  }
}

/**
 * Builds a fully initialised LiquidBody from the given component tile keys.
 */
function buildBody(
  kind: 'water' | 'lava',
  keys: number[],
): LiquidBody {
  const B = BLOCK_SIZE_MEDIUM;

  // Per-body tile set
  const bodySet = new Set<number>(keys);

  // Bounding box
  let minGX = Infinity, maxGX = -Infinity;
  let minGY = Infinity, maxGY = -Infinity;
  for (const k of keys) {
    const gx = decodeGX(k);
    const gy = decodeGY(k);
    if (gx < minGX) minGX = gx;
    if (gx > maxGX) maxGX = gx;
    if (gy < minGY) minGY = gy;
    if (gy > maxGY) maxGY = gy;
  }

  // Greedy mesh
  const mergedRects = greedyMesh(bodySet, minGX, maxGX, minGY, maxGY, B);

  // Exposed top-edge runs
  const topEdgeRuns = extractTopEdgeRuns(bodySet, minGX, maxGX, minGY, maxGY, B);

  // Per-column bottom-most and top-surface tile Y (world units).
  // bottomByColumn: gridX → world Y of the bottom edge of the deepest tile.
  // topByColumn:    gridX → world Y of the top edge of the shallowest (surface) tile.
  const bottomByColumn = new Map<number, number>();
  const topByColumn    = new Map<number, number>();
  for (const k of keys) {
    const gx = decodeGX(k);
    const gy = decodeGY(k);
    // Bottom edge (deepest = largest Y)
    const tileBottomY = (gy + 1) * B;
    const existingBottom = bottomByColumn.get(gx);
    if (existingBottom === undefined || tileBottomY > existingBottom) {
      bottomByColumn.set(gx, tileBottomY);
    }
    // Top edge (shallowest = smallest Y)
    const tileTopEdgeY = gy * B;
    const existingTop = topByColumn.get(gx);
    if (existingTop === undefined || tileTopEdgeY < existingTop) {
      topByColumn.set(gx, tileTopEdgeY);
    }
  }

  // Prune columns that have no upward path (single-tile-deep spots would
  // immediately despawn any bubble, so skip them).
  for (const [col] of Array.from(bottomByColumn.entries())) {
    const bottomGY = Math.round(bottomByColumn.get(col)! / B) - 1;
    const colTopGY = Math.round((topByColumn.get(col) ?? 0) / B);
    if (bottomGY <= colTopGY) {
      bottomByColumn.delete(col);
      topByColumn.delete(col);
    }
  }

  // Scale bubble cap to body size so small puddles have fewer bubbles.
  const bubbleCap = Math.min(
    LIQUID_BUBBLE_BODY_CAP,
    Math.max(0, Math.floor(Math.sqrt(keys.length) * 0.8)),
  );

  const body: LiquidBody = {
    kind,
    tileCount: keys.length,
    tileSet: bodySet,
    minXWorld: minGX * B,
    maxXWorld: (maxGX + 1) * B,
    minYWorld: minGY * B,
    maxYWorld: (maxGY + 1) * B,
    mergedRects,
    topEdgeRuns,
    bottomByColumn,
    topByColumn,
    bubbles: [],
    bubbleCap,
    nextBubbleSpawnTicks: Math.floor(
      LIQUID_BUBBLE_SPAWN_RATE_MIN
      + Math.random() * (LIQUID_BUBBLE_SPAWN_RATE_MAX - LIQUID_BUBBLE_SPAWN_RATE_MIN),
    ),
  };

  return body;
}

/**
 * Greedy rectangle meshing. Scans the tile set top-left → bottom-right and
 * greedily grows maximal rectangles, marking cells as visited to avoid
 * double-counting. Returns a list of MergedRect in world units.
 *
 * Produces the minimal axis-aligned rectangle cover needed to fill the body
 * with a small number of large fillRect calls — dramatically faster than
 * drawing one rect per tile.
 */
function greedyMesh(
  bodySet: Set<number>,
  minGX: number, maxGX: number,
  minGY: number, maxGY: number,
  B: number,
): MergedRect[] {
  const visited = new Set<number>();
  const rects: MergedRect[] = [];

  for (let gy = minGY; gy <= maxGY; gy++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const k = encodeKey(gx, gy);
      if (!bodySet.has(k) || visited.has(k)) continue;

      // Grow right as far as possible
      let w = 1;
      while (
        gx + w <= maxGX
        && bodySet.has(encodeKey(gx + w, gy))
        && !visited.has(encodeKey(gx + w, gy))
      ) {
        w++;
      }

      // Grow down as far as possible while the entire row [gx, gx+w) is clear
      let h = 1;
      outer: while (gy + h <= maxGY) {
        for (let dx = 0; dx < w; dx++) {
          const ck = encodeKey(gx + dx, gy + h);
          if (!bodySet.has(ck) || visited.has(ck)) break outer;
        }
        h++;
      }

      // Mark all cells in this rectangle as visited
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          visited.add(encodeKey(gx + dx, gy + dy));
        }
      }

      rects.push({
        xWorld: gx * B,
        yWorld: gy * B,
        wWorld: w * B,
        hWorld: h * B,
      });
    }
  }

  return rects;
}

/**
 * Scans the tile set for all cells whose top neighbour is absent (exposed top
 * edge). Groups contiguous horizontal runs and returns them as TopEdgeRun
 * entries in world units. These are the only cells that receive wave animation.
 */
function extractTopEdgeRuns(
  bodySet: Set<number>,
  minGX: number, maxGX: number,
  minGY: number, maxGY: number,
  B: number,
): TopEdgeRun[] {
  const runs: TopEdgeRun[] = [];

  for (let gy = minGY; gy <= maxGY; gy++) {
    let runStartGX = -1;
    for (let gx = minGX; gx <= maxGX + 1; gx++) {
      const isExposedTop =
        gx <= maxGX
        && bodySet.has(encodeKey(gx, gy))
        && !bodySet.has(encodeKey(gx, gy - 1));

      if (isExposedTop && runStartGX < 0) {
        runStartGX = gx;
      } else if (!isExposedTop && runStartGX >= 0) {
        runs.push({
          xWorld: runStartGX * B,
          yWorld: gy * B,
          wWorld: (gx - runStartGX) * B,
        });
        runStartGX = -1;
      }
    }
  }

  return runs;
}
