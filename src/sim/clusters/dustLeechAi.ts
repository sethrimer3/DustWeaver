import { WorldState, MAX_PARTICLES, MAX_DUST_ECHOES, MAX_MOTES_PER_DE, MAX_MOTES_PER_DL } from '../world';
import { nextFloat } from '../rng';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { dist } from '../../utils/math';
import { createClusterState } from './state';
import {
  BURST_ANGLE_JITTER_RAD,
  BURST_GRAVITY_BIAS_WORLD,
  BURST_LIFETIME_MIN_TICKS,
  BURST_LIFETIME_RANGE_TICKS,
  BURST_SPEED_MIN_WORLD,
  BURST_SPEED_RANGE_WORLD,
  DE_BOB_AMPLITUDE_WORLD,
  DE_BOB_FREQ_RAD_PER_TICK,
  DE_BODY_MOTE_COUNT,
  DE_DEATH_DRAG,
  DE_DEATH_FADE_TICKS,
  DE_HALF_H,
  DE_HALF_W,
  DE_HIT_FLASH_TICKS,
  DE_HOVER_MAX_BLEND,
  DE_HOVER_SPEED,
  DE_HP,
  DE_LIFETIME_TICKS,
  DE_LUNGE_ACTIVATION_RANGE_WORLD,
  DE_LUNGE_ACTIVE_TICKS,
  DE_LUNGE_COOLDOWN_TICKS,
  DE_LUNGE_DAMAGE,
  DE_LUNGE_DISTANCE_WORLD,
  DE_LUNGE_HIT_RADIUS_WORLD,
  DE_LUNGE_IFRAMES_TICKS,
  DE_LUNGE_RECOVER_TICKS,
  DE_LUNGE_SPEED_WORLD,
  DE_LUNGE_TELEGRAPH_TICKS,
  DE_MOTE_JITTER_WORLD,
  DE_MOTE_LERP_FACTOR,
  DE_MOTE_PULSE_FREQ_RAD_PER_TICK,
  DE_VELOCITY_DRAG,
  DL_ACTIVATION_RANGE_WORLD,
  DL_BOB_AMPLITUDE_WORLD,
  DL_BOB_FREQ_RAD_PER_TICK,
  DL_DEATH_DRAG,
  DL_DEATH_DURATION_TICKS,
  DL_HIT_FLASH_TICKS,
  DL_HOVER_MAX_BLEND,
  DL_HOVER_SPEED,
  DL_LEASH_RADIUS_WORLD,
  DL_MAX_ACTIVE_ECHOES,
  DL_MOTE_ANG_VEL_RAD_PER_TICK,
  DL_MOTE_PULSE_FREQ_RAD_PER_TICK,
  DL_RECOVER_DURATION_TICKS,
  DL_SIPHON_ACTIVE_TICKS,
  DL_SIPHON_CHARGE_DECAY_PER_TICK,
  DL_SIPHON_CHARGE_PER_TICK,
  DL_SIPHON_CHARGE_REQUIRED,
  DL_SIPHON_COOLDOWN_TICKS,
  DL_SIPHON_DAMAGE_RADIUS_RATIO,
  DL_SIPHON_HIT_PENALTY_RATIO,
  DL_SIPHON_RANGE_WORLD,
  DL_SIPHON_TELEGRAPH_TICKS,
  DL_VELOCITY_DRAG,
  EPSILON_DISTANCE_WORLD,
} from './dustLeechConfig';

export const DL_STATE_IDLE             = 0;
export const DL_STATE_APPROACH         = 1;
export const DL_STATE_SIPHON_TELEGRAPH = 2;
export const DL_STATE_SIPHON_ACTIVE    = 3;
export const DL_STATE_SPAWN_ECHO       = 4;
export const DL_STATE_RECOVER          = 5;
export const DL_STATE_DYING            = 6;

