/**
 * Independent Sword Weave Renderer (Stage 5).
 *
 * Renders the new, independently-unlockable single-crescent sword swipe
 * driven by `world.newSword*` fields (see `sim/weaves/swordWeave.ts`
 * `startNewSwordSwipe` / `tickNewSwordSwipe`), distinct from the legacy
 * single-slot `SwordWeaveRenderer` (`swordWeaveRenderer.ts`, `SWORD_STATE_*`).
 *
 * Visual: an aimed crescent slash — a short tapered trail of fading segments
 * sweeping from the swipe's current angle backward a small arc, at a reach
 * that scales with `newSwordReachWorld` (already computed by sim from
 * available motes — never recomputed here). No ordinary motes are drawn as
 * part of the blade (the sim does not spawn render-only motes for the new
 * sword, and this renderer does not fabricate any either).
 *
 * Sword → Shield handoff: `world.newSwordToShieldTransition01` flips from 0
 * to 1 (discretely, in sim) the tick the swipe animation finishes. This
 * renderer owns the SMOOTH interpolation of that handoff — easing a
 * render-local value toward the sim's target each frame — fading the blade
 * out as the value approaches 1 (by which point Shield's own crescent, drawn
 * by the generic particle renderer from the real mote positions
 * `applyShieldWeaveCrescent()` already set, has taken over the same
 * particles in place).
 *
 * No sim state is mutated — `_smoothedTransition01` and `_prevActiveFlag`
 * are render-local instance fields only, never written back to WorldState.
 * No per-frame allocations — all draw calls are direct ctx.fillRect /
 * ctx.save/restore, and the trail sample loop uses a fixed iteration count.
 */

import { WorldSnapshot } from '../snapshot';
import { getDustDefinition } from '../../sim/weaves/dustDefinition';
import { ParticleKind } from '../../sim/particles/kinds';

/** Half-size of one blade/trail mote square (virtual pixels). */
const MOTE_HALF_PX = 1.6;
/** Number of samples drawn along the short trail arc. */
const TRAIL_SAMPLE_COUNT = 8;
/** Backward arc (radians) the trail extends behind the current sweep angle. */
const TRAIL_ARC_RAD = 0.55;
/** Per-frame easing rate for the render-local sword→shield transition smoothing. */
const TRANSITION_SMOOTHING_RATE = 0.15;

/**
 * Eases `current` toward `target` by `rate` (clamped to [0, 1]), and clamps
 * the result to [0, 1]. Pure function — used by the renderer and unit-tested
 * in isolation from any canvas draw call.
 */
export function advanceSwordShieldTransitionSmoothing(
  current: number,
  target: number,
  rate: number = TRANSITION_SMOOTHING_RATE,
): number {
  const clampedTarget = Math.min(1, Math.max(0, target));
  const next = current + (clampedTarget - current) * Math.min(1, Math.max(0, rate));
  return Math.min(1, Math.max(0, next));
}

export class NewSwordWeaveRenderer {
  /** Render-local smoothed sword→shield transition progress — never written to WorldState. */
  private _smoothedTransition01 = 0;
  private _prevActiveFlag: 0 | 1 = 0;

  /**
   * Resets render-local smoothing/interpolation state to its fresh-load
   * default. Intended to be called on room/world load so a stale
   * near-complete sword→shield transition from the previous room can never
   * bleed a single frame into the new one. No sim state is touched.
   */
  reset(): void {
    this._smoothedTransition01 = 0;
    this._prevActiveFlag = 0;
  }

  render(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    ox: number,
    oy: number,
    zoom: number,
  ): void {
    if (snapshot.hasSwordWeaveUnlockedFlag !== 1) return;

    // Reset the smoothing baseline at the start of a fresh swipe so a rapid
    // re-press doesn't inherit a stale near-1 transition value.
    if (snapshot.newSwordActiveFlag === 1 && this._prevActiveFlag === 0) {
      this._smoothedTransition01 = 0;
    }
    this._prevActiveFlag = snapshot.newSwordActiveFlag === 1 ? 1 : 0;

    this._smoothedTransition01 = advanceSwordShieldTransitionSmoothing(
      this._smoothedTransition01,
      snapshot.newSwordToShieldTransition01,
    );

    const bladeAlpha = 1.0 - this._smoothedTransition01;
    const isActive = snapshot.newSwordActiveFlag === 1;
    if (!isActive && bladeAlpha <= 0.01) return;
    if (snapshot.newSwordReachWorld <= 0) return;

    const handXPx = snapshot.newSwordHandAnchorXWorld * zoom + ox;
    const handYPx = snapshot.newSwordHandAnchorYWorld * zoom + oy;
    const currentAngleRad = snapshot.newSwordCurrentAngleRad;
    const reachWorld = snapshot.newSwordReachWorld;

    const dustKind: ParticleKind = snapshot.selectedDustKind;
    const def = getDustDefinition(dustKind);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = def.colorHex;

    const halfPx = MOTE_HALF_PX * zoom;
    for (let s = 0; s < TRAIL_SAMPLE_COUNT; s++) {
      const t = s / (TRAIL_SAMPLE_COUNT - 1); // 0 = tail, 1 = tip
      const a = currentAngleRad - TRAIL_ARC_RAD * (1.0 - t);
      const distWorld = reachWorld * (0.35 + 0.65 * t);
      const x = handXPx + Math.cos(a) * distWorld * zoom;
      const y = handYPx + Math.sin(a) * distWorld * zoom;
      ctx.globalAlpha = bladeAlpha * (0.12 + 0.75 * t);
      ctx.fillRect(x - halfPx, y - halfPx, halfPx * 2, halfPx * 2);
    }

    // Bright tip mote at full reach.
    const tipX = handXPx + Math.cos(currentAngleRad) * reachWorld * zoom;
    const tipY = handYPx + Math.sin(currentAngleRad) * reachWorld * zoom;
    ctx.globalAlpha = bladeAlpha;
    ctx.fillRect(tipX - halfPx * 1.4, tipY - halfPx * 1.4, halfPx * 2.8, halfPx * 2.8);

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}
