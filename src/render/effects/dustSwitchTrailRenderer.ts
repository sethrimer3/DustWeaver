/**
 * dustSwitchTrailRenderer.ts — Dust-switch recall/return trail effect.
 *
 * Draws the short tapered trail left by motes transitioning between dust
 * types (see sim/weaves/dustTypeSwitch.ts), plus the participating motes
 * themselves. Must be called BEFORE renderClusters() in gameRender.ts's
 * entity pass so both the trail and the motes render behind the player
 * sprite — the normal gameplay-dust renderer (pixelLockedDustRenderer.ts)
 * explicitly excludes dust-switch-mode particles so they are never drawn
 * twice or in front of the player.
 *
 * Reads directly from WorldState (not the interpolated render snapshot):
 * trail samples are already tick-quantized historical data, and the small
 * fixed sample count (MAX_MOTE_SLOTS × DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT)
 * keeps this allocation-free every frame.
 */

import { WorldState, DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT } from '../../sim/world';
import { DUST_SWITCH_PHASE_NORMAL } from '../../sim/weaves/dustTypeSwitch';
import { KIND_COLOR_R, KIND_COLOR_G, KIND_COLOR_B } from '../particles/styles';
import type { GraphicsQuality } from '../../ui/renderSettings';

/** Ticks after which a trail sample has fully faded. */
const TRAIL_SAMPLE_MAX_AGE_TICKS = 16;
/** Base stroke width (virtual pixels) at the freshest point of the trail. */
const TRAIL_CORE_WIDTH_PX = 1.6;
/** Wider, dimmer glow pass width multiplier — skipped at low graphics quality. */
const TRAIL_GLOW_WIDTH_MULT = 2.4;
/** Peak alpha of the core trail stroke. */
const TRAIL_CORE_PEAK_ALPHA = 0.85;
/** Peak alpha of the glow pass. */
const TRAIL_GLOW_PEAK_ALPHA = 0.28;
/** Trail sample count used at low graphics quality (fewer, still readable). */
const TRAIL_SAMPLES_LOW_QUALITY = 3;

function lerpChannel(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function colorRgbaString(kindA: number, kindB: number, blendT: number, alpha: number): string {
  const r = lerpChannel(KIND_COLOR_R[kindA] ?? 1, KIND_COLOR_R[kindB] ?? 1, blendT);
  const g = lerpChannel(KIND_COLOR_G[kindA] ?? 1, KIND_COLOR_G[kindB] ?? 1, blendT);
  const b = lerpChannel(KIND_COLOR_B[kindA] ?? 1, KIND_COLOR_B[kindB] ?? 1, blendT);
  return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${alpha.toFixed(3)})`;
}

/**
 * Renders every mote slot's dust-switch trail (and, while actively
 * transitioning, the mote itself) behind the player sprite.
 */
export function renderDustSwitchTrails(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  quality: GraphicsQuality,
): void {
  if (world.moteSlotCount === 0) return;

  const cap = DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT;
  const maxSamplesForQuality = quality === 'low' ? Math.min(TRAIL_SAMPLES_LOW_QUALITY, cap) : cap;
  const drawGlow = quality !== 'low';

  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  const prevLineCap = ctx.lineCap;
  ctx.lineCap = 'round';

  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    const activeCount = world.dustSwitchTrailActiveCount[slot];
    if (activeCount === 0) continue;

    const sourceKind = world.dustSwitchSourceKind[slot];
    const targetKind = world.dustSwitchTargetKind[slot];
    const base = slot * cap;
    const writeIndex = world.dustSwitchTrailWriteIndex[slot];
    const sampleCount = Math.min(activeCount, maxSamplesForQuality);

    let prevXPx = 0;
    let prevYPx = 0;
    let havePrev = false;

    for (let k = 0; k < sampleCount; k++) {
      // Newest `sampleCount` samples, oldest-to-newest, wrapping correctly
      // regardless of whether the ring buffer has filled/wrapped yet.
      const ringIdx = (((writeIndex - sampleCount + k) % cap) + cap) % cap;
      const idx = base + ringIdx;

      const ageTicks = world.dustSwitchTrailAgeTicks[idx];
      const isPostTransform = world.dustSwitchTrailIsPostTransformFlag[idx] === 1;
      const screenX = world.dustSwitchTrailXWorld[idx] * scalePx + offsetXPx;
      const screenY = world.dustSwitchTrailYWorld[idx] * scalePx + offsetYPx;

      if (havePrev) {
        const ageT = Math.min(1, ageTicks / TRAIL_SAMPLE_MAX_AGE_TICKS);
        const taper = Math.max(0, 1 - ageT);
        if (taper > 0.01) {
          const blendT = isPostTransform ? 1 : 0;
          if (drawGlow) {
            ctx.strokeStyle = colorRgbaString(sourceKind, targetKind, blendT, taper * TRAIL_GLOW_PEAK_ALPHA);
            ctx.lineWidth = Math.max(1, TRAIL_CORE_WIDTH_PX * TRAIL_GLOW_WIDTH_MULT * taper);
            ctx.beginPath();
            ctx.moveTo(prevXPx, prevYPx);
            ctx.lineTo(screenX, screenY);
            ctx.stroke();
          }
          ctx.strokeStyle = colorRgbaString(sourceKind, targetKind, blendT, taper * TRAIL_CORE_PEAK_ALPHA);
          ctx.lineWidth = Math.max(0.6, TRAIL_CORE_WIDTH_PX * taper);
          ctx.beginPath();
          ctx.moveTo(prevXPx, prevYPx);
          ctx.lineTo(screenX, screenY);
          ctx.stroke();
        }
      }

      prevXPx = screenX;
      prevYPx = screenY;
      havePrev = true;
    }

    // Draw the participating mote itself (only while actually mid-transition,
    // not during the trailing fade-out after it has already resolved) so it
    // stays visible behind the player throughout the recall/return animation.
    if (world.dustSwitchPhase[slot] !== DUST_SWITCH_PHASE_NORMAL) {
      const pidx = world.moteSlotParticleIndex[slot];
      if (pidx >= 0 && pidx < world.particleCount && world.isAliveFlag[pidx] === 1) {
        const kind = world.kindBuffer[pidx];
        const r = KIND_COLOR_R[kind] ?? 1;
        const g = KIND_COLOR_G[kind] ?? 1;
        const b = KIND_COLOR_B[kind] ?? 1;
        const drawX = Math.round(world.positionXWorld[pidx] * scalePx + offsetXPx);
        const drawY = Math.round(world.positionYWorld[pidx] * scalePx + offsetYPx);
        ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
        ctx.fillRect(drawX, drawY, 1, 1);
      }
    }
  }

  ctx.lineCap = prevLineCap;
  ctx.imageSmoothingEnabled = prevSmoothing;
}
