/**
 * Render-only animation for the dialogue portrait named "Sprite".
 *
 * The supplied portrait image remains the static/loading fallback. Animation is
 * composited in a deliberately small buffer and nearest-neighbour upscaled so
 * the glow keeps a lightly pixelated, 8-bit texture.
 */

export const SPRITE_PORTRAIT_BUFFER_SIZE = 40;

export interface SpritePortraitOrb {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly hoverAmplitude: number;
  readonly periodMs: number;
  readonly phase: number;
}

export interface SpritePortraitOrbFrame {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly intensity: number;
}

export const SPRITE_PORTRAIT_ORBS: readonly SpritePortraitOrb[] = [
  { x: 20.0, y: 20.0, radius: 4.8, hoverAmplitude: 1.8, periodMs: 2400, phase: 0.2 },
  { x: 14.2, y: 17.0, radius: 2.8, hoverAmplitude: 2.5, periodMs: 3100, phase: 1.7 },
  { x: 25.8, y: 15.5, radius: 2.5, hoverAmplitude: 2.1, periodMs: 1900, phase: 3.1 },
  { x: 17.0, y: 26.5, radius: 2.2, hoverAmplitude: 2.8, periodMs: 3600, phase: 4.4 },
  { x: 24.0, y: 27.2, radius: 2.6, hoverAmplitude: 2.0, periodMs: 2750, phase: 0.9 },
  { x: 10.0, y: 23.5, radius: 1.7, hoverAmplitude: 3.2, periodMs: 4200, phase: 2.5 },
  { x: 30.5, y: 22.5, radius: 1.8, hoverAmplitude: 2.7, periodMs: 3350, phase: 5.2 },
  { x: 19.0, y: 10.0, radius: 1.6, hoverAmplitude: 2.3, periodMs: 2250, phase: 3.8 },
  { x: 27.5, y: 8.0, radius: 1.2, hoverAmplitude: 1.8, periodMs: 3850, phase: 1.1 },
  { x: 12.5, y: 31.5, radius: 1.4, hoverAmplitude: 2.4, periodMs: 2950, phase: 5.8 },
  { x: 29.5, y: 31.0, radius: 1.3, hoverAmplitude: 1.9, periodMs: 2050, phase: 2.0 },
  { x: 7.5, y: 14.0, radius: 1.0, hoverAmplitude: 2.0, periodMs: 3450, phase: 4.9 },
];

export function isAnimatedSpritePortrait(portraitId: string): boolean {
  return portraitId.toLocaleLowerCase() === 'sprite';
}

export function sampleSpritePortraitOrb(orb: SpritePortraitOrb, elapsedMs: number): SpritePortraitOrbFrame {
  const cycle = elapsedMs * Math.PI * 2 / orb.periodMs + orb.phase;
  return {
    x: orb.x,
    y: orb.y + Math.sin(cycle) * orb.hoverAmplitude,
    radius: orb.radius,
    intensity: 0.82 + Math.sin(cycle * 2 + orb.phase) * 0.18,
  };
}

export class SpritePortraitAnimation {
  private readonly _buffer: HTMLCanvasElement;
  private readonly _bufferCtx: CanvasRenderingContext2D;
  private _frameId: number | null = null;
  private _image: HTMLImageElement | null = null;
  private _startMs: number = 0;

  constructor(
    private readonly _canvas: HTMLCanvasElement,
    private readonly _ctx: CanvasRenderingContext2D,
  ) {
    this._buffer = document.createElement('canvas');
    this._buffer.width = SPRITE_PORTRAIT_BUFFER_SIZE;
    this._buffer.height = SPRITE_PORTRAIT_BUFFER_SIZE;
    const bufferCtx = this._buffer.getContext('2d');
    if (bufferCtx === null) throw new Error('Unable to create Sprite portrait buffer');
    this._bufferCtx = bufferCtx;
  }

  start(image: HTMLImageElement | null): void {
    this._image = image;
    if (this._frameId !== null) return;
    this._startMs = performance.now();
    this._drawFrame(this._startMs);
  }

  setImage(image: HTMLImageElement): void {
    this._image = image;
  }

  stop(): void {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  private readonly _drawFrame = (nowMs: number): void => {
    const ctx = this._bufferCtx;
    const size = SPRITE_PORTRAIT_BUFFER_SIZE;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#030200';
    ctx.fillRect(0, 0, size, size);

    const image = this._image;
    if (image !== null && image.complete && image.naturalWidth > 0) {
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.globalAlpha = 0.58;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = 'rgba(8, 4, 0, 0.18)';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';

    const elapsedMs = nowMs - this._startMs;
    for (const orb of SPRITE_PORTRAIT_ORBS) {
      const frame = sampleSpritePortraitOrb(orb, elapsedMs);
      const gradient = ctx.createRadialGradient(
        frame.x, frame.y, 0,
        frame.x, frame.y, frame.radius * 2.2,
      );
      gradient.addColorStop(0, `rgba(255, 248, 188, ${frame.intensity})`);
      gradient.addColorStop(0.22, `rgba(255, 192, 34, ${frame.intensity * 0.9})`);
      gradient.addColorStop(0.55, `rgba(224, 118, 0, ${frame.intensity * 0.34})`);
      gradient.addColorStop(1, 'rgba(100, 42, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(
        Math.floor(frame.x - frame.radius * 2.2),
        Math.floor(frame.y - frame.radius * 2.2),
        Math.ceil(frame.radius * 4.4),
        Math.ceil(frame.radius * 4.4),
      );
    }
    ctx.globalCompositeOperation = 'source-over';

    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    this._ctx.imageSmoothingEnabled = false;
    this._ctx.drawImage(this._buffer, 0, 0, this._canvas.width, this._canvas.height);
    this._frameId = requestAnimationFrame(this._drawFrame);
  };
}
