/**
 * cloakPolygonRenderer.ts — Standalone polygon-building and draw helpers for
 * the player cloak.
 *
 * Extracted from PlayerCloak so that the polygon geometry and debug-overlay
 * logic are decoupled from the chain simulation.  All functions are pure
 * (no class state) and accept pre-allocated typed-array buffers as outputs,
 * keeping the render hot-path allocation-free.
 *
 * Functions:
 *   getCloakPerp           — perpendicular unit-vector at a chain index
 *   buildBackCloakPolygon  — fill left/right buffers for the back cloak
 *   buildFrontCloakPolygon — fill left/right buffers for the front cloak
 *   drawCloakPolygon       — draw filled+outlined polygon from edge buffers
 *   renderCloakDebug       — debug overlay (chain, polygons, boundary, text)
 */

import {
  CLOAK_BACK_WIDTH_ROOT_WORLD,
  CLOAK_BACK_WIDTH_TIP_WORLD,
  CLOAK_BACK_FAST_FALL_TIP_EXTRA_WORLD,
  CLOAK_FAST_FALL_CORNER_SHARPNESS,
  CLOAK_MIN_TANGENT_LENGTH,
  CLOAK_FRONT_WIDTH_RATIO,
  CLOAK_FRONT_PROJECTION_WORLD,
  CLOAK_FRONT_PROJECTION_TAPER,
  CLOAK_DEBUG_POINT_RADIUS_PX,
} from './cloakConstants';

// ── Module-level scratch buffer for getCloakPerp ───────────────────────────
// Avoids per-call allocation in the render hot path.  Only one instance of
// PlayerCloak is ever active, so sharing this buffer is safe.
const _scratchPerpBuffer: [number, number] = [0, 0];

// ── Perpendicular helper ───────────────────────────────────────────────────

/**
 * Compute the perpendicular unit vector at chain index `i` using the tangent
 * from the neighbouring chain points.
 *
 * Returns a reference to a module-level scratch buffer — callers must NOT
 * store the reference; copy the values if they are needed beyond the next call.
 */
export function getCloakPerp(
  posXWorld: Float32Array,
  posYWorld: Float32Array,
  pointCount: number,
  i: number,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
  screenX: number,
  screenY: number,
): readonly [number, number] {
  let tangentX = 0;
  let tangentY = 1;
  if (i < pointCount - 1) {
    const nextSX = Math.round(posXWorld[i + 1] * scalePx + offsetXPx);
    const nextSY = Math.round(posYWorld[i + 1] * scalePx + offsetYPx);
    tangentX = nextSX - screenX;
    tangentY = nextSY - screenY;
  } else if (i > 0) {
    const prevSX = Math.round(posXWorld[i - 1] * scalePx + offsetXPx);
    const prevSY = Math.round(posYWorld[i - 1] * scalePx + offsetYPx);
    tangentX = screenX - prevSX;
    tangentY = screenY - prevSY;
  }
  const len = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
  if (len > CLOAK_MIN_TANGENT_LENGTH) {
    _scratchPerpBuffer[0] = -tangentY / len;
    _scratchPerpBuffer[1] = tangentX / len;
  } else {
    _scratchPerpBuffer[0] = 1;
    _scratchPerpBuffer[1] = 0;
  }
  return _scratchPerpBuffer;
}

// ── Polygon builders ───────────────────────────────────────────────────────

/**
 * Fill pre-allocated left/right pixel-coordinate buffers for the back cloak.
 * Shape widens from root to tip, with sharper outer corners during fast fall.
 *
 * @param landingScale  Pre-computed landing compression scale (1.0 = none).
 */