export const DE_STATE_CHASE            = 0;
export const DE_STATE_LUNGE_TELEGRAPH  = 1;
export const DE_STATE_LUNGE_ACTIVE     = 2;
export const DE_STATE_LUNGE_RECOVER    = 3;
export const DE_STATE_DYING            = 4;

const DE_BODY_BASE_OFFSET_X_WORLD = [0, 0, -2, 2, 0, 0, -5, -6, 5, 6, -2, -3, 2, 3] as const;
const DE_BODY_BASE_OFFSET_Y_WORLD = [-8, -6, -3, -3, 0, -1, -2, 1, -2, 1, 4, 7, 4, 7] as const;

function _setLeechState(cluster: WorldState['clusters'][number], state: number): void {
  cluster.dustLeechState = state;
  cluster.dustLeechStateTicks = 0;
}

function _setEchoState(cluster: WorldState['clusters'][number], state: number): void {
  cluster.dustEchoState = state;
  cluster.dustEchoStateTicks = 0;
}

function _emitBurst(world: WorldState, cx: number, cy: number, count: number): void {
  const profile = getElementProfile(ParticleKind.Physical);
  let spawned = 0;
  for (let pi = 0; pi < MAX_PARTICLES && spawned < count; pi++) {
    if (world.isAliveFlag[pi] === 1) continue;
    const angle = (spawned / count) * Math.PI * 2 + nextFloat(world.rng) * BURST_ANGLE_JITTER_RAD;
    const speed = BURST_SPEED_MIN_WORLD + nextFloat(world.rng) * BURST_SPEED_RANGE_WORLD;
    world.positionXWorld[pi] = cx;
    world.positionYWorld[pi] = cy;
    world.velocityXWorld[pi] = Math.cos(angle) * speed;
    world.velocityYWorld[pi] = Math.sin(angle) * speed - BURST_GRAVITY_BIAS_WORLD;
    world.forceX[pi] = 0;
    world.forceY[pi] = 0;
    world.massKg[pi] = profile.massKg;
    world.chargeUnits[pi] = 0;
    world.isAliveFlag[pi] = 1;
    world.kindBuffer[pi] = ParticleKind.Physical;
    world.ownerEntityId[pi] = -1;
    world.anchorAngleRad[pi] = 0;
    world.anchorRadiusWorld[pi] = 0;
    world.lifetimeTicks[pi] = BURST_LIFETIME_MIN_TICKS + Math.floor(nextFloat(world.rng) * BURST_LIFETIME_RANGE_TICKS);
    world.ageTicks[pi] = 0;
    world.noiseTickSeed[pi] = (nextFloat(world.rng) * 0xffffffff) >>> 0;
    world.behaviorMode[pi] = 0;
    world.particleDurability[pi] = profile.toughness;
    world.respawnDelayTicks[pi] = 0;
    world.attackModeTicksLeft[pi] = 0;
    world.disturbanceFactor[pi] = 0;
    world.isTransientFlag[pi] = 1;
    world.weaveSlotId[pi] = 0;
    spawned++;
  }
}

function _findPlayer(world: WorldState): WorldState['clusters'][number] | null {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isPlayerFlag === 1 && cluster.isAliveFlag === 1) return cluster;
  }
  return null;
}

function _findOwner(world: WorldState, entityId: number): WorldState['clusters'][number] | null {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.entityId === entityId) return cluster;
  }
  return null;
}

function _applyLeechHover(
  cluster: WorldState['clusters'][number],
  targetXWorld: number,
  targetYWorld: number,
): void {
  const dx = targetXWorld - cluster.positionXWorld;
  const dy = targetYWorld - cluster.positionYWorld;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > EPSILON_DISTANCE_WORLD) {
    const blend = Math.min(DL_HOVER_SPEED / distance, DL_HOVER_MAX_BLEND);
    cluster.velocityXWorld += dx * blend;
    cluster.velocityYWorld += dy * blend;
  }
  cluster.velocityXWorld *= DL_VELOCITY_DRAG;
  cluster.velocityYWorld *= DL_VELOCITY_DRAG;
  cluster.positionXWorld += cluster.velocityXWorld;
  cluster.positionYWorld += cluster.velocityYWorld;
}

