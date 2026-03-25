/**
 * Wall repulsion forces and velocity bounce.
 *
 * Each wall is an axis-aligned rectangle.  Particles within `WALL_MARGIN_WORLD`
 * units of a wall face receive a repulsion force proportional to their
 * penetration depth.  Particles already inside a wall are pushed out with
 * maximum force to prevent tunnelling.
 *
 * This is step 5.5 of the tick pipeline (after inter-particle forces,
 * before Euler integration).
 *
 * A separate velocity-bounce pass (step 6.5, after integration) reflects
 * particle velocities when they are very close to a wall face and moving
 * toward it — producing physically plausible bounces with slight energy loss.
 * Stone particles that bounce with sufficient speed are flagged to shatter.
 */

import { WorldState } from '../world';
import { ParticleKind } from './kinds';
import { getElementProfile } from './elementProfiles';
import { nextFloat } from '../rng';

/** Distance at which wall repulsion starts (world units). */
const WALL_MARGIN_WORLD = 18.0;
/** Force magnitude at the wall face (fully penetrated). */
const WALL_FORCE_MAX = 2800.0;

/** Distance from wall face at which velocity bounce triggers (world units). */
const WALL_BOUNCE_MARGIN_WORLD = 5.0;
/** Fraction of perpendicular velocity retained after a bounce. */
const WALL_BOUNCE_DAMPING = 0.60;

/** Speed (world/s) at which Stone triggers a shatter event on wall impact. */
const STONE_SHATTER_SPEED_WORLD = 120.0;
/** Lifetime (ticks) for spawned stone shards — kept short to flag them as transient. */
const STONE_SHARD_LIFETIME_TICKS = 35.0;

// Pre-allocated shatter scratch buffers (no per-tick heap allocation)
const _shatterPosX  = new Float32Array(256);
const _shatterPosY  = new Float32Array(256);
const _shatterVelX  = new Float32Array(256);
const _shatterVelY  = new Float32Array(256);
const _shatterOwner = new Int32Array(256);
let _shatterCount = 0;

export function applyWallForces(world: WorldState): void {
  if (world.wallCount === 0) return;

  const {
    positionXWorld, positionYWorld,
    forceX, forceY,
    isAliveFlag, particleCount,
    wallXWorld, wallYWorld, wallWWorld, wallHWorld, wallCount,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];

    for (let wi = 0; wi < wallCount; wi++) {
      const wx = wallXWorld[wi];
      const wy = wallYWorld[wi];
      const ww = wallWWorld[wi];
      const wh = wallHWorld[wi];

      // Closest point on wall AABB to particle
      const clampedX = px < wx ? wx : px > wx + ww ? wx + ww : px;
      const clampedY = py < wy ? wy : py > wy + wh ? wy + wh : py;

      const dx = px - clampedX;
      const dy = py - clampedY;
      const dist2 = dx * dx + dy * dy;

      if (dist2 >= WALL_MARGIN_WORLD * WALL_MARGIN_WORLD) continue;

      const dist = Math.sqrt(dist2);

      if (dist < 0.001) {
        // Particle is at/inside wall center — push away from wall center
        const wcx = wx + ww * 0.5;
        const wcy = wy + wh * 0.5;
        const fwx = positionXWorld[i] - wcx;
        const fwy = positionYWorld[i] - wcy;
        const fwLen = Math.sqrt(fwx * fwx + fwy * fwy);
        if (fwLen > 0.001) {
          forceX[i] += (fwx / fwLen) * WALL_FORCE_MAX;
          forceY[i] += (fwy / fwLen) * WALL_FORCE_MAX;
        } else {
          forceX[i] += WALL_FORCE_MAX; // degenerate fallback
        }
        continue;
      }

      // Linear ramp: force is WALL_FORCE_MAX at dist=0, 0 at dist=WALL_MARGIN_WORLD
      const strength = WALL_FORCE_MAX * (1.0 - dist / WALL_MARGIN_WORLD);
      forceX[i] += (dx / dist) * strength;
      forceY[i] += (dy / dist) * strength;
    }
  }
}

/**
 * Velocity bounce pass — called after Euler integration (step 6.5).
 *
 * For each alive particle near a wall face and moving toward it:
 *   • Reflects the normal (perpendicular-to-face) velocity component.
 *   • Damps the reflected speed by WALL_BOUNCE_DAMPING.
 *   • Clamps the particle position to be outside the wall surface.
 *
 * Stone particles bouncing above STONE_SHATTER_SPEED_WORLD are shattered:
 * they are killed and 2–3 small stone shard particles are spawned in their place.
 */
