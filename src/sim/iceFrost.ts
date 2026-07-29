/**
 * iceFrost.ts — Ice Mote arrow surface-frost cosmetic system.
 *
 * When an arrow made of Ice Motes strikes terrain it does not bounce (see
 * `_resolveIceStick` in bowArrow.ts); instead it registers an impact point.
 * This module turns registered impact points into growing frost coverage
 * riding on the room's authoritative exposed tile surfaces (see
 * `sim/world/surfaceExposure.ts`) rather than as arbitrary world-space
 * sprites — frost is always attached to a specific `SurfaceSegment` and
 * follows that segment's orientation and connectivity.
 *
 * Coverage per segment is stored as a single [start, end] interval measured
 * in pixels along the segment from its (x0,y0) endpoint toward (x1,y1) —
 * sufficient for the "creeps outward from a point, tapers at both ends"
 * visual this feature calls for; a segment struck by multiple non-adjacent
 * shots simply grows a wider bounding interval rather than tracking disjoint
 * patches, which keeps merge-on-overlap trivial (union) without visibly
 * double-stacking depth (the renderer reads one interval per segment).
 *
 * Growth crosses tile-surface corners (convex or concave) by walking the
 * `SurfaceExposureMap.segments` adjacency graph: two segments are adjacent
 * when an endpoint of one coincides with an endpoint of the other. This
 * falls out naturally from shared grid corner coordinates for both convex
 * corners (two exposed sides of the same tile) and concave corners (two
 * exposed sides of different tiles meeting through a notch) — no separate
 * corner-case code is needed. A gap (disconnected surface) simply has no
 * coincident endpoint, so growth stops there instead of jumping across it.
 *
 * Lifecycle: cleared on room load/reset via `resetIceFrostForRoom`,
 * mirroring `resetIceMoteAuraForRoom` in iceMoteAura.ts — frost is a
 * per-room cosmetic decal, not a persistent/save-scoped effect, consistent
 * with other room-scoped cosmetic surface state in this codebase.
 *
 * Scope: purely cosmetic. No slip, no freeze, no collision or damage
 * effects are attached to frost-covered intervals. The interval data is
 * structured so a gameplay effect could later be layered on top (e.g. by
 * looking up coverage at a given surface position) without a redesign.
 */

import type { SurfaceExposureMap, SurfaceSegment } from './world/surfaceExposure';

/** How far (world px) a single Ice arrow hit extends frost in EACH direction along the struck surface. */
export const FROST_REACH_PX_PER_SHOT = 4;

/** Maximum frost depth (world px), measured outward from the terrain surface. */
export const FROST_MAX_DEPTH_PX = 4;

/** Animated creep speed (world px of interval growth per second) — "smoothly and rapidly". */
export const FROST_GROWTH_PX_PER_SEC = 60;

/** Safety cap on corner-hop recursion so a pathological map can't loop forever. */
const MAX_HOPS = 64;

/** Point-matching precision (grid coordinates are exact, but keep a tiny epsilon for float safety). */
const POINT_EPSILON = 0.01;

export interface FrostSegmentState {
  readonly segment: SurfaceSegment;
  /** Target (logical) coverage interval, in px along the segment from (x0,y0). Set instantly on hit. */
  targetStart: number;
  targetEnd: number;
  /** Currently-animated (visible) coverage interval — eases toward target each tick. */
  animStart: number;
  animEnd: number;
}

const _frost = new Map<string, FrostSegmentState>();

interface PendingImpact {
  readonly xWorld: number;
  readonly yWorld: number;
}
let _pending: PendingImpact[] = [];

/** Called from the sim (bowArrow.ts) when an Ice arrow strikes terrain — cheap, no surface-map dependency. */
export function recordIceArrowFrostImpact(xWorld: number, yWorld: number): void {
  _pending.push({ xWorld, yWorld });
}

