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
 *   - Crumble block damage/destruction by dust particles
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

// ── Water physics tuning ─────────────────────────────────────────────────────

/**
 * Gravity multiplier when inside a water zone.
 * At 0.12, gravity is very weak — buoyancy force dominates for a strongly
 * floaty feel. Fast divers bleed speed via per-tick drag instead of a hard cap.
 */
export const WATER_GRAVITY_MULTIPLIER = 0.12;

/**
 * Strong upward buoyancy force (world units/s²), scaled by submersion ratio.
 * Full force when fully submerged; partial when only partly in water.
 * Tuned higher so medium/deep submersion consistently pushes the player up.
 */
export const WATER_BUOYANCY_FORCE_WORLD = 700.0;

/**
 * Horizontal drag multiplier applied per tick in water (0–1).
 * 1.0 = no drag; lower = more resistance per tick.
 */
export const WATER_HORIZONTAL_DRAG_FACTOR = 0.90;

/**
 * Vertical drag multiplier applied per tick in water (0–1).
 * Applied AFTER buoyancy so fast dives naturally bleed momentum.
 */
export const WATER_VERTICAL_DRAG_FACTOR = 0.88;

/**
 * Maximum upward float speed in water (negative = upward, wu/s).
 * Prevents the player from rocketing to the surface indefinitely.
 */
export const WATER_MAX_FLOAT_SPEED_WORLD = -80.0;

/**
 * Maximum fall/dive speed in water (wu/s). Set high so fast dives are not
 * capped — rely on WATER_VERTICAL_DRAG_FACTOR instead for natural slow-down.
 */
export const WATER_MAX_FALL_SPEED_WORLD = 400.0;

/**
 * Horizontal speed safety clamp in water (wu/s, extreme edge case only).
 * Normal resistance comes from WATER_HORIZONTAL_DRAG_FACTOR.
 */
export const WATER_MAX_HORIZONTAL_SPEED_WORLD = 80.0;

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

/**
 * Number of ticks to wait between hits on the same crumble block.
 * Prevents a single fast-moving particle stream from consuming multiple hits.
 * At 60 ticks/s this gives a ~0.5 s window.
 */
const CRUMBLE_HIT_COOLDOWN_TICKS = 30;

/** Firefly wander speed (world units/s). */
const FIREFLY_SPEED_WORLD = 30.0;
/** Firefly direction change interval (ticks). */
const FIREFLY_DIRECTION_CHANGE_TICKS = 90;
/** Margin from world edges for firefly clamping (world units). */
const FIREFLY_EDGE_MARGIN_WORLD = 12.0;

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
 * Pre-computes player water state (AABB overlap + submersion ratio) before
 * applyClusterMovement so that playerMovement reads the correct flag for this tick.
 * applyHazards() re-runs the same detection to apply buoyancy/drag physics.
 *
 * Uses AABB overlap instead of center-point: entry fires when the player's
 * feet first break the water surface.
 */
