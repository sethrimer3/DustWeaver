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
 */

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
                 'crystal', 'glass', 'ice', 'light']],
];

const _profileCache = new Map<string, BlockTransitionProfile>();

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive a transition profile for a block theme string.
 * Returns PROFILES.none for null / unknown themes.
 */
export function getTransitionProfile(theme: BlockTheme | null): BlockTransitionProfile {
  if (theme === null) return PROFILES.none;
  const cached = _profileCache.get(theme);
  if (cached) return cached;

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

// ── Opacity by intensity ──────────────────────────────────────────────────────

function intensityAlpha(mode: BlockSeamBlending): number {
  if (mode === 'subtle')  return 0.40;
  if (mode === 'organic') return 0.65;
  if (mode === 'heavy')   return 0.85;
  return 0;
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
): void {
  ctx.fillStyle = '#3a7a3a';
  const band = edgeBand(dir, sz, Math.ceil(3 * px1));
  const steps = Math.floor(sz / px1);
  for (let i = 0; i < steps; i++) {
    const h0 = hash01(col, row, dir * 100 + i, 17);
    if (h0 > 0.55) continue;
    const u = band.uMin + Math.round(h0 * (band.uMax - band.uMin - px1) / 0.55);
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
): void {
  ctx.fillStyle = color;
  const band = edgeBand(dir, sz, Math.ceil(2 * px1));
  const steps = Math.floor(sz / px1);
  for (let i = 0; i < steps; i++) {
    const h0 = hash01(col, row, dir * 100 + i, 7);
    if (h0 > 0.45) continue;
    const u = band.uMin + Math.round(h0 * (band.uMax - band.uMin - px1) / 0.45);
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
): void {
  ctx.fillStyle = '#444444';
  const numCracks = Math.floor(sz / px1 / 4);
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
): void {
  ctx.fillStyle = '#5a3a1a';
  const numRoots = 1 + Math.floor(sz / px1 / 5);
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
): void {
  ctx.fillStyle = color;
  const band = edgeBand(dir, sz, Math.ceil(3 * px1));
  const moteCount = Math.floor(sz / px1 * 0.3);
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
): void {
  ctx.fillStyle = '#a0c8e8';
  const numVeins = 1 + Math.floor(sz / px1 / 6);
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
): void {
  const numTendrils = 1 + Math.floor(sz / px1 / 4);
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
): void {
  switch (profile.kind) {
    case 'mossy':     drawMossy(ctx, tx, ty, col, row, dir, sz, px1); break;
    case 'crumbly':   drawCrumbly(ctx, tx, ty, col, row, dir, sz, px1, '#7a5a3a'); break;
    case 'cracked':   drawCracked(ctx, tx, ty, col, row, dir, sz, px1); break;
    case 'rooted':    drawRooted(ctx, tx, ty, col, row, dir, sz, px1); break;
    case 'dusty':     drawDusty(ctx, tx, ty, col, row, dir, sz, px1, '#c8b880'); break;
    case 'veined':    drawVeined(ctx, tx, ty, col, row, dir, sz, px1); break;
    case 'corrupted': drawCorrupted(ctx, tx, ty, col, row, dir, sz, px1); break;
    default: break;
  }
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

  const tileSz  = blockSizePx * scalePx;
  const px1     = Math.max(1, Math.round(scalePx));

  const tiles = chunkKey !== null
    ? (wallLayout.occupiedByChunkKey.get(chunkKey) ?? [])
    : wallLayout.occupiedTiles;

  ctx.save();
  ctx.globalAlpha = alpha;

  for (const tile of tiles) {
    const { col, row, key } = tile;

    // Resolve the theme for this tile.
    const myThemeTmp = wallLayout.tileTheme.get(key);
    const myTheme: BlockTheme | null = myThemeTmp === undefined ? roomTheme : myThemeTmp;

    const tx = Math.round(col * tileSz + offsetXPx);
    const ty = Math.round(row * tileSz + offsetYPx);

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

      drawProfileOverlay(ctx, winner, tx, ty, col, row, d, tileSz, px1);
    }
  }

  ctx.restore();
}
