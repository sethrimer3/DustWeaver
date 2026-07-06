import type { ClusterSnapshot } from '../snapshot';
import type { WorldSnapshot } from '../snapshotTypes';
import {
  ICE_SPIKE_ACTIVE_TICKS,
  ICE_SPIKE_FADE_TICKS,
  ICE_SPIKE_HEIGHT_WORLD,
  ICE_SPIKE_RISE_TICKS,
  ICE_SPIKE_TELEGRAPH_TICKS,
  ICE_SPIKE_WIDTH_WORLD,
  ICE_WIZARD_STATE_SLAM_DOWN,
  ICE_WIZARD_STATE_SUMMON_RECOVERY,
  ICE_WIZARD_STATE_SUMMON_RELEASE,
  ICE_WIZARD_STATE_SUMMON_TELEGRAPH,
  ICE_WIZARD_STATE_TELEGRAPH_SLAM,
  ICE_WIZARD_SUMMON_RECOVERY_TICKS,
  ICE_WIZARD_SUMMON_TELEGRAPH_TICKS,
} from '../../sim/clusters/iceWizardConfig';

export function renderIceWizardBody(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  cluster: ClusterSnapshot,
  scalePx: number,
): void {
  const halfW = cluster.halfWidthWorld * scalePx;
  const halfH = cluster.halfHeightWorld * scalePx;
  const left = screenX - halfW;
  const top = screenY - halfH;
  const w = halfW * 2;
  const h = halfH * 2;
  const telegraphPulse = cluster.iceWizardState === ICE_WIZARD_STATE_TELEGRAPH_SLAM
    ? 0.5 + 0.5 * Math.sin(cluster.iceWizardStateTicks * 0.45)
    : 0;
  const isSummoning =
    cluster.iceWizardState === ICE_WIZARD_STATE_SUMMON_TELEGRAPH ||
    cluster.iceWizardState === ICE_WIZARD_STATE_SUMMON_RELEASE ||
    cluster.iceWizardState === ICE_WIZARD_STATE_SUMMON_RECOVERY;

  ctx.save();
  ctx.fillStyle = cluster.iceWizardState === ICE_WIZARD_STATE_SLAM_DOWN ? '#bdf7ff' : '#62d8ff';
  ctx.globalAlpha = 0.84;
  ctx.fillRect(left, top, w, h);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = telegraphPulse > 0 ? `rgba(245, 255, 255, ${0.65 + telegraphPulse * 0.35})` : '#e8fbff';
  ctx.lineWidth = Math.max(1, 1.5 * scalePx);
  ctx.strokeRect(left, top, w, h);

  ctx.strokeStyle = 'rgba(12, 106, 158, 0.55)';
  ctx.lineWidth = Math.max(1, scalePx);
  for (let i = 1; i < 4; i++) {
    const gx = left + (w * i) / 4;
    const gy = top + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, top + h);
    ctx.moveTo(left, gy);
    ctx.lineTo(left + w, gy);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.fillRect(left + scalePx * 2, top + scalePx * 2, w - scalePx * 4, Math.max(1, scalePx * 3));

  if (telegraphPulse > 0) {
    ctx.strokeStyle = `rgba(150, 240, 255, ${0.45 + telegraphPulse * 0.35})`;
    ctx.lineWidth = Math.max(1, 2 * scalePx);
    ctx.beginPath();
    ctx.moveTo(screenX - halfW * 0.62, screenY + halfH + 3 * scalePx);
    ctx.lineTo(screenX + halfW * 0.62, screenY + halfH + 3 * scalePx);
    ctx.stroke();
  }

  if (isSummoning) {
    const summonT = cluster.iceWizardState === ICE_WIZARD_STATE_SUMMON_TELEGRAPH
      ? Math.min(1, cluster.iceWizardStateTicks / ICE_WIZARD_SUMMON_TELEGRAPH_TICKS)
      : cluster.iceWizardState === ICE_WIZARD_STATE_SUMMON_RELEASE
        ? 1
        : 1 - Math.min(1, cluster.iceWizardStateTicks / ICE_WIZARD_SUMMON_RECOVERY_TICKS);
    const pulse = 0.5 + 0.5 * Math.sin(cluster.iceWizardStateTicks * 0.5);
    const ringRadius = (Math.max(halfW, halfH) + (8 + summonT * 14) * scalePx);
    ctx.globalAlpha = 0.35 + pulse * 0.28;
    ctx.strokeStyle = '#e9fdff';
    ctx.lineWidth = Math.max(1, 2 * scalePx);
    ctx.beginPath();
    ctx.arc(screenX, screenY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.28 + summonT * 0.25;
    ctx.strokeStyle = '#7ee8ff';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + cluster.iceWizardStateTicks * 0.06;
      const inner = Math.max(halfW, halfH) + 4 * scalePx;
      const outer = ringRadius + (4 + pulse * 4) * scalePx;
      ctx.beginPath();
      ctx.moveTo(screenX + Math.cos(a) * inner, screenY + Math.sin(a) * inner);
      ctx.lineTo(screenX + Math.cos(a) * outer, screenY + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawJaggedSpike(ctx: CanvasRenderingContext2D, x: number, baseY: number, width: number, height: number): void {
  const half = width * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - half, baseY);
  ctx.lineTo(x - half * 0.35, baseY - height * 0.58);
  ctx.lineTo(x, baseY - height);
  ctx.lineTo(x + half * 0.28, baseY - height * 0.52);
  ctx.lineTo(x + half, baseY);
  ctx.closePath();
}

export function renderIceSpikes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  ctx.save();
  ctx.lineJoin = 'miter';
  for (let i = 0; i < snapshot.iceSpikeAliveFlag.length; i++) {
    if (snapshot.iceSpikeAliveFlag[i] === 0) continue;
    const delay = snapshot.iceSpikeDelayTicks[i];
    const age = snapshot.iceSpikeAgeTicks[i];
    const x = snapshot.iceSpikeXWorld[i] * scalePx + offsetXPx;
    const baseY = snapshot.iceSpikeBaseYWorld[i] * scalePx + offsetYPx;
    const width = ICE_SPIKE_WIDTH_WORLD * scalePx;
    const fullHeight = ICE_SPIKE_HEIGHT_WORLD * scalePx;

    if (delay > 0 || age < ICE_SPIKE_TELEGRAPH_TICKS) {
      const pulse = delay > 0 ? 0.35 : 0.45 + 0.25 * Math.sin((snapshot.tick + i) * 0.5);
      ctx.fillStyle = `rgba(140, 238, 255, ${pulse})`;
      ctx.fillRect(x - width * 0.65, baseY - Math.max(1, scalePx), width * 1.3, Math.max(1, scalePx));
      continue;
    }

    const riseAge = age - ICE_SPIKE_TELEGRAPH_TICKS;
    const activeStart = ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS;
    const activeEnd = activeStart + ICE_SPIKE_ACTIVE_TICKS;
    const riseT = Math.min(1, riseAge / ICE_SPIKE_RISE_TICKS);
    const fade = age >= activeEnd ? 1 - Math.min(1, (age - activeEnd) / ICE_SPIKE_FADE_TICKS) : 1;
    const height = fullHeight * riseT;

    ctx.shadowColor = 'rgba(120, 230, 255, 0.75)';
    ctx.shadowBlur = 5 * scalePx;
    ctx.fillStyle = age >= activeStart && age < activeEnd
      ? `rgba(210, 252, 255, ${0.82 * fade})`
      : `rgba(120, 225, 255, ${0.58 * fade})`;
    ctx.strokeStyle = `rgba(28, 142, 198, ${0.9 * fade})`;
    ctx.lineWidth = Math.max(1, scalePx);
    drawJaggedSpike(ctx, x, baseY, width, height);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
