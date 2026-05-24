/**
 * seamBlending.ts — Block seam transition overlay renderer.
 *
 * When two adjacent tiles have different block themes, this pass optionally
 * draws small procedural pixel-art stamp details over the seam edge: moss
 * creeping, dirt crumbs, cracks, roots, dust, crystal veins, corruption.
 *
 * Design constraints:
 *  - Crisp 1×1 fillRect stamps only — no blur, no alpha-smearing.
 *  - Deterministic: seed = roomSeed ^ (col * A + row * B + dir * C).
 *  - Off by default; rooms opt in via blockSeamBlending setting.
 *  - Only drawn as a second pass on top of existing tile rendering.
 *  - Does not change collision, tile placement, or room data semantics.
 *
 * Custom transition sprites (optional):
 *  - Place PNGs at ASSETS/SPRITES/BLOCKS/transitions/generic/{profile}/edge_{N|E|S|W}_01.png
 *  - Optional corner/diagonal: corner_inner_01.png, corner_outer_01.png, diagonal_01.png
 *  - Missing sprites fall back to the procedural stamp system automatically.
 *  - Missing sprites are cached as misses — they are NOT re-fetched every frame.
 */

import { loadImg } from '../imageCache';
import type { CachedWallLayout } from './blockWallLayoutCache';
import type { BlockTheme } from '../../levels/roomDef';
import type { BlockSeamBlending } from '../../levels/roomDef';

export type { BlockSeamBlending };

// ── Transition profile ────────────────────────────────────────────────────────

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

const PROFILES: Record<TransitionProfileKind, BlockTransitionProfile> = {
  none:      { kind: 'none',      priority: 0, allowsOutgoing: false, allowsIncoming: true  },
  dusty:     { kind: 'dusty',     priority: 1, allowsOutgoing: true,  allowsIncoming: true  },
  crumbly:   { kind: 'crumbly',   priority: 2, allowsOutgoing: true,  allowsIncoming: true  },
  cracked:   { kind: 'cracked',   priority: 3, allowsOutgoing: true,  allowsIncoming: true  },
  mossy:     { kind: 'mossy',     priority: 4, allowsOutgoing: true,  allowsIncoming: true  },
  rooted:    { kind: 'rooted',    priority: 5, allowsOutgoing: true,  allowsIncoming: true  },
  veined:    { kind: 'veined',    priority: 6, allowsOutgoing: true,  allowsIncoming: false },
  corrupted: { kind: 'corrupted', priority: 7, allowsOutgoing: true,  allowsIncoming: false },
};

// ── Theme → profile mapping ───────────────────────────────────────────────────

/**
 * Explicit theme-ID → profile overrides.  Profile resolution order:
 *  1. EXPLICIT_PROFILES (checked first — exact match on stable theme ID).
 *  2. PROFILE_KEYWORDS  (substring heuristic fallback).
 *  3. 'none'            (no overlay).
 *
 * Add entries here when a new block theme is introduced whose ID does not
 * match any keyword in PROFILE_KEYWORDS, or when the keyword match is wrong.
 * Use the theme's stable ID string (same value stored in roomDef.blockTheme).
 *
 * Examples (add real IDs as themes are authored):
 *   'grayStoneCarved':  'cracked',
 *   'jungleMoss':       'rooted',
 *   'ironPlating':      'none',
 */
const EXPLICIT_PROFILES: Record<string, TransitionProfileKind> = {
  // ── Add new mappings here when keyword heuristics are insufficient ──────────
  // 'themeId': 'profileKind',
};

// Keyword lists (order: most-specific first)
const PROFILE_KEYWORDS: [TransitionProfileKind, string[]][] = [
  ['corrupted', ['corrupt', 'void', 'taint', 'shadow', 'blight', 'dark']],
  ['veined',    ['crystal', 'vein', 'gem', 'prism', 'glowing', 'luminite', 'glow', 'quartz']],
  ['rooted',    ['root', 'vine', 'wood', 'bark', 'overgrow', 'jungle', 'forest', 'moss', 'lichen']],
  ['mossy',     ['algae', 'wet', 'swamp', 'bog', 'humid', 'dripping']],
  ['cracked',   ['crack', 'shatter', 'fracture', 'ruin', 'ancient', 'broken', 'worn']],
  ['crumbly',   ['dirt', 'soil', 'mud', 'clay', 'earth', 'gravel', 'loam']],
  ['dusty',     ['sand', 'dust', 'ash', 'chalk', 'powder', 'bone', 'desert', 'dry']],
  ['none',      ['marble', 'iron', 'metal', 'steel', 'tile', 'brick', 'clean', 'polished',
                 'glass', 'ice', 'light']],
];

