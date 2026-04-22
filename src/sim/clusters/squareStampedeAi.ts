/**
 * Square Stampede enemy AI.
 *
 * A square enemy that floats in 2D and moves only along orthogonal axes.
 * It dashes fast toward the player on a single axis, pauses briefly, then
 * dashes on the other axis — producing exaggerated, L-shaped chase movements.
 *
 * It leaves a visual trail of ghost copies at past positions. Each trail
 * position is recorded every TRAIL_UPDATE_INTERVAL_TICKS ticks into a ring
 * buffer stored in WorldState. The renderer reads these to draw 19 ghost
 * squares that shrink by 5 % of the original size from outermost to innermost.
 *
 * HP = number of "layers". Each point of damage peels the outermost layer
 * (shrinks the collision and render box proportionally). At 0 HP the enemy
 * truly dies.
 *
 * Contact damage is dealt to the player whenever the enemy's AABB overlaps
 * the player AABB and the player is not invulnerable.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { nextFloat } from '../rng';

// ── Sizes ─────────────────────────────────────────────────────────────────────

/** Half-width/height of the enemy at full health (world units). */
export const SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD = 7;

/** Total number of layers (= max HP). One layer is shed per hit. */
export const SQUARE_STAMPEDE_LAYER_COUNT = 5;

// ── Movement ──────────────────────────────────────────────────────────────────

/** Dash speed (world units / sec). */
const DASH_SPEED_WORLD_PER_SEC = 260;

/**
 * Min/max ticks the enemy dashes in one direction before switching.
 * Randomised each dash to feel exaggerated and irregular.
 */
const DASH_MIN_TICKS = 18;
const DASH_MAX_TICKS = 35;

/** Ticks the enemy pauses between dashes. */
const IDLE_MIN_TICKS = 8;
const IDLE_MAX_TICKS = 18;

// ── Trail ─────────────────────────────────────────────────────────────────────

/** How often (ticks) the trail ring buffer is written. */
const TRAIL_UPDATE_INTERVAL_TICKS = 3;

// ── Contact damage ────────────────────────────────────────────────────────────

/** Damage per contact hit. */
const CONTACT_DAMAGE = 2;

// ── AI states ─────────────────────────────────────────────────────────────────
/** 0 = idle/pausing, 1 = dashing horizontally, 2 = dashing vertically. */
const STATE_IDLE   = 0;
const STATE_DASH_X = 1;
const STATE_DASH_Y = 2;

// ── Helpers ───────────────────────────────────────────────────────────────────

function randRangeInt(world: WorldState, lo: number, hi: number): number {
  return lo + ((nextFloat(world.rng) * (hi - lo + 1)) | 0);
}

/**
 * Records the cluster's current position into its trail ring buffer, then
 * advances the write head.
 */
function pushTrailPosition(
  world: WorldState,
  slotIndex: number,
  posX: number,
  posY: number,
): void {
  const base = slotIndex * world.squareStampedeTrailStride;
  const head = world.squareStampedeTrailHead[slotIndex];
  world.squareStampedeTrailXWorld[base + head] = posX;
  world.squareStampedeTrailYWorld[base + head] = posY;
  const stride = world.squareStampedeTrailStride;
  world.squareStampedeTrailHead[slotIndex] = (head + 1) % stride;
  if (world.squareStampedeTrailCount[slotIndex] < stride) {
    world.squareStampedeTrailCount[slotIndex]++;
  }
}

// ── Public AI entry point ─────────────────────────────────────────────────────

