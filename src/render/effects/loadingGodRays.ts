import { SunrayDustMotes } from './sunrayDustMotes';

export interface LoadingGodRaysViewport {
  readonly width: number;
  readonly height: number;
}

export interface LoadingGodRaysOptions {
  readonly enabled?: boolean;
  readonly rayCount?: number;
  readonly angleRad?: number;
  readonly baseAlpha?: number;
  readonly driftSpeed?: number;
  readonly noiseStrength?: number;
}

interface LoadingRayDef {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly widthStart: number;
  readonly widthEnd: number;
  readonly alpha: number;
  readonly phase: number;
  readonly core: boolean;
}

const EFFECT_ENABLED = true;
const RAY_COUNT = 7;
const RAY_ANGLE_RAD = Math.PI * 0.285;
const BASE_ALPHA = 0.22;
const DRIFT_SPEED = 0.000018;
const NOISE_STRENGTH = 0.07;
// Resolution of the offscreen light buffer, relative to the visible canvas. A lower
// resolution buffer naturally softens the beams before the blur filter even runs.
const LOGICAL_SCALE = 0.42;
const LIGHT_BUFFER_BLUR_PX = 5;
const NOISE_TILE_SIZE = 64;
const FADE_IN_DELAY_MS = 420;
const FADE_IN_DURATION_MS = 2600;
const OVERLAY_RESET_GAP_MS = 900;
// A beam is built from many faint, progressively wider layers rather than one hard-edged
// shape, so the combined result reads as a soft field of light instead of a flat polygon.
const SOFT_LAYER_COUNT = 9;
const SOFT_WIDTH_SCALE_MAX = 3.6;
const SOFT_ALPHA_SCALE = 0.30;
const SOFT_FALLOFF_POWER = 2.3;

const RAYS: readonly LoadingRayDef[] = [
  { x: -0.18, y: -0.08, length: 1.48, widthStart: 0.17, widthEnd: 0.07, alpha: 0.60, phase: 0.1, core: true },
  { x: -0.02, y: -0.16, length: 1.35, widthStart: 0.10, widthEnd: 0.04, alpha: 0.38, phase: 1.7, core: false },
  { x: 0.12, y: -0.12, length: 1.46, widthStart: 0.15, widthEnd: 0.06, alpha: 0.52, phase: 2.6, core: true },
  { x: 0.28, y: -0.10, length: 1.22, widthStart: 0.08, widthEnd: 0.03, alpha: 0.30, phase: 3.4, core: false },
  { x: -0.24, y: 0.10, length: 1.30, widthStart: 0.12, widthEnd: 0.05, alpha: 0.34, phase: 4.8, core: true },
  { x: 0.48, y: -0.18, length: 1.16, widthStart: 0.11, widthEnd: 0.04, alpha: 0.28, phase: 5.9, core: false },
  { x: 0.68, y: -0.06, length: 1.05, widthStart: 0.09, widthEnd: 0.03, alpha: 0.24, phase: 7.1, core: false },
] as const;

let _noiseCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let _noisePattern: CanvasPattern | null = null;
let _isDevEnabled = true;
const _loadingDustMotes = new SunrayDustMotes();
_loadingDustMotes.reset(0x1c0ffee);
let _dustViewportW = 0;
let _dustViewportH = 0;
let _dustAngleRad = RAY_ANGLE_RAD;
let _dustBaseAlpha = BASE_ALPHA;
let _dustDriftSpeed = DRIFT_SPEED;
let _dustRayCount = RAY_COUNT;
let _transitionStartMs = -1;
let _lastRenderTimeMs = -1;

let _lightCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let _lightCtx: CanvasRenderingContext2D | null = null;
let _lightBufferW = 0;
let _lightBufferH = 0;

export function setLoadingGodRaysEnabled(enabled: boolean): boolean {
  _isDevEnabled = Boolean(enabled);
  return _isDevEnabled;
}

export function isLoadingGodRaysEnabled(): boolean {
  return _isDevEnabled;
}

