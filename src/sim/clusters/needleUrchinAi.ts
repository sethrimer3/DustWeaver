import type { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { tryBlockHostileProjectile } from '../stormweave/shieldWeave';
import type { ClusterState } from './state';
import * as C from './needleUrchinConfig';

export function segmentAabbHitT(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number | null {
  const deltaX = x1 - x0;
  const deltaY = y1 - y0;
  let earliestT = 0;
  let latestT = 1;
  const axes: readonly (readonly [number, number, number, number])[] = [
    [x0, deltaX, minX, maxX],
    [y0, deltaY, minY, maxY],
  ];

  for (const [position, delta, minimum, maximum] of axes) {
    if (Math.abs(delta) < 1e-9) {
      if (position < minimum || position > maximum) {
        return null;
      }
      continue;
    }

    let entryT = (minimum - position) / delta;
    let exitT = (maximum - position) / delta;
    if (entryT > exitT) {
      [entryT, exitT] = [exitT, entryT];
    }
    earliestT = Math.max(earliestT, entryT);
    latestT = Math.min(latestT, exitT);
    if (earliestT > latestT) {
      return null;
    }
  }
  return earliestT;
}

export function findSweptNeedlePlayerHitT(
  player: ClusterState | undefined,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  if (!player || player.isAliveFlag === 0) {
    return null;
  }

  const padding = C.NEEDLE_PROJECTILE_HALF_WIDTH_WORLD;
  return segmentAabbHitT(
    x0,
    y0,
    x1,
    y1,
    player.positionXWorld - player.halfWidthWorld - padding,
    player.positionYWorld - player.halfHeightWorld - padding,
    player.positionXWorld + player.halfWidthWorld + padding,
    player.positionYWorld + player.halfHeightWorld + padding,
  );
}

export function findEarliestNeedleWallHitT(
  world: WorldState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  let earliestWallT: number | null = null;
  for (let wallIndex = 0; wallIndex < world.wallCount; wallIndex++) {
    const widthWorld = world.wallWWorld[wallIndex];
    const heightWorld = world.wallHWorld[wallIndex];
    if (widthWorld <= 0 || heightWorld <= 0) {
      continue;
    }

    const wallT = segmentAabbHitT(
      x0,
      y0,
      x1,
      y1,
      world.wallXWorld[wallIndex],
      world.wallYWorld[wallIndex],
      world.wallXWorld[wallIndex] + widthWorld,
      world.wallYWorld[wallIndex] + heightWorld,
    );
    if (wallT !== null && (earliestWallT === null || wallT < earliestWallT)) {
      earliestWallT = wallT;
    }
  }
  return earliestWallT;
}

export function shouldTriggerNeedleUrchin(
  deltaXWorld: number,
  deltaYWorld: number,
  velocityXWorld: number,
  velocityYWorld: number,
): boolean {
  const withinRange = deltaXWorld * deltaXWorld + deltaYWorld * deltaYWorld
    <= C.NEEDLE_URCHIN_TRIGGER_RADIUS_WORLD ** 2;
  const speedWorldPerSec = Math.hypot(velocityXWorld, velocityYWorld);
  return withinRange && speedWorldPerSec > C.NEEDLE_URCHIN_TRIGGER_SPEED_WORLD_PER_SEC;
}

export function fireNeedleBurst(world: WorldState, urchin: ClusterState): void {
  const player = world.clusters[0];
  const slot = urchin.needleUrchinSlotIndex;
  if (!player || slot < 0) {
    return;
  }

  const baseAngleRad = Math.atan2(
    player.positionYWorld - urchin.positionYWorld,
    player.positionXWorld - urchin.positionXWorld,
  );
  const angleStepRad = Math.PI * 2 / C.NEEDLE_URCHIN_NEEDLES_PER_BURST;
  urchin.needleUrchinBurstPhaseRad = baseAngleRad;

  for (let needleIndex = 0; needleIndex < C.NEEDLE_URCHIN_NEEDLES_PER_BURST; needleIndex++) {
    const flatIndex = slot * C.NEEDLE_URCHIN_NEEDLES_PER_BURST + needleIndex;
    const angleRad = baseAngleRad + needleIndex * angleStepRad;
    const directionX = Math.cos(angleRad);
    const directionY = Math.sin(angleRad);
    const xWorld = urchin.positionXWorld + directionX * C.NEEDLE_PROJECTILE_SPAWN_RADIUS_WORLD;
    const yWorld = urchin.positionYWorld + directionY * C.NEEDLE_PROJECTILE_SPAWN_RADIUS_WORLD;

    world.needleProjectileXWorld[flatIndex] = xWorld;
    world.needleProjectileYWorld[flatIndex] = yWorld;
    world.needleProjectilePrevXWorld[flatIndex] = xWorld;
    world.needleProjectilePrevYWorld[flatIndex] = yWorld;
    world.needleProjectileVelXWorld[flatIndex] = directionX * C.NEEDLE_PROJECTILE_SPEED_WORLD_PER_SEC;
    world.needleProjectileVelYWorld[flatIndex] = directionY * C.NEEDLE_PROJECTILE_SPEED_WORLD_PER_SEC;
    world.needleProjectileLifetimeTicks[flatIndex] = C.NEEDLE_PROJECTILE_LIFETIME_TICKS;
    world.needleProjectileAliveFlag[flatIndex] = 1;
    world.needleProjectileOwnerSlot[flatIndex] = slot;
  }
}

export function applyNeedleUrchinAI(world: WorldState): void {
  const player = world.clusters[0];
  if (!player) {
    return;
  }

  for (const urchin of world.clusters) {
    if (urchin.isNeedleUrchinFlag !== 1 || urchin.isAliveFlag === 0) {
      continue;
    }

    if (urchin.healthPoints < urchin.needleUrchinPrevHealthPoints) {
      urchin.needleUrchinHitFlashTicks = C.NEEDLE_URCHIN_HIT_FLASH_TICKS;
    } else if (urchin.needleUrchinHitFlashTicks > 0) {
      urchin.needleUrchinHitFlashTicks--;
    }
    urchin.needleUrchinPrevHealthPoints = urchin.healthPoints;

    urchin.velocityXWorld = 0;
    urchin.velocityYWorld = 0;
    if (urchin.needleUrchinShotFlashTicks > 0) {
      urchin.needleUrchinShotFlashTicks--;
    }

    const shouldTrigger = shouldTriggerNeedleUrchin(
      player.positionXWorld - urchin.positionXWorld,
      player.positionYWorld - urchin.positionYWorld,
      player.velocityXWorld,
      player.velocityYWorld,
    );

    if (urchin.needleUrchinState === C.NEEDLE_URCHIN_STATE_IDLE) {
      if (shouldTrigger) {
        urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_TELEGRAPH;
        urchin.needleUrchinStateTicks = 0;
      }
      continue;
    }

    if (urchin.needleUrchinState === C.NEEDLE_URCHIN_STATE_TELEGRAPH) {
      if (!shouldTrigger) {
        urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_IDLE;
        urchin.needleUrchinStateTicks = 0;
        continue;
      }
      urchin.needleUrchinStateTicks++;
      if (urchin.needleUrchinStateTicks >= C.NEEDLE_URCHIN_TELEGRAPH_TICKS) {
        fireNeedleBurst(world, urchin);
        urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_COOLDOWN;
        urchin.needleUrchinStateTicks = C.NEEDLE_URCHIN_COOLDOWN_TICKS;
        urchin.needleUrchinShotFlashTicks = C.NEEDLE_URCHIN_SHOT_FLASH_TICKS;
      }
      continue;
    }

    urchin.needleUrchinStateTicks--;
    if (urchin.needleUrchinStateTicks <= 0) {
      urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_IDLE;
      urchin.needleUrchinStateTicks = 0;
    }
  }
}

export function tickNeedleUrchinProjectiles(world: WorldState): void {
  const player = world.clusters[0];
  const dtSeconds = world.dtMs * 0.001;

  for (let needleIndex = 0; needleIndex < world.needleProjectileAliveFlag.length; needleIndex++) {
    if (world.needleProjectileAliveFlag[needleIndex] === 0) {
      continue;
    }

    const x0 = world.needleProjectileXWorld[needleIndex];
    const y0 = world.needleProjectileYWorld[needleIndex];
    const x1 = x0 + world.needleProjectileVelXWorld[needleIndex] * dtSeconds;
    const y1 = y0 + world.needleProjectileVelYWorld[needleIndex] * dtSeconds;
    world.needleProjectilePrevXWorld[needleIndex] = x0;
    world.needleProjectilePrevYWorld[needleIndex] = y0;

    const playerT = findSweptNeedlePlayerHitT(player, x0, y0, x1, y1);
    const wallT = findEarliestNeedleWallHitT(world, x0, y0, x1, y1);
    const wallWins = wallT !== null && (playerT === null || wallT <= playerT + C.NEEDLE_COLLISION_T_EPSILON);
    const impactT = wallWins ? wallT : playerT;

    if (!wallWins && playerT !== null) {
      const playerImpactX = x0 + (x1 - x0) * playerT;
      const playerImpactY = y0 + (y1 - y0) * playerT;
      if (tryBlockHostileProjectile(world.shieldWeave, x0, y0, playerImpactX, playerImpactY)) {
        world.needleProjectileXWorld[needleIndex] = playerImpactX;
        world.needleProjectileYWorld[needleIndex] = playerImpactY;
        world.needleProjectileAliveFlag[needleIndex] = 0;
        continue;
      }
    }

    if (impactT !== null && impactT <= 1) {
      world.needleProjectileXWorld[needleIndex] = x0 + (x1 - x0) * impactT;
      world.needleProjectileYWorld[needleIndex] = y0 + (y1 - y0) * impactT;
      world.needleProjectileAliveFlag[needleIndex] = 0;
      if (!wallWins && player) {
        applyPlayerDamageWithKnockback(
          player,
          C.NEEDLE_PROJECTILE_DAMAGE,
          world.needleProjectileXWorld[needleIndex],
          world.needleProjectileYWorld[needleIndex],
          { bypassMomentumInvulnerability: true },
        );
      }
      continue;
    }

    world.needleProjectileXWorld[needleIndex] = x1;
    world.needleProjectileYWorld[needleIndex] = y1;
    if (world.needleProjectileLifetimeTicks[needleIndex] > 0) {
      world.needleProjectileLifetimeTicks[needleIndex]--;
    }
    const outsideRoom = x1 < 0
      || y1 < 0
      || x1 > world.worldWidthWorld
      || y1 > world.worldHeightWorld;
    if (world.needleProjectileLifetimeTicks[needleIndex] === 0 || outsideRoom) {
      world.needleProjectileAliveFlag[needleIndex] = 0;
    }
  }
}
