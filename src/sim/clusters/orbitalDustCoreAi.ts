/**
 * Orbital Dust Core — AI state machine.
 *
 * States:
 *   0 = idle    — drifting near spawn; motes orbit slowly
 *   1 = active  — player in range; normal orbit + attack cooldown
 *   2 = charge  — Gravity Pulse telegraph; motes tighten inward; core brightens
 *   3 = pulse   — pulse ring expands outward
 *   4 = recover — post-pulse cooldown
 *   5 = dying   — core collapse + burst
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState, MAX_ORBITAL_DUST_CORES, MOTES_PER_ODC_SLOT } from '../world';
import { MAX_PARTICLES } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { getElementProfile } from '../particles/elementProfiles';
import { ParticleKind } from '../particles/kinds';
import {
  ODC_SMALL_RING_COUNT,
  ODC_LARGE_RING_COUNT,
  ODC_SMALL_MOTES_PER_RING,
  ODC_LARGE_MOTES_PER_RING,
  ODC_SMALL_RING_RADII,
  ODC_LARGE_RING_RADII,
  ODC_SMALL_RING_ANG_VEL,
  ODC_LARGE_RING_ANG_VEL,
  ODC_RING_HIT_BAND_THICKNESS_WORLD,
  ODC_CORE_HIT_RADIUS_WORLD,
  ODC_LEASH_RADIUS_WORLD,
  ODC_BOB_AMPLITUDE_WORLD,
  ODC_BOB_FREQ_RAD_PER_TICK,
  ODC_ACTIVATION_RANGE_WORLD,
  ODC_MOTE_PULSE_FREQ_RAD_PER_TICK,
  ODC_MOTE_RADIUS_BLEND,
  ODC_COLLAPSE_CORE_PULSE_TICKS,
  ODC_ATTACK_COOLDOWN_TICKS,
  ODC_CHARGE_DURATION_TICKS,
  ODC_CHARGE_TIGHTEN_FRACTION,
  ODC_PULSE_DURATION_TICKS,
  ODC_PULSE_MAX_RADIUS_WORLD,
  ODC_PULSE_MAX_RADIUS_SMALL_WORLD,
  ODC_PULSE_THICKNESS_WORLD,
  ODC_PULSE_DAMAGE,
  ODC_PULSE_IFRAMES_TICKS,
  ODC_RECOVER_DURATION_TICKS,
  ODC_SHIELD_FLASH_TICKS,
  MAX_MOTES_PER_RING_ODC,
} from './orbitalDustCoreConfig';

// ── State identifiers ──────────────────────────────────────────────────────
export const ODC_STATE_IDLE    = 0;
export const ODC_STATE_ACTIVE  = 1;
export const ODC_STATE_CHARGE  = 2;
export const ODC_STATE_PULSE   = 3;
export const ODC_STATE_RECOVER = 4;
export const ODC_STATE_DYING   = 5;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Ring count for this variant. */
function _ringCount(isLarge: 0 | 1): number {
  return isLarge === 1 ? ODC_LARGE_RING_COUNT : ODC_SMALL_RING_COUNT;
}

/** Motes-per-ring array for this variant. */
function _motesPerRing(isLarge: 0 | 1): readonly number[] {
  return isLarge === 1 ? ODC_LARGE_MOTES_PER_RING : ODC_SMALL_MOTES_PER_RING;
}

/** Base radii for this variant. */
function _ringRadii(isLarge: 0 | 1): readonly number[] {
  return isLarge === 1 ? ODC_LARGE_RING_RADII : ODC_SMALL_RING_RADII;
}

/** Angular velocities for this variant. */
function _ringAngVel(isLarge: 0 | 1): readonly number[] {
  return isLarge === 1 ? ODC_LARGE_RING_ANG_VEL : ODC_SMALL_RING_ANG_VEL;
}

/** Flat index into world mote arrays: [slotIndex * MOTES_PER_ODC_SLOT + ring * MAX + mote]. */
function _moteIdx(slot: number, ring: number, mote: number): number {
  return slot * MOTES_PER_ODC_SLOT + ring * MAX_MOTES_PER_RING_ODC + mote;
}

