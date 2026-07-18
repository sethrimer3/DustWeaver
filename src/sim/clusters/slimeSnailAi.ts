/**
 * slimeSnailAi.ts — movement, corner rounding, and slime-trail deposit/decay
 * for the Slime Snail enemy.
 *
 * Movement is fully kinematic and specialized: the snail is excluded from
 * generic gravity/ground/chase movement (see movement.ts) and is driven
 * entirely by `applySlimeSnailAI`. Trail lifetime ticking is a separate pass
 * (`tickSlimeSnailTrails`) that runs independent of any living snail, so
 * trails keep decaying after their owning snail dies.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import {
  buildSlimeSnailSurfaceTopology,
  findNearestSlimeSnailSegment,
  getDirectedEndpoints,
  getNextSlimeSnailSegment,
  type SlimeSnailSurfaceTopology,
} from './slimeSnailSurfaceTopology';
import {
  buildTileSolidityGridFromRoomWalls,
  buildSurfaceExposureMap,
  type SurfaceExposureWallLike,
} from '../world/surfaceExposure';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  SLIME_SNAIL_CORNER_RADIUS_WORLD,
  SLIME_SNAIL_CRAWL_SPEED_WORLD_PER_SEC,
  SLIME_SNAIL_SURFACE_OFFSET_WORLD,
  SLIME_SNAIL_TRAIL_LIFETIME_TICKS,
} from './slimeSnailConfig';

// ── Immutable per-room topology cache ───────────────────────────────────────
// Holds ONLY derived, immutable surface topology, keyed by a cheap room
// signature (room id + wall count). Never holds mutable snail/trail state.
const topologyCache = new Map<string, SlimeSnailSurfaceTopology>();

function topologyCacheKey(world: WorldState): string {
  return `${world.builtForRoomId}:${world.wallCount}`;
}

/** Builds (or returns the cached) surface topology for the room's current wall layout. */
export function getSlimeSnailSurfaceTopology(world: WorldState): SlimeSnailSurfaceTopology {
  const key = topologyCacheKey(world);
  const cached = topologyCache.get(key);
  if (cached) return cached;

  const widthBlocks = Math.max(1, Math.ceil(world.worldWidthWorld / BLOCK_SIZE_SMALL));
  const heightBlocks = Math.max(1, Math.ceil(world.worldHeightWorld / BLOCK_SIZE_SMALL));

  const walls: SurfaceExposureWallLike[] = [];
  for (let i = 0; i < world.wallCount; i++) {
    walls.push({
      xBlock: world.wallXWorld[i] / BLOCK_SIZE_SMALL,
      yBlock: world.wallYWorld[i] / BLOCK_SIZE_SMALL,
      wBlock: world.wallWWorld[i] / BLOCK_SIZE_SMALL,
      hBlock: world.wallHWorld[i] / BLOCK_SIZE_SMALL,
      isPlatformFlag: world.wallIsPlatformFlag[i] as 0 | 1,
      isInvisibleFlag: world.wallIsInvisibleFlag[i] as 0 | 1,
    });
  }

  const grid = buildTileSolidityGridFromRoomWalls(walls, widthBlocks, heightBlocks, BLOCK_SIZE_SMALL);
  const exposureMap = buildSurfaceExposureMap(grid);
  const topology = buildSlimeSnailSurfaceTopology(exposureMap);

  // Bound cache growth: this is invalidated by room id + wall count, so a
  // long session visiting many rooms could otherwise accumulate entries
  // indefinitely. Clear rather than let it grow unbounded.
  if (topologyCache.size > 16) topologyCache.clear();
  topologyCache.set(key, topology);
  return topology;
}

// ── Spawn ────────────────────────────────────────────────────────────────

/**
 * Places a newly-spawned slime snail cluster onto the nearest matching
 * exposed surface segment near its authored position. Never throws — if no
 * segment can be found (invalid placement / degenerate room), the snail is
 * left stationary with `slimeSnailSurfaceSegmentIndex = -1` and a dev-only
 * warning is emitted.
 */
