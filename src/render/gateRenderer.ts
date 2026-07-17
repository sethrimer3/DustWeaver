import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { gateVisualOpacity, powderParticleCount, GATE_TRANSITION_DURATION_MS, type RuntimeGate } from '../sim/gates/gateState';

const COLORS = {
  enemy: '#d9aeb2', challenge: '#ead69a', heart: '#edbec8', speed: '#b6dce4',
} as const;

function drawSymbol(ctx: CanvasRenderingContext2D, gate: RuntimeGate, cx: number, cy: number, scale: number): void {
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.scale(scale, scale);
  ctx.strokeStyle = '#35383d';
  ctx.fillStyle = '#f5f1df';
  ctx.lineWidth = 1;
  if (gate.kind === 'enemy') {
    ctx.beginPath(); ctx.arc(0, -1, 4, Math.PI, 0); ctx.lineTo(3, 4); ctx.lineTo(-3, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#35383d'; ctx.fillRect(-2, 0, 1, 1); ctx.fillRect(1, 0, 1, 1);
  } else if (gate.kind === 'challenge') {
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(4, -3); ctx.lineTo(3, 3); ctx.lineTo(0, 5); ctx.lineTo(-3, 3); ctx.lineTo(-4, -3); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (gate.kind === 'heart') {
    ctx.beginPath(); ctx.moveTo(0, 5); ctx.bezierCurveTo(-8, 0, -5, -6, 0, -2); ctx.bezierCurveTo(5, -6, 8, 0, 0, 5); ctx.fill(); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(0, -4); ctx.lineTo(0, 0); ctx.lineTo(5, -3); ctx.lineTo(1, 5); ctx.lineTo(1, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

export function renderOpenGateRecesses(ctx: CanvasRenderingContext2D, gates: readonly RuntimeGate[], ox: number, oy: number, zoom: number): void {
  ctx.save();
  for (const gate of gates) {
    if (gate.openVisualMode !== 'darkRecessed' || gate.phase === 'closed') continue;
    const x = gate.xBlock * BLOCK_SIZE_MEDIUM * zoom + ox;
    const y = gate.yBlock * BLOCK_SIZE_MEDIUM * zoom + oy;
    const w = gate.wBlock * BLOCK_SIZE_MEDIUM * zoom;
    const h = gate.hBlock * BLOCK_SIZE_MEDIUM * zoom;
    ctx.fillStyle = '#25282d'; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(205,215,220,0.28)'; ctx.lineWidth = Math.max(1, zoom); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  ctx.restore();
}

export function renderGates(ctx: CanvasRenderingContext2D, gates: readonly RuntimeGate[], ox: number, oy: number, zoom: number, qualityScale = 1): void {
  ctx.save();
  for (const gate of gates) {
    const opacity = gateVisualOpacity(gate);
    const x = gate.xBlock * BLOCK_SIZE_MEDIUM * zoom + ox;
    const y = gate.yBlock * BLOCK_SIZE_MEDIUM * zoom + oy;
    const w = gate.wBlock * BLOCK_SIZE_MEDIUM * zoom;
    const h = gate.hBlock * BLOCK_SIZE_MEDIUM * zoom;
    if (opacity > 0 && gate.openVisualMode !== 'darkRecessed') {
      ctx.globalAlpha = opacity;
      ctx.fillStyle = COLORS[gate.kind]; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x, y, w, Math.max(1, zoom));
      ctx.strokeStyle = '#596068'; ctx.lineWidth = Math.max(1, zoom); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const symbolScale = Math.max(0.45, Math.min(1.5, Math.min(w, h) / 14));
      drawSymbol(ctx, gate, x + w * 0.5, y + h * 0.5, symbolScale);
      if (gate.kind === 'speed' && w >= 24 && h >= 18) {
        ctx.font = `${Math.max(6, Math.round(7 * zoom))}px monospace`; ctx.textAlign = 'center'; ctx.fillStyle = '#283038';
        ctx.fillText(String(Math.round(gate.requiredSpeed ?? 0)), x + w * 0.5, y + h - 3 * zoom);
      }
      ctx.globalAlpha = 1;
    }
    if (gate.openVisualMode === 'powder' && gate.phase === 'opening') {
      const count = powderParticleCount(gate, qualityScale);
      const t = Math.min(1, gate.transitionElapsedMs / GATE_TRANSITION_DURATION_MS);
      for (let i = 0; i < count; i++) {
        const seed = ((gate.uid * 1103515245 + i * 12345) >>> 0) / 0xffffffff;
        const px = x + ((i * 0.61803398875 + seed) % 1) * w + (seed - 0.5) * 12 * t;
        const py = y + ((i * 0.41421356237 + seed * 0.7) % 1) * h + t * t * 12 * zoom;
        ctx.globalAlpha = (1 - t) * (0.35 + seed * 0.5);
        ctx.fillStyle = COLORS[gate.kind]; ctx.fillRect(Math.round(px), Math.round(py), Math.max(1, zoom), Math.max(1, zoom));
      }
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}
