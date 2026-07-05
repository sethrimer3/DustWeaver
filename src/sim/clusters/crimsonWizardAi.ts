import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { nextFloat } from '../rng';
import {
  CW_CONTACT_DAMAGE,
  CW_CONTACT_IFRAMES,
  CW_INITIAL_COOLDOWN_TICKS,
  CW_MOVE_ACCEL,
  CW_MOVE_DRAG,
  CW_MOVE_MAX_SPEED,
  CW_PREFERRED_DISTANCE,
  CW_RECOVER_TICKS,
  CW_ROOM_MARGIN,
  CW_STATE_FIRE_BALLS,
  CW_STATE_FIRE_PILLARS,
  CW_STATE_IDLE,
  CW_STATE_METEORS,
  CW_STATE_RECOVER,
  CW_STATE_TIDAL_WAVE,
  CW_TOO_CLOSE_DISTANCE,
} from './crimsonWizardConfig';
import { ClusterState } from './state';
import { spawnCrimsonFireDust, spawnCrimsonFireball, spawnCrimsonMeteor } from './crimsonWizardEffects';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function randSigned(world: WorldState): number {
  return nextFloat(world.rng) * 2 - 1;
}

function setState(cluster: ClusterState, state: number): void {
  cluster.crimsonWizardState = state;
  cluster.crimsonWizardStateTicks = 0;
}

function steerMovement(world: WorldState, boss: ClusterState, player: ClusterState): void {
  const dx = player.positionXWorld - boss.positionXWorld;
  const dy = player.positionYWorld - boss.positionYWorld;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  boss.crimsonWizardFacingX = dx < 0 ? -1 : 1;

  let desiredX = 0;
  let desiredY = 0;
  if (dist < CW_TOO_CLOSE_DISTANCE) {
    desiredX -= dx / dist;
    desiredY -= dy / dist;
  } else if (dist > CW_PREFERRED_DISTANCE) {
    desiredX += (dx / dist) * 0.35;
    desiredY += (dy / dist) * 0.20;
  }

  const phase = boss.crimsonWizardHoverPhaseRad;
  desiredX += Math.cos(phase * 0.73) * 0.35;
  desiredY += Math.sin(phase) * 0.42;

  const minX = CW_ROOM_MARGIN + boss.halfWidthWorld;
  const maxX = world.worldWidthWorld - CW_ROOM_MARGIN - boss.halfWidthWorld;
  const minY = CW_ROOM_MARGIN + boss.halfHeightWorld;
  const maxY = world.worldHeightWorld - CW_ROOM_MARGIN - boss.halfHeightWorld;
  if (boss.positionXWorld < minX + 18) desiredX += 1.2;
  if (boss.positionXWorld > maxX - 18) desiredX -= 1.2;
  if (boss.positionYWorld < minY + 18) desiredY += 1.1;
  if (boss.positionYWorld > maxY - 18) desiredY -= 1.1;

  const desiredLen = Math.max(1, Math.sqrt(desiredX * desiredX + desiredY * desiredY));
  boss.crimsonWizardVelXWorld = (boss.crimsonWizardVelXWorld + (desiredX / desiredLen) * CW_MOVE_ACCEL) * CW_MOVE_DRAG;
  boss.crimsonWizardVelYWorld = (boss.crimsonWizardVelYWorld + (desiredY / desiredLen) * CW_MOVE_ACCEL) * CW_MOVE_DRAG;
  const speed = Math.sqrt(boss.crimsonWizardVelXWorld * boss.crimsonWizardVelXWorld + boss.crimsonWizardVelYWorld * boss.crimsonWizardVelYWorld);
  if (speed > CW_MOVE_MAX_SPEED) {
    const s = CW_MOVE_MAX_SPEED / speed;
    boss.crimsonWizardVelXWorld *= s;
    boss.crimsonWizardVelYWorld *= s;
  }
  boss.positionXWorld = clamp(boss.positionXWorld + boss.crimsonWizardVelXWorld, minX, maxX);
  boss.positionYWorld = clamp(boss.positionYWorld + boss.crimsonWizardVelYWorld, minY, maxY);
  boss.velocityXWorld = boss.crimsonWizardVelXWorld * 60;
  boss.velocityYWorld = boss.crimsonWizardVelYWorld * 60;
  boss.crimsonWizardHoverPhaseRad += 0.045;
}

function emitTidalWave(world: WorldState, boss: ClusterState): void {
  if ((boss.crimsonWizardStateTicks % 5) !== 0) return;
  const dir = boss.crimsonWizardFacingX;
  const waveY = boss.positionYWorld + 2 + Math.sin(boss.crimsonWizardStateTicks * 0.13) * 12;
  for (let i = 0; i < 18; i++) {
    const spread = (i - 8.5) * 3.0;
    spawnCrimsonFireDust(
      world,
      boss.positionXWorld + dir * (9 + i * 1.6),
      waveY + spread * 0.35,
      dir * (0.75 + nextFloat(world.rng) * 0.6),
      -0.25 + randSigned(world) * 0.45,
      42 + Math.floor(nextFloat(world.rng) * 34),
    );
  }
}

