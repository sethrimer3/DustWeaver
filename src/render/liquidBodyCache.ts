/**
 * liquidBodyCache.ts — Liquid Body Cache State and Bubble Emitter Tick.
 *
 * Manages the module-level singleton cache of {@link LiquidBody} objects and
 * drives the per-tick bubble physics.  Body construction (BFS + greedy mesh)
 * is delegated to {@link ./liquidBodyBuilder}.
 *
 * Design notes:
 *  - This module lives in render/ (not sim/), so Math.random() is acceptable
 *    for cosmetic bubble emission. Bubbles have no impact on gameplay state.
 *  - The cache is a module-level singleton marked dirty whenever liquid tile
 *    data changes (room load, editor paint/delete). The rebuild runs once and
 *    is cached until the next dirty flag set.
 *  - No per-frame allocations in the hot render path. All arrays are
 *    pre-allocated or pre-built during the cache rebuild phase.
 */

import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { LiquidBody } from './liquidBodyBuilder';
import {
  buildLiquidBodies,
  encodeKey,
  LIQUID_BUBBLE_GLOBAL_CAP,
  LIQUID_BUBBLE_SPAWN_RATE_MIN,
  LIQUID_BUBBLE_SPAWN_RATE_MAX,
  LIQUID_BUBBLE_RISE_SPEED,
  LIQUID_BUBBLE_DRIFT_AMOUNT,
} from './liquidBodyBuilder';
import { resetWaterSurfaceRipples, getDisturbanceOffsetAt } from './waterSplashSystem';

// Re-export types and constants so existing importers need no changes.
export type { MergedRect, TopEdgeRun, LiquidBubble, LiquidBody } from './liquidBodyBuilder';
export {
  MAX_LIQUID_TILES_PER_ROOM,
  LIQUID_BUBBLE_GLOBAL_CAP,
  LIQUID_BUBBLE_BODY_CAP,
  LIQUID_BUBBLE_SPAWN_RATE_MIN,
  LIQUID_BUBBLE_SPAWN_RATE_MAX,
  LIQUID_BUBBLE_RISE_SPEED,
  LIQUID_BUBBLE_DRIFT_AMOUNT,
} from './liquidBodyBuilder';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Wave amplitude on exposed top edges (world units). */
export const LIQUID_EDGE_WAVE_AMPLITUDE = 0.55;

/** Wave angular speed (radians per tick). */
export const LIQUID_EDGE_WAVE_SPEED = 0.065;

/** Spatial wave frequency (radians per world unit). */
export const LIQUID_EDGE_WAVE_SPATIAL_FREQ = 0.32;

/**
 * Distance (world units) from a top-edge run's endpoints over which wave
 * amplitude tapers to zero. Shared by surface rendering and anything that
 * needs to sample the same wave shape (e.g. surface-riding bubbles) so the
 * two can never visually diverge.
 */
export const LIQUID_EDGE_WAVE_TAPER_WORLD = BLOCK_SIZE_MEDIUM * 0.8;

/**
 * Samples the animated water-surface height offset (world units, positive =
 * downward) at a given world X along one exposed top-edge run, at the given
 * tick. Combines the base procedural sine wave (tapered to zero at the run's
 * endpoints) with any active splash/ripple disturbance.
 *
 * This is the single source of truth for "where is the water surface right
 * now" — used both by the wave renderer (liquidRenderer.ts) and by anything
 * that must visually ride the surface (e.g. playerWaterBubbles.ts), so they
 * cannot drift apart.
 */
export function sampleLiquidSurfaceOffsetWorld(
  xWorld: number,
  surfaceYWorld: number,
  tick: number,
  bodyIndex: number,
  runXWorld: number,
  runWWorld: number,
): number {
  const phaseBase  = tick * LIQUID_EDGE_WAVE_SPEED + bodyIndex * 1.7;
  const phaseBase2 = tick * LIQUID_EDGE_WAVE_SPEED * 0.7 + bodyIndex * 2.9 + 1.2;
  const tFromLeft  = xWorld - runXWorld;
  const taper = Math.max(0, Math.min(
    Math.min(1, tFromLeft / (LIQUID_EDGE_WAVE_TAPER_WORLD + 0.001)),
    Math.min(1, (runWWorld - tFromLeft) / (LIQUID_EDGE_WAVE_TAPER_WORLD + 0.001)),
  ));
  const baseWave = (Math.sin(phaseBase + xWorld * LIQUID_EDGE_WAVE_SPATIAL_FREQ) * 0.65
                 + Math.sin(phaseBase2 + xWorld * LIQUID_EDGE_WAVE_SPATIAL_FREQ * 0.6) * 0.35)
                 * LIQUID_EDGE_WAVE_AMPLITUDE * taper;
  const disturbance = getDisturbanceOffsetAt(xWorld, surfaceYWorld);
  return baseWave + disturbance;
}

/** Maximum bubble lifetime in ticks. */
const BUBBLE_MAX_AGE_TICKS = 600;

/**
 * Minimum blocks below the top surface at which a bubble fades out.
 * Randomised per-bubble to prevent all bubbles dying at the same height.
 * (1 block = one BLOCK_SIZE_MEDIUM distance unit)
 */
const BUBBLE_SURFACE_FADE_MIN_BLOCKS = 1;

/** Maximum blocks below top surface at which a bubble fades out. */
const BUBBLE_SURFACE_FADE_MAX_BLOCKS = 15;

// ── Module-level cache state ───────────────────────────────────────────────────

let _isDirty = true;
let _bodies: LiquidBody[] = [];
let _rebuildCount = 0;
let _lastBubbleTick = -1;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Marks the liquid body cache as stale so it will be rebuilt on the next
 * call to getLiquidBodies(). Call this whenever liquid tiles are added,
 * removed, or a new room is loaded.
 */
