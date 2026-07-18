/**
 * slimeSnailSurfaceTopology.ts — derives a directed, traversable boundary
 * graph from the tile-level `SurfaceExposureMap` (src/sim/world/surfaceExposure.ts)
 * for the Slime Snail enemy to crawl along.
 *
 * This is intentionally a *thin* derivation on top of the authoritative
 * exposure map — it does not redefine what counts as an exposed surface, it
 * only adds direction/adjacency so a snail can walk from one exposed tile
 * side to the next without ever consulting merged wall rectangles.
 *
 * Immutable once built: build once per room / wall-layout revision (see
 * callers), never per tick. Mutable snail position/progress/segment index
 * lives in ClusterState, never here.
 */

import type { SurfaceExposureMap, SurfaceSegment, SurfaceSide } from '../world/surfaceExposure';
import { SURFACE_SIDES } from '../world/surfaceExposure';

/** One exposed tile-side, with a stable index into `topology.segments`. */
export interface SlimeSnailSurfaceSegment {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  readonly side: SurfaceSide;
  readonly sideIndex: number; // matches SURFACE_SIDES index (0=top,1=right,2=bottom,3=left)
  readonly normalX: number;
  readonly normalY: number;
  /** Natural (non-directed) endpoints, exactly as surfaceExposure produced them. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly lengthWorld: number;
}

export interface SlimeSnailSurfaceTopology {
  readonly segments: readonly SlimeSnailSurfaceSegment[];
  /** widthBlocks/heightBlocks/blockSizePx of the source map, for corner bounds sanity checks. */
  readonly blockSizePx: number;
}

/**
 * Builds the derived slime-snail surface topology from an existing
 * `SurfaceExposureMap`. Deterministic: segment order matches the input map's
 * segment order (which itself iterates rows then columns then a fixed
 * top/right/bottom/left order), so `index` is stable across builds of the
 * same room.
 */
export function buildSlimeSnailSurfaceTopology(map: SurfaceExposureMap): SlimeSnailSurfaceTopology {
  const segments: SlimeSnailSurfaceSegment[] = map.segments.map((seg: SurfaceSegment, index: number) => {
    const dx = seg.x1 - seg.x0;
    const dy = seg.y1 - seg.y0;
    return {
      index,
      col: seg.col,
      row: seg.row,
      side: seg.side,
      sideIndex: SURFACE_SIDES.indexOf(seg.side),
      normalX: seg.normalX,
      normalY: seg.normalY,
      x0: seg.x0, y0: seg.y0, x1: seg.x1, y1: seg.y1,
      lengthWorld: Math.sqrt(dx * dx + dy * dy),
    };
  });

  return { segments, blockSizePx: map.blockSizePx };
}

/**
 * Directed endpoints of a segment for a given traversal direction.
 * Clockwise keeps solid terrain on the snail's right:
 *   top: left→right, right: top→bottom, bottom: right→left, left: bottom→top.
 * Counterclockwise reverses each.
 */
export function getDirectedEndpoints(
  seg: SlimeSnailSurfaceSegment,
  clockwiseFlag: 0 | 1,
): { startX: number; startY: number; endX: number; endY: number } {
  // Natural order (x0,y0)->(x1,y1) already matches clockwise for 'top' and
  // 'right'; 'bottom' and 'left' need reversing to match clockwise.
  const naturalIsClockwise = seg.side === 'top' || seg.side === 'right';
  const useNaturalOrder = clockwiseFlag === 1 ? naturalIsClockwise : !naturalIsClockwise;

  return useNaturalOrder
    ? { startX: seg.x0, startY: seg.y0, endX: seg.x1, endY: seg.y1 }
    : { startX: seg.x1, startY: seg.y1, endX: seg.x0, endY: seg.y0 };
}

const POINT_EPSILON_WORLD = 0.01;

function pointsMatch(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.abs(ax - bx) < POINT_EPSILON_WORLD && Math.abs(ay - by) < POINT_EPSILON_WORLD;
}

/** Result of resolving the next segment at a corner. */
export interface NextSegmentResult {
  readonly nextIndex: number;
  readonly cornerXWorld: number;
  readonly cornerYWorld: number;
}