export function renderLoadingGodRays(
  ctx: CanvasRenderingContext2D,
  viewport: LoadingGodRaysViewport,
  timeMs: number,
  options: LoadingGodRaysOptions = {},
): void {
  const isEnabled = options.enabled ?? EFFECT_ENABLED;
  if (!isEnabled || !_isDevEnabled || viewport.width <= 0 || viewport.height <= 0) return;

  try {
    const width = Math.max(1, Math.floor(viewport.width * LOGICAL_SCALE));
    const height = Math.max(1, Math.floor(viewport.height * LOGICAL_SCALE));
    const lightCtx = getLightBufferCtx(width, height);
    if (lightCtx === null) return;

    const rayCount = Math.max(0, Math.min(RAYS.length, options.rayCount ?? RAY_COUNT));
    const angleRad = options.angleRad ?? RAY_ANGLE_RAD;
    const baseAlpha = options.baseAlpha ?? BASE_ALPHA;
    const driftSpeed = options.driftSpeed ?? DRIFT_SPEED;
    const noiseStrength = options.noiseStrength ?? NOISE_STRENGTH;
    if (_transitionStartMs < 0 || (_lastRenderTimeMs >= 0 && timeMs - _lastRenderTimeMs > OVERLAY_RESET_GAP_MS)) {
      _transitionStartMs = timeMs;
    }
    _lastRenderTimeMs = timeMs;
    const fadeInT = smoothstep((timeMs - _transitionStartMs - FADE_IN_DELAY_MS) / FADE_IN_DURATION_MS);
    const alphaScale = 0.18 + fadeInT * 0.82;

    // Draw every beam as a soft field of light into the low-res buffer, never onto the
    // main canvas directly.
    lightCtx.clearRect(0, 0, width, height);
    lightCtx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rayCount; i++) {
      drawSoftRay(lightCtx, RAYS[i], width, height, angleRad, baseAlpha * alphaScale, driftSpeed, timeMs);
    }
    _loadingDustMotes.render(lightCtx, width, height, timeMs, loadingDustIntensityAt, 'loading');

    // Blur the combined buffer once and screen-composite it back onto the scene — this is
    // what turns the layered shapes into something that reads as light rather than geometry.
    ctx.save();
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'screen';
    ctx.filter = `blur(${LIGHT_BUFFER_BLUR_PX}px)`;
    ctx.drawImage(_lightCanvas as CanvasImageSource, 0, 0, viewport.width, viewport.height);
    ctx.filter = 'none';
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    drawNoise(ctx, viewport.width, viewport.height, timeMs, noiseStrength);
    ctx.restore();

    _dustViewportW = width;
    _dustViewportH = height;
    _dustAngleRad = angleRad;
    _dustBaseAlpha = baseAlpha;
    _dustDriftSpeed = driftSpeed;
    _dustRayCount = rayCount;
  } catch {
    try {
      ctx.filter = 'none';
      ctx.restore();
    } catch {
      // Loading should never fail because the optional effect did.
    }
  }
}

function getLightBufferCtx(width: number, height: number): CanvasRenderingContext2D | null {
  if (_lightCanvas === null || _lightBufferW !== width || _lightBufferH !== height) {
    _lightCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : typeof document !== 'undefined'
        ? document.createElement('canvas')
        : null;
    if (_lightCanvas === null) {
      _lightCtx = null;
      return null;
    }
    _lightCanvas.width = width;
    _lightCanvas.height = height;
    _lightCtx = _lightCanvas.getContext('2d') as CanvasRenderingContext2D | null;
    _lightBufferW = width;
    _lightBufferH = height;
  }
  return _lightCtx;
}

function smoothstep(value: number): number {
  const t = value <= 0 ? 0 : value >= 1 ? 1 : value;
  return t * t * (3 - 2 * t);
}

function loadingDustIntensityAt(xPx: number, yPx: number, timeMs: number): number {
  return estimateLoadingGodRayIntensityAt(
    xPx,
    yPx,
    _dustViewportW,
    _dustViewportH,
    _dustAngleRad,
    _dustBaseAlpha,
    _dustDriftSpeed,
    timeMs,
    _dustRayCount,
  );
}

