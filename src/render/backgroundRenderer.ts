/**
 * World background renderer with parallax scrolling.
 *
 * Each world has a background texture loaded from an image file.
 * The background scrolls at a fraction of the camera offset
 * to create a depth/parallax effect.
 *
 * If an image is not yet loaded, the renderer draws a solid clear colour
 * as a deterministic fallback (no procedural generation).
 */

import type { BackgroundId } from '../levels/roomDef';
import { loadImg, isSpriteReady, isSpriteDecodeReady, decodeImg } from './imageCache';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Parallax factor: 0 = fully fixed, 1 = moves with foreground. */
const PARALLAX_FACTOR = 0.2;

/** Vite base URL for public assets. */
const BASE = import.meta.env.BASE_URL;

/** Path for world background images (relative to publicDir). */
function worldBgImagePath(worldNumber: number): string {
  if (worldNumber === 0) {
    return `${BASE}SPRITES/BACKGROUNDS/brownRock_background_1.png`;
  }
  return `${BASE}SPRITES/WORLDS/W-${worldNumber}/background/background.png`;
}

/**
 * Returns the image path for a named BackgroundId, or null for procedural
 * backgrounds (e.g. crystallineCracks) that have no static image.
 */
function backgroundIdToImagePath(id: BackgroundId): string | null {
  switch (id) {
    case 'brownRock':        return `${BASE}SPRITES/BACKGROUNDS/brownRock_background_1.png`;
    case 'world1':           return `${BASE}SPRITES/WORLDS/W-1/background/background.png`;
    case 'world2':           return `${BASE}SPRITES/WORLDS/W-2/background/background.png`;
    case 'world3':           return `${BASE}SPRITES/WORLDS/W-3/background/background.png`;
    case 'crystallineCracks':
    case 'thero_prologue':
    case 'thero_ch1':
    case 'thero_ch2':
    case 'thero_ch3':
    case 'thero_ch4':
    case 'thero_ch5':
    case 'thero_ch6':
      return null;  // procedural background effect
    default:                 return null;
  }
}

/** Solid fallback colour per world (shown while the image is loading). */
function worldFallbackColor(worldNumber: number): string {
  switch (worldNumber) {
    case 0:  return '#2a1a0e';  // brown-rock cave
    case 1:  return '#051408';  // deep dark green
    case 2:  return '#080c1a';  // dark blue
    case 3:  return '#1a0500';  // deep dark red-orange
    default: return '#0a0a12';
  }
}

// ─── Background image stats ───────────────────────────────────────────────────

/** Running count of background image cache hits (image ready on first draw). */
let _bgCacheHits   = 0;
/** Running count of background image cache misses (fallback drawn). */
let _bgCacheMisses = 0;
/** Count of fallback fills drawn this frame (reset each render call). */
let _bgFallbacksThisFrame = 0;

/** Returns current background image cache hit / miss / fallback counters. */
export function getBgImageStats(): {
  cacheHits: number;
  cacheMisses: number;
  fallbacksThisFrame: number;
} {
  return {
    cacheHits:          _bgCacheHits,
    cacheMisses:        _bgCacheMisses,
    fallbacksThisFrame: _bgFallbacksThisFrame,
  };
}

// ─── Image access via shared cache ───────────────────────────────────────────

/**
 * Returns the cached background image for the given URL when it is decoded
 * and draw-ready, or `null` otherwise.
 *
 * Uses the shared `imageCache.loadImg` singleton so the same
 * HTMLImageElement is returned regardless of which module loaded it first.
 * If the image has been through `decodeImg()` (e.g. via
 * `preloadBackgroundImageDecoded()`), `isSpriteDecodeReady()` returns `true`
 * immediately even before `img.complete` is stable on all browsers.
 *
 * A `loadImg()` call is always made so the background image starts loading
 * the first time `renderWorldBackground()` is called for a new URL, even if
 * `preloadBackgroundImageDecoded()` was never called.
 */
function _getBgImageByUrl(url: string): HTMLImageElement | null {
  const img = loadImg(url);   // idempotent — same element on repeat calls
  if (isSpriteDecodeReady(img)) {
    _bgCacheHits++;
    return img;
  }
  // Not yet decoded: kick off a background decode if not already in flight.
  void decodeImg(url);
  _bgCacheMisses++;
  // Treat plain-loaded images as ready for drawing (avoids a blank frame when
  // decode() is unavailable or the call races with the first render).
  if (isSpriteReady(img)) return img;
  return null;
}