export function placeSlimeSnailOnSurface(world: WorldState, cluster: ClusterState): void {
  const topology = getSlimeSnailSurfaceTopology(world);
  const segIndex = findNearestSlimeSnailSegment(
    topology,
    cluster.positionXWorld,
    cluster.positionYWorld,
    cluster.slimeSnailSurfaceSideIndex,
    BLOCK_SIZE_SMALL * 6,
  );

  if (segIndex < 0) {
    cluster.slimeSnailSurfaceSegmentIndex = -1;
    if (import.meta.env?.DEV) {
      console.warn(
        `[slimeSnail] no exposed surface found near (${cluster.positionXWorld}, ${cluster.positionYWorld}); snail will remain stationary.`,
      );
    }
    return;
  }

  const seg = topology.segments[segIndex];
  cluster.slimeSnailSurfaceSegmentIndex = segIndex;
  cluster.slimeSnailSurfaceSideIndex = seg.sideIndex as 0 | 1 | 2 | 3;
  cluster.slimeSnailSegmentProgressWorld = 0;
  cluster.slimeSnailCornerActiveFlag = 0;

  const dir = getDirectedEndpoints(seg, cluster.slimeSnailClockwiseFlag);
  cluster.positionXWorld = dir.startX + seg.normalX * SLIME_SNAIL_SURFACE_OFFSET_WORLD;
  cluster.positionYWorld = dir.startY + seg.normalY * SLIME_SNAIL_SURFACE_OFFSET_WORLD;
  cluster.slimeSnailBodyAngleRad = Math.atan2(dir.endY - dir.startY, dir.endX - dir.startX);
}

// ── Trail deposit ───────────────────────────────────────────────────────────

function depositTrailRecord(
  world: WorldState,
  cluster: ClusterState,
  col: number,
  row: number,
  sideIndex: number,
): void {
  const slot = cluster.slimeSnailTrailSlotIndex;
  if (slot < 0) return;

  const stride = world.slimeSnailTrailStride;
  const base = slot * stride;
  const head = world.slimeSnailTrailHead[slot];
  const flat = base + head;

  world.slimeSnailTrailCol[flat] = col;
  world.slimeSnailTrailRow[flat] = row;
  world.slimeSnailTrailSideIndex[flat] = sideIndex;
  world.slimeSnailTrailRemainingTicks[flat] = SLIME_SNAIL_TRAIL_LIFETIME_TICKS;
  // Deterministic seed from stable values only (no Math.random / wall clock).
  world.slimeSnailTrailVisualSeed[flat] =
    ((cluster.entityId * 73856093) ^ (col * 19349663) ^ (row * 83492791) ^ (sideIndex * 2654435761) ^ world.tick) >>> 0;

  world.slimeSnailTrailHead[slot] = (head + 1) % stride;
  if (world.slimeSnailTrailCount[slot] < stride) world.slimeSnailTrailCount[slot]++;
}

// ── Corner interpolation (pure, unit-testable) ──────────────────────────────

/**
 * Given a start angle and a signed delta, returns the interpolated normal
 * angle at parameter t in [0,1] (t = arc-length progress / total arc length).
 */
export function interpolateCornerAngleRad(startAngleRad: number, deltaAngleRad: number, t: number): number {
  return startAngleRad + deltaAngleRad * Math.max(0, Math.min(1, t));
}

/** World-space position of the body during a corner arc at parameter t in [0,1]. */
export function interpolateCornerPosition(
  cornerXWorld: number,
  cornerYWorld: number,
  startAngleRad: number,
  deltaAngleRad: number,
  radiusWorld: number,
  t: number,
): { x: number; y: number; normalAngleRad: number } {
  const angle = interpolateCornerAngleRad(startAngleRad, deltaAngleRad, t);
  return {
    x: cornerXWorld + Math.cos(angle) * radiusWorld,
    y: cornerYWorld + Math.sin(angle) * radiusWorld,
    normalAngleRad: angle,
  };
}

