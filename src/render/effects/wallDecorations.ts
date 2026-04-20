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

import type { RoomDecorationDef, DecorationKind } from '../../levels/roomDef';
import type { BloomSystem } from './bloomSystem';
import type { LightSourcePx } from './darkRoomOverlay';

// ── Decoration types ──────────────────────────────────────────────────────────

/** Re-export the canonical decoration kind type for render-layer consumers. */
export type { DecorationKind };

export interface WallDecoration {
  /** World-space X of the anchor block's left edge (xBlock * blockSizePx). */
  readonly worldLeftPx: number;
  /**
   * World-space Y of the decoration's surface anchor:
   * - For 'mushroom' / 'glowGrass': top surface of the floor block (yBlock * blockSizePx).
   * - For 'vine': bottom surface of the ceiling block ((yBlock + 1) * blockSizePx).
   *
   * Mushroom/grass draw UPWARD from this Y; vines draw DOWNWARD.
   */
  readonly worldAnchorYPx: number;
  /** Visual kind. */
  readonly kind: DecorationKind;
  /** Deterministic seed derived from block coordinates. */
  readonly seed: number;
}

// ── Deterministic hash ────────────────────────────────────────────────────────

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

// ── Public API: build decoration list from room data ─────────────────────────

/**
 * Converts room decoration definitions into render-ready WallDecoration objects.
 * The seed for each decoration is derived deterministically from its position and kind.
 */
export function buildRoomDecorations(
  decorations: readonly RoomDecorationDef[],
  blockSizePx: number,
): WallDecoration[] {
  const result: WallDecoration[] = [];
  for (let i = 0; i < decorations.length; i++) {
    const d = decorations[i];
    const kindCode = d.kind === 'mushroom' ? 1 : d.kind === 'glowGrass' ? 2 : 3;
    const seed = _hash(d.xBlock, d.yBlock, kindCode);

    const worldLeftPx = d.xBlock * blockSizePx;
    // Floor decorations anchor to the TOP surface of their block (grows upward).
    // Vine decorations anchor to the BOTTOM surface of their block (hangs downward).
    const worldAnchorYPx = d.kind === 'vine'
      ? (d.yBlock + 1) * blockSizePx
      : d.yBlock * blockSizePx;

    result.push({ worldLeftPx, worldAnchorYPx, kind: d.kind, seed });
  }
  return result;
}

// ── Pixel-art drawing helpers ─────────────────────────────────────────────────

/**
 * Draws a pixelated glowing-grass tuft at screen position (sx, sy).
 * sy is the floor surface; the grass grows UPWARD from sy (toward smaller Y).
 */
function _drawGlowGrass(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
): void {
  const px  = Math.max(1, Math.round(scalePx));
  const bw  = Math.round(blockSizePx * scalePx);
  const count = 3 + (seed & 3);
  for (let i = 0; i < count; i++) {
    const h2   = _hash(seed, i, 0xabcde123);
    const offX = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - px));
    const tufH = 1 + ((h2 >> 8) & 0x3);
    ctx.fillStyle = '#1d5a26';
    ctx.fillRect(sx + offX, sy - tufH * px, px, tufH * px);
    ctx.fillStyle = '#3db048';
    ctx.fillRect(sx + offX, sy - tufH * px, px, px);
  }
}

/**
 * Draws a tiny pixelated mushroom at screen position (sx, sy).
 * sy is the floor surface; the mushroom grows UPWARD from sy.
 */
function _drawMushroom(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
): void {
  const px     = Math.max(1, Math.round(scalePx));
  const bw     = Math.round(blockSizePx * scalePx);
  const h2     = _hash(seed, 0, 0xf00dface);
  const offX   = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
  const stemH  = 2 + (h2 & 1);
  const capW   = 3;

  ctx.fillStyle = '#c8b89a';
  ctx.fillRect(sx + offX, sy - stemH * px, px, stemH * px);

  const isBlue   = ((h2 >> 4) & 1) === 0;
  const capColor = isBlue ? '#7a58b8' : '#4aaa7a';
  ctx.fillStyle  = capColor;
  ctx.fillRect(sx + offX - px, sy - (stemH + 2) * px, capW * px, 2 * px);

  ctx.fillStyle = 'rgba(240,255,200,0.85)';
  ctx.fillRect(sx + offX, sy - (stemH + 2) * px, px, px);
}

/**
 * Draws a glowing vine at screen position (sx, sy).
 * sy is the ceiling bottom surface; the vine hangs DOWNWARD from sy (toward larger Y).
 */
function _drawVine(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
): void {
  const px   = Math.max(1, Math.round(scalePx));
  const bw   = Math.round(blockSizePx * scalePx);
  const count = 2 + (seed & 3);
  for (let i = 0; i < count; i++) {
    const h2      = _hash(seed, i, 0xc0ffee77);
    const offX    = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - px));
    const vineH   = 3 + ((h2 >> 8) & 0x7);
    // Stem — dark forest green
    ctx.fillStyle = '#175520';
    ctx.fillRect(sx + offX, sy, px, vineH * px);
    // Tip — bright glow
    ctx.fillStyle = '#4fd46e';
    ctx.fillRect(sx + offX, sy + (vineH - 1) * px, px, px);
    // Small leaf pixel midway
    if (vineH >= 4) {
      const midY = Math.floor(vineH / 2);
      ctx.fillStyle = '#2e9944';
      ctx.fillRect(sx + offX - px, sy + midY * px, 2 * px, px);
    }
  }
}