/**
 * Finds the segment that continues the boundary path after `currentIndex`,
 * travelling in direction `clockwiseFlag`, starting from the current
 * segment's directed end point.
 *
 * Deterministic candidate selection:
 *  1. Only segments whose directed *start* point matches the current
 *     segment's directed *end* point are candidates.
 *  2. Candidates on a tile that is neither the same tile nor cardinally
 *     adjacent (shares a row or column) to the current tile are rejected —
 *     this prevents jumping to an island that only touches at a shared
 *     corner pixel.
 *  3. Among remaining candidates, prefer the smallest turn (straightest
 *     continuation) by comparing the outgoing direction to the incoming
 *     direction; ties broken by (col, row, sideIndex) ascending.
 */
export function getNextSlimeSnailSegment(
  topology: SlimeSnailSurfaceTopology,
  currentIndex: number,
  clockwiseFlag: 0 | 1,
): NextSegmentResult | null {
  const current = topology.segments[currentIndex];
  if (!current) return null;
  const cur = getDirectedEndpoints(current, clockwiseFlag);
  const inDirX = cur.endX - cur.startX;
  const inDirY = cur.endY - cur.startY;
  const inLen = Math.sqrt(inDirX * inDirX + inDirY * inDirY) || 1;
  const inNormX = inDirX / inLen;
  const inNormY = inDirY / inLen;

  let best: { seg: SlimeSnailSurfaceSegment; turnScore: number } | null = null;

  for (const seg of topology.segments) {
    if (seg.index === currentIndex) continue;

    const sameTile = seg.col === current.col && seg.row === current.row;
    const cardinallyAdjacent = Math.abs(seg.col - current.col) + Math.abs(seg.row - current.row) === 1;
    if (!sameTile && !cardinallyAdjacent) continue;

    const dir = getDirectedEndpoints(seg, clockwiseFlag);
    if (!pointsMatch(dir.startX, dir.startY, cur.endX, cur.endY)) continue;

    const outDirX = dir.endX - dir.startX;
    const outDirY = dir.endY - dir.startY;
    const outLen = Math.sqrt(outDirX * outDirX + outDirY * outDirY) || 1;
    const outNormX = outDirX / outLen;
    const outNormY = outDirY / outLen;

    // Larger dot product = straighter continuation. Use -dot as an
    // ascending "turn score" so smallest = straightest.
    const dot = inNormX * outNormX + inNormY * outNormY;
    const turnScore = -dot;

    if (
      best === null ||
      turnScore < best.turnScore - 1e-9 ||
      (Math.abs(turnScore - best.turnScore) <= 1e-9 && isLexicographicallyEarlier(seg, best.seg))
    ) {
      best = { seg, turnScore };
    }
  }

  if (best === null) return null;
  return { nextIndex: best.seg.index, cornerXWorld: cur.endX, cornerYWorld: cur.endY };
}

function isLexicographicallyEarlier(a: SlimeSnailSurfaceSegment, b: SlimeSnailSurfaceSegment): boolean {
  if (a.col !== b.col) return a.col < b.col;
  if (a.row !== b.row) return a.row < b.row;
  return a.sideIndex < b.sideIndex;
}

/**
 * Finds the nearest segment index matching a preferred side index, near a
 * pixel-space point. Falls back to the nearest segment of any side if none
 * of the preferred side is found within `maxDistanceWorld`. Returns -1 if
 * the topology has no segments at all (used to detect invalid placement).
 */
export function findNearestSlimeSnailSegment(
  topology: SlimeSnailSurfaceTopology,
  pointXWorld: number,
  pointYWorld: number,
  preferredSideIndex: number,
  maxDistanceWorld: number = Infinity,
): number {
  let bestPreferredIndex = -1;
  let bestPreferredDistSq = maxDistanceWorld * maxDistanceWorld;
  let bestAnyIndex = -1;
  let bestAnyDistSq = maxDistanceWorld * maxDistanceWorld;

  for (const seg of topology.segments) {
    const midX = (seg.x0 + seg.x1) / 2;
    const midY = (seg.y0 + seg.y1) / 2;
    const dx = midX - pointXWorld;
    const dy = midY - pointYWorld;
    const distSq = dx * dx + dy * dy;

    if (distSq <= bestAnyDistSq) {
      bestAnyDistSq = distSq;
      bestAnyIndex = seg.index;
    }
    if (seg.sideIndex === preferredSideIndex && distSq <= bestPreferredDistSq) {
      bestPreferredDistSq = distSq;
      bestPreferredIndex = seg.index;
    }
  }

  return bestPreferredIndex >= 0 ? bestPreferredIndex : bestAnyIndex;
}
