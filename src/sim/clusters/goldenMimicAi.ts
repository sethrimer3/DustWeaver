/**
 * Golden Mimic AI.
 *
 * A golden silhouette enemy that exactly mirrors the player's movement with
 * the X-axis flipped (and optionally the Y-axis too for the XY variant).
 *
 * Each of the mimic's particles is a non-regenerating gold-dust particle.
 * When at least half those particles have been destroyed the mimic enters
 * "heap" state:
 *   • Normal variant  → falls downward under gravity, then fades out.
 *   • XY-flipped variant → rises upward (inverted gravity), then fades out.
 *
 * Deals contact damage to the player on AABB overlap.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

// ── Tuning constants ───────────────────────────────────────────────────────

/** Half-width/height of the mimic's AABB (world units). Matches player size. */
export const GOLDEN_MIMIC_HALF_WIDTH_WORLD  = 3.5;
export const GOLDEN_MIMIC_HALF_HEIGHT_WORLD = 10;

/** Contact damage dealt to the player per hit. */
const MIMIC_CONTACT_DAMAGE = 1;

/** Invulnerability ticks on the mimic side after dealing contact damage. */
const MIMIC_CONTACT_COOLDOWN_TICKS = 90;

/** Downward gravity applied in heap state (world units/s²). */
const HEAP_GRAVITY_WORLD_PER_SEC2 = 900;

/** Maximum fall (or rise) speed during heap state (world units/s). */
const HEAP_MAX_SPEED_WORLD_PER_SEC = 240;

/**
 * Total ticks for the heap fade-out.
 * Alpha decreases from 1.0 to 0.0 over this many ticks.
 */
const HEAP_FADE_TICKS = 90;

// ── State identifiers ──────────────────────────────────────────────────────
const STATE_ACTIVE = 0;
const STATE_HEAP   = 1;

// ── Per-mimic contact-damage cooldown (WeakMap avoids polluting ClusterState) ──
const _contactCooldownMap = new WeakMap<object, number>();

function _getContactCooldown(cluster: object): number {
  return _contactCooldownMap.get(cluster) ?? 0;
}

function _setContactCooldown(cluster: object, ticks: number): void {
  _contactCooldownMap.set(cluster, ticks);
}

// ── Wall collision helpers ─────────────────────────────────────────────────

/**
 * Axis-separated sweep collision resolution.
 * 1. Apply X component of velocity → resolve X overlaps.
 * 2. Apply Y component of velocity → resolve Y overlaps.
 * Sub-stepped for safety (prevents tunneling at high speeds).
 */
function _resolveWalls(
  world: WorldState,
  cluster: {
    positionXWorld: number;
    positionYWorld: number;
    velocityXWorld: number;
    velocityYWorld: number;
    halfWidthWorld: number;
    halfHeightWorld: number;
  },
  dtSec: number,
): void {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;

  const moveX = cluster.velocityXWorld * dtSec;
  const moveY = cluster.velocityYWorld * dtSec;
  const stepsX = Math.max(1, Math.ceil(Math.abs(moveX) / hw));
  const stepsY = Math.max(1, Math.ceil(Math.abs(moveY) / hh));

  // ── X pass ─────────────────────────────────────────────────────────────
  const stepDX = moveX / stepsX;
  for (let s = 0; s < stepsX; s++) {
    cluster.positionXWorld += stepDX;
    for (let wi = 0; wi < world.wallCount; wi++) {
      if (world.wallIsPlatformFlag[wi] === 1) continue;
      if (world.wallRampOrientationIndex[wi] !== 255) continue;
      if (world.wallIsInvisibleFlag[wi] === 1) continue;
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      const clL = cluster.positionXWorld - hw;
      const clR = cluster.positionXWorld + hw;
      const clT = cluster.positionYWorld - hh;
      const clB = cluster.positionYWorld + hh;
      if (clR <= wx || clL >= wx + ww || clB <= wy || clT >= wy + wh) continue;
      const penL = clR - wx;
      const penR = (wx + ww) - clL;
      if (penL < penR) {
        cluster.positionXWorld -= penL;
      } else {
        cluster.positionXWorld += penR;
      }
      cluster.velocityXWorld = 0;
    }
  }

  // ── Y pass ─────────────────────────────────────────────────────────────
  const stepDY = moveY / stepsY;
  for (let s = 0; s < stepsY; s++) {
    cluster.positionYWorld += stepDY;
    for (let wi = 0; wi < world.wallCount; wi++) {
      if (world.wallIsPlatformFlag[wi] === 1) continue;
      if (world.wallRampOrientationIndex[wi] !== 255) continue;
      if (world.wallIsInvisibleFlag[wi] === 1) continue;
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      const clL = cluster.positionXWorld - hw;
      const clR = cluster.positionXWorld + hw;
      const clT = cluster.positionYWorld - hh;
      const clB = cluster.positionYWorld + hh;
      if (clR <= wx || clL >= wx + ww || clB <= wy || clT >= wy + wh) continue;
      const penT = clB - wy;
      const penB = (wy + wh) - clT;
      if (penT < penB) {
        cluster.positionYWorld -= penT;
      } else {
        cluster.positionYWorld += penB;
      }
      cluster.velocityYWorld = 0;
    }
  }
}

// ── Public AI entry point ──────────────────────────────────────────────────