function emitPillarRow(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (boss.crimsonWizardStateTicks < 18 || (boss.crimsonWizardStateTicks % 8) !== 0) return;
  const step = Math.floor((boss.crimsonWizardStateTicks - 18) / 8);
  if (step > 6) return;
  const startX = player.positionXWorld - 48;
  const x = clamp(startX + step * 16, 12, world.worldWidthWorld - 12);
  const floorY = world.worldHeightWorld - 10;
  for (let i = 0; i < 34; i++) {
    spawnCrimsonFireDust(
      world,
      x + randSigned(world) * 4,
      floorY - nextFloat(world.rng) * 8,
      randSigned(world) * 0.28,
      -1.0 - nextFloat(world.rng) * 1.6,
      46 + Math.floor(nextFloat(world.rng) * 28),
    );
  }
  if (boss.crimsonWizardStateTicks === 18) boss.crimsonWizardTelegraphTicks = 0;
}

function emitMeteors(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if ((boss.crimsonWizardStateTicks % 24) !== 4) return;
  const offset = randSigned(world) * 56;
  spawnCrimsonMeteor(world, player.positionXWorld + offset, -24, player.positionXWorld + randSigned(world) * 24, player.positionYWorld + 16);
}

function emitFireballs(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if ((boss.crimsonWizardStateTicks % 15) !== 3) return;
  spawnCrimsonFireball(world, boss.positionXWorld, boss.positionYWorld, player.positionXWorld + randSigned(world) * 28, player.positionYWorld + randSigned(world) * 12);
}

function tickAttackState(world: WorldState, boss: ClusterState, player: ClusterState): void {
  boss.crimsonWizardStateTicks += 1;
  if (boss.crimsonWizardAttackCooldownTicks > 0) boss.crimsonWizardAttackCooldownTicks -= 1;

  switch (boss.crimsonWizardState) {
    case CW_STATE_IDLE:
      if (boss.crimsonWizardAttackCooldownTicks <= 0) {
        const next = boss.crimsonWizardNextAttackIndex % 4;
        boss.crimsonWizardNextAttackIndex += 1;
        setState(boss, next === 0 ? CW_STATE_TIDAL_WAVE : next === 1 ? CW_STATE_FIRE_PILLARS : next === 2 ? CW_STATE_METEORS : CW_STATE_FIRE_BALLS);
      }
      break;
    case CW_STATE_TIDAL_WAVE:
      emitTidalWave(world, boss);
      if (boss.crimsonWizardStateTicks > 96) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_PILLARS:
      boss.crimsonWizardTelegraphTicks = Math.max(0, 18 - boss.crimsonWizardStateTicks);
      emitPillarRow(world, boss, player);
      if (boss.crimsonWizardStateTicks > 86) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_METEORS:
      emitMeteors(world, boss, player);
      if (boss.crimsonWizardStateTicks > 100) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_BALLS:
      emitFireballs(world, boss, player);
      if (boss.crimsonWizardStateTicks > 92) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_RECOVER:
      if (boss.crimsonWizardStateTicks > CW_RECOVER_TICKS) {
        boss.crimsonWizardAttackCooldownTicks = 36;
        setState(boss, CW_STATE_IDLE);
      }
      break;
  }
}

export function applyCrimsonWizardAI(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;
  for (let ci = 1; ci < world.clusters.length; ci++) {
    const boss = world.clusters[ci];
    if (boss.isCrimsonWizardFlag !== 1 || boss.isAliveFlag === 0) continue;
    if (boss.crimsonWizardAttackCooldownTicks <= 0 && boss.crimsonWizardState === CW_STATE_IDLE && boss.crimsonWizardStateTicks === 0) {
      boss.crimsonWizardAttackCooldownTicks = CW_INITIAL_COOLDOWN_TICKS;
    }
    steerMovement(world, boss, player);
    tickAttackState(world, boss, player);

    if (player.invulnerabilityTicks <= 0) {
      const overlapX = Math.abs(player.positionXWorld - boss.positionXWorld) <= player.halfWidthWorld + boss.halfWidthWorld;
      const overlapY = Math.abs(player.positionYWorld - boss.positionYWorld) <= player.halfHeightWorld + boss.halfHeightWorld;
      if (overlapX && overlapY) {
        applyPlayerDamageWithKnockback(player, CW_CONTACT_DAMAGE, boss.positionXWorld, boss.positionYWorld);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, CW_CONTACT_IFRAMES);
      }
    }
  }
}
