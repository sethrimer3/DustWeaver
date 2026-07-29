/**
 * laserTraceContract.ts — deterministic, Node-safe laser beam/reflection
 * geometry contract shared by the sim (damage/reflection outcome) and the
 * renderer (segment drawing). Pure functions only: no DOM, no Math.random,
 * no wall-clock dependency.
 *
 * A laser emitter fires one ray. The ray travels until the nearest
 * authoritative terrain hit (a wall/room-boundary distance supplied by the
 * caller, already resolved against real collision geometry) UNLESS it first
 * crosses the currently active portion of a Shield Weave's circular arc, in
 * which case it reflects exactly once off that arc's real curved surface and
 * continues until its own terrain hit.
 *
 * This module intentionally knows nothing about walls, players, or the
 * WorldState buffer layout — callers supply the terrain distance and the
 * shield geometry, and (for the reflected leg) a wall-raycast callback.
 */

import { getShieldArcRayHit, reflectDirection, type ShieldArcGeometry } from './stormweave/shieldWeave';

/** Tiny push applied beyond the shield contact point to avoid immediate self-intersection. */
export const LASER_REFLECT_EPSILON_WORLD = 0.75;

export interface LaserSegment {
  startXWorld: number;
  startYWorld: number;
  endXWorld: number;
  endYWorld: number;
}

export interface LaserTraceResult {
  /** The beam segment from the emitter to either the terrain hit or the shield contact point. */
  incoming: LaserSegment;
  /** True when the shield deflected the beam before it reached terrain/the player. */
  hasReflection: boolean;
  /** Present only when `hasReflection` is true. */
  reflection: {
    contactXWorld: number;
    contactYWorld: number;
    normalXWorld: number;
    normalYWorld: number;
    dirXWorld: number;
    dirYWorld: number;
    outgoing: LaserSegment;
  } | null;
}

/** Raycasts the reflected leg against terrain; returns the hit point (or a bounded fallback point when nothing is hit). */
export type TerrainRayCallback = (
  originXWorld: number,
  originYWorld: number,
  dirXWorld: number,
  dirYWorld: number,
  maxRangeWorld: number,
) => { xWorld: number; yWorld: number } | null;

/**
 * Traces one laser emitter beam for the current tick.
 *
 * @param originXWorld/YWorld  Center of the emitter's outward-facing edge.
 * @param dirXWorld/YWorld     Normalized firing direction.
 * @param terrainDistanceWorld Precomputed distance from origin to the nearest
 *   authoritative wall/room-boundary hit along `dir` (unobstructed length).
 * @param shieldGeometry       Active Shield Weave arc geometry, or undefined/inactive to skip reflection.
 * @param traceTerrainRay      Used only for the reflected leg's terrain hit.
 * @param reflectMaxRangeWorld Bound for the reflected leg's raycast (defensive upper bound; a real hit is expected well within a bounded room).
 */
export function traceLaserBeam(
  originXWorld: number,
  originYWorld: number,
  dirXWorld: number,
  dirYWorld: number,
  terrainDistanceWorld: number,
  shieldGeometry: ShieldArcGeometry | undefined,
  traceTerrainRay: TerrainRayCallback,
  reflectMaxRangeWorld: number,
): LaserTraceResult {
  const clampedTerrainDistance = Math.max(0, terrainDistanceWorld);

  const shieldHit = shieldGeometry !== undefined && shieldGeometry.isActive && shieldGeometry.moteCount > 0
    ? getShieldArcRayHit(shieldGeometry, originXWorld, originYWorld, dirXWorld, dirYWorld, clampedTerrainDistance)
    : null;

  if (shieldHit === null) {
    return {
      incoming: {
        startXWorld: originXWorld,
        startYWorld: originYWorld,
        endXWorld: originXWorld + dirXWorld * clampedTerrainDistance,
        endYWorld: originYWorld + dirYWorld * clampedTerrainDistance,
      },
      hasReflection: false,
      reflection: null,
    };
  }

  const reflected = reflectDirection(dirXWorld, dirYWorld, shieldHit.normalXWorld, shieldHit.normalYWorld);
  const outOriginXWorld = shieldHit.xWorld + reflected.xWorld * LASER_REFLECT_EPSILON_WORLD;
  const outOriginYWorld = shieldHit.yWorld + reflected.yWorld * LASER_REFLECT_EPSILON_WORLD;

  const terrainHit = traceTerrainRay(outOriginXWorld, outOriginYWorld, reflected.xWorld, reflected.yWorld, reflectMaxRangeWorld);
  const outEndXWorld = terrainHit !== null ? terrainHit.xWorld : outOriginXWorld + reflected.xWorld * reflectMaxRangeWorld;
  const outEndYWorld = terrainHit !== null ? terrainHit.yWorld : outOriginYWorld + reflected.yWorld * reflectMaxRangeWorld;

  return {
    incoming: {
      startXWorld: originXWorld,
      startYWorld: originYWorld,
      endXWorld: shieldHit.xWorld,
      endYWorld: shieldHit.yWorld,
    },
    hasReflection: true,
    reflection: {
      contactXWorld: shieldHit.xWorld,
      contactYWorld: shieldHit.yWorld,
      normalXWorld: shieldHit.normalXWorld,
      normalYWorld: shieldHit.normalYWorld,
      dirXWorld: reflected.xWorld,
      dirYWorld: reflected.yWorld,
      outgoing: {
        startXWorld: outOriginXWorld,
        startYWorld: outOriginYWorld,
        endXWorld: outEndXWorld,
        endYWorld: outEndYWorld,
      },
    },
  };
}

/** Shortest distance from a point to a segment (world units). Used for beam-thickness damage checks. */
export function distancePointToSegmentWorld(
  pxWorld: number, pyWorld: number,
  axWorld: number, ayWorld: number,
  bxWorld: number, byWorld: number,
): number {
  const abx = bxWorld - axWorld;
  const aby = byWorld - ayWorld;
  const denom = abx * abx + aby * aby;
  const t = denom > 1e-12 ? Math.max(0, Math.min(1, ((pxWorld - axWorld) * abx + (pyWorld - ayWorld) * aby) / denom)) : 0;
  const cx = axWorld + abx * t;
  const cy = ayWorld + aby * t;
  return Math.hypot(pxWorld - cx, pyWorld - cy);
}
