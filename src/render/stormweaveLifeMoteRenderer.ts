import {
  STORMWEAVE_TRAIL_LIFETIME_SEC,
  getStormweaveTrailSizing,
  type StormweaveLifeMotes,
} from '../sim/stormweave/lifeMotes';
import { getEffectiveShieldArcLengthWorld, type ShieldWeaveState } from '../sim/stormweave/shieldWeave';
import type { GraphicsQuality } from '../ui/renderSettings';
import { getMoteTypeVisual, shadeRgb, rgbToHex, type MoteRgb } from '../sim/motes/moteTypeConfig';

const FULL_CIRCLE_EPSILON = 1e-6;

/** Mixes `c` toward white by `amount` (0 = unchanged, 1 = pure white), clamped. */
function mixWithWhite(c: MoteRgb, amount: number): MoteRgb {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const a = clamp(amount);
  return {
    r: clamp(c.r + (1 - c.r) * a),
    g: clamp(c.g + (1 - c.g) * a),
    b: clamp(c.b + (1 - c.b) * a),
  };
}

/**
 * Fully-resolved hex-string palette for one frame's worth of canonical
 * Stormweave life-mote rendering, derived once per render call from the
 * centralized `moteTypeConfig.ts` visual for the selected dust kind. Pure and
 * allocation-cheap (a handful of string conversions) — never per-mote,
 * per-trail-point, or per-frame-loop-iteration work.
 */
export interface StormweaveMotePalette {
  /** Solid mote body fill. */
  bodyHex: string;
  /** Bright one-pixel mote highlight/glint. */
  highlightHex: string;
  /** Additive glow: broad, low-alpha outer bloom. */
  glowOuterHex: string;
  /** Additive glow: smaller, brighter inner bloom. */
  glowInnerHex: string;
  /** Ribbon trail: broad low-alpha outer glow pass. */
  trailOuterHex: string;
  /** Ribbon trail: main colour pass. */
  trailMainHex: string;
  /** Ribbon trail: bright core pass. */
  trailCoreHex: string;
  /** Shield Weave crescent: broad arc point colour. */
  shieldCrescentHex: string;
  /** Shield Weave crescent: bright one-pixel center. */
  shieldCrescentCenterHex: string;
  /** Shield Weave impact flash: strongly brightened/desaturated but tinted. */
  shieldImpactHex: string;
}

/**
 * Builds the full hex-string palette for `kind` from its centralized
 * `moteTypeConfig.ts` visual. Pure — no canvas/DOM — so it's directly
 * unit-testable without mocking `CanvasRenderingContext2D`.
 */
export function buildStormweaveMotePalette(kind: number): StormweaveMotePalette {
  const visual = getMoteTypeVisual(kind);
  return {
    bodyHex: rgbToHex(visual.body),
    highlightHex: rgbToHex(mixWithWhite(visual.glow, 0.5)),
    glowOuterHex: rgbToHex(shadeRgb(visual.trail, 0.85)),
    glowInnerHex: rgbToHex(visual.glow),
    trailOuterHex: rgbToHex(shadeRgb(visual.trail, 0.5)),
    trailMainHex: rgbToHex(visual.trail),
    trailCoreHex: rgbToHex(mixWithWhite(visual.glow, 0.35)),
    shieldCrescentHex: rgbToHex(shadeRgb(visual.trail, 0.75)),
    shieldCrescentCenterHex: rgbToHex(visual.glow),
    shieldImpactHex: rgbToHex(mixWithWhite(visual.glow, 0.7)),
  };
}

function renderRibbonPass(
  ctx: CanvasRenderingContext2D,
  motes: StormweaveLifeMotes,
  moteIndex: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  headWidthWorld: number,
  color: string,
  alphaScale: number,
): void {
  const count = motes.getTrailPointCount(moteIndex);
  if (count < 2) return;
  ctx.fillStyle = color;
  for (let i = 0; i < count - 1; i++) {
    const previous = Math.max(0, i - 1);
    const next = Math.min(count - 1, i + 1);
    const afterNext = Math.min(count - 1, i + 2);
    // Never bridge a continuity break: if any sample this segment's
    // midpoint-smoothing touches started a new epoch, skip drawing rather
    // than connecting across a discontinuity.
    let hasBreak = false;
    for (let p = previous + 1; p <= afterNext; p++) {
      if (motes.isTrailPointBreak(moteIndex, p)) { hasBreak = true; break; }
    }
    if (hasBreak) continue;
    // Midpoints of adjacent history edges form a quadratic-smoothed centerline.
    const x0 = (motes.getTrailPointXWorld(moteIndex, previous) + motes.getTrailPointXWorld(moteIndex, next)) * 0.5;
    const y0 = (motes.getTrailPointYWorld(moteIndex, previous) + motes.getTrailPointYWorld(moteIndex, next)) * 0.5;
    const x1 = (motes.getTrailPointXWorld(moteIndex, i) + motes.getTrailPointXWorld(moteIndex, afterNext)) * 0.5;
    const y1 = (motes.getTrailPointYWorld(moteIndex, i) + motes.getTrailPointYWorld(moteIndex, afterNext)) * 0.5;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 0.0001) continue;
    const perpendicularX = -dy / length;
    const perpendicularY = dx / length;
    const remaining0 = Math.max(0, 1 - motes.getTrailPointAgeSec(moteIndex, i) / STORMWEAVE_TRAIL_LIFETIME_SEC);
    const remaining1 = Math.max(0, 1 - motes.getTrailPointAgeSec(moteIndex, i + 1) / STORMWEAVE_TRAIL_LIFETIME_SEC);
    const halfWidth0 = headWidthWorld * Math.pow(remaining0, 0.65) * scalePx * 0.5;
    const halfWidth1 = headWidthWorld * Math.pow(remaining1, 0.65) * scalePx * 0.5;
    ctx.globalAlpha = alphaScale * Math.pow((remaining0 + remaining1) * 0.5, 1.4);
    const px0 = x0 * scalePx + offsetXPx;
    const py0 = y0 * scalePx + offsetYPx;
    const px1 = x1 * scalePx + offsetXPx;
    const py1 = y1 * scalePx + offsetYPx;
    ctx.beginPath();
    ctx.moveTo(px0 + perpendicularX * halfWidth0, py0 + perpendicularY * halfWidth0);
    ctx.lineTo(px1 + perpendicularX * halfWidth1, py1 + perpendicularY * halfWidth1);
    ctx.lineTo(px1 - perpendicularX * halfWidth1, py1 - perpendicularY * halfWidth1);
    ctx.lineTo(px0 - perpendicularX * halfWidth0, py0 - perpendicularY * halfWidth0);
    ctx.closePath();
    ctx.fill();
  }
}

