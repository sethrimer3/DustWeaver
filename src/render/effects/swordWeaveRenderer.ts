/**
 * Shield Sword Weave Renderer.
 *
 * Renders a golden-crossguard sword for the Shield Sword Weave on the 2-D
 * canvas.  The sword visual lives entirely in render-land — it does NOT
 * mutate any sim state.  It reads the sword-state fields populated by
 * sim/weaves/swordWeave.ts each tick.
 *
 * Visual layout:
 *
 *   • A golden plus-shaped crossguard made of 5 square gold motes:
 *
 *         [ ]          ← top  (blade origin)
 *      [ ][ ][ ]       ← left, center, right
 *         [ ]          ← bottom (handle anchor at hand)
 *
 *   • A blade extending outward from the top of the crossguard, drawn as a
 *     row of MAX_SWORD_BLADE_MOTES gold mote squares.  The blade fades and
 *     compresses during FORMING/RECOVERING and fully extends at READY.
 *
 *   • A short slash-trail arc rendered during SLASHING — connecting the
 *     start and end of the angular sweep with a series of fading gold mote
 *     squares.
 *
 * Render-order strategy: this renderer draws AFTER renderClusters() (so the
 * sword sits on top of the player body), matching the pattern used by
 * ArrowWeaveRenderer.  The crossguard's bottom mote is intentionally
 * positioned at the player's hand anchor, slightly forward of the body.
 *
 * Performance:
 *   • No per-frame allocations — all draw work is direct ctx.fillRect /
 *     ctx.save/restore calls.
 *   • One ctx.save() and one ctx.restore() per render() call.
 *   • Bails out early when the sword is in ORBIT or SHIELDING state.
 */

import { WorldSnapshot } from '../snapshot';
import {
  SWORD_STATE_ORBIT,
  SWORD_STATE_FORMING,
  SWORD_STATE_WINDUP,
  SWORD_STATE_SLASHING,
  SWORD_STATE_RECOVERING,
  SWORD_STATE_SHIELDING,
  MAX_SWORD_BLADE_MOTES,
  SWORD_REACH_WORLD,
} from '../../sim/weaves/swordWeave';
import { WEAVE_SHIELD_SWORD } from '../../sim/weaves/weaveDefinition';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Side length (virtual pixels) of one mote square. */
const MOTE_SIZE_PX = 3;
/** Half-size of one mote square (virtual pixels). */
const MOTE_HALF_PX = MOTE_SIZE_PX * 0.5;

/** Gold colour for player motes (matches Storm/Shield/Arrow weaves). */
const GOLD_COLOR     = '#ffd700';
/** Brighter gold used for the crossguard's center mote. */
const GOLD_HOT_COLOR = '#fff2a8';

/** Spacing between crossguard motes (world units). */
const CROSSGUARD_SPACING_WORLD = 1.5;

/**
 * Distance from the hand anchor (bottom of the crossguard) to the crossguard
 * center, in world units.  The crossguard sits a small distance up the blade
 * from the hand, with the handle implicit between the hand and the bottom mote.
 */
const CROSSGUARD_OFFSET_FROM_HAND_WORLD = 2.5;

/** World-space spacing between consecutive blade mote squares. */
const BLADE_MOTE_SPACING_WORLD = SWORD_REACH_WORLD / (MAX_SWORD_BLADE_MOTES + 1);

/** Number of slash-trail samples drawn across the sweep. */
const SLASH_TRAIL_SAMPLE_COUNT = 12;

// ── Renderer class ────────────────────────────────────────────────────────────

