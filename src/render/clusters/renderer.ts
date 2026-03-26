import { WorldSnapshot } from '../snapshot';
import { DASH_RECHARGE_ANIM_TICKS } from '../../sim/clusters/dashConstants';

/**
 * Renders walls (level geometry) from the snapshot on the 2D canvas.
 * Walls are drawn before cluster indicators so clusters appear on top.
 */
export function renderWalls(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  const walls = snapshot.walls;
  if (walls.count === 0) return;

  ctx.save();
  for (let wi = 0; wi < walls.count; wi++) {
    const sx = walls.xWorld[wi] * scalePx + offsetXPx;
    const sy = walls.yWorld[wi] * scalePx + offsetYPx;
    const sw = walls.wWorld[wi] * scalePx;
    const sh = walls.hWorld[wi] * scalePx;

    // Fill
    ctx.fillStyle = '#1a2535';
    ctx.fillRect(sx, sy, sw, sh);

    // Inner highlight (top-left edges)
    ctx.fillStyle = 'rgba(80,120,180,0.18)';
    ctx.fillRect(sx, sy, sw, 2);
    ctx.fillRect(sx, sy, 2, sh);

    // Outer shadow (bottom-right edges)
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(sx, sy + sh - 2, sw, 2);
    ctx.fillRect(sx + sw - 2, sy, 2, sh);

    // Glow border
    ctx.strokeStyle = 'rgba(60,140,220,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
  }
  ctx.restore();
}

export function renderClusters(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  ctx.save();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;

    // ── Influence ring (faint, dashed) ─────────────────────────────────────
    const influenceRadiusPx = cluster.influenceRadiusWorld * scalePx;
    const isPlayer = cluster.isPlayerFlag === 1;
    ctx.beginPath();
    ctx.arc(screenX, screenY, influenceRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = isPlayer
      ? 'rgba(0,255,153,0.12)'
      : 'rgba(255,102,0,0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dash recharge golden ring animation ───────────────────────────────
    // When dashRechargeAnimTicks > 0 a golden ring swoops in from a large
    // radius, closes around the cluster indicator, then fades out.
    if (isPlayer && cluster.dashRechargeAnimTicks > 0) {
      const animProgress = 1.0 - cluster.dashRechargeAnimTicks / DASH_RECHARGE_ANIM_TICKS;
      // Ring starts at 3× the cluster indicator radius and closes to it
      const startRadiusPx = 60;
      const endRadiusPx   = 14;
      const ringRadiusPx  = startRadiusPx + (endRadiusPx - startRadiusPx) * animProgress;
      // Alpha: fade in fast, then out
      const alpha = animProgress < 0.6
        ? animProgress / 0.6
        : 1.0 - (animProgress - 0.6) / 0.4;
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringRadiusPx, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffd23c';  // rgb(255,210,60)
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // ── Dash cooldown arc (only when recharging) ──────────────────────────
    if (cluster.dashCooldownTicks > 0 && isPlayer) {
      const progress = 1.0 - cluster.dashCooldownTicks / cluster.maxDashCooldownTicks;
      ctx.beginPath();
      ctx.arc(screenX, screenY, 16, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,30,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Cluster indicator dot ─────────────────────────────────────────────
    const color = isPlayer ? '#00ff99' : '#ff6600';
    const radiusPx = 10;

    ctx.beginPath();
    ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ── Health bar ────────────────────────────────────────────────────────
    const barWidthPx = 40;
    const barHeightPx = 4;
    const barXPx = screenX - barWidthPx / 2;
    const barYPx = screenY - radiusPx - 8;
    const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;

    ctx.fillStyle = '#333';
    ctx.fillRect(barXPx, barYPx, barWidthPx, barHeightPx);
    ctx.fillStyle = isPlayer ? '#00ff99' : '#ff6600';
    ctx.fillRect(barXPx, barYPx, barWidthPx * healthRatio, barHeightPx);
  }

  ctx.restore();
}

