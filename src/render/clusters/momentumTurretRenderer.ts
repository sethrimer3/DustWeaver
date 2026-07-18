import type { ClusterSnapshot } from '../clusterSnapshotTypes';
import { MT_FIRE_GRACE_TICKS, MT_MAX_RING_RADIUS_WORLD, MT_MUZZLE_OFFSET_WORLD, MT_SHOT_FLASH_TICKS } from '../../sim/clusters/momentumTurretConfig';
import { momentumTurretFacingVector } from '../../sim/clusters/momentumTurretAi';

export function renderMomentumTurret(
  ctx: CanvasRenderingContext2D, turret: ClusterSnapshot, player: ClusterSnapshot | undefined,
  scale: number, ox: number, oy: number, tick: number,
): void {
  if (!player) return;
  const x = turret.positionXWorld * scale + ox;
  const y = turret.positionYWorld * scale + oy;
  const [fx, fy] = momentumTurretFacingVector(turret.momentumTurretFacingIndex);
  const mx = (turret.positionXWorld + fx * MT_MUZZLE_OFFSET_WORLD) * scale + ox;
  const my = (turret.positionYWorld + fy * MT_MUZZLE_OFFSET_WORLD) * scale + oy;
  const px = player.positionXWorld * scale + ox;
  const py = player.positionYWorld * scale + oy;
  const radius = turret.momentumTurretTargetRadiusWorld * scale;
  const danger = 1 - turret.momentumTurretTargetRadiusWorld / MT_MAX_RING_RADIUS_WORLD;
  const warning = turret.momentumTurretFireGraceTicks > 0;
  const flash = turret.momentumTurretShotFlashTicks > 0;
  const visible = turret.momentumTurretHasLineOfSightFlag === 1;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = turret.momentumTurretCooldownTicks > 0 ? 0.55 : 1;
  ctx.translate(x, y);
  ctx.rotate(turret.momentumTurretFacingIndex * Math.PI / 2);
  ctx.fillStyle = '#262832'; ctx.fillRect(-4 * scale, -4 * scale, 5 * scale, 8 * scale);
  ctx.fillStyle = '#555966'; ctx.fillRect(-2 * scale, -2 * scale, 7 * scale, 4 * scale);
  ctx.fillStyle = warning && ((tick & 2) === 0) ? '#fff3b0' : '#ff4b20';
  ctx.fillRect(1 * scale, -1 * scale, 2 * scale, 2 * scale);
  ctx.restore();
  if (!visible && turret.momentumTurretTargetRadiusWorld >= MT_MAX_RING_RADIUS_WORLD) return;
  ctx.save();
  ctx.globalAlpha = visible ? 1 : 0.25;
  const color = danger > 0.75 ? '#ff3020' : danger > 0.35 ? '#ff8626' : '#c89442';
  ctx.strokeStyle = warning && ((tick & 1) === 0) ? '#fff5c2' : color;
  ctx.lineWidth = flash ? 3 : 1;
  if (!visible) ctx.setLineDash([3, 3]);
  if (visible || flash) {
    const edgeX = px - fx * Math.max(radius, 2);
    const edgeY = py - fy * Math.max(radius, 2);
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(edgeX, edgeY); ctx.stroke();
  }
  ctx.beginPath();
  if (radius > 1) ctx.arc(px, py, radius, 0, Math.PI * 2);
  else { ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py); ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3); }
  ctx.stroke();
  if (flash) {
    ctx.globalAlpha = turret.momentumTurretShotFlashTicks / MT_SHOT_FLASH_TICKS;
    ctx.fillStyle = '#fff0b0'; ctx.fillRect(px - 2, py - 2, 4, 4);
  }
  if (warning) ctx.globalAlpha *= turret.momentumTurretFireGraceTicks / MT_FIRE_GRACE_TICKS;
  ctx.restore();
}
