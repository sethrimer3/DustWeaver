/**
 * Bow Aim-Line Preview Renderer.
 *
 * Draws a thin, fading STRAIGHT preview line from the shield center along the
 * current aim direction while the Bow arrow is assembling (Press/Holding).
 * The Bow Weave no longer has a draw-strength / ballistic arc, so the preview
 * is always a straight ray — there is no parabola, no gravity, and no
 * per-tier curve. The line is clipped at the first wall along the aim (using
 * the same `raycastWalls()` helper the real arrow uses) or at the Gold Dust
 * maximum outbound travel distance, whichever is closer.
 *
 * Origin and fallback direction (task section 2 / 8): the preview starts from
 * the SAME shield-center point (`shieldGeometry.computeShieldCenterWorld`)
 * the simulation seats and launches the arrow from — never the player's raw
 * body position — and when the aim point sits exactly on the player (a
 * zero-length aim delta), it falls back to `snapshot.bowArrowDirXWorld/YWorld`
 * — the simulation's own authoritative last-resolved direction — rather than
 * inventing an independent default. This guarantees the preview and the
 * simulated arrow always agree, including at the degenerate zero-length case.
 *
 * No sim state is mutated. All render-local smoothing state (fade in/out) lives
 * in this class, never written back to WorldState.
 */

import { WorldSnapshot } from '../snapshot';
import { WorldState } from '../../sim/world';
import { raycastWalls } from '../../sim/clusters/grappleShared';
import { getDustDefinition } from '../../sim/weaves/dustDefinition';
import { ParticleKind } from '../../sim/particles/kinds';
import { SecondaryWeaveGesturePhase } from '../../input/secondaryWeaveGesture';
import { GOLD_DUST_MAX_TRAVEL_PX } from '../../sim/motes/moteTypeConfig';
import { BOW_ARROW_PHASE_ASSEMBLING } from '../../sim/weaves/bowArrow';
import { computeShieldCenterWorld } from '../../sim/weaves/shieldGeometry';

/** Default preview length (world units) when no terrain is hit — the Gold Dust max travel. */
export const BOW_PREVIEW_MAX_RANGE_WORLD = GOLD_DUST_MAX_TRAVEL_PX;
/** Per-frame smoothing rate for the fade in/out alpha (higher = snappier). */
const FADE_SMOOTHING_RATE = 0.22;

/** Optional terrain raycast hook — same shape as `raycastWalls`'s return, decoupled for testability. */
export type BowPreviewRaycastFn = (
  x: number, y: number, dirX: number, dirY: number, maxDist: number,
) => { x: number; y: number } | null;

/**
 * Computes the straight aim-line end point: `startXWorld/YWorld` extended
 * along the unit aim direction by `maxRangeWorld`, clipped to the first wall
 * hit if any. When `aimDirXWorld/YWorld` has ~zero length (the aim point sits
 * exactly on the start point), falls back to `fallbackDirXWorld/YWorld`
 * instead of inventing an independent default — callers should pass the
 * simulation's own last-resolved direction (e.g. `snapshot.bowArrowDirXWorld/
 * YWorld`) so the preview can never disagree with the simulated arrow at this
 * degenerate case (task section 8). Writes the end point into `out` and
 * returns it. Pure and allocation-free (writes into the caller-provided
 * object).
 */
export function computeStraightBowAimEnd(
  out: { x: number; y: number },
  startXWorld: number,
  startYWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
  maxRangeWorld: number,
  raycast: BowPreviewRaycastFn | null,
  fallbackDirXWorld = 1,
  fallbackDirYWorld = 0,
): { x: number; y: number } {
  const len = Math.hypot(aimDirXWorld, aimDirYWorld);
  const dirX = len > 1e-6 ? aimDirXWorld / len : fallbackDirXWorld;
  const dirY = len > 1e-6 ? aimDirYWorld / len : fallbackDirYWorld;

  if (raycast !== null) {
    const hit = raycast(startXWorld, startYWorld, dirX, dirY, maxRangeWorld);
    if (hit !== null) {
      out.x = hit.x;
      out.y = hit.y;
      return out;
    }
  }
  out.x = startXWorld + dirX * maxRangeWorld;
  out.y = startYWorld + dirY * maxRangeWorld;
  return out;
}

