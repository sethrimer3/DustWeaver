/**
 * Wall decorations — pixelated glowing moss and mushrooms.
 *
 * Decorations are automatically placed on horizontal floor tile surfaces
 * (tiles whose tile-below is open air) using a deterministic hash seeded
 * by (col, row).  The system is purely visual and lives in the render layer.
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

import type { WallSnapshot } from '../snapshot';
import type { BloomSystem } from './bloomSystem';
import type { LightSourcePx } from './darkRoomOverlay';

// ── Decoration types ──────────────────────────────────────────────────────────

export type DecorKind = 'moss' | 'mushroom';

export interface WallDecoration {
  /** World-space X of the tile left edge (col * blockSizePx). */
  readonly worldLeftPx: number;
  /** World-space Y of the tile bottom edge ((row + 1) * blockSizePx). */
  readonly worldBottomPx: number;
  /** Visual kind. */
  readonly kind: DecorKind;
  /** Deterministic seed derived from tile coordinates. */
  readonly seed: number;
}

// ── Cache ─────────────────────────────────────────────────────────────────────

/** Decoration list keyed by a lightweight wall-layout signature. */
const _decoCache = new Map<string, WallDecoration[]>();

// ── Deterministic hash ────────────────────────────────────────────────────────

/**
 * A simple, allocation-free 32-bit integer hash of three integers.
 * Returns a non-negative number.  For decoration use only (not sim RNG).
 */
function _hash(a: number, b: number, c: number): number {
  // Combine with mixing constants similar to PCG / Murmur3
  let h = (Math.imul(a, 0x6c62272e) ^ Math.imul(b, 0x9e3779b9) ^ Math.imul(c, 0x517cc1b7)) >>> 0;
  h = (Math.imul(h ^ (h >>> 16), 0x45d9f3b)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}

// ── Occupancy helpers ─────────────────────────────────────────────────────────

function _buildOccupied(walls: WallSnapshot, blockSizePx: number): Set<string> {
  const occupied = new Set<string>();
  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isInvisibleFlag[wi] === 1) continue;
    if (walls.isPlatformFlag[wi] === 1) continue;
    if (walls.rampOrientationIndex[wi] !== 255) continue; // ramps skipped

    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        occupied.add(`${colStart + c},${rowStart + r}`);
      }
    }
  }
  return occupied;
}

function _isOccupied(occupied: Set<string>, col: number, row: number): boolean {
  return occupied.has(`${col},${row}`);
}

// ── Public API: compute decorations ──────────────────────────────────────────

/**
 * Returns (from cache or freshly computed) a list of wall decorations for the
 * given wall snapshot.  The list is stable as long as the wall geometry does
 * not change.
 */
export function getWallDecorations(
  walls: WallSnapshot,
  blockSizePx: number,
): readonly WallDecoration[] {
  // Build a lightweight change-detection signature.
  let sig = `${blockSizePx}|${walls.count}`;
  for (let wi = 0; wi < walls.count; wi++) {
    sig += `|${walls.xWorld[wi]},${walls.yWorld[wi]},${walls.wWorld[wi]},${walls.hWorld[wi]}`;
  }

  const cached = _decoCache.get(sig);
  if (cached !== undefined) return cached;

  const occupied = _buildOccupied(walls, blockSizePx);
  const decorations: WallDecoration[] = [];

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);

    // Only place decorations on top surfaces (tile below is open air).
    if (_isOccupied(occupied, col, row + 1)) continue;

    const h = _hash(col, row, 0x4d726b5e);
    const roll = h % 100;
    // 70 % nothing | 20 % moss | 10 % mushroom
    if (roll < 70) continue;

    const kind: DecorKind = roll < 90 ? 'moss' : 'mushroom';
    decorations.push({
      worldLeftPx:   col * blockSizePx,
      worldBottomPx: (row + 1) * blockSizePx,
      kind,
      seed: h,
    });
  }

  // Evict oldest entry when cache grows large.
  if (_decoCache.size >= 8) {
    const firstKey = _decoCache.keys().next().value;
    if (firstKey !== undefined) _decoCache.delete(firstKey);
  }
  _decoCache.set(sig, decorations);
  return decorations;
}

// ── Pixel-art drawing helpers ─────────────────────────────────────────────────

/**
 * Draws a pixelated moss tuft at the screen position (sx, sy), where sy is
 * the floor surface (bottom of the tile in screen space, i.e. the decorations
 * grow upward from sy).  px is the size of one virtual pixel.
 */
