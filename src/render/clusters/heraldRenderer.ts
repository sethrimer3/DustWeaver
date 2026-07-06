import type { ClusterSnapshot } from '../snapshot';
import type { WorldSnapshot } from '../snapshotTypes';
import { VOID_SPHERE_DISTORTION_RADIUS_WORLD, VOID_SPHERE_RADIUS_WORLD } from '../../sim/clusters/heraldConfig';

/**
 * Placeholder Herald silhouette — dark hooded-robe body with a purple/black
 * aura, drawn until a final art pipeline exists.
 */
export function renderHeraldBody(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const halfW = cluster.halfWidthWorld * scalePx;
  const halfH = cluster.halfHeightWorld * scalePx;

  // Aura — soft purple halo behind the robe.
  const auraRadius = Math.max(halfW, halfH) * 1.6;
  const auraGradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, auraRadius);
  auraGradient.addColorStop(0, 'rgba(130, 60, 220, 0.35)');
  auraGradient.addColorStop(1, 'rgba(130, 60, 220, 0)');
  ctx.fillStyle = auraGradient;
  ctx.beginPath();
  ctx.arc(screenX, screenY, auraRadius, 0, Math.PI * 2);
  ctx.fill();

  // Robe silhouette — tapered dark trapezoid body.
  ctx.fillStyle = '#141017';
  ctx.beginPath();
  ctx.moveTo(screenX - halfW * 0.55, screenY - halfH);
  ctx.lineTo(screenX + halfW * 0.55, screenY - halfH);
  ctx.lineTo(screenX + halfW, screenY + halfH);
  ctx.lineTo(screenX - halfW, screenY + halfH);
  ctx.closePath();
  ctx.fill();

  // Hood — dark circle at the top with a faint void-purple rim.
  const hoodRadius = halfW * 0.6;
  const hoodY = screenY - halfH * 0.9;
  ctx.fillStyle = '#0b0710';
  ctx.beginPath();
  ctx.arc(screenX, hoodY, hoodRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(170, 100, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Staff — thin vertical line with a glowing tip.
  const staffX = screenX + halfW * 0.9;
  const staffTopY = screenY - halfH * 1.1;
  const staffBottomY = screenY + halfH * 0.9;
  ctx.strokeStyle = '#2a2030';
  ctx.lineWidth = Math.max(1, Math.round(scalePx * 0.4));
  ctx.beginPath();
  ctx.moveTo(staffX, staffTopY);
  ctx.lineTo(staffX, staffBottomY);
  ctx.stroke();
  ctx.fillStyle = '#b366ff';
  ctx.beginPath();
  ctx.arc(staffX, staffTopY, Math.max(1, scalePx * 0.5), 0, Math.PI * 2);
  ctx.fill();
}

/** Screen-space circle describing one Void Sphere, used by the lensing distortion pass. */
export interface VoidSphereScreenCircle {
  xPx: number;
  yPx: number;
  sphereRadiusPx: number;
  distortionRadiusPx: number;
}

/** Collects screen-space circles for every alive Void Sphere (capped by MAX_VOID_SPHERES). */
export function collectVoidSphereScreenCircles(
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): VoidSphereScreenCircle[] {
  const circles: VoidSphereScreenCircle[] = [];
  for (let i = 0; i < snapshot.voidSphereAliveFlag.length; i++) {
    if (snapshot.voidSphereAliveFlag[i] === 0) continue;
    circles.push({
      xPx: snapshot.voidSphereXWorld[i] * scalePx + offsetXPx,
      yPx: snapshot.voidSphereYWorld[i] * scalePx + offsetYPx,
      sphereRadiusPx: VOID_SPHERE_RADIUS_WORLD * scalePx,
      distortionRadiusPx: VOID_SPHERE_DISTORTION_RADIUS_WORLD * scalePx,
    });
  }
  return circles;
}

/**
 * Draws every alive Void Sphere: dark center, purple/black rim, gentle pulse.
 * Called both in the normal entity pass and again (crisp, on top) right after
 * the lensing distortion pass so the sphere itself never looks smeared.
 */
export function renderVoidSpheres(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  const radiusPx = VOID_SPHERE_RADIUS_WORLD * scalePx;
  for (let i = 0; i < snapshot.voidSphereAliveFlag.length; i++) {
    if (snapshot.voidSphereAliveFlag[i] === 0) continue;
    const x = snapshot.voidSphereXWorld[i] * scalePx + offsetXPx;
    const y = snapshot.voidSphereYWorld[i] * scalePx + offsetYPx;
    const pulse = 0.85 + Math.sin(snapshot.voidSpherePulsePhaseRad[i]) * 0.15;
    const r = radiusPx * pulse;

    // Outer rim — purple/black gradient aura.
    const rimGradient = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 1.4);
    rimGradient.addColorStop(0, 'rgba(70, 20, 120, 0.9)');
    rimGradient.addColorStop(0.7, 'rgba(120, 40, 200, 0.55)');
    rimGradient.addColorStop(1, 'rgba(120, 40, 200, 0)');
    ctx.fillStyle = rimGradient;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.4, 0, Math.PI * 2);
    ctx.fill();

    // Dark center core.
    ctx.fillStyle = '#050208';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(190, 130, 255, 0.85)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }
}
