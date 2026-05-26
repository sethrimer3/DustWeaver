/**
 * seamProfileDrawers.ts — Pure procedural stamp helpers for seam transitions.
 *
 * Contains the deterministic drawing functions (mossy, crumbly, cracked, …)
 * extracted from seamBlending.ts.  All functions are pure: they read only
 * their parameters and write only to the provided canvas context.
 *
 * The `BlockTransitionProfile` and `TransitionProfileKind` types live here so
 * the drawing functions can be typed without importing from seamBlending.ts
 * (which would create a circular dependency).
 */

import type { BlockSeamBlending } from '../../levels/roomDef';

// ── Transition profile types ───────────────────────────────────────────────────

/**
 * How a block theme behaves at its seam edges.
 *
 * transitionPriority: higher value wins when two themes compete to draw an
 * overlay on the same seam edge.
 */
export type TransitionProfileKind =
  | 'none'
  | 'mossy'
  | 'crumbly'
  | 'cracked'
  | 'rooted'
  | 'dusty'
  | 'veined'
  | 'corrupted';

export interface BlockTransitionProfile {
  kind: TransitionProfileKind;
  /** Higher wins when two themes compete. Range 0–7. */
  priority: number;
  /** This profile can draw outgoing overlays onto neighbours. */
  allowsOutgoing: boolean;
  /** This profile accepts incoming overlays from neighbours. */
  allowsIncoming: boolean;
}

// ── Direction constants ────────────────────────────────────────────────────────

export const DIR_N = 0;
export const DIR_E = 1;
export const DIR_S = 2;
export const DIR_W = 3;

export const NEIGHBOR_OFFSETS: [number, number][] = [
  [ 0, -1], // N
  [ 1,  0], // E
  [ 0,  1], // S
  [-1,  0], // W
];

// ── Opacity by intensity ───────────────────────────────────────────────────────

export function intensityAlpha(mode: BlockSeamBlending): number {
  if (mode === 'subtle')  return 0.40;
  if (mode === 'organic') return 0.65;
  if (mode === 'heavy')   return 0.85;
  return 0;
}

/**
 * Density multiplier applied to stamp counts and skip thresholds.
 * subtle → sparser; organic → baseline; heavy → denser.
 */
export function intensityDensity(mode: BlockSeamBlending): number {
  if (mode === 'subtle')  return 0.5;
  if (mode === 'organic') return 1.0;
  if (mode === 'heavy')   return 1.4;
  return 1.0;
}

// ── Deterministic hash ─────────────────────────────────────────────────────────

/**
 * Fast 32-bit hash from tile coordinate, direction index, and a per-tile seed.
 * Returns a value in [0, 1).
 */
function hash01(col: number, row: number, dir: number, seed: number): number {
  let h = Math.imul(col * 374761393 + row * 1013904223 + dir * 31337 + seed, 1664525) + 1013904223 | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b | 0) | 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35 | 0) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

// ── Stamp helpers ──────────────────────────────────────────────────────────────

/**
 * Draws a pixel stamp. All coordinates are in canvas pixels.
 * px1 = 1 virtual pixel = scalePx canvas pixels, clamped to ≥1.
 */
function stamp(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  px1: number,
): void {
  ctx.fillRect(x, y, px1, px1);
}

// Edge region helper: returns [uMin, uMax] and [vMin, vMax] in tile-relative pixels
// for a stamp band along the given direction.
// u = along-edge axis, v = into-tile axis (v=0 is the seam edge).
function edgeBand(dir: number, sz: number, depth: number): { uMin: number; uMax: number; vMin: number; vMax: number } {
  if (dir === DIR_N) return { uMin: 0, uMax: sz, vMin: 0,        vMax: depth };
  if (dir === DIR_S) return { uMin: 0, uMax: sz, vMin: sz-depth, vMax: sz    };
  if (dir === DIR_W) return { uMin: 0, uMax: depth, vMin: 0,     vMax: sz    };
  /* DIR_E */        return { uMin: sz-depth, uMax: sz, vMin: 0, vMax: sz    };
}

/** Convert edge-relative (u, v) to tile-relative (x, y). */
function edgeToTile(dir: number, u: number, v: number): [number, number] {
  if (dir === DIR_N) return [u, v];
  if (dir === DIR_S) return [u, v];          // v counts from sz-depth already
  if (dir === DIR_W) return [v, u];
  /* DIR_E */        return [v, u];           // v counts from sz-depth
}

