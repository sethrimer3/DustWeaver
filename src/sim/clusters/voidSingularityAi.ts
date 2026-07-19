/**
 * Void Singularity — AI state machine.
 *
 * States:
 *   0 = idle        — subtle spin, no pull; waits for player activation
 *   1 = activePull  — pull field active; absorbing energy passively; motes spiral in
 *   2 = chargePulse — compressing; event horizon brightens; pull intensifies
 *   3 = collapsePulse — expanding damage ring; only damages during active window
 *   4 = recover     — pull weakens; cooldown; motes re-expand
 *   5 = dying       — core contracts then vanishes
 *
 * Void Singularity Pair adds:
 *   - Shared absorbed-energy counter charges the white hole.
 *   - White hole erupts with radial projectiles when charged.
 *   - Both nodes orbit a shared midpoint.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState, MAX_PARTICLES } from '../world';
import { nextFloat } from '../rng';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { tryBlockHostileProjectile } from '../stormweave/shieldWeave';
import { ParticleKind } from '../particles/kinds';
import {
  VS_ACTIVATION_RANGE_WORLD,
  VS_LEASH_RADIUS_WORLD,
  VS_HOVER_SPEED,
  VS_VELOCITY_DRAG,
  VS_BOB_FREQ_RAD_PER_TICK,
  VS_PULL_RADIUS_WORLD,
  VS_PULL_STRENGTH,
  VS_MAX_PULL_FORCE,
  VS_ABSORPTION_RADIUS_WORLD,
  VS_PASSIVE_CHARGE_PER_TICK,
  VS_IDLE_SETTLE_TICKS,
  VS_CHARGE_PULSE_TICKS,
  VS_COLLAPSE_PULSE_TICKS,
  VS_RECOVER_TICKS,
  VS_PULSE_TRIGGER_ENERGY,
  VS_DEATH_DURATION_TICKS,
  VS_PULSE_MAX_RADIUS_WORLD,
  VS_PULSE_DAMAGE,
  VS_CONTACT_RADIUS_WORLD,
  VS_CONTACT_DAMAGE,
  VS_MOTE_START_RADIUS_WORLD,
  VS_MOTE_MIN_RADIUS_WORLD,
  VS_MOTE_ANG_VEL_RAD_PER_TICK,
  VS_MOTE_IDLE_SPIRAL_SPEED,
  VS_MOTE_ACTIVE_SPIRAL_SPEED,
  VS_MOTE_CHARGE_SPIRAL_SPEED,
  VS_MOTE_PULSE_FREQ_RAD_PER_TICK,
  VS_HIT_FLASH_TICKS,
  VSP_NODE_DISTANCE_WORLD,
  VSP_ORBIT_SPEED_RAD_PER_TICK,
  VSP_CHARGE_THRESHOLD,
  VSP_ERUPTION_CHARGE_TICKS,
  VSP_ERUPTION_ACTIVE_TICKS,
  VSP_ERUPTION_COOLDOWN_TICKS,
  VSP_ERUPTION_PROJ_COUNT,
  VSP_PROJ_SPEED_WORLD,
  VSP_PROJ_LIFETIME_TICKS,
  VSP_PROJ_HIT_RADIUS_WORLD,
  VSP_PROJ_DAMAGE,
  MAX_MOTES_PER_VS,
  MAX_PROJS_PER_VSP,
} from './voidSingularityConfig';

// ── State identifiers ─────────────────────────────────────────────────────────

export const VS_STATE_IDLE           = 0;
export const VS_STATE_ACTIVE_PULL    = 1;
export const VS_STATE_CHARGE_PULSE   = 2;
export const VS_STATE_COLLAPSE_PULSE = 3;
export const VS_STATE_RECOVER        = 4;
export const VS_STATE_DYING          = 5;

// ── White hole state identifiers ──────────────────────────────────────────────

export const VSP_WH_STATE_IDLE     = 0;
export const VSP_WH_STATE_CHARGING = 1;
export const VSP_WH_STATE_ERUPTING = 2;
export const VSP_WH_STATE_COOLDOWN = 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Emit a small burst of void-like particles on death. */
function _emitDeathBurst(world: WorldState, cx: number, cy: number): void {
  const count = 6;
  let spawned = 0;
  for (let pi = 0; pi < MAX_PARTICLES && spawned < count; pi++) {
    if (world.isAliveFlag[pi] === 1) continue;
    const angle = (spawned / count) * Math.PI * 2 + nextFloat(world.rng) * 0.5;
    const speed = 1.2 + nextFloat(world.rng) * 2.2;
    world.positionXWorld[pi] = cx;
    world.positionYWorld[pi] = cy;
    world.velocityXWorld[pi] = Math.cos(angle) * speed;
    world.velocityYWorld[pi] = Math.sin(angle) * speed;
    world.kindBuffer[pi]     = ParticleKind.Golden;
    world.isAliveFlag[pi]    = 1;
    world.ageTicks[pi]       = 0;
    world.lifetimeTicks[pi]  = 20 + Math.floor(nextFloat(world.rng) * 14);
    world.ownerEntityId[pi]  = -1;
    spawned++;
  }
}