export function applyWallBounce(world: WorldState): void {
  if (world.wallCount === 0) return;

  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    isAliveFlag, kindBuffer, ownerEntityId,
    particleCount, particleDurability, respawnDelayTicks,
    isTransientFlag,
    wallXWorld, wallYWorld, wallWWorld, wallHWorld, wallCount,
  } = world;

  _shatterCount = 0;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const px = positionXWorld[i];
    const py = positionYWorld[i];
    const vx = velocityXWorld[i];
    const vy = velocityYWorld[i];

    for (let wi = 0; wi < wallCount; wi++) {
      const wx = wallXWorld[wi];
      const wy = wallYWorld[wi];
      const ww = wallWWorld[wi];
      const wh = wallHWorld[wi];

      // Closest point on wall AABB to particle
      const clampedX = px < wx ? wx : px > wx + ww ? wx + ww : px;
      const clampedY = py < wy ? wy : py > wy + wh ? wy + wh : py;

      const dx = px - clampedX;
      const dy = py - clampedY;
      const dist2 = dx * dx + dy * dy;

      if (dist2 >= WALL_BOUNCE_MARGIN_WORLD * WALL_BOUNCE_MARGIN_WORLD) continue;

      const dist = Math.sqrt(dist2);
      if (dist < 0.001) continue;  // inside wall — repulsion force handles it

      // Normal from wall surface toward particle
      const nx = dx / dist;
      const ny = dy / dist;

      // Only bounce if the particle is moving toward the wall (v · n < 0)
      const vDotN = vx * nx + vy * ny;
      if (vDotN >= 0) continue;

      // Reflect velocity along wall normal
      const reflectedVx = vx - 2.0 * vDotN * nx;
      const reflectedVy = vy - 2.0 * vDotN * ny;

      velocityXWorld[i] = reflectedVx * WALL_BOUNCE_DAMPING;
      velocityYWorld[i] = reflectedVy * WALL_BOUNCE_DAMPING;

      // Push position just outside the bounce margin to prevent re-triggering
      positionXWorld[i] = clampedX + nx * (WALL_BOUNCE_MARGIN_WORLD + 0.5);
      positionYWorld[i] = clampedY + ny * (WALL_BOUNCE_MARGIN_WORLD + 0.5);

      // ── Stone shatter on wall impact ────────────────────────────────────
      if (
        kindBuffer[i] === ParticleKind.Stone &&
        isTransientFlag[i] === 0 &&               // not already a shard
        Math.abs(vDotN) > STONE_SHATTER_SPEED_WORLD &&
        _shatterCount < _shatterPosX.length
      ) {
        // Kill the original stone particle
        isAliveFlag[i] = 0;
        respawnDelayTicks[i] = getElementProfile(ParticleKind.Stone).regenerationRateTicks;
        particleDurability[i] = getElementProfile(ParticleKind.Stone).toughness;

        // Record shatter event for post-loop shard spawning
        _shatterPosX[_shatterCount] = positionXWorld[i];
        _shatterPosY[_shatterCount] = positionYWorld[i];
        // Shards fly outward away from the wall
        _shatterVelX[_shatterCount] = nx * Math.abs(vDotN) * 0.5;
        _shatterVelY[_shatterCount] = ny * Math.abs(vDotN) * 0.5;
        _shatterOwner[_shatterCount] = ownerEntityId[i];
        _shatterCount++;
      }

      break; // only handle the first wall per particle per tick
    }
  }

  // ── Spawn stone shards from recorded shatter events ──────────────────────
  for (let s = 0; s < _shatterCount; s++) {
    _spawnStoneShards(world, _shatterPosX[s], _shatterPosY[s], _shatterVelX[s], _shatterVelY[s], _shatterOwner[s]);
  }
}

/**
 * Spawns 2 stone shard particles at the given position/velocity.
 * Shards are transient (isTransientFlag=1), short-lived, and do not respawn.
 * behaviorMode is set to 1 (attack) so binding forces don't pull them back.
 */
function _spawnStoneShards(
  world: WorldState,
  posX: number, posY: number,
  velX: number, velY: number,
  ownerEntityIdValue: number,
): void {
  const SHARD_COUNT = 2;
  const rng = world.rng;

  for (let s = 0; s < SHARD_COUNT; s++) {
    const idx = _findFreeSlot(world);
    if (idx === -1) return;

    // Spread shards in slightly different directions
    const spreadAngleRad = (nextFloat(rng) - 0.5) * Math.PI;
    const cosA = Math.cos(spreadAngleRad);
    const sinA = Math.sin(spreadAngleRad);
    const shardSpeed = 80.0 + nextFloat(rng) * 120.0;
    const svx = (velX * cosA - velY * sinA);
    const svy = (velX * sinA + velY * cosA);
    const sLen = Math.sqrt(svx * svx + svy * svy);
    const normX = sLen > 0.01 ? svx / sLen : 1.0;
    const normY = sLen > 0.01 ? svy / sLen : 0.0;

    world.positionXWorld[idx]    = posX + normX * 4.0;
    world.positionYWorld[idx]    = posY + normY * 4.0;
    world.velocityXWorld[idx]    = normX * shardSpeed;
    world.velocityYWorld[idx]    = normY * shardSpeed;
    world.forceX[idx]            = 0;
    world.forceY[idx]            = 0;
    world.massKg[idx]            = getElementProfile(ParticleKind.Stone).massKg * 0.35;
    world.chargeUnits[idx]       = 0;
    world.isAliveFlag[idx]       = 1;
    world.kindBuffer[idx]        = ParticleKind.Stone;
    world.ownerEntityId[idx]     = ownerEntityIdValue;
    world.anchorAngleRad[idx]    = 0;
    world.anchorRadiusWorld[idx] = 0;
    world.disturbanceFactor[idx] = 0;
    world.noiseTickSeed[idx]     = ((nextFloat(rng) * 0xffffffff) >>> 0);
    world.lifetimeTicks[idx]     = STONE_SHARD_LIFETIME_TICKS;
    world.ageTicks[idx]          = 0;
    world.behaviorMode[idx]      = 1;   // attack mode — suppresses binding
    world.attackModeTicksLeft[idx] = STONE_SHARD_LIFETIME_TICKS + 10;
    world.particleDurability[idx] = 1.0;
    world.respawnDelayTicks[idx] = 0;
    world.isTransientFlag[idx]   = 1;   // transient — no respawn
  }
}

/** Finds a dead non-pending particle slot to reuse, or allocates a new one. */
function _findFreeSlot(world: WorldState): number {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0 && world.respawnDelayTicks[i] <= 0 && world.isTransientFlag[i] === 1) {
      return i;
    }
  }
  if (world.particleCount < world.positionXWorld.length) {
    return world.particleCount++;
  }
  return -1;
}

