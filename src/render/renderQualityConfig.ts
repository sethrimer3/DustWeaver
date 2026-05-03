/**
 * renderQualityConfig.ts — Centralized per-quality-tier rendering parameters.
 *
 * Import `getQualityConfig(quality)` to retrieve a config object for the
 * current quality tier, then pass relevant fields to atmospheric systems,
 * the bloom system, and the dark-room lighting pipeline.
 *
 * Changing constants here is the single place to tune render cost vs quality.
 */

import type { GraphicsQuality } from '../ui/renderSettings';

// ── Quality config interface ─────────────────────────────────────────────────

export interface RenderQualityConfig {
  // ── Bloom ──────────────────────────────────────────────────────────────────
  /** Whether the bloom/glow composite pass runs at all. */
  isBloomEnabled: boolean;
  /** Additive-blend alpha for the composited bloom layer (0–1). */
  bloomIntensity: number;
  /** CSS blur radius applied to the bloom downscale canvas (px). */
  bloomBlurRadiusPx: number;
  /**
   * Maximum number of decoration glow circles submitted per frame.
   * Decorations beyond this cap are skipped in addDecorationBloom().
   */
  maxDecorationBloomCount: number;

  // ── Atmospheric dust (AtmosphericLightDust) ────────────────────────────────
  /**
   * Hard cap on live mote count.  The system will not spawn new motes once
   * this limit is reached; existing motes above the cap fade out naturally.
   */
  maxDustMoteCount: number;

  // ── Dark-room lighting (DarkRoomOverlay) ──────────────────────────────────
  /**
   * Maximum number of dynamic light sources (decoration + authored) submitted
   * to the DarkRoomOverlay per frame, not counting the player lantern which is
   * always included.  Set to a large value to allow unlimited lights.
   */
  maxDynamicLightCount: number;
  /**
   * Maximum number of particle-based point lights submitted to the overlay.
   * Physical/Gold dust particles each contribute a tiny glow in DarkRoom mode.
   */
  maxParticleLightCount: number;

  // ── Sunbeams ────────────────────────────────────────────────────────────────
  /**
   * Whether to draw atmospheric sunbeam shafts.
   * On LOW they are hidden to save the per-beam gradient + fill call.
   */
  isSunbeamEnabled: boolean;
}

// ── Tier constants ───────────────────────────────────────────────────────────

/** LOW: performance-first.  Bloom off, minimal dust, reduced lights. */
const CONFIG_LOW: RenderQualityConfig = {
  isBloomEnabled:           false,
  bloomIntensity:           0.0,
  bloomBlurRadiusPx:        0,
  maxDecorationBloomCount:  0,
  maxDustMoteCount:         64,
  maxDynamicLightCount:     6,
  maxParticleLightCount:    6,
  isSunbeamEnabled:         false,
};

/** MED: balanced default.  Cheaper bloom, moderate dust density. */
const CONFIG_MED: RenderQualityConfig = {
  isBloomEnabled:           true,
  bloomIntensity:           0.6,
  bloomBlurRadiusPx:        2,
  maxDecorationBloomCount:  64,
  maxDustMoteCount:         256,
  maxDynamicLightCount:     16,
  maxParticleLightCount:    16,
  isSunbeamEnabled:         true,
};

/** HIGH: visual fidelity mode.  Full bloom, full dust, no caps. */
const CONFIG_HIGH: RenderQualityConfig = {
  isBloomEnabled:           true,
  bloomIntensity:           0.9,
  bloomBlurRadiusPx:        3,
  maxDecorationBloomCount:  512,
  maxDustMoteCount:         512,
  maxDynamicLightCount:     64,
  maxParticleLightCount:    24,
  isSunbeamEnabled:         true,
};

// ── Public accessor ──────────────────────────────────────────────────────────

/**
 * Returns the immutable config object for the given quality tier.
 * The returned object must not be mutated — it is shared across callers.
 */
export function getQualityConfig(quality: GraphicsQuality): RenderQualityConfig {
  if (quality === 'low') return CONFIG_LOW;
  if (quality === 'med') return CONFIG_MED;
  return CONFIG_HIGH;
}
