/**
 * Radiant Tether — rendering for boss body, active chains, and broken chains.
 *
 * Reads from the WorldSnapshot (cluster data) and the module-level chain state
 * exported by radiantTetherAi.  All rendering is on the 2D canvas.
 *
 * Body is now rendered as a dust-core: glowing central sphere surrounded by
 * orbiting/swarming dust motes.  Visual state is managed by dustCoreVisual.ts.
 */

import { WorldSnapshot, ClusterSnapshot } from '../snapshot';
import { getRadiantTetherChainState } from '../../sim/clusters/radiantTetherAi';
import {
  RT_STATE_ACTIVE,
  RT_STATE_RESET,
  RT_STATE_DEAD,
} from '../../sim/clusters/radiantTetherAi';
import {
  RT_CHAIN_LINE_WIDTH_PX,
  RT_BROKEN_CHAIN_LINE_WIDTH_PX,
  RT_CHAIN_SAG_FACTOR,
  RT_CHAIN_VISUAL_SEGMENTS,
  RT_BODY_RADIUS_WORLD,
  RT_BROKEN_CHAIN_LIFETIME_TICKS,
  RT_DEBUG_ENABLED,
} from '../../sim/clusters/radiantTetherConfig';
import { computeChainSagPoints } from './radiantTetherChainRenderer';
import {
  updateAndRenderDustCore,
  clearAllDustCoreVisualState,
  normalizeDir,
  type DustCoreConfig,
} from './dustCoreVisual';

// ── Colors ──────────────────────────────────────────────────────────────────

const CHAIN_COLOR_INNER   = '#fffde0';
const CHAIN_COLOR_OUTER   = 'rgba(255, 240, 180, 0.5)';
const BROKEN_CHAIN_COLOR  = 'rgba(255, 220, 120, 0.6)';

// ── Dust-core visual configuration for Radiant Tether ───────────────────────
// Warm amber/gold palette, consistent with chain colors.

const _RT_CORE_CONFIG: DustCoreConfig = {
  rings: [
    {
      count:        6,
      baseRadius:   RT_BODY_RADIUS_WORLD * 1.8,
      angularSpeed: 0.028,   // inner ring — faster
      color:        '#ffd080',
      glowColor:    'rgba(255,200,80,0.28)',
    },
    {
      count:        9,
      baseRadius:   RT_BODY_RADIUS_WORLD * 3.2,
      angularSpeed: 0.018,   // outer ring — slower
      color:        '#ffe4a0',
      glowColor:    'rgba(255,230,140,0.22)',
    },
  ],
  coreColor:       '#fff8d0',
  coreGlowColor:   'rgba(255,240,160,0.38)',
  coreRadiusWorld: RT_BODY_RADIUS_WORLD,
};

/** Reset all Radiant Tether visual state (call on room unload). */
export function resetRadiantTetherVisualState(): void {
  clearAllDustCoreVisualState();
}

// ── Main render entry point ─────────────────────────────────────────────────

export function renderRadiantTether(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  isDebugMode: boolean,
): void {
  const chainState = getRadiantTetherChainState();

  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isRadiantTetherFlag !== 1) continue;
    if (cluster.isAliveFlag === 0 && cluster.radiantTetherState !== RT_STATE_DEAD) continue;

    const screenX = cluster.positionXWorld * scalePx + offsetXPx;
    const screenY = cluster.positionYWorld * scalePx + offsetYPx;
    const state = cluster.radiantTetherState;

    // ── Active movement chains ──────────────────────────────────────────
    if (chainState !== null && state >= RT_STATE_ACTIVE && state <= RT_STATE_RESET) {
      for (let i = 0; i < chainState.chains.length; i++) {
        const chain = chainState.chains[i];
        if (chain.isActiveFlag === 0) continue;
        const anchorScreenX = chain.anchorXWorld * scalePx + offsetXPx;
        const anchorScreenY = chain.anchorYWorld * scalePx + offsetYPx;
        renderChain(ctx, screenX, screenY, anchorScreenX, anchorScreenY);
      }
    }

    // ── Broken chains ───────────────────────────────────────────────────
    if (chainState !== null) {
      for (let i = 0; i < chainState.brokenChains.length; i++) {
        const bc = chainState.brokenChains[i];
        if (bc.isActiveFlag === 0) continue;
        const asx = bc.anchorXWorld * scalePx + offsetXPx;
        const asy = bc.anchorYWorld * scalePx + offsetYPx;
        const fsx = bc.freeEndXWorld * scalePx + offsetXPx;
        const fsy = bc.freeEndYWorld * scalePx + offsetYPx;
        const fadeAlpha = bc.lifetimeTicks / RT_BROKEN_CHAIN_LIFETIME_TICKS;
        renderBrokenChain(ctx, asx, asy, fsx, fsy, fadeAlpha);
      }
    }

    // ── Boss body — dust core with orbiting motes ────────────────────────
    // Compute attack emphasis direction from chains (or base angle in active state).
    let atkDirX = 0;
    let atkDirY = 0;
    let emphasisT = 0.0;

    if (state === RT_STATE_ACTIVE || state === RT_STATE_RESET) {
      // Average direction toward chain anchors from boss center
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      if (chainState !== null) {
        for (let i = 0; i < chainState.chains.length; i++) {
          const ch = chainState.chains[i];
          if (ch.isActiveFlag === 0) continue;
          const dx = ch.anchorXWorld - cluster.positionXWorld;
          const dy = ch.anchorYWorld - cluster.positionYWorld;
          const [ndx, ndy] = normalizeDir(dx, dy);
          sumX += ndx; sumY += ndy; count++;
        }
      }
      if (count > 0) {
        [atkDirX, atkDirY] = normalizeDir(sumX, sumY);
        emphasisT = state === RT_STATE_ACTIVE ? 0.45 : 0.15;
      }
    }

    const cfg: DustCoreConfig = {
      ..._RT_CORE_CONFIG,
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

    // ── Debug overlay ───────────────────────────────────────────────────
    if ((isDebugMode || RT_DEBUG_ENABLED) && chainState !== null) {
      renderDebugOverlay(ctx, cluster, screenX, screenY, scalePx, offsetXPx, offsetYPx, chainState);
    }
  }
}

