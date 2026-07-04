/**
 * Metallic block renderer for grid block enemies.
 *
 * Draws a beveled rectangle with a highlight/shadow border and an animated
 * glint sweep.  Color varies by speed variant:
 *   slow   → metallic green
 *   medium → metallic yellow
 *   fast   → metallic red
 */

import type { ClusterSnapshot } from '../clusterSnapshotTypes';

const BEVEL_PX   = 2;
const GLINT_ALPHA = 0.28;

const PALETTE_FILL      = ['#2e7d32', '#f9a825', '#c62828'] as const;
const PALETTE_HIGHLIGHT = ['#81c784', '#fff176', '#ef9a9a'] as const;
const PALETTE_SHADOW    = ['#1b5e20', '#f57f17', '#7f0000'] as const;
const PALETTE_BORDER    = ['#0a2e0c', '#5d4e00', '#3b0000'] as const;

export function renderGridBlockEnemy(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const si  = cluster.gridBlockSpeedIndex;
  const hw  = cluster.halfWidthWorld * scalePx;
  const hh  = cluster.halfHeightWorld * scalePx;

  const left   = screenX - hw;
  const top    = screenY - hh;
  const width  = hw * 2;
  const height = hh * 2;

  const fill      = PALETTE_FILL[si];
  const highlight = PALETTE_HIGHLIGHT[si];
  const shadow    = PALETTE_SHADOW[si];
  const border    = PALETTE_BORDER[si];

  // ── Filled body ───────────────────────────────────────────────────────────
  ctx.fillStyle = fill;
  ctx.fillRect(left, top, width, height);

  // ── Bevel highlight (top + left edges) ────────────────────────────────────
  ctx.fillStyle = highlight;
  ctx.fillRect(left,              top,              width,  BEVEL_PX); // top
  ctx.fillRect(left,              top,              BEVEL_PX, height); // left

  // ── Bevel shadow (bottom + right edges) ───────────────────────────────────
  ctx.fillStyle = shadow;
  ctx.fillRect(left,              top + height - BEVEL_PX, width,    BEVEL_PX); // bottom
  ctx.fillRect(left + width - BEVEL_PX, top,              BEVEL_PX, height);   // right

  // ── Outer border ──────────────────────────────────────────────────────────
  ctx.strokeStyle = border;
  ctx.lineWidth   = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, height - 1);

  // ── Animated glint sweep ──────────────────────────────────────────────────
  const glint = (Math.sin(cluster.gridBlockGlintPhase) + 1.0) * 0.5; // 0..1
  const glintX = left + glint * width;
  ctx.save();
  ctx.rect(left, top, width, height);
  ctx.clip();
  const grad = ctx.createLinearGradient(glintX - 4, top, glintX + 4, top);
  grad.addColorStop(0,   'rgba(255,255,255,0)');
  grad.addColorStop(0.5, `rgba(255,255,255,${GLINT_ALPHA})`);
  grad.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(left, top, width, height);
  ctx.restore();

  // ── Hit-flash overlay ─────────────────────────────────────────────────────
  if (cluster.gridBlockHitFlashTicks > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(left, top, width, height);
  }
}
