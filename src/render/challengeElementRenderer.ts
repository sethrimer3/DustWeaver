import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { ChallengeModeState } from '../sim/challengeMode';

function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - 4 * scale);
  ctx.lineTo(cx + 4 * scale, cy - 2 * scale);
  ctx.lineTo(cx + 3 * scale, cy + 3 * scale);
  ctx.lineTo(cx, cy + 5 * scale);
  ctx.lineTo(cx - 3 * scale, cy + 3 * scale);
  ctx.lineTo(cx - 4 * scale, cy - 2 * scale);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#2a1700';
  ctx.lineWidth = Math.max(1, scale);
  ctx.stroke();
}

export function renderChallengeFieldsAndGates(
  ctx: CanvasRenderingContext2D,
  state: ChallengeModeState,
  ox: number,
  oy: number,
  zoom: number,
  nowMs: number,
  playerXWorld: number,
  playerYWorld: number,
): void {
  ctx.save();
  for (const field of state.fields) {
    const x = field.xBlock * BLOCK_SIZE_MEDIUM * zoom + ox;
    const y = field.yBlock * BLOCK_SIZE_MEDIUM * zoom + oy;
    const w = field.wBlock * BLOCK_SIZE_MEDIUM * zoom;
    const h = field.hBlock * BLOCK_SIZE_MEDIUM * zoom;
    const color = field.visualState === 'active' ? '255,205,55' : field.visualState === 'cooldown' ? '110,110,118' : '154,65,255';
    ctx.fillStyle = `rgba(${color},0.22)`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(${color},0.8)`;
    ctx.lineWidth = Math.max(1, zoom);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (field.visualState !== 'cooldown') {
      const count = 8;
      for (let i = 0; i < count; i++) {
        const phase = nowMs * 0.0015 + i * 2.399 + field.uid * 0.17;
        const px = x + (0.12 + 0.76 * ((Math.sin(phase * 0.73) + 1) * 0.5)) * w;
        const py = y + (0.1 + 0.8 * ((Math.cos(phase) + 1) * 0.5)) * h;
        ctx.fillStyle = `rgba(${color},0.7)`;
        ctx.fillRect(Math.round(px), Math.round(py), Math.max(1, zoom), Math.max(1, zoom));
      }
    }
    if (field.visualState === 'active' && state.activationAgeTicks < 50) {
      const progress = Math.min(1, state.activationAgeTicks / 50);
      const startX = (field.xBlock + field.wBlock * 0.5) * BLOCK_SIZE_MEDIUM;
      const startY = (field.yBlock + field.hBlock * 0.5) * BLOCK_SIZE_MEDIUM;
      for (let i = 0; i < 12; i++) {
        const delayed = Math.max(0, Math.min(1, progress * 1.35 - i * 0.025));
        const bend = Math.sin(i * 2.17 + field.uid) * 14 * (1 - delayed);
        const px = startX + (playerXWorld - startX) * delayed + bend * Math.sin(delayed * Math.PI);
        const py = startY + (playerYWorld - startY) * delayed - bend * Math.cos(delayed * Math.PI);
        ctx.strokeStyle = `rgba(176,92,255,${0.55 * (1 - delayed)})`;
        ctx.lineWidth = Math.max(1, zoom);
        ctx.beginPath();
        ctx.moveTo((px - (playerXWorld - startX) * 0.04) * zoom + ox, (py - (playerYWorld - startY) * 0.04) * zoom + oy);
        ctx.lineTo(px * zoom + ox, py * zoom + oy);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

export function renderChallengeTotems(
  ctx: CanvasRenderingContext2D,
  state: ChallengeModeState,
  playerXWorld: number,
  playerYWorld: number,
  ox: number,
  oy: number,
  zoom: number,
  nowMs: number,
): void {
  ctx.save();
  for (const totem of state.totems) {
    const x = totem.xBlock * BLOCK_SIZE_MEDIUM * zoom + ox;
    const y = totem.yBlock * BLOCK_SIZE_MEDIUM * zoom + oy;
    const active = state.isActive && state.anchorType === 'totem' && state.anchorUid === totem.uid;
    ctx.shadowBlur = active ? 8 : 3;
    ctx.shadowColor = active ? '#ffd85a' : '#a13dff';
    ctx.fillStyle = active ? '#d9a92f' : '#6d2e9d';
    ctx.fillRect(x - 3 * zoom, y - 7 * zoom, 6 * zoom, 14 * zoom);
    drawShield(ctx, x, y - 2 * zoom, Math.max(0.45, zoom * 0.55), active ? '#ffd85a' : '#d39aff');
    if (active && state.activationAgeTicks < 50) {
      const progress = Math.min(1, state.activationAgeTicks / 50);
      for (let i = 0; i < 10; i++) {
        const delayed = Math.max(0, Math.min(1, progress * 1.4 - i * 0.03));
        const sx = totem.xBlock * BLOCK_SIZE_MEDIUM;
        const sy = totem.yBlock * BLOCK_SIZE_MEDIUM;
        const bend = Math.sin(i * 1.91 + totem.uid) * 12 * (1 - delayed);
        const px = sx + (playerXWorld - sx) * delayed + bend * Math.sin(delayed * Math.PI);
        const py = sy + (playerYWorld - sy) * delayed - bend * Math.cos(delayed * Math.PI);
        ctx.fillStyle = `rgba(192,105,255,${0.8 * (1 - delayed)})`;
        ctx.fillRect(Math.round(px * zoom + ox), Math.round(py * zoom + oy), Math.max(1, zoom), Math.max(1, zoom));
      }
    }
    const nearby = Math.hypot(playerXWorld - totem.xBlock * BLOCK_SIZE_MEDIUM, playerYWorld - totem.yBlock * BLOCK_SIZE_MEDIUM) <= 24;
    if (nearby) {
      ctx.shadowBlur = 0;
      ctx.font = `${Math.max(7, Math.round(8 * zoom))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('F', x, y - 12 * zoom + Math.sin(nowMs * 0.006));
    }
  }
  ctx.restore();
}

export function drawChallengeHudShield(ctx: CanvasRenderingContext2D, centerX: number, centerY: number): void {
  drawShield(ctx, Math.round(centerX), Math.round(centerY), 0.65, '#ffd85a');
}
