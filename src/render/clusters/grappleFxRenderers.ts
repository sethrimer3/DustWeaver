/**
 * grappleFxRenderers.ts — Visual-effect helper renderers for grapple events.
 *
 * Extracted from grappleRenderer.ts. Each function is a standalone one-shot
 * effect renderer called by renderGrapple() in grappleRenderer.ts.
 *
 *   • renderGrappleFailBeam      — dashed beam when grapple misses
 *   • renderGrappleEmptyFx       — spinning-spark arc when charge is depleted
 *   • renderZipImpactFx          — expanding shockwave ring + dust plume on zip impact
 *   • renderGrappleRechargeRing  — shrinking golden ring when charge is restored
 *   • renderZipJumpReadyRing     — pulsing ring while the zip-jump timing window is open
 */

import type { WorldSnapshot } from '../snapshot';

export function renderGrappleFailBeam(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.grappleFailBeamTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.grappleFailBeamTotalTicks);
  const elapsedTicks = totalTicks - snapshot.grappleFailBeamTicksLeft;
  const extendTicks = 5;
  const hoverTicks = 3;
  const extendT = Math.min(1, elapsedTicks / extendTicks);

  let alpha = 1;
  if (elapsedTicks > extendTicks + hoverTicks) {
    const fadeT = (elapsedTicks - extendTicks - hoverTicks) / Math.max(1, totalTicks - extendTicks - hoverTicks);
    alpha = Math.max(0, 1 - fadeT);
  }

  const sx = snapshot.grappleFailBeamStartXWorld * scalePx + offsetXPx;
  const sy = snapshot.grappleFailBeamStartYWorld * scalePx + offsetYPx;
  const exFull = snapshot.grappleFailBeamEndXWorld * scalePx + offsetXPx;
  const eyFull = snapshot.grappleFailBeamEndYWorld * scalePx + offsetYPx;
  const ex = sx + (exFull - sx) * extendT;
  const ey = sy + (eyFull - sy) * extendT;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  ctx.strokeStyle = 'rgba(255, 230, 120, 0.85)';
  ctx.lineWidth = Math.max(1, scalePx * 0.75);
  ctx.setLineDash([2 * scalePx, 2 * scalePx]);
  ctx.beginPath();
  ctx.moveTo(Math.round(sx), Math.round(sy));
  ctx.lineTo(Math.round(ex), Math.round(ey));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 245, 170, 0.9)';
  const r = Math.max(1, scalePx);
  ctx.fillRect(Math.round(ex) - r, Math.round(ey) - r, r * 2, r * 2);

  ctx.restore();
}

export function renderGrappleEmptyFx(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.grappleEmptyFxTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.grappleEmptyFxTotalTicks);
  const elapsedTicks = totalTicks - snapshot.grappleEmptyFxTicksLeft;
  const t = elapsedTicks / totalTicks;
  const alpha = Math.max(0, 1 - t);

  const cx = snapshot.grappleEmptyFxXWorld * scalePx + offsetXPx;
  const cy = snapshot.grappleEmptyFxYWorld * scalePx + offsetYPx;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  const radius = (2 + t * 5) * scalePx;
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.8)';
  ctx.lineWidth = Math.max(1, scalePx * 0.75);
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), radius, -Math.PI * 0.2, Math.PI * 1.15);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 220, 90, 0.9)';
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + t * 2.0;
    const inward = (1 - t) * 4 * scalePx;
    const x = cx + Math.cos(angle) * inward;
    const y = cy + Math.sin(angle) * inward;
    const s = Math.max(1, scalePx);
    ctx.fillRect(Math.round(x) - s, Math.round(y) - s, s * 2, s * 2);
  }

  ctx.restore();
}

/**
 * Renders the zip impact shockwave ring and dust plume at the zip completion
 * or blocked-zip contact point.
 *
 * Normal zip completion: a single expanding golden ring (scale 1.0).
 * Successful zip-jump:   a slightly larger ring (scale ZIP_JUMP_FX_SCALE ≈ 1.35)
 *                        that communicates the timed jump was registered.
 *
 * The dust plume fans outward from the impact point in the surface normal
 * direction, giving a directional read of which surface the player hit.
 */