function _applyEchoHover(
  cluster: WorldState['clusters'][number],
  targetXWorld: number,
  targetYWorld: number,
): void {
  const dx = targetXWorld - cluster.positionXWorld;
  const dy = targetYWorld - cluster.positionYWorld;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance > EPSILON_DISTANCE_WORLD) {
    const blend = Math.min(DE_HOVER_SPEED / distance, DE_HOVER_MAX_BLEND);
    cluster.velocityXWorld += dx * blend;
    cluster.velocityYWorld += dy * blend;
  }
  cluster.velocityXWorld *= DE_VELOCITY_DRAG;
  cluster.velocityYWorld *= DE_VELOCITY_DRAG;
  cluster.positionXWorld += cluster.velocityXWorld;
  cluster.positionYWorld += cluster.velocityYWorld;
}

function _spawnDustEcho(world: WorldState, leech: WorldState['clusters'][number], nextEntityId: number): void {
  let activeOwnedEchoCount = 0;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isDustEchoFlag === 1
      && cluster.isAliveFlag === 1
      && cluster.dustEchoOwnerEntityId === leech.entityId) {
      activeOwnedEchoCount++;
    }
  }
  if (activeOwnedEchoCount >= DL_MAX_ACTIVE_ECHOES) return;

  let slotIndex = -1;
  for (let si = 0; si < MAX_DUST_ECHOES; si++) {
    let taken = false;
    for (let ci = 0; ci < world.clusters.length; ci++) {
      const cluster = world.clusters[ci];
      if (cluster.isDustEchoFlag === 1 && cluster.isAliveFlag === 1 && cluster.dustEchoSlotIndex === si) {
        taken = true;
        break;
      }
    }
    if (!taken) {
      slotIndex = si;
      break;
    }
  }
  if (slotIndex < 0) return;

  const echoCluster = createClusterState(nextEntityId, leech.positionXWorld, leech.positionYWorld, 0, DE_HP);
  echoCluster.isDustEchoFlag = 1;
  echoCluster.dustEchoOwnerEntityId = leech.entityId;
  echoCluster.dustEchoState = DE_STATE_CHASE;
  echoCluster.dustEchoStateTicks = 0;
  echoCluster.dustEchoSlotIndex = slotIndex;
  echoCluster.dustEchoLifetimeTicks = DE_LIFETIME_TICKS;
  echoCluster.dustEchoLungeHitPlayerFlag = 0;
  echoCluster.dustEchoHitFlashTicks = 0;
  echoCluster.halfWidthWorld = DE_HALF_W;
  echoCluster.halfHeightWorld = DE_HALF_H;
  echoCluster.healthPoints = DE_HP;
  echoCluster.maxHealthPoints = DE_HP;
  echoCluster.isAliveFlag = 1;

  const base = slotIndex * MAX_MOTES_PER_DE;
  for (let m = 0; m < DE_BODY_MOTE_COUNT; m++) {
    const mi = base + m;
    world.deMotePulsePhaseRad[mi] = (m / DE_BODY_MOTE_COUNT) * Math.PI * 2;
    world.deMoteOffsetXWorld[mi] = DE_BODY_BASE_OFFSET_X_WORLD[m];
    world.deMoteOffsetYWorld[mi] = DE_BODY_BASE_OFFSET_Y_WORLD[m];
  }

  world.clusters.push(echoCluster);
}

