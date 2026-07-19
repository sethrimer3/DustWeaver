/**
 * Dust Weaver Architect — AI state machine.
 *
 * States:
 *   0 = idle       — motes orbit, cooldown ticks down; activates within range
 *   1 = telegraph  — build site chosen; motes stretch toward it; outline shown
 *   2 = build      — blocks materialise at the chosen positions
 *   3 = recover    — motes relax; cooldown resets
 *   4 = dying      — core collapses; owned blocks crumble
 *
 * Architect Blocks are runtime-only hazard entities stored in flat arrays on
 * HazardWorldState.  They are never written to room data or the tile map.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import {
  WorldState,
  MAX_ARCHITECT_BLOCKS,
  MAX_PARTICLES,
} from '../world';
import { nextFloat } from '../rng';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { ParticleKind } from '../particles/kinds';
import {
  DWA_SMALL_MOTE_COUNT,
  DWA_LARGE_MOTE_COUNT,
  DWA_ACTIVATION_RANGE_WORLD,
  DWA_LEASH_RADIUS_WORLD,
  DWA_HOVER_SPEED,
  DWA_VELOCITY_DRAG,
  DWA_BUILD_COOLDOWN_TICKS,
  DWA_TELEGRAPH_DURATION_TICKS,
  DWA_BUILD_DURATION_TICKS,
  DWA_RECOVER_DURATION_TICKS,
  DWA_DEATH_DURATION_TICKS,
  DWA_MOTE_ORBIT_SPEED_RAD_PER_TICK,
  DWA_MOTE_PULSE_FREQ_RAD_PER_TICK,
  DWA_BOB_FREQ_RAD_PER_TICK,
  DWA_MAX_BLOCKS_PER_ARCHITECT,
  DWA_BLOCK_HALF_W,
  DWA_BLOCK_HALF_H,
  DWA_BLOCK_HP_SMALL,
  DWA_BLOCK_HP_LARGE,
  DWA_BLOCK_LIFETIME_TICKS,
  DWA_BLOCK_GRACE_TICKS,
  DWA_BLOCK_FORM_TICKS,
  DWA_BLOCK_CRUMBLE_TICKS,
  DWA_BLOCK_CONTACT_DAMAGE,
  DWA_BLOCK_IFRAMES_TICKS,
  DWA_BLOCK_HIT_RADIUS_WORLD,
  DWA_BLOCK_MIN_DIST_FROM_PLAYER_WORLD,
  DWA_ROOM_EDGE_MARGIN_WORLD,
  DWA_BUILD_SITE_MAX_DIST_WORLD,
  DWA_BUILD_SITE_MIN_DIST_WORLD,
  DWA_PATTERNS,
  DWA_NORMAL_PATTERN_INDICES,
  DWA_LARGE_PATTERN_INDICES,
  MAX_MOTES_PER_DWA,
  MAX_NAILS_PER_DWA,
  DWA_NAIL_MIN_RANGE_WORLD,
  DWA_NAIL_RANGE_PRESSURE_TICKS,
  DWA_NAIL_COOLDOWN_TICKS,
  DWA_NAIL_SPEED_WORLD,
  DWA_NAIL_LIFETIME_TICKS,
  DWA_NAIL_HIT_RADIUS_WORLD,
  DWA_NAIL_DAMAGE,
} from './dustWeaverArchitectConfig';

// ── State identifiers ─────────────────────────────────────────────────────────

export const DWA_STATE_IDLE       = 0;
export const DWA_STATE_TELEGRAPH  = 1;
export const DWA_STATE_BUILD      = 2;
export const DWA_STATE_RECOVER    = 3;
export const DWA_STATE_DYING      = 4;

// ── Block state identifiers ────────────────────────────────────────────────────

export const DWA_BLOCK_STATE_FORMING  = 0;
export const DWA_BLOCK_STATE_ACTIVE   = 1;
export const DWA_BLOCK_STATE_CRUMBLE  = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _moteCount(isLarge: 0 | 1): number {
  return isLarge === 1 ? DWA_LARGE_MOTE_COUNT : DWA_SMALL_MOTE_COUNT;
}

/** Count how many alive Architect Blocks this Architect slot owns. */
function _ownedBlockCount(world: WorldState, slotIndex: number): number {
  let n = 0;
  for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
    if (
      world.isArchitectBlockAliveFlag[bi] === 1 &&
      world.architectBlockOwnerSlot[bi] === slotIndex
    ) {
      n++;
    }
  }
  return n;
}

