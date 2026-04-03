/**
 * Radiant Tether — chain rendering helpers.
 *
 * Pure rendering math extracted from radiantTetherChains.ts so the sim
 * module has no render-side coupling.
 */

// ── Catenary sag helper for rendering ───────────────────────────────────────

/**
 * Generates points along a sagging chain from A to B.
 * Uses a simple parabolic approximation for visual sag.
 * Returns an array of { x, y } pairs.
 */
export function computeChainSagPoints(
  ax: number, ay: number,
  bx: number, by: number,
  segmentCount: number,
  sagFactor: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const sagAmount = dist * sagFactor;

  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount;
    const baseX = ax + dx * t;
    const baseY = ay + dy * t;
    // Parabolic sag: maximum at midpoint, zero at endpoints
    const sag = sagAmount * 4 * t * (1 - t);
    points.push({ x: baseX, y: baseY + sag });
  }
  return points;
}
