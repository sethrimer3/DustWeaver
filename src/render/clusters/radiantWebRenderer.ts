/**
 * Radiant Web — rendering for boss body and beam attacks.
 */

import { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import { getRadiantWebBeamState } from '../../sim/clusters/radiantWebAi';
import {
  RW_STATE_BEAM_GROW,
  RW_STATE_BRANCH_GROW,
  RW_STATE_ENERGIZED,
  RW_STATE_ROPE_DECAY,
} from '../../sim/clusters/radiantWebAi';
import {
  RW_MAIN_BEAM_WIDTH_PX,
  RW_MAIN_BEAM_ALPHA,
  RW_BRANCH_BEAM_WIDTH_PX,
  RW_MAIN_BEAM_PUFF_LIFETIME_TICKS,
  RW_MAIN_BEAM_PUFF_RADIUS_WORLD,
  RW_MAIN_BEAM_PUFF_ALPHA,
  RW_BRANCH_ROPE_SEGMENTS,
  RW_BRANCH_ENERGIZE_DELAY_TICKS,
  RW_BODY_RADIUS_WORLD,
  RW_DEBUG_ENABLED,
} from '../../sim/clusters/radiantWebConfig';

const MAIN_BEAM_COLOR  = `rgba(180, 255, 220, ${RW_MAIN_BEAM_ALPHA})`;
const MAIN_BEAM_GLOW   = `rgba(100, 255, 180, ${RW_MAIN_BEAM_ALPHA * 0.5})`;
const BRANCH_WARN_COLOR    = 'rgba(100, 255, 200, 0.35)';
const BRANCH_ENERGIZE_COLOR = 'rgba(60, 240, 180, 0.8)';
const BRANCH_FULL_COLOR    = 'rgba(120, 255, 200, 1.0)';
const BRANCH_GLOW_COLOR    = 'rgba(0, 200, 150, 0.4)';
const ROPE_COLOR           = 'rgba(80, 220, 180, 0.75)';
const PUFF_COLOR           = 'rgba(180, 255, 220, 1.0)';
const BODY_COLOR_CORE      = '#eeffee';
const BODY_COLOR_GLOW      = 'rgba(100, 255, 180, 0.3)';
const BODY_COLOR_RING      = 'rgba(100, 255, 200, 0.6)';

export function renderRadiantWeb(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  isDebugMode: boolean,
): void {
  const beamState = getRadiantWebBeamState();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isRadiantWebFlag !== 1) continue;
    if (cluster.isAliveFlag === 0 && cluster.radiantWebState !== 6) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;
    const state = cluster.radiantWebState;
    const stateTicks = cluster.radiantWebStateTicks;

    if (beamState !== null && (state === RW_STATE_BEAM_GROW || state === RW_STATE_BRANCH_GROW)) {
      for (let i = 0; i < beamState.mainBeams.length; i++) {
        const mb = beamState.mainBeams[i];
        if (mb.isActiveFlag === 0) continue;
        const endX = (mb.originXWorld + mb.dirXWorld * mb.currentLengthWorld) * scalePx + offsetXPx;
        const endY = (mb.originYWorld + mb.dirYWorld * mb.currentLengthWorld) * scalePx + offsetYPx;
        renderMainBeam(ctx, screenX, screenY, endX, endY);
      }
    }

    if (beamState !== null && (state === RW_STATE_BRANCH_GROW || state === RW_STATE_ENERGIZED)) {
      for (let i = 0; i < beamState.branchBeams.length; i++) {
        const bb = beamState.branchBeams[i];
        if (bb.isActiveFlag === 0 || bb.isRopeFlag === 1) continue;
        const startSX = bb.startXWorld * scalePx + offsetXPx;
        const startSY = bb.startYWorld * scalePx + offsetYPx;
        const endSX = (bb.startXWorld + bb.dirXWorld * bb.currentLengthWorld) * scalePx + offsetXPx;
        const endSY = (bb.startYWorld + bb.dirYWorld * bb.currentLengthWorld) * scalePx + offsetYPx;
        const isEnergized = bb.isEnergizedFlag === 1;
        const chargeRatio = isEnergized ? 1.0 - bb.energizeTicks / RW_BRANCH_ENERGIZE_DELAY_TICKS : 0.0;
        renderBranchBeam(ctx, startSX, startSY, endSX, endSY, isEnergized, chargeRatio);
      }
    }

    if (beamState !== null && state === RW_STATE_BRANCH_GROW && stateTicks < RW_MAIN_BEAM_PUFF_LIFETIME_TICKS) {
      const puffProgress = stateTicks / RW_MAIN_BEAM_PUFF_LIFETIME_TICKS;
      for (let i = 0; i < beamState.mainBeams.length; i++) {
        const mb = beamState.mainBeams[i];
        const hitSX = mb.hitXWorld * scalePx + offsetXPx;
        const hitSY = mb.hitYWorld * scalePx + offsetYPx;
        renderPuff(ctx, hitSX, hitSY, puffProgress, scalePx);
      }
    }

    if (beamState !== null && state === RW_STATE_ROPE_DECAY) {
      for (let i = 0; i < beamState.branchBeams.length; i++) {
        const bb = beamState.branchBeams[i];
        if (bb.isActiveFlag === 0 || bb.isRopeFlag === 0) continue;
        const lifeFrac = bb.ropeLifetimeTicks / bb.ropeTotalLifetimeTicks;
        const anchorSX = bb.ropeAnchorXWorld * scalePx + offsetXPx;
        const anchorSY = bb.ropeAnchorYWorld * scalePx + offsetYPx;
        const freeSX = bb.ropeFreeEndXWorld * scalePx + offsetXPx;
        const freeSY = bb.ropeFreeEndYWorld * scalePx + offsetYPx;
        renderRope(ctx, anchorSX, anchorSY, freeSX, freeSY, lifeFrac);
      }
    }

    if (cluster.isAliveFlag === 1) {
      renderBossBody(ctx, screenX, screenY, scalePx, cluster);
    }

    if (isDebugMode || RW_DEBUG_ENABLED) {
      const stateNames = ['INACTIVE', 'BEAM_GROW', 'BRANCH_GROW', 'ENERGIZED', 'ROPE_DECAY', 'RESET', 'DEAD'];
      ctx.save();
      ctx.fillStyle = 'rgba(180, 255, 200, 0.85)';
      ctx.font = '11px monospace';
      ctx.fillText(`RW: ${stateNames[state] ?? '???'} t=${stateTicks}`, screenX - 50, screenY - 30);
      ctx.restore();
    }
  }
}

