/**
 * specialBlockSprites.ts — Sprite loader for special block overlays.
 *
 * Loads sprites for:
 *   - Kinetic blocks (ice-look, drawn in renderHazards)
 *   - Falling block warning/pre-fall overlays (drawn in renderFallingBlocks)
 *
 * All sprite paths are under ASSETS/SPRITES/specialBLOCKS/ and are discovered
 * via import.meta.glob at build time.
 */

import { loadImg } from '../imageCache';

// Build-time discovery of all special block sprites
const _SPECIAL_BLOCKS_GLOB = import.meta.glob(
  '/ASSETS/SPRITES/specialBLOCKS/**/*.{png,webp,jpg,jpeg}',
  { query: '?url', import: 'default' },
);

// ── Kinetic block sprites ─────────────────────────────────────────────────────

const _KINETIC_BLOCK_URLS: string[] = [];
let _kineticUrlsBuilt = false;

function _buildKineticBlockUrls(): void {
  if (_kineticUrlsBuilt) return;
  _kineticUrlsBuilt = true;
  const prefix = '/ASSETS/SPRITES/specialBLOCKS/kineticBlock/';
  for (const key of Object.keys(_SPECIAL_BLOCKS_GLOB)) {
    if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
      _KINETIC_BLOCK_URLS.push(key.slice('/ASSETS/'.length));
    }
  }
  _KINETIC_BLOCK_URLS.sort();
}

/**
 * Returns an HTMLImageElement for the kinetic block sprite at variation index `varIdx`.
 * Returns null if no sprites are available or the image is still loading.
 *
 * Reserved for future sprite-based rendering. Kinetic blocks currently use
 * procedural ice-blue drawing in hazards.ts; call this here if you want to
 * overlay a custom sprite instead.
 */
export function getKineticBlockSprite(varIdx: number): HTMLImageElement | null {
  _buildKineticBlockUrls();
  if (_KINETIC_BLOCK_URLS.length === 0) return null;
  const url = _KINETIC_BLOCK_URLS[varIdx % _KINETIC_BLOCK_URLS.length];
  const img = loadImg(url);
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// ── Falling block overlay sprites ─────────────────────────────────────────────

const _OVERLAY_URLS: string[] = [];
let _overlayUrlsBuilt = false;

function _buildOverlayUrls(): void {
  if (_overlayUrlsBuilt) return;
  _overlayUrlsBuilt = true;
  const prefix = '/ASSETS/SPRITES/specialBLOCKS/fallingBlockOverlay/';
  for (const key of Object.keys(_SPECIAL_BLOCKS_GLOB)) {
    if (key.startsWith(prefix) && !key.slice(prefix.length).includes('/')) {
      _OVERLAY_URLS.push(key.slice('/ASSETS/'.length));
    }
  }
  _OVERLAY_URLS.sort();
}

/**
 * Returns the falling block overlay sprite for `overlayIndex` (0-based).
 * Returns null if unavailable or not yet loaded.
 */
export function getFallingBlockOverlaySprite(overlayIndex: number): HTMLImageElement | null {
  _buildOverlayUrls();
  if (_OVERLAY_URLS.length === 0) return null;
  const url = _OVERLAY_URLS[Math.min(overlayIndex, _OVERLAY_URLS.length - 1)];
  const img = loadImg(url);
  return img.complete && img.naturalWidth > 0 ? img : null;
}
