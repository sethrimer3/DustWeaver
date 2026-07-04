/**
 * sunrays.ts — shared procedural god-ray / sunray renderer.
 *
 * Generates a deterministic field of ray shafts entering from the top of the
 * viewport at a configurable angle, and draws them in one of two styles:
 *
 *   - 'hard': crisp pixel-art quads drawn directly on the target context with
 *     'screen' composite blending. No blur.
 *   - 'soft': many nested low-alpha beam layers drawn into a reusable
 *     offscreen light buffer, blurred once, then screen-composited back onto
 *     the target context.
 *
 * This module has no dependency on room/game state — callers pass a viewport
 * size, a config, and a time value. It is used both by the room renderer
 * (SunraysRenderer, driven by RoomSunraysDef) and can be reused for other
 * presets (e.g. loading screen) without duplicating the beam math.
 */

export type SunraysStyle = 'hard' | 'soft';

export interface SunraysConfig {
  readonly style: SunraysStyle;
  /** Ray travel direction in degrees; 90 = straight down. */
  readonly angleDeg: number;
  /** Overall brightness multiplier, 0–1. */
  readonly intensity: number;
  /** Number of ray shafts. */
  readonly rayCount: number;
  /** Subtle sway/alpha pulse animation. */
  readonly animationEnabled: boolean;
  /** Deterministic seed (e.g. derived from room id) so rays don't pop between loads. */
  readonly seed: number;
}

export const DEFAULT_SUNRAYS_CONFIG: SunraysConfig = {
  style: 'soft',
  angleDeg: 100,
  intensity: 0.5,
  rayCount: 6,
  animationEnabled: true,
  seed: 1,
};

export interface SunrayDescriptor {
  /** 0..1 position across the top edge. */
  readonly sourceT: number;
  /** Ray length as a fraction of the viewport diagonal. */
  readonly length: number;
  /** Ray base half-width as a fraction of viewport width. */
  readonly width: number;
  /** Per-ray alpha multiplier, 0..1. */
  readonly alpha: number;
  readonly seed: number;
  readonly phase: number;
}

/** Small deterministic PRNG (mulberry32) so rays are stable across frames/reloads. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a stable, deterministic ray field for the given config. */
export function generateSunrayDescriptors(config: SunraysConfig): SunrayDescriptor[] {
  const count = Math.max(0, Math.min(24, Math.round(config.rayCount)));
  const rand = mulberry32(config.seed || 1);
  const rays: SunrayDescriptor[] = [];
  for (let i = 0; i < count; i++) {
    // Spread sources across the top edge with jitter so they don't look grid-aligned.
    const base = (i + 0.5) / count;
    const jitter = (rand() - 0.5) * (1 / count) * 0.8;
    rays.push({
      sourceT: Math.min(1, Math.max(0, base + jitter)),
      length: 1.15 + rand() * 0.55,
      width: 0.045 + rand() * 0.09,
      alpha: 0.55 + rand() * 0.45,
      seed: Math.floor(rand() * 1e6),
      phase: rand() * Math.PI * 2,
    });
  }
  return rays;
}

interface RayGeometry {
  readonly sx0: number; readonly sy0: number;
  readonly sx1: number; readonly sy1: number;
  readonly ex0: number; readonly ey0: number;
  readonly ex1: number; readonly ey1: number;
  readonly startX: number; readonly startY: number;
  readonly endX: number; readonly endY: number;
}