/** Shortest signed angular delta from `a` to `b`, in (-PI, PI]. */
function shortestAngleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ── Per-snail movement ───────────────────────────────────────────────────────

const MAX_SEGMENTS_PER_TICK = 32; // bounded safety limit for large dtMs

function beginCorner(world: WorldState, cluster: ClusterState, topology: SlimeSnailSurfaceTopology): boolean {
  const currentSeg = topology.segments[cluster.slimeSnailSurfaceSegmentIndex];
  if (!currentSeg) return false;

  const next = getNextSlimeSnailSegment(topology, cluster.slimeSnailSurfaceSegmentIndex, cluster.slimeSnailClockwiseFlag);

  // Completed traversal of the current segment: deposit slime for it.
  depositTrailRecord(world, cluster, currentSeg.col, currentSeg.row, currentSeg.sideIndex);

  if (!next) {
    // Dead end (shouldn't normally happen on a closed boundary loop, but
    // stop safely rather than crash if it does).
    cluster.slimeSnailSegmentProgressWorld = 0;
    return false;
  }

  const nextSeg = topology.segments[next.nextIndex];
  const prevNormalAngle = Math.atan2(currentSeg.normalY, currentSeg.normalX);
  const nextNormalAngle = Math.atan2(nextSeg.normalY, nextSeg.normalX);
  const delta = shortestAngleDelta(prevNormalAngle, nextNormalAngle);

  cluster.slimeSnailCornerActiveFlag = 1;
  cluster.slimeSnailCornerProgressWorld = 0;
  cluster.slimeSnailCornerXWorld = next.cornerXWorld;
  cluster.slimeSnailCornerYWorld = next.cornerYWorld;
  cluster.slimeSnailCornerStartAngleRad = prevNormalAngle;
  cluster.slimeSnailCornerDeltaAngleRad = delta;
  cluster.slimeSnailSurfaceSegmentIndex = next.nextIndex;
  cluster.slimeSnailSurfaceSideIndex = nextSeg.sideIndex as 0 | 1 | 2 | 3;
  cluster.slimeSnailSegmentProgressWorld = 0;
  return true;
}

function advanceCluster(world: WorldState, cluster: ClusterState, topology: SlimeSnailSurfaceTopology, distanceWorld: number): void {
  let remaining = distanceWorld;
  let safety = 0;

  while (remaining > 1e-6 && safety < MAX_SEGMENTS_PER_TICK) {
    safety++;

    if (cluster.slimeSnailCornerActiveFlag === 1) {
      const cornerArcLength = (Math.PI / 2) * SLIME_SNAIL_CORNER_RADIUS_WORLD;
      const remainingArc = cornerArcLength - cluster.slimeSnailCornerProgressWorld;
      const step = Math.min(remaining, Math.max(0, remainingArc));
      cluster.slimeSnailCornerProgressWorld += step;
      remaining -= step;

      const t = cornerArcLength > 0 ? cluster.slimeSnailCornerProgressWorld / cornerArcLength : 1;
      const interp = interpolateCornerPosition(
        cluster.slimeSnailCornerXWorld,
        cluster.slimeSnailCornerYWorld,
        cluster.slimeSnailCornerStartAngleRad,
        cluster.slimeSnailCornerDeltaAngleRad,
        SLIME_SNAIL_CORNER_RADIUS_WORLD,
        t,
      );
      cluster.positionXWorld = interp.x;
      cluster.positionYWorld = interp.y;
      cluster.slimeSnailBodyAngleRad = interp.normalAngleRad + Math.PI / 2 * (cluster.slimeSnailClockwiseFlag === 1 ? 1 : -1);

      if (t >= 1) {
        cluster.slimeSnailCornerActiveFlag = 0;
        cluster.slimeSnailCornerProgressWorld = 0;
      } else {
        break; // corner not finished, and we've consumed all remaining distance
      }
      continue;
    }

    const seg = topology.segments[cluster.slimeSnailSurfaceSegmentIndex];
    if (!seg) return; // stationary / invalid placement

    const dir = getDirectedEndpoints(seg, cluster.slimeSnailClockwiseFlag);
    const dirX = dir.endX - dir.startX;
    const dirY = dir.endY - dir.startY;
    const segLen = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    const tanX = dirX / segLen;
    const tanY = dirY / segLen;

    const remainingOnSegment = segLen - cluster.slimeSnailSegmentProgressWorld;
    const step = Math.min(remaining, Math.max(0, remainingOnSegment));
    cluster.slimeSnailSegmentProgressWorld += step;
    remaining -= step;

    const px = dir.startX + tanX * cluster.slimeSnailSegmentProgressWorld;
    const py = dir.startY + tanY * cluster.slimeSnailSegmentProgressWorld;
    cluster.positionXWorld = px + seg.normalX * SLIME_SNAIL_SURFACE_OFFSET_WORLD;
    cluster.positionYWorld = py + seg.normalY * SLIME_SNAIL_SURFACE_OFFSET_WORLD;
    cluster.slimeSnailBodyAngleRad = Math.atan2(tanY, tanX);

    if (cluster.slimeSnailSegmentProgressWorld >= segLen - 1e-6) {
      const started = beginCorner(world, cluster, topology);
      if (!started) return;
    } else {
      break; // segment not finished, distance exhausted
    }
  }
}