/** Read per-ring health from the four scalar fields. Returns -1 for out-of-range rings. */
function _getRingHealth(cluster: WorldState['clusters'][number], ring: number): number {
  if (ring === 0) return cluster.orbitalDustCoreRing0Health;
  if (ring === 1) return cluster.orbitalDustCoreRing1Health;
  if (ring === 2) return cluster.orbitalDustCoreRing2Health;
  if (ring === 3) return cluster.orbitalDustCoreRing3Health;
  return -1;
}

/** Write per-ring health to the four scalar fields. */
function _setRingHealth(cluster: WorldState['clusters'][number], ring: number, value: number): void {
  if (ring === 0) { cluster.orbitalDustCoreRing0Health = value; return; }
  if (ring === 1) { cluster.orbitalDustCoreRing1Health = value; return; }
  if (ring === 2) { cluster.orbitalDustCoreRing2Health = value; return; }
  if (ring === 3) { cluster.orbitalDustCoreRing3Health = value; }
}

/**
 * Compute the current target radius for mote [ring, mote] in world units,
 * accounting for the exposed-ring shift and charge tighten.
 */
function _targetRadius(
  isLarge: 0 | 1,
  ring: number,
  exposedRing: number,
  chargeProgress: number, // 0..1, 0 = no tighten
): number {
  const radii = _ringRadii(isLarge);
  const ringCount = _ringCount(isLarge);
  // Rings with index < exposedRing have been destroyed; surviving rings
  // shift outward to fill the gap: each destroyed outer ring adds one step.
  const effectiveRingIndex = Math.min(ring, ringCount - 1);
  const shift = exposedRing > 0 ? (exposedRing * 8) : 0; // 8 px per destroyed ring
  let r = radii[effectiveRingIndex] + shift;
  if (ring < exposedRing) {
    // This ring has been destroyed; target = 0 (collapsed)
    return 0;
  }
  // During charge, tighten inward slightly
  r *= (1.0 - chargeProgress * ODC_CHARGE_TIGHTEN_FRACTION);
  return r;
}

/**
 * Emit a burst of particles from a world position.
 * Used for mote-death and core-death effects.
 */
function _emitBurst(
  world: WorldState,
  x: number,
  y: number,
  count: number,
  speed: number,
  rngSeed: number,
): void {
  const profile = getElementProfile(ParticleKind.Physical);
  for (let i = 0; i < count; i++) {
    if (world.particleCount >= MAX_PARTICLES) break;
    const idx = world.particleCount++;
    // Deterministic angle using noise
    const angle = ((rngSeed * 2654435761 + i * 1234567) >>> 0) / 0xffffffff * Math.PI * 2;
    const spd = speed * (0.5 + ((rngSeed ^ (i * 987654)) >>> 0) / 0xffffffff * 0.8);
    world.positionXWorld[idx] = x;
    world.positionYWorld[idx] = y;
    world.velocityXWorld[idx] = Math.cos(angle) * spd;
    world.velocityYWorld[idx] = Math.sin(angle) * spd - 0.5;
    world.forceX[idx] = 0;
    world.forceY[idx] = 0;
    world.massKg[idx] = profile.massKg;
    world.chargeUnits[idx] = 0;
    world.isAliveFlag[idx] = 1;
    world.kindBuffer[idx] = ParticleKind.Physical;
    world.ownerEntityId[idx] = -1;
    world.anchorAngleRad[idx] = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.lifetimeTicks[idx] = 40 + ((rngSeed ^ (i * 314159)) & 0x1f);
    world.ageTicks[idx] = 0;
    world.noiseTickSeed[idx] = (rngSeed ^ (i * 2654435761)) >>> 0;
    world.behaviorMode[idx] = 0;
    world.particleDurability[idx] = profile.toughness;
    world.respawnDelayTicks[idx] = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.isTransientFlag[idx] = 1;
    world.weaveSlotId[idx] = 0;
  }
}

