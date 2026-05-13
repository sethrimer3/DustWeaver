/**
 * waterSplashSystem.ts — Cosmetic water surface disturbance / splash wave system.
 *
 * When the player enters water a WaterSurfaceDisturbance is spawned at the
 * nearest top-edge run of the water body.  Each disturbance contributes a
 * radially-propagating traveling wave to the wave rendering in liquidRenderer.ts.
 *
 * This module is purely cosmetic (render layer).  It has no gameplay effect and
 * does not touch WorldState or the sim layer.
 */

import type { LiquidBody } from './liquidBodyCache';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Minimum entry speed (wu/s) to trigger any splash.
 * Below this threshold no disturbance is spawned.
 */
export const SPLASH_ENTRY_SPEED_MIN_WORLD = 30.0;

/**
 * Entry speed (wu/s) at which splash reaches full amplitude/lifetime.
 * Clamped; faster entries do not exceed max values.
 */
export const SPLASH_ENTRY_SPEED_MAX_WORLD = 300.0;

/** Minimum wave amplitude for a slow-entry splash (world units). */
export const SPLASH_MIN_AMPLITUDE_WORLD = 0.5;

/** Maximum wave amplitude for a fast-entry splash (world units). */
export const SPLASH_MAX_AMPLITUDE_WORLD = 4.0;

/** Minimum disturbance lifetime for a slow entry (ticks). */
export const SPLASH_MIN_AGE_TICKS = 30;

/** Maximum disturbance lifetime for a fast entry (ticks). */
export const SPLASH_MAX_AGE_TICKS = 120;

/**
 * How fast the disturbance wave front propagates left and right along the
 * surface (world units per tick).
 */
export const SPLASH_WAVE_SPEED_WORLD_PER_TICK = 1.5;

/**
 * Spatial frequency of the traveling wave ripple (radians per world unit).
 * Higher = tighter ripple bands.
 */
export const SPLASH_RIPPLE_FREQ = 0.45;

/** Maximum number of simultaneous disturbances (pool cap). */
const MAX_DISTURBANCES = 16;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WaterSurfaceDisturbance {
  /** X world coordinate of the splash entry point. */
  xWorld: number;
  /** Y world coordinate of the water surface at the entry point. */
  surfaceYWorld: number;
  /** Peak amplitude of this disturbance (world units). */
  amplitudeWorld: number;
  /** How many ticks this disturbance has been alive. */
  ageTicks: number;
  /** Lifetime in ticks (0 = dead). */
  maxAgeTicks: number;
  /** Current radius of the wave front (world units). Grows each tick. */
  radiusWorld: number;
  /** Wave speed (world units / tick). */
  waveSpeedWorld: number;
  /**
   * Normalised strength 0–1 (derived from entry speed).
   * Used for amplitude and lifetime scaling.
   */
  strength: number;
}

// ── Module-level pool ─────────────────────────────────────────────────────────

const _disturbances: WaterSurfaceDisturbance[] = [];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Spawns a water surface disturbance when the player enters water.
 *
 * @param bodies          Current liquid bodies (used to find nearest surface run).
 * @param playerXWorld    Player center X in world units.
 * @param entrySpeedWorld Speed magnitude the player had at water entry (wu/s).
 */
export function spawnWaterSplash(
  bodies: readonly LiquidBody[],
  playerXWorld: number,
  entrySpeedWorld: number,
): void {
  if (entrySpeedWorld < SPLASH_ENTRY_SPEED_MIN_WORLD) return;
  if (_disturbances.length >= MAX_DISTURBANCES) return;

  // Find the nearest top-edge run across all water bodies
  let bestDist = Infinity;
  let bestSurfaceY = 0;
  for (const body of bodies) {
    if (body.kind !== 'water') continue;
    for (const run of body.topEdgeRuns) {
      const runMidX = run.xWorld + run.wWorld * 0.5;
      const dist = Math.abs(playerXWorld - runMidX);
      if (dist < bestDist) {
        bestDist = dist;
        bestSurfaceY = run.yWorld;
      }
    }
  }

  const speedNormalized = Math.min(1.0, Math.max(0.0,
    (entrySpeedWorld - SPLASH_ENTRY_SPEED_MIN_WORLD) /
    (SPLASH_ENTRY_SPEED_MAX_WORLD - SPLASH_ENTRY_SPEED_MIN_WORLD),
  ));

  const amplitude = SPLASH_MIN_AMPLITUDE_WORLD
    + speedNormalized * (SPLASH_MAX_AMPLITUDE_WORLD - SPLASH_MIN_AMPLITUDE_WORLD);
  const maxAge = Math.round(
    SPLASH_MIN_AGE_TICKS + speedNormalized * (SPLASH_MAX_AGE_TICKS - SPLASH_MIN_AGE_TICKS),
  );

  _disturbances.push({
    xWorld:        playerXWorld,
    surfaceYWorld: bestSurfaceY,
    amplitudeWorld: amplitude,
    ageTicks:      0,
    maxAgeTicks:   maxAge,
    radiusWorld:   0,
    waveSpeedWorld: SPLASH_WAVE_SPEED_WORLD_PER_TICK,
    strength:      speedNormalized,
  });
}

/**
 * Advances all disturbances by one tick.
 * Call once per render frame.
 */
export function tickWaterSplash(): void {
  for (let i = _disturbances.length - 1; i >= 0; i--) {
    const d = _disturbances[i];
    d.ageTicks++;
    d.radiusWorld += d.waveSpeedWorld;
    if (d.ageTicks >= d.maxAgeTicks) {
      _disturbances[i] = _disturbances[_disturbances.length - 1];
      _disturbances.pop();
    }
  }
}

/**
 * Returns the Y offset contributed by all active disturbances at a given
 * surface X and Y position.  Add this to the base wave offset in drawWaveLine.
 *
 * @param surfaceXWorld  X coordinate of the point on the wave line (world units).
 * @param surfaceYWorld  Y coordinate of the wave line (world units).
 * @returns              Signed Y offset in world units.
 */
export function getDisturbanceOffsetAt(
  surfaceXWorld: number,
  surfaceYWorld: number,
): number {
  let total = 0;
  for (let i = 0; i < _disturbances.length; i++) {
    const d = _disturbances[i];
    // Only apply to the matching surface row (within 1 block tolerance)
    if (Math.abs(surfaceYWorld - d.surfaceYWorld) > 8) continue;

    const dist = Math.abs(surfaceXWorld - d.xWorld);
    const ageRatio = d.ageTicks / d.maxAgeTicks; // 0→1
    const ageFade  = 1.0 - ageRatio;             // 1→0 (fade with age)

    // Distance falloff — falls to zero at the wave front radius
    const distFade = dist < d.radiusWorld
      ? Math.max(0, 1.0 - dist / (d.radiusWorld + 0.001))
      : 0;

    // Traveling wave ripple: sin(distance * freq - age * waveSpeed * freq)
    const phase = dist * SPLASH_RIPPLE_FREQ - d.ageTicks * d.waveSpeedWorld * SPLASH_RIPPLE_FREQ;
    const ripple = Math.sin(phase);

    total += d.amplitudeWorld * ageFade * distFade * ripple;
  }
  return total;
}
