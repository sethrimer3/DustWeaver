import { PlayerSfxManager, type PlayerSfxName } from '../audio/playerSfx';
import type { WorldState } from '../sim/world';
import type { ClusterState } from '../sim/clusters/state';
import {
  blockSoundHardnessIndexToName,
  type BlockSoundHardness,
} from '../levels/roomDef';
import { FAST_MAX_FALL_WORLD_PER_SEC, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC } from '../sim/clusters/movementConstants';
import { GRAPPLE_ZIP_SPEED_WORLD_PER_SEC } from '../sim/clusters/grappleZip';
import { SWORD_STATE_GUARD_SLASHING, SWORD_STATE_SLASHING } from '../sim/weaves/swordWeave';

const GROUND_PROBE_WORLD = 1.25;
const LANDING_IMPACT_MIN_SPEED_WORLD_PER_SEC = 90;
const LANDING_IMPACT_FULL_SPEED_WORLD_PER_SEC = 360;
const STEP_BASE_INTERVAL_TICKS = 22;
const STEP_SPRINT_INTERVAL_TICKS = 14;

export interface PlayerSfxState {
  wasGroundedFlag: 0 | 1;
  wasGrappleActiveFlag: 0 | 1;
  wasGrappleZipActiveFlag: 0 | 1;
  previousSwordStateEnum: number;
  previousVelocityYWorld: number;
  previousWallJumpCountSinceReset: number;
  stepTicksUntilNext: number;
}

export function createPlayerSfxState(): PlayerSfxState {
  return {
    wasGroundedFlag: 0,
    wasGrappleActiveFlag: 0,
    wasGrappleZipActiveFlag: 0,
    previousSwordStateEnum: 0,
    previousVelocityYWorld: 0,
    previousWallJumpCountSinceReset: 0,
    stepTicksUntilNext: 0,
  };
}

function stepNameForHardness(hardness: BlockSoundHardness): PlayerSfxName {
  switch (hardness) {
    case 'soft': return 'step_soft_ground';
    case 'normal': return 'step_normal_ground';
    case 'hard': return 'step_hard_ground';
  }
}

function landingNameForHardness(hardness: BlockSoundHardness): PlayerSfxName {
  switch (hardness) {
    case 'soft': return 'jump_impact_soft';
    case 'normal': return 'jump_impact_medium';
    case 'hard': return 'jump_impact_hard';
  }
}

function findGroundHardness(world: WorldState, player: ClusterState): BlockSoundHardness {
  const playerBottom = player.positionYWorld + player.halfHeightWorld;
  const playerLeft = player.positionXWorld - player.halfWidthWorld;
  const playerRight = player.positionXWorld + player.halfWidthWorld;
  let bestWallIndex = -1;
  let bestDistanceWorld = GROUND_PROBE_WORLD;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsInvisibleFlag[wi] === 1) continue;
    const wallTop = world.wallYWorld[wi];
    if (wallTop < playerBottom - GROUND_PROBE_WORLD || wallTop > playerBottom + GROUND_PROBE_WORLD) continue;
    const wallLeft = world.wallXWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    if (playerRight <= wallLeft || playerLeft >= wallRight) continue;
    const distanceWorld = Math.abs(wallTop - playerBottom);
    if (distanceWorld <= bestDistanceWorld) {
      bestDistanceWorld = distanceWorld;
      bestWallIndex = wi;
    }
  }

  if (bestWallIndex < 0) return 'hard';
  return blockSoundHardnessIndexToName(world.wallSoundHardnessIndex[bestWallIndex]);
}

function impactVolume(previousVelocityYWorld: number): number {
  const fallSpeedWorld = Math.max(0, previousVelocityYWorld);
  const t = Math.max(0, Math.min(1, (fallSpeedWorld - LANDING_IMPACT_MIN_SPEED_WORLD_PER_SEC) /
    (LANDING_IMPACT_FULL_SPEED_WORLD_PER_SEC - LANDING_IMPACT_MIN_SPEED_WORLD_PER_SEC)));
  return 0.45 + t * 0.75;
}

function isSwordSlashState(stateEnum: number): boolean {
  return stateEnum === SWORD_STATE_SLASHING || stateEnum === SWORD_STATE_GUARD_SLASHING;
}

export function updatePlayerSfx(
  sfx: PlayerSfxManager,
  state: PlayerSfxState,
  world: WorldState,
  didGrappleFire: boolean,
  dtSec: number,
): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    sfx.updateWind(0, FAST_MAX_FALL_WORLD_PER_SEC, GRAPPLE_ZIP_SPEED_WORLD_PER_SEC, dtSec);
    return;
  }

  const isGrounded = player.isGroundedFlag;
  const hardness = findGroundHardness(world, player);
  if (didGrappleFire) {
    sfx.play('grapple_throw', 1);
    sfx.play('quickWhoosh', 0.7);
  }
  if (state.wasGrappleActiveFlag === 0 && world.isGrappleActiveFlag === 1) {
    sfx.play('grapple_impact', 1);
  }
  if (state.wasGrappleZipActiveFlag === 0 && world.isGrappleZipActiveFlag === 1) {
    sfx.play('grapple_zip', 0.9);
  }
  if (!isSwordSlashState(state.previousSwordStateEnum) && isSwordSlashState(world.swordWeaveStateEnum)) {
    sfx.play('quickWhoosh', 0.85);
  }

  if (state.wasGroundedFlag === 0 && isGrounded === 1) {
    const volume = impactVolume(state.previousVelocityYWorld);
    if (volume > 0.45) sfx.play(landingNameForHardness(hardness), volume);
  }

  if (state.wasGroundedFlag === 1 && isGrounded === 0 && player.velocityYWorld < -100) {
    sfx.play('jump', 1);
  } else if (player.wallJumpCountSinceReset > state.previousWallJumpCountSinceReset && player.velocityYWorld < -80) {
    sfx.play(player.wallJumpCountSinceReset <= 2 ? 'walljump_high' : 'walljump_low', 1);
  }

  if (isGrounded === 1 && Math.abs(player.velocityXWorld) > 18 && world.playerMoveInputDxWorld !== 0) {
    if (state.stepTicksUntilNext <= 0) {
      const sprintT = Math.min(1, Math.abs(player.velocityXWorld) / GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
      const volume = 0.55 + sprintT * 0.2;
      sfx.play(stepNameForHardness(hardness), volume);
      state.stepTicksUntilNext = STEP_BASE_INTERVAL_TICKS;
    } else {
      state.stepTicksUntilNext -= 1;
    }
  } else {
    state.stepTicksUntilNext = 0;
  }

  const speedWorldPerSec = Math.sqrt(
    player.velocityXWorld * player.velocityXWorld + player.velocityYWorld * player.velocityYWorld,
  );
  sfx.updateWind(speedWorldPerSec, FAST_MAX_FALL_WORLD_PER_SEC, GRAPPLE_ZIP_SPEED_WORLD_PER_SEC, dtSec);

  state.wasGroundedFlag = isGrounded;
  state.wasGrappleActiveFlag = world.isGrappleActiveFlag;
  state.wasGrappleZipActiveFlag = world.isGrappleZipActiveFlag;
  state.previousSwordStateEnum = world.swordWeaveStateEnum;
  state.previousVelocityYWorld = player.velocityYWorld;
  state.previousWallJumpCountSinceReset = player.wallJumpCountSinceReset;
}