function computeRayOrigin(
  ray: LoadingRayDef,
  viewportW: number,
  viewportH: number,
  perpY: number,
  driftSpeed: number,
  timeMs: number,
): { startX: number; startY: number } {
  const drift = Math.sin(timeMs * driftSpeed + ray.phase) * viewportW * 0.018;
  const topMargin = ray.widthStart * viewportW * Math.abs(perpY) + viewportW * 0.05;
  const startX = Math.round(ray.x * viewportW + drift);
  const startY = Math.round(
    ray.y * viewportH - topMargin + Math.cos(timeMs * driftSpeed * 0.7 + ray.phase) * viewportH * 0.01,
  );
  return { startX, startY };
}

function estimateLoadingGodRayIntensityAt(
  xPx: number,
  yPx: number,
  viewportW: number,
  viewportH: number,
  angleRad: number,
  baseAlpha: number,
  driftSpeed: number,
  timeMs: number,
  rayCount: number,
): number {
  const diagonal = Math.hypot(viewportW, viewportH);
  const directionX = Math.cos(angleRad);
  const directionY = Math.sin(angleRad);
  const perpX = -directionY;
  const perpY = directionX;
  let intensity = 0;

  for (let i = 0; i < rayCount; i++) {
    const ray = RAYS[i];
    const { startX, startY } = computeRayOrigin(ray, viewportW, viewportH, perpY, driftSpeed, timeMs);
    const length = Math.round(ray.length * diagonal);
    const endX = Math.round(startX + directionX * length);
    const endY = Math.round(startY + directionY * length);
    const lenX = endX - startX;
    const lenY = endY - startY;
    const lenSq = lenX * lenX + lenY * lenY;
    if (lenSq <= 0.001) continue;

    const along = ((xPx - startX) * lenX + (yPx - startY) * lenY) / lenSq;
    if (along < 0 || along > 1) continue;

    const centerX = startX + lenX * along;
    const centerY = startY + lenY * along;
    const widthStart = ray.widthStart * viewportW;
    const widthEnd = ray.widthEnd * viewportW;
    const halfWidth = widthStart + (widthEnd - widthStart) * along;
    if (halfWidth <= 0.001) continue;

    const lateral = Math.abs((xPx - centerX) * perpX + (yPx - centerY) * perpY) / halfWidth;
    if (lateral >= 1) continue;

    const shimmer = 0.92 + 0.08 * Math.sin(timeMs * 0.00042 + ray.phase);
    const crossFade = Math.pow(1 - lateral, 1.65);
    const lengthFade = Math.pow(1 - along, 0.72);
    intensity = Math.max(intensity, baseAlpha * ray.alpha * shimmer * crossFade * lengthFade * 3.4);
  }

  return intensity <= 0 ? 0 : intensity >= 1 ? 1 : intensity;
}

function drawSoftRay(
  ctx: CanvasRenderingContext2D,
  ray: LoadingRayDef,
  viewportW: number,
  viewportH: number,
  angleRad: number,
  baseAlpha: number,
  driftSpeed: number,
  timeMs: number,
): void {
  if (baseAlpha <= 0.001) return;
  const diagonal = Math.hypot(viewportW, viewportH);
  const directionX = Math.cos(angleRad);
  const directionY = Math.sin(angleRad);
  const perpX = -directionY;
  const perpY = directionX;
  const shimmer = 0.88 + 0.12 * Math.sin(timeMs * 0.00034 + ray.phase);
  const { startX, startY } = computeRayOrigin(ray, viewportW, viewportH, perpY, driftSpeed, timeMs);
  const length = Math.round(ray.length * diagonal);
  const endX = Math.round(startX + directionX * length);
  const endY = Math.round(startY + directionY * length);
  const w0 = ray.widthStart * viewportW;
  const w1 = ray.widthEnd * viewportW;
  const alpha = baseAlpha * ray.alpha * shimmer;
  const coreBoost = ray.core ? 1.25 : 1;

  for (let layer = SOFT_LAYER_COUNT - 1; layer >= 0; layer--) {
    const t = layer / Math.max(1, SOFT_LAYER_COUNT - 1);
    const widthScale = 1 + t * (SOFT_WIDTH_SCALE_MAX - 1);
    const falloff = Math.pow(1 - t, SOFT_FALLOFF_POWER);
    const layerAlpha = alpha * SOFT_ALPHA_SCALE * falloff * coreBoost;
    if (layerAlpha <= 0.0008) continue;
    fillBeamQuad(
      ctx,
      startX,
      startY,
      endX,
      endY,
      perpX,
      perpY,
      Math.max(2, w0 * widthScale),
      Math.max(1, w1 * (0.7 + widthScale * 0.55)),
      layerAlpha,
    );
  }
}