/** Pixel-snapped, allocation-light Canvas renderer for Stormweave life motes. */
export function renderStormweaveLifeMotes(
  ctx: CanvasRenderingContext2D,
  motes: StormweaveLifeMotes,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  shield: ShieldWeaveState,
  graphicsQuality: GraphicsQuality,
  selectedDustKind: number,
): void {
  ctx.save();
  const palette = buildStormweaveMotePalette(selectedDustKind);
  if (graphicsQuality === 'high') {
    const sizing = getStormweaveTrailSizing(motes.trailIntensity);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes.moteCount; i++) {
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.glowHeadWidth, palette.trailOuterHex, 0.13);
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.goldHeadWidth, palette.trailMainHex, 0.37);
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.coreHeadWidth, palette.trailCoreHex, 0.74);
    }
  }
  if (shield.isActive) {
    // The visible crescent grows as motes lock into their slots, not merely
    // from their existence following the player - it lags the gameplay arc
    // (which sizes/blocks immediately from the full mote count) until each
    // mote has actually settled into place.
    const visualArcLengthWorld = getEffectiveShieldArcLengthWorld(motes.lockedShieldMoteCount, shield.radiusWorld);
    const visualAngularSpanRad = shield.radiusWorld > 0 ? visualArcLengthWorld / shield.radiusWorld : 0;
    const visualIsFullCircle = visualAngularSpanRad >= Math.PI * 2 - FULL_CIRCLE_EPSILON;
    const samples = Math.max(2, Math.ceil(visualArcLengthWorld * scalePx * 0.75));
    const startAngle = visualIsFullCircle
      ? shield.directionAngleRad
      : shield.directionAngleRad - visualAngularSpanRad * 0.5;
    for (let i = 0; i <= samples; i++) {
      if (visualIsFullCircle && i === samples) break;
      const angle = startAngle + visualAngularSpanRad * (i / samples);
      const x = Math.round((shield.centerXWorld + Math.cos(angle) * shield.radiusWorld) * scalePx + offsetXPx);
      const y = Math.round((shield.centerYWorld + Math.sin(angle) * shield.radiusWorld) * scalePx + offsetYPx);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = palette.shieldCrescentHex;
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = palette.shieldCrescentCenterHex;
      ctx.fillRect(x, y, 1, 1);
    }
    if (shield.impactTicksLeft > 0) {
      const impactAlpha = shield.impactTicksLeft / 12;
      const x = Math.round(shield.impactXWorld * scalePx + offsetXPx);
      const y = Math.round(shield.impactYWorld * scalePx + offsetYPx);
      ctx.globalAlpha = impactAlpha;
      ctx.fillStyle = palette.shieldImpactHex;
      ctx.fillRect(x - 2, y, 5, 1);
      ctx.fillRect(x, y - 2, 1, 5);
    }
  }
  ctx.globalAlpha = 1;
  const sizing = getStormweaveTrailSizing(motes.trailIntensity);
  motes.forEachMote((xWorld, yWorld) => {
    const x = Math.round(xWorld * scalePx + offsetXPx);
    const y = Math.round(yWorld * scalePx + offsetYPx);
    if (graphicsQuality === 'high') {
      const radius = sizing.headGlowRadius * scalePx;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.07 + motes.trailIntensity * 0.06;
      ctx.fillStyle = palette.glowOuterHex;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.16 + motes.trailIntensity * 0.09;
      ctx.fillStyle = palette.glowInnerHex;
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.bodyHex;
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = palette.highlightHex;
    ctx.fillRect(x, y, 1, 1);
  });
  ctx.restore();
}
