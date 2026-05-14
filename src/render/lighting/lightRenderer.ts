/**
 * lightRenderer.ts — Canvas 2D light renderers for each LightType.
 *
 * Each renderer draws onto an offscreen canvas (the "light accumulation buffer")
 * using the light's blend mode.  Shadow masks are pre-computed by the caller
 * (lightingSystem.ts) and passed in as a clipping path or visibility polygon.
 *
 * Performance rules:
 *   • No per-call heap allocation in the draw functions.
 *   • Gradient objects are created once and reused where possible.
 */

import type { LightDef } from './lightingTypes';
import type { VisibilityResult } from './visibilityPolygon';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

// Pixel minimum radius so even tiny lights are visible.
const MIN_RADIUS_PX = BLOCK_SIZE_MEDIUM * 0.5;

// ── Shadow mask helpers ───────────────────────────────────────────────────────

/**
 * Clips the canvas to the visibility polygon so subsequent draws are masked
 * by the shadow boundary.  Call `ctx.save()` before and `ctx.restore()` after.
 */
function clipToVisibility(
  ctx: CanvasRenderingContext2D,
  _ox: number, _oy: number,
  vis: VisibilityResult,
): void {
  ctx.beginPath();
  if (vis.pointCount === 0) {
    // No visibility — clip to nothing.
    ctx.rect(0, 0, 0, 0);
  } else {
    ctx.moveTo(vis.points[0], vis.points[1]);
    for (let i = 1; i < vis.pointCount; i++) {
      ctx.lineTo(vis.points[i * 2], vis.points[i * 2 + 1]);
    }
    ctx.closePath();
  }
  ctx.clip();
}

// ── Pulse helper ──────────────────────────────────────────────────────────────

function getPulseAlpha(light: LightDef, nowMs: number): number {
  if (!light.isPulsingFlag) return 1;
  const hz  = light.pulseSpeedHz  ?? 1;
  const amp = light.pulseAmplitude ?? 0.2;
  return 1 - amp * 0.5 * (1 + Math.sin(nowMs * 0.001 * Math.PI * 2 * hz));
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
}

// ── softGlow ──────────────────────────────────────────────────────────────────

/**
 * Draws a soft radial gradient glow — the most common light type.
 * Shadows optionally clip the gradient.
 */
export function drawSoftGlow(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  const ox = light.xWorld;
  const oy = light.yWorld;
  const radius = Math.max(light.radiusWorld, MIN_RADIUS_PX);
  const alpha  = (light.intensityPct / 100) * getPulseAlpha(light, nowMs);

  ctx.save();
  applyBlend(ctx, light);
  if (vis && light.castsShadowsFlag === 1) clipToVisibility(ctx, ox, oy, vis);

  const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
  grad.addColorStop(0,   rgba(light.colorR, light.colorG, light.colorB, alpha));
  grad.addColorStop(0.5, rgba(light.colorR, light.colorG, light.colorB, alpha * 0.4));
  grad.addColorStop(1,   rgba(light.colorR, light.colorG, light.colorB, 0));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── spotlight ─────────────────────────────────────────────────────────────────

/**
 * Draws a cone-shaped spotlight.  The cone is defined by `coneAngleRad` (half-
 * angle) and `rotationRad` (direction the cone centre points).
 */
export function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  const ox     = light.xWorld;
  const oy     = light.yWorld;
  const radius = Math.max(light.radiusWorld, MIN_RADIUS_PX);
  const half   = light.coneAngleRad ?? (Math.PI / 4);
  const dir    = light.rotationRad  ?? 0;
  const alpha  = (light.intensityPct / 100) * getPulseAlpha(light, nowMs);

  ctx.save();
  applyBlend(ctx, light);
  if (vis && light.castsShadowsFlag === 1) clipToVisibility(ctx, ox, oy, vis);

  // Clip to cone sector.
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.arc(ox, oy, radius, dir - half, dir + half);
  ctx.closePath();
  ctx.clip();

  const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
  grad.addColorStop(0,    rgba(light.colorR, light.colorG, light.colorB, alpha));
  grad.addColorStop(0.7,  rgba(light.colorR, light.colorG, light.colorB, alpha * 0.5));
  grad.addColorStop(1,    rgba(light.colorR, light.colorG, light.colorB, 0));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ox, oy, radius, dir - half, dir + half);
  ctx.lineTo(ox, oy);
  ctx.fill();
  ctx.restore();
}

// ── floodlight ────────────────────────────────────────────────────────────────

/**
 * Uniform-intensity area fill with a sharp-ish falloff — like an overhead lamp.
 */
export function drawFloodlight(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  const ox     = light.xWorld;
  const oy     = light.yWorld;
  const radius = Math.max(light.radiusWorld, MIN_RADIUS_PX);
  const alpha  = (light.intensityPct / 100) * getPulseAlpha(light, nowMs);

  ctx.save();
  applyBlend(ctx, light);
  if (vis && light.castsShadowsFlag === 1) clipToVisibility(ctx, ox, oy, vis);

  const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
  grad.addColorStop(0,    rgba(light.colorR, light.colorG, light.colorB, alpha));
  grad.addColorStop(0.75, rgba(light.colorR, light.colorG, light.colorB, alpha * 0.85));
  grad.addColorStop(1,    rgba(light.colorR, light.colorG, light.colorB, 0));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── backlight ─────────────────────────────────────────────────────────────────

/**
 * Cool-toned rim/backlight — creates atmospheric haze around the light origin.
 * Uses 'screen' blend mode by default and is much dimmer at the centre.
 */
export function drawBacklight(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  const ox     = light.xWorld;
  const oy     = light.yWorld;
  const radius = Math.max(light.radiusWorld, MIN_RADIUS_PX);
  const alpha  = (light.intensityPct / 100) * getPulseAlpha(light, nowMs);

  ctx.save();
  applyBlend(ctx, light);
  if (vis && light.castsShadowsFlag === 1) clipToVisibility(ctx, ox, oy, vis);

  const grad = ctx.createRadialGradient(ox, oy, radius * 0.2, ox, oy, radius);
  grad.addColorStop(0,   rgba(light.colorR, light.colorG, light.colorB, 0));
  grad.addColorStop(0.5, rgba(light.colorR, light.colorG, light.colorB, alpha * 0.6));
  grad.addColorStop(1,   rgba(light.colorR, light.colorG, light.colorB, 0));

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(ox, oy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── Blend mode helper ─────────────────────────────────────────────────────────

function applyBlend(ctx: CanvasRenderingContext2D, light: LightDef): void {
  switch (light.blendMode) {
    case 'screen':   ctx.globalCompositeOperation = 'screen';       break;
    case 'multiply': ctx.globalCompositeOperation = 'multiply';     break;
    case 'normal':   ctx.globalCompositeOperation = 'source-over';  break;
    default:         ctx.globalCompositeOperation = 'lighter';      break;  // 'add'
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

/** Dispatch a draw call for any light type. */
export function drawLight(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  switch (light.kind) {
    case 'softGlow':   drawSoftGlow(ctx, light, nowMs, vis);   break;
    case 'spotlight':  drawSpotlight(ctx, light, nowMs, vis);  break;
    case 'floodlight': drawFloodlight(ctx, light, nowMs, vis); break;
    case 'backlight':  drawBacklight(ctx, light, nowMs, vis);  break;
  }
}
