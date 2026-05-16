/**
 * Wall decorations — pixelated glowing mushrooms, grass tufts, and hanging vines.
 *
 * Decorations are authored in the room editor and stored as part of room data.
 * They are no longer auto-generated procedurally.
 *
 * - 'mushroom'  — sits on the TOP surface of a floor block; grows upward.
 * - 'glowGrass' — sits on the TOP surface of a floor block; grows upward.
 * - 'vine'      — hangs from the BOTTOM surface of a ceiling block; hangs downward.
 *
 * In DarkRoom lighting mode these decorations serve as point light sources:
 * `collectDecorationLights()` converts their world-space positions to
 * screen-space LightSourcePx descriptors consumed by DarkRoomOverlay.
 * `addDecorationBloom()` contributes coloured glow to the BloomSystem so
 * the light sources bleed through the darkness with a soft halo.
 *
 * No sim dependencies.  Uses `performance.now()` only for pulsing bloom —
 * this is render-side code and wall-clock time is permitted here.
 */

import type { BloomSystem } from './bloomSystem';
import { LIGHT_BUFFER_STRIDE } from './darkRoomOverlay';
import { isScreenCircleVisible } from '../viewportCull';

// ── Re-exports from decorationWaveState ───────────────────────────────────────

export type { DecorationKind, WallDecoration } from './decorationWaveState';
export { DecorationWaveState, buildRoomDecorations } from './decorationWaveState';
import type { WallDecoration } from './decorationWaveState';
import type { DecorationWaveState } from './decorationWaveState';

// ── Deterministic hash (used locally for bloom/lights) ────────────────────────

/**
 * A simple, allocation-free 32-bit integer hash of three integers.
 * Returns a non-negative number.  For decoration use only (not sim RNG).
 */
function _hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a, 0x6c62272e) ^ Math.imul(b, 0x9e3779b9) ^ Math.imul(c, 0x517cc1b7)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

// ── Pixel-art drawing helpers ─────────────────────────────────────────────────

/**
 * Draws a pixelated glowing-grass tuft at screen position (sx, sy).
 * sy is the floor surface; the grass grows UPWARD from sy (toward smaller Y).
 * swayOffsetPx shifts the tip horizontally to simulate push-wave lean.
 */
function _drawGlowGrass(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
  swayOffsetPx = 0,
): void {
  const px  = Math.max(1, Math.round(scalePx));
  const bw  = Math.round(blockSizePx * scalePx);
  const count = 3 + (seed & 3);
  for (let i = 0; i < count; i++) {
    const h2   = _hash(seed, i, 0xabcde123);
    const offX = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - px));
    const tufH = 1 + ((h2 >> 8) & 0x3);
    // Apply sway: the tip leans by swayOffsetPx; scale by stem height fraction.
    const tipSway = Math.round(swayOffsetPx * tufH / 4);
    ctx.fillStyle = '#1d5a26';
    ctx.fillRect(sx + offX + tipSway, sy - tufH * px, px, tufH * px);
    ctx.fillStyle = '#3db048';
    ctx.fillRect(sx + offX + tipSway, sy - tufH * px, px, px);
  }
}

/**
 * Draws a tiny pixelated mushroom at screen position (sx, sy).
 * sy is the floor surface; the mushroom grows UPWARD from sy.
 * swayOffsetPx shifts the cap horizontally to simulate lean.
 */
function _drawMushroom(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
  swayOffsetPx = 0,
): void {
  const px     = Math.max(1, Math.round(scalePx));
  const bw     = Math.round(blockSizePx * scalePx);
  const h2     = _hash(seed, 0, 0xf00dface);
  const offX   = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
  const stemH  = 2 + (h2 & 1);
  const capW   = 3;
  // Cap sways more than stem (cap sits at the top, stem is rooted):
  // MUSHROOM_CAP_SWAY_FACTOR = 0.8 — the cap (most flexible part) moves ~80% of the input sway.
  // MUSHROOM_STEM_SWAY_FACTOR = 0.3 — the stem base barely moves (~30% of cap sway).
  const MUSHROOM_CAP_SWAY_FACTOR  = 0.8;
  const MUSHROOM_STEM_SWAY_FACTOR = 0.3;
  const capSway  = Math.round(swayOffsetPx * MUSHROOM_CAP_SWAY_FACTOR);
  const stemSway = Math.round(capSway * MUSHROOM_STEM_SWAY_FACTOR);

  ctx.fillStyle = '#c8b89a';
  ctx.fillRect(sx + offX + stemSway, sy - stemH * px, px, stemH * px);

  const isBlue   = ((h2 >> 4) & 1) === 0;
  const capColor = isBlue ? '#7a58b8' : '#4aaa7a';
  ctx.fillStyle  = capColor;
  ctx.fillRect(sx + offX - px + capSway, sy - (stemH + 2) * px, capW * px, 2 * px);

  ctx.fillStyle = 'rgba(240,255,200,0.85)';
  ctx.fillRect(sx + offX + capSway, sy - (stemH + 2) * px, px, px);
}

