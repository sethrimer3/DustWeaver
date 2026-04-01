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

// ─── Image cache ─────────────────────────────────────────────────────────────

/** Caches loaded background images per world number. */
const _bgImageCache = new Map<number, HTMLImageElement>();

/** Tracks which worlds have started loading. */
const _bgLoadStarted = new Set<number>();

/**
 * Returns the cached background image for the given world, or null if not
 * yet loaded.  Triggers an async load on the first call for each world.
 */
function _getBgImage(worldNumber: number): HTMLImageElement | null {
  const cached = _bgImageCache.get(worldNumber);
  if (cached !== undefined && cached.complete && cached.naturalWidth > 0) {
    return cached;
  }

  if (!_bgLoadStarted.has(worldNumber)) {
    _bgLoadStarted.add(worldNumber);
    const img = new Image();
    img.src = worldBgImagePath(worldNumber);
    img.onload = () => {
      _bgImageCache.set(worldNumber, img);
    };
  }

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
 * Renders the room background for the current world with parallax scrolling.
 *
 * @param ctx               The 2D canvas context.
 * @param worldNumber       Active world number (0, 1, 2, …).
 * @param viewportWidthPx   Canvas width in pixels.
 * @param viewportHeightPx  Canvas height in pixels.
 * @param cameraOffsetXPx   Full camera X offset (foreground).
 * @param cameraOffsetYPx   Full camera Y offset (foreground).
 * @param roomWidthWorld    Room width in world units.
 * @param roomHeightWorld   Room height in world units.
 * @param zoom              Active camera zoom.
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
): void {
  const img = _getBgImage(worldNumber);

  // Thero showcase rooms use solid black — no parallax background image.
  if (worldNumber === 99) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
    return;
  }

  if (img === null) {
    // Image not loaded yet — draw solid fallback colour
    ctx.fillStyle = worldFallbackColor(worldNumber);
    ctx.fillRect(0, 0, viewportWidthPx, viewportHeightPx);
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
