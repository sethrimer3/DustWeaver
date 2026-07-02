/**
 * Grid Block Enemy renderer.
 *
 * Draws a metallic filled rectangle with beveled edges and a dark border.
 * Colors:
 *   Slow   (speedIndex 0) → metallic green
 *   Medium (speedIndex 1) → metallic yellow
 *   Fast   (speedIndex 2) → metallic red
 *
 * A subtle glint scans across the face each ~3 seconds.
 */

import type { ClusterSnapshot } from '../snapshot';

// ── Color palettes (base fill, highlight, shadow, border) ────────────────────

const PALETTE_FILL:      readonly string[] = ['#2e7d32', '#f9a825', '#c62828'];
const PALETTE_HIGHLIGHT: readonly string[] = ['#81c784', '#fff176', '#ef9a9a'];
const PALETTE_SHADOW:    readonly string[] = ['#1b5e20', '#f57f17', '#7f0000'];
const PALETTE_BORDER:    readonly string[] = ['#0a2e0c', '#5d4e00', '#3b0000'];

/** Width of the bevel band in screen pixels (scaled). */
const BEVEL_PX = 2;
/** Alpha of the scan-glint stripe. */
const GLINT_ALPHA = 0.28;

export function renderGridBlockEnemy(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const speedIndex = cluster.gridBlockSpeedIndex;
  const hw = cluster.halfWidthWorld * scalePx;
  const hh = cluster.halfHeightWorld * scalePx;

  const left   = screenX - hw;
  const top    = screenY - hh;
  const width  = hw * 2;
  const height = hh * 2;

  const fill      = PALETTE_FILL[speedIndex];
  const highlight = PALETTE_HIGHLIGHT[speedIndex];
  const shadow    = PALETTE_SHADOW[speedIndex];
  const border    = PALETTE_BORDER[speedIndex];

  // ── Hit-flash: brighten the whole block ─────────────────────────────────
  const hitFlash = cluster.gridBlockHitFlashTicks > 0;
  ctx.save();

  if (hitFlash) {
    ctx.globalAlpha = 0.6;
  }

  // ── Main fill ────────────────────────────────────────────────────────────
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, width, height);

  // ── Bevel: top & left highlight ─────────────────────────────────────────
  ctx.fillStyle = highlight;
  ctx.fillRect(left, top, width, BEVEL_PX);          // top edge
  ctx.fillRect(left, top, BEVEL_PX, height);          // left edge

  // ── Bevel: bottom & right shadow ────────────────────────────────────────
  ctx.fillStyle = shadow;
  ctx.fillRect(left, top + height - BEVEL_PX, width, BEVEL_PX); // bottom
  ctx.fillRect(left + width - BEVEL_PX, top, BEVEL_PX, height); // right

  // ── Border ──────────────────────────────────────────────────────────────
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);

  // ── Glint sweep ─────────────────────────────────────────────────────────
  const glintPhase = cluster.gridBlockGlintPhase;
  // glintPhase in [0, 2π]. Map to x offset within the block face.
  const glintT = (Math.sin(glintPhase) + 1.0) * 0.5; // 0..1
  const glintX = left + width * glintT;
  const glintW = Math.max(BEVEL_PX, width * 0.10);

  ctx.save();
  ctx.globalAlpha *= GLINT_ALPHA;
  ctx.fillStyle = highlight;
  ctx.fillRect(glintX - glintW * 0.5, top + BEVEL_PX, glintW, height - BEVEL_PX * 2);
  ctx.restore();

  // ── Hit-flash white overlay ─────────────────────────────────────────────
  if (hitFlash) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, top, width, height);
  }

  ctx.restore();
}