export function applyGoldenMimicAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Locate the player once per tick.
  let playerVelX    = 0;
  let playerVelY    = 0;
  let playerXWorld  = 0;
  let playerYWorld  = 0;
  let playerHalfW   = 0;
  let playerHalfH   = 0;
  let playerRef: typeof world.clusters[0] | undefined;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerVelX   = c.velocityXWorld;
      playerVelY   = c.velocityYWorld;
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      playerHalfW  = c.halfWidthWorld;
      playerHalfH  = c.halfHeightWorld;
      playerRef    = c;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isGoldenMimicFlag !== 1 || cluster.isAliveFlag === 0) continue;

    const isYFlipped = cluster.isGoldenMimicYFlippedFlag === 1;

    // ── Contact cooldown tick-down ──────────────────────────────────────────
    const cooldown = _getContactCooldown(cluster);
    if (cooldown > 0) {
      _setContactCooldown(cluster, cooldown - 1);
    }

    cluster.goldenMimicStateTicks++;

    if (cluster.goldenMimicState === STATE_ACTIVE) {
      // ── Count alive particles owned by this mimic ─────────────────────────
      let aliveCount = 0;
      const eid = cluster.entityId;
      for (let pi = 0; pi < world.particleCount; pi++) {
        if (world.ownerEntityId[pi] === eid && world.isAliveFlag[pi] === 1) {
          aliveCount++;
        }
      }

      // ── Check half-dead threshold ─────────────────────────────────────────
      const halfThreshold = cluster.goldenMimicInitialParticleCount >> 1; // floor divide by 2
      if (aliveCount <= halfThreshold) {
        cluster.goldenMimicState = STATE_HEAP;
        cluster.goldenMimicStateTicks = 0;
        // Clear horizontal velocity; vertical velocity will be set by heap gravity.
        cluster.velocityXWorld = 0;
        cluster.velocityYWorld = isYFlipped ? -HEAP_MAX_SPEED_WORLD_PER_SEC * 0.5 : HEAP_MAX_SPEED_WORLD_PER_SEC * 0.5;
        // Update health to reflect remaining particles.
        cluster.healthPoints = aliveCount;
      } else {
        // Update health to reflect alive particle count
        if (cluster.maxHealthPoints > 0) {
          cluster.healthPoints = aliveCount;
        }

        // ── Mirror player velocity ───────────────────────────────────────────
        if (playerRef !== undefined) {
          cluster.velocityXWorld = -playerVelX;
          cluster.velocityYWorld = isYFlipped ? -playerVelY : playerVelY;
        } else {
          // No player — stay still
          cluster.velocityXWorld = 0;
          cluster.velocityYWorld = 0;
        }

        // ── Wall collision (axis-separated sweep) ───────────────────────────
        _resolveWalls(world, cluster, dtSec);

        // ── Clamp to world bounds ───────────────────────────────────────────
        const hw = cluster.halfWidthWorld;
        const hh = cluster.halfHeightWorld;
        if (cluster.positionXWorld < hw) {
          cluster.positionXWorld = hw;
          if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
        } else if (cluster.positionXWorld > world.worldWidthWorld - hw) {
          cluster.positionXWorld = world.worldWidthWorld - hw;
          if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
        }
        if (cluster.positionYWorld < hh) {
          cluster.positionYWorld = hh;
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        } else if (cluster.positionYWorld > world.worldHeightWorld - hh) {
          cluster.positionYWorld = world.worldHeightWorld - hh;
          if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
        }

        // ── Contact damage ──────────────────────────────────────────────────
        if (
          playerRef !== undefined &&
          playerRef.invulnerabilityTicks <= 0 &&
          _getContactCooldown(cluster) <= 0
        ) {
          const dx = Math.abs(cluster.positionXWorld - playerXWorld);
          const dy = Math.abs(cluster.positionYWorld - playerYWorld);
          if (dx < cluster.halfWidthWorld + playerHalfW && dy < cluster.halfHeightWorld + playerHalfH) {
            applyPlayerDamageWithKnockback(playerRef, MIMIC_CONTACT_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
            _setContactCooldown(cluster, MIMIC_CONTACT_COOLDOWN_TICKS);
          }
        }
      }

    } else {
      // ── Heap state ─────────────────────────────────────────────────────────
      // Apply gravity (normal: downward; Y-flipped: upward).
      const gravDir = isYFlipped ? -1 : 1;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld += gravDir * HEAP_GRAVITY_WORLD_PER_SEC2 * dtSec;
      if (!isYFlipped && cluster.velocityYWorld > HEAP_MAX_SPEED_WORLD_PER_SEC) {
        cluster.velocityYWorld = HEAP_MAX_SPEED_WORLD_PER_SEC;
      } else if (isYFlipped && cluster.velocityYWorld < -HEAP_MAX_SPEED_WORLD_PER_SEC) {
        cluster.velocityYWorld = -HEAP_MAX_SPEED_WORLD_PER_SEC;
      }

      // Move with wall collisions (walls stop normal fall; Y-flipped just exits top).
      _resolveWalls(world, cluster, dtSec);

      // World bounds clamp
      const hw = cluster.halfWidthWorld;
      const hh = cluster.halfHeightWorld;
      if (cluster.positionXWorld < hw) {
        cluster.positionXWorld = hw;
      } else if (cluster.positionXWorld > world.worldWidthWorld - hw) {
        cluster.positionXWorld = world.worldWidthWorld - hw;
      }
      if (!isYFlipped) {
        // Falls — stop at floor
        if (cluster.positionYWorld > world.worldHeightWorld - hh) {
          cluster.positionYWorld = world.worldHeightWorld - hh;
          cluster.velocityYWorld = 0;
        }
      }

      // ── Fade out ────────────────────────────────────────────────────────────
      cluster.goldenMimicFadeAlpha -= 1.0 / HEAP_FADE_TICKS;
      if (cluster.goldenMimicFadeAlpha <= 0) {
        cluster.goldenMimicFadeAlpha = 0;
        cluster.isAliveFlag = 0;
      }
    }
  }
}
