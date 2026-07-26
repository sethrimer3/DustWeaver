/**
 * playerWaterBubbles.ts — Cosmetic trailing bubble trail from player movement in water.
 *
 * When the player moves through water, small bubbles are spawned behind/around
 * them proportional to speed.  These are cosmetic only — no sim state is touched.
 *
 * Each bubble is bound to the containing water LiquidBody and exposed
 * top-edge run at spawn time. While rising it cannot cross into air or a
 * disconnected body; once it reaches the surface it settles there and rides
 * the same procedural wave + splash disturbance as the rendered surface
 * (see `sampleLiquidSurfaceOffsetWorld` in liquidBodyCache.ts) for the rest
 * of its lifetime, rather than crossing into air.
 *
 * Leaving water only stops *new* emission — already-spawned bubbles persist
 * and continue aging/fading through their normal lifetime.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { encodeKey, type LiquidBody, type TopEdgeRun } from './liquidBodyBuilder';
import { sampleLiquidSurfaceOffsetWorld } from './liquidBodyCache';

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

/** Upward rise speed per tick (world units), while still rising toward the surface. */
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
  /** Index into the current liquid-bodies array this bubble is bound to. */
  bodyIndex: number;
  /** Owning exposed top-edge run bounds (world units) — never crossed. */
  runXWorld: number;
  runWWorld: number;
  runYWorld: number;
  /** True once the bubble has reached the surface and is riding the wave. */
  settled: boolean;
}

// ── Module-level pool ─────────────────────────────────────────────────────────

const _bubbles: PlayerBubble[] = [];

// ── Water-volume ownership lookup ────────────────────────────────────────────

/**
 * Finds the water body + exposed top-edge run that owns the given world
 * point, or null if the point is not inside any water body's actual tile
 * volume (e.g. player hitbox straddling the edge of a zone). Used both to
 * validate spawn candidates and to reject/clamp them to real water.
 */