// ── Per-profile stamp drawers ──────────────────────────────────────────────────
//
// Base draw-rate thresholds (organic/density=1.0 baseline):
//   MOSSY_BASE_THRESHOLD   = 0.55  → ~55% of edge steps receive a moss blob.
//   CRUMBLY_BASE_THRESHOLD = 0.45  → ~45% of edge steps receive a crumb pixel.
// Multiplied by intensityDensity(): subtle≈0.28/0.23, organic≈0.55/0.45, heavy≈0.77/0.63.
const MOSSY_BASE_THRESHOLD   = 0.55;
const CRUMBLY_BASE_THRESHOLD = 0.45;

// Hash seed constants for corner and diagonal accents.
// Chosen as small odd offsets and prime seeds distinct from the edge stamp
// seeds (17, 31, 7, 19, …) to avoid visual correlation at seam edges.
const CORNER_HASH_OFFSET   = 10;  // added to cornerIdx to namespace corner hashes
const CORNER_HASH_SEED     = 251; // prime seed for inner corner skip decisions
const DIAGONAL_HASH_OFFSET = 20;  // added to cornerIdx to namespace diagonal hashes
const DIAGONAL_HASH_SEED   = 257; // prime seed for diagonal skip decisions

/** Mossy: clusters of 1–2px blobs, green-tinted, organic placement. */
function drawMossy(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,   // tile origin in canvas px
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  ctx.fillStyle = '#3a7a3a';
  const band = edgeBand(dir, sz, Math.ceil(3 * px1));
  const steps = Math.floor(sz / px1);
  // Cap at 0.95 as a defensive safety margin (at density=1.4 the highest value is
  // MOSSY_BASE_THRESHOLD*1.4 ≈ 0.77, well below the cap; the cap guards against
  // future custom profiles that might pass a larger density value).
  const threshold = Math.min(0.95, MOSSY_BASE_THRESHOLD * density);
  for (let i = 0; i < steps; i++) {
    const h0 = hash01(col, row, dir * 100 + i, 17);
    if (h0 > threshold) continue;
    const u = band.uMin + Math.round(h0 * (band.uMax - band.uMin - px1) / threshold);
    const vDepth = Math.round(hash01(col, row, dir * 100 + i, 31) * (band.vMax - band.vMin - px1));
    const [lx, ly] = edgeToTile(dir, u, band.vMin + vDepth);
    stamp(ctx, tx + lx, ty + ly, px1);
    // Occasional 2-pixel blob
    if (hash01(col, row, dir * 100 + i, 53) > 0.6) {
      stamp(ctx, tx + lx + px1, ty + ly, px1);
    }
  }
}

/** Crumbly/dirt: scattered single pixels along edge, earthy tones. */
function drawCrumbly(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  color: string,
  density: number,
): void {
  ctx.fillStyle = color;
  const band = edgeBand(dir, sz, Math.ceil(2 * px1));
  const steps = Math.floor(sz / px1);
  // Cap at 0.95 as a defensive safety margin (at density=1.4 the highest value is
  // CRUMBLY_BASE_THRESHOLD*1.4 ≈ 0.63, well below the cap; guards future profiles).
  const threshold = Math.min(0.95, CRUMBLY_BASE_THRESHOLD * density);
  for (let i = 0; i < steps; i++) {
    const h0 = hash01(col, row, dir * 100 + i, 7);
    if (h0 > threshold) continue;
    const u = band.uMin + Math.round(h0 * (band.uMax - band.uMin - px1) / threshold);
    const vDepth = Math.round(hash01(col, row, dir * 100 + i, 19) * (band.vMax - band.vMin - px1));
    const [lx, ly] = edgeToTile(dir, u, band.vMin + vDepth);
    stamp(ctx, tx + lx, ty + ly, px1);
  }
}

/** Cracked: thin 1-pixel fracture lines extending from seam edge. */
function drawCracked(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  ctx.fillStyle = '#444444';
  const numCracks = Math.max(1, Math.round(Math.floor(sz / px1 / 4) * density));
  const maxDepth = Math.ceil(4 * px1);
  for (let c = 0; c < numCracks; c++) {
    const h0 = hash01(col, row, dir * 1000 + c, 41);
    const startU = Math.round(h0 * (sz - px1));
    const crackLen = 1 + Math.floor(hash01(col, row, dir * 1000 + c, 59) * maxDepth / px1) * px1;
    // Draw from seam inward, with slight jitter
    let u = startU;
    for (let step = 0; step < crackLen; step += px1) {
      const jitter = Math.round((hash01(col, row, dir * 1000 + c * 100 + step, 73) - 0.5) * px1);
      u = Math.max(0, Math.min(sz - px1, u + jitter));
      const band = edgeBand(dir, sz, step + px1);
      const [lx, ly] = edgeToTile(dir, u, band.vMin + step);
      stamp(ctx, tx + lx, ty + ly, px1);
    }
  }
}