const _profileCache = new Map<string, BlockTransitionProfile>();

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive a transition profile for a block theme string.
 * Resolution order: explicit override → keyword heuristic → none.
 * Returns PROFILES.none for null / unknown themes.
 */
export function getTransitionProfile(theme: BlockTheme | null): BlockTransitionProfile {
  if (theme === null) return PROFILES.none;
  const cached = _profileCache.get(theme);
  if (cached) return cached;

  // 1. Explicit override.
  const explicit = EXPLICIT_PROFILES[theme as string];
  if (explicit !== undefined) {
    const result = PROFILES[explicit];
    _profileCache.set(theme, result);
    return result;
  }

  // 2. Keyword heuristic.
  const token = normalizeToken(theme);
  let found: BlockTransitionProfile = PROFILES.none;
  outer: for (const [kind, keywords] of PROFILE_KEYWORDS) {
    for (const kw of keywords) {
      if (token.includes(kw)) {
        found = PROFILES[kind];
        break outer;
      }
    }
  }
  _profileCache.set(theme, found);
  return found;
}

// ── Deterministic hash ────────────────────────────────────────────────────────

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

// ── Direction constants ───────────────────────────────────────────────────────

const DIR_N = 0;
const DIR_E = 1;
const DIR_S = 2;
const DIR_W = 3;

const NEIGHBOR_OFFSETS: [number, number][] = [
  [ 0, -1], // N
  [ 1,  0], // E
  [ 0,  1], // S
  [-1,  0], // W
];

// ── Custom transition sprite cache ────────────────────────────────────────────

/**
 * Sprite slot names for edge directions (index matches DIR_N/E/S/W).
 * Optional future-compatible corner/diagonal slots.
 */
const DIR_SLOT_NAMES = ['edge_N_01', 'edge_E_01', 'edge_S_01', 'edge_W_01'] as const;
const SLOT_CORNER_INNER  = 'corner_inner_01';
const SLOT_CORNER_OUTER  = 'corner_outer_01';
const SLOT_DIAGONAL      = 'diagonal_01';

/**
 * Module-level sprite cache keyed by "${profile}/${slot}".
 *  undefined  → not yet attempted (key absent from map)
 *  null       → attempted but 404/error (miss — will not be retried)
 *  image      → loaded (may still be completing; check .complete && .naturalWidth)
 */
const _spriteCache = new Map<string, HTMLImageElement | null>();

function _transitionSpriteUrl(profile: TransitionProfileKind, slot: string): string {
  return `ASSETS/SPRITES/BLOCKS/transitions/generic/${profile}/${slot}.png`;
}

/** Initiates a one-time async load.  Subsequent calls for the same key are no-ops. */
function _loadTransitionSprite(profile: TransitionProfileKind, slot: string): void {
  const key = `${profile}/${slot}`;
  if (_spriteCache.has(key)) return;
  const img = loadImg(_transitionSpriteUrl(profile, slot));
  _spriteCache.set(key, img);
  img.addEventListener('error', () => {
    // 404 or network error: mark as a permanent miss so we stop retrying.
    _spriteCache.set(key, null);
  }, { once: true });
}

/**
 * Returns a fully-loaded sprite for the given profile+slot, or null when
 * unavailable (not found, errored, or still loading).
 *
 * Side-effect on first call: fires `_loadTransitionSprite` so the image
 * starts loading.  Subsequent frames that call this before the image has
 * finished loading continue to return null (procedural fallback) and do NOT
 * fire additional network requests.
 */
function _getReadySprite(profile: TransitionProfileKind, slot: string): HTMLImageElement | null {
  const key = `${profile}/${slot}`;
  if (!_spriteCache.has(key)) {
    _loadTransitionSprite(profile, slot);
    return null; // not ready yet — use procedural fallback this frame
  }
  const img = _spriteCache.get(key)!;
  if (img === null) return null; // known miss
  if (img.complete && img.naturalWidth > 0) return img;
  return null; // still loading
}

/**
 * Warm the transition sprite cache for the given profile kinds.
 *
 * Call this once per room entry (similar to preloadRoomThemeSprites).
 * All loadImg() calls are idempotent — this is a no-op for already-attempted
 * URLs.  Only non-none profiles are processed.
 */