/**
 * Draws a glowing vine at screen position (sx, sy).
 * sy is the ceiling bottom surface; the vine hangs DOWNWARD from sy (toward larger Y).
 * swayOffsetPx shifts the tip horizontally to simulate push-wave sway.
 */
function _drawVine(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
  swayOffsetPx = 0,
): void {
  const px   = Math.max(1, Math.round(scalePx));
  const bw   = Math.round(blockSizePx * scalePx);
  const count = 2 + (seed & 3);
  for (let i = 0; i < count; i++) {
    const h2      = _hash(seed, i, 0xc0ffee77);
    const offX    = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - px));
    const vineH   = 3 + ((h2 >> 8) & 0x7);
    // Apply sway: tip shifts by swayOffsetPx, root stays fixed
    const tipSway = Math.round(swayOffsetPx * vineH / 10);
    // Stem — dark forest green
    ctx.fillStyle = '#175520';
    ctx.fillRect(sx + offX + tipSway, sy, px, vineH * px);
    // Tip — bright glow
    ctx.fillStyle = '#4fd46e';
    ctx.fillRect(sx + offX + tipSway, sy + (vineH - 1) * px, px, px);
    // Small leaf pixel midway
    if (vineH >= 4) {
      const midY = Math.floor(vineH / 2);
      const midSway = Math.round(swayOffsetPx * midY / (vineH * 2));
      ctx.fillStyle = '#2e9944';
      ctx.fillRect(sx + offX + midSway - px, sy + midY * px, 2 * px, px);
    }
  }
}

// ── Public API: render & lights ───────────────────────────────────────────────

/**
 * Renders all decoration sprites onto `ctx`.
 * Call this BEFORE `addDecorationBloom` and BEFORE the dark room overlay.
 *
 * @param vpW / vpH   Virtual viewport dimensions for screen-space culling.
 *                    Decorations whose block column falls entirely outside the
 *                    viewport (plus a margin equal to the block size) are skipped.
 * @param waveState  Optional pre-updated wave state driving per-decoration sway.
 *                   When provided, decorations lean in the direction of nearby
 *                   entity motion (higher speed = more lean, springs back).
 */
export function renderDecorationSprites(
  ctx: CanvasRenderingContext2D,
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
  waveState?: DecorationWaveState,
  vpW = 480,
  vpH = 270,
): void {
  // Margin in screen pixels: enough to avoid popping for the tallest glow-grass
  // or mushroom (approximately blockSizePx in height).
  const marginPx = blockSizePx * scalePx * 1.5;

  for (let i = 0; i < decorations.length; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    // Viewport cull: skip decorations well outside the visible area.
    if (sx + blockSizePx * scalePx + marginPx < 0 || sx - marginPx > vpW) continue;
    if (sy + marginPx < 0 || sy - marginPx > vpH) continue;

    // Sway: angle (rad) → pixel offset at the tip.
    // A stem of approximately half-a-block height at typical scale leans by round(angle * height).
    const swayAngle = waveState !== undefined ? waveState.getSway(i) : 0;
    // Stem height heuristic: half the block size in virtual pixels.
    const stemHeightPx = blockSizePx * 0.5 * scalePx;
    const swayOffsetPx = Math.round(swayAngle * stemHeightPx);

    if (d.kind === 'glowGrass') {
      _drawGlowGrass(ctx, sx, sy, blockSizePx, scalePx, d.seed, swayOffsetPx);
    } else if (d.kind === 'mushroom') {
      _drawMushroom(ctx, sx, sy, blockSizePx, scalePx, d.seed, swayOffsetPx);
    } else {
      _drawVine(ctx, sx, sy, blockSizePx, scalePx, d.seed, swayOffsetPx);
    }
  }
}

/**
 * Adds glowing halos for decorations to the bloom system.
 * Call this during the bloom accumulation phase (alongside drawParticleGlow).
 * Uses `performance.now()` for a gentle pulse — render-side use is permitted.
 *
 * @param maxCount      Maximum decorations to submit (quality-tier cap).  Pass
 *                      a large value (e.g. 512) to effectively disable the cap.
 * @param vpW / vpH     Virtual viewport dimensions for screen-space culling.
 *                      Decorations whose glow circle falls entirely outside the
 *                      viewport are skipped.
 */
