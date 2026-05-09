/**
 * Lambda Anchor renderer.
 *
 * Draws a golden λ-glyph pole at each Lambda Anchor position. The glyph
 * pulses gently when the player is linked to this anchor, and flashes
 * brightly on teleport activation.
 *
 * Coordinate space: all inputs are in world units; the caller supplies
 * the camera offset and zoom.  This renderer lives in render/ and reads
 * only read-only data — it never touches sim/.
 */

import type { RoomLambdaAnchorDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

/** Visual height of the pole above the anchor's block origin (world units). */
const POLE_HEIGHT_WORLD = BLOCK_SIZE_MEDIUM * 1.5;
/** Width of the pole (world units). */
const POLE_WIDTH_WORLD  = 1;
/** Radius of the glyph cap circle (world units). */
const CAP_RADIUS_WORLD  = BLOCK_SIZE_MEDIUM * 0.55;

/** Render all Lambda Anchors in the current room. */
export function renderLambdaAnchors(
  ctx: CanvasRenderingContext2D,
  anchors: readonly RoomLambdaAnchorDef[],
  linkedAnchorIndex: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  nowMs: number,
): void {
  if (anchors.length === 0) return;

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const isLinked = i === linkedAnchorIndex;
    renderAnchor(ctx, anchor, isLinked, offsetXPx, offsetYPx, zoom, nowMs);
  }
}

function renderAnchor(
  ctx: CanvasRenderingContext2D,
  anchor: RoomLambdaAnchorDef,
  isLinked: boolean,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  nowMs: number,
): void {
  const halfBlock = (BLOCK_SIZE_MEDIUM * zoom) / 2;

  // Anchor origin: centre-bottom of its block cell.
  const baseCX = anchor.xBlock * BLOCK_SIZE_MEDIUM * zoom + offsetXPx + halfBlock;
  const baseCY = anchor.yBlock * BLOCK_SIZE_MEDIUM * zoom + offsetYPx + BLOCK_SIZE_MEDIUM * zoom;

  const poleHeightPx = POLE_HEIGHT_WORLD * zoom;
  const poleWidthPx  = Math.max(1, POLE_WIDTH_WORLD * zoom);
  const capRadiusPx  = CAP_RADIUS_WORLD * zoom;

  // Gentle pulse when linked; subtle breathing when unlinked.
  const pulseSpeed = isLinked ? 2.8 : 1.1;
  const pulseAmp   = isLinked ? 0.22 : 0.08;
  const pulseFactor = 1 + Math.sin((nowMs / 1000) * pulseSpeed * Math.PI * 2) * pulseAmp;

  // Pole
  const poleAlpha = isLinked ? 0.85 : 0.55;
  ctx.save();
  ctx.globalAlpha = poleAlpha;
  ctx.fillStyle = '#c8a020';
  ctx.fillRect(
    baseCX - poleWidthPx / 2,
    baseCY - poleHeightPx,
    poleWidthPx,
    poleHeightPx,
  );
  ctx.restore();

  // Glyph cap circle
  const capCX = baseCX;
  const capCY = baseCY - poleHeightPx;
  const displayRadius = capRadiusPx * pulseFactor;

  ctx.save();
  ctx.globalAlpha = isLinked ? 0.92 : 0.65;

  // Outer glow when linked
  if (isLinked) {
    const glowRadius = displayRadius * 1.55;
    const grad = ctx.createRadialGradient(capCX, capCY, 0, capCX, capCY, glowRadius);
    grad.addColorStop(0,   'rgba(255, 235, 80, 0.55)');
    grad.addColorStop(0.6, 'rgba(220, 180, 20, 0.18)');
    grad.addColorStop(1,   'rgba(200, 150,  0, 0)');
    ctx.beginPath();
    ctx.arc(capCX, capCY, glowRadius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // Cap disc
  ctx.beginPath();
  ctx.arc(capCX, capCY, displayRadius, 0, Math.PI * 2);
  ctx.fillStyle = isLinked ? '#ffe84a' : '#c8a020';
  ctx.fill();
  ctx.restore();

  // λ glyph text
  ctx.save();
  const glyphSize = Math.max(5, displayRadius * 1.4);
  ctx.font = `bold ${glyphSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = isLinked ? 0.95 : 0.75;
  ctx.fillStyle = '#1a0a00';
  ctx.fillText('λ', capCX, capCY);
  ctx.restore();
}

/**
 * Render a full-screen teleport flash overlay.
 *
 * Call this in the render pipeline when `teleportFlashAlpha > 0`.
 * The alpha value decays each frame in gameRender.ts.
 */
export function renderTeleportFlash(
  ctx: CanvasRenderingContext2D,
  canvasWidthPx: number,
  canvasHeightPx: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = '#ffe84a';
  ctx.fillRect(0, 0, canvasWidthPx, canvasHeightPx);
  ctx.restore();
}
