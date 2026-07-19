import {
  STORMWEAVE_TRAIL_LIFETIME_SEC,
  getStormweaveTrailSizing,
  type StormweaveLifeMotes,
} from '../sim/stormweave/lifeMotes';
import type { ShieldWeaveState } from '../sim/stormweave/shieldWeave';
import type { GraphicsQuality } from '../ui/renderSettings';

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
): void {
  ctx.save();
  if (graphicsQuality === 'high') {
    const sizing = getStormweaveTrailSizing(motes.trailIntensity);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < motes.moteCount; i++) {
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.glowHeadWidth, '#b75b08', 0.16);
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.goldHeadWidth, '#e9a521', 0.42);
      renderRibbonPass(ctx, motes, i, offsetXPx, offsetYPx, scalePx, sizing.coreHeadWidth, '#fff0a3', 0.82);
    }
  }
  if (shield.isActive) {
    const samples = Math.max(2, Math.ceil(shield.arcLengthWorld * scalePx * 0.75));
    const startAngle = shield.isFullCircle
      ? shield.directionAngleRad
      : shield.directionAngleRad - shield.angularSpanRad * 0.5;
    for (let i = 0; i <= samples; i++) {
      if (shield.isFullCircle && i === samples) break;
      const angle = startAngle + shield.angularSpanRad * (i / samples);
      const x = Math.round((shield.centerXWorld + Math.cos(angle) * shield.radiusWorld) * scalePx + offsetXPx);
      const y = Math.round((shield.centerYWorld + Math.sin(angle) * shield.radiusWorld) * scalePx + offsetYPx);
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = '#b87318';
      ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = '#ffe58a';
      ctx.fillRect(x, y, 1, 1);
    }
    if (shield.impactTicksLeft > 0) {
      const impactAlpha = shield.impactTicksLeft / 12;
      const x = Math.round(shield.impactXWorld * scalePx + offsetXPx);
      const y = Math.round(shield.impactYWorld * scalePx + offsetYPx);
      ctx.globalAlpha = impactAlpha;
      ctx.fillStyle = '#fffbd6';
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
      ctx.globalAlpha = 0.08 + motes.trailIntensity * 0.08;
      ctx.fillStyle = '#d77d12';
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.18 + motes.trailIntensity * 0.12;
      ctx.fillStyle = '#f2b632';
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd451';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(x, y, 1, 1);
  });
  ctx.restore();
}
