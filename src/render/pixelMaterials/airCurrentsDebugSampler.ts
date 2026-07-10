/**
 * Read-only sampler for the "Air Currents" debug overlay.
 *
 * Samples the EXISTING wind-momentum data already carried on
 * `PixelMaterialParticle.windVelX/windVelY` (see `pixelMaterialTypes.ts`) —
 * it does not compute, approximate, or store any airflow of its own. Player
 * and enemy movement both write into that same per-particle momentum via
 * `PixelMaterialSystem.applyWindForce` (see `pixelMaterialMovementWind.ts`),
 * so sampling it here shows exactly what the simulation is doing, never a
 * parallel approximation.
 *
 * Output buffers are pre-allocated typed arrays sized to `MAX_SAMPLES` and
 * reused every call — sampling never allocates once the sampler has been
 * constructed, keeping the overlay cheap even at a fine grid.
 */

import type { PixelMaterialSystem } from '../../sim/pixelMaterials/pixelMaterialSystem';

/** World-px spacing between sample points. Larger = sparser, cheaper, less noisy. */
export const AIR_CURRENTS_SAMPLE_SPACING_PX = 16;

/** How far (in world px) each sample point looks for nearby particles to average. */
const SEARCH_RADIUS_PX = 5;

/** Wind speed (px/s) below which a sample is dropped entirely (avoids visual noise from near-zero drift). */
export const AIR_CURRENTS_MIN_SPEED_PX_S = 6;

/** Wind speed (px/s) at or above which the rendered arrow length is clamped to its maximum. */
export const AIR_CURRENTS_MAX_SPEED_PX_S = 220;

/** Hard cap on samples per call — bounds worst-case work and buffer size regardless of viewport size. */
const MAX_SAMPLES = 4096;

export class AirCurrentsDebugSampler {
  readonly sampleXPx = new Float32Array(MAX_SAMPLES);
  readonly sampleYPx = new Float32Array(MAX_SAMPLES);
  readonly velX = new Float32Array(MAX_SAMPLES);
  readonly velY = new Float32Array(MAX_SAMPLES);
  readonly speed = new Float32Array(MAX_SAMPLES);
  count = 0;

  /**
   * Re-samples the field over a world-space viewport rectangle, overwriting
   * the reused buffers above. Purely reads `system` (via `getParticleAtCell`)
   * — never mutates particles, occupancy, or any other simulation state.
   */
  sample(
    system: PixelMaterialSystem,
    viewLeftPx: number,
    viewTopPx: number,
    viewRightPx: number,
    viewBottomPx: number,
  ): void {
    this.count = 0;
    const spacing = AIR_CURRENTS_SAMPLE_SPACING_PX;
    const startX = Math.floor(viewLeftPx / spacing) * spacing;
    const startY = Math.floor(viewTopPx / spacing) * spacing;

    for (let y = startY; y <= viewBottomPx; y += spacing) {
      for (let x = startX; x <= viewRightPx; x += spacing) {
        if (this.count >= MAX_SAMPLES) return;

        let sumVx = 0;
        let sumVy = 0;
        let weight = 0;
        const cx = Math.round(x);
        const cy = Math.round(y);
        for (let dy = -SEARCH_RADIUS_PX; dy <= SEARCH_RADIUS_PX; dy++) {
          for (let dx = -SEARCH_RADIUS_PX; dx <= SEARCH_RADIUS_PX; dx++) {
            const p = system.getParticleAtCell(cx + dx, cy + dy);
            if (p === undefined) continue;
            if (p.windVelX === 0 && p.windVelY === 0) continue;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1;
            const w = 1 / dist;
            sumVx += p.windVelX * w;
            sumVy += p.windVelY * w;
            weight += w;
          }
        }
        if (weight <= 0) continue;

        const vx = sumVx / weight;
        const vy = sumVy / weight;
        const spd = Math.sqrt(vx * vx + vy * vy);
        if (spd < AIR_CURRENTS_MIN_SPEED_PX_S) continue;

        const i = this.count++;
        this.sampleXPx[i] = x;
        this.sampleYPx[i] = y;
        this.velX[i] = vx;
        this.velY[i] = vy;
        this.speed[i] = spd;
      }
    }
  }
}