function _tickLeech(
  world: WorldState,
  cluster: WorldState['clusters'][number],
  player: WorldState['clusters'][number] | null,
  nextEntityIdRef: { value: number },
): void {
  const tookHit = cluster.hurtTicks > 0 && cluster.dustLeechHitFlashTicks === 0;
  if (cluster.dustLeechHitFlashTicks > 0) cluster.dustLeechHitFlashTicks--;
  if (cluster.dustLeechAttackCooldownTicks > 0) cluster.dustLeechAttackCooldownTicks--;
  if (tookHit) {
    cluster.dustLeechHitFlashTicks = DL_HIT_FLASH_TICKS;
    if (cluster.dustLeechState === DL_STATE_SIPHON_TELEGRAPH || cluster.dustLeechState === DL_STATE_SIPHON_ACTIVE) {
      cluster.dustLeechSiphonCharge *= DL_SIPHON_HIT_PENALTY_RATIO;
      _setLeechState(cluster, DL_STATE_RECOVER);
    }
  }

  if (cluster.healthPoints <= 0 && cluster.dustLeechState !== DL_STATE_DYING) {
    _emitBurst(world, cluster.positionXWorld, cluster.positionYWorld, 8);
    _setLeechState(cluster, DL_STATE_DYING);
  }

  cluster.dustLeechBobPhaseRad =
    (cluster.dustLeechBobPhaseRad + DL_BOB_FREQ_RAD_PER_TICK) % (Math.PI * 2);

  const spawnXWorld = cluster.dustLeechSpawnXWorld;
  const spawnYWorld = cluster.dustLeechSpawnYWorld;
  const bobTargetYWorld = spawnYWorld + Math.sin(cluster.dustLeechBobPhaseRad) * DL_BOB_AMPLITUDE_WORLD;
  const hasPlayer = player !== null;
  const playerXWorld = player?.positionXWorld ?? spawnXWorld;
  const playerYWorld = player?.positionYWorld ?? spawnYWorld;
  const playerDistanceWorld = hasPlayer
    ? dist(cluster.positionXWorld, cluster.positionYWorld, playerXWorld, playerYWorld)
    : Number.POSITIVE_INFINITY;

  const toSpawnXWorld = spawnXWorld - cluster.positionXWorld;
  const toSpawnYWorld = bobTargetYWorld - cluster.positionYWorld;
  const distanceToSpawnWorld = Math.sqrt(toSpawnXWorld * toSpawnXWorld + toSpawnYWorld * toSpawnYWorld);

  if (cluster.dustLeechSlotIndex >= 0) {
    const base = cluster.dustLeechSlotIndex * MAX_MOTES_PER_DL;
    for (let m = 0; m < MAX_MOTES_PER_DL; m++) {
      const mi = base + m;
      world.dlMoteAngleRad[mi] =
        (world.dlMoteAngleRad[mi] + DL_MOTE_ANG_VEL_RAD_PER_TICK) % (Math.PI * 2);
      world.dlMotePulsePhaseRad[mi] =
        (world.dlMotePulsePhaseRad[mi] + DL_MOTE_PULSE_FREQ_RAD_PER_TICK) % (Math.PI * 2);
    }
  }

  switch (cluster.dustLeechState) {
    case DL_STATE_IDLE: {
      _applyLeechHover(cluster, spawnXWorld, bobTargetYWorld);
      if (hasPlayer && playerDistanceWorld <= DL_ACTIVATION_RANGE_WORLD) {
        _setLeechState(cluster, DL_STATE_APPROACH);
      } else {
        cluster.dustLeechStateTicks++;
      }
      break;
    }

    case DL_STATE_APPROACH: {
      let targetXWorld = playerXWorld;
      let targetYWorld = playerYWorld;
      if (distanceToSpawnWorld > DL_LEASH_RADIUS_WORLD) {
        targetXWorld = spawnXWorld;
        targetYWorld = bobTargetYWorld;
      }
      _applyLeechHover(cluster, targetXWorld, targetYWorld);
      if (!hasPlayer || playerDistanceWorld > DL_ACTIVATION_RANGE_WORLD) {
        _setLeechState(cluster, DL_STATE_IDLE);
        break;
      }
      if (playerDistanceWorld <= DL_SIPHON_RANGE_WORLD && cluster.dustLeechAttackCooldownTicks <= 0) {
        _setLeechState(cluster, DL_STATE_SIPHON_TELEGRAPH);
        break;
      }
      cluster.dustLeechStateTicks++;
      break;
    }

    case DL_STATE_SIPHON_TELEGRAPH: {
      cluster.velocityXWorld *= DL_VELOCITY_DRAG;
      cluster.velocityYWorld *= DL_VELOCITY_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustLeechStateTicks++;
      if (cluster.dustLeechStateTicks >= DL_SIPHON_TELEGRAPH_TICKS) {
        _setLeechState(cluster, DL_STATE_SIPHON_ACTIVE);
      }
      break;
    }

    case DL_STATE_SIPHON_ACTIVE: {
      cluster.velocityXWorld *= DL_VELOCITY_DRAG;
      cluster.velocityYWorld *= DL_VELOCITY_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustLeechStateTicks++;
      if (hasPlayer && playerDistanceWorld <= DL_SIPHON_RANGE_WORLD) {
        cluster.dustLeechSiphonCharge = Math.min(
          DL_SIPHON_CHARGE_REQUIRED,
          cluster.dustLeechSiphonCharge + DL_SIPHON_CHARGE_PER_TICK,
        );
        if (playerDistanceWorld <= DL_SIPHON_RANGE_WORLD * DL_SIPHON_DAMAGE_RADIUS_RATIO) {
          applyPlayerDamageWithKnockback(player, 1, cluster.positionXWorld, cluster.positionYWorld);
        }
      } else {
        cluster.dustLeechSiphonCharge = Math.max(
          0,
          cluster.dustLeechSiphonCharge - DL_SIPHON_CHARGE_DECAY_PER_TICK,
        );
      }
      if (cluster.dustLeechSiphonCharge >= DL_SIPHON_CHARGE_REQUIRED) {
        _setLeechState(cluster, DL_STATE_SPAWN_ECHO);
        break;
      }
      if (cluster.dustLeechStateTicks >= DL_SIPHON_ACTIVE_TICKS) {
        _setLeechState(cluster, DL_STATE_RECOVER);
      }
      break;
    }

    case DL_STATE_SPAWN_ECHO: {
      _spawnDustEcho(world, cluster, nextEntityIdRef.value++);
      cluster.dustLeechSiphonCharge = 0;
      cluster.dustLeechAttackCooldownTicks = DL_SIPHON_COOLDOWN_TICKS;
      _setLeechState(cluster, DL_STATE_RECOVER);
      break;
    }

    case DL_STATE_RECOVER: {
      _applyLeechHover(cluster, spawnXWorld, bobTargetYWorld);
      cluster.dustLeechStateTicks++;
      if (cluster.dustLeechStateTicks >= DL_RECOVER_DURATION_TICKS) {
        if (hasPlayer && playerDistanceWorld <= DL_ACTIVATION_RANGE_WORLD) {
          _setLeechState(cluster, DL_STATE_APPROACH);
        } else {
          _setLeechState(cluster, DL_STATE_IDLE);
        }
      }
      break;
    }

    case DL_STATE_DYING: {
      cluster.velocityXWorld *= DL_DEATH_DRAG;
      cluster.velocityYWorld *= DL_DEATH_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustLeechStateTicks++;
      if (cluster.dustLeechStateTicks >= DL_DEATH_DURATION_TICKS) {
        cluster.isAliveFlag = 0;
        for (let ci = 0; ci < world.clusters.length; ci++) {
          const other = world.clusters[ci];
          if (other.isDustEchoFlag !== 1 || other.dustEchoOwnerEntityId !== cluster.entityId) continue;
          if (other.dustEchoState !== DE_STATE_DYING) {
            _setEchoState(other, DE_STATE_DYING);
          }
        }
      }
      break;
    }
  }
}

