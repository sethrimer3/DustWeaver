/**
 * Arrow Weave — charge-and-release arrow system.
 *
 * When the player holds the secondary weave button:
 *   - 2 motes load instantly
 *   - 3rd mote loads after MOTE_3_LOAD_TICKS (0.5 s at 60 fps)
 *   - 4th mote loads after MOTE_4_LOAD_TICKS (1.0 s total)
 *
 * On release an arrow fires toward the cursor:
 *   - 2 motes: parabolic (gravity 200 wu/s², speed 180 wu/s)
 *   - 3 motes: parabolic, more velocity (gravity 140 wu/s², speed 260 wu/s)
 *   - 4 motes: straight line (no gravity, speed 320 wu/s)
 *
 * Arrows stick into terrain and persist for 5 / 7 / 10 seconds.
 * Stuck arrows damage enemies on contact; each mote hits individually in sequence.
 * Flying arrows that contact an enemy also trigger the mote sequence, then vanish.
 */

import { WorldState, MAX_ARROWS } from '../world';
import { raycastWalls } from '../clusters/grappleMiss';
import {
  getAvailableMoteSlotCount,
  depleteFirstNMoteSlots,
} from '../motes/orderedMoteQueue';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Ticks from loading start until mote 3 appears (0.5 s at 60 fps). */
const MOTE_3_LOAD_TICKS = 30;
/** Total ticks from loading start until mote 4 appears (1.0 s at 60 fps). */
const MOTE_4_LOAD_TICKS = 60;

/** Initial speed (wu/s) for each arrow tier. */
const ARROW_SPEED_2_WORLD = 180.0;
const ARROW_SPEED_3_WORLD = 260.0;
const ARROW_SPEED_4_WORLD = 320.0;

/** Downward gravity acceleration (wu/s²) per tier.  0 = straight-line (4-mote). */
const ARROW_GRAVITY_2_WS2 = 200.0;
const ARROW_GRAVITY_3_WS2 = 140.0;
const ARROW_GRAVITY_4_WS2 = 0.0;

/** Stuck-arrow lifetime (ticks) per tier — also used by the renderer for fade calculations. */
export const ARROW_LIFETIME_2_TICKS = 300;  // 5 s
export const ARROW_LIFETIME_3_TICKS = 420;  // 7 s
export const ARROW_LIFETIME_4_TICKS = 600;  // 10 s

/** World-space gap between consecutive motes in the arrow line. */
export const ARROW_MOTE_SPACING_WORLD = 3.0;

/** Contact radius (wu) for enemy proximity detection. */
const ARROW_ENEMY_HIT_RADIUS_WORLD = 4.0;

/** Damage per mote hit (1 per mote = balanced, predictable). */
const ARROW_MOTE_DAMAGE = 1;

/** Ticks of delay between consecutive mote hits on an enemy. */
const MOTE_HIT_DELAY_TICKS = 8;

/** Ticks before a stuck arrow can start another hit-sequence on the same enemy. */
const ARROW_DAMAGE_COOLDOWN_TICKS = 90;

// ── Private helpers ───────────────────────────────────────────────────────────

function _gravity(moteCount: number): number {
  if (moteCount === 4) return ARROW_GRAVITY_4_WS2;
  if (moteCount === 3) return ARROW_GRAVITY_3_WS2;
  return ARROW_GRAVITY_2_WS2;
}

function _lifetime(moteCount: number): number {
  if (moteCount === 4) return ARROW_LIFETIME_4_TICKS;
  if (moteCount === 3) return ARROW_LIFETIME_3_TICKS;
  return ARROW_LIFETIME_2_TICKS;
}

function _findFreeSlot(world: WorldState): number {
  // Reuse slots whose lifetime has expired
  for (let i = 0; i < world.arrowCount; i++) {
    if (world.arrowLifetimeTicksLeft[i] <= 0) return i;
  }
  // Extend array if capacity allows
  if (world.arrowCount < MAX_ARROWS) return world.arrowCount++;
  return -1;
}

// ── Public API: loading lifecycle ─────────────────────────────────────────────

/** Called when the player begins holding the arrow weave input. */
export function startArrowLoading(world: WorldState): void {
  // When the ordered mote queue is configured, require at least 2 available
  // motes to form the minimum (2-mote) arrow.  If not enough motes, silently
  // abort so the player gets no bow visual and no accidental empty fire.
  if (world.moteSlotCount > 0 && getAvailableMoteSlotCount(world) < 2) return;
  world.isArrowWeaveLoadingFlag = 1;
  world.arrowWeaveLoadStartTick = world.tick;
  world.arrowWeaveCurrentMoteCount = 2; // 2 motes snap in immediately
}

/**
 * Called each tick while the player is holding the arrow weave input.
 * Advances the mote count as loading thresholds are crossed.
 *
 * When the ordered mote queue is configured, the mote count is also capped
 * by the number of currently available queue slots.  If a combat hit depletes
 * motes mid-charge and available drops below 2, loading is cancelled (the
 * arrow would be too weak to fire) so the player must re-press.
 */
