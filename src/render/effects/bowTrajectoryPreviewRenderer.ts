/**
 * Bow Trajectory Preview Renderer (Stage 5).
 *
 * Draws a thin, fading preview line showing where the currently-charging
 * Bow Weave arrow will fly, for the CURRENT tier (2/3/4 motes). Visible for
 * the whole held gesture (Press/Holding), independent of whether Sword or
 * Shield are also active this tick, per the Stage 5 spec.
 *
 * Physics parity: `sampleBowTrajectory()` below calls the exact same
 * `getBowSpeedForMoteCount` / `getBowGravityForMoteCount` functions from
 * `sim/weaves/bowProjectilePhysics.ts` that the real fired arrow uses
 * (`sim/weaves/arrowWeave.ts` `_updateArrowFlight` / `sim/weaves/bowWeave.ts`
 * `fireNewBow`), and integrates with the identical fixed-step convention:
 * gravity added to vertical velocity first, then position advanced by
 * velocity * dt, with a wall raycast each step using the same
 * `raycastWalls()` helper the real arrow uses for terrain sticking.
 *
 * No sim state is mutated. All render-local smoothing state (fade in/out)
 * lives in this class, never written back to WorldState.
 */

import { WorldSnapshot } from '../snapshot';
import { WorldState } from '../../sim/world';
import { raycastWalls } from '../../sim/clusters/grappleShared';
import {
  getBowSpeedForMoteCount,
  getBowGravityForMoteCount,
} from '../../sim/weaves/bowProjectilePhysics';
import { getDustDefinition } from '../../sim/weaves/dustDefinition';
import { ParticleKind } from '../../sim/particles/kinds';
import { SecondaryWeaveGesturePhase } from '../../input/secondaryWeaveGesture';

/** Fixed-length reusable sample buffer size — no per-frame allocation. */
export const MAX_BOW_PREVIEW_SAMPLES = 24;
/** Time step (seconds) per preview sample — coarser than the 60 fps sim tick for a cheap preview. */
export const BOW_PREVIEW_STEP_SEC = 1.0 / 30.0;
/** Hard cap on preview travel distance (world units) when no terrain is hit. */
export const BOW_PREVIEW_MAX_RANGE_WORLD = 220.0;
/** Per-frame smoothing rate for the fade in/out alpha (higher = snappier). */
const FADE_SMOOTHING_RATE = 0.22;

/** Optional terrain raycast hook — same shape as `raycastWalls`'s return, decoupled for testability. */
export type BowPreviewRaycastFn = (
  x: number, y: number, dirX: number, dirY: number, maxDist: number,
) => { x: number; y: number } | null;

/**
 * Samples the predicted arrow trajectory into the caller-provided fixed
 * buffers (no allocation). Returns the number of valid samples written
 * (always >= 1: index 0 is always the start point).
 *
 * Uses the SAME `getBowSpeedForMoteCount` / `getBowGravityForMoteCount`
 * functions as the real projectile — this is what proves no physics drift
 * between the preview and the fired arrow (see bowTrajectoryPreviewRenderer.test.ts).
 */
