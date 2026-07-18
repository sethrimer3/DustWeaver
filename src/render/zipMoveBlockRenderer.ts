import type { WorldState } from '../sim/world';
import type { ZipMoveBlockSide } from '../sim/zipMoveBlocks/zipMoveBlockTypes';

function drawTriangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, side: ZipMoveBlockSide): void {
  ctx.save();
  ctx.translate(x, y);
  const angle = side === 'right' ? Math.PI / 2 : side === 'bottom' ? Math.PI : side === 'left' ? -Math.PI / 2 : 0;
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.75, size * 0.65);
  ctx.lineTo(-size * 0.75, size * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
export function renderZipMoveBlocks(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  effectsEnabled: boolean,
): void {
  for (const block of world.zipMoveBlocks) {
    const x = block.xWorld * zoom + offsetXPx;
    const y = block.yWorld * zoom + offsetYPx;
    const w = block.wWorld * zoom;
    const h = block.hWorld * zoom;
    const edge = block.variant === 'toward' ? '#63eaff' : '#ff75d8';
    ctx.save();
    if (effectsEnabled) { ctx.shadowColor = edge; ctx.shadowBlur = Math.min(12, 3 + block.activeAmount * 8); }
    ctx.fillStyle = 'rgba(15,20,29,0.96)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = edge;
    ctx.globalAlpha = 0.72 + block.activeAmount * 0.28;
    ctx.lineWidth = Math.max(1, zoom);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.shadowBlur = 0;
    const size = Math.max(2, Math.min(w, h) * 0.11);
    const insetX = Math.max(size * 1.25, w * 0.23);
    const insetY = Math.max(size * 1.25, h * 0.23);
    const dormant = 'rgba(175,205,220,0.72)';
    const sides: ZipMoveBlockSide[] = ['top', 'right', 'bottom', 'left'];
    for (const side of sides) {
      const active = block.activationSide === side ? block.activeAmount : 0;
      ctx.fillStyle = active > 0.01 ? edge : dormant;
      if (effectsEnabled && active > 0.01) { ctx.shadowColor = edge; ctx.shadowBlur = 4 + active * 9; }
      const px = side === 'left' ? x + insetX : side === 'right' ? x + w - insetX : x + w / 2;
      const py = side === 'top' ? y + insetY : side === 'bottom' ? y + h - insetY : y + h / 2;
      const orientation = block.variant === 'toward' ? side
        : side === 'top' ? 'bottom' : side === 'right' ? 'left' : side === 'bottom' ? 'top' : 'right';
      drawTriangle(ctx, px, py, size, orientation);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}
