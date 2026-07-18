import { getPixelSpeedometerEnabled } from '../../ui/renderSettings';
import type { WorldState } from '../../sim/world';
import {
  nativeGamePointToOverlayCssPoint,
  snapCssPixelToDevicePixel,
  type OverlayCssPoint,
} from './screenSpaceCoordinates';

const SPEEDOMETER_CSS = `
  position: absolute;
  display: none;
  left: 0;
  top: 0;
  z-index: 420;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 16px;
  font-weight: 700;
  color: #fff;
  text-align: center;
  white-space: nowrap;
  text-shadow:
    -1px -1px 0 rgba(0, 0, 0, 0.88),
     1px -1px 0 rgba(0, 0, 0, 0.88),
    -1px  1px 0 rgba(0, 0, 0, 0.88),
     1px  1px 0 rgba(0, 0, 0, 0.88),
     0 0 5px rgba(0, 0, 0, 0.76);
`;

export const PLAYER_SPEEDOMETER_GAP_CSS_PX = 8;
export const PLAYER_SPEEDOMETER_ZERO_THRESHOLD_PX_S = 0.5;

export interface DisplayVelocityComponents {
  readonly x: number;
  readonly y: number;
}

export function getDisplayVelocityComponents(
  velocityXWorld: number,
  velocityYWorld: number,
): DisplayVelocityComponents {
  return {
    x: velocityXWorld,
    y: -velocityYWorld,
  };
}

export function normalizeDisplayVelocity(valuePxPerSec: number): number {
  return Math.abs(valuePxPerSec) < PLAYER_SPEEDOMETER_ZERO_THRESHOLD_PX_S ? 0 : valuePxPerSec;
}

export function formatDisplayVelocity(valuePxPerSec: number): string {
  const rounded = Math.round(normalizeDisplayVelocity(valuePxPerSec));
  return `${Object.is(rounded, -0) ? 0 : rounded} px/s`;
}

export function shouldShowPlayerSpeedometer(
  enabled: boolean,
  isDebugMode: boolean,
  hasLivingPlayer: boolean,
): boolean {
  return enabled && isDebugMode && hasLivingPlayer;
}

export interface PlayerSpeedometerNativeAnchors {
  readonly horizontal: { readonly x: number; readonly y: number };
  readonly vertical: { readonly x: number; readonly y: number };
}

export function calculatePlayerSpeedometerNativeAnchors(params: {
  readonly playerRenderXWorld: number;
  readonly playerRenderYWorld: number;
  readonly halfWidthWorld: number;
  readonly halfHeightWorld: number;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly zoom: number;
}): PlayerSpeedometerNativeAnchors {
  const centerX = Math.round(params.playerRenderXWorld * params.zoom + params.offsetXPx);
  const centerY = Math.round(params.playerRenderYWorld * params.zoom + params.offsetYPx);
  return {
    horizontal: { x: centerX, y: centerY + params.halfHeightWorld * params.zoom },
    vertical: { x: centerX - params.halfWidthWorld * params.zoom, y: centerY },
  };
}

export function calculatePlayerSpeedometerCssPositions(params: {
  readonly horizontalAnchor: OverlayCssPoint;
  readonly verticalAnchor: OverlayCssPoint;
  readonly horizontalWidth: number;
  readonly horizontalHeight: number;
  readonly verticalWidth: number;
  readonly verticalHeight: number;
  readonly devicePixelRatio: number;
  readonly gapCssPx?: number;
}): { readonly horizontal: OverlayCssPoint; readonly vertical: OverlayCssPoint } {
  const gap = params.gapCssPx ?? PLAYER_SPEEDOMETER_GAP_CSS_PX;
  return {
    horizontal: {
      xCss: snapCssPixelToDevicePixel(params.horizontalAnchor.xCss - params.horizontalWidth * 0.5, params.devicePixelRatio),
      yCss: snapCssPixelToDevicePixel(params.horizontalAnchor.yCss + gap, params.devicePixelRatio),
    },
    vertical: {
      xCss: snapCssPixelToDevicePixel(params.verticalAnchor.xCss - params.verticalWidth - gap, params.devicePixelRatio),
      yCss: snapCssPixelToDevicePixel(params.verticalAnchor.yCss - params.verticalHeight * 0.5, params.devicePixelRatio),
    },
  };
}

