import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { nextFloat } from '../rng';
import {
  CW_ATTACK_MOVE_SCALE,
  CW_BETWEEN_ATTACK_COOLDOWN_TICKS,
  CW_CONTACT_DAMAGE,
  CW_CONTACT_IFRAMES,
  CW_FIREBALL_DURATION_TICKS,
  CW_FIREBALL_INTERVAL_TICKS,
  CW_FIREBALL_TELEGRAPH_TICKS,
  CW_INITIAL_COOLDOWN_TICKS,
  CW_IDLE_DRIFT_STRENGTH_X,
  CW_IDLE_DRIFT_STRENGTH_Y,
  CW_METEOR_DURATION_TICKS,
  CW_METEOR_INTERVAL_TICKS,
  CW_METEOR_SIZE_WORLD,
  CW_METEOR_TELEGRAPH_TICKS,
  CW_MOVE_ACCEL,
  CW_MOVE_DAMPING,
  CW_MOVE_MAX_SPEED,
  CW_PILLAR_COUNT,
  CW_PILLAR_DURATION_TICKS,
  CW_PILLAR_EMIT_INTERVAL_TICKS,
  CW_PILLAR_HALF_WIDTH_WORLD,
  CW_PILLAR_PARTICLES_PER_BURST,
  CW_PILLAR_SPACING_WORLD,
  CW_PILLAR_TELEGRAPH_TICKS,
  CW_PREFERRED_DISTANCE,
  CW_RECOVER_TICKS,
  CW_ROOM_MARGIN,
  CW_STATE_FIRE_BALLS,
  CW_STATE_FIRE_PILLARS,
  CW_STATE_IDLE,
  CW_STATE_METEORS,
  CW_STATE_RECOVER,
  CW_STATE_TIDAL_WAVE,
  CW_TELEGRAPH_KIND_CHARGE,
  CW_TELEGRAPH_KIND_METEOR,
  CW_TELEGRAPH_KIND_PILLAR,
  CW_TIDAL_WAVE_DURATION_TICKS,
  CW_TIDAL_WAVE_EMIT_INTERVAL_TICKS,
  CW_TIDAL_WAVE_LIFETIME_MIN_TICKS,
  CW_TIDAL_WAVE_LIFETIME_VARIANCE_TICKS,
  CW_TIDAL_WAVE_PARTICLES_PER_EMIT,
  CW_TIDAL_WAVE_SPACING_WORLD,
  CW_TIDAL_WAVE_SPEED_MIN,
  CW_TIDAL_WAVE_SPEED_VARIANCE,
  CW_TIDAL_WAVE_TELEGRAPH_TICKS,
  CW_TOO_CLOSE_DISTANCE,
  CW_WALL_AVOID_DISTANCE,
} from './crimsonWizardConfig';
import { ClusterState } from './state';
import { spawnCrimsonFireDust, spawnCrimsonFireball, spawnCrimsonMeteor, spawnCrimsonTelegraph } from './crimsonWizardEffects';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function randSigned(world: WorldState): number {
  return nextFloat(world.rng) * 2 - 1;
}

function setState(cluster: ClusterState, state: number): void {
  cluster.crimsonWizardState = state;
  cluster.crimsonWizardStateTicks = 0;
  cluster.crimsonWizardTelegraphTicks = 0;
}

function playableBounds(world: WorldState, boss: ClusterState): { minX: number; maxX: number; minY: number; maxY: number } {
  const minX = CW_ROOM_MARGIN + boss.halfWidthWorld;
  const maxX = Math.max(minX, world.worldWidthWorld - CW_ROOM_MARGIN - boss.halfWidthWorld);
  const minY = CW_ROOM_MARGIN + boss.halfHeightWorld;
  const maxY = Math.max(minY, world.worldHeightWorld - CW_ROOM_MARGIN - boss.halfHeightWorld);
  return { minX, maxX, minY, maxY };
}

export function findCrimsonWizardFloorY(world: WorldState, xWorld: number): number {
  let floorY = world.worldHeightWorld - CW_ROOM_MARGIN;
  for (let i = 0; i < world.wallCount; i++) {
    const x0 = world.wallXWorld[i];
    const x1 = x0 + world.wallWWorld[i];
    const y = world.wallYWorld[i];
    if (xWorld < x0 || xWorld > x1 || y <= 0) continue;
    if (y < floorY) floorY = y;
  }
  return clamp(floorY, CW_ROOM_MARGIN, world.worldHeightWorld - 4);
}

