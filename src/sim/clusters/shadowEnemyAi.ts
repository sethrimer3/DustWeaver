import type { WorldState } from '../world';
import { killPlayerImmediately } from '../playerDamage';
import {
  SHADOW_FATAL_OVERLAP_EPSILON_WORLD,
  SHADOW_FOLLOW_SPEED_WORLD_PER_SEC,
  SHADOW_REPHASE_DELAY_TICKS,
  SHADOW_TELEPORT_RESET_DISTANCE_WORLD,
} from './shadowEnemyConfig';

export interface ShadowWaypoint {
  xWorld: number;
  yWorld: number;
}

export function appendShadowWaypoint(
  world: WorldState,
  slot: number,
  xWorld: number,
  yWorld: number,
): void {
  const stride = world.shadowPathStride;
  let head = world.shadowPathHead[slot];
  let count = world.shadowPathCount[slot];

  // A full ring drops exactly the oldest unread point before appending.
  if (count >= stride) {
    head = (head + 1) % stride;
    world.shadowPathHead[slot] = head;
    count = stride - 1;
  }

  const flatIndex = slot * stride + (head + count) % stride;
  world.shadowPathXWorld[flatIndex] = xWorld;
  world.shadowPathYWorld[flatIndex] = yWorld;
  world.shadowPathCount[slot] = count + 1;
}

export function consumeOldestShadowWaypoint(
  world: WorldState,
  slot: number,
): ShadowWaypoint | null {
  if (world.shadowPathCount[slot] === 0) {
    return null;
  }

  const head = world.shadowPathHead[slot];
  const flatIndex = slot * world.shadowPathStride + head;
  const waypoint = {
    xWorld: world.shadowPathXWorld[flatIndex],
    yWorld: world.shadowPathYWorld[flatIndex],
  };
  world.shadowPathHead[slot] = (head + 1) % world.shadowPathStride;
  world.shadowPathCount[slot]--;
  return waypoint;
}

export function clearShadowPath(world: WorldState, slot: number): void {
  world.shadowPathHead[slot] = 0;
  world.shadowPathCount[slot] = 0;
}

function moveShadowAlongPath(world: WorldState, slot: number, shadowIndex: number): void {
  const shadow = world.clusters[shadowIndex];
  let movementBudget = SHADOW_FOLLOW_SPEED_WORLD_PER_SEC * world.dtMs * 0.001;
  const originalXWorld = shadow.positionXWorld;
  const originalYWorld = shadow.positionYWorld;
  let iterations = 0;

  while (movementBudget > 1e-6 && world.shadowPathCount[slot] > 0 && iterations < 128) {
    iterations++;
    const head = world.shadowPathHead[slot];
    const flatIndex = slot * world.shadowPathStride + head;
    const deltaXWorld = world.shadowPathXWorld[flatIndex] - shadow.positionXWorld;
    const deltaYWorld = world.shadowPathYWorld[flatIndex] - shadow.positionYWorld;
    const distanceWorld = Math.hypot(deltaXWorld, deltaYWorld);

    if (distanceWorld <= movementBudget) {
      shadow.positionXWorld += deltaXWorld;
      shadow.positionYWorld += deltaYWorld;
      movementBudget -= distanceWorld;
      consumeOldestShadowWaypoint(world, slot);
      continue;
    }

    shadow.positionXWorld += deltaXWorld / distanceWorld * movementBudget;
    shadow.positionYWorld += deltaYWorld / distanceWorld * movementBudget;
    movementBudget = 0;
  }

  const dtSeconds = world.dtMs * 0.001;
  if (dtSeconds > 0) {
    shadow.velocityXWorld = (shadow.positionXWorld - originalXWorld) / dtSeconds;
    shadow.velocityYWorld = (shadow.positionYWorld - originalYWorld) / dtSeconds;
  }
}

export function recordAndMoveShadowEnemies(world: WorldState): void {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1) {
    return;
  }

  for (let shadowIndex = 0; shadowIndex < world.clusters.length; shadowIndex++) {
    const shadow = world.clusters[shadowIndex];
    shadow.shadowRephaseRelocatedThisTickFlag = 0;
    if (shadow.isShadowEnemyFlag !== 1 || shadow.isAliveFlag === 0 || shadow.shadowPathSlotIndex < 0) {
      continue;
    }

    const slot = shadow.shadowPathSlotIndex;
    const lastXWorld = world.shadowPathLastRecordedXWorld[slot];
    const lastYWorld = world.shadowPathLastRecordedYWorld[slot];
    const teleported = Math.hypot(
      player.positionXWorld - lastXWorld,
      player.positionYWorld - lastYWorld,
    ) > SHADOW_TELEPORT_RESET_DISTANCE_WORLD;

    if (teleported) {
      clearShadowPath(world, slot);
      shadow.shadowRephaseTicks = SHADOW_REPHASE_DELAY_TICKS;
    }

    appendShadowWaypoint(world, slot, player.positionXWorld, player.positionYWorld);
    world.shadowPathLastRecordedXWorld[slot] = player.positionXWorld;
    world.shadowPathLastRecordedYWorld[slot] = player.positionYWorld;
    shadow.velocityXWorld = 0;
    shadow.velocityYWorld = 0;
    shadow.shadowVisualPhaseRad += world.dtMs * 0.004;

    if (shadow.shadowStartupTicks > 0) {
      shadow.shadowStartupTicks--;
      continue;
    }

    // The discontinuity tick starts the full delay; it does not consume one tick.
    if (teleported) {
      continue;
    }

    if (shadow.shadowRephaseTicks > 0) {
      shadow.shadowRephaseTicks--;
      if (shadow.shadowRephaseTicks > 0) {
        continue;
      }

      const oldestPostTeleportWaypoint = consumeOldestShadowWaypoint(world, slot);
      if (oldestPostTeleportWaypoint === null) {
        shadow.shadowRephaseTicks = 1;
        continue;
      }

      shadow.positionXWorld = oldestPostTeleportWaypoint.xWorld;
      shadow.positionYWorld = oldestPostTeleportWaypoint.yWorld;
      shadow.shadowRephaseRelocatedThisTickFlag = 1;
      continue;
    }

    moveShadowAlongPath(world, slot, shadowIndex);
  }
}

export function resolveShadowFatalContacts(world: WorldState): void {
  const player = world.clusters[0];
  if (!player || player.isAliveFlag === 0) {
    return;
  }

  for (const shadow of world.clusters) {
    if (
      shadow.isShadowEnemyFlag !== 1
      || shadow.isAliveFlag === 0
      || shadow.shadowStartupTicks > 0
      || shadow.shadowRephaseTicks > 0
      || shadow.shadowRephaseRelocatedThisTickFlag === 1
    ) {
      continue;
    }

    const overlapXWorld = player.halfWidthWorld + shadow.halfWidthWorld - SHADOW_FATAL_OVERLAP_EPSILON_WORLD;
    const overlapYWorld = player.halfHeightWorld + shadow.halfHeightWorld - SHADOW_FATAL_OVERLAP_EPSILON_WORLD;
    if (
      Math.abs(player.positionXWorld - shadow.positionXWorld) < overlapXWorld
      && Math.abs(player.positionYWorld - shadow.positionYWorld) < overlapYWorld
    ) {
      killPlayerImmediately(player);
      return;
    }
  }
}
