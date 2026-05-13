/**
 * playerWaterBubbles.ts — Cosmetic trailing bubble trail from player movement in water.
 *
 * When the player moves through water, small bubbles are spawned behind/around
 * them proportional to speed.  These are cosmetic only — no sim state is touched.
 *
 * Bubbles use origin-based sinusoidal drift (matching the ambient bubble fix)
 * and fade over their lifetime.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Minimum player speed (wu/s) before any movement bubbles spawn.
 */
export const PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD = 30.0;

/**
 * Player speed (wu/s) at which bubble spawn rate reaches the maximum.
 */
export const PLAYER_BUBBLE_SPEED_MAX_WORLD = 300.0;

/**
 * Maximum bubbles spawned per tick at full speed.
 * Fractional values result in probabilistic spawns.
 */
export const PLAYER_BUBBLE_MAX_SPAWN_RATE = 3.0;

/** Maximum number of player-movement bubbles in the pool at once. */
const PLAYER_BUBBLE_POOL_SIZE = 80;

/** Upward rise speed per tick (world units). */
const BUBBLE_RISE_SPEED = 0.20;

/** Horizontal drift amplitude (world units). */
const BUBBLE_DRIFT_AMPLITUDE = 0.9;

/** Maximum bubble lifetime in ticks. */
const BUBBLE_MAX_AGE_TICKS = 90;

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlayerBubble {
  xWorld: number;
  yWorld: number;
  /** Origin for stable sinusoidal drift — xWorld oscillates around this. */
  originXWorld: number;
  driftPhaseRad: number;
  ageTicks: number;
  maxAgeTicks: number;
  /** Visual radius scale (0.5–1.5). */
  radius: number;
}

// ── Module-level pool ─────────────────────────────────────────────────────────

const _bubbles: PlayerBubble[] = [];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advances all player bubbles one tick and spawns new ones based on speed.
 * Call once per render frame when the player is in water.
 *
 * @param playerXWorld    Player center X (world units).
 * @param playerYWorld    Player center Y (world units).
 * @param playerVelXWorld Player horizontal velocity (world units/s).
 * @param playerVelYWorld Player vertical velocity (world units/s).
 * @param isInWater       1 if the player is in water, 0 otherwise.
 */
export function tickPlayerWaterBubbles(
  playerXWorld: number,
  playerYWorld: number,
  playerVelXWorld: number,
  playerVelYWorld: number,
  isInWater: 0 | 1,
): void {
  // ── Tick existing bubbles ─────────────────────────────────────────────────
  for (let i = _bubbles.length - 1; i >= 0; i--) {
    const bub = _bubbles[i];
    bub.ageTicks++;
    bub.yWorld -= BUBBLE_RISE_SPEED;
    // Stable origin-based drift
    bub.xWorld = bub.originXWorld
      + Math.sin(bub.driftPhaseRad + bub.ageTicks * 0.05) * BUBBLE_DRIFT_AMPLITUDE;

    if (bub.ageTicks >= bub.maxAgeTicks) {
      _bubbles[i] = _bubbles[_bubbles.length - 1];
      _bubbles.pop();
    }
  }

  // ── Spawn new bubbles when in water ──────────────────────────────────────
  if (!isInWater) return;

  const speed = Math.sqrt(playerVelXWorld * playerVelXWorld + playerVelYWorld * playerVelYWorld);
  if (speed < PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD) return;
  if (_bubbles.length >= PLAYER_BUBBLE_POOL_SIZE) return;

  const speedNormalized = Math.min(1.0,
    (speed - PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD)
    / (PLAYER_BUBBLE_SPEED_MAX_WORLD - PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD));
  // How many to spawn this tick (fractional → probabilistic)
  const spawnCount = speedNormalized * PLAYER_BUBBLE_MAX_SPAWN_RATE;
  const fullSpawns = Math.floor(spawnCount);
  const fracSpawn  = spawnCount - fullSpawns;

  const toSpawn = fullSpawns + (Math.random() < fracSpawn ? 1 : 0);
  const B = BLOCK_SIZE_MEDIUM;

  // Spawn behind/around the player, biased opposite velocity direction
  const normX = speed > 0.001 ? playerVelXWorld / speed : 0;
  const normY = speed > 0.001 ? playerVelYWorld / speed : 0;

  for (let n = 0; n < toSpawn; n++) {
    if (_bubbles.length >= PLAYER_BUBBLE_POOL_SIZE) break;

    const spawnX = playerXWorld - normX * B * 0.5 + (Math.random() - 0.5) * B;
    const spawnY = playerYWorld - normY * B * 0.3 + (Math.random() - 0.5) * B * 0.8;
    const age    = Math.floor(BUBBLE_MAX_AGE_TICKS * (0.4 + Math.random() * 0.6));

    _bubbles.push({
      xWorld:       spawnX,
      yWorld:       spawnY,
      originXWorld: spawnX,
      driftPhaseRad: Math.random() * Math.PI * 2,
      ageTicks:     0,
      maxAgeTicks:  age,
      radius:       0.5 + Math.random() * 0.5,
    });
  }
}

/**
 * Renders all active player movement bubbles.
 * Call after tickPlayerWaterBubbles each frame.
 */
export function drawPlayerWaterBubbles(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (let i = 0; i < _bubbles.length; i++) {
    const bub  = _bubbles[i];
    const life = 1 - bub.ageTicks / bub.maxAgeTicks;
    if (life <= 0.02) continue;

    const px = bub.xWorld * zoom + offsetXPx;
    const py = bub.yWorld * zoom + offsetYPx;
    const r  = bub.radius * (0.6 + life * 0.8) * zoom;

    ctx.fillStyle = `rgba(180,230,255,${(life * 0.50).toFixed(2)})`;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);

    // Small rim highlight
    ctx.fillStyle = `rgba(220,245,255,${(life * 0.30).toFixed(2)})`;
    ctx.fillRect(px - r * 0.4, py - r * 0.75, r * 0.5, r * 0.4);
  }
}
