/**
 * Converts moving clusters (player + enemies, uniformly — `WorldState.clusters`
 * already holds both under one array/type, see sim/clusters/state.ts) into
 * local wind impulses on the pixel-material system.
 *
 * This is a production CALLER of the low-level `PixelMaterialSystem.applyWindForce`
 * primitive, not a new force model — all the actual physics (momentum,
 * damping, wake-on-touch) already lives in `pixelMaterialSystem.ts`. This
 * module only decides WHEN and WHERE to call it based on entity velocity.
 *
 * Game-feel goals (not physically exact):
 *   - Standing still or moving slowly emits no wind (`MIN_SPEED_WORLD` gate).
 *   - Faster movement -> wider radius and stronger force, clamped so a single
 *     entity can never blast sand across the whole room.
 *   - The strongest impulse trails slightly BEHIND the entity (opposite its
 *     velocity direction) like a wake, plus a weaker perpendicular "side
 *     turbulence" impulse for a less mechanical look.
 *   - Locality: `applyWindForce` already only scans the small AABB around its
 *     center (see pixelMaterialSystem.ts), so per-entity cost is bounded by
 *     radius², not room size — looping over `world.clusters` (typically a
 *     handful of enemies + the player) does not scan the whole room.
 *
 * Determinism: the only "randomness" is the lateral-turbulence side, which
 * alternates deterministically from `(world.tick + clusterIndex) & 1` — no
 * `Math.random()`, matching the existing deterministic diagonal-fall chooser
 * in pixelMaterialSystem.ts. Same inputs always produce the same wind.
 */

import type { WorldState } from '../world';

/** Below this speed (world units/s), an entity emits no movement wind at all. */
const MIN_SPEED_WORLD = 60;

/** Speed at which wind strength/radius reach their maximum (grapple/zip/high-speed-skid territory). */
const MAX_SCALING_SPEED_WORLD = 420;

const MIN_RADIUS_PX = 3;
const MAX_RADIUS_PX = 11;

const MIN_FORCE = 24;
const MAX_FORCE = 130;

/** Fraction of the trailing impulse's radius placed behind the entity's center. */
const TRAIL_OFFSET_FACTOR = 0.55;

/** Lateral (perpendicular) impulse strength as a fraction of the trailing force. */
const LATERAL_FORCE_FACTOR = 0.32;
/** Lateral impulse offset from center, as a fraction of radius. */
const LATERAL_OFFSET_FACTOR = 0.45;
/** Lateral impulse radius, as a fraction of the trailing radius (narrower, more turbulent-looking). */
const LATERAL_RADIUS_FACTOR = 0.6;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Emits movement-driven wind impulses for every alive cluster (player and
 * enemies alike — no special-casing by `isPlayerFlag`) whose current speed
 * exceeds `MIN_SPEED_WORLD`.
 */
export function applyMovementWindToPixelMaterials(world: WorldState): void {
  const system = world.pixelMaterialSystem;
  const clusters = world.clusters;

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    if (c.isAliveFlag === 0) continue;

    const vx = c.velocityXWorld;
    const vy = c.velocityYWorld;
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < MIN_SPEED_WORLD) continue;

    const t = clamp01((speed - MIN_SPEED_WORLD) / (MAX_SCALING_SPEED_WORLD - MIN_SPEED_WORLD));
    const sizeBonus = Math.min(4, c.halfWidthWorld * 0.2);
    const radius = Math.min(MAX_RADIUS_PX, MIN_RADIUS_PX + t * (MAX_RADIUS_PX - MIN_RADIUS_PX) + sizeBonus);
    const force = MIN_FORCE + t * (MAX_FORCE - MIN_FORCE);

    const invSpeed = 1 / speed;
    const dirX = vx * invSpeed;
    const dirY = vy * invSpeed;

    const sourceId = c.isPlayerFlag === 1 ? 'player' : `enemy:${i}`;

    // Trailing impulse: centered slightly behind the entity, pushing along
    // its direction of travel (a "wake" rather than a symmetric blast).
    const trailX = c.positionXWorld - dirX * radius * TRAIL_OFFSET_FACTOR;
    const trailY = c.positionYWorld - dirY * radius * TRAIL_OFFSET_FACTOR;
    system.applyWindForce({
      centerXPx: trailX,
      centerYPx: trailY,
      radiusPx: radius,
      forceX: dirX * force,
      forceY: dirY * force,
      falloff: 1,
      sourceId,
    });

    // Lateral turbulence: a weaker perpendicular impulse, alternating side
    // deterministically so it doesn't look like a static one-sided nudge.
    const perpX = -dirY;
    const perpY = dirX;
    const side = ((world.tick + i) & 1) === 0 ? 1 : -1;
    const lateralX = c.positionXWorld + perpX * radius * LATERAL_OFFSET_FACTOR * side;
    const lateralY = c.positionYWorld + perpY * radius * LATERAL_OFFSET_FACTOR * side;
    system.applyWindForce({
      centerXPx: lateralX,
      centerYPx: lateralY,
      radiusPx: radius * LATERAL_RADIUS_FACTOR,
      forceX: perpX * force * LATERAL_FORCE_FACTOR * side,
      forceY: perpY * force * LATERAL_FORCE_FACTOR * side,
      falloff: 1,
      sourceId: `${sourceId}:lateral`,
    });
  }
}