/**
 * Find a free Architect Block slot and allocate it.
 * Returns the slot index, or -1 if no slot is available.
 */
function _allocateBlock(world: WorldState): number {
  for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
    if (world.isArchitectBlockAliveFlag[bi] === 0) return bi;
  }
  return -1;
}

/**
 * Check whether a block placed at (cx, cy) with half-extents (hw, hh) overlaps
 * any solid wall in the world.
 */
function _overlapsWall(world: WorldState, cx: number, cy: number, hw: number, hh: number): boolean {
  const left   = cx - hw;
  const right  = cx + hw;
  const top    = cy - hh;
  const bottom = cy + hh;
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsInvisibleFlag[wi] === 1) continue;
    const wl = world.wallXWorld[wi];
    const wr = wl + world.wallWWorld[wi];
    const wt = world.wallYWorld[wi];
    const wb = wt + world.wallHWorld[wi];
    if (right > wl && left < wr && bottom > wt && top < wb) return true;
  }
  return false;
}

/**
 * Check whether a block at (cx, cy) overlaps an existing alive Architect Block.
 */
function _overlapsExistingBlock(world: WorldState, cx: number, cy: number, hw: number, hh: number): boolean {
  const left   = cx - hw;
  const right  = cx + hw;
  const top    = cy - hh;
  const bottom = cy + hh;
  for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
    if (world.isArchitectBlockAliveFlag[bi] === 0) continue;
    const bcx = world.architectBlockXWorld[bi];
    const bcy = world.architectBlockYWorld[bi];
    const bl = bcx - DWA_BLOCK_HALF_W;
    const br = bcx + DWA_BLOCK_HALF_W;
    const bt = bcy - DWA_BLOCK_HALF_H;
    const bb = bcy + DWA_BLOCK_HALF_H;
    if (right > bl && left < br && bottom > bt && top < bb) return true;
  }
  return false;
}

/**
 * Validate a candidate block center (cx, cy).
 * Returns true if the position is safe to spawn a block.
 */
function _isValidBlockPos(
  world: WorldState,
  cx: number,
  cy: number,
  playerX: number,
  playerY: number,
): boolean {
  const hw = DWA_BLOCK_HALF_W;
  const hh = DWA_BLOCK_HALF_H;

  // Room bounds
  if (cx - hw < DWA_ROOM_EDGE_MARGIN_WORLD) return false;
  if (cy - hh < DWA_ROOM_EDGE_MARGIN_WORLD) return false;
  if (cx + hw > world.worldWidthWorld  - DWA_ROOM_EDGE_MARGIN_WORLD) return false;
  if (cy + hh > world.worldHeightWorld - DWA_ROOM_EDGE_MARGIN_WORLD) return false;

  // Not on top of the player
  const dpx = cx - playerX;
  const dpy = cy - playerY;
  if (dpx * dpx + dpy * dpy < DWA_BLOCK_MIN_DIST_FROM_PLAYER_WORLD * DWA_BLOCK_MIN_DIST_FROM_PLAYER_WORLD) return false;

  // Not overlapping walls
  if (_overlapsWall(world, cx, cy, hw, hh)) return false;

  // Not overlapping existing blocks
  if (_overlapsExistingBlock(world, cx, cy, hw, hh)) return false;

  return true;
}

/**
 * Choose a build site near the player that is within the valid distance range
 * from the Architect.  Returns true and sets buildSiteX/Y on the cluster on
 * success, or returns false if no suitable site was found.
 */