export function updateArrowLoading(world: WorldState): void {
  if (world.isArrowWeaveLoadingFlag === 0) return;
  const elapsed = world.tick - world.arrowWeaveLoadStartTick;
  let timeBasedMoteCount: number;
  if (elapsed >= MOTE_4_LOAD_TICKS) {
    timeBasedMoteCount = 4;
  } else if (elapsed >= MOTE_3_LOAD_TICKS) {
    timeBasedMoteCount = 3;
  } else {
    timeBasedMoteCount = 2;
  }

  // Cap by available mote queue when configured.
  if (world.moteSlotCount > 0) {
    const available = getAvailableMoteSlotCount(world);
    if (available < 2) {
      // Not enough motes to sustain the minimum arrow — cancel loading.
      cancelArrowLoading(world);
      return;
    }
    timeBasedMoteCount = Math.min(timeBasedMoteCount, available);
  }

  world.arrowWeaveCurrentMoteCount = timeBasedMoteCount;
}

/** Cancels the in-progress load without firing. */
export function cancelArrowLoading(world: WorldState): void {
  world.isArrowWeaveLoadingFlag = 0;
  world.arrowWeaveCurrentMoteCount = 0;
}

/**
 * Fires an arrow toward the current aim direction, consuming the loaded motes.
 * The arrow tip spawns at the player's center; velocity is the aim direction
 * scaled by the tier speed.
 */
export function fireArrowFromLoading(
  world: WorldState,
  playerXWorld: number,
  playerYWorld: number,
): void {
  if (world.isArrowWeaveLoadingFlag === 0) {
    return;
  }

  const moteCount = world.arrowWeaveCurrentMoteCount;
  world.isArrowWeaveLoadingFlag = 0;
  world.arrowWeaveCurrentMoteCount = 0;

  if (moteCount < 2) return;

  const slot = _findFreeSlot(world);
  if (slot === -1) return; // No room; silently discard

  const aimDirX = world.playerWeaveAimDirXWorld;
  const aimDirY = world.playerWeaveAimDirYWorld;

  const speed = moteCount === 4 ? ARROW_SPEED_4_WORLD
    : moteCount === 3 ? ARROW_SPEED_3_WORLD
    : ARROW_SPEED_2_WORLD;

  world.arrowXWorld[slot]                = playerXWorld;
  world.arrowYWorld[slot]                = playerYWorld;
  world.arrowVelXWorld[slot]             = aimDirX * speed;
  world.arrowVelYWorld[slot]             = aimDirY * speed;
  world.arrowDirXWorld[slot]             = aimDirX;
  world.arrowDirYWorld[slot]             = aimDirY;
  world.arrowMoteCount[slot]             = moteCount;
  world.isArrowStuckFlag[slot]           = 0;
  world.isArrowHitEnemyFlag[slot]        = 0;
  world.arrowLifetimeTicksLeft[slot]     = _lifetime(moteCount);
  world.arrowHitSequenceMotesLeft[slot]  = 0;
  world.arrowHitSequenceDelayTicks[slot] = 0;
  world.arrowHitTargetClusterIndex[slot] = -1;
  world.arrowDamageCooldownTicks[slot]   = 0;

  // Phase 10: spend the ordered mote slots that formed this arrow.
  // The first `moteCount` available queue slots are depleted immediately on
  // fire, so grapple range, sword length, and shield density all shrink
  // until the motes regenerate (BASE_MOTE_REGENERATION_TICKS ≈ 3 s).
  // No-op when the mote queue is not configured (moteSlotCount === 0).
  depleteFirstNMoteSlots(world, moteCount);
}

// ── Per-tick simulation ───────────────────────────────────────────────────────

/** Moves a single in-flight arrow: apply gravity, advance position, detect wall sticking. */
function _updateArrowFlight(world: WorldState, i: number, dtSec: number): void {
  const gravity = _gravity(world.arrowMoteCount[i]);

  // Apply gravity to vertical velocity
  world.arrowVelYWorld[i] += gravity * dtSec;

  // Displacement vector this tick
  const dx = world.arrowVelXWorld[i] * dtSec;
  const dy = world.arrowVelYWorld[i] * dtSec;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist > 0.001) {
    const ndx = dx / dist;
    const ndy = dy / dist;

    // Update direction from current velocity before any wall test
    // (so the arrow's visual direction is correct even when it sticks)
    world.arrowDirXWorld[i] = ndx;
    world.arrowDirYWorld[i] = ndy;

    const hit = raycastWalls(world, world.arrowXWorld[i], world.arrowYWorld[i], ndx, ndy, dist);

    if (hit !== null) {
      world.arrowXWorld[i]    = hit.x;
      world.arrowYWorld[i]    = hit.y;
      world.arrowVelXWorld[i] = 0;
      world.arrowVelYWorld[i] = 0;
      world.isArrowStuckFlag[i] = 1;
      return;
    }
  }

  // No wall hit — advance position
  world.arrowXWorld[i] += dx;
  world.arrowYWorld[i] += dy;
}

