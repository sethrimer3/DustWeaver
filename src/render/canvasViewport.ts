export interface RenderViewportMetrics {
  readonly cssWidthPx: number;
  readonly cssHeightPx: number;
  readonly renderScale: number;
  readonly backingWidthPx: number;
  readonly backingHeightPx: number;
  readonly logicalWidthPx: number;
  readonly logicalHeightPx: number;
}

export interface VisibleWorldBounds {
  readonly leftWorld: number;
  readonly topWorld: number;
  readonly rightWorld: number;
  readonly bottomWorld: number;
}

/**
 * Derives every viewport dimension from the canvas's CSS box, selected render
 * size, DPR, and logical world-view height. The selected render size controls
 * pixel density while the CSS box controls aspect ratio, preventing a resized
 * or fullscreen canvas from being stretched from stale 16:9 backing dimensions.
 */
export function computeRenderViewportMetrics(
  cssWidthPx: number,
  cssHeightPx: number,
  selectedWidthPx: number,
  selectedHeightPx: number,
  devicePixelRatio: number,
  logicalHeightPx: number,
): RenderViewportMetrics {
  const cssW = Math.max(1, cssWidthPx);
  const cssH = Math.max(1, cssHeightPx);
  const selectedW = Math.max(1, selectedWidthPx);
  const selectedH = Math.max(1, selectedHeightPx);
  const dpr = Math.max(1, devicePixelRatio);
  const logicalH = Math.max(1, Math.round(logicalHeightPx));
  const selectedCssScale = Math.min(selectedW / cssW, selectedH / cssH);
  const renderScale = Math.max(Number.EPSILON, selectedCssScale * dpr);

  return {
    cssWidthPx: cssW,
    cssHeightPx: cssH,
    renderScale,
    backingWidthPx: Math.max(1, Math.round(cssW * renderScale)),
    backingHeightPx: Math.max(1, Math.round(cssH * renderScale)),
    logicalWidthPx: Math.max(1, Math.round((cssW / cssH) * logicalH)),
    logicalHeightPx: logicalH,
  };
}

export function computeVisibleWorldBounds(
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  logicalWidthPx: number,
  logicalHeightPx: number,
): VisibleWorldBounds {
  const safeZoom = Math.max(Number.EPSILON, zoom);
  return {
    leftWorld: offsetXPx === 0 ? 0 : -offsetXPx / safeZoom,
    topWorld: offsetYPx === 0 ? 0 : -offsetYPx / safeZoom,
    rightWorld: (logicalWidthPx - offsetXPx) / safeZoom,
    bottomWorld: (logicalHeightPx - offsetYPx) / safeZoom,
  };
}

export function resizeCanvasBackingStore(
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  widthPx: number,
  heightPx: number,
): boolean {
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

type ResettableCanvasContext = Pick<
  CanvasRenderingContext2D,
  'setTransform' | 'clearRect' | 'globalAlpha' | 'globalCompositeOperation' | 'imageSmoothingEnabled'
> & { reset?: () => void };

/**
 * Establishes an identity-space pass boundary and clears the full backing
 * store. `reset()` also discards a leaked clip when supported by the browser;
 * the explicit assignments keep the contract deterministic on older engines.
 */
export function resetCanvasPass(
  ctx: ResettableCanvasContext,
  backingWidthPx: number,
  backingHeightPx: number,
  imageSmoothingEnabled: boolean,
): void {
  if (typeof ctx.reset === 'function') ctx.reset();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = imageSmoothingEnabled;
  ctx.clearRect(0, 0, backingWidthPx, backingHeightPx);
}
