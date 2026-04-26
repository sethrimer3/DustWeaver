/**
 * Bee Swarm AI.
 *
 * A swarm of 10 bees that orbit a spawn area in a natural swarming pattern
 * until the player comes close enough or the swarm takes damage, at which
 * point all alive bees charge the player and deal contact damage.
 *
 * Each bee is a 4×2 world-unit sprite (halfWidth=2, halfHeight=1).
 * Alive bee count = cluster.healthPoints (starts at BEES_PER_SWARM).
 * Each Physical particle hit deals 1 damage → kills one bee.
 *
 * State machine:
 *   0 = swarming — bees drift around the spawn origin via a per-bee
 *                  Lissajous-curve target; no contact damage.
 *   1 = charging — bees fly directly toward the player; contact damage active.
 *
 * Transition to charging:
 *   • Player enters BEE_AGGRO_RADIUS_WORLD of the spawn origin.
 *   • Swarm healthPoints decreases (takes any damage).
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState, BEES_PER_SWARM } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

// ── Tuning constants ───────────────────────────────────────────────────────

/** Half-width of a single bee's AABB (world units). Total sprite width = 4. */
export const BEE_HALF_WIDTH_WORLD  = 2;
/** Half-height of a single bee's AABB (world units). Total sprite height = 2. */
export const BEE_HALF_HEIGHT_WORLD = 1;

/** Radius within which the player triggers charging mode (world units). */
const BEE_AGGRO_RADIUS_WORLD = 80;

/** Radius within which bees orbit during swarming mode (world units). */
const BEE_SWARM_ORBIT_RADIUS_WORLD = 28;

/** How fast the global orbit angle advances each tick (radians/tick). */
const BEE_ORBIT_ANGLE_SPEED_RAD_PER_TICK = 0.018;

/** Steering acceleration toward a bee's Lissajous target (world/s²). */
const BEE_SWARM_STEER_ACCEL_WORLD_PER_SEC2 = 380;

/** Drag applied to bee velocity each tick during swarming (fraction retained/tick). */
const BEE_SWARM_DRAG = 0.88;

/** Maximum speed of a bee while swarming (world units/s). */
const BEE_SWARM_MAX_SPEED_WORLD = 55;

/** Charge speed — bees hone toward the player at this speed (world units/s). */
const BEE_CHARGE_SPEED_WORLD = 110;

/** Steering blend factor for charge homing (fraction per tick). */
const BEE_CHARGE_STEER_BLEND = 0.12;

/** Contact damage dealt to the player per hit. */
const BEE_CONTACT_DAMAGE = 1;

/** Invulnerability ticks on the swarm side after dealing contact damage. */
const BEE_CONTACT_COOLDOWN_TICKS = 90;

// ── State identifiers ──────────────────────────────────────────────────────
const STATE_SWARMING = 0;
const STATE_CHARGING = 1;

// ── Per-swarm contact-damage cooldown (WeakMap avoids polluting ClusterState) ──
const _contactCooldownMap = new WeakMap<object, number>();

function _getContactCooldown(cluster: object): number {
  return _contactCooldownMap.get(cluster) ?? 0;
}