export function buildBackCloakPolygon(
  posXWorld: Float32Array,
  posYWorld: Float32Array,
  pointCount: number,
  spreadAmount: number,
  isFastFall: boolean,
  landingScale: number,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
  outLeftX: Float32Array,
  outLeftY: Float32Array,
  outRightX: Float32Array,
  outRightY: Float32Array,
): void {
  const spread = spreadAmount;

  for (let i = 0; i < pointCount; i++) {
    const screenX = Math.round(posXWorld[i] * scalePx + offsetXPx);
    const screenY = Math.round(posYWorld[i] * scalePx + offsetYPx);

    // Interpolate base width from root to tip.
    const t = i / (pointCount - 1);
    const baseRootW = CLOAK_BACK_WIDTH_ROOT_WORLD;
    let baseTipW = CLOAK_BACK_WIDTH_TIP_WORLD;

    // During fast fall, tip widens dramatically.
    if (isFastFall) {
      baseTipW += CLOAK_BACK_FAST_FALL_TIP_EXTRA_WORLD * spread;
    }

    const baseWidth = baseRootW * (1 - t) + baseTipW * t;
    // Apply spread multiplier: spread makes the whole cloak wider.
    const widthWorld = baseWidth * (1 + spread * 0.8) * landingScale;
    const halfWidth = (widthWorld * scalePx) * 0.5;

    // Compute perpendicular from chain tangent.
    const perp = getCloakPerp(posXWorld, posYWorld, pointCount, i, scalePx, offsetXPx, offsetYPx, screenX, screenY);

    // During fast fall, push outer corners outward for a sharper silhouette.
    // cornerSharpX uses 2× horizontal emphasis for a visually dramatic wing-out.
    // cornerSharpY forces upward (negative) to lift corners regardless of perp direction.
    let cornerSharpX = 0;
    let cornerSharpY = 0;
    if (isFastFall && t > 0.5) {
      const cornerT = (t - 0.5) * 2; // 0..1 over bottom half
      cornerSharpX = perp[0] * CLOAK_FAST_FALL_CORNER_SHARPNESS * cornerT * spread * scalePx * 2;
      cornerSharpY = -Math.abs(perp[1]) * CLOAK_FAST_FALL_CORNER_SHARPNESS * cornerT * spread * scalePx;
    }

    outLeftX[i] = Math.round(screenX + perp[0] * halfWidth + cornerSharpX);
    outLeftY[i] = Math.round(screenY + perp[1] * halfWidth + cornerSharpY);
    outRightX[i] = Math.round(screenX - perp[0] * halfWidth - cornerSharpX);
    outRightY[i] = Math.round(screenY - perp[1] * halfWidth + cornerSharpY);
  }
}

/**
 * Fill pre-allocated left/right pixel-coordinate buffers for the front cloak.
 * Shorter and narrower than the back layer, offset toward the player's front.
 *
 * @param foldDirX     +1 if player faces right, −1 if facing left.
 * @param landingScale Pre-computed landing compression scale (1.0 = none).
 */
