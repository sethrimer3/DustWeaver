import type { BloomConfig } from './bloomConfig';
import { resetCanvasPass } from '../canvasViewport';

export interface GlowStyle {
  enabled?: boolean;
  intensity?: number;
  color?: string;
}

export interface GlowSpriteParams {
  image: CanvasImageSource;
  x: number;
  y: number;
  width: number;
  height: number;
  glow?: GlowStyle;
}

export interface GlowCircleParams {
  x: number;
  y: number;
  radius: number;
  glow?: GlowStyle;
}

export class GlowPass {
  /** True if any glow was submitted since the last clear(). */
  hasGlow = false;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly config: BloomConfig,
  ) {}

  clear(widthPx: number, heightPx: number): void {
    this.hasGlow = false;
    resetCanvasPass(this.ctx, widthPx, heightPx, false);
  }

  drawSprite(params: GlowSpriteParams): void {
    const style = resolveGlowStyle(params.glow, this.config.threshold);
    if (style === null) return;

    this.hasGlow = true;
    const { x, y, width, height, image } = params;
    this.ctx.save();
    this.ctx.globalAlpha = style.intensity;
    this.ctx.drawImage(image, x, y, width, height);

    if (style.color !== undefined) {
      this.ctx.globalCompositeOperation = 'source-atop';
      this.ctx.fillStyle = style.color;
      this.ctx.fillRect(x, y, width, height);
    }

    this.ctx.restore();
  }

  drawCircle(params: GlowCircleParams): void {
    const style = resolveGlowStyle(params.glow, this.config.threshold);
    if (style === null) return;

    this.hasGlow = true;
    this.ctx.save();
    this.ctx.globalAlpha = style.intensity;
    this.ctx.fillStyle = style.color ?? '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(params.x, params.y, params.radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  /**
   * Draws a glow circle without requiring a GlowCircleParams object.
   * Avoids per-call object allocation in hot paths such as addDecorationBloom.
   *
   * @param intensity  Pre-computed glow intensity (0–1).  Skipped when ≤ threshold.
   * @param color      CSS colour string, or undefined for white.
   */
  drawCircleDirect(x: number, y: number, radius: number, intensity: number, color: string | undefined): void {
    if (intensity <= this.config.threshold) return;

    this.hasGlow = true;
    this.ctx.save();
    this.ctx.globalAlpha = intensity;
    this.ctx.fillStyle = color ?? '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }
}

function resolveGlowStyle(glow: GlowStyle | undefined, threshold: number): { intensity: number; color?: string } | null {
  if (glow?.enabled === false) return null;

  const intensity = Math.max(0, glow?.intensity ?? 1);
  if (intensity <= threshold) return null;

  return { intensity, color: glow?.color };
}
