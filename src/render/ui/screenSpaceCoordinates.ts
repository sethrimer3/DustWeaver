export interface CssRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface NativeToOverlayPointParams {
  readonly nativeX: number;
  readonly nativeY: number;
  readonly nativeWidth: number;
  readonly nativeHeight: number;
  readonly canvasCssRect: CssRectLike;
  readonly overlayCssRect: CssRectLike;
}

export interface OverlayCssPoint {
  readonly xCss: number;
  readonly yCss: number;
}

export function nativeGamePointToOverlayCssPoint(params: NativeToOverlayPointParams): OverlayCssPoint {
  const nativeWidth = Math.max(1, params.nativeWidth);
  const nativeHeight = Math.max(1, params.nativeHeight);
  const scaleX = params.canvasCssRect.width / nativeWidth;
  const scaleY = params.canvasCssRect.height / nativeHeight;

  return {
    xCss: params.canvasCssRect.left - params.overlayCssRect.left + params.nativeX * scaleX,
    yCss: params.canvasCssRect.top - params.overlayCssRect.top + params.nativeY * scaleY,
  };
}

export function snapCssPixelToDevicePixel(cssPx: number, devicePixelRatio: number): number {
  const dpr = Math.max(1, devicePixelRatio);
  return Math.round(cssPx * dpr) / dpr;
}
