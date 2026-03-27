import { WorldSnapshot } from '../snapshot';
import { getParticleStyle } from './styles';
import { getKindShape, ParticleShape, ParticleKind } from '../../sim/particles/kinds';

// ---- Shape drawing helpers -----------------------------------------------

/**
 * Draws a filled polygon centered at (cx, cy) with the given vertex list.
 * Vertices are specified as [x0, y0, x1, y1, ...] relative offsets.
 */
function drawPolygon(ctx: CanvasRenderingContext2D, cx: number, cy: number, offsets: number[]): void {
  ctx.beginPath();
  ctx.moveTo(cx + offsets[0], cy + offsets[1]);
  for (let i = 2; i < offsets.length; i += 2) {
    ctx.lineTo(cx + offsets[i], cy + offsets[i + 1]);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws a particle at (cx, cy) using the correct shape for its `kind`.
 * `r` is the base radius/half-size in pixels.
 */
function drawParticleShape(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: number,
): void {
  const shape = getKindShape(kind);

  switch (shape) {
    case ParticleShape.Circle: {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case ParticleShape.Diamond: {
      drawPolygon(ctx, cx, cy, [
        0, -r,        // top
        r,  0,        // right
        0,  r,        // bottom
        -r, 0,        // left
      ]);
      break;
    }

    case ParticleShape.Square: {
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;
    }

    case ParticleShape.Triangle: {
      // Equilateral triangle pointing up
      drawPolygon(ctx, cx, cy, [
        0,      -r * 1.0,   // top vertex
        r,       r * 0.5,   // bottom-right
        -r,      r * 0.5,   // bottom-left
      ]);
      break;
    }

    case ParticleShape.Hexagon: {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6; // flat-top orientation
        const vx = cx + Math.cos(a) * r;
        const vy = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }

    case ParticleShape.Cross: {
      const arm = r * 0.4;
      ctx.fillRect(cx - r,   cy - arm, r * 2, arm * 2);
      ctx.fillRect(cx - arm, cy - r,   arm * 2, r * 2);
      break;
    }

    case ParticleShape.Star: {
      // 5-pointed star
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.4; // alternate outer/inner
        const vx = cx + Math.cos(a) * radius;
        const vy = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }

    case ParticleShape.Ring: {
      // Draw outer filled circle then cut inner hole using destination-out
      // or simply stroke a thick ring.
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, r * 0.4, 0, Math.PI * 2, true); // inner hole (CCW)
      ctx.fill('evenodd');
      break;
    }

    default: {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ---- Main renderer -------------------------------------------------------

/** Skip drawing particles whose computed alpha is below this threshold — avoids
 *  submitting nearly-invisible draw calls (saves Canvas 2D state overhead). */
const MIN_VISIBLE_ALPHA = 0.004;

export function renderParticles(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const { particles } = snapshot;
  const {
    particleCount, isAliveFlag,
    positionXWorld, positionYWorld,
    kindBuffer, ageTicks, lifetimeTicks,
    disturbanceFactor,
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
    const ageFade = 1.0 - normAge;

    // Decorative background dust (Fluid) is faintly visible at rest and
    // brightens when disturbed by nearby air movement.
    const alpha = kind === ParticleKind.Fluid
      ? disturbanceFactor[i] * ageFade * 0.75
      : ageFade;

    if (alpha <= MIN_VISIBLE_ALPHA) continue;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = style.colorHex;
    drawParticleShape(ctx, screenX, screenY, style.radiusPx, kind);
  }
  ctx.globalAlpha = 1.0;
}
