/**
 * playerSpeedGraphOverlayRenderer.ts — Real-time player speed graph, debug overlay.
 *
 * Bottom-left HTML `<canvas>` overlay (DOM layer above the game canvas, not
 * drawn into the native-resolution game canvas) showing the player's speed
 * (px/s) over the last SPEED_GRAPH_WINDOW_MS. The backing store is sized at
 * devicePixelRatio so the line/text stay crisp regardless of the game's
 * native render resolution. Gated by debug mode + the 'speedGraph' panel
 * toggle (see debugPanelManager.ts) — visible by default, unlike other
 * debug panels.
 */

import type { WorldState } from '../../sim/world';
import { getPixelSpeedGraphEnabled, getPixelSpeedGraphOpacity, getPixelSpeedometerEnabled } from '../../ui/renderSettings';

const SPEED_GRAPH_WINDOW_MS = 10_000;
const GRAPH_CSS_WIDTH = 260;
const GRAPH_CSS_HEIGHT = 110;
const PADDING_LEFT_CSS = 34;
const PADDING_RIGHT_CSS = 6;
const PADDING_TOP_CSS = 14;
const PADDING_BOTTOM_CSS = 6;

interface SpeedSample {
  readonly tMs: number;
  readonly speed: number;
}

export interface PlayerSpeedGraphOverlayUpdate {
  readonly world: WorldState;
  readonly nowMs: number;
}

export class PlayerSpeedGraphOverlayRenderer {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private readonly _samples: SpeedSample[] = [];
  private _dpr = 0;

  constructor(uiRoot: HTMLElement) {
    this._canvas = document.createElement('canvas');
    this._canvas.style.cssText = `
      position: absolute;
      display: none;
      left: 16px;
      bottom: 16px;
      width: ${GRAPH_CSS_WIDTH}px;
      height: ${GRAPH_CSS_HEIGHT}px;
      z-index: 420;
      pointer-events: none;
      background: rgba(10, 12, 16, 0.55);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
    `;
    uiRoot.appendChild(this._canvas);
    const ctx = this._canvas.getContext('2d');
    if (ctx === null) throw new Error('PlayerSpeedGraphOverlayRenderer: 2D context unavailable');
    this._ctx = ctx;
    this._resizeForDpr();
  }

  private _resizeForDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    if (dpr === this._dpr) return;
    this._dpr = dpr;
    this._canvas.width = Math.round(GRAPH_CSS_WIDTH * dpr);
    this._canvas.height = Math.round(GRAPH_CSS_HEIGHT * dpr);
    this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  update(params: PlayerSpeedGraphOverlayUpdate): void {
    if (!getPixelSpeedometerEnabled() || !getPixelSpeedGraphEnabled()) {
      this.hide();
      return;
    }

    const player = params.world.clusters[0];
    if (player === undefined || player.isAliveFlag !== 1) {
      this.hide();
      return;
    }

    this._resizeForDpr();

    const speed = Math.hypot(player.velocityXWorld, player.velocityYWorld);
    this._samples.push({ tMs: params.nowMs, speed });
    const cutoffMs = params.nowMs - SPEED_GRAPH_WINDOW_MS;
    while (this._samples.length > 0 && this._samples[0].tMs < cutoffMs) {
      this._samples.shift();
    }

    this._canvas.style.display = 'block';
    this._canvas.style.opacity = getPixelSpeedGraphOpacity().toString();
    this._draw(params.nowMs);
  }

  private _draw(nowMs: number): void {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, GRAPH_CSS_WIDTH, GRAPH_CSS_HEIGHT);

    const plotLeft = PADDING_LEFT_CSS;
    const plotTop = PADDING_TOP_CSS;
    const plotWidth = GRAPH_CSS_WIDTH - PADDING_LEFT_CSS - PADDING_RIGHT_CSS;
    const plotHeight = GRAPH_CSS_HEIGHT - PADDING_TOP_CSS - PADDING_BOTTOM_CSS;

    // ── Title ──────────────────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillText('Speed (px/s) — last 10s', 6, 2);

    if (this._samples.length === 0) return;

    // ── Dynamic Y axis: stretch to the current window's top speed ───────────
    let maxSpeed = 0;
    for (let i = 0; i < this._samples.length; i++) {
      if (this._samples[i].speed > maxSpeed) maxSpeed = this._samples[i].speed;
    }
    // Headroom so the line never touches the top edge; floor of 50 px/s keeps
    // the axis from jittering wildly while nearly stationary.
    const axisMax = Math.max(50, maxSpeed * 1.15);

    // ── Gridlines + Y-axis labels (0, mid, max) ──────────────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.lineWidth = 1;
    const gridFracs = [0, 0.5, 1];
    for (const frac of gridFracs) {
      const y = plotTop + plotHeight * (1 - frac);
      ctx.beginPath();
      ctx.moveTo(plotLeft, y);
      ctx.lineTo(plotLeft + plotWidth, y);
      ctx.stroke();
      const label = Math.round(axisMax * frac).toString();
      ctx.textAlign = 'right';
      ctx.textBaseline = frac === 0 ? 'bottom' : frac === 1 ? 'top' : 'middle';
      ctx.fillText(label, plotLeft - 4, y);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // ── Speed polyline ────────────────────────────────────────────────────
    ctx.strokeStyle = '#5ec8ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < this._samples.length; i++) {
      const s = this._samples[i];
      const xFrac = 1 - (nowMs - s.tMs) / SPEED_GRAPH_WINDOW_MS;
      const x = plotLeft + plotWidth * Math.min(1, Math.max(0, xFrac));
      const y = plotTop + plotHeight * (1 - Math.min(1, s.speed / axisMax));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ── Current speed readout ────────────────────────────────────────────
    const current = this._samples[this._samples.length - 1].speed;
    ctx.fillStyle = '#5ec8ff';
    ctx.font = 'bold 10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(current)}`, GRAPH_CSS_WIDTH - PADDING_RIGHT_CSS, 2);
    ctx.textAlign = 'left';
  }

  hide(): void {
    this._canvas.style.display = 'none';
  }

  destroy(): void {
    this._canvas.remove();
  }
}