// ── Active chain with catenary sag ──────────────────────────────────────────

function renderChain(
  ctx: CanvasRenderingContext2D,
  fromX: number, fromY: number,
  toX: number, toY: number,
): void {
  const points = computeChainSagPoints(
    fromX, fromY, toX, toY,
    RT_CHAIN_VISUAL_SEGMENTS,
    RT_CHAIN_SAG_FACTOR,
  );

  // Outer glow
  ctx.save();
  ctx.strokeStyle = CHAIN_COLOR_OUTER;
  ctx.lineWidth = RT_CHAIN_LINE_WIDTH_PX + 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Inner bright core
  ctx.strokeStyle = CHAIN_COLOR_INNER;
  ctx.lineWidth = RT_CHAIN_LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// ── Broken chain ────────────────────────────────────────────────────────────

function renderBrokenChain(
  ctx: CanvasRenderingContext2D,
  anchorX: number, anchorY: number,
  freeEndX: number, freeEndY: number,
  fadeAlpha: number,
): void {
  const points = computeChainSagPoints(
    anchorX, anchorY, freeEndX, freeEndY,
    RT_CHAIN_VISUAL_SEGMENTS,
    RT_CHAIN_SAG_FACTOR * 0.5,
  );

  ctx.save();
  ctx.globalAlpha = fadeAlpha;
  ctx.strokeStyle = BROKEN_CHAIN_COLOR;
  ctx.lineWidth = RT_BROKEN_CHAIN_LINE_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1.0;
  ctx.restore();
}


// ── Debug overlay ───────────────────────────────────────────────────────────

function renderDebugOverlay(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  screenX: number, screenY: number,
  scalePx: number,
  offsetXPx: number, offsetYPx: number,
  chainState: { chains: { isActiveFlag: 0 | 1; anchorXWorld: number; anchorYWorld: number; currentLengthWorld: number; isTighteningFlag: 0 | 1 }[]; brokenChains: { isActiveFlag: 0 | 1 }[] },
): void {
  const stateNames = ['INACTIVE', 'ACTIVE', 'RESET', 'DEAD'];
  const stateName = stateNames[cluster.radiantTetherState] || '???';
  const hp = cluster.healthPoints;
  const maxHp = cluster.maxHealthPoints;
  const chainCount = cluster.radiantTetherChainCount;

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 200, 0.85)';
  ctx.font = '11px monospace';
  ctx.fillText(`RT: ${stateName} t=${cluster.radiantTetherStateTicks}`, screenX - 50, screenY - 30);
  ctx.fillText(`HP: ${hp}/${maxHp}  Chains: ${chainCount}`, screenX - 50, screenY - 18);

  // Draw anchor points
  for (let i = 0; i < chainState.chains.length; i++) {
    const chain = chainState.chains[i];
    if (chain.isActiveFlag === 0) continue;
    const asx = chain.anchorXWorld * scalePx + offsetXPx;
    const asy = chain.anchorYWorld * scalePx + offsetYPx;
    ctx.beginPath();
    ctx.arc(asx, asy, 4, 0, Math.PI * 2);
    ctx.fillStyle = chain.isTighteningFlag === 1 ? 'rgba(255, 80, 80, 0.8)' : 'rgba(80, 255, 80, 0.8)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,200,0.7)';
    ctx.font = '9px monospace';
    ctx.fillText(`L=${Math.round(chain.currentLengthWorld)}`, asx + 6, asy - 4);
  }

  // Broken chain count
  let brokenCount = 0;
  for (let i = 0; i < chainState.brokenChains.length; i++) {
    if (chainState.brokenChains[i].isActiveFlag === 1) brokenCount++;
  }
  if (brokenCount > 0) {
    ctx.fillStyle = 'rgba(255, 200, 100, 0.8)';
    ctx.fillText(`Broken: ${brokenCount}`, screenX - 50, screenY - 6);
  }

  ctx.restore();
}
