import { WorldSnapshot } from '../snapshot';
import { getParticleStyle } from './styles';

export function renderParticles(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const { particles } = snapshot;
  const {
    particleCount, isAliveFlag,
    positionXWorld, positionYWorld,
    kindBuffer, ageTicks, lifetimeTicks,
  } = particles;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const kind  = kindBuffer[i];
    const style = getParticleStyle(kind);

    const screenX = positionXWorld[i] * scalePx + offsetXPx;
    const screenY = positionYWorld[i] * scalePx + offsetYPx;

    // Alpha fades out as the particle approaches end of life
    const lt      = lifetimeTicks[i];
    const normAge = lt > 0 ? Math.min(1.0, ageTicks[i] / lt) : 0.0;
    const alpha   = 1.0 - normAge;

    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(screenX, screenY, style.radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = style.colorHex;
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}