/** Clears all frost coverage and any unprocessed impacts. Call on room load/reset. */
export function resetIceFrostForRoom(): void {
  _frost.clear();
  _pending = [];
}

function segKey(seg: SurfaceSegment): string {
  return `${seg.col},${seg.row},${seg.side}`;
}

function segLength(seg: SurfaceSegment): number {
  return Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0);
}

/** Projects (x,y) onto the segment's line, clamped to [0, segLength]. */
function localPosOnSegment(seg: SurfaceSegment, x: number, y: number): number {
  const len = segLength(seg);
  if (len < 1e-6) return 0;
  const t = ((x - seg.x0) * (seg.x1 - seg.x0) + (y - seg.y0) * (seg.y1 - seg.y0)) / (len * len);
  return Math.max(0, Math.min(len, t * len));
}

interface EndpointRef {
  readonly segIndex: number;
  /** True when the coincident endpoint is this neighbor's (x0,y0); false when it's (x1,y1). */
  readonly isStart: boolean;
}

interface SegmentAdjacency {
  readonly startNeighbor: readonly (EndpointRef | null)[];
  readonly endNeighbor: readonly (EndpointRef | null)[];
}

const _adjacencyCache = new WeakMap<SurfaceExposureMap, SegmentAdjacency>();

function pointKey(x: number, y: number): string {
  // Grid coordinates are exact multiples of the block size, so rounding to a
  // fraction of a pixel is enough to make float noise irrelevant.
  return `${Math.round(x / POINT_EPSILON)},${Math.round(y / POINT_EPSILON)}`;
}

/**
 * Builds (and caches, keyed by the `SurfaceExposureMap` instance) the
 * segment-endpoint adjacency graph used to walk frost growth across
 * corners. Cheap relative to the map build itself and only recomputed when
 * the room's wall layout changes (a new `SurfaceExposureMap` instance).
 */
function getAdjacency(map: SurfaceExposureMap): SegmentAdjacency {
  const cached = _adjacencyCache.get(map);
  if (cached) return cached;

  const byPoint = new Map<string, EndpointRef[]>();
  const pushRef = (key: string, ref: EndpointRef): void => {
    const list = byPoint.get(key);
    if (list) list.push(ref);
    else byPoint.set(key, [ref]);
  };
  map.segments.forEach((seg, segIndex) => {
    pushRef(pointKey(seg.x0, seg.y0), { segIndex, isStart: true });
    pushRef(pointKey(seg.x1, seg.y1), { segIndex, isStart: false });
  });

  const startNeighbor: (EndpointRef | null)[] = new Array(map.segments.length).fill(null);
  const endNeighbor: (EndpointRef | null)[] = new Array(map.segments.length).fill(null);
  map.segments.forEach((seg, segIndex) => {
    const atStart = byPoint.get(pointKey(seg.x0, seg.y0)) ?? [];
    startNeighbor[segIndex] = atStart.find((r) => r.segIndex !== segIndex) ?? null;
    const atEnd = byPoint.get(pointKey(seg.x1, seg.y1)) ?? [];
    endNeighbor[segIndex] = atEnd.find((r) => r.segIndex !== segIndex) ?? null;
  });

  const adjacency: SegmentAdjacency = { startNeighbor, endNeighbor };
  _adjacencyCache.set(map, adjacency);
  return adjacency;
}

function growState(seg: SurfaceSegment, localPos: number): FrostSegmentState {
  const key = segKey(seg);
  let state = _frost.get(key);
  if (!state) {
    state = { segment: seg, targetStart: localPos, targetEnd: localPos, animStart: localPos, animEnd: localPos };
    _frost.set(key, state);
  }
  return state;
}

/**
 * Walks frost growth outward from `localPos` on segment `segIndex`, in
 * direction `direction` (+1 toward (x1,y1), -1 toward (x0,y0)), for
 * `remaining` px. Crosses onto the connected segment when it reaches a
 * segment boundary with distance still remaining; stops silently when the
 * boundary has no connected neighbor (a gap / disconnected surface).
 */
