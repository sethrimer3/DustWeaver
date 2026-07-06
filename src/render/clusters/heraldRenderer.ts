import type { ClusterSnapshot } from '../snapshot';
import type { WorldSnapshot } from '../snapshotTypes';
import {
  PHANTASMAL_BLOCK_FORM_TICKS,
  PHANTASMAL_BLOCK_LIFETIME_TICKS,
  PHANTASMAL_BLOCK_SIZE_WORLD,
  PHANTASMAL_SHOCKWAVE_RADIUS_WORLD,
  PHANTASMAL_SHOCKWAVE_TICKS,
  PHANTASMAL_SPIKE_ACTIVE_TICKS,
  PHANTASMAL_SPIKE_FADE_TICKS,
  PHANTASMAL_SPIKE_LENGTH_WORLD,
  PHANTASMAL_SPIKE_TELEGRAPH_TICKS,
  PHANTASMAL_SPIKE_WIDTH_WORLD,
  VOID_SPHERE_DISTORTION_RADIUS_WORLD,
  VOID_SPHERE_RADIUS_WORLD,
} from '../../sim/clusters/heraldConfig';

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

function spikePolygon(
  x: number,
  y: number,
  dir: number,
  length: number,
  width: number,
): [number, number, number, number, number, number] {
  const half = width * 0.5;
  if (dir === 0) return [x, y - length * 0.5, x - half, y + length * 0.5, x + half, y + length * 0.5];
  if (dir === 1) return [x, y + length * 0.5, x - half, y - length * 0.5, x + half, y - length * 0.5];
  if (dir === 2) return [x - length * 0.5, y, x + length * 0.5, y - half, x + length * 0.5, y + half];
  return [x + length * 0.5, y, x - length * 0.5, y - half, x - length * 0.5, y + half];
}

export function renderPhantasmalGeometry(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  ctx.save();
  ctx.lineJoin = 'round';

  for (let i = 0; i < snapshot.phantasmalSpikeAliveFlag.length; i++) {
    if (snapshot.phantasmalSpikeAliveFlag[i] === 0) continue;
    const age = snapshot.phantasmalSpikeAgeTicks[i];
    const x = snapshot.phantasmalSpikeXWorld[i] * scalePx + offsetXPx;
    const y = snapshot.phantasmalSpikeYWorld[i] * scalePx + offsetYPx;
    const length = PHANTASMAL_SPIKE_LENGTH_WORLD * scalePx;
    const width = PHANTASMAL_SPIKE_WIDTH_WORLD * scalePx;
    const dir = snapshot.phantasmalSpikeDirection[i];
    const pulse = 0.75 + Math.sin((snapshot.tick + i * 7) * 0.18) * 0.25;

    if (age < PHANTASMAL_SPIKE_TELEGRAPH_TICKS) {
      const alpha = Math.min(1, age / PHANTASMAL_SPIKE_TELEGRAPH_TICKS) * (0.35 + pulse * 0.25);
      const p = spikePolygon(x, y, dir, length * 0.75, width * 1.15);
      ctx.strokeStyle = `rgba(218, 99, 255, ${alpha})`;
      ctx.shadowColor = 'rgba(190, 70, 255, 0.7)';
      ctx.shadowBlur = 8 * scalePx;
      ctx.lineWidth = Math.max(1, scalePx);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.lineTo(p[4], p[5]);
      ctx.closePath();
      ctx.stroke();
      continue;
    }

    const activeEnd = PHANTASMAL_SPIKE_TELEGRAPH_TICKS + PHANTASMAL_SPIKE_ACTIVE_TICKS;
    const fade = age >= activeEnd ? 1 - Math.min(1, (age - activeEnd) / PHANTASMAL_SPIKE_FADE_TICKS) : 1;
    const p = spikePolygon(x, y, dir, length * (0.92 + pulse * 0.08), width);
    ctx.shadowColor = 'rgba(189, 64, 255, 0.85)';
    ctx.shadowBlur = 10 * scalePx;
    ctx.fillStyle = `rgba(142, 58, 214, ${0.34 * fade})`;
    ctx.strokeStyle = `rgba(240, 154, 255, ${0.82 * fade})`;
    ctx.lineWidth = Math.max(1, scalePx);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.lineTo((p[0] + p[2]) * 0.52, (p[1] + p[3]) * 0.52);
    ctx.lineTo(p[4], p[5]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  for (let i = 0; i < snapshot.phantasmalBlockAliveFlag.length; i++) {
    if (snapshot.phantasmalBlockAliveFlag[i] === 0) continue;
    const age = snapshot.phantasmalBlockAgeTicks[i];
    const x = snapshot.phantasmalBlockXWorld[i] * scalePx + offsetXPx;
    const y = snapshot.phantasmalBlockYWorld[i] * scalePx + offsetYPx;
    const form = Math.min(1, age / PHANTASMAL_BLOCK_FORM_TICKS);
    const fade = age > PHANTASMAL_BLOCK_LIFETIME_TICKS - 24 ? Math.max(0, (PHANTASMAL_BLOCK_LIFETIME_TICKS - age) / 24) : 1;
    const flash = snapshot.phantasmalBlockFlashTicks[i] > 0 ? 1 : 0;
    const half = PHANTASMAL_BLOCK_SIZE_WORLD * 0.5 * scalePx * (0.72 + form * 0.28);
    const pulse = Math.sin((snapshot.tick + i * 11) * 0.13) * 0.08;
    ctx.shadowColor = flash > 0 ? 'rgba(255, 220, 255, 0.95)' : 'rgba(178, 66, 255, 0.75)';
    ctx.shadowBlur = (flash > 0 ? 16 : 10) * scalePx;
    ctx.fillStyle = `rgba(128, 50, 220, ${(0.28 + flash * 0.22) * fade})`;
    ctx.strokeStyle = `rgba(238, 160, 255, ${(0.74 + flash * 0.2) * fade})`;
    ctx.lineWidth = Math.max(1, scalePx);
    ctx.beginPath();
    ctx.rect(x - half, y - half, half * 2, half * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 210, 255, ${0.42 * fade})`;
    ctx.beginPath();
    ctx.moveTo(x - half * 0.62, y + half * pulse);
    ctx.lineTo(x + half * 0.62, y - half * pulse);
    ctx.moveTo(x + half * pulse, y - half * 0.62);
    ctx.lineTo(x - half * pulse, y + half * 0.62);
    ctx.stroke();
  }

  for (let i = 0; i < snapshot.phantasmalShockwaveAliveFlag.length; i++) {
    if (snapshot.phantasmalShockwaveAliveFlag[i] === 0) continue;
    const age = snapshot.phantasmalShockwaveAgeTicks[i];
    const t = Math.min(1, age / PHANTASMAL_SHOCKWAVE_TICKS);
    const x = snapshot.phantasmalShockwaveXWorld[i] * scalePx + offsetXPx;
    const y = snapshot.phantasmalShockwaveYWorld[i] * scalePx + offsetYPx;
    const r = PHANTASMAL_SHOCKWAVE_RADIUS_WORLD * scalePx * t;
    ctx.shadowColor = 'rgba(190, 70, 255, 0.8)';
    ctx.shadowBlur = 12 * scalePx;
    ctx.strokeStyle = `rgba(225, 120, 255, ${0.85 * (1 - t)})`;
    ctx.lineWidth = Math.max(1, 2 * scalePx * (1 - t * 0.4));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
