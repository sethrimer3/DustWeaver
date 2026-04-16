/**
 * Environmental hazard simulation logic.
 *
 * Called as step 0.1 in the tick pipeline (after cluster movement, before
 * particle force accumulation).
 *
 * Handles:
 *   - Spike damage + knockback
 *   - Springboard bounce
 *   - Water zone buoyancy flag
 *   - Lava zone damage
 *   - Breakable block destruction
 *   - Dust boost jar breaking
 *   - Firefly jar breaking + firefly AI movement
 *
 * All logic is deterministic — no Math.random, no DOM, no wall-clock time.
 */

import { WorldState, MAX_FIREFLIES, FIREFLIES_PER_JAR } from './world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { nextFloat, nextFloatRange } from './rng';
import { applyPlayerDamageWithKnockback } from './playerDamage';
import { overlapAABB } from './physics/collision';

// ── Constants ────────────────────────────────────────────────────────────────

/** Damage dealt by spikes per contact (with invulnerability cooldown). */
const SPIKE_DAMAGE = 2;
/** Invulnerability ticks after taking spike damage (60 ticks ≈ 1 second). */
const SPIKE_INVULN_TICKS = 60;

/** Upward launch speed when bouncing off a springboard (world units/s). */
const SPRINGBOARD_LAUNCH_SPEED_WORLD = 420.0;
/** Animation duration for springboard bounce (ticks). */
const SPRINGBOARD_ANIM_TICKS = 12;

/** Gravity multiplier when inside a water zone (fraction of normal gravity). */
export const WATER_GRAVITY_MULTIPLIER = 0.30;
/** Maximum fall speed inside water (world units/s). */
export const WATER_MAX_FALL_SPEED_WORLD = 40.0;
/** Maximum horizontal speed inside water (world units/s). */
export const WATER_MAX_HORIZONTAL_SPEED_WORLD = 60.0;
/** Upward buoyancy force when below the water surface (world units/s²). */
export const WATER_BUOYANCY_FORCE_WORLD = 280.0;

/** Damage dealt by lava per contact (with invulnerability cooldown). */
const LAVA_ZONE_DAMAGE = 1;
/** Invulnerability ticks after taking lava damage (30 ticks ≈ 0.5 second). */
const LAVA_ZONE_INVULN_TICKS = 30;

/**
 * Minimum momentum (speed × mass approximation) to break a breakable block.
 * Player mass is implicitly 1.0, so this is effectively a speed threshold.
 * Sprint+dash (~373 px/s) should break blocks; normal running (~105 px/s) should not.
 */
const BREAKABLE_MOMENTUM_THRESHOLD_WORLD = 250.0;

/** Interaction radius for jars (world units). */
const JAR_INTERACT_RADIUS_WORLD = 10.0;

/** Firefly wander speed (world units/s). */
const FIREFLY_SPEED_WORLD = 30.0;
/** Firefly direction change interval (ticks). */
const FIREFLY_DIRECTION_CHANGE_TICKS = 90;
/** Margin from world edges for firefly clamping (world units). */
const FIREFLY_EDGE_MARGIN_WORLD = 12.0;

/** Half-size of a spike hitbox in world units (occupies one block). */
const SPIKE_HALF_SIZE_WORLD = BLOCK_SIZE_MEDIUM * 0.5;

/** Half-size of a springboard hitbox in world units. */
const SPRINGBOARD_HALF_WIDTH_WORLD = BLOCK_SIZE_MEDIUM * 0.5;
const SPRINGBOARD_HALF_HEIGHT_WORLD = BLOCK_SIZE_MEDIUM * 0.25;

// ── Spike direction encoding ─────────────────────────────────────────────────
export const SPIKE_DIR_UP = 0;
export const SPIKE_DIR_DOWN = 1;
export const SPIKE_DIR_LEFT = 2;
export const SPIKE_DIR_RIGHT = 3;

/**
 * Bounces a firefly along one axis: clamps `pos` to [min, max] and reflects
 * `vel` so the firefly always moves away from whichever edge it hit.
 */
function bounceAxis(
  pos: number, vel: number, min: number, max: number,
): { pos: number; vel: number } {
  if (pos < min) return { pos: min, vel: Math.abs(vel) };
  if (pos > max) return { pos: max, vel: -Math.abs(vel) };
  return { pos, vel };
}

/**
 * Main hazard update — called once per tick after cluster movement.
 */
