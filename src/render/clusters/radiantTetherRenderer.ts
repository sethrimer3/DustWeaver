/**
 * Radiant Tether — rendering for boss body, active chains, and broken chains.
 *
 * Reads from the WorldSnapshot (cluster data) and the module-level chain state
 * exported by radiantTetherAi.  All rendering is on the 2D canvas.
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
import { getRadiantTetherBodySprite } from './enemyRenderers';
import { isSpriteReady } from '../imageCache';

// ── Colors ──────────────────────────────────────────────────────────────────

const CHAIN_COLOR_INNER   = '#fffde0';
const CHAIN_COLOR_OUTER   = 'rgba(255, 240, 180, 0.5)';
const BROKEN_CHAIN_COLOR  = 'rgba(255, 220, 120, 0.6)';
const BODY_COLOR_CORE     = '#ffffff';
const BODY_COLOR_GLOW     = 'rgba(255, 255, 220, 0.3)';
const BODY_COLOR_RING     = 'rgba(255, 240, 200, 0.6)';

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

    // ── Boss body (floating sphere of light) ────────────────────────────
    if (cluster.isAliveFlag === 1) {
      renderBossBody(ctx, screenX, screenY, scalePx, cluster);
    }

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

// ── Boss body ───────────────────────────────────────────────────────────────

function renderBossBody(
  ctx: CanvasRenderingContext2D,
  screenX: number, screenY: number,
  scalePx: number,
  cluster: ClusterSnapshot,
): void {
  const radiusPx = RT_BODY_RADIUS_WORLD * scalePx;
  const healthRatio = cluster.healthPoints / cluster.maxHealthPoints;
  const bodySprite = getRadiantTetherBodySprite(cluster.radiantTetherState);

  if (isSpriteReady(bodySprite)) {
    const bodySizePx = radiusPx * 4;
    ctx.save();
    ctx.globalAlpha = 0.8 + healthRatio * 0.2;
    ctx.drawImage(bodySprite, screenX - bodySizePx * 0.5, screenY - bodySizePx * 0.5, bodySizePx, bodySizePx);
    ctx.globalAlpha = 1.0;
    ctx.restore();
    return;
  }

  // Outer glow
  ctx.save();
  ctx.beginPath();
  ctx.arc(screenX, screenY, radiusPx * 2.5, 0, Math.PI * 2);
  ctx.fillStyle = BODY_COLOR_GLOW;
  ctx.globalAlpha = 0.3 + healthRatio * 0.2;
  ctx.fill();

  // Pulsing ring
  const pulseT = (cluster.radiantTetherStateTicks % 60) / 60;
  const pulseRadius = radiusPx * (1.2 + 0.3 * Math.sin(pulseT * Math.PI * 2));
  ctx.beginPath();
  ctx.arc(screenX, screenY, pulseRadius, 0, Math.PI * 2);
  ctx.strokeStyle = BODY_COLOR_RING;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.5 + healthRatio * 0.3;
  ctx.stroke();

  // Core body
  ctx.beginPath();
  ctx.arc(screenX, screenY, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = BODY_COLOR_CORE;
  ctx.globalAlpha = 0.85 + healthRatio * 0.15;
  ctx.fill();

  // Inner highlight
  ctx.beginPath();
  ctx.arc(screenX - radiusPx * 0.3, screenY - radiusPx * 0.3, radiusPx * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.fill();

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