/**
 * Wraps an offset into the range [-tileSize, 0) so that tiling starts
 * just off-screen to the left/top and seamlessly covers the viewport.
 */
function wrapToTileStart(offset: number, tileSize: number): number {
  return -((((-offset) % tileSize) + tileSize) % tileSize);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Triggers HTMLImageElement.decode() for the static background image
 * associated with `id`, ensuring the GPU has rasterized the texture before
 * the first drawImage call.
 *
 * Fire-and-forget — returns immediately for procedural backgrounds (those
 * with no static image URL).  Safe to call multiple times; decodeImg() is
 * idempotent for already-decoded URLs.
 */
export function preloadBackgroundImageDecoded(id: BackgroundId): void {
  const url = backgroundIdToImagePath(id);
  if (url !== null) void decodeImg(url);
}

/**
 * Renders the room background for the current world with parallax scrolling.
 *
 * If `backgroundId` is provided it overrides `worldNumber` for image selection.
 * For `backgroundId='crystallineCracks'`, a solid black fill is drawn — the
 * caller is responsible for rendering the procedural effect on top.
 *
 * @param ctx               The 2D canvas context.
 * @param worldNumber       Active world number (0, 1, 2, …) — used as fallback.
 * @param viewportWidthPx   Canvas width in pixels.
 * @param viewportHeightPx  Canvas height in pixels.
 * @param cameraOffsetXPx   Full camera X offset (foreground).
 * @param cameraOffsetYPx   Full camera Y offset (foreground).
 * @param roomWidthWorld    Room width in world units.
 * @param roomHeightWorld   Room height in world units.
 * @param zoom              Active camera zoom.
 * @param backgroundId      Optional named background override.
 */
export function renderWorldBackground(
  ctx: CanvasRenderingContext2D,
  worldNumber: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  cameraOffsetXPx: number,
  cameraOffsetYPx: number,
  roomWidthWorld: number,
  roomHeightWorld: number,
  zoom: number,
  backgroundId?: BackgroundId,
): void {
  _bgFallbacksThisFrame = 0;

  // Thero showcase rooms and Crystalline Cracks use solid black — no parallax image.
  if (
    worldNumber === 99 ||
    backgroundId === 'crystallineCracks' ||
    backgroundId === 'thero_prologue' ||
    backgroundId === 'thero_ch1' ||
    backgroundId === 'thero_ch2' ||
    backgroundId === 'thero_ch3' ||
    backgroundId === 'thero_ch4' ||
    backgroundId === 'thero_ch5' ||
    backgroundId === 'thero_ch6'
  ) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    return;
  }

  // Determine the image URL to use
  const imgUrl = backgroundId != null
    ? backgroundIdToImagePath(backgroundId)
    : worldBgImagePath(worldNumber);

  if (imgUrl === null) {
    // Procedural background with no image — solid black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    return;
  }

  const img = _getBgImageByUrl(imgUrl);

  if (img === null) {
    // Image not loaded yet — draw solid fallback colour
    ctx.fillStyle = worldFallbackColor(worldNumber);
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    _bgFallbacksThisFrame++;
    return;
  }

  const tw = img.naturalWidth;
  const th = img.naturalHeight;
  if (tw === 0 || th === 0) return;

  // Anchor background to room centre, then apply relative camera parallax.
  const roomCenterOffsetXPx = viewportWidthPx * 0.5 - (roomWidthWorld * 0.5 * zoom);
  const roomCenterOffsetYPx = viewportHeightPx * 0.5 - (roomHeightWorld * 0.5 * zoom);
  const relCameraOffsetXPx = cameraOffsetXPx - roomCenterOffsetXPx;
  const relCameraOffsetYPx = cameraOffsetYPx - roomCenterOffsetYPx;

  // Keep a centred tiled origin so the room centre maps to image centre.
  const centeredOriginXPx = (viewportWidthPx - tw) * 0.5;
  const centeredOriginYPx = (viewportHeightPx - th) * 0.5;
  const pxOff = centeredOriginXPx + relCameraOffsetXPx * PARALLAX_FACTOR;
  const pyOff = centeredOriginYPx + relCameraOffsetYPx * PARALLAX_FACTOR;

  // Compute starting tile position so tiles seamlessly cover the viewport.
  const startX = wrapToTileStart(pxOff, tw);
  const startY = wrapToTileStart(pyOff, th);

  ctx.save();
  for (let y = startY; y < viewportHeightPx; y += th) {
    for (let x = startX; x < viewportWidthPx; x += tw) {
      ctx.drawImage(img, x, y);
    }
  }
  ctx.restore();
}