export function applyHazards(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const phw = player.halfWidthWorld;
  const phh = player.halfHeightWorld;

  // ── Tick down invulnerability timers ──────────────────────────────────────
  if (world.spikeInvulnTicks > 0) world.spikeInvulnTicks -= 1;
  if (world.lavaInvulnTicks > 0) world.lavaInvulnTicks -= 1;

  // ── Springboard anim countdowns ──────────────────────────────────────────
  for (let i = 0; i < world.springboardCount; i++) {
    if (world.springboardAnimTicks[i] > 0) world.springboardAnimTicks[i] -= 1;
  }

  // ── Spikes ───────────────────────────────────────────────────────────────
  if (world.spikeInvulnTicks === 0) {
    for (let i = 0; i < world.spikeCount; i++) {
      const sx = world.spikeXWorld[i];
      const sy = world.spikeYWorld[i];
      const sLeft = sx - SPIKE_HALF_SIZE_WORLD;
      const sRight = sx + SPIKE_HALF_SIZE_WORLD;
      const sTop = sy - SPIKE_HALF_SIZE_WORLD;
      const sBottom = sy + SPIKE_HALF_SIZE_WORLD;

      if (overlapAABB(px, py, phw, phh, sLeft, sTop, sRight, sBottom)) {
        const sourceXWorld = sx;
        const sourceYWorld = sy;
        applyPlayerDamageWithKnockback(player, SPIKE_DAMAGE, sourceXWorld, sourceYWorld);
        world.spikeInvulnTicks = SPIKE_INVULN_TICKS;
        break; // one spike hit per tick
      }
    }
  }

  // ── Springboards ─────────────────────────────────────────────────────────
  // Only trigger when player is falling and lands on the springboard's top face.
  if (player.velocityYWorld >= 0) {
    for (let i = 0; i < world.springboardCount; i++) {
      const sbx = world.springboardXWorld[i];
      const sby = world.springboardYWorld[i];
      const sbLeft = sbx - SPRINGBOARD_HALF_WIDTH_WORLD;
      const sbRight = sbx + SPRINGBOARD_HALF_WIDTH_WORLD;
      const sbTop = sby - SPRINGBOARD_HALF_HEIGHT_WORLD;

      // Check if player bottom is near springboard top and horizontally aligned
      const playerBottom = py + phh;
      const playerLeft = px - phw;
      const playerRight = px + phw;

      if (
        playerBottom >= sbTop && playerBottom <= sbTop + 4.0 &&
        playerRight > sbLeft && playerLeft < sbRight
      ) {
        // Bounce!
        player.velocityYWorld = -SPRINGBOARD_LAUNCH_SPEED_WORLD;
        player.isGroundedFlag = 0;
        player.varJumpTimerTicks = 0; // no variable jump sustain from spring
        world.springboardAnimTicks[i] = SPRINGBOARD_ANIM_TICKS;
        break;
      }
    }
  }

  // ── Water zones ──────────────────────────────────────────────────────────
  // Check if player center is inside any water zone.
  world.isPlayerInWaterFlag = 0;
  for (let i = 0; i < world.waterZoneCount; i++) {
    const wLeft = world.waterZoneXWorld[i];
    const wTop = world.waterZoneYWorld[i];
    const wRight = wLeft + world.waterZoneWWorld[i];
    const wBottom = wTop + world.waterZoneHWorld[i];

    if (px >= wLeft && px <= wRight && py >= wTop && py <= wBottom) {
      world.isPlayerInWaterFlag = 1;

      // Buoyancy: push player up when below the surface
      if (py > wTop + phh) {
        player.velocityYWorld -= WATER_BUOYANCY_FORCE_WORLD * dtSec;
      }

      // Clamp speeds in water
      if (player.velocityYWorld > WATER_MAX_FALL_SPEED_WORLD) {
        player.velocityYWorld = WATER_MAX_FALL_SPEED_WORLD;
      }
      if (player.velocityXWorld > WATER_MAX_HORIZONTAL_SPEED_WORLD) {
        player.velocityXWorld = WATER_MAX_HORIZONTAL_SPEED_WORLD;
      } else if (player.velocityXWorld < -WATER_MAX_HORIZONTAL_SPEED_WORLD) {
        player.velocityXWorld = -WATER_MAX_HORIZONTAL_SPEED_WORLD;
      }
      break; // one water zone check per tick
    }
  }

  // ── Lava zones ───────────────────────────────────────────────────────────
  if (world.lavaInvulnTicks === 0) {
    for (let i = 0; i < world.lavaZoneCount; i++) {
      const lLeft = world.lavaZoneXWorld[i];
      const lTop = world.lavaZoneYWorld[i];
      const lRight = lLeft + world.lavaZoneWWorld[i];
      const lBottom = lTop + world.lavaZoneHWorld[i];

      if (overlapAABB(px, py, phw, phh, lLeft, lTop, lRight, lBottom)) {
        // Source point is the nearest point on the lava AABB to the player center.
        const sourceXWorld = Math.max(lLeft, Math.min(px, lRight));
        const sourceYWorld = Math.max(lTop, Math.min(py, lBottom));
        applyPlayerDamageWithKnockback(player, LAVA_ZONE_DAMAGE, sourceXWorld, sourceYWorld);
        world.lavaInvulnTicks = LAVA_ZONE_INVULN_TICKS;
        break;
      }
    }
  }

  // ── Breakable blocks ─────────────────────────────────────────────────────
  {
    const playerSpeed = Math.sqrt(
      player.velocityXWorld * player.velocityXWorld +
      player.velocityYWorld * player.velocityYWorld,
    );

    for (let i = 0; i < world.breakableBlockCount; i++) {
      if (world.isBreakableBlockActiveFlag[i] === 0) continue;

      const bx = world.breakableBlockXWorld[i];
      const by = world.breakableBlockYWorld[i];
      const bHalf = BLOCK_SIZE_MEDIUM * 0.5;
      const bLeft = bx - bHalf;
      const bRight = bx + bHalf;
      const bTop = by - bHalf;
      const bBottom = by + bHalf;

      if (
        overlapAABB(px, py, phw, phh, bLeft, bTop, bRight, bBottom) &&
        playerSpeed >= BREAKABLE_MOMENTUM_THRESHOLD_WORLD
      ) {
        // Break the block
        world.isBreakableBlockActiveFlag[i] = 0;

        // Deactivate corresponding wall by zeroing its dimensions
        const wi = world.breakableBlockWallIndex[i];
        if (wi >= 0 && wi < world.wallCount) {
          world.wallWWorld[wi] = 0;
          world.wallHWorld[wi] = 0;
        }
      }
    }
  }

  // ── Dust boost jars ──────────────────────────────────────────────────────
  for (let i = 0; i < world.dustBoostJarCount; i++) {
    if (world.isDustBoostJarActiveFlag[i] === 0) continue;

    const jx = world.dustBoostJarXWorld[i];
    const jy = world.dustBoostJarYWorld[i];
    const dx = px - jx;
    const dy = py - jy;
    if (dx * dx + dy * dy <= JAR_INTERACT_RADIUS_WORLD * JAR_INTERACT_RADIUS_WORLD) {
      // Break the jar — dust spawning is handled by gameScreen
      world.isDustBoostJarActiveFlag[i] = 0;
    }
  }

  // ── Firefly jars ─────────────────────────────────────────────────────────
  for (let i = 0; i < world.fireflyJarCount; i++) {
    if (world.isFireflyJarActiveFlag[i] === 0) continue;

    const jx = world.fireflyJarXWorld[i];
    const jy = world.fireflyJarYWorld[i];
    const dx = px - jx;
    const dy = py - jy;
    if (dx * dx + dy * dy <= JAR_INTERACT_RADIUS_WORLD * JAR_INTERACT_RADIUS_WORLD) {
      // Break the jar and release fireflies
      world.isFireflyJarActiveFlag[i] = 0;

      for (let f = 0; f < FIREFLIES_PER_JAR; f++) {
        if (world.fireflyCount >= MAX_FIREFLIES) break;
        const fi = world.fireflyCount++;
        world.fireflyXWorld[fi] = jx + nextFloatRange(world.rng, -6, 6);
        world.fireflyYWorld[fi] = jy + nextFloatRange(world.rng, -6, 6);
        const angle = nextFloat(world.rng) * Math.PI * 2;
        world.fireflyVelXWorld[fi] = Math.cos(angle) * FIREFLY_SPEED_WORLD;
        world.fireflyVelYWorld[fi] = Math.sin(angle) * FIREFLY_SPEED_WORLD;
      }
    }
  }

  // ── Firefly movement ─────────────────────────────────────────────────────
  for (let i = 0; i < world.fireflyCount; i++) {
    // Periodic direction changes based on tick + index
    if ((world.tick + i * 17) % FIREFLY_DIRECTION_CHANGE_TICKS === 0) {
      const angle = nextFloat(world.rng) * Math.PI * 2;
      world.fireflyVelXWorld[i] = Math.cos(angle) * FIREFLY_SPEED_WORLD;
      world.fireflyVelYWorld[i] = Math.sin(angle) * FIREFLY_SPEED_WORLD;
    }

    world.fireflyXWorld[i] += world.fireflyVelXWorld[i] * dtSec;
    world.fireflyYWorld[i] += world.fireflyVelYWorld[i] * dtSec;

    // Clamp to world bounds and bounce
    const bx = bounceAxis(world.fireflyXWorld[i], world.fireflyVelXWorld[i], FIREFLY_EDGE_MARGIN_WORLD, world.worldWidthWorld  - FIREFLY_EDGE_MARGIN_WORLD);
    world.fireflyXWorld[i]    = bx.pos;
    world.fireflyVelXWorld[i] = bx.vel;
    const by = bounceAxis(world.fireflyYWorld[i], world.fireflyVelYWorld[i], FIREFLY_EDGE_MARGIN_WORLD, world.worldHeightWorld - FIREFLY_EDGE_MARGIN_WORLD);
    world.fireflyYWorld[i]    = by.pos;
    world.fireflyVelYWorld[i] = by.vel;
  }
}
