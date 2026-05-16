import type { ClusterSnapshot, WorldSnapshot } from '../snapshot';
import { BEES_PER_SWARM } from '../../sim/world';

// ── Bubble enemies ───────────────────────────────────────────────────────────

export function renderWaterBubbleBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  healthRatio: number,
): void {
  const alpha = 0.15 + healthRatio * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(40,120,220,${alpha.toFixed(2)})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(80,180,255,${(0.55 + healthRatio * 0.35).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function renderIceBubbleBody(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radiusPx: number,
  healthRatio: number,
): void {
  const alpha = 0.12 + healthRatio * 0.18;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(200,235,255,${alpha.toFixed(2)})`;
  ctx.fill();
  ctx.strokeStyle = `rgba(220,245,255,${(0.6 + healthRatio * 0.3).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ── Bee Swarm ────────────────────────────────────────────────────────────────

/**
 * Renders a bee swarm: draws each alive bee as a 4×2 sprite made of two
 * 2×2 pixel squares — a gold head square and a black butt square.
 *
 * The sprite faces the direction of the bee's velocity:
 *   • Moving right (velX ≥ 0): gold on the RIGHT, black on the LEFT
 *     (head in direction of travel, butt behind).
 *   • Moving left  (velX < 0): gold on the LEFT,  black on the RIGHT.
 *
 * `aliveCount` is `cluster.healthPoints`; bees at index ≥ aliveCount are dead.
 */
export function renderBeeSwarm(
  ctx: CanvasRenderingContext2D,
  cluster: ClusterSnapshot,
  snapshot: WorldSnapshot,
  scalePx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const slot = cluster.beeSwarmSlotIndex;
  if (slot < 0) return;

  const aliveCount = cluster.healthPoints;
  const base       = slot * BEES_PER_SWARM;

  const isCharging = cluster.beeSwarmState === 1;

  for (let bi = 0; bi < aliveCount; bi++) {
    const idx = base + bi;
    const bx  = snapshot.beeSwarmBeeXWorld[idx];
    const by  = snapshot.beeSwarmBeeYWorld[idx];
    const bvx = snapshot.beeSwarmBeeVelXWorld[idx];

    // Each bee is 4 wide × 2 tall in world units → 2 px half-width, 1 px half-height
    // The "pixel" size on screen depends on scalePx.
    const halfW = 2 * scalePx; // total 4 world-unit width rendered at scalePx
    const halfH = 1 * scalePx; // total 2 world-unit height

    const cx = bx * scalePx + offsetXPx;
    const cy = by * scalePx + offsetYPx;

    // Each half-square is 2×2 world units = 2*scalePx × 2*scalePx on screen
    const sq = 2 * scalePx;

    // Face right when velocity X ≥ 0: gold head is on the right half
    const facingRight = bvx >= 0;

    // Black (butt) square position
    const buttX = facingRight ? cx - halfW : cx;
    // Gold (head) square position
    const headX = facingRight ? cx         : cx - halfW;
    const squareY = cy - halfH;

    ctx.globalAlpha = isCharging ? 0.95 : 0.82;

    // Draw butt (black square)
    ctx.fillStyle = '#111111';
    ctx.fillRect(buttX, squareY, sq, sq);

    // Draw head (gold square)
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(headX, squareY, sq, sq);

    // Thin amber outline around whole bee (2 pixels wide in world = 1 px thin outline)
    ctx.strokeStyle = isCharging ? '#ff8800' : '#c89000';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cx - halfW, squareY, halfW * 2, sq);
  }

  ctx.globalAlpha = 1.0;
}