/** Rooted: short sinuous root tendrils from the seam edge. */
function drawRooted(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  ctx.fillStyle = '#5a3a1a';
  const numRoots = Math.max(1, Math.round((1 + Math.floor(sz / px1 / 5)) * density));
  const maxDepth = Math.ceil(5 * px1);
  for (let r = 0; r < numRoots; r++) {
    const h0 = hash01(col, row, dir * 777 + r, 101);
    let u = Math.round(h0 * (sz - px1));
    const rootLen = px1 + Math.floor(hash01(col, row, dir * 777 + r, 113) * maxDepth / px1) * px1;
    for (let step = 0; step < rootLen; step += px1) {
      const jitter = (hash01(col, row, dir * 777 + r * 50 + step, 127) > 0.6) ? px1 : 0;
      u = Math.max(0, Math.min(sz - px1, u + jitter));
      const band = edgeBand(dir, sz, step + px1);
      const [lx, ly] = edgeToTile(dir, u, band.vMin + step);
      stamp(ctx, tx + lx, ty + ly, px1);
    }
  }
}

/** Dusty: scattered 1-pixel dust motes spilling across seam. */
function drawDusty(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  color: string,
  density: number,
): void {
  ctx.fillStyle = color;
  const band = edgeBand(dir, sz, Math.ceil(3 * px1));
  const moteCount = Math.max(1, Math.round(Math.floor(sz / px1 * 0.3) * density));
  for (let m = 0; m < moteCount; m++) {
    const h0 = hash01(col, row, dir * 500 + m, 211);
    const u = band.uMin + Math.round(h0 * (band.uMax - band.uMin - px1));
    const vDepth = Math.round(hash01(col, row, dir * 500 + m, 223) * (band.vMax - band.vMin - px1));
    const [lx, ly] = edgeToTile(dir, u, band.vMin + vDepth);
    stamp(ctx, tx + lx, ty + ly, px1);
  }
}

/** Veined: single-pixel crystal vein lines extending from seam. */
function drawVeined(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  ctx.fillStyle = '#a0c8e8';
  const numVeins = Math.max(1, Math.round((1 + Math.floor(sz / px1 / 6)) * density));
  const maxDepth = Math.ceil(6 * px1);
  for (let v = 0; v < numVeins; v++) {
    const h0 = hash01(col, row, dir * 333 + v, 137);
    let u = Math.round(h0 * (sz - px1));
    const veinLen = px1 + Math.floor(hash01(col, row, dir * 333 + v, 149) * maxDepth / px1) * px1;
    for (let step = 0; step < veinLen; step += px1) {
      const jitter = (hash01(col, row, dir * 333 + v * 30 + step, 163) > 0.7) ? px1 : 0;
      const dir2 = (hash01(col, row, dir * 333 + v * 30 + step, 167) > 0.5) ? 1 : -1;
      u = Math.max(0, Math.min(sz - px1, u + jitter * dir2));
      const band = edgeBand(dir, sz, step + px1);
      const [lx, ly] = edgeToTile(dir, u, band.vMin + step);
      stamp(ctx, tx + lx, ty + ly, px1);
    }
  }
}

