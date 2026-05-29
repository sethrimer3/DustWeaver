/**
 * liquidBodyBuilder.ts — Liquid Body Construction (BFS + Greedy Meshing).
 *
 * Extracted from liquidBodyCache.ts to separate the one-time body-building
 * logic from the cache state and per-tick bubble emitter.
 *
 * Exports:
 *   – Type definitions: MergedRect, TopEdgeRun, LiquidBubble, LiquidBody
 *   – Bubble physics constants (re-exported by liquidBodyCache.ts for external
 *     consumers that import them from there)
 *   – encodeKey — tile-key encoding helper used by both this module and the
 *     bubble tick loop in liquidBodyCache.ts
 *   – buildLiquidBodies — full BFS + greedy-mesh rebuild; returns a fresh
 *     LiquidBody array ready to be stored by the cache
 */

import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Bubble physics constants (re-exported by liquidBodyCache.ts) ──────────────

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

// ── Type definitions ──────────────────────────────────────────────────────────

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
  /**
   * Pre-built array of column grid-X indices that have bottom-tile entries.
   * Avoids an `Array.from(bottomByColumn.keys())` allocation in the hot
   * bubble-tick loop — built once at body construction time.
   */
  readonly columnKeys: readonly number[];
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

// ── Tile key encoding ─────────────────────────────────────────────────────────

/**
 * Encodes a (gridX, gridY) pair into a single integer key for Set lookups.
 * Supports grid coordinates up to ±4095 in each axis — adequate for rooms
 * up to 32 768 world units wide/tall (far beyond any current room size).
 *
 * Also exported for use in liquidBodyCache.ts's bubble-tick loop.
 */
export function encodeKey(gx: number, gy: number): number {
  // Pack as (gx+4096)*8192 + (gy+4096) so both axes can be negative.
  return (gx + 4096) * 8192 + (gy + 4096);
}

/** Decode grid X from an encoded key. */
function decodeGX(key: number): number {
  return Math.floor(key / 8192) - 4096;
}

/** Decode grid Y from an encoded key. */
function decodeGY(key: number): number {
  return (key % 8192) - 4096;
}

// ── BFS scratch array ─────────────────────────────────────────────────────────

/**
 * Maximum liquid tiles per room (water + lava combined).
 * Also re-exported by liquidBodyCache.ts.
 */
export const MAX_LIQUID_TILES_PER_ROOM = 6000;

/** Pre-allocated BFS queue: each entry is one encoded tile key. */
const _bfsQueue = new Int32Array(MAX_LIQUID_TILES_PER_ROOM * 2);

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Builds and returns a fresh array of {@link LiquidBody} objects from the
 * current world state.
 *
 * Algorithm:
 *   1. Expand all water/lava zone rectangles into individual tile-grid cells.
 *   2. BFS connected components (4-connected) separately for water and lava.
 *   3. Per component: greedy-mesh into merged rectangles; extract exposed
 *      top-edge runs; compute per-column bottom-most tiles for bubble spawns.
 *
 * Called by liquidBodyCache.ts whenever the cache is marked dirty.
 * Allocates a new array each call (acceptable — rebuilds happen only on
 * room load or editor events, never in the per-frame hot path).
 */
export function buildLiquidBodies(world: WorldState): LiquidBody[] {
  const B = BLOCK_SIZE_MEDIUM;
  const bodies: LiquidBody[] = [];

  // ── Step 1: build tile key sets for water and lava ─────────────────────
  const waterSet = new Set<number>();
  const lavaSet  = new Set<number>();

  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue; // frozen — rendered as ice overlay
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
  extractBodiesInto('water', waterSet, bodies);
  extractBodiesInto('lava',  lavaSet,  bodies);

  return bodies;
}

// ── Private build helpers ─────────────────────────────────────────────────────

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

/**
 * Finds all connected components in the provided tile set and pushes
 * fully-initialised {@link LiquidBody} objects into `out`.
 */
function extractBodiesInto(kind: 'water' | 'lava', tileSet: Set<number>, out: LiquidBody[]): void {
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

    out.push(buildBody(kind, componentKeys));
  }
}

/**
 * Builds a fully initialised {@link LiquidBody} from the given component tile keys.
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

  // Pre-build a stable array of column grid-X keys from bottomByColumn so the
  // bubble-tick loop can iterate without an Array.from allocation each frame.
  const columnKeys: number[] = [];
  for (const col of bottomByColumn.keys()) columnKeys.push(col);

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
    columnKeys,
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