export function buildFrontCloakPolygon(
  posXWorld: Float32Array,
  posYWorld: Float32Array,
  pointCount: number,
  frontPointCount: number,
  spreadAmount: number,
  opennessAmount: number,
  foldDirX: number,
  landingScale: number,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
  outLeftX: Float32Array,
  outLeftY: Float32Array,
  outRightX: Float32Array,
  outRightY: Float32Array,
): void {
  const spread = spreadAmount;
  const openness = opennessAmount;
  // Front fold direction: toward the player's facing side.
  const projectionPx = CLOAK_FRONT_PROJECTION_WORLD * openness * scalePx * foldDirX;

  for (let i = 0; i < frontPointCount; i++) {
    // Map front index to the chain (front is shorter, proportional indexing).
    const chainT = i / (frontPointCount - 1);
    const chainIdx = Math.min(pointCount - 1, chainT * (pointCount - 1));
    const lowerIdx = Math.floor(chainIdx);
    const upperIdx = Math.min(pointCount - 1, lowerIdx + 1);
    const frac = chainIdx - lowerIdx;

    // Interpolated chain position.
    const worldX = posXWorld[lowerIdx] + (posXWorld[upperIdx] - posXWorld[lowerIdx]) * frac;
    const worldY = posYWorld[lowerIdx] + (posYWorld[upperIdx] - posYWorld[lowerIdx]) * frac;
    const screenX = Math.round(worldX * scalePx + offsetXPx);
    const screenY = Math.round(worldY * scalePx + offsetYPx);

    // Front cloak width: narrower via FRONT_WIDTH_RATIO, modulated by spread.
    const t = i / (frontPointCount - 1);
    const backWidth = CLOAK_BACK_WIDTH_ROOT_WORLD * (1 - t) + CLOAK_BACK_WIDTH_TIP_WORLD * t;
    const frontWidth = backWidth * CLOAK_FRONT_WIDTH_RATIO * (1 + spread * 0.4) * landingScale;
    const halfWidth = (frontWidth * scalePx) * 0.5;

    // Perpendicular from nearest chain segment.
    const perpIdx = Math.min(lowerIdx, pointCount - 2);
    const perp = getCloakPerp(posXWorld, posYWorld, pointCount, perpIdx, scalePx, offsetXPx, offsetYPx, screenX, screenY);

    // Offset toward front (projection).
    // Root projects more, tip less — creates a front fold that tapers toward the cloak's end.
    const projX = projectionPx * (1 - t * CLOAK_FRONT_PROJECTION_TAPER);

    outLeftX[i] = Math.round(screenX + perp[0] * halfWidth + projX);
    outLeftY[i] = Math.round(screenY + perp[1] * halfWidth);
    outRightX[i] = Math.round(screenX - perp[0] * halfWidth + projX);
    outRightY[i] = Math.round(screenY - perp[1] * halfWidth);
  }
}

// ── Draw helper ───────────────────────────────────────────────────────────