/**
 * Advances all living slime snails by one tick. Must run before momentum
 * collision damage so momentum hits use the snail's current tick position.
 * A snail whose HP hits zero this tick (checked via slimeSnailPrevHealthPoints
 * at the start of the *next* tick) simply stops moving/depositing because
 * applyMomentumCombatCollisionDamage sets isAliveFlag=0 and this function
 * skips dead clusters.
 */
export function applySlimeSnailAI(world: WorldState): void {
  const distanceThisTick = SLIME_SNAIL_CRAWL_SPEED_WORLD_PER_SEC * world.dtMs * 0.001;
  if (distanceThisTick <= 0) return;

  const topology = getSlimeSnailSurfaceTopology(world);

  for (const cluster of world.clusters) {
    if (cluster.isSlimeSnailFlag !== 1) continue;
    if (cluster.isAliveFlag !== 1) continue;
    if (cluster.slimeSnailSurfaceSegmentIndex < 0) continue; // invalid placement: stays stationary

    advanceCluster(world, cluster, topology, distanceThisTick);
  }
}

// ── Trail lifetime ticking (independent of snail liveness) ──────────────────

/** Ticks down every active slime trail record across all slots. Runs every sim tick regardless of any snail being alive. */
export function tickSlimeSnailTrails(world: WorldState): void {
  const stride = world.slimeSnailTrailStride;
  const slotCount = world.slimeSnailTrailCount.length;

  for (let slot = 0; slot < slotCount; slot++) {
    const count = world.slimeSnailTrailCount[slot];
    if (count === 0) continue;
    const base = slot * stride;
    for (let i = 0; i < count; i++) {
      const flat = base + i;
      const remaining = world.slimeSnailTrailRemainingTicks[flat];
      if (remaining > 0) world.slimeSnailTrailRemainingTicks[flat] = remaining - 1;
    }
  }
}

// ── Grapple-blocking query (shared by sim grapple.ts and render golden-highlight) ──

/**
 * Minimal read-only view of the slime trail buffers, satisfied by both
 * `WorldState` and `WorldSnapshot` — so the same pure helpers can be used
 * from simulation (fireGrapple) and rendering (golden highlight) without
 * either depending on the other's concrete type.
 */
export interface SlimeSnailTrailView {
  readonly slimeSnailTrailCol: ArrayLike<number>;
  readonly slimeSnailTrailRow: ArrayLike<number>;
  readonly slimeSnailTrailSideIndex: ArrayLike<number>;
  readonly slimeSnailTrailRemainingTicks: ArrayLike<number>;
  readonly slimeSnailTrailCount: ArrayLike<number>;
  readonly slimeSnailTrailStride: number;
}