export class SwordWeaveRenderer {
  /**
   * Renders the sword for this frame.
   *
   * @param ctx       2-D canvas context for the virtual canvas.
   * @param snapshot  Current world snapshot.
   * @param ox        Camera X offset (virtual pixels).
   * @param oy        Camera Y offset (virtual pixels).
   * @param zoom      Camera zoom (virtual pixels per world unit).
   */
  render(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    ox: number,
    oy: number,
    zoom: number,
  ): void {
    // Only draw when the player has Shield Sword equipped as secondary.
    if (snapshot.playerSecondaryWeaveId !== WEAVE_SHIELD_SWORD) return;

    const state = snapshot.swordWeaveStateEnum;
    // Hide entirely while orbiting (initial state) or while shielding —
    // the existing Shield crescent and ambient orbit do the visual work.
    if (state === SWORD_STATE_ORBIT || state === SWORD_STATE_SHIELDING) return;

    // Ensure we have a live player to anchor against.
    let playerFound = false;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      const c = snapshot.clusters[ci];
      if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
        playerFound = true;
        break;
      }
    }
    if (!playerFound) return;

    const handXPx = snapshot.swordWeaveHandAnchorXWorld * zoom + ox;
    const handYPx = snapshot.swordWeaveHandAnchorYWorld * zoom + oy;
    const angleRad = snapshot.swordWeaveAngleRad;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // FORMING and RECOVERING ramp the blade extension and alpha for a cleaner
    // appear/disappear feel.
    let alpha = 1.0;
    let extension = 1.0;
    if (state === SWORD_STATE_FORMING) {
      // Linearly grow from 0 → 1 across SWORD_FORMING_TICKS.  We don't have
      // the exact tick budget here, so use a conservative ramp based on the
      // recorded elapsed ticks (clamped to 1 at ~15 ticks).
      const t = Math.min(1.0, snapshot.swordWeaveStateTicksElapsed / 15);
      alpha = t;
      extension = t;
    } else if (state === SWORD_STATE_WINDUP) {
      alpha = 1.0;
      extension = 1.0;
    } else if (state === SWORD_STATE_RECOVERING) {
      const t = Math.min(1.0, snapshot.swordWeaveStateTicksElapsed / 18);
      alpha = 1.0 - 0.25 * t; // subtle dim during recovery
      extension = 1.0;
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    // ── Draw blade ──────────────────────────────────────────────────────────
    ctx.globalAlpha = alpha * 0.95;
    ctx.fillStyle = GOLD_COLOR;
    const bladeStartXPx = handXPx + cosA * CROSSGUARD_OFFSET_FROM_HAND_WORLD * zoom;
    const bladeStartYPx = handYPx + sinA * CROSSGUARD_OFFSET_FROM_HAND_WORLD * zoom;
    for (let m = 1; m <= MAX_SWORD_BLADE_MOTES; m++) {
      const distWorld = (m * BLADE_MOTE_SPACING_WORLD) * extension;
      const mx = bladeStartXPx + cosA * distWorld * zoom;
      const my = bladeStartYPx + sinA * distWorld * zoom;
      const halfPx = MOTE_HALF_PX * zoom;
      ctx.fillRect(mx - halfPx, my - halfPx, halfPx * 2, halfPx * 2);
    }

    // ── Draw crossguard (5 squares in a plus, perpendicular to the blade) ──
    // Crossguard center is at the bottom of the blade root; "left/right"
    // arms are along the perpendicular to the sword angle.
    const crossCenterXPx = bladeStartXPx;
    const crossCenterYPx = bladeStartYPx;
    // Perpendicular unit vector
    const perpX = -sinA;
    const perpY = cosA;
    const stepPx = CROSSGUARD_SPACING_WORLD * zoom;
    const halfPx = MOTE_HALF_PX * zoom;

    // Center mote (hot gold)
    ctx.globalAlpha = alpha;
    ctx.fillStyle = GOLD_HOT_COLOR;
    ctx.fillRect(crossCenterXPx - halfPx, crossCenterYPx - halfPx, halfPx * 2, halfPx * 2);

    // Top, bottom, left, right (regular gold)
    ctx.fillStyle = GOLD_COLOR;
    // Top (toward blade tip)
    ctx.fillRect(
      crossCenterXPx + cosA * stepPx - halfPx,
      crossCenterYPx + sinA * stepPx - halfPx,
      halfPx * 2, halfPx * 2,
    );
    // Bottom (toward hand) — this is the hand-side anchor square
    ctx.fillRect(
      crossCenterXPx - cosA * stepPx - halfPx,
      crossCenterYPx - sinA * stepPx - halfPx,
      halfPx * 2, halfPx * 2,
    );
    // Left arm
    ctx.fillRect(
      crossCenterXPx + perpX * stepPx - halfPx,
      crossCenterYPx + perpY * stepPx - halfPx,
      halfPx * 2, halfPx * 2,
    );
    // Right arm
    ctx.fillRect(
      crossCenterXPx - perpX * stepPx - halfPx,
      crossCenterYPx - perpY * stepPx - halfPx,
      halfPx * 2, halfPx * 2,
    );

    // ── Draw slash trail during SLASHING ────────────────────────────────────
    if (state === SWORD_STATE_SLASHING) {
      this._drawSlashTrail(ctx, snapshot, handXPx, handYPx, zoom);
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Draws a series of fading mote squares along the slash arc, from the
   * starting blade position to the current blade position.  This produces
   * a simple, performant slash trail without allocating any objects.
   */
  private _drawSlashTrail(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    handXPx: number,
    handYPx: number,
    zoom: number,
  ): void {
    const startA = snapshot.swordWeaveSlashStartAngleRad;
    const endA   = snapshot.swordWeaveSlashEndAngleRad;
    // Shortest signed delta
    let delta = endA - startA;
    while (delta > Math.PI) delta -= 2.0 * Math.PI;
    while (delta <= -Math.PI) delta += 2.0 * Math.PI;

    // Trail extends from startA to current swordWeaveAngleRad.
    const currentA = snapshot.swordWeaveAngleRad;
    let trailDelta = currentA - startA;
    while (trailDelta > Math.PI) trailDelta -= 2.0 * Math.PI;
    while (trailDelta <= -Math.PI) trailDelta += 2.0 * Math.PI;

    const tipDistWorld = SWORD_REACH_WORLD;
    const halfPx = MOTE_HALF_PX * zoom;
    ctx.fillStyle = GOLD_COLOR;
    for (let s = 0; s < SLASH_TRAIL_SAMPLE_COUNT; s++) {
      const t = s / (SLASH_TRAIL_SAMPLE_COUNT - 1);
      const a = startA + trailDelta * t;
      // Older samples (small t) fade; newest (t≈1) is bright.
      ctx.globalAlpha = 0.15 + 0.55 * t;
      const tipX = handXPx + Math.cos(a) * tipDistWorld * zoom;
      const tipY = handYPx + Math.sin(a) * tipDistWorld * zoom;
      ctx.fillRect(tipX - halfPx, tipY - halfPx, halfPx * 2, halfPx * 2);

      // Mid-blade arc dot for thickness
      const midX = handXPx + Math.cos(a) * tipDistWorld * 0.6 * zoom;
      const midY = handYPx + Math.sin(a) * tipDistWorld * 0.6 * zoom;
      ctx.globalAlpha = 0.10 + 0.30 * t;
      ctx.fillRect(midX - halfPx, midY - halfPx, halfPx * 2, halfPx * 2);
    }
  }
}
