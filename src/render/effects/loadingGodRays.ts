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
const LOGICAL_SCALE = 0.5;
const NOISE_TILE_SIZE = 64;

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
    const rayCount = Math.max(0, Math.min(RAYS.length, options.rayCount ?? RAY_COUNT));
    const angleRad = options.angleRad ?? RAY_ANGLE_RAD;
    const baseAlpha = options.baseAlpha ?? BASE_ALPHA;
    const driftSpeed = options.driftSpeed ?? DRIFT_SPEED;
    const noiseStrength = options.noiseStrength ?? NOISE_STRENGTH;

    ctx.save();
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.imageSmoothingEnabled = false;
    ctx.scale(viewport.width / width, viewport.height / height);
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < rayCount; i++) {
      drawRay(ctx, RAYS[i], width, height, angleRad, baseAlpha, driftSpeed, timeMs);
    }

    drawNoise(ctx, width, height, timeMs, noiseStrength);
    ctx.restore();
  } catch {
    try {
      ctx.restore();
    } catch {
      // Loading should never fail because the optional effect did.
    }
  }
}

function drawRay(
  ctx: CanvasRenderingContext2D,
  ray: LoadingRayDef,
  viewportW: number,
  viewportH: number,
  angleRad: number,
  baseAlpha: number,
  driftSpeed: number,
  timeMs: number,
): void {
  const diagonal = Math.hypot(viewportW, viewportH);
  const directionX = Math.cos(angleRad);
  const directionY = Math.sin(angleRad);
  const perpX = -directionY;
  const perpY = directionX;
  const shimmer = 0.92 + 0.08 * Math.sin(timeMs * 0.00042 + ray.phase);
  const drift = Math.sin(timeMs * driftSpeed + ray.phase) * viewportW * 0.018;
  const startX = Math.round(ray.x * viewportW + drift);
  const startY = Math.round(ray.y * viewportH + Math.cos(timeMs * driftSpeed * 0.7 + ray.phase) * viewportH * 0.01);
  const length = Math.round(ray.length * diagonal);
  const endX = Math.round(startX + directionX * length);
  const endY = Math.round(startY + directionY * length);
  const w0 = Math.round(ray.widthStart * viewportW);
  const w1 = Math.round(ray.widthEnd * viewportW);
  const alpha = baseAlpha * ray.alpha * shimmer;

  fillBeamQuad(ctx, startX, startY, endX, endY, perpX, perpY, w0, w1, alpha);

  if (ray.core) {
    fillBeamQuad(ctx, startX, startY, endX, endY, perpX, perpY, Math.max(2, w0 * 0.22), Math.max(1, w1 * 0.18), alpha * 0.36);
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
  const sx0 = Math.round(startX + perpX * widthStart);
  const sy0 = Math.round(startY + perpY * widthStart);
  const sx1 = Math.round(startX - perpX * widthStart);
  const sy1 = Math.round(startY - perpY * widthStart);
  const ex0 = Math.round(endX + perpX * widthEnd);
  const ey0 = Math.round(endY + perpY * widthEnd);
  const ex1 = Math.round(endX - perpX * widthEnd);
  const ey1 = Math.round(endY - perpY * widthEnd);

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