export function sampleBowTrajectory(
  outXWorld: Float32Array,
  outYWorld: Float32Array,
  startXWorld: number,
  startYWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
  moteCount: number,
  raycast: BowPreviewRaycastFn | null,
  maxSamples: number = MAX_BOW_PREVIEW_SAMPLES,
): number {
  const speed = getBowSpeedForMoteCount(moteCount);
  const gravity = getBowGravityForMoteCount(moteCount);

  let x = startXWorld;
  let y = startYWorld;
  let vx = aimDirXWorld * speed;
  let vy = aimDirYWorld * speed;

  outXWorld[0] = x;
  outYWorld[0] = y;
  let count = 1;
  let traveledWorld = 0;

  const cap = Math.min(maxSamples, outXWorld.length, outYWorld.length);

  for (let i = 1; i < cap; i++) {
    // Same integration order as arrowWeave.ts's _updateArrowFlight: gravity
    // applied to vertical velocity first, then position advanced by vel*dt.
    vy += gravity * BOW_PREVIEW_STEP_SEC;

    const dx = vx * BOW_PREVIEW_STEP_SEC;
    const dy = vy * BOW_PREVIEW_STEP_SEC;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 0.001 && raycast !== null) {
      const ndx = dx / dist;
      const ndy = dy / dist;
      const hit = raycast(x, y, ndx, ndy, dist);
      if (hit !== null) {
        outXWorld[count] = hit.x;
        outYWorld[count] = hit.y;
        count++;
        break;
      }
    }

    x += dx;
    y += dy;
    traveledWorld += dist;
    outXWorld[count] = x;
    outYWorld[count] = y;
    count++;

    if (traveledWorld >= BOW_PREVIEW_MAX_RANGE_WORLD) break;
  }

  return count;
}

/**
 * Pure visibility predicate — extracted so the "hide below 2 motes" /
 * "only during held gesture" rules are unit-testable without a canvas.
 * The renderer chose to fully HIDE the preview when fewer than 2 motes are
 * available (rather than drawing a faint invalid-state line).
 */
export function computeBowPreviewShouldBeVisible(
  hasBowWeaveUnlockedFlag: 0 | 1,
  gesturePhase: SecondaryWeaveGesturePhase,
  newBowChargingFlag: 0 | 1,
  newBowTierMoteCount: number,
): boolean {
  const isHeldPhase =
    gesturePhase === SecondaryWeaveGesturePhase.Press || gesturePhase === SecondaryWeaveGesturePhase.Holding;
  return (
    hasBowWeaveUnlockedFlag === 1 &&
    isHeldPhase &&
    newBowChargingFlag === 1 &&
    newBowTierMoteCount >= 2
  );
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export class BowTrajectoryPreviewRenderer {
  /** Preallocated sample buffers reused every frame — no per-frame allocation. */
  private readonly _xs = new Float32Array(MAX_BOW_PREVIEW_SAMPLES);
  private readonly _ys = new Float32Array(MAX_BOW_PREVIEW_SAMPLES);
  /** Render-local smoothed visibility alpha (never written to WorldState). */
  private _visibleAlpha = 0;

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
      snapshot.newBowChargingFlag,
      snapshot.newBowTierMoteCount,
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
    const dist = Math.sqrt(dx * dx + dy * dy);
    const aimDirX = dist > 1e-6 ? dx / dist : 1;
    const aimDirY = dist > 1e-6 ? dy / dist : 0;

    const moteCount = snapshot.newBowTierMoteCount;
    const raycast: BowPreviewRaycastFn = (x, y, ndx, ndy, maxDist) => raycastWalls(world, x, y, ndx, ndy, maxDist);
    const count = sampleBowTrajectory(
      this._xs, this._ys,
      playerXWorld, playerYWorld,
      aimDirX, aimDirY,
      moteCount,
      raycast,
    );

    const dustKind: ParticleKind = snapshot.currentWeaveDustKind;
    const colorHex = getDustDefinition(dustKind).colorHex;

    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < count - 1; i++) {
      const t0 = i / Math.max(1, count - 1);
      const t1 = (i + 1) / Math.max(1, count - 1);
      // Brighter near the player, fully transparent at the far end.
      const segAlpha = this._visibleAlpha * (1.0 - t0) * 0.55;
      if (segAlpha <= 0.01) continue;
      const x0 = this._xs[i] * zoom + ox;
      const y0 = this._ys[i] * zoom + oy;
      const x1 = this._xs[i + 1] * zoom + ox;
      const y1 = this._ys[i + 1] * zoom + oy;
      ctx.globalAlpha = segAlpha;
      ctx.strokeStyle = colorHex;
      ctx.lineWidth = Math.max(1, 1.4 * zoom * (1.0 - t1 * 0.4));
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}