function growWalk(
  map: SurfaceExposureMap,
  adjacency: SegmentAdjacency,
  segIndex: number,
  localPos: number,
  remaining: number,
  direction: 1 | -1,
  hops: number,
): void {
  if (remaining <= 1e-6 || hops > MAX_HOPS) return;
  const seg = map.segments[segIndex];
  const len = segLength(seg);
  const state = growState(seg, localPos);

  let newPos: number;
  let consumed: number;
  let hitBoundary: boolean;
  if (direction === 1) {
    newPos = Math.min(len, localPos + remaining);
    consumed = newPos - localPos;
    state.targetEnd = Math.max(state.targetEnd, newPos);
    state.targetStart = Math.min(state.targetStart, localPos);
    hitBoundary = newPos >= len - 1e-6;
  } else {
    newPos = Math.max(0, localPos - remaining);
    consumed = localPos - newPos;
    state.targetStart = Math.min(state.targetStart, newPos);
    state.targetEnd = Math.max(state.targetEnd, localPos);
    hitBoundary = newPos <= 1e-6;
  }

  const leftover = remaining - consumed;
  if (leftover <= 1e-6 || !hitBoundary) return;

  const neighbor = direction === 1 ? adjacency.endNeighbor[segIndex] : adjacency.startNeighbor[segIndex];
  if (!neighbor) return; // Disconnected / gap surface: growth stops here.

  const nSeg = map.segments[neighbor.segIndex];
  if (neighbor.isStart) {
    growWalk(map, adjacency, neighbor.segIndex, 0, leftover, 1, hops + 1);
  } else {
    growWalk(map, adjacency, neighbor.segIndex, segLength(nSeg), leftover, -1, hops + 1);
  }
}

/** Applies a single Ice arrow hit at (xWorld, yWorld) to the nearest exposed surface, growing frost both ways. */
export function applyIceArrowFrostHit(map: SurfaceExposureMap, xWorld: number, yWorld: number): void {
  if (map.segments.length === 0) return;

  let bestIndex = -1;
  let bestDistSq = Infinity;
  for (let i = 0; i < map.segments.length; i++) {
    const seg = map.segments[i];
    const midX = (seg.x0 + seg.x1) * 0.5;
    const midY = (seg.y0 + seg.y1) * 0.5;
    const dx = midX - xWorld;
    const dy = midY - yWorld;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) return;

  const seg = map.segments[bestIndex];
  const localPos = localPosOnSegment(seg, xWorld, yWorld);
  const adjacency = getAdjacency(map);
  growWalk(map, adjacency, bestIndex, localPos, FROST_REACH_PX_PER_SHOT, 1, 0);
  growWalk(map, adjacency, bestIndex, localPos, FROST_REACH_PX_PER_SHOT, -1, 0);
}

/** Drains and applies every impact queued since the last call, against the current room's surface map. */
export function processPendingIceFrostImpacts(map: SurfaceExposureMap): void {
  if (_pending.length === 0) return;
  for (const impact of _pending) {
    applyIceArrowFrostHit(map, impact.xWorld, impact.yWorld);
  }
  _pending = [];
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return current;
}

/** Eases every segment's animated coverage toward its target coverage. Call once per sim tick. */
export function tickIceFrostAnimation(dtMs: number): void {
  if (_frost.size === 0) return;
  const growPx = FROST_GROWTH_PX_PER_SEC * (dtMs / 1000);
  for (const state of _frost.values()) {
    state.animStart = approach(state.animStart, state.targetStart, growPx);
    state.animEnd = approach(state.animEnd, state.targetEnd, growPx);
  }
}

/** Returns the current frost coverage states for rendering. */
export function getIceFrostSegmentStates(): IterableIterator<FrostSegmentState> {
  return _frost.values();
}
