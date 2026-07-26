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
import { loadImg, isSpriteReady, isSpriteDecodeReady, decodeImg, hasImageFailed } from './imageCache';
import { backgroundIdToImageUrl, backgroundIdToBlurUrl } from './backgroundCatalogue';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Parallax factor: 0 = fully fixed, 1 = moves with foreground. */
const PARALLAX_FACTOR = 0.2;

/** Standard tile size in world units (8×8 virtual px at zoom 1). */
const TILE_SIZE_WORLD = 8;

/** Room dimension threshold above which parallax factor is damped (100 tiles). */
const LARGE_ROOM_WORLD_THRESHOLD = 100 * TILE_SIZE_WORLD; // 800 world units

/** Vite base URL for public assets. */
const BASE = import.meta.env?.BASE_URL ?? '/';

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
function backgroundIdToImagePath(id: BackgroundId, useBlur?: boolean): string | null {
  if (useBlur) {
    const blurUrl = backgroundIdToBlurUrl(id);
    if (blurUrl !== null) return blurUrl;
  }
  return backgroundIdToImageUrl(id);
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

/**
 * Per-frame background image draw-call result counters.
 * All three values are reset at the start of each `renderWorldBackground` call
 * so they reflect the most recent frame only.
 */
let _bgDrawReady      = 0;   // draw calls where a decoded image was available
let _bgDrawNotReady   = 0;   // draw calls where the image was not yet decoded
let _bgFallbacksThisFrame = 0; // draw calls that fell back to solid fill

/** Returns per-frame background image draw-call result counters. */
export function getBgImageStats(): {
  drawReady: number;
  drawNotReady: number;
  fallbacksThisFrame: number;
} {
  return {
    drawReady:          _bgDrawReady,
    drawNotReady:       _bgDrawNotReady,
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
    _bgDrawReady++;
    return img;
  }
  // Not yet decoded: kick off a background decode if not already in flight.
  void decodeImg(url);
  _bgDrawNotReady++;
  // Treat plain-loaded images as ready for drawing (avoids a blank frame when
  // decode() is unavailable or the call races with the first render).
  if (isSpriteReady(img)) return img;
  return null;
}

export interface BackgroundParallaxLayout {
  effectiveParallaxX: number;
  effectiveParallaxY: number;
  requiredOverscanX: number;
  requiredOverscanY: number;
  targetWidthPx: number;
  targetHeightPx: number;
  coverScale: number;
  bgWidthPx: number;
  bgHeightPx: number;
  drawX: number;
  drawY: number;
}

/**
 * Computes viewport-cover scaling and parallax offsets for a static background image.
 *
 * Sizing rules:
 *  - Sized primarily to cover the viewport with only modest overscan for parallax displacement.
 *  - Never scales to cover the entire room at once.
 *  - Preserves the aspect ratio of the loaded texture via uniform "cover" scaling (cropped at edges, never stretched or distorted).
 *  - For rooms over 100 tiles wide or tall, scales down the parallax factor inversely with room dimensions so movement remains subtle and overscan is bounded.
 */
export function computeBackgroundParallaxLayout(
  viewportWidthPx: number,
  viewportHeightPx: number,
  cameraOffsetXPx: number,
  cameraOffsetYPx: number,
  roomWidthWorld: number,
  roomHeightWorld: number,
  zoom: number,
  imgWidthPx: number,
  imgHeightPx: number,
): BackgroundParallaxLayout {
  const safeRoomW = Math.max(1, roomWidthWorld);
  const safeRoomH = Math.max(1, roomHeightWorld);

  // Damp parallax factor in very large rooms (> 100 tiles) to prevent rapid sliding or massive overscan.
  const effectiveParallaxX = PARALLAX_FACTOR * Math.min(1.0, LARGE_ROOM_WORLD_THRESHOLD / safeRoomW);
  const effectiveParallaxY = PARALLAX_FACTOR * Math.min(1.0, LARGE_ROOM_WORLD_THRESHOLD / safeRoomH);

  // Maximum camera offset displacement from room center across all valid positions (edges/corners).
  const maxCamDispX = Math.max(0, safeRoomW * 0.5 * zoom);
  const maxCamDispY = Math.max(0, safeRoomH * 0.5 * zoom);

  // Maximum parallax shift in screen pixels in either direction.
  const maxParallaxShiftX = maxCamDispX * effectiveParallaxX;
  const maxParallaxShiftY = maxCamDispY * effectiveParallaxY;

  // Required overscan to cover extreme displacements in both directions without revealing empty edges.
  const requiredOverscanX = 2 * maxParallaxShiftX;
  const requiredOverscanY = 2 * maxParallaxShiftY;

  const targetWidthPx = viewportWidthPx + requiredOverscanX;
  const targetHeightPx = viewportHeightPx + requiredOverscanY;

  // Uniform "cover" scaling to preserve aspect ratio without stretching or distorting.
  const scaleX = targetWidthPx / Math.max(1, imgWidthPx);
  const scaleY = targetHeightPx / Math.max(1, imgHeightPx);
  const coverScale = Math.max(scaleX, scaleY);

  const bgWidthPx = imgWidthPx * coverScale;
  const bgHeightPx = imgHeightPx * coverScale;

  // Relative camera offset from room center.
  const roomCenterOffsetXPx = viewportWidthPx * 0.5 - safeRoomW * 0.5 * zoom;
  const roomCenterOffsetYPx = viewportHeightPx * 0.5 - safeRoomH * 0.5 * zoom;
  const relCameraOffsetXPx = cameraOffsetXPx - roomCenterOffsetXPx;
  const relCameraOffsetYPx = cameraOffsetYPx - roomCenterOffsetYPx;

  const centeredOriginXPx = (viewportWidthPx - bgWidthPx) * 0.5;
  const centeredOriginYPx = (viewportHeightPx - bgHeightPx) * 0.5;

  const rawShiftX = relCameraOffsetXPx * effectiveParallaxX;
  const rawShiftY = relCameraOffsetYPx * effectiveParallaxY;

  // Clamp shift so out-of-bounds panning or transitions never reveal empty edges.
  const shiftX = Math.max(-maxParallaxShiftX, Math.min(maxParallaxShiftX, rawShiftX));
  const shiftY = Math.max(-maxParallaxShiftY, Math.min(maxParallaxShiftY, rawShiftY));

  const drawX = centeredOriginXPx + shiftX;
  const drawY = centeredOriginYPx + shiftY;

  return {
    effectiveParallaxX,
    effectiveParallaxY,
    requiredOverscanX,
    requiredOverscanY,
    targetWidthPx,
    targetHeightPx,
    coverScale,
    bgWidthPx,
    bgHeightPx,
    drawX,
    drawY,
  };
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
export function preloadBackgroundImageDecoded(id: BackgroundId, useBlur?: boolean): void {
  const url = backgroundIdToImagePath(id, useBlur);
  if (url !== null) void decodeImg(url);
}

/**
 * Triggers HTMLImageElement.decode() for the background image that
 * `renderWorldBackground()` will actually render for the given room parameters.
 *
 * Uses the same URL-selection logic as `renderWorldBackground()`:
 *   - If `backgroundId` is provided, decodes its image (or no-ops for procedural ones).
 *   - Otherwise decodes the world-number image (`worldBgImagePath(worldNumber)`).
 *   - World 99 (Thero showcase) uses solid black — nothing to decode.
 *
 * Fire-and-forget.  Safe to call multiple times — decodeImg() is idempotent.
 */
export function preloadRoomBackgroundDecoded(worldNumber: number, backgroundId?: BackgroundId, useBlur?: boolean): void {
  if (worldNumber === 99) return;
  const url = backgroundId != null
    ? backgroundIdToImagePath(backgroundId, useBlur)
    : worldBgImagePath(worldNumber);
  if (url !== null) void decodeImg(url);
}

/**
 * Returns `true` once the background image for the given room parameters has
 * been fully decoded and is ready to render without any blocking decode step.
 *
 * Mirrors the URL-selection logic of `preloadRoomBackgroundDecoded`:
 *   - World 99 (solid black) is always considered ready.
 *   - Procedural backgrounds (no image URL) are always considered ready.
 *   - Otherwise waits for `isSpriteDecodeReady()` on the selected image.
 *
 * Use this alongside `areRoomSpritesReady()` in the loading-overlay tick so the
 * player is only unblocked once the background image is actually decoded.
 */
export function isRoomBackgroundDecodeReady(worldNumber: number, backgroundId?: BackgroundId, useBlur?: boolean): boolean {
  if (worldNumber === 99) return true;
  const url = backgroundId != null
    ? backgroundIdToImagePath(backgroundId, useBlur)
    : worldBgImagePath(worldNumber);
  if (url === null) return true; // procedural background — no image needed
  const img = loadImg(url);
  return isSpriteDecodeReady(img);
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
  useBlur?: boolean,
): void {
  _bgDrawReady = 0;
  _bgDrawNotReady = 0;
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
    ? backgroundIdToImagePath(backgroundId, useBlur)
    : worldBgImagePath(worldNumber);

  if (imgUrl === null) {
    // Procedural background with no image — solid black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    return;
  }

  if (hasImageFailed(imgUrl)) {
    // Image failed to load (e.g. missing asset) — draw solid black rather than
    // retrying forever or showing the per-world tint (which implies "still loading").
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    _bgFallbacksThisFrame++;
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
  if (tw === 0 || th === 0) {
    // Degenerate image dimensions (decode race, corrupt asset): fall back to
    // a solid fill so the room never shows a raw/undefined canvas region.
    ctx.fillStyle = worldFallbackColor(worldNumber);
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    _bgFallbacksThisFrame++;
    return;
  }

  // Safe fallback fill behind the image: in case of sub-pixel rendering seams
  // from float rounding on some browsers, guarantees no gap ever shows raw black.
  ctx.fillStyle = worldFallbackColor(worldNumber);
  ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);

  const layout = computeBackgroundParallaxLayout(
    viewportWidthPx,
    viewportHeightPx,
    cameraOffsetXPx,
    cameraOffsetYPx,
    roomWidthWorld,
    roomHeightWorld,
    zoom,
    tw,
    th,
  );

  ctx.drawImage(img, layout.drawX, layout.drawY, layout.bgWidthPx, layout.bgHeightPx);
}