/** Draw a filled + outlined closed polygon from pre-built left/right edge buffers. */
export function drawCloakPolygon(
  ctx: CanvasRenderingContext2D,
  leftX: Float32Array,
  leftY: Float32Array,
  rightX: Float32Array,
  rightY: Float32Array,
  count: number,
  fillColor: string,
  outlineColor: string,
  outlineWidth: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(leftX[0], leftY[0]);
  for (let i = 1; i < count; i++) {
    ctx.lineTo(leftX[i], leftY[i]);
  }
  for (let i = count - 1; i >= 0; i--) {
    ctx.lineTo(rightX[i], rightY[i]);
  }
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

// ── Debug overlay ─────────────────────────────────────────────────────────

/** All data required to render the cloak debug overlay. */
export interface CloakDebugParams {
  // Chain data
  readonly posXWorld: Float32Array;
  readonly posYWorld: Float32Array;
  readonly pointCount: number;
  readonly frontPointCount: number;
  // Shape state
  readonly spreadAmount: number;
  readonly opennessAmount: number;
  readonly isFastFallActive: boolean;
  readonly turnTimerSec: number;
  readonly landingTimerSec: number;
  /** Pre-computed landing compression scale (1.0 = no compression). */
  readonly landingScale: number;
  /** Fold direction: +1 if player faces right, −1 if facing left. */
  readonly foldDirX: number;
  // Pre-allocated polygon buffers (filled internally by renderCloakDebug)
  readonly backLeftXPx: Float32Array;
  readonly backLeftYPx: Float32Array;
  readonly backRightXPx: Float32Array;
  readonly backRightYPx: Float32Array;
  readonly frontLeftXPx: Float32Array;
  readonly frontLeftYPx: Float32Array;
  readonly frontRightXPx: Float32Array;
  readonly frontRightYPx: Float32Array;
  // Boundary helpers (pre-computed by PlayerCloak before calling)
  readonly anchorWorldX: number;
  readonly anchorWorldY: number;
  readonly shoulderWorldX: number;
  readonly shoulderWorldY: number;
  readonly backBoundaryWorldX: number;
  readonly backBoundaryTopWorldY: number;
  readonly backBoundaryBottomWorldY: number;
  readonly drapeSpacing: number;
  readonly isFacingRight: boolean;
  // Coordinate transform
  readonly offsetXPx: number;
  readonly offsetYPx: number;
  readonly scalePx: number;
}

/**
 * Render the cloak debug overlay: anchor, shoulder, chain points and lines,
 * back/front polygon outlines, back-collision boundary, drape targets, and
 * shape-value text.
 */
export function renderCloakDebug(
  ctx: CanvasRenderingContext2D,
  p: CloakDebugParams,
): void {
  const {
    posXWorld, posYWorld, pointCount, frontPointCount,
    spreadAmount, isFastFallActive, landingScale, foldDirX,
    backLeftXPx, backLeftYPx, backRightXPx, backRightYPx,
    frontLeftXPx, frontLeftYPx, frontRightXPx, frontRightYPx,
    anchorWorldX, anchorWorldY, shoulderWorldX, shoulderWorldY,
    backBoundaryWorldX, backBoundaryTopWorldY, backBoundaryBottomWorldY,
    drapeSpacing, isFacingRight,
    offsetXPx, offsetYPx, scalePx,
  } = p;

  ctx.save();

  // Anchor point (red).
  const anchorSX = Math.round(anchorWorldX * scalePx + offsetXPx);
  const anchorSY = Math.round(anchorWorldY * scalePx + offsetYPx);
  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.arc(anchorSX, anchorSY, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();

  // Shoulder reference (yellow).
  const shoulderSX = Math.round(shoulderWorldX * scalePx + offsetXPx);
  const shoulderSY = Math.round(shoulderWorldY * scalePx + offsetYPx);
  ctx.fillStyle = '#ffff00';
  ctx.beginPath();
  ctx.arc(shoulderSX, shoulderSY, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
  ctx.fill();

  // Chain points (cyan circles + lines).
  ctx.strokeStyle = '#00ffff';
  ctx.lineWidth = 1;
  for (let i = 0; i < pointCount; i++) {
    const sx = Math.round(posXWorld[i] * scalePx + offsetXPx);
    const sy = Math.round(posYWorld[i] * scalePx + offsetYPx);

    ctx.fillStyle = i === 0 ? '#ff8800' : '#00ffff';
    ctx.beginPath();
    ctx.arc(sx, sy, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    if (i > 0) {
      const prevSx = Math.round(posXWorld[i - 1] * scalePx + offsetXPx);
      const prevSy = Math.round(posYWorld[i - 1] * scalePx + offsetYPx);
      ctx.beginPath();
      ctx.moveTo(prevSx, prevSy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
  }

  // Back polygon outline (magenta, dashed).
  buildBackCloakPolygon(
    posXWorld, posYWorld, pointCount,
    spreadAmount, isFastFallActive, landingScale,
    scalePx, offsetXPx, offsetYPx,
    backLeftXPx, backLeftYPx, backRightXPx, backRightYPx,
  );
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(backLeftXPx[0], backLeftYPx[0]);
  for (let i = 1; i < pointCount; i++) {
    ctx.lineTo(backLeftXPx[i], backLeftYPx[i]);
  }
  for (let i = pointCount - 1; i >= 0; i--) {
    ctx.lineTo(backRightXPx[i], backRightYPx[i]);
  }
  ctx.closePath();
  ctx.stroke();

  // Front polygon outline (green, dashed).
  buildFrontCloakPolygon(
    posXWorld, posYWorld, pointCount, frontPointCount,
    spreadAmount, p.opennessAmount, foldDirX, landingScale,
    scalePx, offsetXPx, offsetYPx,
    frontLeftXPx, frontLeftYPx, frontRightXPx, frontRightYPx,
  );
  ctx.strokeStyle = '#00ff00';
  ctx.beginPath();
  ctx.moveTo(frontLeftXPx[0], frontLeftYPx[0]);
  for (let i = 1; i < frontPointCount; i++) {
    ctx.lineTo(frontLeftXPx[i], frontLeftYPx[i]);
  }
  for (let i = frontPointCount - 1; i >= 0; i--) {
    ctx.lineTo(frontRightXPx[i], frontRightYPx[i]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  // Shape value text.
  const textX = anchorSX + 12;
  let textY = anchorSY - 20;
  ctx.font = '8px monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`spread: ${p.spreadAmount.toFixed(2)}`, textX, textY); textY += 10;
  ctx.fillText(`openness: ${p.opennessAmount.toFixed(2)}`, textX, textY); textY += 10;
  ctx.fillText(`fastFall: ${p.isFastFallActive ? 'YES' : 'no'}`, textX, textY); textY += 10;
  if (p.turnTimerSec > 0) {
    ctx.fillText(`turn: ${p.turnTimerSec.toFixed(2)}s`, textX, textY); textY += 10;
  }
  if (p.landingTimerSec > 0) {
    ctx.fillText(`land: ${p.landingTimerSec.toFixed(2)}s`, textX, textY);
  }

  // ── Back collision boundary line (orange) ──────────────────────────────
  const backLineSX = Math.round(backBoundaryWorldX * scalePx + offsetXPx);
  const backLineTopSY = Math.round(backBoundaryTopWorldY * scalePx + offsetYPx);
  const backLineBottomSY = Math.round(backBoundaryBottomWorldY * scalePx + offsetYPx);

  ctx.strokeStyle = '#ff8800';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(backLineSX, backLineTopSY);
  ctx.lineTo(backLineSX, backLineBottomSY);
  ctx.stroke();

  // Back boundary top/bottom markers (small horizontal ticks).
  const tickHalfLenPx = 2;
  ctx.beginPath();
  ctx.moveTo(backLineSX - tickHalfLenPx, backLineTopSY);
  ctx.lineTo(backLineSX + tickHalfLenPx, backLineTopSY);
  ctx.moveTo(backLineSX - tickHalfLenPx, backLineBottomSY);
  ctx.lineTo(backLineSX + tickHalfLenPx, backLineBottomSY);
  ctx.stroke();

  // Highlight cloak points that are within the back boundary Y range.
  const backToleranceWorld = 1.5;
  for (let i = 1; i < pointCount; i++) {
    const py = posYWorld[i];
    if (py >= backBoundaryTopWorldY && py <= backBoundaryBottomWorldY) {
      const sx = Math.round(posXWorld[i] * scalePx + offsetXPx);
      const sy = Math.round(py * scalePx + offsetYPx);

      // Check if point is on the back surface (constrained).
      const px = posXWorld[i];
      const distFromBack = isFacingRight ? (backBoundaryWorldX - px) : (px - backBoundaryWorldX);
      const isConstrained = distFromBack >= -0.5 && distFromBack <= backToleranceWorld;

      ctx.fillStyle = isConstrained ? '#ff00ff' : '#ff4400';
      ctx.beginPath();
      ctx.arc(sx, sy, CLOAK_DEBUG_POINT_RADIUS_PX + 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Drape target positions along the back (small green diamonds).
  const anchorY = posYWorld[0];
  ctx.fillStyle = '#00ff88';
  for (let i = 1; i < pointCount; i++) {
    const idealY = anchorY + (i * drapeSpacing);
    const targetY = Math.min(Math.max(idealY, backBoundaryTopWorldY), backBoundaryBottomWorldY);
    const dtsx = backLineSX;
    const dtsy = Math.round(targetY * scalePx + offsetYPx);
    // Draw a small diamond marker.
    ctx.beginPath();
    ctx.moveTo(dtsx, dtsy - 2);
    ctx.lineTo(dtsx + 2, dtsy);
    ctx.lineTo(dtsx, dtsy + 2);
    ctx.lineTo(dtsx - 2, dtsy);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = '#ff8800';
  ctx.fillText('backCol', backLineSX + 4, backLineTopSY - 2);

  ctx.restore();
}
