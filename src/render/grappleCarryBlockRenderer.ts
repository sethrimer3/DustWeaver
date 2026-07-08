import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { isScreenRectVisible } from './viewportCull';

export function renderPhantasmalTiles(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
): void {
  for (let i = 0; i < world.phantasmalTileCount; i++) {
    const x = world.phantasmalTileXWorld[i] * zoom + ox;
    const y = world.phantasmalTileYWorld[i] * zoom + oy;
    const s = BLOCK_SIZE_MEDIUM * zoom;
    if (!isScreenRectVisible(x, y, s, s, vpW, vpH)) continue;
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#7b3fd6';
    ctx.fillRect(x, y, s, s);
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = '#d6b8ff';
    ctx.lineWidth = Math.max(1, zoom * 0.5);
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    ctx.globalAlpha = 0.38;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + s * 0.25, y + s * 0.2, s * 0.25, Math.max(1, zoom));
    ctx.restore();
  }
}

export function renderGrappleCarryBlocks(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
): void {
  const s = BLOCK_SIZE_MEDIUM * zoom;
  for (let i = 0; i < world.grappleCarryBlockCount; i++) {
    const x = (world.grappleCarryBlockXWorld[i] - BLOCK_SIZE_MEDIUM * 0.5) * zoom + ox;
    const y = (world.grappleCarryBlockYWorld[i] - BLOCK_SIZE_MEDIUM * 0.5) * zoom + oy;
    if (!isScreenRectVisible(x, y, s, s, vpW, vpH)) continue;
    ctx.fillStyle = '#6b4a1f';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = world.grappleCarryBlockGroundedFlag[i] === 1 ? '#f4c76d' : '#d59a43';
    ctx.lineWidth = Math.max(1, zoom * 0.75);
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    ctx.fillStyle = 'rgba(255,230,160,0.35)';
    ctx.fillRect(x + s * 0.2, y + s * 0.2, s * 0.2, s * 0.2);
  }
}
