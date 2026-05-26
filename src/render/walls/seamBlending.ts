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
 *
 * Pure procedural stamp helpers live in ./seamProfileDrawers.ts.
 */

import { loadImg } from '../imageCache';
import type { CachedWallLayout } from './blockWallLayoutCache';
import type { BlockTheme } from '../../levels/roomDef';
import type { BlockSeamBlending } from '../../levels/roomDef';

export type { BlockSeamBlending };

import {
  type TransitionProfileKind,
  type BlockTransitionProfile,
  DIR_N, DIR_E, DIR_S, DIR_W,
  NEIGHBOR_OFFSETS,
  intensityAlpha,
  intensityDensity,
  drawProfileOverlay,
  drawSpriteOverlay,
  drawInnerCornerAccent,
  drawDiagonalAccent,
} from './seamProfileDrawers';

export type { TransitionProfileKind, BlockTransitionProfile };

// ── Theme → profile mapping ───────────────────────────────────────────────────

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
const _spriteCache = new Map<string, HTMLImageElement | null | 'loading'>();

function _transitionSpriteUrl(profile: TransitionProfileKind, slot: string): string {
  return `ASSETS/SPRITES/BLOCKS/transitions/generic/${profile}/${slot}.png`;
}

/** Initiates a one-time async load.  Subsequent calls for the same key are no-ops. */
function _loadTransitionSprite(profile: TransitionProfileKind, slot: string): void {
  const key = `${profile}/${slot}`;
  if (_spriteCache.has(key)) return;
  // Set a sentinel immediately so concurrent calls for the same key are no-ops
  // while the image is still in flight.
  _spriteCache.set(key, 'loading');
  const img = loadImg(_transitionSpriteUrl(profile, slot));
  // If the image was already loaded and errored (pre-cached 404 returned by
  // loadImg), the error event will not fire again — detect it synchronously.
  if (img.complete && img.naturalWidth === 0) {
    _spriteCache.set(key, null);
    return;
  }
  // Happy path: image is loading or already complete and valid.
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
  const entry = _spriteCache.get(key)!;
  if (entry === null || entry === 'loading') return null; // miss or still in flight
  if (entry.complete && entry.naturalWidth > 0) return entry;
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