function _chooseBuildSite(
  world: WorldState,
  architectX: number,
  architectY: number,
  playerX: number,
  playerY: number,
): [number, number] | null {
  // Try several candidate positions spread around the player/between them.
  // Candidate angles: toward player, and ±45°, ±90° offsets.
  const baseAngle = Math.atan2(playerY - architectY, playerX - architectX);
  const candidates: [number, number][] = [];

  // Distance from player for the build site center.
  const distFromPlayer = 30;

  for (let attempt = 0; attempt < 8; attempt++) {
    const angleOffset = (attempt / 8) * Math.PI * 2;
    const siteAngle = baseAngle + angleOffset;
    const sx = playerX + Math.cos(siteAngle) * distFromPlayer;
    const sy = playerY + Math.sin(siteAngle) * distFromPlayer;

    // Check distance from Architect is within allowed range.
    const dax = sx - architectX;
    const day = sy - architectY;
    const dist2 = dax * dax + day * day;
    if (dist2 < DWA_BUILD_SITE_MIN_DIST_WORLD * DWA_BUILD_SITE_MIN_DIST_WORLD) continue;
    if (dist2 > DWA_BUILD_SITE_MAX_DIST_WORLD * DWA_BUILD_SITE_MAX_DIST_WORLD) continue;

    // Check at least one pattern block would be valid at this site.
    // (Full validation happens at build time — here we do a quick centre check.)
    const hw = DWA_BLOCK_HALF_W;
    const hh = DWA_BLOCK_HALF_H;
    if (sx - hw < DWA_ROOM_EDGE_MARGIN_WORLD) continue;
    if (sy - hh < DWA_ROOM_EDGE_MARGIN_WORLD) continue;
    if (sx + hw > world.worldWidthWorld  - DWA_ROOM_EDGE_MARGIN_WORLD) continue;
    if (sy + hh > world.worldHeightWorld - DWA_ROOM_EDGE_MARGIN_WORLD) continue;

    candidates.push([sx, sy]);
  }

  if (candidates.length === 0) return null;

  // Pick a candidate deterministically using the RNG.
  const idx = Math.floor(nextFloat(world.rng) * candidates.length);
  return candidates[Math.min(idx, candidates.length - 1)];
}

/** Spawn a single Architect Block at (cx, cy) owned by the given slot. */
function _spawnBlock(
  world: WorldState,
  cx: number,
  cy: number,
  ownerSlot: number,
  isLarge: 0 | 1,
): boolean {
  const bi = _allocateBlock(world);
  if (bi < 0) return false;

  world.isArchitectBlockAliveFlag[bi]   = 1;
  world.architectBlockXWorld[bi]        = cx;
  world.architectBlockYWorld[bi]        = cy;
  const hp = isLarge === 1 ? DWA_BLOCK_HP_LARGE : DWA_BLOCK_HP_SMALL;
  world.architectBlockHealth[bi]        = hp;
  world.architectBlockMaxHealth[bi]     = hp;
  world.architectBlockLifetimeTicks[bi] = DWA_BLOCK_LIFETIME_TICKS;
  world.architectBlockGraceTicks[bi]    = DWA_BLOCK_GRACE_TICKS;
  world.architectBlockFormTicks[bi]     = DWA_BLOCK_FORM_TICKS;
  world.architectBlockCrumbleTicks[bi]  = 0;
  world.architectBlockState[bi]         = DWA_BLOCK_STATE_FORMING;
  world.architectBlockOwnerSlot[bi]     = ownerSlot;
  world.architectBlockCount             = Math.max(world.architectBlockCount, bi + 1);

  return true;
}

/** Transition an Architect Block into the crumble state. */
function _startCrumble(world: WorldState, bi: number): void {
  if (world.architectBlockState[bi] === DWA_BLOCK_STATE_CRUMBLE) return;
  world.architectBlockState[bi]        = DWA_BLOCK_STATE_CRUMBLE;
  world.architectBlockCrumbleTicks[bi] = DWA_BLOCK_CRUMBLE_TICKS;
}

// ── Per-tick block simulation ─────────────────────────────────────────────────

/** Emit a small burst of dust particles from a block that was destroyed. */
function _emitBlockBurst(world: WorldState, cx: number, cy: number): void {
  const count = 4;
  let spawned = 0;
  for (let pi = 0; pi < MAX_PARTICLES && spawned < count; pi++) {
    if (world.isAliveFlag[pi] === 1) continue;
    const angle = (spawned / count) * Math.PI * 2 + nextFloat(world.rng) * 0.8;
    const speed = 1.5 + nextFloat(world.rng) * 2.0;
    world.positionXWorld[pi]  = cx;
    world.positionYWorld[pi]  = cy;
    world.velocityXWorld[pi]  = Math.cos(angle) * speed;
    world.velocityYWorld[pi]  = Math.sin(angle) * speed;
    world.kindBuffer[pi]      = ParticleKind.Golden;
    world.isAliveFlag[pi]     = 1;
    world.ageTicks[pi]        = 0;
    world.lifetimeTicks[pi]   = 18 + Math.floor(nextFloat(world.rng) * 12);
    world.ownerEntityId[pi]   = -1;
    spawned++;
  }
}

