import { getPixelSpeedometerEnabled } from '../../ui/renderSettings';
import type { WorldState } from '../../sim/world';
import {
  nativeGamePointToOverlayCssPoint,
  snapCssPixelToDevicePixel,
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
  color: #d4a84b;
  text-align: center;
  white-space: nowrap;
  text-shadow:
    -1px -1px 0 rgba(0, 0, 0, 0.78),
     1px -1px 0 rgba(0, 0, 0, 0.78),
    -1px  1px 0 rgba(0, 0, 0, 0.78),
     1px  1px 0 rgba(0, 0, 0, 0.78),
     0 0 5px rgba(0, 0, 0, 0.70);
`;

const GAP_ABOVE_PLAYER_CSS_PX = 6;

export interface PlayerSpeedometerOverlayUpdate {
  readonly world: WorldState;
  readonly canvas: HTMLCanvasElement;
  readonly nativeWidthPx: number;
  readonly nativeHeightPx: number;
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly zoom: number;
}

export class PlayerSpeedometerOverlayRenderer {
  private readonly _root: HTMLElement;
  private readonly _el: HTMLDivElement;
  private _lastText = '';

  constructor(uiRoot: HTMLElement) {
    this._root = uiRoot;
    this._el = document.createElement('div');
    this._el.style.cssText = SPEEDOMETER_CSS;
    uiRoot.appendChild(this._el);
  }

  update(params: PlayerSpeedometerOverlayUpdate): void {
    if (!getPixelSpeedometerEnabled()) {
      this.hide();
      return;
    }

    const player = params.world.clusters[0];
    if (player === undefined || player.isAliveFlag !== 1) {
      this.hide();
      return;
    }

    const speedPxPerSec = Math.hypot(player.velocityXWorld, player.velocityYWorld);
    const speedText = `${Math.round(speedPxPerSec)} px/s`;
    if (speedText !== this._lastText) {
      this._el.textContent = speedText;
      this._lastText = speedText;
    }

    const nativePlayerCenterXPx = player.positionXWorld * params.zoom + params.offsetXPx;
    const nativePlayerTopYPx = (player.positionYWorld - player.halfHeightWorld) * params.zoom + params.offsetYPx;
    const canvasRect = params.canvas.getBoundingClientRect();
    const rootRect = this._root.getBoundingClientRect();
    const point = nativeGamePointToOverlayCssPoint({
      nativeX: nativePlayerCenterXPx,
      nativeY: nativePlayerTopYPx,
      nativeWidth: params.nativeWidthPx,
      nativeHeight: params.nativeHeightPx,
      canvasCssRect: canvasRect,
      overlayCssRect: rootRect,
    });

    this._el.style.display = 'block';

    const dpr = window.devicePixelRatio || 1;
    const textWidth = this._el.offsetWidth;
    const textHeight = this._el.offsetHeight;
    const leftCss = snapCssPixelToDevicePixel(point.xCss - textWidth * 0.5, dpr);
    const topCss = snapCssPixelToDevicePixel(point.yCss - textHeight - GAP_ABOVE_PLAYER_CSS_PX, dpr);

    this._el.style.left = `${leftCss}px`;
    this._el.style.top = `${topCss}px`;
  }

  hide(): void {
    this._el.style.display = 'none';
  }

  destroy(): void {
    this._el.remove();
  }
}