export interface PlayerSpeedometerOverlayUpdate {
  readonly world: WorldState;
  readonly isDebugMode: boolean;
  /** Interpolated render position used by the player sprite this frame. */
  readonly playerRenderXWorld: number;
  readonly playerRenderYWorld: number;
  readonly canvas: HTMLCanvasElement;
  readonly nativeWidthPx: number;
  readonly nativeHeightPx: number;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly zoom: number;
}

export class PlayerSpeedometerOverlayRenderer {
  private readonly _root: HTMLElement;
  private readonly _horizontalEl: HTMLDivElement;
  private readonly _verticalEl: HTMLDivElement;
  private _lastHorizontalText = '';
  private _lastVerticalText = '';

  constructor(uiRoot: HTMLElement) {
    this._root = uiRoot;
    this._horizontalEl = document.createElement('div');
    this._horizontalEl.style.cssText = SPEEDOMETER_CSS;
    uiRoot.appendChild(this._horizontalEl);
    this._verticalEl = document.createElement('div');
    this._verticalEl.style.cssText = SPEEDOMETER_CSS;
    uiRoot.appendChild(this._verticalEl);
  }

  update(params: PlayerSpeedometerOverlayUpdate): void {
    const player = params.world.clusters[0];
    if (!shouldShowPlayerSpeedometer(
      getPixelSpeedometerEnabled(),
      params.isDebugMode,
      player !== undefined && player.isAliveFlag === 1,
    ) || player === undefined) {
      this.hide();
      return;
    }

    const displayVelocity = getDisplayVelocityComponents(player.velocityXWorld, player.velocityYWorld);
    const horizontalText = formatDisplayVelocity(displayVelocity.x);
    const verticalText = formatDisplayVelocity(displayVelocity.y);
    if (horizontalText !== this._lastHorizontalText) {
      this._horizontalEl.textContent = horizontalText;
      this._lastHorizontalText = horizontalText;
    }
    if (verticalText !== this._lastVerticalText) {
      this._verticalEl.textContent = verticalText;
      this._lastVerticalText = verticalText;
    }

    const anchors = calculatePlayerSpeedometerNativeAnchors({
      playerRenderXWorld: params.playerRenderXWorld,
      playerRenderYWorld: params.playerRenderYWorld,
      halfWidthWorld: player.halfWidthWorld,
      halfHeightWorld: player.halfHeightWorld,
      offsetXPx: params.offsetXPx,
      offsetYPx: params.offsetYPx,
      zoom: params.zoom,
    });
    const canvasRect = params.canvas.getBoundingClientRect();
    const rootRect = this._root.getBoundingClientRect();
    const toOverlayPoint = (anchor: { readonly x: number; readonly y: number }): OverlayCssPoint =>
      nativeGamePointToOverlayCssPoint({
        nativeX: anchor.x,
        nativeY: anchor.y,
        nativeWidth: params.nativeWidthPx,
        nativeHeight: params.nativeHeightPx,
        canvasCssRect: canvasRect,
        overlayCssRect: rootRect,
      });

    this._horizontalEl.style.display = 'block';
    this._verticalEl.style.display = 'block';
    const positions = calculatePlayerSpeedometerCssPositions({
      horizontalAnchor: toOverlayPoint(anchors.horizontal),
      verticalAnchor: toOverlayPoint(anchors.vertical),
      horizontalWidth: this._horizontalEl.offsetWidth,
      horizontalHeight: this._horizontalEl.offsetHeight,
      verticalWidth: this._verticalEl.offsetWidth,
      verticalHeight: this._verticalEl.offsetHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    this._horizontalEl.style.left = `${positions.horizontal.xCss}px`;
    this._horizontalEl.style.top = `${positions.horizontal.yCss}px`;
    this._verticalEl.style.left = `${positions.vertical.xCss}px`;
    this._verticalEl.style.top = `${positions.vertical.yCss}px`;
  }

  hide(): void {
    this._horizontalEl.style.display = 'none';
    this._verticalEl.style.display = 'none';
  }

  destroy(): void {
    this._horizontalEl.remove();
    this._verticalEl.remove();
  }
}