export function steerCrimsonWizardMovement(world: WorldState, boss: ClusterState, player: ClusterState): void {
  const dx = player.positionXWorld - boss.positionXWorld;
  const dy = player.positionYWorld - boss.positionYWorld;
  const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  if (Math.abs(dx) > 0.5) boss.crimsonWizardFacingX = dx < 0 ? -1 : 1;

  let desiredX = 0;
  let desiredY = 0;
  if (dist < CW_TOO_CLOSE_DISTANCE) {
    const panic = (CW_TOO_CLOSE_DISTANCE - dist) / CW_TOO_CLOSE_DISTANCE;
    desiredX -= (dx / dist) * (1.1 + panic);
    desiredY -= (dy / dist) * (0.8 + panic * 0.6);
  } else if (dist > CW_PREFERRED_DISTANCE) {
    desiredX += (dx / dist) * 0.35;
    desiredY += (dy / dist) * 0.18;
  } else {
    desiredX -= (dx / dist) * 0.12;
  }

  const phase = boss.crimsonWizardHoverPhaseRad;
  desiredX += Math.cos(phase * 0.73) * CW_IDLE_DRIFT_STRENGTH_X;
  desiredY += Math.sin(phase) * CW_IDLE_DRIFT_STRENGTH_Y;

  const { minX, maxX, minY, maxY } = playableBounds(world, boss);
  const leftT = clamp((boss.positionXWorld - minX) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const rightT = clamp((maxX - boss.positionXWorld) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const topT = clamp((boss.positionYWorld - minY) / CW_WALL_AVOID_DISTANCE, 0, 1);
  const bottomT = clamp((maxY - boss.positionYWorld) / CW_WALL_AVOID_DISTANCE, 0, 1);
  desiredX += (1 - leftT) * 1.5;
  desiredX -= (1 - rightT) * 1.5;
  desiredY += (1 - topT) * 1.3;
  desiredY -= (1 - bottomT) * 1.3;

  const desiredLen = Math.sqrt(desiredX * desiredX + desiredY * desiredY);
  const attackScale = boss.crimsonWizardState === CW_STATE_IDLE || boss.crimsonWizardState === CW_STATE_RECOVER ? 1 : CW_ATTACK_MOVE_SCALE;
  if (desiredLen > 0.001) {
    boss.crimsonWizardVelXWorld += (desiredX / desiredLen) * CW_MOVE_ACCEL * attackScale;
    boss.crimsonWizardVelYWorld += (desiredY / desiredLen) * CW_MOVE_ACCEL * attackScale;
  }
  boss.crimsonWizardVelXWorld *= CW_MOVE_DAMPING;
  boss.crimsonWizardVelYWorld *= CW_MOVE_DAMPING;

  const speed = Math.sqrt(boss.crimsonWizardVelXWorld * boss.crimsonWizardVelXWorld + boss.crimsonWizardVelYWorld * boss.crimsonWizardVelYWorld);
  const maxSpeed = CW_MOVE_MAX_SPEED * attackScale;
  if (speed > maxSpeed) {
    const s = maxSpeed / speed;
    boss.crimsonWizardVelXWorld *= s;
    boss.crimsonWizardVelYWorld *= s;
  }

  const nextX = boss.positionXWorld + boss.crimsonWizardVelXWorld;
  const nextY = boss.positionYWorld + boss.crimsonWizardVelYWorld;
  boss.positionXWorld = clamp(nextX, minX, maxX);
  boss.positionYWorld = clamp(nextY, minY, maxY);
  if ((boss.positionXWorld === minX && boss.crimsonWizardVelXWorld < 0) || (boss.positionXWorld === maxX && boss.crimsonWizardVelXWorld > 0)) {
    boss.crimsonWizardVelXWorld = 0;
  }
  if ((boss.positionYWorld === minY && boss.crimsonWizardVelYWorld < 0) || (boss.positionYWorld === maxY && boss.crimsonWizardVelYWorld > 0)) {
    boss.crimsonWizardVelYWorld = 0;
  }
  boss.velocityXWorld = boss.crimsonWizardVelXWorld * 60;
  boss.velocityYWorld = boss.crimsonWizardVelYWorld * 60;
  boss.crimsonWizardHoverPhaseRad += 0.045;
}

function maybeSpawnChargeTelegraph(world: WorldState, boss: ClusterState, ticks: number): void {
  if (boss.crimsonWizardStateTicks !== 1) return;
  boss.crimsonWizardTelegraphTicks = ticks;
  spawnCrimsonTelegraph(world, boss.positionXWorld, boss.positionYWorld + boss.halfHeightWorld + 4, boss.halfWidthWorld, CW_TELEGRAPH_KIND_CHARGE, ticks);
}

function emitTidalWave(world: WorldState, boss: ClusterState): void {
  if (boss.crimsonWizardStateTicks <= CW_TIDAL_WAVE_TELEGRAPH_TICKS) return;
  if (((boss.crimsonWizardStateTicks - CW_TIDAL_WAVE_TELEGRAPH_TICKS) % CW_TIDAL_WAVE_EMIT_INTERVAL_TICKS) !== 0) return;
  const dir = boss.crimsonWizardFacingX;
  const waveY = boss.positionYWorld + 2 + Math.sin(boss.crimsonWizardStateTicks * 0.13) * 10;
  for (let i = 0; i < CW_TIDAL_WAVE_PARTICLES_PER_EMIT; i++) {
    const spread = (i - (CW_TIDAL_WAVE_PARTICLES_PER_EMIT - 1) * 0.5) * CW_TIDAL_WAVE_SPACING_WORLD;
    spawnCrimsonFireDust(
      world,
      boss.positionXWorld + dir * (10 + i * 1.7),
      waveY + spread * 0.34,
      dir * (CW_TIDAL_WAVE_SPEED_MIN + nextFloat(world.rng) * CW_TIDAL_WAVE_SPEED_VARIANCE),
      -0.22 + randSigned(world) * 0.38,
      CW_TIDAL_WAVE_LIFETIME_MIN_TICKS + Math.floor(nextFloat(world.rng) * CW_TIDAL_WAVE_LIFETIME_VARIANCE_TICKS),
    );
  }
}

function pillarXForStep(world: WorldState, player: ClusterState, step: number): number {
  const rowWidth = (CW_PILLAR_COUNT - 1) * CW_PILLAR_SPACING_WORLD;
  const minX = CW_ROOM_MARGIN + CW_PILLAR_HALF_WIDTH_WORLD;
  const maxX = Math.max(minX, world.worldWidthWorld - CW_ROOM_MARGIN - CW_PILLAR_HALF_WIDTH_WORLD);
  const maxStartX = Math.max(minX, maxX - rowWidth);
  const startX = clamp(player.positionXWorld - rowWidth * 0.5, minX, maxStartX);
  return clamp(startX + step * CW_PILLAR_SPACING_WORLD, minX, maxX);
}

function emitPillarTelegraphs(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (boss.crimsonWizardStateTicks !== 1) return;
  boss.crimsonWizardTelegraphTicks = CW_PILLAR_TELEGRAPH_TICKS;
  for (let step = 0; step < CW_PILLAR_COUNT; step++) {
    const x = pillarXForStep(world, player, step);
    spawnCrimsonTelegraph(world, x, findCrimsonWizardFloorY(world, x) - 2, CW_PILLAR_HALF_WIDTH_WORLD + 2, CW_TELEGRAPH_KIND_PILLAR, CW_PILLAR_TELEGRAPH_TICKS);
  }
}

function emitPillarRow(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (boss.crimsonWizardStateTicks <= CW_PILLAR_TELEGRAPH_TICKS) return;
  const attackTick = boss.crimsonWizardStateTicks - CW_PILLAR_TELEGRAPH_TICKS;
  if ((attackTick % CW_PILLAR_EMIT_INTERVAL_TICKS) !== 0) return;
  const step = Math.floor(attackTick / CW_PILLAR_EMIT_INTERVAL_TICKS);
  if (step >= CW_PILLAR_COUNT) return;
  const x = pillarXForStep(world, player, step);
  const floorY = findCrimsonWizardFloorY(world, x);
  for (let i = 0; i < CW_PILLAR_PARTICLES_PER_BURST; i++) {
    spawnCrimsonFireDust(
      world,
      x + randSigned(world) * CW_PILLAR_HALF_WIDTH_WORLD,
      floorY - 2 - nextFloat(world.rng) * 8,
      randSigned(world) * 0.24,
      -1.0 - nextFloat(world.rng) * 1.35,
      44 + Math.floor(nextFloat(world.rng) * 24),
    );
  }
}

function emitMeteors(world: WorldState, boss: ClusterState, player: ClusterState): void {
  if (boss.crimsonWizardStateTicks === 1) boss.crimsonWizardTelegraphTicks = CW_METEOR_TELEGRAPH_TICKS;
  if (boss.crimsonWizardStateTicks <= CW_METEOR_TELEGRAPH_TICKS) {
    if ((boss.crimsonWizardStateTicks % CW_METEOR_INTERVAL_TICKS) === 1) {
      const targetX = clamp(player.positionXWorld + randSigned(world) * 42, CW_ROOM_MARGIN + CW_METEOR_SIZE_WORLD, world.worldWidthWorld - CW_ROOM_MARGIN - CW_METEOR_SIZE_WORLD);
      const targetY = findCrimsonWizardFloorY(world, targetX) - CW_METEOR_SIZE_WORLD * 0.5;
      spawnCrimsonTelegraph(world, targetX, targetY, CW_METEOR_SIZE_WORLD * 0.65, CW_TELEGRAPH_KIND_METEOR, CW_METEOR_TELEGRAPH_TICKS);
    }
    return;
  }
  const attackTick = boss.crimsonWizardStateTicks - CW_METEOR_TELEGRAPH_TICKS;
  if ((attackTick % CW_METEOR_INTERVAL_TICKS) !== 3) return;
  const targetX = clamp(player.positionXWorld + randSigned(world) * 42, CW_ROOM_MARGIN + CW_METEOR_SIZE_WORLD, world.worldWidthWorld - CW_ROOM_MARGIN - CW_METEOR_SIZE_WORLD);
  const targetY = findCrimsonWizardFloorY(world, targetX) - CW_METEOR_SIZE_WORLD * 0.5;
  spawnCrimsonTelegraph(world, targetX, targetY, CW_METEOR_SIZE_WORLD * 0.65, CW_TELEGRAPH_KIND_METEOR, 18);
  spawnCrimsonMeteor(world, targetX + randSigned(world) * 36, -CW_METEOR_SIZE_WORLD * 1.5, targetX, targetY);
}

function emitFireballs(world: WorldState, boss: ClusterState, player: ClusterState): void {
  maybeSpawnChargeTelegraph(world, boss, CW_FIREBALL_TELEGRAPH_TICKS);
  if (boss.crimsonWizardStateTicks <= CW_FIREBALL_TELEGRAPH_TICKS) return;
  const attackTick = boss.crimsonWizardStateTicks - CW_FIREBALL_TELEGRAPH_TICKS;
  if ((attackTick % CW_FIREBALL_INTERVAL_TICKS) !== 2) return;
  spawnCrimsonFireball(world, boss.positionXWorld, boss.positionYWorld, player.positionXWorld + randSigned(world) * 24, player.positionYWorld + randSigned(world) * 10);
}

function tickAttackState(world: WorldState, boss: ClusterState, player: ClusterState): void {
  boss.crimsonWizardStateTicks += 1;
  if (boss.crimsonWizardAttackCooldownTicks > 0) boss.crimsonWizardAttackCooldownTicks -= 1;
  if (boss.crimsonWizardTelegraphTicks > 0) boss.crimsonWizardTelegraphTicks -= 1;

  switch (boss.crimsonWizardState) {
    case CW_STATE_IDLE:
      if (boss.crimsonWizardAttackCooldownTicks <= 0) {
        const next = boss.crimsonWizardNextAttackIndex % 4;
        boss.crimsonWizardNextAttackIndex += 1;
        setState(boss, next === 0 ? CW_STATE_TIDAL_WAVE : next === 1 ? CW_STATE_FIRE_PILLARS : next === 2 ? CW_STATE_METEORS : CW_STATE_FIRE_BALLS);
      }
      break;
    case CW_STATE_TIDAL_WAVE:
      maybeSpawnChargeTelegraph(world, boss, CW_TIDAL_WAVE_TELEGRAPH_TICKS);
      emitTidalWave(world, boss);
      if (boss.crimsonWizardStateTicks > CW_TIDAL_WAVE_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_PILLARS:
      emitPillarTelegraphs(world, boss, player);
      emitPillarRow(world, boss, player);
      if (boss.crimsonWizardStateTicks > CW_PILLAR_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_METEORS:
      emitMeteors(world, boss, player);
      if (boss.crimsonWizardStateTicks > CW_METEOR_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_FIRE_BALLS:
      emitFireballs(world, boss, player);
      if (boss.crimsonWizardStateTicks > CW_FIREBALL_DURATION_TICKS) setState(boss, CW_STATE_RECOVER);
      break;
    case CW_STATE_RECOVER:
      if (boss.crimsonWizardStateTicks > CW_RECOVER_TICKS) {
        boss.crimsonWizardAttackCooldownTicks = CW_BETWEEN_ATTACK_COOLDOWN_TICKS;
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
    steerCrimsonWizardMovement(world, boss, player);
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