/** Tick all active Architect Blocks — lifetime decay, forming, crumble, player contact. */
function _tickArchitectBlocks(world: WorldState, playerCluster: typeof world.clusters[0] | undefined): void {
  // Cache player bounds for contact checks.
  let playerX = 0;
  let playerY = 0;
  let playerHW = 0;
  let playerHH = 0;
  let hasPlayer = false;
  if (playerCluster !== undefined && playerCluster.isPlayerFlag === 1 && playerCluster.isAliveFlag === 1) {
    playerX  = playerCluster.positionXWorld;
    playerY  = playerCluster.positionYWorld;
    playerHW = playerCluster.halfWidthWorld;
    playerHH = playerCluster.halfHeightWorld;
    hasPlayer = true;
  }

  for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
    if (world.isArchitectBlockAliveFlag[bi] === 0) continue;

    const state = world.architectBlockState[bi];

    // ── Forming ────────────────────────────────────────────────────────────────
    if (state === DWA_BLOCK_STATE_FORMING) {
      if (world.architectBlockFormTicks[bi] > 0) {
        world.architectBlockFormTicks[bi]--;
      } else {
        world.architectBlockState[bi] = DWA_BLOCK_STATE_ACTIVE;
      }
      // Tick down grace during forming too.
      if (world.architectBlockGraceTicks[bi] > 0) world.architectBlockGraceTicks[bi]--;
      continue;
    }

    // ── Crumbling ──────────────────────────────────────────────────────────────
    if (state === DWA_BLOCK_STATE_CRUMBLE) {
      if (world.architectBlockCrumbleTicks[bi] > 0) {
        world.architectBlockCrumbleTicks[bi]--;
      } else {
        // Fully crumbled — free the slot.
        world.isArchitectBlockAliveFlag[bi] = 0;
        world.architectBlockOwnerSlot[bi]   = -1;
      }
      continue;
    }

    // ── Active ─────────────────────────────────────────────────────────────────
    // Countdown grace period.
    if (world.architectBlockGraceTicks[bi] > 0) {
      world.architectBlockGraceTicks[bi]--;
    }

    // Tick lifetime down, start crumble when expired.
    if (world.architectBlockLifetimeTicks[bi] > 0) {
      world.architectBlockLifetimeTicks[bi]--;
    } else {
      _startCrumble(world, bi);
      continue;
    }

    // Health → crumble if destroyed.
    if (world.architectBlockHealth[bi] === 0) {
      _emitBlockBurst(world, world.architectBlockXWorld[bi], world.architectBlockYWorld[bi]);
      _startCrumble(world, bi);
      continue;
    }

    // Player contact damage (hazard-only — not solid).
    if (hasPlayer && world.architectBlockGraceTicks[bi] === 0 && playerCluster !== undefined) {
      const bcx = world.architectBlockXWorld[bi];
      const bcy = world.architectBlockYWorld[bi];
      const overlapX = Math.abs(playerX - bcx) < (playerHW + DWA_BLOCK_HALF_W);
      const overlapY = Math.abs(playerY - bcy) < (playerHH + DWA_BLOCK_HALF_H);
      if (overlapX && overlapY) {
        applyPlayerDamageWithKnockback(
          playerCluster,
          DWA_BLOCK_CONTACT_DAMAGE,
          bcx,
          bcy,
        );
        // Start a fresh grace period on the block to avoid re-triggering immediately.
        world.architectBlockGraceTicks[bi] = DWA_BLOCK_IFRAMES_TICKS;
      }
    }

    // Player particle damage: check all live player-owned particles.
    if (playerCluster !== undefined) {
      const bcx = world.architectBlockXWorld[bi];
      const bcy = world.architectBlockYWorld[bi];
      const hitR2 = DWA_BLOCK_HIT_RADIUS_WORLD * DWA_BLOCK_HIT_RADIUS_WORLD;
      for (let pi = 0; pi < MAX_PARTICLES; pi++) {
        if (world.isAliveFlag[pi] === 0) continue;
        if (world.ownerEntityId[pi] !== playerCluster.entityId) continue;
        const dpx = world.positionXWorld[pi] - bcx;
        const dpy = world.positionYWorld[pi] - bcy;
        if (dpx * dpx + dpy * dpy < hitR2) {
          // Particle hits block — deal 1 damage and consume the particle.
          if (world.architectBlockHealth[bi] > 0) {
            world.architectBlockHealth[bi]--;
          }
          world.isAliveFlag[pi] = 0;
          break; // One hit per tick per block is enough.
        }
      }
    }
  }
}

