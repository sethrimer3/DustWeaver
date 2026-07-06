import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { ClusterState } from './state';
import { spawnVoidSphere } from './heraldEffects';
import {
  HERALD_ATTACK_COOLDOWN_TICKS,
  HERALD_CAST_TICKS,
  HERALD_CONTACT_DAMAGE,
  HERALD_CONTACT_IFRAMES,
  HERALD_HOVER_ACCEL,
  HERALD_HOVER_DAMPING,
  HERALD_HOVER_MAX_SPEED,
  HERALD_IDLE_DRIFT_STRENGTH_X,
  HERALD_IDLE_DRIFT_STRENGTH_Y,
  HERALD_RECOVER_TICKS,
  HERALD_ROOM_MARGIN,
  HERALD_STATE_CAST,
  HERALD_STATE_IDLE,
  HERALD_STATE_RECOVER,
  VOID_SPHERE_SPEED_WORLD,
} from './heraldConfig';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function playableBounds(world: WorldState, boss: ClusterState): { minX: number; maxX: number; minY: number; maxY: number } {
  const minX = HERALD_ROOM_MARGIN + boss.halfWidthWorld;
  const maxX = Math.max(minX, world.worldWidthWorld - HERALD_ROOM_MARGIN - boss.halfWidthWorld);
  const minY = HERALD_ROOM_MARGIN + boss.halfHeightWorld;
  const maxY = Math.max(minY, world.worldHeightWorld - HERALD_ROOM_MARGIN - boss.halfHeightWorld);
  return { minX, maxX, minY, maxY };
}

/**
 * Gentle idle hover — no aggressive chase logic yet. Keeps the Herald
 * drifting within the room while staying clear of the walls. Intended as a
 * simple placeholder that later attack patterns can layer on top of.
 */
export function steerHeraldMovement(world: WorldState, boss: ClusterState): void {
  const { minX, maxX, minY, maxY } = playableBounds(world, boss);

  const phase = boss.heraldHoverPhaseRad;
  let desiredX = Math.cos(phase * 0.6) * HERALD_IDLE_DRIFT_STRENGTH_X;
  let desiredY = Math.sin(phase * 0.8) * HERALD_IDLE_DRIFT_STRENGTH_Y;

  const leftT = clamp((boss.positionXWorld - minX) / HERALD_ROOM_MARGIN, 0, 1);
  const rightT = clamp((maxX - boss.positionXWorld) / HERALD_ROOM_MARGIN, 0, 1);
  const topT = clamp((boss.positionYWorld - minY) / HERALD_ROOM_MARGIN, 0, 1);
  const bottomT = clamp((maxY - boss.positionYWorld) / HERALD_ROOM_MARGIN, 0, 1);
  desiredX += (1 - leftT) * 1.2 - (1 - rightT) * 1.2;
  desiredY += (1 - topT) * 1.0 - (1 - bottomT) * 1.0;

  const len = Math.sqrt(desiredX * desiredX + desiredY * desiredY);
  if (len > 0.001) {
    boss.heraldVelXWorld += (desiredX / len) * HERALD_HOVER_ACCEL;
    boss.heraldVelYWorld += (desiredY / len) * HERALD_HOVER_ACCEL;
  }
  boss.heraldVelXWorld *= HERALD_HOVER_DAMPING;
  boss.heraldVelYWorld *= HERALD_HOVER_DAMPING;

  const speed = Math.sqrt(boss.heraldVelXWorld * boss.heraldVelXWorld + boss.heraldVelYWorld * boss.heraldVelYWorld);
  if (speed > HERALD_HOVER_MAX_SPEED) {
    const s = HERALD_HOVER_MAX_SPEED / speed;
    boss.heraldVelXWorld *= s;
    boss.heraldVelYWorld *= s;
  }

  boss.positionXWorld = clamp(boss.positionXWorld + boss.heraldVelXWorld, minX, maxX);
  boss.positionYWorld = clamp(boss.positionYWorld + boss.heraldVelYWorld, minY, maxY);
  boss.velocityXWorld = boss.heraldVelXWorld * 60;
  boss.velocityYWorld = boss.heraldVelYWorld * 60;
  boss.heraldHoverPhaseRad += 0.03;
}

function setState(boss: ClusterState, state: number): void {
  boss.heraldState = state;
  boss.heraldStateTicks = 0;
}

function tickAttackState(world: WorldState, boss: ClusterState, player: ClusterState): void {
  boss.heraldStateTicks += 1;
  if (boss.heraldAttackCooldownTicks > 0) boss.heraldAttackCooldownTicks -= 1;

  switch (boss.heraldState) {
    case HERALD_STATE_IDLE:
      if (boss.heraldAttackCooldownTicks <= 0) setState(boss, HERALD_STATE_CAST);
      break;
    case HERALD_STATE_CAST:
      if (boss.heraldStateTicks >= HERALD_CAST_TICKS) {
        spawnVoidSphere(world, boss.positionXWorld, boss.positionYWorld, player.positionXWorld, player.positionYWorld, VOID_SPHERE_SPEED_WORLD);
        setState(boss, HERALD_STATE_RECOVER);
      }
      break;
    case HERALD_STATE_RECOVER:
      if (boss.heraldStateTicks >= HERALD_RECOVER_TICKS) {
        boss.heraldAttackCooldownTicks = HERALD_ATTACK_COOLDOWN_TICKS;
        setState(boss, HERALD_STATE_IDLE);
      }
      break;
  }
}

/** Applies idle movement, the Void Sphere cast cycle, and boss-contact damage for every Herald cluster. */
export function applyHeraldAI(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;
  for (let ci = 1; ci < world.clusters.length; ci++) {
    const boss = world.clusters[ci];
    if (boss.isHeraldFlag !== 1 || boss.isAliveFlag === 0) continue;

    steerHeraldMovement(world, boss);
    tickAttackState(world, boss, player);

    if (player.invulnerabilityTicks <= 0) {
      const overlapX = Math.abs(player.positionXWorld - boss.positionXWorld) <= player.halfWidthWorld + boss.halfWidthWorld;
      const overlapY = Math.abs(player.positionYWorld - boss.positionYWorld) <= player.halfHeightWorld + boss.halfHeightWorld;
      if (overlapX && overlapY) {
        applyPlayerDamageWithKnockback(player, HERALD_CONTACT_DAMAGE, boss.positionXWorld, boss.positionYWorld);
        player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, HERALD_CONTACT_IFRAMES);
      }
    }
  }
}