/** Emit white-hole eruption projectiles for a VSP slot. */
function _spawnEruptionProjectiles(
  world: WorldState,
  slotIndex: number,
  whCenterX: number,
  whCenterY: number,
  playerX: number,
  playerY: number,
): void {
  const base = slotIndex * MAX_PROJS_PER_VSP;
  // Use aimed-at-player fan: center direction toward player, spread projectiles evenly.
  const baseAngle = Math.atan2(playerY - whCenterY, playerX - whCenterX);
  const spreadRad = Math.PI * 2; // full radial burst
  const count = VSP_ERUPTION_PROJ_COUNT;

  for (let p = 0; p < count; p++) {
    const idx = base + p;
    const angle = baseAngle + (p / count) * spreadRad;
    world.vspProjXWorld[idx]         = whCenterX;
    world.vspProjYWorld[idx]         = whCenterY;
    world.vspProjVelXWorld[idx]      = Math.cos(angle) * VSP_PROJ_SPEED_WORLD;
    world.vspProjVelYWorld[idx]      = Math.sin(angle) * VSP_PROJ_SPEED_WORLD;
    world.vspProjLifetimeTicks[idx]  = VSP_PROJ_LIFETIME_TICKS;
    world.vspProjAliveFlag[idx]      = 1;
  }
}

// ── Per-Void-Singularity tick ─────────────────────────────────────────────────

