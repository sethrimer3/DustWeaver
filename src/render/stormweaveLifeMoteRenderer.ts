import type { StormweaveLifeMotes } from '../sim/stormweave/lifeMotes';

/** Pixel-snapped, allocation-light Canvas renderer for Stormweave life motes. */
export function renderStormweaveLifeMotes(
  ctx: CanvasRenderingContext2D,
  motes: StormweaveLifeMotes,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  ctx.save();
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
    ctx.fillStyle = 'rgba(92,54,8,0.72)';
    ctx.fillRect(x - 3, y - 3, 7, 7);
    ctx.fillStyle = 'rgba(226,151,28,0.5)';
    ctx.fillRect(x - 2, y - 2, 5, 5);
    ctx.fillStyle = '#ffd451';
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.fillStyle = '#fff7c2';
    ctx.fillRect(x, y, 1, 1);
  });
  ctx.restore();
}
