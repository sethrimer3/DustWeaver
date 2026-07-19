import type { StormweaveLifeMotes } from '../sim/stormweave/lifeMotes';
import type { ShieldWeaveState } from '../sim/stormweave/shieldWeave';

/** Pixel-snapped, allocation-light Canvas renderer for Stormweave life motes. */
export function renderStormweaveLifeMotes(
  ctx: CanvasRenderingContext2D,
  motes: StormweaveLifeMotes,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  shield: ShieldWeaveState,
): void {
  ctx.save();
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
  motes.forEachTrail((xWorld, yWorld, lifeFraction, intensity) => {
    const x = Math.round(xWorld * scalePx + offsetXPx);
    const y = Math.round(yWorld * scalePx + offsetYPx);
    const alpha = lifeFraction * lifeFraction * intensity;
    ctx.globalAlpha = alpha * 0.48;
    ctx.fillStyle = '#e6a62c';
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillStyle = '#ffe58a';
    ctx.fillRect(x, y, 1, 1);
  });

  ctx.globalAlpha = 1;
  motes.forEachMote((xWorld, yWorld) => {
    const x = Math.round(xWorld * scalePx + offsetXPx);
    const y = Math.round(yWorld * scalePx + offsetYPx);
    ctx.fillStyle = '#ffd451';
    ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(x, y, 1, 1);
  });
  ctx.restore();
}