/** Corrupted: dark tendrils with occasional bright core pixels. */
function drawCorrupted(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  const numTendrils = Math.max(1, Math.round((1 + Math.floor(sz / px1 / 4)) * density));
  const maxDepth = Math.ceil(5 * px1);
  for (let t = 0; t < numTendrils; t++) {
    const h0 = hash01(col, row, dir * 999 + t, 179);
    let u = Math.round(h0 * (sz - px1));
    const tendrilLen = px1 + Math.floor(hash01(col, row, dir * 999 + t, 181) * maxDepth / px1) * px1;
    for (let step = 0; step < tendrilLen; step += px1) {
      ctx.fillStyle = '#1a0a2a';
      const jitter = (hash01(col, row, dir * 999 + t * 20 + step, 191) > 0.5) ? px1 : 0;
      const dir2 = (hash01(col, row, dir * 999 + t * 20 + step, 193) > 0.5) ? 1 : -1;
      u = Math.max(0, Math.min(sz - px1, u + jitter * dir2));
      const band = edgeBand(dir, sz, step + px1);
      const [lx, ly] = edgeToTile(dir, u, band.vMin + step);
      stamp(ctx, tx + lx, ty + ly, px1);
      // Occasional bright core pixel on first two steps
      if (step < 2 * px1 && hash01(col, row, dir * 999 + t * 20 + step, 197) > 0.7) {
        ctx.fillStyle = '#9a4aaa';
        stamp(ctx, tx + lx, ty + ly, px1);
      }
    }
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────────

export function drawProfileOverlay(
  ctx: CanvasRenderingContext2D,
  profile: BlockTransitionProfile,
  tx: number, ty: number,
  col: number, row: number,
  dir: number,
  sz: number, px1: number,
  density: number,
): void {
  switch (profile.kind) {
    case 'mossy':     drawMossy(ctx, tx, ty, col, row, dir, sz, px1, density); break;
    case 'crumbly':   drawCrumbly(ctx, tx, ty, col, row, dir, sz, px1, '#7a5a3a', density); break;
    case 'cracked':   drawCracked(ctx, tx, ty, col, row, dir, sz, px1, density); break;
    case 'rooted':    drawRooted(ctx, tx, ty, col, row, dir, sz, px1, density); break;
    case 'dusty':     drawDusty(ctx, tx, ty, col, row, dir, sz, px1, '#c8b880', density); break;
    case 'veined':    drawVeined(ctx, tx, ty, col, row, dir, sz, px1, density); break;
    case 'corrupted': drawCorrupted(ctx, tx, ty, col, row, dir, sz, px1, density); break;
    default: break;
  }
}

/**
 * Draw a custom sprite over the tile area.
 * The sprite is drawn crisp (imageSmoothingEnabled must be false on ctx).
 * The artist should design the sprite so that only the relevant edge area
 * has visible pixels; the rest should be transparent.
 */
export function drawSpriteOverlay(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  tx: number, ty: number,
  sz: number,
): void {
  ctx.drawImage(sprite, tx, ty, sz, sz);
}

// ── Corner / diagonal accent helpers ──────────────────────────────────────────

/**
 * Returns the accent color for procedural corner/diagonal stamps.
 * Matches the main stamp color for each profile.
 */
function _accentColor(profile: BlockTransitionProfile): string {
  switch (profile.kind) {
    case 'mossy':     return '#3a7a3a';
    case 'crumbly':   return '#7a5a3a';
    case 'cracked':   return '#444444';
    case 'rooted':    return '#5a3a1a';
    case 'dusty':     return '#c8b880';
    case 'veined':    return '#a0c8e8';
    case 'corrupted': return '#1a0a2a';
    default:          return '#888888';
  }
}

/**
 * Corner pixel offsets [xFrac, yFrac] within a tile.
 * xFrac=0→left edge, xFrac=1→right edge; yFrac=0→top, yFrac=1→bottom.
 * Corner index: 0=NE, 1=SE, 2=SW, 3=NW.
 */
const CORNER_PIXEL_X = [1, 1, 0, 0]; // 1 = right side (sz - px1), 0 = left side
const CORNER_PIXEL_Y = [0, 1, 1, 0]; // 1 = bottom (sz - px1), 0 = top

/**
 * Draw a small procedural accent at an inner corner (where two orthogonal
 * seam edges meet).  Keeps accents sparse — ~30% skip rate.
 */
export function drawInnerCornerAccent(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  cornerIdx: number,
  sz: number, px1: number,
  profile: BlockTransitionProfile,
): void {
  const h = hash01(col, row, cornerIdx + CORNER_HASH_OFFSET, CORNER_HASH_SEED);
  if (h > 0.70) return; // skip ~30%
  const cx = tx + (CORNER_PIXEL_X[cornerIdx] ? sz - px1 : 0);
  const cy = ty + (CORNER_PIXEL_Y[cornerIdx] ? sz - px1 : 0);
  ctx.fillStyle = _accentColor(profile);
  stamp(ctx, cx, cy, px1);
  // Occasional second pixel extending along one axis
  if (h < 0.35) {
    const extensionX = CORNER_PIXEL_X[cornerIdx] ? -px1 : px1;
    stamp(ctx, cx + extensionX, cy, px1);
  }
}

/**
 * Draw a minimal procedural accent for a diagonal-only contact (tiles that
 * touch diagonally but not orthogonally).  ~50% skip rate for sparseness.
 */
export function drawDiagonalAccent(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  cornerIdx: number,
  sz: number, px1: number,
  profile: BlockTransitionProfile,
): void {
  const h = hash01(col, row, cornerIdx + DIAGONAL_HASH_OFFSET, DIAGONAL_HASH_SEED);
  if (h > 0.50) return; // skip 50%
  const cx = tx + (CORNER_PIXEL_X[cornerIdx] ? sz - px1 : 0);
  const cy = ty + (CORNER_PIXEL_Y[cornerIdx] ? sz - px1 : 0);
  ctx.fillStyle = _accentColor(profile);
  stamp(ctx, cx, cy, px1);
}
