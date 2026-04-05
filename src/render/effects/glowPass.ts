import type { BloomConfig } from './bloomConfig';

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
  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly config: BloomConfig,
  ) {}

  clear(widthPx: number, heightPx: number): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, widthPx, heightPx);
  }

  drawSprite(params: GlowSpriteParams): void {
    const style = resolveGlowStyle(params.glow, this.config.threshold);
    if (style === null) return;

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

    this.ctx.save();
    this.ctx.globalAlpha = style.intensity;
    this.ctx.fillStyle = style.color ?? '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(params.x, params.y, params.radius, 0, Math.PI * 2);
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
