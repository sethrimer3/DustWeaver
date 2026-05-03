/**
 * gameRenderHelpers.ts — Module-level glow and outline render helpers for the game frame.
 *
 * Contains allocation-free helper functions used by renderFrame() in gameRender.ts:
 *   • drawGrappleBloom     — bloom dots along the grapple chain
 *   • drawParticleGlow     — per-particle bloom for gold dust
 *   • drawOffensiveDustOutlineOverlay — red outline around enemy-owned offensive particles
 */

import type { WorldSnapshot } from '../render/snapshot';
import { ParticleKind } from '../sim/particles/kinds';
import type { BloomSystem } from '../render/effects/bloomSystem';
import { isOffensiveDustOutlineEnabled } from '../ui/renderSettings';
import { BEHAVIOR_MODE_GRAPPLE_CHAIN } from '../sim/clusters/grappleShared';

/** Visual spacing between grapple bloom dots along the chain (virtual px). */
export const GRAPPLE_BLOOM_SEGMENT_PX = 6;
export const OUTLINE_BASE_WIDTH_1080P_PX = 2;
export const OFFENSIVE_DUST_BASE_DIAMETER_WORLD = 2.0;

/**
 * Module-level pre-allocated Set for alive enemy entity IDs.
 * Reused each frame by `drawOffensiveDustOutlineOverlay` — avoids allocating a
 * new Set<number> on every render call (saves one GC-eligible object per frame).
 */
const _aliveEnemyEntityIds = new Set<number>();

export function drawGrappleBloom(
  bloomSystem: BloomSystem,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.isGrappleActiveFlag !== 1) return;

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const candidate = snapshot.clusters[ci];
    if (candidate.isPlayerFlag === 1 && candidate.isAliveFlag === 1) {
      playerCluster = candidate;
      break;
    }
  }
  if (playerCluster === undefined) return;

  const playerHalfWidthPx = playerCluster.halfWidthWorld * scalePx;
  const offsetDir = playerCluster.isFacingLeftFlag === 1 ? -1 : 1;
  const px = playerCluster.positionXWorld * scalePx + offsetXPx + offsetDir * playerHalfWidthPx;
  const py = playerCluster.positionYWorld * scalePx + offsetYPx;

  const ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  const ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;

  const dx = ax - px;
  const dy = ay - py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const segmentCount = Math.max(1, Math.floor(dist / GRAPPLE_BLOOM_SEGMENT_PX));
  for (let segmentIndex = 0; segmentIndex <= segmentCount; segmentIndex++) {
    const t = segmentCount > 0 ? segmentIndex / segmentCount : 0;
    bloomSystem.glowPass.drawCircle({
      x: px + dx * t,
      y: py + dy * t,
      radius: 1.2,
      glow: {
        enabled: true,
        intensity: 0.28,
        color: '#ffd972',
      },
    });
  }

  bloomSystem.glowPass.drawCircle({
    x: ax,
    y: ay,
    radius: 3.0,
    glow: {
      enabled: true,
      intensity: 0.62,
      color: '#ffe79d',
    },
  });
}

/**
 * Draws additive glow for gold dust particles into the bloom system's glow pass.
 * Multiple overlapping particles produce a stronger combined glow (additive blend).
 * Glow intensity scales with particle speed — faster-moving particles glow brighter.
 */