function _tickEcho(
  world: WorldState,
  cluster: WorldState['clusters'][number],
  player: WorldState['clusters'][number] | null,
): void {
  const tookHit = cluster.hurtTicks > 0 && cluster.dustEchoHitFlashTicks === 0;
  if (cluster.dustEchoHitFlashTicks > 0) cluster.dustEchoHitFlashTicks--;
  if (tookHit) cluster.dustEchoHitFlashTicks = DE_HIT_FLASH_TICKS;
  if (cluster.dustEchoLungeCooldownTicks > 0) cluster.dustEchoLungeCooldownTicks--;

  cluster.dustEchoLifetimeTicks -= 1;
  if (cluster.dustEchoLifetimeTicks <= 0 && cluster.dustEchoState !== DE_STATE_DYING) {
    _setEchoState(cluster, DE_STATE_DYING);
  }

  if (cluster.healthPoints <= 0 && cluster.dustEchoState !== DE_STATE_DYING) {
    _emitBurst(world, cluster.positionXWorld, cluster.positionYWorld, 4);
    _setEchoState(cluster, DE_STATE_DYING);
  }

  if (cluster.dustEchoOwnerEntityId >= 0 && cluster.dustEchoState !== DE_STATE_DYING) {
    const owner = _findOwner(world, cluster.dustEchoOwnerEntityId);
    if (owner === null || owner.isAliveFlag === 0) {
      _setEchoState(cluster, DE_STATE_DYING);
    }
  }

  if (cluster.dustEchoSlotIndex >= 0) {
    const base = cluster.dustEchoSlotIndex * MAX_MOTES_PER_DE;
    for (let m = 0; m < DE_BODY_MOTE_COUNT; m++) {
      const mi = base + m;
      world.deMotePulsePhaseRad[mi] =
        (world.deMotePulsePhaseRad[mi] + DE_MOTE_PULSE_FREQ_RAD_PER_TICK) % (Math.PI * 2);
      const jitterXWorld = (nextFloat(world.rng) - 0.5) * DE_MOTE_JITTER_WORLD;
      const jitterYWorld = (nextFloat(world.rng) - 0.5) * DE_MOTE_JITTER_WORLD;
      const targetXWorld = DE_BODY_BASE_OFFSET_X_WORLD[m] + jitterXWorld;
      const targetYWorld = DE_BODY_BASE_OFFSET_Y_WORLD[m] + jitterYWorld;
      world.deMoteOffsetXWorld[mi] += (targetXWorld - world.deMoteOffsetXWorld[mi]) * DE_MOTE_LERP_FACTOR;
      world.deMoteOffsetYWorld[mi] += (targetYWorld - world.deMoteOffsetYWorld[mi]) * DE_MOTE_LERP_FACTOR;
    }
  }

  const hasPlayer = player !== null;
  const playerXWorld = player?.positionXWorld ?? cluster.positionXWorld;
  const playerYWorld = player?.positionYWorld ?? cluster.positionYWorld;
  const playerDistanceWorld = hasPlayer
    ? dist(cluster.positionXWorld, cluster.positionYWorld, playerXWorld, playerYWorld)
    : Number.POSITIVE_INFINITY;
  const bobTargetYWorld = playerYWorld + Math.sin((world.tick + cluster.entityId) * DE_BOB_FREQ_RAD_PER_TICK) * DE_BOB_AMPLITUDE_WORLD;

  switch (cluster.dustEchoState) {
    case DE_STATE_CHASE: {
      _applyEchoHover(cluster, playerXWorld, bobTargetYWorld);
      if (hasPlayer && cluster.dustEchoLungeCooldownTicks <= 0 && playerDistanceWorld <= DE_LUNGE_ACTIVATION_RANGE_WORLD) {
        const dx = playerXWorld - cluster.positionXWorld;
        const dy = playerYWorld - cluster.positionYWorld;
        const length = Math.sqrt(dx * dx + dy * dy) + EPSILON_DISTANCE_WORLD;
        cluster.dustEchoLungeDirXWorld = dx / length;
        cluster.dustEchoLungeDirYWorld = dy / length;
        _setEchoState(cluster, DE_STATE_LUNGE_TELEGRAPH);
        break;
      }
      cluster.dustEchoStateTicks++;
      break;
    }

    case DE_STATE_LUNGE_TELEGRAPH: {
      cluster.velocityXWorld *= DE_VELOCITY_DRAG;
      cluster.velocityYWorld *= DE_VELOCITY_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustEchoStateTicks++;
      if (cluster.dustEchoStateTicks >= DE_LUNGE_TELEGRAPH_TICKS) {
        _setEchoState(cluster, DE_STATE_LUNGE_ACTIVE);
        cluster.dustEchoLungeDistCovered = 0;
        cluster.dustEchoLungeHitPlayerFlag = 0;
      }
      break;
    }

    case DE_STATE_LUNGE_ACTIVE: {
      const stepWorld = DE_LUNGE_SPEED_WORLD;
      const lx = cluster.dustEchoLungeDirXWorld;
      const ly = cluster.dustEchoLungeDirYWorld;
      cluster.velocityXWorld = lx * stepWorld;
      cluster.velocityYWorld = ly * stepWorld;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustEchoLungeDistCovered += stepWorld;
      cluster.dustEchoStateTicks++;
      if (hasPlayer && cluster.dustEchoLungeHitPlayerFlag === 0) {
        const hitDistanceWorld = dist(cluster.positionXWorld, cluster.positionYWorld, playerXWorld, playerYWorld);
        if (hitDistanceWorld <= DE_LUNGE_HIT_RADIUS_WORLD) {
          applyPlayerDamageWithKnockback(player, DE_LUNGE_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
          player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, DE_LUNGE_IFRAMES_TICKS);
          cluster.dustEchoLungeHitPlayerFlag = 1;
        }
      }
      if (cluster.dustEchoStateTicks >= DE_LUNGE_ACTIVE_TICKS
        || cluster.dustEchoLungeDistCovered >= DE_LUNGE_DISTANCE_WORLD) {
        _setEchoState(cluster, DE_STATE_LUNGE_RECOVER);
      }
      break;
    }

    case DE_STATE_LUNGE_RECOVER: {
      cluster.velocityXWorld *= DE_VELOCITY_DRAG;
      cluster.velocityYWorld *= DE_VELOCITY_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustEchoStateTicks++;
      if (cluster.dustEchoStateTicks >= DE_LUNGE_RECOVER_TICKS) {
        cluster.dustEchoLungeCooldownTicks = DE_LUNGE_COOLDOWN_TICKS;
        _setEchoState(cluster, DE_STATE_CHASE);
      }
      break;
    }

    case DE_STATE_DYING: {
      cluster.velocityXWorld *= DE_DEATH_DRAG;
      cluster.velocityYWorld *= DE_DEATH_DRAG;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;
      cluster.dustEchoStateTicks++;
      if (cluster.dustEchoStateTicks >= DE_DEATH_FADE_TICKS) {
        cluster.isAliveFlag = 0;
      }
      break;
    }
  }
}

export function applyDustLeechAI(world: WorldState): void {
  const player = _findPlayer(world);
  const initialClusterCount = world.clusters.length;
  let nextEntityId = 1;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].entityId >= nextEntityId) nextEntityId = world.clusters[ci].entityId + 1;
  }
  const nextEntityIdRef = { value: nextEntityId };

  for (let ci = 0; ci < initialClusterCount; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isDustLeechFlag !== 1 || cluster.isAliveFlag === 0) continue;
    _tickLeech(world, cluster, player, nextEntityIdRef);
  }

  for (let ci = 0; ci < initialClusterCount; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isDustEchoFlag !== 1 || cluster.isAliveFlag === 0) continue;
    _tickEcho(world, cluster, player);
  }
}