// ── Public API: render & lights ───────────────────────────────────────────────

/**
 * Renders all decoration sprites onto `ctx`.
 * Call this BEFORE `addDecorationBloom` and BEFORE the dark room overlay.
 */
export function renderDecorationSprites(
  ctx: CanvasRenderingContext2D,
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
): void {
  for (let i = 0; i < decorations.length; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    if (d.kind === 'glowGrass') {
      _drawGlowGrass(ctx, sx, sy, blockSizePx, scalePx, d.seed);
    } else if (d.kind === 'mushroom') {
      _drawMushroom(ctx, sx, sy, blockSizePx, scalePx, d.seed);
    } else {
      _drawVine(ctx, sx, sy, blockSizePx, scalePx, d.seed);
    }
  }
}

/**
 * Adds glowing halos for all decorations to the bloom system.
 * Call this during the bloom accumulation phase (alongside drawParticleGlow).
 * Uses `performance.now()` for a gentle pulse — render-side use is permitted.
 */
export function addDecorationBloom(
  bloomSystem: BloomSystem,
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
  nowMs: number,
): void {
  for (let i = 0; i < decorations.length; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    if (d.kind === 'glowGrass') {
      const centerXPx = sx + Math.round(blockSizePx * scalePx * 0.5);
      const centerYPx = sy - Math.round(2 * scalePx);
      const pulse     = 0.8 + 0.2 * Math.sin(nowMs * 0.0011 + d.seed * 0.013);
      bloomSystem.glowPass.drawCircle({
        x:    centerXPx,
        y:    centerYPx,
        radius: 5 * scalePx,
        glow: {
          enabled:   true,
          intensity: 0.22 * pulse,
          color:     '#22aa44',
        },
      });
    } else if (d.kind === 'mushroom') {
      const h2       = _hash(d.seed, 0, 0xf00dface);
      const bw       = Math.round(blockSizePx * scalePx);
      const offX     = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * Math.max(1, Math.round(scalePx)))) + Math.max(1, Math.round(scalePx));
      const stemH    = 2 + (h2 & 1);
      const px       = Math.max(1, Math.round(scalePx));
      const capCX    = sx + offX + px;
      const capCY    = sy - (stemH + 1) * px;
      const isBlue   = ((h2 >> 4) & 1) === 0;
      const glowColor = isBlue ? '#8860e0' : '#44cc88';
      const pulse     = 0.75 + 0.25 * Math.sin(nowMs * 0.0009 + d.seed * 0.017);
      bloomSystem.glowPass.drawCircle({
        x:    capCX,
        y:    capCY,
        radius: 7 * scalePx,
        glow: {
          enabled:   true,
          intensity: 0.55 * pulse,
          color:     glowColor,
        },
      });
    } else {
      // Vine: glow at the tip (bottom) of the longest strand
      const h2    = _hash(d.seed, 0, 0xc0ffee77);
      const bw    = Math.round(blockSizePx * scalePx);
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - Math.max(1, Math.round(scalePx))));
      const vineH = 3 + ((h2 >> 8) & 0x7);
      const px    = Math.max(1, Math.round(scalePx));
      const tipCX = sx + offX;
      const tipCY = sy + vineH * px;
      const pulse = 0.8 + 0.2 * Math.sin(nowMs * 0.0013 + d.seed * 0.019);
      bloomSystem.glowPass.drawCircle({
        x:    tipCX,
        y:    tipCY,
        radius: 5 * scalePx,
        glow: {
          enabled:   true,
          intensity: 0.30 * pulse,
          color:     '#2ad46a',
        },
      });
    }
  }
}

/**
 * Converts decorations to screen-space light source descriptors for the
 * DarkRoomOverlay.  Must be called after the camera offset is known.
 */
export function collectDecorationLights(
  decorations: readonly WallDecoration[],
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
): LightSourcePx[] {
  const lights: LightSourcePx[] = [];
  for (let i = 0; i < decorations.length; i++) {
    const d  = decorations[i];
    const sx = Math.round(d.worldLeftPx    * scalePx + offsetXPx);
    const sy = Math.round(d.worldAnchorYPx * scalePx + offsetYPx);

    if (d.kind === 'glowGrass') {
      lights.push({
        xPx:           sx + Math.round(blockSizePx * scalePx * 0.5),
        yPx:           sy - Math.round(2 * scalePx),
        radiusPx:      14 * scalePx,
        innerFraction: 0.1,
      });
    } else if (d.kind === 'mushroom') {
      const h2    = _hash(d.seed, 0, 0xf00dface);
      const bw    = Math.round(blockSizePx * scalePx);
      const px    = Math.max(1, Math.round(scalePx));
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
      const stemH = 2 + (h2 & 1);
      lights.push({
        xPx:           sx + offX + px,
        yPx:           sy - (stemH + 1) * px,
        radiusPx:      26 * scalePx,
        innerFraction: 0.08,
      });
    } else {
      // Vine: light at tip
      const h2    = _hash(d.seed, 0, 0xc0ffee77);
      const bw    = Math.round(blockSizePx * scalePx);
      const offX  = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - Math.max(1, Math.round(scalePx))));
      const vineH = 3 + ((h2 >> 8) & 0x7);
      const px    = Math.max(1, Math.round(scalePx));
      lights.push({
        xPx:           sx + offX,
        yPx:           sy + vineH * px,
        radiusPx:      18 * scalePx,
        innerFraction: 0.1,
      });
    }
  }
  return lights;
}