/** Kill a mote: mark it dead and emit a small dust burst. */
function _killMote(world: WorldState, slot: number, ring: number, mote: number, cx: number, cy: number): void {
  const idx = _moteIdx(slot, ring, mote);
  world.odcMoteAliveFlag[idx] = 0;
  const angle = world.odcMoteAngleRad[idx];
  const r     = world.odcMoteRadiusWorld[idx];
  const mx = cx + Math.cos(angle) * r;
  const my = cy + Math.sin(angle) * r;
  _emitBurst(world, mx, my, 3, 1.5, (slot * 100 + ring * 10 + mote) * 7919);
}

// ── Main AI update ─────────────────────────────────────────────────────────

export function applyOrbitalDustCoreAI(world: WorldState): void {
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
    if (cluster.isOrbitalDustCoreFlag !== 1) continue;

    const slot      = cluster.orbitalDustCoreSlotIndex;
    if (slot < 0 || slot >= MAX_ORBITAL_DUST_CORES) continue;

    const isLarge   = cluster.isOrbitalDustCoreLargeFlag;
    const ringCount = _ringCount(isLarge);
    const mprArr    = _motesPerRing(isLarge);
    const angVelArr = _ringAngVel(isLarge);

    // ── Dead state — core collapse / burst ─────────────────────────────────
    if (cluster.isAliveFlag === 0) {
      const t = cluster.orbitalDustCoreStateTicks;
      if (t === 0) {
        // Emit big death burst
        _emitBurst(world, cluster.positionXWorld, cluster.positionYWorld, 24, 3.0, slot * 31337);
        // Kill all remaining motes
        for (let r = 0; r < ringCount; r++) {
          const mpr = mprArr[r];
          for (let m = 0; m < mpr; m++) {
            const midx = _moteIdx(slot, r, m);
            if (world.odcMoteAliveFlag[midx] === 1) {
              _killMote(world, slot, r, m, cluster.positionXWorld, cluster.positionYWorld);
            }
          }
        }
      }
      cluster.orbitalDustCoreStateTicks++;
      // Pulse radius fades after death
      cluster.orbitalDustCorePulseActiveFlag = 0;
      cluster.orbitalDustCorePulseRadius = 0;
      continue;
    }

    // ── Tick counters ───────────────────────────────────────────────────────
    cluster.orbitalDustCoreStateTicks++;
    const stateTicks = cluster.orbitalDustCoreStateTicks;
    const state      = cluster.orbitalDustCoreState;
    const exposedRing = cluster.orbitalDustCoreExposedRing;

    // ── Bob + leash ─────────────────────────────────────────────────────────
    cluster.orbitalDustCoreBobPhaseRad += ODC_BOB_FREQ_RAD_PER_TICK;
    const spawnX = cluster.orbitalDustCoreSpawnXWorld;
    const spawnY = cluster.orbitalDustCoreSpawnYWorld;
    const bobY   = Math.sin(cluster.orbitalDustCoreBobPhaseRad) * ODC_BOB_AMPLITUDE_WORLD;
    const toSpawnX = spawnX - cluster.positionXWorld;
    const toSpawnY = (spawnY + bobY) - cluster.positionYWorld;
    const distToSpawn = Math.sqrt(toSpawnX * toSpawnX + toSpawnY * toSpawnY);
    if (distToSpawn > 1.0) {
      const leashBlend = Math.min(0.02, distToSpawn / ODC_LEASH_RADIUS_WORLD) * 0.5;
      cluster.velocityXWorld = (cluster.velocityXWorld + toSpawnX * leashBlend) * 0.95;
      cluster.velocityYWorld = (cluster.velocityYWorld + toSpawnY * leashBlend) * 0.95;
    } else {
      cluster.velocityXWorld *= 0.95;
      cluster.velocityYWorld *= 0.95;
    }
    cluster.positionXWorld += cluster.velocityXWorld;
    cluster.positionYWorld += cluster.velocityYWorld;

    const cx = cluster.positionXWorld;
    const cy = cluster.positionYWorld;

    // ── Charge progress factor (0..1) ───────────────────────────────────────
    let chargeProgress = 0.0;
    if (state === ODC_STATE_CHARGE) {
      chargeProgress = Math.min(1.0, stateTicks / ODC_CHARGE_DURATION_TICKS);
    }

    // ── Per-ring mote orbit simulation ──────────────────────────────────────
    for (let r = 0; r < ringCount; r++) {
      const mpr = mprArr[r];
      const angVel = angVelArr[r];
      const targetR = _targetRadius(isLarge, r, exposedRing, chargeProgress);
      for (let m = 0; m < mpr; m++) {
        const idx = _moteIdx(slot, r, m);
        if (world.odcMoteAliveFlag[idx] === 0) continue;

        // Advance angle
        world.odcMoteAngleRad[idx] += angVel;

        // Advance pulse phase
        world.odcMotePulsePhaseRad[idx] += ODC_MOTE_PULSE_FREQ_RAD_PER_TICK;

        // Smooth radius towards target (transitions after ring collapse or charge)
        const curR = world.odcMoteRadiusWorld[idx];
        if (Math.abs(curR - targetR) > 0.1) {
          world.odcMoteRadiusWorld[idx] = curR + (targetR - curR) * ODC_MOTE_RADIUS_BLEND;
        }
      }
    }

    // ── Shield flash decay ──────────────────────────────────────────────────
    if (cluster.orbitalDustCoreShieldFlashTicks > 0) {
      cluster.orbitalDustCoreShieldFlashTicks--;
    }
    if (cluster.orbitalDustCoreCorePulseTicks > 0) {
      cluster.orbitalDustCoreCorePulseTicks--;
    }

    // ── Activation ─────────────────────────────────────────────────────────
    if (state === ODC_STATE_IDLE) {
      if (playerFound) {
        const dx = playerX - cx;
        const dy = playerY - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq < ODC_ACTIVATION_RANGE_WORLD * ODC_ACTIVATION_RANGE_WORLD) {
          cluster.orbitalDustCoreState = ODC_STATE_ACTIVE;
          cluster.orbitalDustCoreStateTicks = 0;
          cluster.orbitalDustCoreAttackCooldownTicks = ODC_ATTACK_COOLDOWN_TICKS;
        }
      }
      continue;
    }

    // ── Attack cooldown tick ────────────────────────────────────────────────
    if (state === ODC_STATE_ACTIVE && cluster.orbitalDustCoreAttackCooldownTicks > 0) {
      cluster.orbitalDustCoreAttackCooldownTicks--;
    }

    // ── State transitions ───────────────────────────────────────────────────
    if (state === ODC_STATE_ACTIVE) {
      if (cluster.orbitalDustCoreAttackCooldownTicks <= 0) {
        cluster.orbitalDustCoreState = ODC_STATE_CHARGE;
        cluster.orbitalDustCoreStateTicks = 0;
      }

    } else if (state === ODC_STATE_CHARGE) {
      if (stateTicks >= ODC_CHARGE_DURATION_TICKS) {
        // Launch pulse
        cluster.orbitalDustCorePulseRadius = 0;
        cluster.orbitalDustCorePulseActiveFlag = 1;
        cluster.orbitalDustCorePulseHitPlayerFlag = 0;
        cluster.orbitalDustCoreState = ODC_STATE_PULSE;
        cluster.orbitalDustCoreStateTicks = 0;
      }

    } else if (state === ODC_STATE_PULSE) {
      const maxR = isLarge === 1 ? ODC_PULSE_MAX_RADIUS_WORLD : ODC_PULSE_MAX_RADIUS_SMALL_WORLD;
      const expansion = (maxR / ODC_PULSE_DURATION_TICKS);
      cluster.orbitalDustCorePulseRadius += expansion;

      // Test player damage
      if (cluster.orbitalDustCorePulseHitPlayerFlag === 0 &&
          cluster.orbitalDustCorePulseActiveFlag === 1 &&
          playerFound && playerClusterIdx >= 0) {
        const player = world.clusters[playerClusterIdx];
        if (player.invulnerabilityTicks <= 0) {
          const dx = playerX - cx;
          const dy = playerY - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const inner = cluster.orbitalDustCorePulseRadius - ODC_PULSE_THICKNESS_WORLD;
          const outer = cluster.orbitalDustCorePulseRadius;
          if (dist >= inner && dist <= outer + player.halfWidthWorld) {
            applyPlayerDamageWithKnockback(player, ODC_PULSE_DAMAGE, cx, cy);
            player.invulnerabilityTicks = Math.max(player.invulnerabilityTicks, ODC_PULSE_IFRAMES_TICKS);
            cluster.orbitalDustCorePulseHitPlayerFlag = 1;
          }
        }
      }

      if (stateTicks >= ODC_PULSE_DURATION_TICKS) {
        cluster.orbitalDustCorePulseActiveFlag = 0;
        cluster.orbitalDustCorePulseRadius = 0;
        cluster.orbitalDustCoreState = ODC_STATE_RECOVER;
        cluster.orbitalDustCoreStateTicks = 0;
      }

    } else if (state === ODC_STATE_RECOVER) {
      if (stateTicks >= ODC_RECOVER_DURATION_TICKS) {
        cluster.orbitalDustCoreAttackCooldownTicks = ODC_ATTACK_COOLDOWN_TICKS;
        cluster.orbitalDustCoreState = ODC_STATE_ACTIVE;
        cluster.orbitalDustCoreStateTicks = 0;
      }
    }
  }
}