/**
 * Checks whether a flying or stuck arrow contacts any enemy cluster.
 * On first contact, arms the mote-hit sequence for that arrow.
 */
function _checkArrowEnemyHit(world: WorldState, i: number): void {
  // Skip if already in a hit sequence
  if (world.arrowHitTargetClusterIndex[i] !== -1) return;
  if (world.arrowDamageCooldownTicks[i] > 0) return;

  const moteCount = world.arrowMoteCount[i];
  const hitRadSq = ARROW_ENEMY_HIT_RADIUS_WORLD * ARROW_ENEMY_HIT_RADIUS_WORLD;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;
    if (cluster.isPlayerFlag === 1) continue;

    const ex = cluster.positionXWorld;
    const ey = cluster.positionYWorld;

    // Check each mote position against this enemy
    let hit = false;
    for (let m = 0; m < moteCount; m++) {
      const mx = world.arrowXWorld[i] - world.arrowDirXWorld[i] * m * ARROW_MOTE_SPACING_WORLD;
      const my = world.arrowYWorld[i] - world.arrowDirYWorld[i] * m * ARROW_MOTE_SPACING_WORLD;
      const ddx = mx - ex;
      const ddy = my - ey;
      if (ddx * ddx + ddy * ddy < hitRadSq) {
        hit = true;
        break;
      }
    }

    if (hit) {
      world.arrowHitTargetClusterIndex[i]  = ci;
      world.arrowHitSequenceMotesLeft[i]   = moteCount;
      world.arrowHitSequenceDelayTicks[i]  = 0; // first hit is immediate
      break;
    }
  }
}

/**
 * Ticks down the mote-hit sequence for an arrow and applies damage when each
 * mote delay expires.
 */
function _tickArrowHitSequence(world: WorldState, i: number): void {
  if (world.arrowHitTargetClusterIndex[i] === -1) return;

  if (world.arrowHitSequenceDelayTicks[i] > 0) {
    world.arrowHitSequenceDelayTicks[i]--;
    return;
  }

  // Deliver next mote hit
  if (world.arrowHitSequenceMotesLeft[i] > 0) {
    const ci = world.arrowHitTargetClusterIndex[i];
    if (ci >= 0 && ci < world.clusters.length) {
      const cluster = world.clusters[ci];
      if (cluster.isAliveFlag === 1) {
        cluster.healthPoints -= ARROW_MOTE_DAMAGE;
        if (cluster.healthPoints <= 0) {
          cluster.healthPoints = 0;
          cluster.isAliveFlag = 0;
        }
      }
    }

    world.arrowHitSequenceMotesLeft[i]--;
    world.arrowHitSequenceDelayTicks[i] = MOTE_HIT_DELAY_TICKS;
  }

  // Hit sequence complete
  if (world.arrowHitSequenceMotesLeft[i] === 0) {
    world.arrowHitTargetClusterIndex[i] = -1;

    if (world.isArrowHitEnemyFlag[i] === 1) {
      // Flying arrow hit an enemy — remove it after the sequence
      world.arrowLifetimeTicksLeft[i] = 0;
    } else {
      // Stuck arrow — set damage cooldown before it can hit again
      world.arrowDamageCooldownTicks[i] = ARROW_DAMAGE_COOLDOWN_TICKS;
    }
  }
}

/**
 * Main per-tick update for all active arrows.  Called from tick.ts after
 * cluster movement but before particle force accumulation.
 */
export function tickArrows(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  for (let i = 0; i < world.arrowCount; i++) {
    if (world.arrowLifetimeTicksLeft[i] <= 0) continue;

    // Decrement damage cooldown
    if (world.arrowDamageCooldownTicks[i] > 0) {
      world.arrowDamageCooldownTicks[i]--;
    }

    // If flying and not in an enemy-hit state, update flight physics
    if (world.isArrowStuckFlag[i] === 0 && world.isArrowHitEnemyFlag[i] === 0) {
      _updateArrowFlight(world, i, dtSec);
    }

    // When a flying arrow hits a wall it becomes stuck; check enemy contact
    if (world.isArrowHitEnemyFlag[i] === 0) {
      _checkArrowEnemyHit(world, i);

      // If a flying arrow just started a hit sequence, mark it as enemy-hit
      // (stops rendering, stops moving)
      if (
        world.isArrowStuckFlag[i] === 0 &&
        world.arrowHitTargetClusterIndex[i] !== -1
      ) {
        world.isArrowHitEnemyFlag[i] = 1;
      }
    }

    // Advance the mote-hit sequence
    _tickArrowHitSequence(world, i);

    // Decrement stuck-arrow lifetime (only once the arrow is stuck or invisible)
    if (world.isArrowStuckFlag[i] === 1 || world.isArrowHitEnemyFlag[i] === 1) {
      world.arrowLifetimeTicksLeft[i]--;
    }
  }
}
