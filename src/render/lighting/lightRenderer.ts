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
const MIN_SUNRAY_LENGTH_WORLD = BLOCK_SIZE_MEDIUM * 2;
const MIN_SUNRAY_WIDTH_WORLD = BLOCK_SIZE_MEDIUM * 0.25;
const MAX_SUNRAY_STRANDS = 16;
const MAX_SUNRAY_DUST_MOTES = 96;

let _sunrayBufferCanvas: HTMLCanvasElement | null = null;
let _sunrayBufferCtx: CanvasRenderingContext2D | null = null;

function ensureSunrayBuffer(widthPx: number, heightPx: number): CanvasRenderingContext2D | null {
  if (_sunrayBufferCanvas === null) {
    _sunrayBufferCanvas = document.createElement('canvas');
  }
  if (_sunrayBufferCanvas.width !== widthPx || _sunrayBufferCanvas.height !== heightPx) {
    _sunrayBufferCanvas.width = widthPx;
    _sunrayBufferCanvas.height = heightPx;
    _sunrayBufferCtx = _sunrayBufferCanvas.getContext('2d');
  } else if (_sunrayBufferCtx === null) {
    _sunrayBufferCtx = _sunrayBufferCanvas.getContext('2d');
  }
  return _sunrayBufferCtx;
}

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

function hash01(seed: number): number {
  const v = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
  return v - Math.floor(v);
}

/**
 * Samples normalized sunray intensity at a world point.
 * Returns 0 outside the beam and 0..1 inside, with longitudinal and lateral fade.
 */