function _tickVoidSingularity(world: WorldState, ci: number): void {
  const cluster = world.clusters[ci];
  if (cluster.isVoidSingularityFlag !== 1) return;
  if (cluster.isAliveFlag === 0) return;

  const slot      = cluster.voidSingularitySlotIndex;
  const isPair    = cluster.isVoidSingularityPairFlag === 1;
  const moteBase  = slot >= 0 ? slot * MAX_MOTES_PER_VS : -1;

  // ── Death detection ────────────────────────────────────────────────────────
  if (cluster.healthPoints <= 0 && cluster.voidSingularityState !== VS_STATE_DYING) {
    cluster.voidSingularityState      = VS_STATE_DYING;
    cluster.voidSingularityStateTicks = 0;
    _emitDeathBurst(world, cluster.positionXWorld, cluster.positionYWorld);
    if (isPair) {
      // White hole flares outward on death — emit from its center too.
      const whX = cluster.positionXWorld + Math.cos(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      const whY = cluster.positionYWorld + Math.sin(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
      _emitDeathBurst(world, whX, whY);
      // Clear all pair projectiles.
      if (slot >= 0) {
        const base = slot * MAX_PROJS_PER_VSP;
        for (let p = 0; p < MAX_PROJS_PER_VSP; p++) {
          world.vspProjAliveFlag[base + p] = 0;
        }
      }
    }
  }

  // ── Hit flash countdown ────────────────────────────────────────────────────
  if (cluster.voidSingularityHitFlashTicks > 0) {
    cluster.voidSingularityHitFlashTicks--;
  }

  // Detect hit: set flash when invulnerability was recently granted to the
  // enemy (proxy: healthPoints changed — we track with prevHP-style check).
  // DWA pattern: skip per-frame detection; rely on forces.ts decrement.
  // Here we check if HP decreased by tracking it via the hit flash field:
  // forces.ts decrements HP; we set hitFlash from within the AI when we
  // detect hurtTicks > 0 (hurtTicks is set on enemies when hit).
  if (cluster.hurtTicks > 0) {
    cluster.voidSingularityHitFlashTicks = VS_HIT_FLASH_TICKS;
  }

  const state      = cluster.voidSingularityState;
  const stateTicks = cluster.voidSingularityStateTicks;

  // ── Find player cluster ────────────────────────────────────────────────────
  let playerX = cluster.voidSingularitySpawnXWorld;
  let playerY = cluster.voidSingularitySpawnYWorld;
  let playerCluster: typeof world.clusters[0] | undefined;
  for (let k = 0; k < world.clusters.length; k++) {
    if (world.clusters[k].isPlayerFlag === 1 && world.clusters[k].isAliveFlag === 1) {
      playerCluster = world.clusters[k];
      playerX = playerCluster.positionXWorld;
      playerY = playerCluster.positionYWorld;
      break;
    }
  }

  const spawnX = cluster.voidSingularitySpawnXWorld;
  const spawnY = cluster.voidSingularitySpawnYWorld;

  // ── Bob phase ──────────────────────────────────────────────────────────────
  cluster.voidSingularityBobPhaseRad =
    (cluster.voidSingularityBobPhaseRad + VS_BOB_FREQ_RAD_PER_TICK) % (Math.PI * 2);

  // ── Pair orbit phase ───────────────────────────────────────────────────────
  if (isPair) {
    cluster.voidSingularityPairAngleRad =
      (cluster.voidSingularityPairAngleRad + VSP_ORBIT_SPEED_RAD_PER_TICK) % (Math.PI * 2);
  }

  // ── Mote update ───────────────────────────────────────────────────────────
  if (moteBase >= 0) {
    // Choose spiral speed based on state.
    let spiralSpeed = VS_MOTE_IDLE_SPIRAL_SPEED;
    if (state === VS_STATE_ACTIVE_PULL) spiralSpeed = VS_MOTE_ACTIVE_SPIRAL_SPEED;
    if (state === VS_STATE_CHARGE_PULSE) spiralSpeed = VS_MOTE_CHARGE_SPIRAL_SPEED;

    for (let m = 0; m < MAX_MOTES_PER_VS; m++) {
      const mi = moteBase + m;
      // Advance angle (clockwise spiral).
      world.vsMoteAngleRad[mi] =
        (world.vsMoteAngleRad[mi] + VS_MOTE_ANG_VEL_RAD_PER_TICK + Math.PI * 2) % (Math.PI * 2);
      // Advance pulse phase.
      world.vsMotePulsePhaseRad[mi] =
        (world.vsMotePulsePhaseRad[mi] + VS_MOTE_PULSE_FREQ_RAD_PER_TICK) % (Math.PI * 2);
      // Spiral inward.
      world.vsMoteRadiusWorld[mi] -= spiralSpeed;
      // Reset when absorbed.
      if (world.vsMoteRadiusWorld[mi] < VS_MOTE_MIN_RADIUS_WORLD) {
        world.vsMoteRadiusWorld[mi] = VS_MOTE_START_RADIUS_WORLD + nextFloat(world.rng) * 8.0;
      }
      // In dying / recover: expand motes back outward.
      if (state === VS_STATE_RECOVER || state === VS_STATE_DYING) {
        world.vsMoteRadiusWorld[mi] += spiralSpeed * 1.8;
        if (world.vsMoteRadiusWorld[mi] > VS_MOTE_START_RADIUS_WORLD + 10.0) {
          world.vsMoteRadiusWorld[mi] = VS_MOTE_START_RADIUS_WORLD + 10.0;
        }
      }
    }
  }

  // ── State machine ──────────────────────────────────────────────────────────

  switch (state) {

    // ── Idle ──────────────────────────────────────────────────────────────────
    case VS_STATE_IDLE: {
      // Hover back toward spawn.
      const dsx = spawnX - cluster.positionXWorld;
      const dsy = spawnY - cluster.positionYWorld;
      const dist2 = dsx * dsx + dsy * dsy;
      if (dist2 > 4) {
        const dist = Math.sqrt(dist2);
        const t = Math.min(VS_HOVER_SPEED / dist, 0.04);
        cluster.velocityXWorld += dsx * t;
        cluster.velocityYWorld += dsy * t;
      }
      cluster.velocityXWorld *= VS_VELOCITY_DRAG;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG;

      // Wait out settle time.
      if (stateTicks < VS_IDLE_SETTLE_TICKS) {
        cluster.voidSingularityStateTicks++;
        break;
      }

      // Activate when player enters range.
      const dpx = playerX - cluster.positionXWorld;
      const dpy = playerY - cluster.positionYWorld;
      const d2  = dpx * dpx + dpy * dpy;
      if (d2 <= VS_ACTIVATION_RANGE_WORLD * VS_ACTIVATION_RANGE_WORLD) {
        cluster.voidSingularityState      = VS_STATE_ACTIVE_PULL;
        cluster.voidSingularityStateTicks = 0;
        cluster.voidSingularityAbsorbedEnergy = 0;
        break;
      }
      cluster.voidSingularityStateTicks++;
      break;
    }

    // ── Active Pull ───────────────────────────────────────────────────────────
    case VS_STATE_ACTIVE_PULL: {
      // Slowly drift toward player (leashed).
      const dpx = playerX - cluster.positionXWorld;
      const dpy = playerY - cluster.positionYWorld;
      const dpDist = Math.sqrt(dpx * dpx + dpy * dpy) + 0.001;
      if (dpDist > 30) {
        const t = Math.min(VS_HOVER_SPEED / dpDist, 0.025);
        cluster.velocityXWorld += dpx * t;
        cluster.velocityYWorld += dpy * t;
      }
      cluster.velocityXWorld *= VS_VELOCITY_DRAG;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG;

      // Apply pull force to player.
      if (playerCluster !== undefined) {
        const prx = cluster.positionXWorld - playerX;
        const pry = cluster.positionYWorld - playerY;
        const prDist = Math.sqrt(prx * prx + pry * pry) + 0.001;
        if (prDist < VS_PULL_RADIUS_WORLD) {
          // Pull ramps up closer to center: linear ramp.
          const ramp = 1.0 - prDist / VS_PULL_RADIUS_WORLD;
          const pullForce = Math.min(VS_PULL_STRENGTH * ramp, VS_MAX_PULL_FORCE);
          playerCluster.velocityXWorld += (prx / prDist) * pullForce;
          playerCluster.velocityYWorld += (pry / prDist) * pullForce;
        }

        // Contact damage if player overlaps the core.
        const cx2 = prx * prx + pry * pry;
        if (cx2 < VS_CONTACT_RADIUS_WORLD * VS_CONTACT_RADIUS_WORLD) {
          applyPlayerDamageWithKnockback(
            playerCluster,
            VS_CONTACT_DAMAGE,
            cluster.positionXWorld,
            cluster.positionYWorld,
          );
        }
      }

      // Passively charge absorbed energy.
      cluster.voidSingularityAbsorbedEnergy += VS_PASSIVE_CHARGE_PER_TICK;

      // Absorb nearby world-owned particles.
      const absorb2 = VS_ABSORPTION_RADIUS_WORLD * VS_ABSORPTION_RADIUS_WORLD;
      for (let pi = 0; pi < MAX_PARTICLES; pi++) {
        if (world.isAliveFlag[pi] === 0) continue;
        if (world.ownerEntityId[pi] !== -1) continue; // only unowned particles
        const axdx = world.positionXWorld[pi] - cluster.positionXWorld;
        const axdy = world.positionYWorld[pi] - cluster.positionYWorld;
        if (axdx * axdx + axdy * axdy < absorb2) {
          world.isAliveFlag[pi] = 0;
          cluster.voidSingularityAbsorbedEnergy += 1;
          // TODO: If ParticleKind.Void is added, detect it here and subtract
          //       energy / damage the singularity instead of charging it.
        }
      }

      cluster.voidSingularityStateTicks++;

      // Transition to ChargePulse when enough energy.
      if (cluster.voidSingularityAbsorbedEnergy >= VS_PULSE_TRIGGER_ENERGY) {
        cluster.voidSingularityState      = VS_STATE_CHARGE_PULSE;
        cluster.voidSingularityStateTicks = 0;
      }

      // Deactivate if player leaves range.
      const dpxD = playerX - cluster.positionXWorld;
      const dpyD = playerY - cluster.positionYWorld;
      if (dpxD * dpxD + dpyD * dpyD > VS_ACTIVATION_RANGE_WORLD * VS_ACTIVATION_RANGE_WORLD * 1.5) {
        cluster.voidSingularityState      = VS_STATE_IDLE;
        cluster.voidSingularityStateTicks = 0;
        cluster.voidSingularityAbsorbedEnergy = 0;
      }
      break;
    }

    // ── Charge Pulse ──────────────────────────────────────────────────────────
    case VS_STATE_CHARGE_PULSE: {
      // Hover in place with dampened movement.
      cluster.velocityXWorld *= VS_VELOCITY_DRAG * 0.9;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG * 0.9;

      // Apply strong pull during charge.
      if (playerCluster !== undefined) {
        const prx = cluster.positionXWorld - playerX;
        const pry = cluster.positionYWorld - playerY;
        const prDist = Math.sqrt(prx * prx + pry * pry) + 0.001;
        if (prDist < VS_PULL_RADIUS_WORLD) {
          const ramp = 1.0 - prDist / VS_PULL_RADIUS_WORLD;
          const pullForce = Math.min(VS_PULL_STRENGTH * ramp * 1.5, VS_MAX_PULL_FORCE);
          playerCluster.velocityXWorld += (prx / prDist) * pullForce;
          playerCluster.velocityYWorld += (pry / prDist) * pullForce;
        }
      }

      cluster.voidSingularityStateTicks++;
      if (stateTicks >= VS_CHARGE_PULSE_TICKS) {
        // Fire the collapse pulse.
        cluster.voidSingularityState        = VS_STATE_COLLAPSE_PULSE;
        cluster.voidSingularityStateTicks   = 0;
        cluster.voidSingularityPulseRadius  = 0;
        cluster.voidSingularityPulseActiveFlag = 1;
        cluster.voidSingularityPulseHitPlayerFlag = 0;
      }
      break;
    }

    // ── Collapse Pulse ────────────────────────────────────────────────────────
    case VS_STATE_COLLAPSE_PULSE: {
      // Expand pulse ring.
      const expandSpeed = VS_PULSE_MAX_RADIUS_WORLD / VS_COLLAPSE_PULSE_TICKS;
      cluster.voidSingularityPulseRadius += expandSpeed;

      cluster.velocityXWorld *= VS_VELOCITY_DRAG;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG;

      // Check player collision with the ring band.
      if (
        playerCluster !== undefined &&
        cluster.voidSingularityPulseHitPlayerFlag === 0 &&
        cluster.voidSingularityPulseActiveFlag === 1
      ) {
        const prx = playerX - cluster.positionXWorld;
        const pry = playerY - cluster.positionYWorld;
        const playerDist = Math.sqrt(prx * prx + pry * pry);
        const inner = cluster.voidSingularityPulseRadius - 8.0;
        const outer = cluster.voidSingularityPulseRadius + 8.0;
        if (playerDist >= inner && playerDist <= outer) {
          applyPlayerDamageWithKnockback(
            playerCluster,
            VS_PULSE_DAMAGE,
            cluster.positionXWorld,
            cluster.positionYWorld,
          );
          cluster.voidSingularityPulseHitPlayerFlag = 1;
        }
      }

      cluster.voidSingularityStateTicks++;
      if (stateTicks >= VS_COLLAPSE_PULSE_TICKS || cluster.voidSingularityPulseRadius >= VS_PULSE_MAX_RADIUS_WORLD) {
        cluster.voidSingularityState        = VS_STATE_RECOVER;
        cluster.voidSingularityStateTicks   = 0;
        cluster.voidSingularityPulseActiveFlag = 0;
        cluster.voidSingularityPulseRadius  = 0;
        cluster.voidSingularityAbsorbedEnergy = 0;

        // VSP: transfer absorbed energy to white hole charge.
        if (isPair) {
          cluster.voidSingularityWholeCharge += VS_PULSE_TRIGGER_ENERGY * 0.8;
        }
      }
      break;
    }

    // ── Recover ───────────────────────────────────────────────────────────────
    case VS_STATE_RECOVER: {
      // Drift back toward spawn.
      const dsx = spawnX - cluster.positionXWorld;
      const dsy = spawnY - cluster.positionYWorld;
      const dist2 = dsx * dsx + dsy * dsy;
      if (dist2 > 4) {
        const dist = Math.sqrt(dist2) + 0.001;
        const t = Math.min(VS_HOVER_SPEED * 0.5 / dist, 0.03);
        cluster.velocityXWorld += dsx * t;
        cluster.velocityYWorld += dsy * t;
      }
      cluster.velocityXWorld *= VS_VELOCITY_DRAG;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG;

      cluster.voidSingularityStateTicks++;
      if (stateTicks >= VS_RECOVER_TICKS) {
        cluster.voidSingularityState      = VS_STATE_ACTIVE_PULL;
        cluster.voidSingularityStateTicks = 0;
        cluster.voidSingularityAbsorbedEnergy = 0;
      }
      break;
    }

    // ── Dying ─────────────────────────────────────────────────────────────────
    case VS_STATE_DYING: {
      cluster.velocityXWorld *= VS_VELOCITY_DRAG;
      cluster.velocityYWorld *= VS_VELOCITY_DRAG;
      cluster.voidSingularityStateTicks++;
      if (stateTicks >= VS_DEATH_DURATION_TICKS) {
        cluster.isAliveFlag = 0;
      }
      break;
    }
  }

  // ── VSP: white hole logic ─────────────────────────────────────────────────
  if (isPair && slot >= 0) {
    _tickWhiteHole(world, cluster, slot, playerX, playerY, playerCluster);
  }

  // ── Leash clamp ───────────────────────────────────────────────────────────
  const ldx = cluster.positionXWorld - spawnX;
  const ldy = cluster.positionYWorld - spawnY;
  const ld2 = ldx * ldx + ldy * ldy;
  if (ld2 > VS_LEASH_RADIUS_WORLD * VS_LEASH_RADIUS_WORLD) {
    const ld = Math.sqrt(ld2);
    cluster.positionXWorld = spawnX + (ldx / ld) * VS_LEASH_RADIUS_WORLD;
    cluster.positionYWorld = spawnY + (ldy / ld) * VS_LEASH_RADIUS_WORLD;
    cluster.velocityXWorld *= 0.5;
    cluster.velocityYWorld *= 0.5;
  }
}

// ── White hole logic ──────────────────────────────────────────────────────────

function _tickWhiteHole(
  world: WorldState,
  cluster: typeof world.clusters[0],
  slot: number,
  playerX: number,
  playerY: number,
  playerCluster: typeof world.clusters[0] | undefined,
): void {
  // White hole center is offset from black hole by pairAngle.
  const whX = cluster.positionXWorld + Math.cos(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;
  const whY = cluster.positionYWorld + Math.sin(cluster.voidSingularityPairAngleRad) * VSP_NODE_DISTANCE_WORLD;

  // Accumulate charge when the BH is charging/absorbing.
  if (
    cluster.voidSingularityState === VS_STATE_ACTIVE_PULL ||
    cluster.voidSingularityState === VS_STATE_CHARGE_PULSE
  ) {
    cluster.voidSingularityWholeCharge += VS_PASSIVE_CHARGE_PER_TICK * 0.6;
  }

  const whState = cluster.voidSingularityWholeState;

  switch (whState) {
    case VSP_WH_STATE_IDLE: {
      if (cluster.voidSingularityWholeCharge >= VSP_CHARGE_THRESHOLD) {
        cluster.voidSingularityWholeState      = VSP_WH_STATE_CHARGING;
        cluster.voidSingularityWholeStateTicks = 0;
      }
      break;
    }

    case VSP_WH_STATE_CHARGING: {
      cluster.voidSingularityWholeStateTicks++;
      if (cluster.voidSingularityWholeStateTicks >= VSP_ERUPTION_CHARGE_TICKS) {
        // Fire eruption.
        _spawnEruptionProjectiles(world, slot, whX, whY, playerX, playerY);
        cluster.voidSingularityWholeState      = VSP_WH_STATE_ERUPTING;
        cluster.voidSingularityWholeStateTicks = 0;
        cluster.voidSingularityWholeCharge     = 0;
      }
      break;
    }

    case VSP_WH_STATE_ERUPTING: {
      cluster.voidSingularityWholeStateTicks++;
      // Tick projectiles.
      _tickVSPProjectiles(world, slot, playerCluster);
      if (cluster.voidSingularityWholeStateTicks >= VSP_ERUPTION_ACTIVE_TICKS) {
        // Clear any remaining projectiles.
        const base = slot * MAX_PROJS_PER_VSP;
        for (let p = 0; p < MAX_PROJS_PER_VSP; p++) {
          world.vspProjAliveFlag[base + p] = 0;
        }
        cluster.voidSingularityWholeState      = VSP_WH_STATE_COOLDOWN;
        cluster.voidSingularityWholeStateTicks = VSP_ERUPTION_COOLDOWN_TICKS;
      }
      break;
    }

    case VSP_WH_STATE_COOLDOWN: {
      cluster.voidSingularityWholeStateTicks--;
      if (cluster.voidSingularityWholeStateTicks <= 0) {
        cluster.voidSingularityWholeState      = VSP_WH_STATE_IDLE;
        cluster.voidSingularityWholeStateTicks = 0;
      }
      break;
    }
  }
}

// ── VSP projectile tick ───────────────────────────────────────────────────────

function _tickVSPProjectiles(
  world: WorldState,
  slot: number,
  playerCluster: typeof world.clusters[0] | undefined,
): void {
  const base = slot * MAX_PROJS_PER_VSP;
  const hitR2 = VSP_PROJ_HIT_RADIUS_WORLD * VSP_PROJ_HIT_RADIUS_WORLD;

  for (let p = 0; p < MAX_PROJS_PER_VSP; p++) {
    const idx = base + p;
    if (world.vspProjAliveFlag[idx] === 0) continue;

    // Move.
    const previousX = world.vspProjXWorld[idx];
    const previousY = world.vspProjYWorld[idx];
    world.vspProjXWorld[idx] += world.vspProjVelXWorld[idx];
    world.vspProjYWorld[idx] += world.vspProjVelYWorld[idx];

    // Tick lifetime.
    world.vspProjLifetimeTicks[idx]--;
    if (world.vspProjLifetimeTicks[idx] <= 0) {
      world.vspProjAliveFlag[idx] = 0;
      continue;
    }

    if (tryBlockHostileProjectile(
      world.shieldWeave,
      previousX,
      previousY,
      world.vspProjXWorld[idx],
      world.vspProjYWorld[idx],
      VSP_PROJ_HIT_RADIUS_WORLD,
    )) {
      world.vspProjAliveFlag[idx] = 0;
      continue;
    }

    // Player hit check.
    if (playerCluster !== undefined && playerCluster.isAliveFlag === 1) {
      const dx = world.vspProjXWorld[idx] - playerCluster.positionXWorld;
      const dy = world.vspProjYWorld[idx] - playerCluster.positionYWorld;
      if (dx * dx + dy * dy < hitR2 + playerCluster.halfWidthWorld * playerCluster.halfWidthWorld) {
        applyPlayerDamageWithKnockback(
          playerCluster,
          VSP_PROJ_DAMAGE,
          world.vspProjXWorld[idx],
          world.vspProjYWorld[idx],
        );
        world.vspProjAliveFlag[idx] = 0;
      }
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function applyVoidSingularityAI(world: WorldState): void {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isVoidSingularityFlag === 1) {
      _tickVoidSingularity(world, ci);
    }
  }
}