export function applySquareStampedeAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Locate player
  let playerXWorld = 0;
  let playerYWorld = 0;
  let playerHalfW  = 0;
  let playerHalfH  = 0;
  let playerFound  = false;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      playerHalfW  = c.halfWidthWorld;
      playerHalfH  = c.halfHeightWorld;
      playerFound  = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isSquareStampedeFlag !== 1 || cluster.isAliveFlag === 0) continue;

    // ── Keep collision half-size in sync with HP (layer-based shrink) ────────
    const layerRatio = cluster.healthPoints / cluster.maxHealthPoints;
    const currentHalfSize = SQUARE_STAMPEDE_BASE_HALF_SIZE_WORLD * layerRatio;
    cluster.halfWidthWorld  = currentHalfSize;
    cluster.halfHeightWorld = currentHalfSize;

    // ── Trail position update ─────────────────────────────────────────────────
    const slotIndex = cluster.squareStampedeSlotIndex;
    if (slotIndex >= 0) {
      cluster.squareStampedeTrailTimerTicks -= 1;
      if (cluster.squareStampedeTrailTimerTicks <= 0) {
        cluster.squareStampedeTrailTimerTicks = TRAIL_UPDATE_INTERVAL_TICKS;
        pushTrailPosition(world, slotIndex, cluster.positionXWorld, cluster.positionYWorld);
      }
    }

    // ── AI state machine ──────────────────────────────────────────────────────
    cluster.squareStampedeAiStateTicks -= 1;

    if (cluster.squareStampedeAiStateTicks <= 0) {
      // Transition to next state
      if (cluster.squareStampedeAiState === STATE_IDLE) {
        // Choose axis to dash on — prefer larger gap to player
        let chosenState: number;
        if (playerFound) {
          const dx = Math.abs(playerXWorld - cluster.positionXWorld);
          const dy = Math.abs(playerYWorld - cluster.positionYWorld);
          // Alternate axes using the tick counter as a bias breaker
          const preferX = dx >= dy || ((world.tick & 1) === 0 && dx > 4);
          chosenState = preferX ? STATE_DASH_X : STATE_DASH_Y;
        } else {
          chosenState = STATE_DASH_X;
        }
        cluster.squareStampedeAiState      = chosenState;
        cluster.squareStampedeAiStateTicks = randRangeInt(world, DASH_MIN_TICKS, DASH_MAX_TICKS);
      } else {
        // End of dash → idle
        cluster.squareStampedeAiState      = STATE_IDLE;
        cluster.squareStampedeAiStateTicks = randRangeInt(world, IDLE_MIN_TICKS, IDLE_MAX_TICKS);
        cluster.velocityXWorld             = 0;
        cluster.velocityYWorld             = 0;
      }
    }

    // ── Apply velocity from current state ─────────────────────────────────────
    if (cluster.squareStampedeAiState === STATE_DASH_X && playerFound) {
      const dirX = playerXWorld > cluster.positionXWorld ? 1 : -1;
      cluster.velocityXWorld = dirX * DASH_SPEED_WORLD_PER_SEC;
      cluster.velocityYWorld = 0;
    } else if (cluster.squareStampedeAiState === STATE_DASH_Y && playerFound) {
      const dirY = playerYWorld > cluster.positionYWorld ? 1 : -1;
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = dirY * DASH_SPEED_WORLD_PER_SEC;
    } else if (cluster.squareStampedeAiState === STATE_IDLE) {
      cluster.velocityXWorld = 0;
      cluster.velocityYWorld = 0;
    }

    // ── Move (no gravity — floats in 2D) ─────────────────────────────────────
    cluster.positionXWorld += cluster.velocityXWorld * dtSec;
    cluster.positionYWorld += cluster.velocityYWorld * dtSec;

    // ── Wall clamping (simple AABB push-out against solid walls) ─────────────
    const hw = cluster.halfWidthWorld;
    const hh = cluster.halfHeightWorld;
    for (let wi = 0; wi < world.wallCount; wi++) {
      if (world.wallIsPlatformFlag[wi] === 1) continue;
      if (world.wallRampOrientationIndex[wi] !== 255) continue;
      if (world.wallIsInvisibleFlag[wi] === 1) continue;

      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];

      const clLeft   = cluster.positionXWorld - hw;
      const clRight  = cluster.positionXWorld + hw;
      const clTop    = cluster.positionYWorld - hh;
      const clBottom = cluster.positionYWorld + hh;

      const overlapX = clRight > wx && clLeft < wx + ww;
      const overlapY = clBottom > wy && clTop < wy + wh;
      if (!overlapX || !overlapY) continue;

      // Push out along the axis of least penetration
      const penLeft   = clRight  - wx;
      const penRight  = (wx + ww) - clLeft;
      const penTop    = clBottom - wy;
      const penBottom = (wy + wh) - clTop;

      const minPen = Math.min(penLeft, penRight, penTop, penBottom);
      if (minPen === penLeft) {
        cluster.positionXWorld -= penLeft;
        cluster.velocityXWorld  = 0;
      } else if (minPen === penRight) {
        cluster.positionXWorld += penRight;
        cluster.velocityXWorld  = 0;
      } else if (minPen === penTop) {
        cluster.positionYWorld -= penTop;
        cluster.velocityYWorld  = 0;
      } else {
        cluster.positionYWorld += penBottom;
        cluster.velocityYWorld  = 0;
      }
    }

    // ── Contact damage to player ──────────────────────────────────────────────
    if (playerFound) {
      const playerCluster = world.clusters[0];
      // Find the actual player cluster (might not be index 0)
      let pc = playerCluster;
      if (pc === undefined || pc.isPlayerFlag !== 1) {
        for (let ci2 = 0; ci2 < world.clusters.length; ci2++) {
          if (world.clusters[ci2].isPlayerFlag === 1) {
            pc = world.clusters[ci2];
            break;
          }
        }
      }
      if (pc !== undefined && pc.isAliveFlag === 1 && pc.invulnerabilityTicks <= 0) {
        const dx = Math.abs(cluster.positionXWorld - playerXWorld);
        const dy = Math.abs(cluster.positionYWorld - playerYWorld);
        const overlapX = dx < hw + playerHalfW;
        const overlapY = dy < hh + playerHalfH;
        if (overlapX && overlapY) {
          applyPlayerDamageWithKnockback(pc, CONTACT_DAMAGE, cluster.positionXWorld, cluster.positionYWorld);
        }
      }
    }
  }
}