/**
 * Pure visibility predicate — the straight aim line is shown only while the Bow
 * is unlocked, the gesture is held, and the arrow is assembling.
 */
export function computeBowPreviewShouldBeVisible(
  hasBowWeaveUnlockedFlag: 0 | 1,
  gesturePhase: SecondaryWeaveGesturePhase,
  bowArrowPhase: number,
): boolean {
  const isHeldPhase =
    gesturePhase === SecondaryWeaveGesturePhase.Press || gesturePhase === SecondaryWeaveGesturePhase.Holding;
  return (
    hasBowWeaveUnlockedFlag === 1 &&
    isHeldPhase &&
    bowArrowPhase === BOW_ARROW_PHASE_ASSEMBLING
  );
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export class BowTrajectoryPreviewRenderer {
  /** Render-local smoothed visibility alpha (never written to WorldState). */
  private _visibleAlpha = 0;
  private readonly _end = { x: 0, y: 0 };
  private readonly _origin = { x: 0, y: 0 };

  /**
   * Resets render-local smoothing state to its fresh-load default so a stale
   * visibility fade from the previous room never bleeds into the new one.
   */
  reset(): void {
    this._visibleAlpha = 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    world: WorldState,
    ox: number,
    oy: number,
    zoom: number,
  ): void {
    const shouldBeVisible = computeBowPreviewShouldBeVisible(
      snapshot.hasBowWeaveUnlockedFlag,
      snapshot.secondaryWeaveGesturePhase,
      snapshot.bowArrowPhase,
    );

    const targetAlpha = shouldBeVisible ? 1.0 : 0.0;
    this._visibleAlpha += (targetAlpha - this._visibleAlpha) * FADE_SMOOTHING_RATE;
    if (this._visibleAlpha < 0.01) {
      this._visibleAlpha = 0;
      return;
    }

    let playerXWorld = 0;
    let playerYWorld = 0;
    let playerFound = false;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      const c = snapshot.clusters[ci];
      if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
        playerXWorld = c.renderPositionXWorld;
        playerYWorld = c.renderPositionYWorld;
        playerFound = true;
        break;
      }
    }
    if (!playerFound) return;

    const aimXWorld = snapshot.secondaryWeaveGestureHoldAimXWorld;
    const aimYWorld = snapshot.secondaryWeaveGestureHoldAimYWorld;
    const dx = aimXWorld - playerXWorld;
    const dy = aimYWorld - playerYWorld;

    // Simulation-owned fallback direction — see computeStraightBowAimEnd's
    // doc comment. Also used to resolve the shield-center origin so the
    // origin point itself agrees with the simulation at the zero-length case.
    const fallbackDirX = snapshot.bowArrowDirXWorld;
    const fallbackDirY = snapshot.bowArrowDirYWorld;

    const origin = computeShieldCenterWorld(
      this._origin, playerXWorld, playerYWorld, dx, dy, fallbackDirX, fallbackDirY,
    );

    const raycast: BowPreviewRaycastFn = (x, y, ndx, ndy, maxDist) => raycastWalls(world, x, y, ndx, ndy, maxDist);
    const end = computeStraightBowAimEnd(
      this._end, origin.x, origin.y, dx, dy, BOW_PREVIEW_MAX_RANGE_WORLD, raycast, fallbackDirX, fallbackDirY,
    );

    const dustKind: ParticleKind = snapshot.selectedDustKind;
    const colorHex = getDustDefinition(dustKind).colorHex;

    const x0 = origin.x * zoom + ox;
    const y0 = origin.y * zoom + oy;
    const x1 = end.x * zoom + ox;
    const y1 = end.y * zoom + oy;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = this._visibleAlpha * 0.5;
    ctx.strokeStyle = colorHex;
    ctx.lineWidth = Math.max(1, 1.2 * zoom);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}
