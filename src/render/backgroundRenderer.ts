/**
 * World background renderer with parallax scrolling.
 *
 * Each world has a background texture (loaded from an image file or generated
 * procedurally). The background scrolls at a fraction of the camera offset
 * to create a depth/parallax effect.
 *
 * The renderer pre-loads and tiles background images. If no image is
 * available for a world, a procedural texture is generated at startup.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Parallax factor: 0 = fully fixed, 1 = moves with foreground. */
const PARALLAX_FACTOR = 0.3;

/** Size of the procedurally-generated tile (px). */
const PROC_TILE_SIZE = 256;

/** Vite base URL for public assets. */
const BASE = import.meta.env.BASE_URL;

// ─── Image / procedural cache ────────────────────────────────────────────────

const _bgImageCache = new Map<number, HTMLCanvasElement>();

/**
 * Returns a background tile canvas for the given world.
 * Attempts to load `ASSETS/SPRITES/WORLDS/W-{n}/background/background.png`;
 * falls back to a procedurally generated tile if unavailable.
 */
function _getOrCreateBgTile(worldNumber: number): HTMLCanvasElement {
  const cached = _bgImageCache.get(worldNumber);
  if (cached !== undefined) return cached;

  // Create procedural fallback immediately (will be replaced if image loads)
  const tile = _generateProceduralTile(worldNumber);
  _bgImageCache.set(worldNumber, tile);

  // Attempt to load the real background image
  const img = new Image();
  img.src = `${BASE}SPRITES/WORLDS/W-${worldNumber}/background/background.png`;
  img.onload = () => {
    // Replace procedural tile with the loaded image drawn onto a canvas
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    _bgImageCache.set(worldNumber, c);
  };

  return tile;
}

/** Colour palettes per world for procedural textures. */
const _WORLD_PALETTES: Record<number, { base: string; accent1: string; accent2: string; highlight: string }> = {
  0: { base: '#0d1a0f', accent1: '#142e18', accent2: '#0a150c', highlight: 'rgba(40,80,50,0.12)' },
  1: { base: '#051408', accent1: '#0c2a12', accent2: '#03100a', highlight: 'rgba(30,90,40,0.10)' },
  2: { base: '#080c1a', accent1: '#0e1530', accent2: '#050815', highlight: 'rgba(40,60,120,0.10)' },
};

function _getPalette(worldNumber: number): { base: string; accent1: string; accent2: string; highlight: string } {
  return _WORLD_PALETTES[worldNumber] ?? _WORLD_PALETTES[0];
}

/**
 * Generates a procedural tileable background texture for a given world.
 * Uses a simple pseudo-random noise pattern with the world's colour palette.
 */
function _generateProceduralTile(worldNumber: number): HTMLCanvasElement {
  const size = PROC_TILE_SIZE;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const pal = _getPalette(worldNumber);

  // Fill base colour
  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, size, size);

  // Simple deterministic noise pattern using a basic hash
  const seed = worldNumber * 7919 + 31;
  for (let y = 0; y < size; y += 4) {
    for (let x = 0; x < size; x += 4) {
      const h = _hash(x + y * size + seed);
      const t = (h & 0xff) / 255;

      if (t > 0.85) {
        ctx.fillStyle = pal.accent1;
        ctx.fillRect(x, y, 4, 4);
      } else if (t > 0.7) {
        ctx.fillStyle = pal.accent2;
        ctx.fillRect(x, y, 4, 4);
      }
    }
  }

  // Add subtle larger shapes for visual interest
  for (let i = 0; i < 12; i++) {
    const h = _hash(i * 137 + seed + 999);
    const cx = ((h >>> 0) % size);
    const cy = ((_hash(h) >>> 0) % size);
    const r = 8 + ((h >>> 8) & 0x1f);

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = pal.highlight;
    ctx.fill();
  }

  return c;
}

/** Simple integer hash for deterministic procedural generation. */
function _hash(n: number): number {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = (x >>> 16) ^ x;
  return x;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Renders the tiled background for the current world with parallax scrolling.
 *
 * @param ctx               The 2D canvas context.
 * @param worldNumber       Active world number (0, 1, 2, …).
 * @param viewportWidthPx   Canvas width in pixels.
 * @param viewportHeightPx  Canvas height in pixels.
 * @param cameraOffsetXPx   Full camera X offset (foreground).
 * @param cameraOffsetYPx   Full camera Y offset (foreground).
 */
export function renderWorldBackground(
  ctx: CanvasRenderingContext2D,
  worldNumber: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  cameraOffsetXPx: number,
  cameraOffsetYPx: number,
): void {
  const tile = _getOrCreateBgTile(worldNumber);
  const tw = tile.width;
  const th = tile.height;
  if (tw === 0 || th === 0) return;

  // Parallax offset: moves slower than the foreground
  const pxOff = cameraOffsetXPx * PARALLAX_FACTOR;
  const pyOff = cameraOffsetYPx * PARALLAX_FACTOR;

  // Compute starting tile position so tiles seamlessly cover the viewport
  const startX = -((((-pxOff) % tw) + tw) % tw);
  const startY = -((((-pyOff) % th) + th) % th);

  ctx.save();
  for (let y = startY; y < viewportHeightPx; y += th) {
    for (let x = startX; x < viewportWidthPx; x += tw) {
      ctx.drawImage(tile, x, y);
    }
  }
  ctx.restore();
}