function computeRayGeometry(
  ray: SunrayDescriptor,
  viewportW: number,
  viewportH: number,
  angleRad: number,
  widthScale: number,
  timeMs: number,
  animationEnabled: boolean,
): RayGeometry {
  const dirX = Math.sin(angleRad);
  const dirY = Math.cos(angleRad);
  const perpX = dirY;
  const perpY = -dirX;
  const diagonal = Math.hypot(viewportW, viewportH);

  const sway = animationEnabled
    ? Math.sin(timeMs * 0.00016 + ray.phase) * viewportW * 0.012
    : 0;

  const startX = Math.round(ray.sourceT * viewportW + sway);
  const startY = 0;
  const length = ray.length * diagonal;
  const endX = Math.round(startX + dirX * length);
  const endY = Math.round(startY + dirY * length);

  const w0 = ray.width * viewportW * widthScale;
  const w1 = w0 * 0.35;

  return {
    sx0: startX + perpX * w0, sy0: startY + perpY * w0,
    sx1: startX - perpX * w0, sy1: startY - perpY * w0,
    ex0: endX + perpX * w1,   ey0: endY + perpY * w1,
    ex1: endX - perpX * w1,   ey1: endY - perpY * w1,
    startX, startY, endX, endY,
  };
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/**
 * Cheap normalized ray brightness estimate for a viewport-space point.
 * Returns 0 outside all ray quads and approaches 1 in the brightest ray cores.
 */
export function estimateSunrayIntensityAt(
  xPx: number,
  yPx: number,
  viewportW: number,
  viewportH: number,
  config: SunraysConfig,
  timeMs: number,
  rays: readonly SunrayDescriptor[],
): number {
  if (viewportW <= 0 || viewportH <= 0 || rays.length === 0 || config.intensity <= 0) return 0;
  const angleRad = (config.angleDeg * Math.PI) / 180;
  const dirX = Math.sin(angleRad);
  const dirY = Math.cos(angleRad);
  const perpX = dirY;
  const perpY = -dirX;
  let intensity = 0;

  for (const ray of rays) {
    const g = computeRayGeometry(ray, viewportW, viewportH, angleRad, 1.0, timeMs, config.animationEnabled);
    const lenX = g.endX - g.startX;
    const lenY = g.endY - g.startY;
    const lenSq = lenX * lenX + lenY * lenY;
    if (lenSq <= 0.001) continue;

    const relX = xPx - g.startX;
    const relY = yPx - g.startY;
    const along = (relX * lenX + relY * lenY) / lenSq;
    if (along < 0 || along > 1) continue;

    const centerX = g.startX + lenX * along;
    const centerY = g.startY + lenY * along;
    const halfWidthStart = ray.width * viewportW;
    const halfWidthEnd = halfWidthStart * 0.35;
    const halfWidth = halfWidthStart + (halfWidthEnd - halfWidthStart) * along;
    if (halfWidth <= 0.001) continue;

    const lateral = Math.abs((xPx - centerX) * perpX + (yPx - centerY) * perpY) / halfWidth;
    if (lateral >= 1) continue;

    const crossFade = Math.pow(1 - lateral, 1.7);
    const lengthFade = Math.pow(1 - along, 0.7);
    const pulse = config.animationEnabled ? 0.9 + 0.1 * Math.sin(timeMs * 0.0005 + ray.phase) : 1;
    intensity = Math.max(intensity, config.intensity * ray.alpha * pulse * crossFade * lengthFade);
  }

  return clamp01(intensity);
}

// ── Hard mode ─────────────────────────────────────────────────────────────

/**
 * Draw crisp pixel-art god-ray shafts directly on `ctx`. No blur; low alpha;
 * 'screen' composite blending. Caller is responsible for clipping.
 */
export function renderHardSunrays(
  ctx: CanvasRenderingContext2D,
  viewportW: number,
  viewportH: number,
  config: SunraysConfig,
  timeMs: number,
  rays: readonly SunrayDescriptor[],
): void {
  if (viewportW <= 0 || viewportH <= 0 || rays.length === 0) return;
  const angleRad = (config.angleDeg * Math.PI) / 180;

  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'screen';

  for (const ray of rays) {
    const g = computeRayGeometry(ray, viewportW, viewportH, angleRad, 1.0, timeMs, config.animationEnabled);
    const pulse = config.animationEnabled ? 0.9 + 0.1 * Math.sin(timeMs * 0.0005 + ray.phase) : 1;
    const alpha = Math.max(0, Math.min(1, config.intensity * ray.alpha * pulse * 0.5));
    if (alpha <= 0.002) continue;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,238,196,1)';
    ctx.beginPath();
    ctx.moveTo(Math.round(g.sx0), Math.round(g.sy0));
    ctx.lineTo(Math.round(g.sx1), Math.round(g.sy1));
    ctx.lineTo(Math.round(g.ex1), Math.round(g.ey1));
    ctx.lineTo(Math.round(g.ex0), Math.round(g.ey0));
    ctx.closePath();
    ctx.fill();
  }

  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevComposite;
}

// ── Soft mode ─────────────────────────────────────────────────────────────

const SOFT_LAYER_COUNT = 10;
const SOFT_BASE_ALPHA = 0.045;
const SOFT_WIDTH_SCALE_MAX = 3.0;
const SOFT_FALLOFF_POWER = 2.4;
const SOFT_BLUR_PX = 14;
const SOFT_COMPOSITE_ALPHA = 0.65;
const SOFT_BUFFER_SCALE = 0.5;

export interface SunraysLightBuffer {
  canvas: HTMLCanvasElement | OffscreenCanvas | null;
  ctx: CanvasRenderingContext2D | null;
  width: number;
  height: number;
  supportsFilter: boolean;
}

