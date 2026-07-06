import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import {
  VOID_SPHERE_BOUNDS_MARGIN_WORLD,
  VOID_SPHERE_DAMAGE,
  VOID_SPHERE_DAMAGE_RADIUS_WORLD,
  VOID_SPHERE_IFRAMES,
  VOID_SPHERE_LIFETIME_TICKS,
} from './heraldConfig';

/** Finds a free Void Sphere slot, or -1 if the fixed-size buffer is full (cap enforcement). */
function allocVoidSphere(world: WorldState): number {
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 0) return i;
  }
  return -1;
}

/**
 * Spawns a Void Sphere travelling from (xWorld, yWorld) toward (targetXWorld, targetYWorld).
 * No-ops if the active-sphere cap (MAX_VOID_SPHERES) has been reached.
 */
export function spawnVoidSphere(
  world: WorldState,
  xWorld: number,
  yWorld: number,
  targetXWorld: number,
  targetYWorld: number,
  speedWorld: number,
): void {
  const i = allocVoidSphere(world);
  if (i < 0) return;
  const dx = targetXWorld - xWorld;
  const dy = targetYWorld - yWorld;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  world.voidSphereAliveFlag[i] = 1;
  world.voidSphereXWorld[i] = xWorld;
  world.voidSphereYWorld[i] = yWorld;
  world.voidSphereVelXWorld[i] = (dx / len) * speedWorld;
  world.voidSphereVelYWorld[i] = (dy / len) * speedWorld;
  world.voidSphereAgeTicks[i] = 0;
  world.voidSpherePulsePhaseRad[i] = 0;
}

/**
 * Advances all active Void Spheres. Movement deliberately ignores wall/tile
 * collision entirely (the sphere passes through walls, terrain, and blocks) —
 * only room-bounds-plus-margin and lifetime end its flight.
 */
export function tickVoidSpheres(world: WorldState): void {
  const player = world.clusters[0];
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 0) continue;

    world.voidSphereAgeTicks[i] += 1;
    world.voidSpherePulsePhaseRad[i] += 0.12;
    world.voidSphereXWorld[i] += world.voidSphereVelXWorld[i];
    world.voidSphereYWorld[i] += world.voidSphereVelYWorld[i];

    const x = world.voidSphereXWorld[i];
    const y = world.voidSphereYWorld[i];

    if (player !== undefined && player.isAliveFlag === 1 && player.invulnerabilityTicks <= 0) {
      const dx = player.positionXWorld - x;
      const dy = player.positionYWorld - y;
      if (dx * dx + dy * dy <= VOID_SPHERE_DAMAGE_RADIUS_WORLD * VOID_SPHERE_DAMAGE_RADIUS_WORLD) {
        applyPlayerDamageWithKnockback(player, VOID_SPHERE_DAMAGE, x, y);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, VOID_SPHERE_IFRAMES);
      }
    }

    const outOfBounds =
      x < -VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      y < -VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      x > world.worldWidthWorld + VOID_SPHERE_BOUNDS_MARGIN_WORLD ||
      y > world.worldHeightWorld + VOID_SPHERE_BOUNDS_MARGIN_WORLD;
    const expired = world.voidSphereAgeTicks[i] >= VOID_SPHERE_LIFETIME_TICKS;
    if (outOfBounds || expired) {
      world.voidSphereAliveFlag[i] = 0;
    }
  }
}