export function computePlayerWaterState(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) {
    world.isPlayerInWaterFlag = 0;
    world.playerWaterSubmersionRatio = 0;
    return;
  }

  const px  = player.positionXWorld;
  const py  = player.positionYWorld;
  const phw = player.halfWidthWorld;
  const phh = player.halfHeightWorld;

  world.isPlayerInWaterFlag = 0;
  world.playerWaterSubmersionRatio = 0;

  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue; // zone is frozen — skip buoyancy
    const wLeft   = world.waterZoneXWorld[i];
    const wTop    = world.waterZoneYWorld[i];
    const wRight  = wLeft + world.waterZoneWWorld[i];
    const wBottom = wTop  + world.waterZoneHWorld[i];

    const pLeft   = px - phw;
    const pRight  = px + phw;
    const pTop    = py - phh;
    const pBottom = py + phh;

    if (pRight <= wLeft || pLeft >= wRight || pBottom <= wTop || pTop >= wBottom) continue;

    // Compute vertical submersion ratio (0 = foot just touching, 1 = fully under)
    const overlapTop    = Math.max(pTop, wTop);
    const overlapBottom = Math.min(pBottom, wBottom);
    const overlapH      = Math.max(0, overlapBottom - overlapTop);
    const playerH       = phh * 2.0;
    const submersion    = playerH > 0.1 ? Math.min(1.0, overlapH / playerH) : 0;

    world.isPlayerInWaterFlag = 1;
    world.playerWaterSubmersionRatio = submersion;
    break;
  }
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
  // Only the half of the spike's footprint nearest its base (i.e. opposite the
  // pointed tip) is damaging — for an upward spike that's the bottom half
  // (bottom 4px of a 1×1 spike, bottom 8px of a 2×2 spike). This keeps a
  // shallow graze of the thin tip from registering as a hit; the player must
  // be overlapping the thicker base region to actually take damage.
  if (world.spikeInvulnTicks === 0) {
    for (let i = 0; i < world.spikeCount; i++) {
      const sx = world.spikeXWorld[i];
      const sy = world.spikeYWorld[i];
      const sizeBlocks = world.spikeSizeBlocks[i] || 1;
      const half = sizeBlocks * BLOCK_SIZE_MEDIUM * 0.5;
      const sLeft = sx - half;
      const sRight = sx + half;
      const sTop = sy - half;
      const sBottom = sy + half;

      // Restrict the hazard AABB to the base half, opposite the tip direction.
      let hazLeft = sLeft, hazRight = sRight, hazTop = sTop, hazBottom = sBottom;
      switch (world.spikeDirection[i]) {
        case SPIKE_DIR_UP:    hazTop = sy;    break; // tip up    → base is bottom half
        case SPIKE_DIR_DOWN:  hazBottom = sy; break; // tip down  → base is top half
        case SPIKE_DIR_LEFT:  hazLeft = sx;   break; // tip left  → base is right half
        case SPIKE_DIR_RIGHT: hazRight = sx;  break; // tip right → base is left half
      }

      if (overlapAABB(px, py, phw, phh, hazLeft, hazTop, hazRight, hazBottom)) {
        const sourceXWorld = sx;
        const sourceYWorld = sy;
        // Throw the player back the way they came: reverse their velocity
        // vector and halve its magnitude, so the damage/knockback blend below
        // starts from a bounce-back rather than the incoming momentum.
        player.velocityXWorld = -player.velocityXWorld * 0.5;
        player.velocityYWorld = -player.velocityYWorld * 0.5;
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
  // isPlayerInWaterFlag + playerWaterSubmersionRatio were pre-computed by
  // computePlayerWaterState() before applyClusterMovement this tick.
  // Re-run AABB detection here to apply buoyancy/drag physics and track entry.
  const wasInWaterLastTick = world.isPlayerWasInWaterLastTickFlag;

  world.isPlayerInWaterFlag = 0;
  world.playerWaterSubmersionRatio = 0;
  world.playerBuoyancySurfaceYWorld = 0;
  world.playerBuoyancyDepthFactor = 0;

  for (let i = 0; i < world.waterZoneCount; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue; // zone is frozen — skip buoyancy
    const wLeft   = world.waterZoneXWorld[i];
    const wTop    = world.waterZoneYWorld[i];
    const wRight  = wLeft + world.waterZoneWWorld[i];
    const wBottom = wTop  + world.waterZoneHWorld[i];

    const pLeft   = px - phw;
    const pRight  = px + phw;
    const pTop    = py - phh;
    const pBottom = py + phh;

    if (pRight <= wLeft || pLeft >= wRight || pBottom <= wTop || pTop >= wBottom) continue;

    const overlapTop    = Math.max(pTop, wTop);
    const overlapBottom = Math.min(pBottom, wBottom);
    const overlapH      = Math.max(0, overlapBottom - overlapTop);
    const playerH       = phh * 2.0;
    const submersion    = playerH > 0.1 ? Math.min(1.0, overlapH / playerH) : 0;

    world.isPlayerInWaterFlag = 1;
    world.playerWaterSubmersionRatio = submersion;
    world.playerBuoyancySurfaceYWorld = wTop;

    // ── Buoyancy ──────────────────────────────────────────────────────────
    // Two-factor upward force: `submersion` (how much body is in water) ×
    // `depthFactor` (how deep the player is relative to the surface).
    //
    // depthFactor is derived from the player's top edge relative to the water
    // surface — mathematically it equals `submersion`, so the net formula is
    // effectively BUOYANCY × submersion².  This naturally tapers to near-zero
    // at the surface (small submersion → small depth → minimal lift) while
    // providing strong upward force deep underwater (large submersion → large
    // depth → full lift).  Combined with the fixed constant waterMult (0.12x
    // gravity) in playerMovement.ts, equilibrium settles at ~39% submersion
    // (player floating with upper body out of water).
    //
    // Formula derivation:
    //   depthFactor = clamp(1 + (pTop - wTop) / playerH, 0, 1)
    //               = clamp(overlapH / playerH, 0, 1)   (when pBottom ≥ wTop)
    //               = submersion      (same as overlapH/playerH, clamped 0→1)
    if (submersion > 0) {
      const depthFactor = submersion;
      world.playerBuoyancyDepthFactor = depthFactor;
      const buoyancyAccelWorldPerSec2 = WATER_BUOYANCY_FORCE_WORLD * submersion * depthFactor;
      player.velocityYWorld -= buoyancyAccelWorldPerSec2 * dtSec;
    }

    // Clamp upward float speed (prevent rocketing to surface)
    if (player.velocityYWorld < WATER_MAX_FLOAT_SPEED_WORLD) {
      player.velocityYWorld = WATER_MAX_FLOAT_SPEED_WORLD;
    }

    // Per-tick drag — bleeds off both downward dive momentum and upward excess
    player.velocityYWorld *= WATER_VERTICAL_DRAG_FACTOR;
    player.velocityXWorld *= WATER_HORIZONTAL_DRAG_FACTOR;

    // Extreme safety clamp horizontal (drag handles normal range)
    if (player.velocityXWorld > WATER_MAX_HORIZONTAL_SPEED_WORLD) {
      player.velocityXWorld = WATER_MAX_HORIZONTAL_SPEED_WORLD;
    } else if (player.velocityXWorld < -WATER_MAX_HORIZONTAL_SPEED_WORLD) {
      player.velocityXWorld = -WATER_MAX_HORIZONTAL_SPEED_WORLD;
    }

    break; // one water zone per tick
  }

  // Update previous-tick flag and record entry speed for splash detection
  world.isPlayerWasInWaterLastTickFlag = world.isPlayerInWaterFlag;
  if (wasInWaterLastTick === 0 && world.isPlayerInWaterFlag === 1) {
    world.playerWaterEntrySpeedWorld = Math.sqrt(
      player.velocityXWorld * player.velocityXWorld +
      player.velocityYWorld * player.velocityYWorld,
    );
  } else if (world.isPlayerInWaterFlag === 0) {
    world.playerWaterEntrySpeedWorld = 0;
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

  // ── Crumble blocks ───────────────────────────────────────────────────────
  // Destroyed by any dust particle (from any cluster) touching the block, OR
  // by the player body AABB overlapping (player walks into it).
  // 2-hit system: first contact cracks the block, second destroys it.
  {
    const bHalf = BLOCK_SIZE_MEDIUM * 0.5;
    for (let i = 0; i < world.crumbleBlockCount; i++) {
      if (world.isCrumbleBlockActiveFlag[i] === 0) continue;

      // Tick down cooldown
      if (world.crumbleBlockHitCooldownTicks[i] > 0) {
        world.crumbleBlockHitCooldownTicks[i] -= 1;
        continue;
      }

      const bx = world.crumbleBlockXWorld[i];
      const by = world.crumbleBlockYWorld[i];
      const bLeft   = bx - bHalf;
      const bRight  = bx + bHalf;
      const bTop    = by - bHalf;
      const bBottom = by + bHalf;

      // Check player body AABB
      let hit = overlapAABB(px, py, phw, phh, bLeft, bTop, bRight, bBottom);

      // Check any alive particle from any cluster
      if (!hit) {
        for (let p = 0; p < world.particleCount; p++) {
          if (world.isAliveFlag[p] === 0) continue;
          const partX = world.positionXWorld[p];
          const partY = world.positionYWorld[p];
          if (partX >= bLeft && partX <= bRight && partY >= bTop && partY <= bBottom) {
            hit = true;
            break;
          }
        }
      }

      if (hit) {
        world.crumbleBlockHitsRemaining[i] -= 1;
        if (world.crumbleBlockHitsRemaining[i] === 0) {
          // Fully destroyed
          world.isCrumbleBlockActiveFlag[i] = 0;
          const wi = world.crumbleBlockWallIndex[i];
          if (wi >= 0 && wi < world.wallCount) {
            world.wallWWorld[wi] = 0;
            world.wallHWorld[wi] = 0;
          }
        } else {
          // Cracked — start cooldown before next hit
          world.crumbleBlockHitCooldownTicks[i] = CRUMBLE_HIT_COOLDOWN_TICKS;
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