function findWaterRunAt(
  bodies: readonly LiquidBody[],
  xWorld: number,
  yWorld: number,
): { bodyIndex: number; run: TopEdgeRun } | null {
  const B = BLOCK_SIZE_MEDIUM;
  const gx = Math.floor(xWorld / B);
  const gy = Math.floor(yWorld / B);
  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    if (body.kind !== 'water') continue;
    if (xWorld < body.minXWorld || xWorld > body.maxXWorld) continue;
    if (yWorld < body.minYWorld || yWorld > body.maxYWorld) continue;
    if (!body.tileSet.has(encodeKey(gx, gy))) continue;
    for (const run of body.topEdgeRuns) {
      if (xWorld >= run.xWorld && xWorld <= run.xWorld + run.wWorld) {
        return { bodyIndex: bi, run };
      }
    }
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advances all player bubbles one tick and spawns new ones based on speed.
 * Call once per render frame when the room contains water.
 *
 * @param playerXWorld    Player center X (world units).
 * @param playerYWorld    Player center Y (world units).
 * @param playerVelXWorld Player horizontal velocity (world units/s).
 * @param playerVelYWorld Player vertical velocity (world units/s).
 * @param isInWater       1 if the player is in water, 0 otherwise. Gates new
 *                        emission only — existing bubbles always keep ticking.
 * @param bodies          Current liquid bodies (for water-volume ownership).
 * @param tick            Current sim/render tick, used to keep settled
 *                        bubbles' wave phase identical to the rendered surface.
 */
export function tickPlayerWaterBubbles(
  playerXWorld: number,
  playerYWorld: number,
  playerVelXWorld: number,
  playerVelYWorld: number,
  isInWater: 0 | 1,
  bodies: readonly LiquidBody[],
  tick: number,
): void {
  // ── Tick existing bubbles (independent of current water contact) ────────
  for (let i = _bubbles.length - 1; i >= 0; i--) {
    const bub = _bubbles[i];
    bub.ageTicks++;

    // Stable origin-based drift, clamped so it can never cross into a gap
    // beyond the owning run's bounds.
    let driftedX = bub.originXWorld
      + Math.sin(bub.driftPhaseRad + bub.ageTicks * 0.05) * BUBBLE_DRIFT_AMPLITUDE;
    if (driftedX < bub.runXWorld) driftedX = bub.runXWorld;
    else if (driftedX > bub.runXWorld + bub.runWWorld) driftedX = bub.runXWorld + bub.runWWorld;
    bub.xWorld = driftedX;

    const waveOffset = sampleLiquidSurfaceOffsetWorld(
      bub.xWorld, bub.runYWorld, tick, bub.bodyIndex, bub.runXWorld, bub.runWWorld,
    );
    const surfaceYWorld = bub.runYWorld + waveOffset;

    if (!bub.settled) {
      bub.yWorld -= BUBBLE_RISE_SPEED;
      if (bub.yWorld <= surfaceYWorld) {
        bub.yWorld = surfaceYWorld;
        bub.settled = true;
      }
    } else {
      // Ride the animated surface (base wave + splash disturbance) rather
      // than crossing into air above it.
      bub.yWorld = surfaceYWorld;
    }

    if (bub.ageTicks >= bub.maxAgeTicks) {
      _bubbles[i] = _bubbles[_bubbles.length - 1];
      _bubbles.pop();
    }
  }

  // ── Spawn new bubbles when in water — leaving water stops emission only ──
  if (!isInWater) return;

  const speed = Math.sqrt(playerVelXWorld * playerVelXWorld + playerVelYWorld * playerVelYWorld);
  if (speed < PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD) return;
  if (_bubbles.length >= PLAYER_BUBBLE_POOL_SIZE) return;

  // The player must actually be over real water volume (not just inside the
  // zone's rectangular bounds) for any bubbles to spawn at all this tick.
  const playerLoc = findWaterRunAt(bodies, playerXWorld, playerYWorld);
  if (playerLoc === null) return;

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

    const candidateX = playerXWorld - normX * B * 0.5 + (Math.random() - 0.5) * B;
    const candidateY = playerYWorld - normY * B * 0.3 + (Math.random() - 0.5) * B * 0.8;

    // Reject or clamp candidates outside real water — never spawn into air,
    // gaps, lava, or an unrelated/disconnected water body: fall back to the
    // player's own owning run, which is always valid at this point.
    const loc = findWaterRunAt(bodies, candidateX, candidateY) ?? playerLoc;

    let spawnX = candidateX;
    if (spawnX < loc.run.xWorld) spawnX = loc.run.xWorld;
    else if (spawnX > loc.run.xWorld + loc.run.wWorld) spawnX = loc.run.xWorld + loc.run.wWorld;

    // Never spawn above the (unanimated) tile surface — i.e. never in air.
    const spawnY = Math.max(candidateY, loc.run.yWorld);

    const age = Math.floor(BUBBLE_MAX_AGE_TICKS * (0.4 + Math.random() * 0.6));

    _bubbles.push({
      xWorld:       spawnX,
      yWorld:       spawnY,
      originXWorld: spawnX,
      driftPhaseRad: Math.random() * Math.PI * 2,
      ageTicks:     0,
      maxAgeTicks:  age,
      radius:       0.5 + Math.random() * 0.5,
      bodyIndex:    loc.bodyIndex,
      runXWorld:    loc.run.xWorld,
      runWWorld:    loc.run.wWorld,
      runYWorld:    loc.run.yWorld,
      settled:      false,
    });
  }
}

/**
 * Renders all active player movement bubbles.
 * Call after tickPlayerWaterBubbles each frame. Independent of the player's
 * current water contact so a persisting trail keeps drawing after exit.
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

/**
 * Clears the entire player-bubble pool. Call on room load/activation so this
 * module-level cosmetic pool cannot leak bubbles across room changes or into
 * rooms with no water.
 */
export function resetPlayerWaterBubbles(): void {
  _bubbles.length = 0;
}

/** Test-only accessor for the live bubble count. */
export function getPlayerWaterBubbleCountForTest(): number {
  return _bubbles.length;
}