function _drawMoss(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  blockSizePx: number,
  scalePx: number,
  seed: number,
): void {
  const px  = Math.max(1, Math.round(scalePx));
  const bw  = Math.round(blockSizePx * scalePx);
  // 3–6 small grass tufts spread across the tile bottom.
  const count = 3 + (seed & 3);
  for (let i = 0; i < count; i++) {
    const h2      = _hash(seed, i, 0xabcde123);
    const offX    = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - px));
    const tufH    = 1 + ((h2 >> 8) & 0x3);   // 1–4 px tall
    // Stem — dark forest green
    ctx.fillStyle = '#1d5a26';
    ctx.fillRect(sx + offX, sy - tufH * px, px, tufH * px);
    // Tip pixel — bright green highlight
    ctx.fillStyle = '#3db048';
    ctx.fillRect(sx + offX, sy - tufH * px, px, px);
  }
}

/**
 * Draws a tiny pixelated mushroom at screen position (sx, sy).
 * The mushroom grows upward from the floor surface at sy.
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
  // Horizontal offset: keep cap (3 px wide) inside tile bounds.
  const offX   = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
  const stemH  = 2 + (h2 & 1);     // 2–3 px stem
  const capW   = 3;                 // always 3 px wide cap

  // Stem — pale ivory
  ctx.fillStyle = '#c8b89a';
  ctx.fillRect(sx + offX, sy - stemH * px, px, stemH * px);

  // Cap — either bioluminescent purple or teal depending on seed bit
  const isBlue     = ((h2 >> 4) & 1) === 0;
  const capColor   = isBlue ? '#7a58b8' : '#4aaa7a';
  ctx.fillStyle    = capColor;
  ctx.fillRect(sx + offX - px, sy - (stemH + 2) * px, capW * px, 2 * px);

  // Small bright dot on cap for a spore/glow highlight
  ctx.fillStyle = 'rgba(240,255,200,0.85)';
  ctx.fillRect(sx + offX, sy - (stemH + 2) * px, px, px);
}

// ── Public API: render & lights ───────────────────────────────────────────────

/**
 * Renders all decoration sprites onto `ctx` and returns nothing.
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
    const sx = Math.round(d.worldLeftPx   * scalePx + offsetXPx);
    const sy = Math.round(d.worldBottomPx * scalePx + offsetYPx);

    if (d.kind === 'moss') {
      _drawMoss(ctx, sx, sy, blockSizePx, scalePx, d.seed);
    } else {
      _drawMushroom(ctx, sx, sy, blockSizePx, scalePx, d.seed);
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
    const sx = Math.round(d.worldLeftPx   * scalePx + offsetXPx);
    const sy = Math.round(d.worldBottomPx * scalePx + offsetYPx);

    if (d.kind === 'moss') {
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
    } else {
      // Mushroom: derive cap position the same way as _drawMushroom.
      const h2       = _hash(d.seed, 0, 0xf00dface);
      const bw       = Math.round(blockSizePx * scalePx);
      const offX     = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * Math.max(1, Math.round(scalePx)))) + Math.max(1, Math.round(scalePx));
      const stemH    = 2 + (h2 & 1);
      const px       = Math.max(1, Math.round(scalePx));
      const capCX    = sx + offX + px;   // approximate cap centre X
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
    const sx = Math.round(d.worldLeftPx   * scalePx + offsetXPx);
    const sy = Math.round(d.worldBottomPx * scalePx + offsetYPx);

    if (d.kind === 'moss') {
      lights.push({
        xPx:          sx + Math.round(blockSizePx * scalePx * 0.5),
        yPx:          sy - Math.round(2 * scalePx),
        radiusPx:     14 * scalePx,
        innerFraction: 0.1,
      });
    } else {
      const h2   = _hash(d.seed, 0, 0xf00dface);
      const bw   = Math.round(blockSizePx * scalePx);
      const px   = Math.max(1, Math.round(scalePx));
      const offX = Math.floor(((h2 & 0xff) / 255.0) * Math.max(0, bw - 3 * px)) + px;
      const stemH = 2 + (h2 & 1);
      lights.push({
        xPx:          sx + offX + px,
        yPx:          sy - (stemH + 1) * px,
        radiusPx:     26 * scalePx,
        innerFraction: 0.08,
      });
    }
  }
  return lights;
}