export function renderZipImpactFx(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.zipImpactFxTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.zipImpactFxTotalTicks);
  const elapsed    = totalTicks - snapshot.zipImpactFxTicksLeft;
  const t          = elapsed / totalTicks; // 0 = freshly fired, 1 = expired
  const scale      = snapshot.zipImpactFxScale;
  const alpha      = Math.max(0, 1.0 - t);

  const cx = snapshot.zipImpactFxXWorld * scalePx + offsetXPx;
  const cy = snapshot.zipImpactFxYWorld * scalePx + offsetYPx;
  const nx = snapshot.zipImpactFxNormalXWorld;
  const ny = snapshot.zipImpactFxNormalYWorld;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // ── Shockwave ring: expands outward as t goes 0→1 ─────────────────────────
  const outerRadius = (3 + t * 18 * scale) * scalePx;
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), outerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 220, 120, ${alpha * 0.75})`;
  ctx.lineWidth   = Math.max(1, (2 - t * 1.5) * scalePx);
  ctx.stroke();

  // Bright inner ring (faster fade, slightly smaller — gives a double-ring feel)
  const innerRadius = (1.5 + t * 9 * scale) * scalePx;
  const innerAlpha  = Math.max(0, alpha * (1.0 - t * 1.5));
  if (innerAlpha > 0.01) {
    ctx.beginPath();
    ctx.arc(Math.round(cx), Math.round(cy), innerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 200, ${innerAlpha})`;
    ctx.lineWidth   = Math.max(1, scalePx);
    ctx.stroke();
  }

  // ── Dust plume: small squares fan outward along the surface normal ─────────
  // Each square's position is at center + normal * distance * t plus a
  // tangential spread, so the plume expands as the FX progresses.
  const PLUME_COUNT  = 8;
  const plumeAlpha   = Math.max(0, alpha * (1.0 - t * 1.2));
  if (PLUME_COUNT >= 2 && plumeAlpha > 0.01) {
    // Tangent of the surface normal for sideways spread.
    const tanX = -ny;
    const tanY =  nx;
    ctx.fillStyle = `rgba(200, 165, 110, ${plumeAlpha})`;

    for (let i = 0; i < PLUME_COUNT; i++) {
      // Spread parameter in [-1, 1]; middle particles go straight along normal.
      const spread = ((i / (PLUME_COUNT - 1)) - 0.5) * 2.0;
      // Blend normal direction with tangent for cone spread.
      const dirX = nx + tanX * spread * 0.9;
      const dirY = ny + tanY * spread * 0.9;
      const len  = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 0.001) continue;
      const ndx = dirX / len;
      const ndy = dirY / len;
      // Particles travel further as t increases; scale adjusts max reach.
      const dist  = t * (14 + 8 * scale) * scalePx;
      const px    = Math.round(cx + ndx * dist);
      const py    = Math.round(cy + ndy * dist);
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  ctx.restore();
}

/**
 * Renders the golden recharge-ring VFX that appears when the grapple charge
 * is restored (player touches ground after spending a grapple).
 *
 * Visual: a ring that starts wide around the player body, quickly shrinks
 * toward the player centre, and fades from 0 to ~50 % opacity.  The warm
 * gold colour (#f5c84b) signals "ready" at a glance without being noisy.
 */
export function renderGrappleRechargeRing(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.grappleRechargeRingTicksLeft <= 0) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined) return;

  const total = Math.max(1, snapshot.grappleRechargeRingTotalTicks);
  const elapsed = total - snapshot.grappleRechargeRingTicksLeft;
  // t goes 0→1 over the effect lifetime
  const t = Math.min(1, elapsed / total);

  // Radius shrinks from 1.2× player half-width down to 0.2× (toward centre)
  const halfW = playerCluster.halfWidthWorld * scalePx;
  const radiusPx = halfW * (1.2 - t * 1.0);

  // Alpha ramps 0 → 0.5 then back to 0 (bell-shaped)
  const alpha = Math.sin(t * Math.PI) * 0.5;

  const cx = playerCluster.positionXWorld * scalePx + offsetXPx;
  const cy = playerCluster.positionYWorld * scalePx + offsetYPx;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#f5c84b';
  ctx.lineWidth = Math.max(1, scalePx * 0.6);
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, radiusPx), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Renders a pulsing golden ring around the player when zip has impacted a
 * surface and a true zip-jump is available (`isZipJumpWindowOpenFlag === 1`).
 *
 * The ring oscillates in size to distinguish it from the impact-shockwave FX
 * and the recharge ring.  Visible outside debug mode so players can read the
 * window without enabling overlays.
 *
 * Kept allocation-free: only primitive math and a single ctx.arc call.
 */
export function renderZipJumpReadyRing(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.isZipJumpWindowOpenFlag !== 1) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined) return;

  const cx = playerCluster.positionXWorld * scalePx + offsetXPx;
  const cy = playerCluster.positionYWorld * scalePx + offsetYPx;
  const halfW = playerCluster.halfWidthWorld * scalePx;

  // Gentle pulse: ring oscillates between 1.1× and 1.4× player half-width.
  // Uses a pre-computed fraction of the current zip window tick instead of
  // performance.now() so it remains deterministic within the render pass.
  // We accept a small dependency on performance.now() here because this is
  // purely a visual indicator and rendering is exempt from sim-determinism rules.
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.015);
  const radiusPx = halfW * (1.1 + pulse * 0.3);

  // Two concentric rings: bright inner + softer outer for a "charged" look.
  ctx.save();

  // Outer soft halo
  ctx.globalAlpha = 0.25 + pulse * 0.15;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = Math.max(1, scalePx * 1.2);
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), radiusPx + scalePx, 0, Math.PI * 2);
  ctx.stroke();

  // Inner gold ring — main readability layer
  ctx.globalAlpha = 0.6 + pulse * 0.35;
  ctx.strokeStyle = '#f5d860';
  ctx.lineWidth   = Math.max(1, scalePx * 0.7);
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), radiusPx, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
