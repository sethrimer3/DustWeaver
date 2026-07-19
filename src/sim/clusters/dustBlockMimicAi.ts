/**
 * Dust Block Mimic — AI state machine.
 *
 * States:
 *   0 = dormant    — looks like a block; waiting for wake trigger
 *   1 = wake       — shaking, cracking, leaking dust
 *   2 = burst      — fragments fly outward into mote formation
 *   3 = activeIdle — swarm hovers, tracks player, attack cooldown
 *   4 = telegraph  — motes compress into a wedge
 *   5 = attack     — shard rush lunge; damage window
 *   6 = recover    — motes slow and rejoin
 *   7 = dying      — cohesion failure, collapse, burst
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState, MAX_DUST_BLOCK_MIMICS, MAX_MOTES_PER_DBM } from '../world';
import { MAX_PARTICLES } from '../world';
import { nextFloat, nextFloatRange } from '../rng';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { getElementProfile } from '../particles/elementProfiles';
import { ParticleKind } from '../particles/kinds';
import {
  DBM_SMALL_MOTE_COUNT,
  DBM_LARGE_MOTE_COUNT,
  DBM_SMALL_BLOCK_HALF_W,
  DBM_LARGE_BLOCK_HALF_W,
  DBM_SMALL_BLOCK_HALF_H,
  DBM_LARGE_BLOCK_HALF_H,
  DBM_ACTIVE_HITBOX_RADIUS,
  DBM_ACTIVATION_RANGE_WORLD,
  DBM_WAKE_DURATION_TICKS,
  DBM_BURST_DURATION_TICKS,
  DBM_BURST_SPEED,
  DBM_BOB_AMPLITUDE_WORLD,
  DBM_BOB_FREQ_RAD_PER_TICK,
  DBM_LEASH_RADIUS_WORLD,
  DBM_MOTE_SPRING_BLEND,
  DBM_MOTE_JITTER_SPEED,
  DBM_MOTE_PULSE_FREQ_RAD_PER_TICK,
  DBM_MOTE_ORBIT_RADIUS_WORLD,
  DBM_MOTE_ORBIT_RAD_PER_TICK,
  DBM_TELEGRAPH_DURATION_TICKS,
  DBM_ATTACK_COOLDOWN_TICKS,
  DBM_SHARD_RUSH_SPEED,
  DBM_SHARD_RUSH_DISTANCE_WORLD,
  DBM_SHARD_RUSH_DAMAGE,
  DBM_SHARD_RUSH_IFRAMES_TICKS,
  DBM_SHARD_RUSH_HIT_HALF_W,
  DBM_SHARD_RUSH_HIT_HALF_H,
  DBM_RECOVER_DURATION_TICKS,
  DBM_HIT_FLASH_TICKS,
  DBM_HIT_SCATTER_SPEED,
  DBM_DEATH_BURST_COUNT,
  DBM_DEATH_BURST_SPEED,
  DBM_DEATH_DURATION_TICKS,
  DBM_DEATH_BURST_TICK,
  DBM_SMALL_FORMATION_X,
  DBM_SMALL_FORMATION_Y,
  DBM_LARGE_FORMATION_X,
  DBM_LARGE_FORMATION_Y,
  DBM_WAKE_SHAKE_AMP_WORLD,
} from './dustBlockMimicConfig';

// ── State identifiers ──────────────────────────────────────────────────────
export const DBM_STATE_DORMANT    = 0;
export const DBM_STATE_WAKE       = 1;
export const DBM_STATE_BURST      = 2;
export const DBM_STATE_ACTIVE     = 3;
export const DBM_STATE_TELEGRAPH  = 4;
export const DBM_STATE_ATTACK     = 5;
export const DBM_STATE_RECOVER    = 6;
export const DBM_STATE_DYING      = 7;

// ── Helpers ────────────────────────────────────────────────────────────────

function _moteCount(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_MOTE_COUNT : DBM_SMALL_MOTE_COUNT;
}

function _formationX(isLarge: 0 | 1): readonly number[] {
  return isLarge === 1 ? DBM_LARGE_FORMATION_X : DBM_SMALL_FORMATION_X;
}

function _formationY(isLarge: 0 | 1): readonly number[] {
  return isLarge === 1 ? DBM_LARGE_FORMATION_Y : DBM_SMALL_FORMATION_Y;
}

function _halfW(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_BLOCK_HALF_W : DBM_SMALL_BLOCK_HALF_W;
}

function _halfH(isLarge: 0 | 1): number {
  return isLarge === 1 ? DBM_LARGE_BLOCK_HALF_H : DBM_SMALL_BLOCK_HALF_H;
}

function _moteBase(slot: number): number {
  return slot * MAX_MOTES_PER_DBM;
}

/** Emit burst particles from a world position (uses seeded world RNG). */
function _emitBurst(
  world: WorldState,
  x: number,
  y: number,
  count: number,
  speed: number,
): void {
  const profile = getElementProfile(ParticleKind.Golden);
  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;
    const angle = nextFloat(world.rng) * Math.PI * 2;
    const spd = speed * (0.5 + nextFloat(world.rng) * 0.8);
    world.positionXWorld[idx] = x;
    world.positionYWorld[idx] = y;
    world.velocityXWorld[idx] = Math.cos(angle) * spd;
    world.velocityYWorld[idx] = Math.sin(angle) * spd - 0.4;
    world.forceX[idx] = 0;
    world.forceY[idx] = 0;
    world.massKg[idx] = profile.massKg;
    world.chargeUnits[idx] = 0;
    world.isAliveFlag[idx] = 1;
    world.kindBuffer[idx] = ParticleKind.Golden;
    world.ownerEntityId[idx] = -1;
    world.anchorAngleRad[idx] = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.lifetimeTicks[idx] = 36 + Math.floor(nextFloat(world.rng) * 32);
    world.ageTicks[idx] = 0;
    world.noiseTickSeed[idx] = (nextFloat(world.rng) * 0xffffffff) >>> 0;
    world.behaviorMode[idx] = 0;
    world.particleDurability[idx] = profile.toughness;
    world.respawnDelayTicks[idx] = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.isTransientFlag[idx] = 1;
    world.weaveSlotId[idx] = 0;
  }
}

