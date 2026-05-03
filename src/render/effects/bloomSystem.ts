import type { BloomConfig } from './bloomConfig';
import { GlowPass } from './glowPass';

/**
 * Owns reusable render targets for selective bloom and exposes a tiny API:
 *  - beginFrame(): clear emissive target
 *  - glowPass: draw only glow-enabled elements
 *  - compositeToDevice(): blur + composite bloom over final frame
 */
export class BloomSystem {
  readonly glowCanvas: HTMLCanvasElement;
  readonly glowCtx: CanvasRenderingContext2D;
  readonly glowPass: GlowPass;

  private readonly blurPingCanvas: HTMLCanvasElement;
  private readonly blurPingCtx: CanvasRenderingContext2D;
  private readonly blurPongCanvas: HTMLCanvasElement;
  private readonly blurPongCtx: CanvasRenderingContext2D;

  private widthPx = 1;
  private heightPx = 1;

  constructor(private readonly config: BloomConfig) {
    this.glowCanvas = document.createElement('canvas');
    const glowCtx = this.glowCanvas.getContext('2d');
    if (glowCtx === null) throw new Error('Failed to create bloom glow canvas context');
    this.glowCtx = glowCtx;

    this.blurPingCanvas = document.createElement('canvas');
    const blurPingCtx = this.blurPingCanvas.getContext('2d');
    if (blurPingCtx === null) throw new Error('Failed to create bloom blur ping context');
    this.blurPingCtx = blurPingCtx;

    this.blurPongCanvas = document.createElement('canvas');
    const blurPongCtx = this.blurPongCanvas.getContext('2d');
    if (blurPongCtx === null) throw new Error('Failed to create bloom blur pong context');
    this.blurPongCtx = blurPongCtx;

    this.glowPass = new GlowPass(this.glowCtx, config);
    this.resize(1, 1);
  }

  resize(widthPx: number, heightPx: number): void {
    this.widthPx = Math.max(1, widthPx);
    this.heightPx = Math.max(1, heightPx);

    this.glowCanvas.width = this.widthPx;
    this.glowCanvas.height = this.heightPx;

    const scaledWidthPx = Math.max(1, Math.round(this.widthPx * this.config.glowTargetScale));
    const scaledHeightPx = Math.max(1, Math.round(this.heightPx * this.config.glowTargetScale));

    this.blurPingCanvas.width = scaledWidthPx;
    this.blurPingCanvas.height = scaledHeightPx;
    this.blurPongCanvas.width = scaledWidthPx;
    this.blurPongCanvas.height = scaledHeightPx;

    this.glowCtx.imageSmoothingEnabled = false;
    this.blurPingCtx.imageSmoothingEnabled = true;
    this.blurPongCtx.imageSmoothingEnabled = true;
  }

  /** Update the quality-dependent bloom parameters without triggering a resize.
   *  Call this once per frame before beginFrame() to apply the current quality tier.
   *
   *  @param isEnabled    Whether the bloom pass runs at all.  When false,
   *                      beginFrame() and compositeToDevice() are no-ops.
   *  @param intensity    Additive-blend alpha for the composited bloom layer (0–1).
   *  @param blurRadiusPx CSS blur radius applied to the downscale canvas (px).
   */
  setQualityParams(isEnabled: boolean, intensity: number, blurRadiusPx: number): void {
    this.config.enabled      = isEnabled;
    this.config.intensity    = intensity;
    this.config.blurRadiusPx = blurRadiusPx;
  }

  beginFrame(): void {
    if (!this.config.enabled) return;
    this.glowPass.clear(this.widthPx, this.heightPx);
  }

  compositeToDevice(deviceCtx: CanvasRenderingContext2D, deviceWidthPx: number, deviceHeightPx: number): void {
    if (!this.config.enabled) return;

    const blurRadius = Math.max(0, this.config.blurRadiusPx);

    this.blurPingCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.blurPingCtx.clearRect(0, 0, this.blurPingCanvas.width, this.blurPingCanvas.height);
    this.blurPingCtx.drawImage(this.glowCanvas, 0, 0, this.blurPingCanvas.width, this.blurPingCanvas.height);

    if (blurRadius > 0) {
      this.blurPongCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.blurPongCtx.clearRect(0, 0, this.blurPongCanvas.width, this.blurPongCanvas.height);
      this.blurPongCtx.filter = `blur(${blurRadius}px)`;
      this.blurPongCtx.drawImage(this.blurPingCanvas, 0, 0);
      this.blurPongCtx.filter = 'none';
    } else {
      this.blurPongCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.blurPongCtx.clearRect(0, 0, this.blurPongCanvas.width, this.blurPongCanvas.height);
      this.blurPongCtx.drawImage(this.blurPingCanvas, 0, 0);
    }

    deviceCtx.save();
    deviceCtx.globalCompositeOperation = 'lighter';
    deviceCtx.globalAlpha = Math.max(0, this.config.intensity);
    deviceCtx.imageSmoothingEnabled = true;
    deviceCtx.drawImage(this.blurPongCanvas, 0, 0, deviceWidthPx, deviceHeightPx);
    deviceCtx.restore();
  }
}
