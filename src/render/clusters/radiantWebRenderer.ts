/**
 * Radiant Web — rendering for boss body and beam attacks.
 *
 * Body is now rendered as a dust-core: glowing central sphere surrounded by
 * orbiting/swarming dust motes.  Visual state is managed by dustCoreVisual.ts.
 * During web-beam attacks, mote emphasis highlights the beam directions.
 */

import { WorldSnapshot } from '../snapshot';
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
import {
  updateAndRenderDustCore,
  clearAllDustCoreVisualState,
  normalizeDir,
  type DustCoreConfig,
} from './dustCoreVisual';

const MAIN_BEAM_COLOR  = `rgba(180, 255, 220, ${RW_MAIN_BEAM_ALPHA})`;
const MAIN_BEAM_GLOW   = `rgba(100, 255, 180, ${RW_MAIN_BEAM_ALPHA * 0.5})`;
const BRANCH_WARN_COLOR    = 'rgba(100, 255, 200, 0.35)';
const BRANCH_ENERGIZE_COLOR = 'rgba(60, 240, 180, 0.8)';
const BRANCH_FULL_COLOR    = 'rgba(120, 255, 200, 1.0)';
const BRANCH_GLOW_COLOR    = 'rgba(0, 200, 150, 0.4)';
const ROPE_COLOR           = 'rgba(80, 220, 180, 0.75)';
const PUFF_COLOR           = 'rgba(180, 255, 220, 1.0)';

// ── Dust-core visual configuration for Radiant Web ────────────────────────────
// Cool teal/green palette, matching the web beam colors.

const _RW_CORE_CONFIG: DustCoreConfig = {
  rings: [
    {
      count:        6,
      baseRadius:   RW_BODY_RADIUS_WORLD * 1.8,
      angularSpeed: 0.032,    // inner ring — faster
      color:        '#80ffd0',
      glowColor:    'rgba(80,255,180,0.28)',
    },
    {
      count:        9,
      baseRadius:   RW_BODY_RADIUS_WORLD * 3.2,
      angularSpeed: 0.020,    // outer ring — slower
      color:        '#a0ffe4',
      glowColor:    'rgba(120,255,210,0.22)',
    },
  ],
  coreColor:       '#d0fff0',
  coreGlowColor:   'rgba(80,255,180,0.38)',
  coreRadiusWorld: RW_BODY_RADIUS_WORLD,
};

/** Reset all Radiant Web visual state (call on room unload). */
export function resetRadiantWebVisualState(): void {
  clearAllDustCoreVisualState();
}

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

    // Puffs render for the first RW_MAIN_BEAM_PUFF_LIFETIME_TICKS of BRANCH_GROW —
    // stateTicks resets to 0 at state entry, so puffs fade as branches begin growing.
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

    // ── Boss body — dust core with orbiting motes ────────────────────────
    // Compute attack emphasis from the average main beam direction during
    // web-attack states; motes arrange into radial spokes matching the beams.
    let atkDirX = 0;
    let atkDirY = 0;
    let emphasisT = 0.0;

    const isAttacking = (
      state === RW_STATE_BEAM_GROW   ||
      state === RW_STATE_BRANCH_GROW ||
      state === RW_STATE_ENERGIZED
    );

    if (isAttacking && beamState !== null) {
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (let i = 0; i < beamState.mainBeams.length; i++) {
        const mb = beamState.mainBeams[i];
        if (mb.isActiveFlag === 0) continue;
        sumX += mb.dirXWorld;
        sumY += mb.dirYWorld;
        count++;
      }
      if (count > 0) {
        [atkDirX, atkDirY] = normalizeDir(sumX, sumY);
        emphasisT = state === RW_STATE_ENERGIZED ? 0.7 : 0.4;
      }
    }

    const cfg: DustCoreConfig = {
      ..._RW_CORE_CONFIG,
      attackDirX:    atkDirX,
      attackDirY:    atkDirY,
      attackEmphasisT: emphasisT,
    };

    ctx.save();
    updateAndRenderDustCore(
      ctx,
      cluster.entityId,
      screenX, screenY,
      scalePx,
      cluster.isAliveFlag === 1,
      cluster.healthPoints,
      snapshot.tick,
      cfg,
    );
    ctx.restore();

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


