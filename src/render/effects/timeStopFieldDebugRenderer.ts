/**
 * timeStopFieldDebugRenderer.ts — TimeStop Field debug visualization.
 *
 * Off by default; only called when `isDebugMode` is true (same convention as
 * pixelMaterialDebugRenderer.ts / airCurrentsDebugRenderer.ts). Shows the
 * player's current connected-region id, inside/outside state, the stored
 * momentum vector, and entry/exit event counters — useful for verifying
 * "moving between connected tiles doesn't retrigger" and mask alignment
 * without shipping any of this visibly in normal gameplay.
 */

import type { WorldState } from '../../sim/world';

export function renderTimeStopFieldDebug(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  if (player === undefined) return;
  const state = world.timeStopField;

  const px = player.positionXWorld * zoom + ox;
  const py = player.positionYWorld * zoom + oy - 24 * zoom;

  const lines = [
    `TSF region=${state.activeRegionId} in=${state.isInsideFieldFlag}`,
    `stored=(${state.storedMomentumXWorld.toFixed(1)}, ${state.storedMomentumYWorld.toFixed(1)})`,
    `intensity=${state.visualIntensity.toFixed(2)} enter#${state.entrySequence} exit#${state.exitSequence}`,
  ];

  ctx.save();
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  const w = Math.max(...lines.map(l => ctx.measureText(l).width)) + 4;
  ctx.fillRect(px, py - lines.length * 9 - 2, w, lines.length * 9 + 2);
  ctx.fillStyle = state.isInsideFieldFlag === 1 ? 'rgba(150,255,180,0.95)' : 'rgba(255,220,150,0.95)';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], px + 2, py - (lines.length - 1 - i) * 9);
  }
  ctx.restore();
}