export function addDecorationBloom(
  bloomSystem: BloomSystem,
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
  nowMs: number,
  maxCount: number,
  vpW: number,
  vpH: number,
): void {
  let submitted = 0;
  for (let i = 0; i < decorations.length && submitted < maxCount; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    if (d.kind === 'glowGrass') {
      const centerXPx = sx + Math.round(blockSizePx * scalePx * 0.5);
      const centerYPx = sy - Math.round(2 * scalePx);
      const glowR     = 5 * scalePx;
      if (!isScreenCircleVisible(centerXPx, centerYPx, glowR, vpW, vpH)) continue;
      const pulse     = 0.8 + 0.2 * Math.sin(nowMs * 0.0011 + d.seed * 0.013);
      bloomSystem.glowPass.drawCircleDirect(centerXPx, centerYPx, glowR, 0.22 * pulse, '#22aa44');
      submitted++;
    } else if (d.kind === 'mushroom') {
      const h2       = _hash(d.seed, 0, 0xf00dface);
      const bw       = Math.round(blockSizePx * scalePx);
      const offX     = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * Math.max(1, Math.round(scalePx)))) + Math.max(1, Math.round(scalePx));
      const stemH    = 2 + (h2 & 1);
      const px       = Math.max(1, Math.round(scalePx));
      const capCX    = sx + offX + px;
      const capCY    = sy - (stemH + 1) * px;
      const glowR    = 7 * scalePx;
      if (!isScreenCircleVisible(capCX, capCY, glowR, vpW, vpH)) continue;
      const isBlue   = ((h2 >> 4) & 1) === 0;
      const glowColor = isBlue ? '#8860e0' : '#44cc88';
      const pulse     = 0.75 + 0.25 * Math.sin(nowMs * 0.0009 + d.seed * 0.017);
      bloomSystem.glowPass.drawCircleDirect(capCX, capCY, glowR, 0.55 * pulse, glowColor);
      submitted++;
    } else {
      // Vine: glow at the tip (bottom) of the longest strand
      const h2    = _hash(d.seed, 0, 0xc0ffee77);
      const bw    = Math.round(blockSizePx * scalePx);
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - Math.max(1, Math.round(scalePx))));
      const vineH = 3 + ((h2 >> 8) & 0x7);
      const px    = Math.max(1, Math.round(scalePx));
      const tipCX = sx + offX;
      const tipCY = sy + vineH * px;
      const glowR = 5 * scalePx;
      if (!isScreenCircleVisible(tipCX, tipCY, glowR, vpW, vpH)) continue;
      const pulse = 0.8 + 0.2 * Math.sin(nowMs * 0.0013 + d.seed * 0.019);
      bloomSystem.glowPass.drawCircleDirect(tipCX, tipCY, glowR, 0.30 * pulse, '#2ad46a');
      submitted++;
    }
  }
}

/**
 * Fills `out` with screen-space light source descriptors for the DarkRoomOverlay.
 * The `out` array is cleared at the start of each call so the caller can pass
 * a stable module-level array to avoid per-frame allocation.
 *
 * Must be called after the camera offset is known.
 *
 * @param out            Pre-allocated output array.  Cleared and filled in place.
 * @param maxLightCount  Maximum lights to add.  Decorations beyond this cap
 *                       are skipped (furthest from origin are dropped first via
 *                       iteration order).  Pass a large value to disable cap.
 * @param vpW / vpH      Virtual viewport dimensions for screen-space culling.
 *                       Decorations whose light circle falls entirely outside
 *                       the viewport are not added to the array.
 */
export function collectDecorationLights(
  out: Float32Array,
  startCount: number,
  maxCount: number,
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
  vpW: number,
  vpH: number,
): number {
  let count = startCount;
  for (let i = 0; i < decorations.length && count < maxCount; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    if (d.kind === 'glowGrass') {
      const lx = sx + Math.round(blockSizePx * scalePx * 0.5);
      const ly = sy - Math.round(2 * scalePx);
      const lr = 14 * scalePx;
      if (!isScreenCircleVisible(lx, ly, lr, vpW, vpH)) continue;
      const base = count * LIGHT_BUFFER_STRIDE;
      out[base + 0] = lx;
      out[base + 1] = ly;
      out[base + 2] = lr;
      out[base + 3] = 0.1;
      out[base + 4] = 255;
      out[base + 5] = 255;
      out[base + 6] = 255;
      count++;
    } else if (d.kind === 'mushroom') {
      const h2    = _hash(d.seed, 0, 0xf00dface);
      const bw    = Math.round(blockSizePx * scalePx);
      const px    = Math.max(1, Math.round(scalePx));
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
      const stemH = 2 + (h2 & 1);
      const lx    = sx + offX + px;
      const ly    = sy - (stemH + 1) * px;
      const lr    = 26 * scalePx;
      if (!isScreenCircleVisible(lx, ly, lr, vpW, vpH)) continue;
      const base = count * LIGHT_BUFFER_STRIDE;
      out[base + 0] = lx;
      out[base + 1] = ly;
      out[base + 2] = lr;
      out[base + 3] = 0.08;
      out[base + 4] = 255;
      out[base + 5] = 255;
      out[base + 6] = 255;
      count++;
    } else {
      // Vine: light at tip
      const h2    = _hash(d.seed, 0, 0xc0ffee77);
      const bw    = Math.round(blockSizePx * scalePx);
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - Math.max(1, Math.round(scalePx))));
      const vineH = 3 + ((h2 >> 8) & 0x7);
      const px    = Math.max(1, Math.round(scalePx));
      const lx    = sx + offX;
      const ly    = sy + vineH * px;
      const lr    = 18 * scalePx;
      if (!isScreenCircleVisible(lx, ly, lr, vpW, vpH)) continue;
      const base = count * LIGHT_BUFFER_STRIDE;
      out[base + 0] = lx;
      out[base + 1] = ly;
      out[base + 2] = lr;
      out[base + 3] = 0.1;
      out[base + 4] = 255;
      out[base + 5] = 255;
      out[base + 6] = 255;
      count++;
    }
  }
  return count;
}