function fillBeamQuad(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  perpX: number,
  perpY: number,
  widthStart: number,
  widthEnd: number,
  alpha: number,
): void {
  const sx0 = startX + perpX * widthStart;
  const sy0 = startY + perpY * widthStart;
  const sx1 = startX - perpX * widthStart;
  const sy1 = startY - perpY * widthStart;
  const ex0 = endX + perpX * widthEnd;
  const ey0 = endY + perpY * widthEnd;
  const ex1 = endX - perpX * widthEnd;
  const ey1 = endY - perpY * widthEnd;

  const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
  gradient.addColorStop(0, `rgba(242,212,142,${alpha.toFixed(3)})`);
  gradient.addColorStop(0.58, `rgba(221,173,91,${(alpha * 0.46).toFixed(3)})`);
  gradient.addColorStop(1, 'rgba(160,110,48,0)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  ctx.lineTo(sx1, sy1);
  ctx.lineTo(ex1, ey1);
  ctx.lineTo(ex0, ey0);
  ctx.closePath();
  ctx.fill();
}

function drawNoise(
  ctx: CanvasRenderingContext2D,
  viewportW: number,
  viewportH: number,
  timeMs: number,
  noiseStrength: number,
): void {
  const pattern = getNoisePattern(ctx);
  if (pattern === null || noiseStrength <= 0) return;
  const offset = Math.floor(timeMs * 0.006) % NOISE_TILE_SIZE;
  const prevAlpha = ctx.globalAlpha;
  const prevComposite = ctx.globalCompositeOperation;
  ctx.globalAlpha = noiseStrength;
  ctx.globalCompositeOperation = 'overlay';
  ctx.save();
  ctx.translate(-offset, offset);
  ctx.fillStyle = pattern;
  ctx.fillRect(0, -NOISE_TILE_SIZE, viewportW + NOISE_TILE_SIZE * 2, viewportH + NOISE_TILE_SIZE * 2);
  ctx.restore();
  ctx.globalCompositeOperation = prevComposite;
  ctx.globalAlpha = prevAlpha;
}

function getNoisePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (_noisePattern !== null) return _noisePattern;
  _noiseCanvas = createNoiseCanvas();
  if (_noiseCanvas === null) return null;
  _noisePattern = ctx.createPattern(_noiseCanvas, 'repeat');
  return _noisePattern;
}

function createNoiseCanvas(): HTMLCanvasElement | OffscreenCanvas | null {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(NOISE_TILE_SIZE, NOISE_TILE_SIZE)
    : typeof document !== 'undefined'
      ? document.createElement('canvas')
      : null;
  if (canvas === null) return null;
  canvas.width = NOISE_TILE_SIZE;
  canvas.height = NOISE_TILE_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return null;
  const imageData = ctx.createImageData(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  for (let y = 0; y < NOISE_TILE_SIZE; y++) {
    for (let x = 0; x < NOISE_TILE_SIZE; x++) {
      const i = (y * NOISE_TILE_SIZE + x) * 4;
      const isBright = ((x * 17 + y * 31 + ((x ^ y) * 7)) & 15) < 6;
      imageData.data[i] = isBright ? 255 : 92;
      imageData.data[i + 1] = isBright ? 224 : 76;
      imageData.data[i + 2] = isBright ? 150 : 48;
      imageData.data[i + 3] = isBright ? 36 : 20;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as Window & {
    __dwSetLoadingGodRaysEnabled?: (enabled: boolean) => boolean;
    __dwLoadingGodRaysEnabled?: () => boolean;
  };
  w.__dwSetLoadingGodRaysEnabled = setLoadingGodRaysEnabled;
  w.__dwLoadingGodRaysEnabled = isLoadingGodRaysEnabled;
}