function _setContactCooldown(cluster: object, ticks: number): void {
  _contactCooldownMap.set(cluster, ticks);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns the Lissajous-curve target position for bee `beeIndex` in the swarm
 * at (`spawnX`, `spawnY`) given the global `orbitAngle`.
 */
function _beeTargetX(
  spawnX: number,
  phaseRad: number,
  orbitAngle: number,
): number {
  return spawnX + Math.cos(phaseRad + orbitAngle) * BEE_SWARM_ORBIT_RADIUS_WORLD;
}

function _beeTargetY(
  spawnY: number,
  phaseRad: number,
  orbitAngle: number,
): number {
  // Lissajous: slightly different frequency on Y for organic figure-8 motion
  return spawnY + Math.sin(phaseRad * 1.3 + orbitAngle * 0.73) * BEE_SWARM_ORBIT_RADIUS_WORLD * 0.55;
}

// ── Main AI update ─────────────────────────────────────────────────────────

/**
 * Updates all bee-swarm clusters in the world for one simulation tick.
 * Called from `tick.ts` at position 0.5m in the pipeline.
 */
export function applyBeeSwarmAI(world: WorldState): void {
  const dtSec = world.dtMs / 1000;
  const player = world.clusters[0];
  const playerAlive = player !== undefined && player.isAliveFlag === 1;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isBeeSwarmFlag !== 1 || cluster.isAliveFlag !== 1) continue;

    const slot = cluster.beeSwarmSlotIndex;
    if (slot < 0) continue;

    const base = slot * BEES_PER_SWARM;
    const aliveCount = cluster.healthPoints; // bees alive = current HP

    // ── Damage detection → trigger charge ──────────────────────────────────
    if (cluster.healthPoints < cluster.beeSwarmPrevHealthPoints) {
      cluster.beeSwarmState = STATE_CHARGING;
    }
    cluster.beeSwarmPrevHealthPoints = cluster.healthPoints;

    // ── Player proximity → trigger charge ──────────────────────────────────
    if (playerAlive && cluster.beeSwarmState === STATE_SWARMING) {
      const pdx = player.positionXWorld - cluster.beeSwarmSpawnXWorld;
      const pdy = player.positionYWorld - cluster.beeSwarmSpawnYWorld;
      if (Math.sqrt(pdx * pdx + pdy * pdy) <= BEE_AGGRO_RADIUS_WORLD) {
        cluster.beeSwarmState = STATE_CHARGING;
      }
    }

    // ── Death check ─────────────────────────────────────────────────────────
    if (aliveCount <= 0) {
      cluster.isAliveFlag = 0;
      continue;
    }

    // ── Advance orbit angle (always, for smooth animation) ──────────────────
    cluster.beeSwarmOrbitAngleRad += BEE_ORBIT_ANGLE_SPEED_RAD_PER_TICK;

    const orbitAngle = cluster.beeSwarmOrbitAngleRad;

    if (cluster.beeSwarmState === STATE_SWARMING) {
      // ── Swarming: steer each bee toward its Lissajous target ──────────────
      for (let bi = 0; bi < aliveCount; bi++) {
        const idx = base + bi;
        const bx  = world.beeSwarmBeeXWorld[idx];
        const by  = world.beeSwarmBeeYWorld[idx];
        const bvx = world.beeSwarmBeeVelXWorld[idx];
        const bvy = world.beeSwarmBeeVelYWorld[idx];
        const phase = world.beeSwarmBeePhaseRad[idx];

        const tx = _beeTargetX(cluster.beeSwarmSpawnXWorld, phase, orbitAngle);
        const ty = _beeTargetY(cluster.beeSwarmSpawnYWorld, phase, orbitAngle);

        const distX = tx - bx;
        const distY = ty - by;
        const distLen = Math.sqrt(distX * distX + distY * distY) + 0.0001;

        // Steer toward target
        const accel = BEE_SWARM_STEER_ACCEL_WORLD_PER_SEC2 * dtSec;
        let nvx = bvx + (distX / distLen) * accel;
        let nvy = bvy + (distY / distLen) * accel;

        // Apply drag
        nvx *= BEE_SWARM_DRAG;
        nvy *= BEE_SWARM_DRAG;

        // Clamp speed
        const spd = Math.sqrt(nvx * nvx + nvy * nvy);
        if (spd > BEE_SWARM_MAX_SPEED_WORLD) {
          const inv = BEE_SWARM_MAX_SPEED_WORLD / spd;
          nvx *= inv;
          nvy *= inv;
        }

        world.beeSwarmBeeVelXWorld[idx] = nvx;
        world.beeSwarmBeeVelYWorld[idx] = nvy;
        world.beeSwarmBeeXWorld[idx]    = bx + nvx * dtSec;
        world.beeSwarmBeeYWorld[idx]    = by + nvy * dtSec;
      }

      // Cluster position = centroid of alive bees
      let cx = 0;
      let cy = 0;
      for (let bi = 0; bi < aliveCount; bi++) {
        cx += world.beeSwarmBeeXWorld[base + bi];
        cy += world.beeSwarmBeeYWorld[base + bi];
      }
      cluster.positionXWorld = cx / aliveCount;
      cluster.positionYWorld = cy / aliveCount;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;

    } else {
      // ── Charging: each bee homes toward the player ─────────────────────────
      let contactCooldown = _getContactCooldown(cluster);
      if (contactCooldown > 0) contactCooldown--;

      for (let bi = 0; bi < aliveCount; bi++) {
        const idx = base + bi;
        const bx  = world.beeSwarmBeeXWorld[idx];
        const by  = world.beeSwarmBeeYWorld[idx];
        let bvx   = world.beeSwarmBeeVelXWorld[idx];
        let bvy   = world.beeSwarmBeeVelYWorld[idx];

        if (playerAlive) {
          const pdx = player.positionXWorld - bx;
          const pdy = player.positionYWorld - by;
          const plen = Math.sqrt(pdx * pdx + pdy * pdy) + 0.0001;
          const dirX = pdx / plen;
          const dirY = pdy / plen;

          // Blend current velocity toward charge direction
          bvx = bvx * (1 - BEE_CHARGE_STEER_BLEND) + dirX * BEE_CHARGE_SPEED_WORLD * BEE_CHARGE_STEER_BLEND;
          bvy = bvy * (1 - BEE_CHARGE_STEER_BLEND) + dirY * BEE_CHARGE_SPEED_WORLD * BEE_CHARGE_STEER_BLEND;

          // Clamp to charge speed
          const spd = Math.sqrt(bvx * bvx + bvy * bvy);
          if (spd > BEE_CHARGE_SPEED_WORLD) {
            const inv = BEE_CHARGE_SPEED_WORLD / spd;
            bvx *= inv;
            bvy *= inv;
          }

          // Contact damage check (AABB overlap with player)
          if (contactCooldown <= 0) {
            const nx  = bx + bvx * dtSec;
            const ny  = by + bvy * dtSec;
            const overlapX = Math.abs(nx - player.positionXWorld)  < (BEE_HALF_WIDTH_WORLD  + player.halfWidthWorld);
            const overlapY = Math.abs(ny - player.positionYWorld) < (BEE_HALF_HEIGHT_WORLD + player.halfHeightWorld);
            if (overlapX && overlapY) {
              applyPlayerDamageWithKnockback(player, BEE_CONTACT_DAMAGE, nx, ny);
              contactCooldown = BEE_CONTACT_COOLDOWN_TICKS;
            }
          }
        }

        world.beeSwarmBeeVelXWorld[idx] = bvx;
        world.beeSwarmBeeVelYWorld[idx] = bvy;
        world.beeSwarmBeeXWorld[idx]    = bx + bvx * dtSec;
        world.beeSwarmBeeYWorld[idx]    = by + bvy * dtSec;
      }

      _setContactCooldown(cluster, contactCooldown);

      // Cluster position = centroid of alive bees (for health bar placement)
      let cx = 0;
      let cy = 0;
      for (let bi = 0; bi < aliveCount; bi++) {
        cx += world.beeSwarmBeeXWorld[base + bi];
        cy += world.beeSwarmBeeYWorld[base + bi];
      }
      cluster.positionXWorld = cx / aliveCount;
      cluster.positionYWorld = cy / aliveCount;
      // Store velocity as centroid velocity for render interpolation
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;
    }

    cluster.beeSwarmStateTicks++;
  }
}
