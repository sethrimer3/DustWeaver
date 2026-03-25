export interface HudState {
  fps: number;
  frameTimeMs: number;
  particleCount: number;
}

export function renderHudOverlay(ctx: CanvasRenderingContext2D, hud: HudState): void {
  const lines = [
    `FPS: ${hud.fps.toFixed(1)}`,
    `Frame: ${hud.frameTimeMs.toFixed(2)}ms`,
    `Particles: ${hud.particleCount}`,
  ];

  const padXPx = 8;
  const padYPx = 8;
  const lineHeightPx = 16;
  const fontSizePx = 12;

  ctx.save();
  ctx.font = `${fontSizePx}px monospace`;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(padXPx - 4, padYPx - 4, 140, lines.length * lineHeightPx + 8);

  ctx.fillStyle = '#00ff99';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], padXPx, padYPx + fontSizePx + i * lineHeightPx);
  }
  ctx.restore();
}