export function createSunraysLightBuffer(): SunraysLightBuffer {
  return { canvas: null, ctx: null, width: 0, height: 0, supportsFilter: true };
}

function ensureBuffer(buf: SunraysLightBuffer, width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  if (buf.canvas !== null && buf.width === width && buf.height === height) return buf.ctx !== null;

  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;
  if (canvas === null) return false;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx === null) return false;

  buf.canvas = canvas;
  buf.ctx = ctx;
  buf.width = width;
  buf.height = height;
  buf.supportsFilter = 'filter' in ctx;
  return true;
}

/**
 * Render soft, layered, blurred sunrays and screen-composite them onto `ctx`.
 * Draws into an internal offscreen buffer reused across calls (resized only
 * when viewport dimensions change), blurs once, then composites.
 *
 * `reducedQuality` cuts layer count and skips blur (still layered) for
 * low-graphics / adaptive-reduction modes.
 */
export function renderSoftSunrays(
  ctx: CanvasRenderingContext2D,
  buffer: SunraysLightBuffer,
  viewportW: number,
  viewportH: number,
  config: SunraysConfig,
  timeMs: number,
  rays: readonly SunrayDescriptor[],
  reducedQuality = false,
): void {
  if (viewportW <= 0 || viewportH <= 0 || rays.length === 0) return;

  const bufScale = reducedQuality ? SOFT_BUFFER_SCALE * 0.6 : SOFT_BUFFER_SCALE;
  const bufW = Math.max(1, Math.round(viewportW * bufScale));
  const bufH = Math.max(1, Math.round(viewportH * bufScale));
  if (!ensureBuffer(buffer, bufW, bufH)) return;
  const bctx = buffer.ctx;
  if (bctx === null) return;

  const angleRad = (config.angleDeg * Math.PI) / 180;
  const layerCount = reducedQuality ? Math.max(3, Math.round(SOFT_LAYER_COUNT * 0.4)) : SOFT_LAYER_COUNT;

  bctx.save();
  bctx.clearRect(0, 0, bufW, bufH);
  bctx.globalCompositeOperation = 'lighter';

  for (const ray of rays) {
    const pulse = config.animationEnabled ? 0.88 + 0.12 * Math.sin(timeMs * 0.00035 + ray.phase) : 1;
    for (let layer = 0; layer < layerCount; layer++) {
      const t = layer / Math.max(1, layerCount - 1);
      const widthScale = 1 + t * (SOFT_WIDTH_SCALE_MAX - 1);
      const falloff = Math.pow(1 - t, SOFT_FALLOFF_POWER);
      const alpha = SOFT_BASE_ALPHA * config.intensity * ray.alpha * pulse * falloff;
      if (alpha <= 0.0008) continue;

      const g = computeRayGeometry(ray, bufW, bufH, angleRad, widthScale, timeMs, config.animationEnabled);

      const gradient = bctx.createLinearGradient(g.startX, g.startY, g.endX, g.endY);
      gradient.addColorStop(0, `rgba(255,240,205,${alpha.toFixed(4)})`);
      gradient.addColorStop(0.55, `rgba(232,206,150,${(alpha * 0.55).toFixed(4)})`);
      gradient.addColorStop(1, 'rgba(200,170,110,0)');

      bctx.fillStyle = gradient;
      bctx.beginPath();
      bctx.moveTo(g.sx0, g.sy0);
      bctx.lineTo(g.sx1, g.sy1);
      bctx.lineTo(g.ex1, g.ey1);
      bctx.lineTo(g.ex0, g.ey0);
      bctx.closePath();
      bctx.fill();
    }
  }
  bctx.restore();

  // Blur the combined buffer once (not per-ray/layer).
  const blurPx = reducedQuality ? SOFT_BLUR_PX * 0.5 * bufScale : SOFT_BLUR_PX * bufScale;
  if (buffer.supportsFilter && blurPx > 0.3) {
    try {
      bctx.save();
      bctx.filter = `blur(${blurPx.toFixed(1)}px)`;
      bctx.globalCompositeOperation = 'source-over';
      bctx.drawImage(buffer.canvas as CanvasImageSource, 0, 0);
      bctx.restore();
    } catch {
      // Filter unsupported at runtime despite feature check — fall back silently
      // to the unblurred layered result, which is still a reasonable approximation.
    }
  }

  // Composite the blurred buffer back onto the main scene with 'screen'.
  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = SOFT_COMPOSITE_ALPHA;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer.canvas as CanvasImageSource, 0, 0, bufW, bufH, 0, 0, viewportW, viewportH);
  ctx.imageSmoothingEnabled = prevSmoothing;
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevComposite;
}