/** Apply formation targets to mote array for a given slot. */
function _applyFormationTargets(
  world: WorldState,
  slot: number,
  isLarge: 0 | 1,
  halfW: number,
  halfH: number,
): void {
  const base = _moteBase(slot);
  const formX = _formationX(isLarge);
  const formY = _formationY(isLarge);
  const count = _moteCount(isLarge);
  for (let m = 0; m < count; m++) {
    world.dbmMoteTargetLocalX[base + m] = formX[m] * halfW;
    world.dbmMoteTargetLocalY[base + m] = formY[m] * halfH;
  }
}

// ── Main AI update ─────────────────────────────────────────────────────────

export function applyDustBlockMimicAI(world: WorldState): void {
  // Locate player
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  let playerClusterIdx = -1;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      playerClusterIdx = ci;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isDustBlockMimicFlag !== 1) continue;

    const slot = cluster.dustBlockMimicSlotIndex;
    if (slot < 0 || slot >= MAX_DUST_BLOCK_MIMICS) continue;

    const isLarge = cluster.isDustBlockMimicLargeFlag;
    const moteCount = _moteCount(isLarge);
    const halfW = _halfW(isLarge);
    const halfH = _halfH(isLarge);
    const base = _moteBase(slot);

    // ── Tick down hit flash ────────────────────────────────────────────────
    if (cluster.dustBlockMimicHitFlashTicks > 0) {
      cluster.dustBlockMimicHitFlashTicks--;
    }

    // ── Dead state ─────────────────────────────────────────────────────────
    if (cluster.isAliveFlag === 0) {
      const t = cluster.dustBlockMimicStateTicks;
      if (t === 0) {
        // Scatter motes outward
        for (let m = 0; m < moteCount; m++) {
          const mx = world.dbmMoteXWorld[base + m];
          const my = world.dbmMoteYWorld[base + m];
          const dx = mx - cluster.positionXWorld;
          const dy = my - cluster.positionYWorld;
          const len = Math.sqrt(dx * dx + dy * dy) + 0.001;
          world.dbmMoteVelXWorld[base + m] = (dx / len) * DBM_DEATH_BURST_SPEED;
          world.dbmMoteVelYWorld[base + m] = (dy / len) * DBM_DEATH_BURST_SPEED - 0.5;
        }
      }
      if (t === DBM_DEATH_BURST_TICK) {
        _emitBurst(world, cluster.positionXWorld, cluster.positionYWorld,
          DBM_DEATH_BURST_COUNT, DBM_DEATH_BURST_SPEED * 0.9);
      }
      // Mote drift
      if (t < DBM_DEATH_DURATION_TICKS) {
        for (let m = 0; m < moteCount; m++) {
          world.dbmMoteVelXWorld[base + m] *= 0.9;
          world.dbmMoteVelYWorld[base + m] *= 0.9;
          world.dbmMoteXWorld[base + m] += world.dbmMoteVelXWorld[base + m];
          world.dbmMoteYWorld[base + m] += world.dbmMoteVelYWorld[base + m];
        }
      }
      cluster.dustBlockMimicStateTicks++;
      continue;
    }

    const state = cluster.dustBlockMimicState;
    const cx = cluster.positionXWorld;
    const cy = cluster.positionYWorld;
    const spawnX = cluster.dustBlockMimicSpawnXWorld;
    const spawnY = cluster.dustBlockMimicSpawnYWorld;

    // ── State machine ──────────────────────────────────────────────────────
    cluster.dustBlockMimicStateTicks++;
    const stateTicks = cluster.dustBlockMimicStateTicks;

    // ── Dormant ────────────────────────────────────────────────────────────
    if (state === DBM_STATE_DORMANT) {
      // No movement; stay at spawn
      cluster.positionXWorld = spawnX;
      cluster.positionYWorld = spawnY;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;

      // Pulse phase for subtle idle mote animation
      for (let m = 0; m < moteCount; m++) {
        world.dbmMotePulsePhaseRad[base + m] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK * 0.5;
      }

      if (!playerFound) continue;
      const dx = playerX - spawnX;
      const dy = playerY - spawnY;
      const distSq = dx * dx + dy * dy;
      if (distSq < DBM_ACTIVATION_RANGE_WORLD * DBM_ACTIVATION_RANGE_WORLD) {
        cluster.dustBlockMimicState = DBM_STATE_WAKE;
        cluster.dustBlockMimicStateTicks = 0;
        // Resize hitbox to active during wake
        cluster.halfWidthWorld  = halfW;
        cluster.halfHeightWorld = halfH;
      }
      continue;
    }

    // ── Wake ───────────────────────────────────────────────────────────────
    if (state === DBM_STATE_WAKE) {
      // Position: shake about spawn
      const shakeAmt = Math.sin(stateTicks * 1.4) * (1.0 - stateTicks / DBM_WAKE_DURATION_TICKS) * DBM_WAKE_SHAKE_AMP_WORLD;
      cluster.positionXWorld = spawnX + shakeAmt;
      cluster.positionYWorld = spawnY;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;

      // Motes pulse faster
      for (let m = 0; m < moteCount; m++) {
        world.dbmMotePulsePhaseRad[base + m] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK * 1.5;
      }

      if (stateTicks >= DBM_WAKE_DURATION_TICKS) {
        cluster.dustBlockMimicState = DBM_STATE_BURST;
        cluster.dustBlockMimicStateTicks = 0;
        // Apply burst outward velocities to motes
        for (let m = 0; m < moteCount; m++) {
          const angle = ((m / moteCount) * Math.PI * 2)
            + nextFloatRange(world.rng, -0.8, 0.8);
          world.dbmMoteVelXWorld[base + m] = Math.cos(angle) * DBM_BURST_SPEED;
          world.dbmMoteVelYWorld[base + m] = Math.sin(angle) * DBM_BURST_SPEED;
        }
      }
      continue;
    }

    // ── Burst ──────────────────────────────────────────────────────────────
    if (state === DBM_STATE_BURST) {
      // Position stays near spawn; apply formation targets for spring pull after mid-burst
      _applyFormationTargets(world, slot, isLarge, halfW * 0.85, halfH * 0.85);
      const burstProgress = stateTicks / DBM_BURST_DURATION_TICKS;

      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        // Apply gentle spring toward formation after half the burst duration
        if (burstProgress > 0.5) {
          const tx = cx + world.dbmMoteTargetLocalX[idx];
          const ty = cy + world.dbmMoteTargetLocalY[idx];
          const mx2 = world.dbmMoteXWorld[idx];
          const my2 = world.dbmMoteYWorld[idx];
          world.dbmMoteVelXWorld[idx] += (tx - mx2) * 0.04;
          world.dbmMoteVelYWorld[idx] += (ty - my2) * 0.04;
        }
        world.dbmMoteVelXWorld[idx] *= 0.88;
        world.dbmMoteVelYWorld[idx] *= 0.88;
        world.dbmMoteXWorld[idx] += world.dbmMoteVelXWorld[idx];
        world.dbmMoteYWorld[idx] += world.dbmMoteVelYWorld[idx];
        world.dbmMotePulsePhaseRad[idx] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }
      cluster.positionXWorld = spawnX;
      cluster.positionYWorld = spawnY;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;

      if (stateTicks >= DBM_BURST_DURATION_TICKS) {
        cluster.dustBlockMimicState = DBM_STATE_ACTIVE;
        cluster.dustBlockMimicStateTicks = 0;
        cluster.dustBlockMimicAttackCooldownTicks = DBM_ATTACK_COOLDOWN_TICKS;
        cluster.halfWidthWorld  = DBM_ACTIVE_HITBOX_RADIUS;
        cluster.halfHeightWorld = DBM_ACTIVE_HITBOX_RADIUS;
        _applyFormationTargets(world, slot, isLarge, halfW * 0.85, halfH * 0.85);
      }
      continue;
    }

    // ── Active Idle ────────────────────────────────────────────────────────
    if (state === DBM_STATE_ACTIVE) {
      // Bob + leash back to spawn
      cluster.dustBlockMimicBobPhaseRad += DBM_BOB_FREQ_RAD_PER_TICK;
      const bobY = Math.sin(cluster.dustBlockMimicBobPhaseRad) * DBM_BOB_AMPLITUDE_WORLD;
      const toSpawnX = spawnX - cx;
      const toSpawnY = (spawnY + bobY) - cy;
      const distToSpawn = Math.sqrt(toSpawnX * toSpawnX + toSpawnY * toSpawnY);
      if (distToSpawn > 1.0) {
        const leashBlend = Math.min(0.02, distToSpawn / DBM_LEASH_RADIUS_WORLD) * 0.5;
        cluster.velocityXWorld = (cluster.velocityXWorld + toSpawnX * leashBlend) * 0.94;
        cluster.velocityYWorld = (cluster.velocityYWorld + toSpawnY * leashBlend) * 0.94;
      } else {
        cluster.velocityXWorld *= 0.94;
        cluster.velocityYWorld *= 0.94;
      }
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;

      // Mote orbital drift
      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        const mx2 = world.dbmMoteXWorld[idx];
        const my2 = world.dbmMoteYWorld[idx];
        const tx = world.dbmMoteTargetLocalX[idx];
        const ty = world.dbmMoteTargetLocalY[idx];
        const phase = world.dbmMotePulsePhaseRad[idx];

        const orbitAngle = stateTicks * DBM_MOTE_ORBIT_RAD_PER_TICK + phase;
        const oX = Math.cos(orbitAngle) * DBM_MOTE_ORBIT_RADIUS_WORLD;
        const oY = Math.sin(orbitAngle * 1.2) * DBM_MOTE_ORBIT_RADIUS_WORLD * 0.6;

        const idleTargetX = cluster.positionXWorld + tx + oX;
        const idleTargetY = cluster.positionYWorld + ty + oY;

        const jitterX = nextFloatRange(world.rng, -DBM_MOTE_JITTER_SPEED, DBM_MOTE_JITTER_SPEED) * (1.0 / 60.0);
        const jitterY = nextFloatRange(world.rng, -DBM_MOTE_JITTER_SPEED, DBM_MOTE_JITTER_SPEED) * (1.0 / 60.0);

        const dvx = (idleTargetX - mx2) * DBM_MOTE_SPRING_BLEND + jitterX;
        const dvy = (idleTargetY - my2) * DBM_MOTE_SPRING_BLEND + jitterY;
        world.dbmMoteVelXWorld[idx] = (world.dbmMoteVelXWorld[idx] + dvx) * 0.8;
        world.dbmMoteVelYWorld[idx] = (world.dbmMoteVelYWorld[idx] + dvy) * 0.8;
        world.dbmMoteXWorld[idx] = mx2 + world.dbmMoteVelXWorld[idx];
        world.dbmMoteYWorld[idx] = my2 + world.dbmMoteVelYWorld[idx];
        world.dbmMotePulsePhaseRad[idx] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }

      // Attack cooldown
      if (cluster.dustBlockMimicAttackCooldownTicks > 0) {
        cluster.dustBlockMimicAttackCooldownTicks--;
      }

      if (cluster.dustBlockMimicAttackCooldownTicks <= 0 && playerFound) {
        // Compute lunge direction toward player
        const dx = playerX - cx;
        const dy = playerY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.001;
        cluster.dustBlockMimicLungeDirXWorld = dx / dist;
        cluster.dustBlockMimicLungeDirYWorld = dy / dist;
        cluster.dustBlockMimicState = DBM_STATE_TELEGRAPH;
        cluster.dustBlockMimicStateTicks = 0;
      }
      continue;
    }

    // ── Telegraph ──────────────────────────────────────────────────────────
    if (state === DBM_STATE_TELEGRAPH) {
      // Lock position
      cluster.velocityXWorld *= 0.85;
      cluster.velocityYWorld *= 0.85;
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;

      // Pull motes toward a compressed wedge in the lunge direction
      const lx = cluster.dustBlockMimicLungeDirXWorld;
      const ly = cluster.dustBlockMimicLungeDirYWorld;
      const perpX = -ly;
      const perpY =  lx;
      const tightness = Math.min(1.0, stateTicks / DBM_TELEGRAPH_DURATION_TICKS);
      const spreadW = halfW * (1.0 - tightness * 0.7);
      const spreadH = halfH * (1.0 - tightness * 0.6);
      const fwdBias = tightness * halfH;

      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        const formX2 = _formationX(isLarge);
        const formY2 = _formationY(isLarge);
        // Project formation into wedge along lunge direction
        const localFwd  = formY2[m] * spreadH + fwdBias;
        const localPerp = formX2[m] * spreadW;
        const tx = cluster.positionXWorld + lx * localFwd + perpX * localPerp;
        const ty = cluster.positionYWorld + ly * localFwd + perpY * localPerp;

        const mx2 = world.dbmMoteXWorld[idx];
        const my2 = world.dbmMoteYWorld[idx];
        world.dbmMoteVelXWorld[idx] = (world.dbmMoteVelXWorld[idx] + (tx - mx2) * 0.18) * 0.75;
        world.dbmMoteVelYWorld[idx] = (world.dbmMoteVelYWorld[idx] + (ty - my2) * 0.18) * 0.75;
        world.dbmMoteXWorld[idx] = mx2 + world.dbmMoteVelXWorld[idx];
        world.dbmMoteYWorld[idx] = my2 + world.dbmMoteVelYWorld[idx];
        world.dbmMotePulsePhaseRad[idx] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK * 1.8;
      }

      if (stateTicks >= DBM_TELEGRAPH_DURATION_TICKS) {
        cluster.dustBlockMimicState = DBM_STATE_ATTACK;
        cluster.dustBlockMimicStateTicks = 0;
        cluster.dustBlockMimicLungeDistCovered = 0;
        cluster.dustBlockMimicLungeHitPlayerFlag = 0;
      }
      continue;
    }

    // ── Attack (Shard Rush) ────────────────────────────────────────────────
    if (state === DBM_STATE_ATTACK) {
      // Move cluster in lunge direction
      const lx = cluster.dustBlockMimicLungeDirXWorld;
      const ly = cluster.dustBlockMimicLungeDirYWorld;
      const step = DBM_SHARD_RUSH_SPEED;
      cluster.positionXWorld += lx * step;
      cluster.positionYWorld += ly * step;
      cluster.dustBlockMimicLungeDistCovered += step;

      // Lock motes tightly to cluster
      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        const formX2 = _formationX(isLarge);
        const formY2 = _formationY(isLarge);
        const perpX2 = -ly;
        const perpY2 =  lx;
        const tx = cluster.positionXWorld + lx * formY2[m] * halfH * 0.5
          + perpX2 * formX2[m] * halfW * 0.4;
        const ty = cluster.positionYWorld + ly * formY2[m] * halfH * 0.5
          + perpY2 * formX2[m] * halfW * 0.4;
        world.dbmMoteVelXWorld[idx] = (world.dbmMoteVelXWorld[idx] + (tx - world.dbmMoteXWorld[idx]) * 0.4) * 0.7;
        world.dbmMoteVelYWorld[idx] = (world.dbmMoteVelYWorld[idx] + (ty - world.dbmMoteYWorld[idx]) * 0.4) * 0.7;
        world.dbmMoteXWorld[idx] += world.dbmMoteVelXWorld[idx];
        world.dbmMoteYWorld[idx] += world.dbmMoteVelYWorld[idx];
        world.dbmMotePulsePhaseRad[idx] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK * 2.0;
      }

      // Damage test
      if (cluster.dustBlockMimicLungeHitPlayerFlag === 0 && playerFound && playerClusterIdx >= 0) {
        const player = world.clusters[playerClusterIdx];
        if (player.invulnerabilityTicks <= 0) {
          const dx = playerX - cluster.positionXWorld;
          const dy = playerY - cluster.positionYWorld;
          // Rotate into lunge frame
          const localFwd  = dx * lx + dy * ly;
          const localPerp = dx * (-ly) + dy * lx;
          if (Math.abs(localFwd) <= DBM_SHARD_RUSH_HIT_HALF_H + player.halfWidthWorld
              && Math.abs(localPerp) <= DBM_SHARD_RUSH_HIT_HALF_W + player.halfWidthWorld) {
            applyPlayerDamageWithKnockback(player, DBM_SHARD_RUSH_DAMAGE,
              cluster.positionXWorld, cluster.positionYWorld);
            player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, DBM_SHARD_RUSH_IFRAMES_TICKS);
            cluster.dustBlockMimicLungeHitPlayerFlag = 1;
          }
        }
      }

      // End lunge when distance covered
      if (cluster.dustBlockMimicLungeDistCovered >= DBM_SHARD_RUSH_DISTANCE_WORLD) {
        cluster.dustBlockMimicState = DBM_STATE_RECOVER;
        cluster.dustBlockMimicStateTicks = 0;
        // Slight overshoot velocity dampens naturally during recover
        cluster.velocityXWorld = lx * DBM_SHARD_RUSH_SPEED * 0.5;
        cluster.velocityYWorld = ly * DBM_SHARD_RUSH_SPEED * 0.5;
      }
      continue;
    }

    // ── Recover ────────────────────────────────────────────────────────────
    if (state === DBM_STATE_RECOVER) {
      // Drift back toward spawn
      cluster.velocityXWorld *= 0.92;
      cluster.velocityYWorld *= 0.92;
      const toSpawnX2 = spawnX - cluster.positionXWorld;
      const toSpawnY2 = spawnY - cluster.positionYWorld;
      const distToSpawn2 = Math.sqrt(toSpawnX2 * toSpawnX2 + toSpawnY2 * toSpawnY2);
      if (distToSpawn2 > 1.0) {
        const blend = Math.min(0.015, distToSpawn2 / DBM_LEASH_RADIUS_WORLD) * 0.5;
        cluster.velocityXWorld += toSpawnX2 * blend;
        cluster.velocityYWorld += toSpawnY2 * blend;
      }
      cluster.positionXWorld += cluster.velocityXWorld;
      cluster.positionYWorld += cluster.velocityYWorld;

      // Motes relax toward formation
      _applyFormationTargets(world, slot, isLarge, _halfW(isLarge) * 0.85, _halfH(isLarge) * 0.85);
      for (let m = 0; m < moteCount; m++) {
        const idx = base + m;
        const tx = cluster.positionXWorld + world.dbmMoteTargetLocalX[idx];
        const ty = cluster.positionYWorld + world.dbmMoteTargetLocalY[idx];
        world.dbmMoteVelXWorld[idx] = (world.dbmMoteVelXWorld[idx] + (tx - world.dbmMoteXWorld[idx]) * DBM_MOTE_SPRING_BLEND) * 0.85;
        world.dbmMoteVelYWorld[idx] = (world.dbmMoteVelYWorld[idx] + (ty - world.dbmMoteYWorld[idx]) * DBM_MOTE_SPRING_BLEND) * 0.85;
        world.dbmMoteXWorld[idx] += world.dbmMoteVelXWorld[idx];
        world.dbmMoteYWorld[idx] += world.dbmMoteVelYWorld[idx];
        world.dbmMotePulsePhaseRad[idx] += DBM_MOTE_PULSE_FREQ_RAD_PER_TICK;
      }

      if (stateTicks >= DBM_RECOVER_DURATION_TICKS) {
        cluster.dustBlockMimicAttackCooldownTicks = DBM_ATTACK_COOLDOWN_TICKS;
        cluster.dustBlockMimicState = DBM_STATE_ACTIVE;
        cluster.dustBlockMimicStateTicks = 0;
      }
      continue;
    }
  }
}

