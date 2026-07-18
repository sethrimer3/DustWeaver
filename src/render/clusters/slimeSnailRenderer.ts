import type { WorldSnapshot } from '../snapshot';
import type { ClusterSnapshot } from '../clusterSnapshotTypes';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { SLIME_SNAIL_TRAIL_LIFETIME_TICKS } from '../../sim/clusters/slimeSnailConfig';

/** Deterministic per-cell decay profile. Returns visible thickness in world pixels. */
export function getSlimeTrailCellThickness(remainingTicks: number, seed: number, cellIndex: number): 0 | 1 | 2 | 3 {
  if (remainingTicks <= 0) return 0;
  const life = Math.max(0, Math.min(1, remainingTicks / SLIME_SNAIL_TRAIL_LIFETIME_TICKS));
  const jitter = (((seed ^ Math.imul(cellIndex + 1, 0x9e3779b1)) >>> 0) % 100) / 100;
  if (life > 0.55 + jitter * 0.12) return 3;
  if (life > 0.22 + jitter * 0.18) return 2;
  if (life > 0.035 + jitter * 0.12) return 1;
  return jitter < life * 12 ? 1 : 0;
}

export function renderSlimeSnailTrails(
  ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, scale: number, ox: number, oy: number,
): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  const stride = snapshot.slimeSnailTrailStride;
  for (let slot = 0; slot < snapshot.slimeSnailTrailCount.length; slot++) {
    const count = snapshot.slimeSnailTrailCount[slot];
    const base = slot * stride;
    for (let i = 0; i < count; i++) {
      const flat = base + i;
      const remaining = snapshot.slimeSnailTrailRemainingTicks[flat];
      if (remaining <= 0) continue;
      const col = snapshot.slimeSnailTrailCol[flat];
      const row = snapshot.slimeSnailTrailRow[flat];
      const side = snapshot.slimeSnailTrailSideIndex[flat];
      const seed = snapshot.slimeSnailTrailVisualSeed[flat];
      for (let cell = 0; cell < BLOCK_SIZE_SMALL; cell++) {
        const thickness = getSlimeTrailCellThickness(remaining, seed, cell);
        for (let depth = 0; depth < thickness; depth++) {
          const bubble = ((seed + cell * 17 + depth * 31 + Math.floor(snapshot.tick / 12)) % 29) === 0;
          ctx.fillStyle = bubble ? '#c8f5a3' : depth === thickness - 1 ? '#62b94f' : '#318b3f';
          let x = col * BLOCK_SIZE_SMALL;
          let y = row * BLOCK_SIZE_SMALL;
          if (side === 0) { x += cell; y -= depth + 1; }
          else if (side === 1) { x += BLOCK_SIZE_SMALL + depth; y += cell; }
          else if (side === 2) { x += cell; y += BLOCK_SIZE_SMALL + depth; }
          else { x -= depth + 1; y += cell; }
          ctx.fillRect(Math.round(x * scale + ox), Math.round(y * scale + oy), Math.max(1, Math.ceil(scale)), Math.max(1, Math.ceil(scale)));
        }
      }
    }
  }
  ctx.restore();
}

export function renderSlimeSnailBody(
  ctx: CanvasRenderingContext2D, snail: ClusterSnapshot, scale: number, ox: number, oy: number,
): void {
  const x = Math.round(snail.renderPositionXWorld * scale + ox);
  const y = Math.round(snail.renderPositionYWorld * scale + oy);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  ctx.rotate(snail.slimeSnailBodyAngleRad);
  ctx.fillStyle = '#87d66b'; ctx.fillRect(-4 * scale, 0, 8 * scale, 2 * scale);
  ctx.fillStyle = '#2d7138'; ctx.fillRect(-2 * scale, -3 * scale, 4 * scale, 4 * scale);
  ctx.fillStyle = '#4d9a4c'; ctx.fillRect(-1 * scale, -2 * scale, 2 * scale, 2 * scale);
  ctx.fillStyle = '#d9ffc1'; ctx.fillRect(3 * scale, -1 * scale, Math.max(1, scale), Math.max(1, scale));
  ctx.restore();
}