export function drawParticleGlow(
  bloomSystem: BloomSystem,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  const particles = snapshot.particles;
  /** Glow radius is slightly larger than the 3×3 dust square for a soft halo. */
  const glowRadius = 2.5 * scalePx;

  /** Speed (world units/s) at which glow reaches full intensity. */
  const MAX_GLOW_SPEED_WORLD_PER_SEC = 120.0;
  /** Base glow intensity for a resting particle. */
  const BASE_GLOW_INTENSITY = 0.25;
  /** Additional glow intensity added at maximum speed. */
  const SPEED_GLOW_RANGE = 0.65;

  for (let i = 0; i < particles.particleCount; i++) {
    if (particles.isAliveFlag[i] === 0) continue;
    // Grapple chain particles are excluded — drawGrappleBloom() handles their glow.
    if (particles.behaviorMode[i] === BEHAVIOR_MODE_GRAPPLE_CHAIN) continue;
    // Only glow gold dust (Physical) particles
    const kind = particles.kindBuffer[i];
    if (kind !== ParticleKind.Physical && kind !== ParticleKind.Gold) continue;

    const lt = particles.lifetimeTicks[i];
    const normAge = lt > 0 ? Math.min(1.0, particles.ageTicks[i] / lt) : 0.0;
    const ageFade = 1.0 - normAge;
    if (ageFade < 0.05) continue;

    // Velocity-based brightness: faster particles glow brighter.
    const vx = particles.velocityXWorld[i];
    const vy = particles.velocityYWorld[i];
    const speedWorld = Math.sqrt(vx * vx + vy * vy);
    const speedFactor = Math.min(1.0, speedWorld / MAX_GLOW_SPEED_WORLD_PER_SEC);
    const intensity = (BASE_GLOW_INTENSITY + SPEED_GLOW_RANGE * speedFactor) * ageFade;

    const sx = particles.positionXWorld[i] * scalePx + offsetXPx;
    const sy = particles.positionYWorld[i] * scalePx + offsetYPx;

    bloomSystem.glowPass.drawCircle({
      x: sx,
      y: sy,
      radius: glowRadius,
      glow: {
        enabled: true,
        intensity,
        color: '#ffd700',
      },
    });
  }
}

export function drawOffensiveDustOutlineOverlay(
  deviceCtx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  canvasWidthPx: number,
  canvasHeightPx: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (!isOffensiveDustOutlineEnabled()) return;

  const outlineScale = Math.min(canvasWidthPx / 1920.0, canvasHeightPx / 1080.0);
  const lineWidthPx = OUTLINE_BASE_WIDTH_1080P_PX * outlineScale;
  const worldDiameterPx = OFFENSIVE_DUST_BASE_DIAMETER_WORLD * scalePx;
  const radiusPx = Math.max(lineWidthPx * 0.6, worldDiameterPx * 0.6);
  const halfPixelAdjust = ((lineWidthPx % 2) === 0) ? 0.5 : 0;

  // Precompute the set of alive non-player entity IDs in one O(C) pass.
  // Cluster count is tiny (≤ ~30), so the Set construction cost is negligible.
  // Using the module-level pre-allocated Set avoids a per-frame heap allocation.
  _aliveEnemyEntityIds.clear();
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const cluster = snapshot.clusters[ci];
    if (cluster.isPlayerFlag === 0 && cluster.isAliveFlag === 1) {
      _aliveEnemyEntityIds.add(cluster.entityId);
    }
  }

  deviceCtx.save();
  deviceCtx.strokeStyle = '#ff1a1a';
  deviceCtx.lineWidth = lineWidthPx;

  // Collect all qualifying arc positions into a single batched path so
  // the GPU only receives one stroke call instead of one per particle.
  deviceCtx.beginPath();
  let arcCount = 0;

  const particles = snapshot.particles;
  for (let i = 0; i < particles.particleCount; i++) {
    if (particles.isAliveFlag[i] === 0) continue;
    if (particles.behaviorMode[i] !== 1) continue;
    if (!_aliveEnemyEntityIds.has(particles.ownerEntityId[i])) continue;

    const sx = particles.positionXWorld[i] * scalePx + offsetXPx;
    const sy = particles.positionYWorld[i] * scalePx + offsetYPx;
    deviceCtx.moveTo(sx + halfPixelAdjust + radiusPx, sy + halfPixelAdjust);
    deviceCtx.arc(sx + halfPixelAdjust, sy + halfPixelAdjust, radiusPx, 0, Math.PI * 2);
    arcCount++;
  }

  if (arcCount > 0) {
    deviceCtx.stroke();
  }
  deviceCtx.restore();
}