// ── Player hit detection (called from combat/weave systems) ──────────────────

/**
 * Test whether a hit at (hitX, hitY) lands on the Dust Block Mimic and apply
 * damage appropriately.  Returns true if the hit was registered.
 */
export function applyDustBlockMimicHit(
  world: WorldState,
  clusterIndex: number,
  hitX: number,
  hitY: number,
  damage: number,
): boolean {
  const cluster = world.clusters[clusterIndex];
  if (!cluster || cluster.isDustBlockMimicFlag !== 1) return false;
  if (cluster.isAliveFlag === 0) return false;

  const state = cluster.dustBlockMimicState;
  const cx = cluster.positionXWorld;
  const cy = cluster.positionYWorld;
  const isLarge = cluster.isDustBlockMimicLargeFlag;
  const slot = cluster.dustBlockMimicSlotIndex;
  const base = _moteBase(slot);

  if (state === DBM_STATE_DORMANT) {
    // Dormant: AABB check on block hitbox
    const hw = _halfW(isLarge);
    const hh = _halfH(isLarge);
    if (Math.abs(hitX - cx) <= hw + 4 && Math.abs(hitY - cy) <= hh + 4) {
      cluster.healthPoints -= damage;
      if (cluster.healthPoints <= 0) {
        cluster.healthPoints = 0;
        cluster.isAliveFlag = 0;
        cluster.dustBlockMimicState = DBM_STATE_DYING;
        cluster.dustBlockMimicStateTicks = 0;
      } else {
        // Wake on hit even if not in range
        cluster.dustBlockMimicState = DBM_STATE_WAKE;
        cluster.dustBlockMimicStateTicks = 0;
        cluster.dustBlockMimicHitFlashTicks = DBM_HIT_FLASH_TICKS;
      }
      return true;
    }
    return false;
  }

  // Active: forgiving circular hitbox
  const dx = hitX - cx;
  const dy = hitY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const hitRadius = DBM_ACTIVE_HITBOX_RADIUS + 6;
  if (dist <= hitRadius) {
    cluster.healthPoints -= damage;
    cluster.dustBlockMimicHitFlashTicks = DBM_HIT_FLASH_TICKS;

    // Scatter motes on hit
    const moteCount = _moteCount(isLarge);
    for (let m = 0; m < moteCount; m++) {
      const angle = ((m / moteCount) * Math.PI * 2) + nextFloatRange(world.rng, -Math.PI, Math.PI);
      world.dbmMoteVelXWorld[base + m] += Math.cos(angle) * DBM_HIT_SCATTER_SPEED;
      world.dbmMoteVelYWorld[base + m] += Math.sin(angle) * DBM_HIT_SCATTER_SPEED;
    }

    if (cluster.healthPoints <= 0) {
      cluster.healthPoints = 0;
      cluster.isAliveFlag = 0;
      cluster.dustBlockMimicState = DBM_STATE_DYING;
      cluster.dustBlockMimicStateTicks = 0;
    }
    return true;
  }
  return false;
}