export function sampleSunrayIntensity(
  light: LightDef,
  xWorld: number,
  yWorld: number,
  nowMs: number,
): number {
  if (light.kind !== 'sunray') return 0;
  const angleRad = light.angleRad ?? light.rotationRad ?? 0;
  const lengthWorld = Math.max(light.lengthWorld ?? light.radiusWorld, MIN_SUNRAY_LENGTH_WORLD);
  const widthStartWorld = Math.max(light.widthStartWorld ?? (lengthWorld * 0.1), MIN_SUNRAY_WIDTH_WORLD);
  const widthEndWorld = Math.max(light.widthEndWorld ?? (lengthWorld * 0.35), widthStartWorld);

  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  const relX = xWorld - light.xWorld;
  const relY = yWorld - light.yWorld;

  const alongWorld = relX * dirX + relY * dirY;
  if (alongWorld < 0 || alongWorld > lengthWorld) return 0;
  const tAlong = alongWorld / lengthWorld;

  const perpX = -dirY;
  const perpY = dirX;
  const lateralWorld = Math.abs(relX * perpX + relY * perpY);
  const halfWidthWorld = (widthStartWorld + (widthEndWorld - widthStartWorld) * tAlong) * 0.5;
  if (halfWidthWorld <= 0 || lateralWorld > halfWidthWorld) return 0;

  const lateralNorm = lateralWorld / halfWidthWorld;
  const lateralFade = Math.max(0, 1 - lateralNorm * lateralNorm);

  const sourceFade = Math.max(0, 1 - tAlong * 0.9);
  const endFade = Math.max(0, 1 - Math.pow(tAlong, 2.2));
  const softness = Math.max(0, Math.min(1, light.softness ?? 0.85));
  const centerBoost = 0.35 + (1 - lateralNorm) * (0.65 + softness * 0.35);

  const noiseStrength = Math.max(0, Math.min(1, light.noiseStrength ?? 0));
  let noiseMul = 1;
  if (noiseStrength > 0) {
    const noisePhase = tAlong * 14 + lateralNorm * 9 + nowMs * 0.00035;
    noiseMul = 1 - noiseStrength * 0.5 + noiseStrength * (0.5 + 0.5 * Math.sin(noisePhase));
  }

  return Math.max(0, Math.min(1, lateralFade * sourceFade * endFade * centerBoost * noiseMul));
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

export function drawSunray(
  ctx: CanvasRenderingContext2D,
  light: LightDef,
  nowMs: number,
  vis: VisibilityResult | null,
): void {
  const bufferCtx = ensureSunrayBuffer((ctx.canvas as HTMLCanvasElement).width, (ctx.canvas as HTMLCanvasElement).height);
  const bufferCanvas = _sunrayBufferCanvas;
  if (bufferCtx === null || bufferCanvas === null) return;

  const angleRad = light.angleRad ?? light.rotationRad ?? 0;
  const lengthWorld = Math.max(light.lengthWorld ?? light.radiusWorld, MIN_SUNRAY_LENGTH_WORLD);
  const widthStartWorld = Math.max(light.widthStartWorld ?? (lengthWorld * 0.1), MIN_SUNRAY_WIDTH_WORLD);
  const widthEndWorld = Math.max(light.widthEndWorld ?? (lengthWorld * 0.35), widthStartWorld);
  const softness = Math.max(0, Math.min(1, light.softness ?? 0.85));
  const strandCount = Math.max(1, Math.min(MAX_SUNRAY_STRANDS, Math.round(light.strandCount ?? 6)));
  const opacity = Math.max(0, Math.min(1, light.opacity ?? 0.6));
  const intensity = Math.max(0, light.intensityPct / 100);
  const flickerStrength = Math.max(0, Math.min(1, light.flickerStrength ?? 0));
  const flickerPhase = nowMs * 0.0013 + light.xWorld * 0.003 + light.yWorld * 0.005;
  const flickerMul = 1 - flickerStrength * 0.5 + flickerStrength * (0.5 + 0.5 * Math.sin(flickerPhase));
  const baseAlpha = intensity * opacity * getPulseAlpha(light, nowMs) * flickerMul;
  if (baseAlpha <= 0.001) return;

  const dirX = Math.cos(angleRad);
  const dirY = Math.sin(angleRad);
  const perpX = -dirY;
  const perpY = dirX;
  const seedBase = light.xWorld * 0.173 + light.yWorld * 0.377 + angleRad * 1.231 + lengthWorld * 0.019;
  const spreadRad = Math.atan2(Math.max(widthEndWorld - widthStartWorld, 0), lengthWorld) * 0.6 + 0.05;

  bufferCtx.save();
  bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
  bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
  const transform = ctx.getTransform();
  bufferCtx.setTransform(transform);
  bufferCtx.globalCompositeOperation = 'lighter';
  bufferCtx.globalAlpha = 1;
  const blurPx = Math.max(0, softness * 9);
  bufferCtx.filter = blurPx > 0.1 ? `blur(${blurPx.toFixed(2)}px)` : 'none';

  for (let i = 0; i < strandCount; i++) {
    const s0 = hash01(seedBase + i * 11.17);
    const s1 = hash01(seedBase + i * 23.31);
    const s2 = hash01(seedBase + i * 41.73);
    const s3 = hash01(seedBase + i * 67.19);
    const s4 = hash01(seedBase + i * 89.53);
    const strandAngle = angleRad + (s0 - 0.5) * spreadRad;
    const strandDirX = Math.cos(strandAngle);
    const strandDirY = Math.sin(strandAngle);
    const strandPerpX = -strandDirY;
    const strandPerpY = strandDirX;
    const strandLength = lengthWorld * (0.72 + s1 * 0.36);
    const strandStartWidth = widthStartWorld * (0.65 + s2 * 0.7);
    const strandEndWidth = widthEndWorld * (0.45 + s3 * 0.9);
    const lateralShift = (s4 - 0.5) * widthStartWorld * 0.45;
    const sourceX = light.xWorld + perpX * lateralShift;
    const sourceY = light.yWorld + perpY * lateralShift;
    const endX = sourceX + strandDirX * strandLength;
    const endY = sourceY + strandDirY * strandLength;
    const sHalf = strandStartWidth * 0.5;
    const eHalf = strandEndWidth * 0.5;

    const grad = bufferCtx.createLinearGradient(sourceX, sourceY, endX, endY);
    const strandAlpha = baseAlpha * (0.12 + hash01(seedBase + i * 101.7) * 0.17);
    grad.addColorStop(0, rgba(light.colorR, light.colorG, light.colorB, strandAlpha));
    grad.addColorStop(0.35, rgba(light.colorR, light.colorG, light.colorB, strandAlpha * 0.5));
    grad.addColorStop(1, rgba(light.colorR, light.colorG, light.colorB, 0));
    bufferCtx.fillStyle = grad;

    bufferCtx.beginPath();
    bufferCtx.moveTo(sourceX + strandPerpX * sHalf, sourceY + strandPerpY * sHalf);
    bufferCtx.lineTo(sourceX - strandPerpX * sHalf, sourceY - strandPerpY * sHalf);
    bufferCtx.lineTo(endX - strandPerpX * eHalf, endY - strandPerpY * eHalf);
    bufferCtx.lineTo(endX + strandPerpX * eHalf, endY + strandPerpY * eHalf);
    bufferCtx.closePath();
    bufferCtx.fill();
  }

  if ((light.dustEnabledFlag ?? 1) === 1) {
    const density = Math.max(0, light.dustDensity ?? 1);
    const dustSpeed = Math.max(0.05, light.dustSpeed ?? 1);
    const dustSizeMinWorld = Math.max(0.15, light.dustSizeMinWorld ?? 0.35);
    const dustSizeMaxWorld = Math.max(dustSizeMinWorld, light.dustSizeMaxWorld ?? 1.2);
    const dustCount = Math.min(MAX_SUNRAY_DUST_MOTES, Math.max(0, Math.floor(density * lengthWorld * 0.42)));
    bufferCtx.filter = 'none';
    bufferCtx.globalCompositeOperation = 'screen';

    for (let i = 0; i < dustCount; i++) {
      const d0 = hash01(seedBase + 101 + i * 2.71);
      const d1 = hash01(seedBase + 211 + i * 3.53);
      const d2 = hash01(seedBase + 307 + i * 5.11);
      const d3 = hash01(seedBase + 401 + i * 7.13);
      const d4 = hash01(seedBase + 503 + i * 9.97);
      const d5 = hash01(seedBase + 601 + i * 13.37);
      const phase = nowMs * 0.001 * dustSpeed + d0 * Math.PI * 2;
      const along = Math.max(0, Math.min(1, d1 + Math.sin(phase * (0.25 + d2 * 0.4)) * 0.08));
      const widthAtAlong = widthStartWorld + (widthEndWorld - widthStartWorld) * along;
      const lateral = (d3 - 0.5) * widthAtAlong * 0.95 + Math.sin(phase * (0.7 + d4 * 0.9)) * widthAtAlong * 0.06;
      const xWorld = light.xWorld + dirX * (along * lengthWorld) + perpX * lateral;
      const yWorld = light.yWorld + dirY * (along * lengthWorld) + perpY * lateral;
      const intensityAtPoint = sampleSunrayIntensity(light, xWorld, yWorld, nowMs);
      if (intensityAtPoint <= 0.01) continue;
      const twinkle = 0.45 + 0.55 * Math.sin(phase * (0.9 + d5 * 1.1) + d4 * 6.283185307179586);
      const alpha = intensityAtPoint * (0.16 + d2 * 0.3) * twinkle;
      if (alpha <= 0.01) continue;
      const sizeWorld = dustSizeMinWorld + (dustSizeMaxWorld - dustSizeMinWorld) * d5;
      bufferCtx.fillStyle = rgba(light.colorR, light.colorG, light.colorB, alpha);
      if (sizeWorld < 0.5) {
        bufferCtx.fillRect(xWorld, yWorld, sizeWorld, sizeWorld);
      } else {
        bufferCtx.beginPath();
        bufferCtx.arc(xWorld, yWorld, sizeWorld * 0.5, 0, Math.PI * 2);
        bufferCtx.fill();
      }
    }
  }
  bufferCtx.restore();

  ctx.save();
  applyBlend(ctx, light);
  if (vis && light.castsShadowsFlag === 1) clipToVisibility(ctx, light.xWorld, light.yWorld, vis);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(bufferCanvas, 0, 0);
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
    case 'sunray':     drawSunray(ctx, light, nowMs, vis);     break;
  }
}