// ── Player hit detection (called from combat/weave systems) ─────────────────

/**
 * Test whether a hit at (hitX, hitY) from a weave or melee strike lands on
 * the ODC, and apply damage appropriately.
 *
 * Returns true if the hit was registered (even if blocked by a shield).
 */
export function applyODCHit(
  world: WorldState,
  clusterIndex: number,
  hitX: number,
  hitY: number,
  damage: number,
): boolean {
  const cluster = world.clusters[clusterIndex];
  if (!cluster || cluster.isOrbitalDustCoreFlag !== 1) return false;
  if (cluster.isAliveFlag === 0) return false;

  const cx = cluster.positionXWorld;
  const cy = cluster.positionYWorld;
  const isLarge   = cluster.isOrbitalDustCoreLargeFlag;
  const ringCount = _ringCount(isLarge);
  const radii     = _ringRadii(isLarge);
  const mprArr    = _motesPerRing(isLarge);
  const slot      = cluster.orbitalDustCoreSlotIndex;
  const exposedRing = cluster.orbitalDustCoreExposedRing;
  const coreVulnerable = exposedRing >= ringCount;

  const dx = hitX - cx;
  const dy = hitY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (!coreVulnerable) {
    // Check if hit lands in the exposed ring's hitbox band
    const exposedRadius = radii[Math.min(exposedRing, radii.length - 1)];
    const inner = exposedRadius - ODC_RING_HIT_BAND_THICKNESS_WORLD;
    const outer = exposedRadius + ODC_RING_HIT_BAND_THICKNESS_WORLD;

    if (dist >= Math.max(0, inner) && dist <= outer) {
      // Hit lands on the exposed ring
      const curHealth = _getRingHealth(cluster, exposedRing);
      const newHealth = curHealth - damage;
      _setRingHealth(cluster, exposedRing, newHealth);
      if (newHealth <= 0) {
        // Destroy all motes in this ring
        const mpr = mprArr[exposedRing];
        for (let m = 0; m < mpr; m++) {
          const idx = _moteIdx(slot, exposedRing, m);
          if (world.odcMoteAliveFlag[idx] === 1) {
            _killMote(world, slot, exposedRing, m, cx, cy);
          }
        }
        // Advance exposed ring
        cluster.orbitalDustCoreExposedRing = exposedRing + 1;
        cluster.orbitalDustCoreCorePulseTicks = ODC_COLLAPSE_CORE_PULSE_TICKS;
        // Initialize next ring health (already set from spawn, nothing to do)
      }
      return true;
    } else {
      // Hit didn't land on the right ring — shield flash
      cluster.orbitalDustCoreShieldFlashTicks = ODC_SHIELD_FLASH_TICKS;
      return true;
    }
  } else {
    // Core is vulnerable — check core hitbox
    if (dist <= ODC_CORE_HIT_RADIUS_WORLD + 4) {
      cluster.healthPoints -= damage;
      if (cluster.healthPoints <= 0) {
        cluster.healthPoints = 0;
        cluster.isAliveFlag = 0;
        cluster.orbitalDustCoreState = ODC_STATE_DYING;
        cluster.orbitalDustCoreStateTicks = 0;
      }
      return true;
    } else {
      // Miss — no feedback needed
      return false;
    }
  }
}