export function markLiquidBodiesDirty(): void {
  _isDirty = true;
  resetWaterSurfaceRipples();
}

/**
 * Returns the current array of liquid bodies, rebuilding if dirty.
 * Safe to call every frame — rebuilds are amortised to room-change events.
 */
export function getLiquidBodies(world: WorldState): readonly LiquidBody[] {
  if (_isDirty) {
    _rebuildCount++;
    _bodies = buildLiquidBodies(world);
    _isDirty = false;
  }
  return _bodies;
}

/**
 * Debug stats snapshot — call only when debug mode is active.
 */
export interface LiquidDebugStats {
  liquidTileCount: number;
  liquidBodyCount: number;
  mergedRectCount: number;
  activeBubbleCount: number;
  cacheRebuildCount: number;
}

export function getLiquidDebugStats(): LiquidDebugStats {
  let tileCount = 0;
  let rectCount = 0;
  let bubbleCount = 0;
  for (const b of _bodies) {
    tileCount += b.tileCount;
    rectCount += b.mergedRects.length;
    bubbleCount += b.bubbles.length;
  }
  return {
    liquidTileCount: tileCount,
    liquidBodyCount: _bodies.length,
    mergedRectCount: rectCount,
    activeBubbleCount: bubbleCount,
    cacheRebuildCount: _rebuildCount,
  };
}

/**
 * Advances all bubble physics for one tick. Call once per render frame.
 * Despawns expired bubbles and spawns new ones.
 */
export function tickLiquidBubbles(tick: number): void {
  if (_bodies.length === 0) return;
  if (tick === _lastBubbleTick) return; // Already ticked this tick
  _lastBubbleTick = tick;

  let globalBubbleCount = 0;
  for (const body of _bodies) {
    globalBubbleCount += body.bubbles.length;
  }

  for (const body of _bodies) {
    const { bubbles, tileSet, bottomByColumn, topByColumn, columnKeys } = body;
    const B = BLOCK_SIZE_MEDIUM;

    // ── Tick existing bubbles ──────────────────────────────────────────────
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const bub = bubbles[i];
      bub.ageTicks++;
      // Rise upward
      bub.yWorld -= LIQUID_BUBBLE_RISE_SPEED;
      // Stable origin-based sinusoidal horizontal drift.
      // xWorld is always offset from originXWorld — drift never accumulates.
      bub.xWorld = bub.originXWorld
        + Math.sin(bub.driftPhaseRad + bub.ageTicks * 0.04) * LIQUID_BUBBLE_DRIFT_AMOUNT;

      // Despawn: exceeded lifetime
      if (bub.ageTicks >= bub.maxAgeTicks) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
        continue;
      }

      // Despawn: bubble has risen within fadeBelowSurfaceWorld of the top surface.
      // Using the pre-cached surfaceYWorld avoids a per-tick tile scan.
      if (bub.yWorld <= bub.surfaceYWorld + bub.fadeBelowSurfaceWorld) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
        continue;
      }

      // Safety despawn: bubble left the liquid body (e.g., body was reshaped)
      const gx = Math.floor(bub.xWorld / B);
      const gy = Math.floor(bub.yWorld / B);
      if (!tileSet.has(encodeKey(gx, gy))) {
        bubbles[i] = bubbles[bubbles.length - 1];
        bubbles.pop();
        globalBubbleCount--;
      }
    }

    // ── Spawn new bubbles ─────────────────────────────────────────────────
    body.nextBubbleSpawnTicks--;
    if (body.nextBubbleSpawnTicks <= 0
      && bubbles.length < body.bubbleCap
      && globalBubbleCount < LIQUID_BUBBLE_GLOBAL_CAP
      && bottomByColumn.size > 0
    ) {
      // Pick a random column (use pre-built columnKeys to avoid per-frame Array.from allocation)
      const col = columnKeys[Math.floor(Math.random() * columnKeys.length)];
      const bottomY = bottomByColumn.get(col)!;

      // Spawn near bottom of that column
      const spawnX = col * B + Math.random() * B;
      const spawnY = bottomY - Math.random() * B * 0.5; // within the bottom tile

      // Verify it's actually inside the body
      const spawnGX = Math.floor(spawnX / B);
      const spawnGY = Math.floor(spawnY / B);
      if (tileSet.has(encodeKey(spawnGX, spawnGY))) {
        // Retrieve pre-cached surface Y for this column (O(1), no scan needed).
        const surfaceYWorld = topByColumn.get(col) ?? spawnY;
        const fadeBelowSurfaceWorld =
          (BUBBLE_SURFACE_FADE_MIN_BLOCKS +
            Math.random() * (BUBBLE_SURFACE_FADE_MAX_BLOCKS - BUBBLE_SURFACE_FADE_MIN_BLOCKS)) * B;

        bubbles.push({
          xWorld: spawnX,
          yWorld: spawnY,
          originXWorld: spawnX,
          driftPhaseRad: Math.random() * Math.PI * 2,
          ageTicks: 0,
          maxAgeTicks: Math.floor(BUBBLE_MAX_AGE_TICKS * (0.5 + Math.random() * 0.5)),
          originGridX: col,
          surfaceYWorld,
          fadeBelowSurfaceWorld,
        });
        globalBubbleCount++;
      }

      // Schedule next spawn
      body.nextBubbleSpawnTicks = Math.floor(
        LIQUID_BUBBLE_SPAWN_RATE_MIN
        + Math.random() * (LIQUID_BUBBLE_SPAWN_RATE_MAX - LIQUID_BUBBLE_SPAWN_RATE_MIN),
      );
    }
  }
}