// ── Per-Architect tick ────────────────────────────────────────────────────────

function _tickArchitect(world: WorldState, ci: number): void {
  const cluster = world.clusters[ci];
  if (cluster.isDustWeaverArchitectFlag !== 1) return;
  if (cluster.isAliveFlag === 0) return;

  const slot     = cluster.dustWeaverArchitectSlotIndex;
  const isLarge  = cluster.isDustWeaverArchitectLargeFlag;
  const moteCount = _moteCount(isLarge);
  const moteBase  = slot >= 0 ? slot * MAX_MOTES_PER_DWA : -1;

  // Detect external death (HP → 0 from particle hits via forces.ts).
  if (cluster.healthPoints <= 0 && cluster.dustWeaverArchitectState !== DWA_STATE_DYING) {
    cluster.dustWeaverArchitectState      = DWA_STATE_DYING;
    cluster.dustWeaverArchitectStateTicks = 0;
    // Crumble all owned blocks.
    if (slot >= 0) {
      for (let bi = 0; bi < MAX_ARCHITECT_BLOCKS; bi++) {
        if (
          world.isArchitectBlockAliveFlag[bi] === 1 &&
          world.architectBlockOwnerSlot[bi] === slot
        ) {
          _startCrumble(world, bi);
        }
      }
    }
  }

  // Hit flash countdown.
  if (cluster.dustWeaverArchitectHitFlashTicks > 0) {
    cluster.dustWeaverArchitectHitFlashTicks--;
  }
  // Hit flash is set in forces.ts whenever the Architect takes particle damage.

  const state      = cluster.dustWeaverArchitectState;
  const stateTicks = cluster.dustWeaverArchitectStateTicks;

  // Find the player cluster.
  let playerX = cluster.positionXWorld;
  let playerY = cluster.positionYWorld;
  let playerCluster: typeof world.clusters[0] | undefined;
  for (let k = 0; k < world.clusters.length; k++) {
    if (world.clusters[k].isPlayerFlag === 1 && world.clusters[k].isAliveFlag === 1) {
      playerCluster = world.clusters[k];
      playerX = playerCluster.positionXWorld;
      playerY = playerCluster.positionYWorld;
      break;
    }
  }

  const spawnX = cluster.dustWeaverArchitectSpawnXWorld;
  const spawnY = cluster.dustWeaverArchitectSpawnYWorld;

  // ── Dust Nail range-pressure system ──────────────────────────────────────
  // Only fires during Idle (not while building/recovering/dying).
  // If the player stays far away long enough, fire a Dust Nail as secondary pressure.
  if (cluster.dustWeaverArchitectNailCooldownTicks > 0) {
    cluster.dustWeaverArchitectNailCooldownTicks--;
  }
  if (state === DWA_STATE_IDLE && cluster.isAliveFlag === 1 && playerCluster !== undefined) {
    const ndx = playerX - cluster.positionXWorld;
    const ndy = playerY - cluster.positionYWorld;
    const nd2 = ndx * ndx + ndy * ndy;
    if (nd2 > DWA_NAIL_MIN_RANGE_WORLD * DWA_NAIL_MIN_RANGE_WORLD) {
      // Player is at range — accumulate pressure.
      if (cluster.dustWeaverArchitectNailCooldownTicks === 0) {
        cluster.dustWeaverArchitectRangePressureTicks++;
      }
      if (cluster.dustWeaverArchitectRangePressureTicks >= DWA_NAIL_RANGE_PRESSURE_TICKS) {
        // Fire a Dust Nail toward the player.
        _fireNail(world, slot, cluster.positionXWorld, cluster.positionYWorld, playerX, playerY);
        cluster.dustWeaverArchitectRangePressureTicks = 0;
        cluster.dustWeaverArchitectNailCooldownTicks  = DWA_NAIL_COOLDOWN_TICKS;
      }
    } else {
      // Player is close — reset pressure timer.
      cluster.dustWeaverArchitectRangePressureTicks = 0;
    }
  }

  // ── Update mote orbit angles ──────────────────────────────────────────────
  if (moteBase >= 0) {
    for (let m = 0; m < moteCount; m++) {
      const mi = moteBase + m;
      world.dwaMoteAngleRad[mi]       = (world.dwaMoteAngleRad[mi] + DWA_MOTE_ORBIT_SPEED_RAD_PER_TICK) % (Math.PI * 2);
      world.dwaMotePulsePhaseRad[mi]  = (world.dwaMotePulsePhaseRad[mi] + DWA_MOTE_PULSE_FREQ_RAD_PER_TICK) % (Math.PI * 2);
    }
  }

  // ── Bob phase ──────────────────────────────────────────────────────────────
  cluster.dustWeaverArchitectBobPhaseRad =
    (cluster.dustWeaverArchitectBobPhaseRad + DWA_BOB_FREQ_RAD_PER_TICK) % (Math.PI * 2);

  // ── State machine ──────────────────────────────────────────────────────────

  switch (state) {
    // ── Idle ──────────────────────────────────────────────────────────────────
    case DWA_STATE_IDLE: {
      // Light hover drift toward the spawn point if the Architect has wandered.
      const dsx = spawnX - cluster.positionXWorld;
      const dsy = spawnY - cluster.positionYWorld;
      const dist2 = dsx * dsx + dsy * dsy;
      if (dist2 > 4) {
        const dist = Math.sqrt(dist2);
        const t = Math.min(DWA_HOVER_SPEED / dist, 0.05);
        cluster.velocityXWorld += dsx * t;
        cluster.velocityYWorld += dsy * t;
      }

      // Apply drag.
      cluster.velocityXWorld *= DWA_VELOCITY_DRAG;
      cluster.velocityYWorld *= DWA_VELOCITY_DRAG;

      // Tick cooldown.
      if (cluster.dustWeaverArchitectAttackCooldownTicks > 0) {
        cluster.dustWeaverArchitectAttackCooldownTicks--;
        cluster.dustWeaverArchitectStateTicks++;
        break;
      }

      // Check activation range.
      const dpx = playerX - cluster.positionXWorld;
      const dpy = playerY - cluster.positionYWorld;
      const d2  = dpx * dpx + dpy * dpy;
      if (d2 > DWA_ACTIVATION_RANGE_WORLD * DWA_ACTIVATION_RANGE_WORLD) {
        cluster.dustWeaverArchitectStateTicks++;
        break;
      }

      // Choose build site and transition to Telegraph.
      // Per-Architect block cap pre-check: skip if already at the limit.
      if (_ownedBlockCount(world, slot) >= DWA_MAX_BLOCKS_PER_ARCHITECT) {
        // Already at cap; wait a bit before re-checking.
        cluster.dustWeaverArchitectAttackCooldownTicks = 60;
        cluster.dustWeaverArchitectStateTicks++;
        break;
      }

      const site = _chooseBuildSite(
        world,
        cluster.positionXWorld,
        cluster.positionYWorld,
        playerX,
        playerY,
      );
      if (site === null) {
        // No valid site; wait a bit before trying again.
        cluster.dustWeaverArchitectAttackCooldownTicks = 60;
        cluster.dustWeaverArchitectStateTicks++;
        break;
      }

      // Pick pattern — large-variant Architects get weighted large patterns.
      const isLargeVariant = cluster.isDustWeaverArchitectLargeFlag === 1;
      const patternPool = isLargeVariant ? DWA_LARGE_PATTERN_INDICES : DWA_NORMAL_PATTERN_INDICES;
      const patternIdx  = patternPool[Math.floor(nextFloat(world.rng) * patternPool.length)];
      cluster.dustWeaverArchitectBuildSiteXWorld   = site[0];
      cluster.dustWeaverArchitectBuildSiteYWorld   = site[1];
      cluster.dustWeaverArchitectBuildPatternIndex = patternIdx;
      cluster.dustWeaverArchitectState             = DWA_STATE_TELEGRAPH;
      cluster.dustWeaverArchitectStateTicks        = 0;
      break;
    }

    // ── Telegraph ────────────────────────────────────────────────────────────
    case DWA_STATE_TELEGRAPH: {
      // Architect slowly drifts toward the build site.
      const bsX = cluster.dustWeaverArchitectBuildSiteXWorld;
      const bsY = cluster.dustWeaverArchitectBuildSiteYWorld;
      const tdx = bsX - cluster.positionXWorld;
      const tdy = bsY - cluster.positionYWorld;
      const td  = Math.sqrt(tdx * tdx + tdy * tdy) + 0.001;
      if (td > 10) {
        const tSpeed = Math.min(DWA_HOVER_SPEED * 0.4, td * 0.02);
        cluster.velocityXWorld += (tdx / td) * tSpeed;
        cluster.velocityYWorld += (tdy / td) * tSpeed;
      }
      cluster.velocityXWorld *= DWA_VELOCITY_DRAG;
      cluster.velocityYWorld *= DWA_VELOCITY_DRAG;

      cluster.dustWeaverArchitectStateTicks++;
      if (stateTicks >= DWA_TELEGRAPH_DURATION_TICKS) {
        cluster.dustWeaverArchitectState      = DWA_STATE_BUILD;
        cluster.dustWeaverArchitectStateTicks = 0;
      }
      break;
    }

    // ── Build ─────────────────────────────────────────────────────────────────
    case DWA_STATE_BUILD: {
      if (stateTicks === 0) {
        // Materialise blocks on the first tick of Build.
        const bsX = cluster.dustWeaverArchitectBuildSiteXWorld;
        const bsY = cluster.dustWeaverArchitectBuildSiteYWorld;
        const patternIdx = cluster.dustWeaverArchitectBuildPatternIndex;
        const pattern = DWA_PATTERNS[patternIdx] ?? DWA_PATTERNS[0];

        let blocksThisArch = _ownedBlockCount(world, slot);
        for (const [dxBlocks, dyBlocks] of pattern) {
          if (blocksThisArch >= DWA_MAX_BLOCKS_PER_ARCHITECT) break;

          const blockCX = bsX + dxBlocks * (DWA_BLOCK_HALF_W * 2);
          const blockCY = bsY + dyBlocks * (DWA_BLOCK_HALF_H * 2);

          if (!_isValidBlockPos(world, blockCX, blockCY, playerX, playerY)) continue;

          if (_spawnBlock(world, blockCX, blockCY, slot, isLarge)) {
            blocksThisArch++;
          }
        }
      }

      cluster.velocityXWorld *= DWA_VELOCITY_DRAG;
      cluster.velocityYWorld *= DWA_VELOCITY_DRAG;
      cluster.dustWeaverArchitectStateTicks++;
      if (stateTicks >= DWA_BUILD_DURATION_TICKS) {
        cluster.dustWeaverArchitectState             = DWA_STATE_RECOVER;
        cluster.dustWeaverArchitectStateTicks        = 0;
        cluster.dustWeaverArchitectAttackCooldownTicks = DWA_BUILD_COOLDOWN_TICKS;
      }
      break;
    }

    // ── Recover ───────────────────────────────────────────────────────────────
    case DWA_STATE_RECOVER: {
      // Drift back toward spawn.
      const dsx = spawnX - cluster.positionXWorld;
      const dsy = spawnY - cluster.positionYWorld;
      const dist = Math.sqrt(dsx * dsx + dsy * dsy) + 0.001;
      if (dist > 4) {
        const t = Math.min(DWA_HOVER_SPEED * 0.5 / dist, 0.04);
        cluster.velocityXWorld += dsx * t;
        cluster.velocityYWorld += dsy * t;
      }
      cluster.velocityXWorld *= DWA_VELOCITY_DRAG;
      cluster.velocityYWorld *= DWA_VELOCITY_DRAG;

      cluster.dustWeaverArchitectStateTicks++;
      if (stateTicks >= DWA_RECOVER_DURATION_TICKS) {
        cluster.dustWeaverArchitectState      = DWA_STATE_IDLE;
        cluster.dustWeaverArchitectStateTicks = 0;
      }
      break;
    }

    // ── Dying ─────────────────────────────────────────────────────────────────
    case DWA_STATE_DYING: {
      cluster.velocityXWorld *= DWA_VELOCITY_DRAG;
      cluster.velocityYWorld *= DWA_VELOCITY_DRAG;
      cluster.dustWeaverArchitectStateTicks++;
      if (stateTicks >= DWA_DEATH_DURATION_TICKS) {
        cluster.isAliveFlag = 0;
      }
      break;
    }
  }

  // Apply bob offset (visual only — stored in bob phase, applied by renderer).
  // Clamp Architect position within leash radius from spawn.
  const ldx = cluster.positionXWorld - spawnX;
  const ldy = cluster.positionYWorld - spawnY;
  const ld2 = ldx * ldx + ldy * ldy;
  if (ld2 > DWA_LEASH_RADIUS_WORLD * DWA_LEASH_RADIUS_WORLD) {
    const ld = Math.sqrt(ld2);
    cluster.positionXWorld = spawnX + (ldx / ld) * DWA_LEASH_RADIUS_WORLD;
    cluster.positionYWorld = spawnY + (ldy / ld) * DWA_LEASH_RADIUS_WORLD;
    cluster.velocityXWorld *= 0.5;
    cluster.velocityYWorld *= 0.5;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/** Fire a single Dust Nail from an Architect toward the player. */
function _fireNail(
  world: WorldState,
  arcSlot: number,
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): void {
  const base   = arcSlot * MAX_NAILS_PER_DWA;
  const dx     = targetX - originX;
  const dy     = targetY - originY;
  const len    = Math.sqrt(dx * dx + dy * dy) + 0.001;
  const vx     = (dx / len) * DWA_NAIL_SPEED_WORLD;
  const vy     = (dy / len) * DWA_NAIL_SPEED_WORLD;
  // Find a free nail slot for this Architect.
  for (let n = 0; n < MAX_NAILS_PER_DWA; n++) {
    const idx = base + n;
    if (world.isDwaNailAliveFlag[idx] === 0) {
      world.isDwaNailAliveFlag[idx]   = 1;
      world.dwaNailXWorld[idx]        = originX;
      world.dwaNailYWorld[idx]        = originY;
      world.dwaNailVelXWorld[idx]     = vx;
      world.dwaNailVelYWorld[idx]     = vy;
      world.dwaNailLifetimeTicks[idx] = DWA_NAIL_LIFETIME_TICKS;
      break; // Only one nail per fire event.
    }
  }
}

/** Tick all active Dust Nail projectiles — move, expire, and check player hit. */
function _tickDwaNails(world: WorldState, playerCluster: typeof world.clusters[0] | undefined): void {
  const total = world.isDwaNailAliveFlag.length;
  if (total === 0) return;

  const hitR2 = DWA_NAIL_HIT_RADIUS_WORLD * DWA_NAIL_HIT_RADIUS_WORLD;

  for (let idx = 0; idx < total; idx++) {
    if (world.isDwaNailAliveFlag[idx] === 0) continue;

    // Move.
    world.dwaNailXWorld[idx] += world.dwaNailVelXWorld[idx];
    world.dwaNailYWorld[idx] += world.dwaNailVelYWorld[idx];

    // Expire.
    if (world.dwaNailLifetimeTicks[idx] > 0) {
      world.dwaNailLifetimeTicks[idx]--;
    } else {
      world.isDwaNailAliveFlag[idx] = 0;
      continue;
    }

    // Player hit check.
    if (playerCluster !== undefined && playerCluster.isAliveFlag === 1) {
      const dpx = world.dwaNailXWorld[idx] - playerCluster.positionXWorld;
      const dpy = world.dwaNailYWorld[idx] - playerCluster.positionYWorld;
      if (dpx * dpx + dpy * dpy < hitR2) {
        applyPlayerDamageWithKnockback(
          playerCluster,
          DWA_NAIL_DAMAGE,
          world.dwaNailXWorld[idx],
          world.dwaNailYWorld[idx],
        );
        world.isDwaNailAliveFlag[idx] = 0;
      }
    }
  }
}

export function applyDustWeaverArchitectAI(world: WorldState): void {
  // Find player cluster once.
  let playerCluster: typeof world.clusters[0] | undefined;
  for (let k = 0; k < world.clusters.length; k++) {
    if (world.clusters[k].isPlayerFlag === 1 && world.clusters[k].isAliveFlag === 1) {
      playerCluster = world.clusters[k];
      break;
    }
  }

  // Tick each Architect cluster.
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isDustWeaverArchitectFlag === 1) {
      _tickArchitect(world, ci);
    }
  }

  // Tick all Architect Blocks (shared system).
  _tickArchitectBlocks(world, playerCluster);

  // Tick all Dust Nail projectiles (secondary ranged pressure).
  _tickDwaNails(world, playerCluster);
}