/** True if any active (remaining > 0) trail record covers this exact tile side. */
export function isSurfaceSegmentSlimed(trailView: SlimeSnailTrailView, col: number, row: number, sideIndex: number): boolean {
  const stride = trailView.slimeSnailTrailStride;
  const slotCount = trailView.slimeSnailTrailCount.length;

  for (let slot = 0; slot < slotCount; slot++) {
    const count = trailView.slimeSnailTrailCount[slot];
    if (count === 0) continue;
    const base = slot * stride;
    for (let i = 0; i < count; i++) {
      const flat = base + i;
      if (trailView.slimeSnailTrailRemainingTicks[flat] <= 0) continue;
      if (
        trailView.slimeSnailTrailCol[flat] === col &&
        trailView.slimeSnailTrailRow[flat] === row &&
        trailView.slimeSnailTrailSideIndex[flat] === sideIndex
      ) {
        return true;
      }
    }
  }
  return false;
}

const SEAM_EPSILON_WORLD = 0.35; // matches SLIME_SNAIL_TRAIL_HIT_EPSILON_WORLD

function tangentTileCandidates(coordWorld: number): number[] {
  const primary = Math.floor(coordWorld / BLOCK_SIZE_SMALL);
  const fracWorld = coordWorld - primary * BLOCK_SIZE_SMALL;
  const candidates = [primary];
  if (fracWorld < SEAM_EPSILON_WORLD) candidates.push(primary - 1);
  if (BLOCK_SIZE_SMALL - fracWorld < SEAM_EPSILON_WORLD) candidates.push(primary + 1);
  return candidates;
}

/**
 * Determines whether a grapple raycast wall-hit point lands on an active
 * slime segment. Matches the hit normal to a surface side, reconstructs the
 * candidate tile(s) (accounting for seam ambiguity via a small epsilon so a
 * hit exactly on a tile boundary is blocked if either adjacent covering
 * segment is slimed), and checks `isSurfaceSegmentSlimed` for each.
 */
export function isGrappleWallHitSlimed(
  trailView: SlimeSnailTrailView,
  hitXWorld: number,
  hitYWorld: number,
  normalX: number,
  normalY: number,
): boolean {
  let sideIndex: number;
  let perpCoordWorld: number;
  let tangentCoordWorld: number;
  let perpIsRow: boolean;

  if (normalY < -0.5) {
    sideIndex = 0; // top
    perpCoordWorld = hitYWorld;
    tangentCoordWorld = hitXWorld;
    perpIsRow = true;
  } else if (normalX > 0.5) {
    sideIndex = 1; // right
    perpCoordWorld = hitXWorld - BLOCK_SIZE_SMALL; // right edge belongs to tile at col = floor((x - size)/size) rounded
    tangentCoordWorld = hitYWorld;
    perpIsRow = false;
  } else if (normalY > 0.5) {
    sideIndex = 2; // bottom
    perpCoordWorld = hitYWorld - BLOCK_SIZE_SMALL;
    tangentCoordWorld = hitXWorld;
    perpIsRow = true;
  } else if (normalX < -0.5) {
    sideIndex = 3; // left
    perpCoordWorld = hitXWorld;
    tangentCoordWorld = hitYWorld;
    perpIsRow = false;
  } else {
    return false; // degenerate/diagonal normal — not a cardinal wall side
  }

  const perpIndex = Math.round(perpCoordWorld / BLOCK_SIZE_SMALL);
  const tangentCandidates = tangentTileCandidates(tangentCoordWorld);

  for (const tangentIndex of tangentCandidates) {
    const col = perpIsRow ? tangentIndex : perpIndex;
    const row = perpIsRow ? perpIndex : tangentIndex;
    if (isSurfaceSegmentSlimed(trailView, col, row, sideIndex)) return true;
  }
  return false;
}
