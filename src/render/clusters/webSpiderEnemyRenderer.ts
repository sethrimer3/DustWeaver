/**
 * webSpiderEnemyRenderer.ts — Rendering helpers for the Web Spider enemy.
 *
 * Extracted from enemyRenderers.ts to keep each enemy type in its own focused
 * module.  Contains both the live spider body renderer and the fading-web
 * strand renderer; the two share their visual constants.
 */

import type { ClusterSnapshot, WorldSnapshot } from '../snapshot';

/** Stroke width (screen pixels) for active and fading web strands. */
const WEB_LINE_WIDTH_PX = 0.8;
/** Dash pattern [on, off] in screen pixels for all web strands. */
const WEB_DASH_PATTERN = [3, 3];

/**
 * Renders a single web spider cluster. The body is an 8×8 dark square (near-black)
 * with a white web-strand line from the body to the anchor when attached.
 */
export function renderWebSpider(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const cx = cluster.renderPositionXWorld * scalePx + offsetXPx;
  const cy = cluster.renderPositionYWorld * scalePx + offsetYPx;
  const halfPx = 4 * scalePx;

  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(cx - halfPx, cy - halfPx, halfPx * 2, halfPx * 2);

  ctx.fillStyle = '#cccccc';
  const eyeDotRadiusPx = Math.max(1, scalePx * 1.2);
  ctx.beginPath();
  ctx.arc(cx - eyeDotRadiusPx * 1.5, cy - eyeDotRadiusPx * 0.5, eyeDotRadiusPx, 0, Math.PI * 2);
  ctx.arc(cx + eyeDotRadiusPx * 1.5, cy - eyeDotRadiusPx * 0.5, eyeDotRadiusPx, 0, Math.PI * 2);
  ctx.fill();

  if (cluster.webSpiderState === 1) {
    const ax = cluster.webSpiderAnchorXWorld * scalePx + offsetXPx;
    const ay = cluster.webSpiderAnchorYWorld * scalePx + offsetYPx;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = WEB_LINE_WIDTH_PX;
    ctx.setLineDash(WEB_DASH_PATTERN);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

/**
 * Renders all fading web strands stored in the world snapshot.
 * Must be called BEFORE rendering clusters so spiders appear on top.
 */
export function renderWebSpiderFadingWebs(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const count = snapshot.webSpiderFadingWebActiveCount;
  if (count === 0) return;

  const max      = snapshot.webSpiderFadingWebMaxCount;
  const fromX    = snapshot.webSpiderFadingWebFromXWorld;
  const fromY    = snapshot.webSpiderFadingWebFromYWorld;
  const toX      = snapshot.webSpiderFadingWebToXWorld;
  const toY      = snapshot.webSpiderFadingWebToYWorld;
  const rem      = snapshot.webSpiderFadingWebRemainingTicks;
  const maxTicks = snapshot.webSpiderFadingWebMaxTicks;

  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = WEB_LINE_WIDTH_PX;
  ctx.setLineDash(WEB_DASH_PATTERN);

  for (let i = 0; i < max; i++) {
    if (rem[i] <= 0) continue;
    const alpha = maxTicks[i] > 0 ? rem[i] / maxTicks[i] : 0;
    ctx.globalAlpha = alpha * 0.75;
    ctx.beginPath();
    ctx.moveTo(fromX[i] * scalePx + offsetXPx, fromY[i] * scalePx + offsetYPx);
    ctx.lineTo(toX[i]   * scalePx + offsetXPx, toY[i]   * scalePx + offsetYPx);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1.0;
  ctx.restore();
}
