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

    const isPlayer = cluster.isPlayerFlag === 1;

    // ── Box dimensions ─────────────────────────────────────────────────────
    const boxHalfW = cluster.halfWidthWorld * scalePx;
    const boxHalfH = cluster.halfHeightWorld * scalePx;
    const boxLeft  = screenX - boxHalfW;
    const boxTop   = screenY - boxHalfH;
    const boxW     = boxHalfW * 2;
    const boxH     = boxHalfH * 2;

    // ── Influence ring (faint, dashed) ─────────────────────────────────────
    const influenceRadiusPx = cluster.influenceRadiusWorld * scalePx;
    ctx.beginPath();
    ctx.arc(screenX, screenY, influenceRadiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = isPlayer
      ? 'rgba(0,255,153,0.10)'
      : 'rgba(255,102,0,0.08)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Dash recharge golden ring animation ───────────────────────────────
    if (isPlayer && cluster.dashRechargeAnimTicks > 0) {
      const animProgress = 1.0 - cluster.dashRechargeAnimTicks / DASH_RECHARGE_ANIM_TICKS;
      const startDistancePx = 60;
      const endDistancePx   = boxHalfW;
      const ringRadiusPx    = startDistancePx + (endDistancePx - startDistancePx) * animProgress;
      const alpha = animProgress < 0.6
        ? animProgress / 0.6
        : 1.0 - (animProgress - 0.6) / 0.4;
      ctx.beginPath();
      ctx.arc(screenX, screenY, ringRadiusPx, 0, Math.PI * 2);
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = '#ffd23c';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    // ── Dash cooldown arc (only when recharging) ──────────────────────────
    if (cluster.dashCooldownTicks > 0 && isPlayer) {
      const progress = 1.0 - cluster.dashCooldownTicks / cluster.maxDashCooldownTicks;
      ctx.beginPath();
      ctx.arc(screenX, screenY, boxHalfW + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,180,30,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // ── Cluster box body ──────────────────────────────────────────────────
    const bodyColor = isPlayer ? '#00ff99' : '#ff6600';

    // Filled box
    ctx.fillStyle = bodyColor;
    ctx.globalAlpha = 0.75;
    ctx.fillRect(boxLeft, boxTop, boxW, boxH);
    ctx.globalAlpha = 1.0;

    // Box border
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxLeft, boxTop, boxW, boxH);

    // Inner highlight on top edge
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(boxLeft + 2, boxTop + 2, boxW - 4, 3);

    // ── Health bar (above the box) ────────────────────────────────────────
    const barWidthPx  = boxW;
    const barHeightPx = 4;
    const barXPx      = boxLeft;
    const barYPx      = boxTop - barHeightPx - 4;
    const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;

    ctx.fillStyle = '#333';
    ctx.fillRect(barXPx, barYPx, barWidthPx, barHeightPx);
    ctx.fillStyle = isPlayer ? '#00ff99' : '#ff6600';
    ctx.fillRect(barXPx, barYPx, barWidthPx * healthRatio, barHeightPx);
  }

  ctx.restore();
}

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number): void {
  if (snapshot.isGrappleActiveFlag === 0 && snapshot.grappleAttachFxTicks <= 0) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined && snapshot.grappleAttachFxTicks <= 0) return;

  const px = playerCluster !== undefined ? playerCluster.positionXWorld * scalePx + offsetXPx : 0;
  const py = playerCluster !== undefined ? playerCluster.positionYWorld * scalePx + offsetYPx : 0;
  const ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  const ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;

  ctx.save();

  if (snapshot.isGrappleActiveFlag === 1 && playerCluster !== undefined) {
    // Faint guide glow only — the "rope" itself is represented by gold particles.
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.08)';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([1, 10]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Anchor point circle ───────────────────────────────────────────────────
  ctx.beginPath();
  ctx.arc(ax, ay, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (snapshot.grappleAttachFxTicks > 0) {
    const fxProgress = 1.0 - snapshot.grappleAttachFxTicks / 14.0;
    const fxRadius = 6 + fxProgress * 24;
    const fxAlpha = 0.4 * (1.0 - fxProgress);
    ctx.beginPath();
    ctx.arc(
      snapshot.grappleAttachFxXWorld * scalePx + offsetXPx,
      snapshot.grappleAttachFxYWorld * scalePx + offsetYPx,
      fxRadius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255, 236, 170, ${fxAlpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}