export function preloadTransitionSprites(profiles: readonly TransitionProfileKind[]): void {
  for (const profile of profiles) {
    if (profile === 'none') continue;
    for (const slot of DIR_SLOT_NAMES) {
      _loadTransitionSprite(profile, slot);
    }
    _loadTransitionSprite(profile, SLOT_CORNER_INNER);
    _loadTransitionSprite(profile, SLOT_CORNER_OUTER);
    _loadTransitionSprite(profile, SLOT_DIAGONAL);
  }
}

// ── Opacity by intensity ──────────────────────────────────────────────────────

function intensityAlpha(mode: BlockSeamBlending): number {
  if (mode === 'subtle')  return 0.40;
  if (mode === 'organic') return 0.65;
  if (mode === 'heavy')   return 0.85;
  return 0;
}

/**
 * Density multiplier applied to stamp counts and skip thresholds.
 * subtle → sparser; organic → baseline; heavy → denser.
 */
function intensityDensity(mode: BlockSeamBlending): number {
  if (mode === 'subtle')  return 0.5;
  if (mode === 'organic') return 1.0;
  if (mode === 'heavy')   return 1.4;
  return 1.0;
}

// ── Stamp helpers ─────────────────────────────────────────────────────────────

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

// ── Per-profile stamp drawers ─────────────────────────────────────────────────

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
  const threshold = Math.min(0.95, 0.55 * density);
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
  const threshold = Math.min(0.95, 0.45 * density);
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

// ── Dispatcher ────────────────────────────────────────────────────────────────

