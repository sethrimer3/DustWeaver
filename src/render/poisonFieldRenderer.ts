/**
 * poisonFieldRenderer.ts — Render-only Poison Field cloud visual.
 *
 * Renders each authored Poison Field rectangle (world.poisonFieldXWorld/
 * YWorld/WWorld/HWorld — see sim/worldHazardState.ts) as a handful of soft,
 * low-opacity, drifting purple cloud patches. Deliberately NOT a translucent
 * rectangle: the goal is to conceal the exact authored geometry while still
 * reading as "something is here" at a glance.
 *
 * Determinism / gameplay separation: this module is render-only. It reads
 * field geometry and the deterministic tick counter (for animation phase)
 * but never mutates WorldState and never feeds back into gameplay. Cloud
 * layout per field is derived from a seeded hash of the field's rounded
 * world position, so the same room always looks the same, and different
 * fields never share an animation phase (avoids visually-synchronized
 * breathing that would look mechanical).
 *
 * Bounded cost: a fixed, small number of soft radial-gradient blobs per
 * field (no allocation growth, no offscreen texture caching — a
 * CanvasGradient is a cheap per-draw object, not a rasterized texture).
 * Fields entirely outside the viewport are skipped.
 */

import type { WorldState } from '../sim/world';
import { isScreenRectVisible } from './viewportCull';

/** Number of soft cloud blobs drawn per field. Small and fixed — bounded cost. */
const CLOUDS_PER_FIELD = 4;
/** Peak opacity (0-1) at a blob's core — kept near/below the ~10% target. */
const CLOUD_PEAK_OPACITY = 0.09;
/** Blob radius as a fraction of min(field width, field height). */
const CLOUD_RADIUS_FRACTION = 0.42;
/** World-unit drift amplitude for each blob's slow procedural wander. */
const CLOUD_DRIFT_AMPLITUDE_WORLD = 10;
/** Ticks per full breathing (fade in/out) cycle — slow, ambient. */
const BREATHE_PERIOD_TICKS = 260;
/** Ticks per full drift cycle (deliberately not a divisor/multiple of BREATHE_PERIOD_TICKS). */
const DRIFT_PERIOD_TICKS = 340;

/** Small deterministic hash → [0, 1). No Math.random — fully seeded/reproducible. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Draws all Poison Field cloud visuals for the current room. Call once per
 * frame, behind the player sprite (see render/hazards.ts draw order).
 */
export function renderPoisonFields(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  tick: number,
  vpW: number,
  vpH: number,
): void {
  const count = world.poisonFieldCount;
  if (count === 0) return;

  ctx.save();
  for (let i = 0; i < count; i++) {
    const left = world.poisonFieldXWorld[i];
    const top = world.poisonFieldYWorld[i];
    const w = world.poisonFieldWWorld[i];
    const h = world.poisonFieldHWorld[i];
    if (w <= 0 || h <= 0) continue;

    const xPx = left * zoom + offsetXPx;
    const yPx = top * zoom + offsetYPx;
    const wPx = w * zoom;
    const hPx = h * zoom;
    if (!isScreenRectVisible(xPx, yPx, wPx, hPx, vpW, vpH)) continue;

    // Feathered clip to the authored rectangle so blob cores/drift never
    // visibly extend past the field's legal effect area.
    ctx.save();
    ctx.beginPath();
    ctx.rect(xPx, yPx, wPx, hPx);
    ctx.clip();

    const radiusPx = Math.min(wPx, hPx) * CLOUD_RADIUS_FRACTION;
    const fieldSeed = Math.round(left) * 92821 + Math.round(top) * 68917 + i * 104729;

    for (let c = 0; c < CLOUDS_PER_FIELD; c++) {
      const blobSeed = fieldSeed + c * 7919;
      // Deterministic base position within the field (fractional, stable per blob).
      const baseFx = seededUnit(blobSeed + 1);
      const baseFy = seededUnit(blobSeed + 2);
      // Independent phase offsets so blobs never breathe/drift in lockstep.
      const breathePhase = seededUnit(blobSeed + 3) * Math.PI * 2;
      const driftPhase = seededUnit(blobSeed + 4) * Math.PI * 2;
      const driftPhase2 = seededUnit(blobSeed + 5) * Math.PI * 2;

      const breatheT = ((tick % BREATHE_PERIOD_TICKS) / BREATHE_PERIOD_TICKS) * Math.PI * 2;
      // 0.35..1.0 range so blobs never fully vanish nor sit fully static.
      const breatheFactor = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(breatheT + breathePhase));

      const driftT = ((tick % DRIFT_PERIOD_TICKS) / DRIFT_PERIOD_TICKS) * Math.PI * 2;
      const driftXWorld = Math.sin(driftT + driftPhase) * CLOUD_DRIFT_AMPLITUDE_WORLD;
      const driftYWorld = Math.cos(driftT + driftPhase2) * CLOUD_DRIFT_AMPLITUDE_WORLD * 0.6;

      const cxPx = xPx + baseFx * wPx + driftXWorld * zoom;
      const cyPx = yPx + baseFy * hPx + driftYWorld * zoom;
      const r = radiusPx * (0.75 + 0.5 * seededUnit(blobSeed + 6));

      const peakAlpha = CLOUD_PEAK_OPACITY * breatheFactor;
      const gradient = ctx.createRadialGradient(cxPx, cyPx, 0, cxPx, cyPx, r);
      // Soft/noisy boundary via a multi-stop falloff rather than a hard edge —
      // edge attenuation lowers opacity well before the geometric radius.
      gradient.addColorStop(0, `rgba(150,80,210,${peakAlpha.toFixed(3)})`);
      gradient.addColorStop(0.55, `rgba(140,70,200,${(peakAlpha * 0.55).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(130,60,190,0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cxPx, cyPx, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
  ctx.restore();
}