function renderMainBeam(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
): void {
  ctx.save();
  ctx.strokeStyle = MAIN_BEAM_GLOW;
  ctx.lineWidth = RW_MAIN_BEAM_WIDTH_PX + 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.strokeStyle = MAIN_BEAM_COLOR;
  ctx.lineWidth = RW_MAIN_BEAM_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  ctx.restore();
}

function renderBranchBeam(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
  isEnergized: boolean,
  chargeRatio: number,
): void {
  ctx.save();
  ctx.lineCap = 'round';
  if (!isEnergized) {
    ctx.strokeStyle = BRANCH_WARN_COLOR;
    ctx.lineWidth = RW_BRANCH_BEAM_WIDTH_PX;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  } else {
    const alpha = 0.35 + chargeRatio * 0.65;
    ctx.strokeStyle = BRANCH_GLOW_COLOR;
    ctx.lineWidth = RW_BRANCH_BEAM_WIDTH_PX + 8;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.strokeStyle = chargeRatio >= 1.0 ? BRANCH_FULL_COLOR : BRANCH_ENERGIZE_COLOR;
    ctx.lineWidth = RW_BRANCH_BEAM_WIDTH_PX + 1;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function renderPuff(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  progress: number,
  scalePx: number,
): void {
  const alpha = RW_MAIN_BEAM_PUFF_ALPHA * (1.0 - progress);
  const radiusPx = RW_MAIN_BEAM_PUFF_RADIUS_WORLD * scalePx * (0.5 + progress * 1.5);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PUFF_COLOR;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function renderRope(
  ctx: CanvasRenderingContext2D,
  anchorX: number, anchorY: number,
  freeEndX: number, freeEndY: number,
  lifeFrac: number,
): void {
  const midX = anchorX + (freeEndX - anchorX) * lifeFrac;
  const midY = anchorY + (freeEndY - anchorY) * lifeFrac;
  const dx = midX - anchorX;
  const dy = midY - anchorY;
  const len = Math.sqrt(dx * dx + dy * dy);
  ctx.save();
  ctx.globalAlpha = lifeFrac * 0.85;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (len > 0.1) {
    const sagFactor = 0.08;
    const sagAmount = len * sagFactor;
    ctx.strokeStyle = ROPE_COLOR;
    ctx.lineWidth = RW_BRANCH_BEAM_WIDTH_PX + 0.5;
    ctx.beginPath();
    ctx.moveTo(anchorX, anchorY);
    const invSegments = 1.0 / RW_BRANCH_ROPE_SEGMENTS;
    for (let s = 1; s <= RW_BRANCH_ROPE_SEGMENTS; s++) {
      const t = s * invSegments;
      const sx = anchorX + dx * t;
      const sy = anchorY + dy * t + sagAmount * 4 * t * (1 - t);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;
  ctx.restore();
}

function renderBossBody(
  ctx: CanvasRenderingContext2D,
  screenX: number, screenY: number,
  scalePx: number,
  cluster: ClusterSnapshot,
): void {
  const radiusPx = RW_BODY_RADIUS_WORLD * scalePx;
  const healthRatio = cluster.maxHealthPoints > 0 ? cluster.healthPoints / cluster.maxHealthPoints : 1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(screenX, screenY, radiusPx * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = BODY_COLOR_GLOW;
  ctx.globalAlpha = 0.3 + healthRatio * 0.2;
  ctx.fill();
  const pulseT = (cluster.radiantWebStateTicks % 60) / 60;
  const pulseRadius = radiusPx * (1.2 + 0.3 * Math.sin(pulseT * Math.PI * 2));
  ctx.beginPath();
  ctx.arc(screenX, screenY, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = BODY_COLOR_RING;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + healthRatio * 0.3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = BODY_COLOR_CORE;
  ctx.globalAlpha = 0.85 + healthRatio * 0.15;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(screenX - radiusPx * 0.3, screenY - radiusPx * 0.3, radiusPx * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fill();
  ctx.globalAlpha = 1.0;
  ctx.restore();
}