function drawProfileOverlay(
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
function drawSpriteOverlay(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLImageElement,
  tx: number, ty: number,
  sz: number,
): void {
  ctx.drawImage(sprite, tx, ty, sz, sz);
}

// ── Corner / diagonal accent helpers ─────────────────────────────────────────

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
function drawInnerCornerAccent(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  cornerIdx: number,
  sz: number, px1: number,
  profile: BlockTransitionProfile,
): void {
  const h = hash01(col, row, cornerIdx + 10, 251);
  if (h > 0.70) return; // skip ~30%
  const cx = tx + (CORNER_PIXEL_X[cornerIdx] ? sz - px1 : 0);
  const cy = ty + (CORNER_PIXEL_Y[cornerIdx] ? sz - px1 : 0);
  ctx.fillStyle = _accentColor(profile);
  stamp(ctx, cx, cy, px1);
  // Occasional second pixel extending along one axis
  if (h < 0.35) {
    const jx = CORNER_PIXEL_X[cornerIdx] ? -px1 : px1;
    stamp(ctx, cx + jx, cy, px1);
  }
}

/**
 * Draw a minimal procedural accent for a diagonal-only contact (tiles that
 * touch diagonally but not orthogonally).  ~50% skip rate for sparseness.
 */
function drawDiagonalAccent(
  ctx: CanvasRenderingContext2D,
  tx: number, ty: number,
  col: number, row: number,
  cornerIdx: number,
  sz: number, px1: number,
  profile: BlockTransitionProfile,
): void {
  const h = hash01(col, row, cornerIdx + 20, 257);
  if (h > 0.50) return; // skip 50%
  const cx = tx + (CORNER_PIXEL_X[cornerIdx] ? sz - px1 : 0);
  const cy = ty + (CORNER_PIXEL_Y[cornerIdx] ? sz - px1 : 0);
  ctx.fillStyle = _accentColor(profile);
  stamp(ctx, cx, cy, px1);
}

// ── Debug colors per direction ────────────────────────────────────────────────

const DEBUG_COLORS = ['#00ff00', '#ff8800', '#00ffff', '#ff00ff'];

// ── Main render pass ──────────────────────────────────────────────────────────

/**
 * Renders the seam transition overlay pass.
 *
 * Called from `_doRenderWallTilesDirect` in `blockSpriteRenderer.ts` after all
 * five normal tile passes have completed.  The canvas state (save/restore) is
 * managed by the caller.
 *
 * Features:
 *  - Custom sprites when present; procedural fallback when absent.
 *  - Inner corner accents where two orthogonal seams meet.
 *  - Diagonal contact accents where tiles touch only diagonally.
 *  - Per-mode density multipliers (subtle=sparse, organic=normal, heavy=dense).
 *
 * @param ctx         The chunk's offscreen canvas context.
 * @param wallLayout  Layout cache; provides `occupied`, `tileTheme`, and
 *                    per-chunk `occupiedByChunkKey` buckets.
 * @param roomTheme   Room-default block theme (null = world-number mode).
 * @param offsetXPx   Chunk canvas left edge offset in canvas pixels.
 * @param offsetYPx   Chunk canvas top edge offset in canvas pixels.
 * @param scalePx     Canvas pixels per virtual pixel.
 * @param blockSizePx Block size in virtual pixels (typically 8).
 * @param chunkKey    Pre-bucketed chunk key, or null for full-room scan.
 * @param mode        Seam blending intensity.
 * @param isDebug     When true, draw edge-indicator debug lines instead.
 */
export function renderSeamOverlayPass(
  ctx: CanvasRenderingContext2D,
  wallLayout: CachedWallLayout,
  roomTheme: BlockTheme | null,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  blockSizePx: number,
  chunkKey: string | null,
  mode: BlockSeamBlending,
  isDebug: boolean,
): void {
  if (mode === 'off' && !isDebug) return;

  const alpha = isDebug ? 1.0 : intensityAlpha(mode);
  if (alpha <= 0) return;

  const density = isDebug ? 1.0 : intensityDensity(mode);
  const tileSz  = blockSizePx * scalePx;
  const px1     = Math.max(1, Math.round(scalePx));

  const tiles = chunkKey !== null
    ? (wallLayout.occupiedByChunkKey.get(chunkKey) ?? [])
    : wallLayout.occupiedTiles;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  for (const tile of tiles) {
    const { col, row, key } = tile;

    // Resolve the theme for this tile.
    const myThemeTmp = wallLayout.tileTheme.get(key);
    const myTheme: BlockTheme | null = myThemeTmp === undefined ? roomTheme : myThemeTmp;

    const tx = Math.round(col * tileSz + offsetXPx);
    const ty = Math.round(row * tileSz + offsetYPx);

    // ── Pass 1: 4-directional edge seams ────────────────────────────────────
    // Track which directions have seams (for corner/diagonal detection below).
    const hasSeam   = [false, false, false, false]; // indexed by DIR_N/E/S/W
    const seamWinner: (BlockTransitionProfile | null)[] = [null, null, null, null];

    for (let d = 0; d < 4; d++) {
      const [dc, dr] = NEIGHBOR_OFFSETS[d];
      const nKey = `${col + dc},${row + dr}`;

      // Neighbour must be a solid tile.
      if (!wallLayout.occupied.has(nKey)) continue;

      // Resolve the neighbour's theme.
      const nThemeTmp = wallLayout.tileTheme.get(nKey);
      const nTheme: BlockTheme | null = nThemeTmp === undefined ? roomTheme : nThemeTmp;

      // Same theme — no seam.
      if (myTheme === nTheme) continue;

      if (isDebug) {
        // Debug mode: draw a colored 1-pixel line along the seam edge.
        ctx.fillStyle = DEBUG_COLORS[d];
        const sz = tileSz;
        if (d === DIR_N) ctx.fillRect(tx, ty,            sz,  px1);
        if (d === DIR_S) ctx.fillRect(tx, ty + sz - px1, sz,  px1);
        if (d === DIR_W) ctx.fillRect(tx,            ty, px1, sz );
        if (d === DIR_E) ctx.fillRect(tx + sz - px1, ty, px1, sz );
        continue;
      }

      // Choose which profile draws the overlay.
      const myProfile = getTransitionProfile(myTheme);
      const nProfile  = getTransitionProfile(nTheme);

      let winner: BlockTransitionProfile | null = null;

      // The "outgoing" side draws INTO the "incoming" side.
      // We are drawing within the current tile (myTheme) looking toward neighbour.
      if (myProfile.allowsIncoming && nProfile.allowsOutgoing) {
        winner = nProfile;
      }
      if (nProfile.allowsIncoming && myProfile.allowsOutgoing) {
        if (winner === null || myProfile.priority > nProfile.priority) {
          winner = myProfile;
        }
      }
      if (winner === null || winner.kind === 'none') continue;

      hasSeam[d] = true;
      seamWinner[d] = winner;

      // Try custom sprite first; fall back to procedural stamp.
      const sprite = _getReadySprite(winner.kind, DIR_SLOT_NAMES[d]);
      if (sprite !== null) {
        drawSpriteOverlay(ctx, sprite, tx, ty, tileSz);
      } else {
        drawProfileOverlay(ctx, winner, tx, ty, col, row, d, tileSz, px1, density);
      }
    }

    if (isDebug) continue;

    // ── Pass 2: inner corner accents ────────────────────────────────────────
    // Draw a small accent wherever two orthogonal seam edges meet.
    // cornerPairs: [dir1, dir2, cornerIdx]
    //   cornerIdx: 0=NE (N+E), 1=SE (S+E), 2=SW (S+W), 3=NW (N+W)
    if (hasSeam[DIR_N] && hasSeam[DIR_E]) {
      const w = (seamWinner[DIR_N]!.priority >= seamWinner[DIR_E]!.priority)
        ? seamWinner[DIR_N]! : seamWinner[DIR_E]!;
      const sprite = _getReadySprite(w.kind, SLOT_CORNER_INNER);
      if (sprite !== null) { drawSpriteOverlay(ctx, sprite, tx, ty, tileSz); }
      else { drawInnerCornerAccent(ctx, tx, ty, col, row, 0, tileSz, px1, w); }
    }
    if (hasSeam[DIR_S] && hasSeam[DIR_E]) {
      const w = (seamWinner[DIR_S]!.priority >= seamWinner[DIR_E]!.priority)
        ? seamWinner[DIR_S]! : seamWinner[DIR_E]!;
      const sprite = _getReadySprite(w.kind, SLOT_CORNER_INNER);
      if (sprite !== null) { drawSpriteOverlay(ctx, sprite, tx, ty, tileSz); }
      else { drawInnerCornerAccent(ctx, tx, ty, col, row, 1, tileSz, px1, w); }
    }
    if (hasSeam[DIR_S] && hasSeam[DIR_W]) {
      const w = (seamWinner[DIR_S]!.priority >= seamWinner[DIR_W]!.priority)
        ? seamWinner[DIR_S]! : seamWinner[DIR_W]!;
      const sprite = _getReadySprite(w.kind, SLOT_CORNER_INNER);
      if (sprite !== null) { drawSpriteOverlay(ctx, sprite, tx, ty, tileSz); }
      else { drawInnerCornerAccent(ctx, tx, ty, col, row, 2, tileSz, px1, w); }
    }
    if (hasSeam[DIR_N] && hasSeam[DIR_W]) {
      const w = (seamWinner[DIR_N]!.priority >= seamWinner[DIR_W]!.priority)
        ? seamWinner[DIR_N]! : seamWinner[DIR_W]!;
      const sprite = _getReadySprite(w.kind, SLOT_CORNER_INNER);
      if (sprite !== null) { drawSpriteOverlay(ctx, sprite, tx, ty, tileSz); }
      else { drawInnerCornerAccent(ctx, tx, ty, col, row, 3, tileSz, px1, w); }
    }

    // ── Pass 3: diagonal-only contact accents ───────────────────────────────
    // Diagonal contact: tiles that touch only at a corner (no orthogonal seam).
    // Only process corners where neither orthogonal direction has a seam.
    // diagInfo: [orthoDir1, orthoDir2, cornerIdx, diagDC, diagDR]
    const diagInfo: [number, number, number, number, number][] = [
      [DIR_N, DIR_E, 0,  1, -1], // NE diagonal
      [DIR_S, DIR_E, 1,  1,  1], // SE diagonal
      [DIR_S, DIR_W, 2, -1,  1], // SW diagonal
      [DIR_N, DIR_W, 3, -1, -1], // NW diagonal
    ];
    for (const [d1, d2, ci, dc, dr] of diagInfo) {
      // Only process corners where neither orthogonal edge has a seam
      // (avoids double-drawing corners already handled by inner corner accents).
      if (hasSeam[d1] || hasSeam[d2]) continue;

      const diagKey = `${col + dc},${row + dr}`;
      if (!wallLayout.occupied.has(diagKey)) continue;

      const diagThemeTmp = wallLayout.tileTheme.get(diagKey);
      const diagTheme: BlockTheme | null = diagThemeTmp === undefined ? roomTheme : diagThemeTmp;
      if (myTheme === diagTheme) continue;

      const myProfile   = getTransitionProfile(myTheme);
      const diagProfile = getTransitionProfile(diagTheme);

      let winner: BlockTransitionProfile | null = null;
      if (myProfile.allowsIncoming && diagProfile.allowsOutgoing) winner = diagProfile;
      if (diagProfile.allowsIncoming && myProfile.allowsOutgoing) {
        if (winner === null || myProfile.priority > diagProfile.priority) winner = myProfile;
      }
      if (winner === null || winner.kind === 'none') continue;

      const sprite = _getReadySprite(winner.kind, SLOT_DIAGONAL);
      if (sprite !== null) { drawSpriteOverlay(ctx, sprite, tx, ty, tileSz); }
      else { drawDiagonalAccent(ctx, tx, ty, col, row, ci, tileSz, px1, winner); }
    }
  }

  ctx.restore();
}
