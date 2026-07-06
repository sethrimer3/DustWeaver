import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { WorldState } from '../world';
import { ClusterState } from './state';
import {
  ICE_WIZARD_CONTACT_DAMAGE,
  ICE_WIZARD_FOOTPRINT_TILES,
  ICE_WIZARD_HALF_H,
  ICE_WIZARD_HALF_W,
  ICE_WIZARD_IDLE_TICKS,
  ICE_WIZARD_PLAYER_TRIGGER_RANGE_WORLD,
  ICE_WIZARD_RECOVERY_TICKS,
  ICE_WIZARD_SLAM_SPEED_WORLD_PER_TICK,
  ICE_WIZARD_STATE_IDLE,
  ICE_WIZARD_STATE_RECOVERY,
  ICE_WIZARD_STATE_SLAM_DOWN,
  ICE_WIZARD_STATE_TELEGRAPH_SLAM,
  ICE_WIZARD_TELEGRAPH_TICKS,
} from './iceWizardConfig';
import { clearIceSpikes, findIceWizardSlamFloorY, spawnIceSpikeWave } from './iceWizardEffects';

export function snapIceWizardToGrid(boss: ClusterState): void {
  const tile = BLOCK_SIZE_MEDIUM;
  const gridX = Math.round((boss.positionXWorld - ICE_WIZARD_HALF_W) / tile);
  const gridY = Math.round((boss.positionYWorld - ICE_WIZARD_HALF_H) / tile);
  boss.positionXWorld = gridX * tile + ICE_WIZARD_HALF_W;
  boss.positionYWorld = gridY * tile + ICE_WIZARD_HALF_H;
  boss.velocityXWorld = 0;
}

function setState(boss: ClusterState, state: number): void {
  boss.iceWizardState = state;
  boss.iceWizardStateTicks = 0;
}

function shouldStartSlam(boss: ClusterState, player: ClusterState): boolean {
  if (boss.iceWizardStateTicks < ICE_WIZARD_IDLE_TICKS) return false;
  const dx = player.positionXWorld - boss.positionXWorld;
  const dy = player.positionYWorld - boss.positionYWorld;
  return dx * dx + dy * dy <= ICE_WIZARD_PLAYER_TRIGGER_RANGE_WORLD * ICE_WIZARD_PLAYER_TRIGGER_RANGE_WORLD;
}

function finishSlam(world: WorldState, boss: ClusterState, floorYWorld: number): void {
  boss.positionYWorld = floorYWorld - ICE_WIZARD_HALF_H;
  boss.velocityYWorld = 0;
  boss.iceWizardImpactFloorYWorld = floorYWorld;
  spawnIceSpikeWave(world, boss.positionXWorld, floorYWorld);
  setState(boss, ICE_WIZARD_STATE_RECOVERY);
}

function tickBoss(world: WorldState, boss: ClusterState, player: ClusterState): void {
  snapIceWizardToGrid(boss);
  boss.iceWizardStateTicks += 1;

  switch (boss.iceWizardState) {
    case ICE_WIZARD_STATE_IDLE:
      boss.velocityYWorld = 0;
      if (shouldStartSlam(boss, player)) {
        setState(boss, ICE_WIZARD_STATE_TELEGRAPH_SLAM);
      }
      break;
    case ICE_WIZARD_STATE_TELEGRAPH_SLAM:
      boss.velocityYWorld = 0;
      if (boss.iceWizardStateTicks >= ICE_WIZARD_TELEGRAPH_TICKS) {
        setState(boss, ICE_WIZARD_STATE_SLAM_DOWN);
      }
      break;
    case ICE_WIZARD_STATE_SLAM_DOWN: {
      const previousBottom = boss.positionYWorld + ICE_WIZARD_HALF_H;
      const nextBottom = previousBottom + ICE_WIZARD_SLAM_SPEED_WORLD_PER_TICK;
      const floorY = findIceWizardSlamFloorY(
        world,
        boss.positionXWorld - ICE_WIZARD_HALF_W,
        boss.positionXWorld + ICE_WIZARD_HALF_W,
        previousBottom,
      );
      if (floorY !== null && floorY <= nextBottom + 0.01) {
        finishSlam(world, boss, floorY);
      } else {
        boss.positionYWorld += ICE_WIZARD_SLAM_SPEED_WORLD_PER_TICK;
        boss.velocityYWorld = ICE_WIZARD_SLAM_SPEED_WORLD_PER_TICK * 60;
        if (boss.positionYWorld + ICE_WIZARD_HALF_H >= world.worldHeightWorld) {
          finishSlam(world, boss, world.worldHeightWorld);
        }
      }
      break;
    }
    case ICE_WIZARD_STATE_RECOVERY:
      boss.velocityYWorld = 0;
      if (boss.iceWizardStateTicks >= ICE_WIZARD_RECOVERY_TICKS) {
        setState(boss, ICE_WIZARD_STATE_IDLE);
      }
      break;
  }

  boss.iceWizardGridX = Math.round((boss.positionXWorld - ICE_WIZARD_HALF_W) / BLOCK_SIZE_MEDIUM);
  boss.iceWizardGridY = Math.round((boss.positionYWorld - ICE_WIZARD_HALF_H) / BLOCK_SIZE_MEDIUM);
}

function damagePlayerOnContact(player: ClusterState, boss: ClusterState): void {
  if (player.invulnerabilityTicks > 0) return;
  const overlapX = Math.abs(player.positionXWorld - boss.positionXWorld) <= player.halfWidthWorld + boss.halfWidthWorld;
  const overlapY = Math.abs(player.positionYWorld - boss.positionYWorld) <= player.halfHeightWorld + boss.halfHeightWorld;
  if (!overlapX || !overlapY) return;
  applyPlayerDamageWithKnockback(player, ICE_WIZARD_CONTACT_DAMAGE, boss.positionXWorld, boss.positionYWorld);
  player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, 36);
}

export function applyIceWizardAI(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;
  let liveCount = 0;
  for (let ci = 1; ci < world.clusters.length; ci++) {
    const boss = world.clusters[ci];
    if (boss.isIceWizardFlag !== 1 || boss.isAliveFlag === 0) continue;
    liveCount += 1;
    tickBoss(world, boss, player);
    damagePlayerOnContact(player, boss);
  }
  if (liveCount === 0) clearIceSpikes(world);
}

export { ICE_WIZARD_FOOTPRINT_TILES };
