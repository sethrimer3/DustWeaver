/**
 * Arrow Weave Renderer.
 *
 * Handles all visual output for the Arrow Weave secondary:
 *
 *   1. Bow crescent — glowing gold particles that appear while loading.
 *      New motes snap in from random start positions over ~12 frames.
 *
 *   2. Bow dissipation — after the arrow fires, the bow motes squiggle
 *      away in random directions along a snaking path and fade out.
 *
 *   3. Arrow bodies — in-flight and stuck arrows rendered as a line of
 *      gold motes (tip brightest, trailing motes slightly dimmer).
 *
 * All render-side animation state lives here.  No sim state is mutated.
 */

import { WorldSnapshot } from '../snapshot';
import { ARROW_MOTE_SPACING_WORLD } from '../../sim/weaves/arrowWeave';

// ── Bow visual constants ──────────────────────────────────────────────────────

/** Distance from player center to bow crescent center (world units). */
const BOW_DISTANCE_WORLD = 10.0;
/** Radius of the crescent arc (world units). */
const BOW_CRESCENT_RADIUS_WORLD = 6.0;
/** Half-arc span of the crescent (radians). */
const BOW_HALF_ARC_RAD = Math.PI * 0.28;
/** Number of frames a new bow mote takes to snap to its target position. */
const BOW_SNAP_FRAMES = 14;

// ── Dissipation constants ─────────────────────────────────────────────────────

/** Total frames for the dissipation animation after firing. */
const DISSIPATE_FRAMES = 42;
/** Max travel distance (world units) during dissipation. */
const DISSIPATE_DIST_WORLD = 18.0;
/** Perpendicular sine amplitude for the squiggle (world units). */
const DISSIPATE_CURVE_AMP_WORLD = 4.5;
/** Radians per frame of the squiggle sine wave. */
const DISSIPATE_CURVE_FREQ_RAD = 0.28;

// ── Arrow rendering constants ─────────────────────────────────────────────────

/** Half-size of each mote square (virtual pixels). */
const MOTE_HALF_SIZE_PX = 1.5;
/** Gold colour for player motes. */
const MOTE_COLOR = '#ffd700';
/** Tip mote alpha. */
const TIP_ALPHA = 1.0;
/** Alpha reduction per trailing mote. */
const TRAILING_ALPHA_STEP = 0.18;

// ── Types ─────────────────────────────────────────────────────────────────────

interface BowMoteState {
  /** Target crescent position X (virtual pixels). */
  targetXPx: number;
  targetYPx: number;
  /** Starting position for the snap animation (virtual pixels). */
  snapStartXPx: number;
  snapStartYPx: number;
  /** Snap progress [0, 1].  1 = fully at target. */
  snapProgress: number;
}

interface DissipateParticle {
  /** Start position of dissipation (virtual pixels). */
  startXPx: number;
  startYPx: number;
  /** Main travel direction (normalized virtual-pixel coords). */
  mainDirXPx: number;
  mainDirYPx: number;
  /** Perpendicular direction for sine-wave squiggle. */
  perpDirXPx: number;
  perpDirYPx: number;
  /** Phase offset for the sine squiggle. */
  curvePhaseRad: number;
}

// ── Renderer class ────────────────────────────────────────────────────────────

export class ArrowWeaveRenderer {
  // Bow loading state
  private _bowMotes: BowMoteState[] = [];
  private _prevWasLoading = false;

  // Dissipation state
  private _isDissipating = false;
  private _dissipateFrame = 0;
  private _dissipateParticles: DissipateParticle[] = [];

  /**
   * Render all Arrow Weave visuals for this frame.
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
    const isLoading = snapshot.isArrowWeaveLoadingFlag === 1;
    const moteCount = snapshot.arrowWeaveCurrentMoteCount;

    // Find player cluster for bow placement
    let playerXPx = 0;
    let playerYPx = 0;
    let playerFound = false;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      const c = snapshot.clusters[ci];
      if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
        playerXPx = c.renderPositionXWorld * zoom + ox;
        playerYPx = c.renderPositionYWorld * zoom + oy;
        playerFound = true;
        break;
      }
    }

    // ── Transition from loading → not loading → start dissipation ────────────
    if (this._prevWasLoading && !isLoading) {
      this._startDissipation(this._bowMotes, zoom);
      this._bowMotes = [];
    }

    if (isLoading && playerFound) {
      this._updateAndDrawBow(ctx, snapshot, moteCount, playerXPx, playerYPx, zoom);
    }

    if (this._isDissipating) {
      this._drawDissipation(ctx, zoom);
    }

    this._prevWasLoading = isLoading;

    // ── Draw active arrows ───────────────────────────────────────────────────
    this._drawArrows(ctx, snapshot, ox, oy, zoom);
  }

  // ── Bow crescent ─────────────────────────────────────────────────────────

  private _updateAndDrawBow(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    moteCount: number,
    playerXPx: number,
    playerYPx: number,
    zoom: number,
  ): void {
    const aimX = snapshot.playerWeaveAimDirXWorld;
    const aimY = snapshot.playerWeaveAimDirYWorld;

    // Crescent center (virtual pixels)
    const bowCenterXPx = playerXPx + aimX * BOW_DISTANCE_WORLD * zoom;
    const bowCenterYPx = playerYPx + aimY * BOW_DISTANCE_WORLD * zoom;
    const centerAngleRad = Math.atan2(aimY, aimX);

    // Build target positions for all loaded motes
    const targets: { x: number; y: number }[] = [];
    for (let m = 0; m < moteCount; m++) {
      const t = moteCount > 1 ? m / (moteCount - 1) : 0.5;
      const angle = centerAngleRad - BOW_HALF_ARC_RAD + t * 2.0 * BOW_HALF_ARC_RAD;
      targets.push({
        x: bowCenterXPx + Math.cos(angle) * BOW_CRESCENT_RADIUS_WORLD * zoom,
        y: bowCenterYPx + Math.sin(angle) * BOW_CRESCENT_RADIUS_WORLD * zoom,
      });
    }

    // Grow the mote list when new motes appear
    while (this._bowMotes.length < moteCount) {
      const m = this._bowMotes.length;
      const target = targets[m];
      // Snap from a random position near the player
      const rAngle = Math.random() * Math.PI * 2.0;
      const rDist = (8.0 + Math.random() * 12.0) * zoom;
      this._bowMotes.push({
        targetXPx:    target.x,
        targetYPx:    target.y,
        snapStartXPx: playerXPx + Math.cos(rAngle) * rDist,
        snapStartYPx: playerYPx + Math.sin(rAngle) * rDist,
        snapProgress: 0,
      });
    }
    // Trim if somehow count decreased (shouldn't happen, but be safe)
    this._bowMotes.length = moteCount;

    // Update target positions (aim direction may change each frame)
    for (let m = 0; m < moteCount; m++) {
      this._bowMotes[m].targetXPx = targets[m].x;
      this._bowMotes[m].targetYPx = targets[m].y;
    }

    // Advance snap progress
    const snapStep = 1.0 / BOW_SNAP_FRAMES;
    for (let m = 0; m < this._bowMotes.length; m++) {
      this._bowMotes[m].snapProgress = Math.min(1.0, this._bowMotes[m].snapProgress + snapStep);
    }

    // Draw bow motes
    ctx.save();
    for (let m = 0; m < this._bowMotes.length; m++) {
      const bm = this._bowMotes[m];
      const sp = bm.snapProgress;
      // Ease-out snap: cubic
      const easedSp = 1.0 - (1.0 - sp) * (1.0 - sp) * (1.0 - sp);
      const x = bm.snapStartXPx + (bm.targetXPx - bm.snapStartXPx) * easedSp;
      const y = bm.snapStartYPx + (bm.targetYPx - bm.snapStartYPx) * easedSp;

      // Glow aura
      ctx.globalAlpha = 0.35 * easedSp;
      ctx.fillStyle = '#ffe680';
      const glowSize = MOTE_HALF_SIZE_PX * 2.5 * zoom;
      ctx.fillRect(x - glowSize, y - glowSize, glowSize * 2, glowSize * 2);

      // Core mote
      ctx.globalAlpha = 0.9 * easedSp;
      ctx.fillStyle = MOTE_COLOR;
      const halfSz = MOTE_HALF_SIZE_PX * zoom;
      ctx.fillRect(x - halfSz, y - halfSz, halfSz * 2, halfSz * 2);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  // ── Dissipation ───────────────────────────────────────────────────────────

  private _startDissipation(
    bowMotes: BowMoteState[],
    _zoom: number,
  ): void {
    this._isDissipating = true;
    this._dissipateFrame = 0;
    this._dissipateParticles = [];

    for (let m = 0; m < bowMotes.length; m++) {
      const bm = bowMotes[m];
      const rAngle = Math.random() * Math.PI * 2.0;
      const mdx = Math.cos(rAngle);
      const mdy = Math.sin(rAngle);
      // Perpendicular direction
      const pdx = -mdy;
      const pdy = mdx;
      this._dissipateParticles.push({
        startXPx:     bm.targetXPx,
        startYPx:     bm.targetYPx,
        mainDirXPx:   mdx,
        mainDirYPx:   mdy,
        perpDirXPx:   pdx,
        perpDirYPx:   pdy,
        curvePhaseRad: Math.random() * Math.PI * 2.0,
      });
    }
  }

  private _drawDissipation(ctx: CanvasRenderingContext2D, zoom: number): void {
    if (!this._isDissipating) return;

    this._dissipateFrame++;
    if (this._dissipateFrame >= DISSIPATE_FRAMES) {
      this._isDissipating = false;
      this._dissipateParticles = [];
      return;
    }

    const t = this._dissipateFrame / DISSIPATE_FRAMES;
    const alpha = (1.0 - t) * 0.9;
    const travelPx = t * DISSIPATE_DIST_WORLD * zoom;
    const curvePx = DISSIPATE_CURVE_AMP_WORLD * zoom;
    const phaseInc = DISSIPATE_CURVE_FREQ_RAD * this._dissipateFrame;

    ctx.save();
    ctx.fillStyle = MOTE_COLOR;
    const halfSz = MOTE_HALF_SIZE_PX * zoom;

    for (let m = 0; m < this._dissipateParticles.length; m++) {
      const p = this._dissipateParticles[m];
      const curve = Math.sin(phaseInc + p.curvePhaseRad) * curvePx;
      const x = p.startXPx + p.mainDirXPx * travelPx + p.perpDirXPx * curve;
      const y = p.startYPx + p.mainDirYPx * travelPx + p.perpDirYPx * curve;
      ctx.globalAlpha = alpha;
      ctx.fillRect(x - halfSz, y - halfSz, halfSz * 2, halfSz * 2);
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  // ── Arrow body rendering ──────────────────────────────────────────────────

  private _drawArrows(
    ctx: CanvasRenderingContext2D,
    snapshot: WorldSnapshot,
    ox: number,
    oy: number,
    zoom: number,
  ): void {
    const count = snapshot.arrowCount;
    if (count === 0) return;

    ctx.save();
    ctx.fillStyle = MOTE_COLOR;

    for (let i = 0; i < count; i++) {
      if (snapshot.arrowLifetimeTicksLeft[i] <= 0) continue;
      if (snapshot.isArrowHitEnemyFlag[i] === 1) continue; // invisible while playing enemy hit sequence

      const moteCount = snapshot.arrowMoteCount[i];
      const tipXPx = snapshot.arrowXWorld[i] * zoom + ox;
      const tipYPx = snapshot.arrowYWorld[i] * zoom + oy;
      const dirX = snapshot.arrowDirXWorld[i];
      const dirY = snapshot.arrowDirYWorld[i];

      // Lifetime fade for stuck arrows
      let lifetimeAlpha = 1.0;
      if (snapshot.isArrowStuckFlag[i] === 1) {
        const maxLifetime = moteCount === 4 ? 600 : moteCount === 3 ? 420 : 300;
        lifetimeAlpha = Math.min(1.0, snapshot.arrowLifetimeTicksLeft[i] / 60.0);
        // Also fade fully within the last 60 ticks
        const remaining = snapshot.arrowLifetimeTicksLeft[i];
        if (remaining < 60) {
          lifetimeAlpha = remaining / 60.0;
        } else {
          // Slight fade from full lifetime to 60 ticks remaining
          const stableRange = maxLifetime - 60;
          if (stableRange > 0) {
            lifetimeAlpha = 0.5 + 0.5 * Math.min(1.0, (remaining - 60) / stableRange);
          }
        }
      }

      const halfSz = MOTE_HALF_SIZE_PX * zoom;

      for (let m = 0; m < moteCount; m++) {
        // Tip mote (m=0) is brightest; trailing motes fade
        const moteAlpha = lifetimeAlpha * Math.max(0.1, TIP_ALPHA - m * TRAILING_ALPHA_STEP);

        const mx = tipXPx - dirX * m * ARROW_MOTE_SPACING_WORLD * zoom;
        const my = tipYPx - dirY * m * ARROW_MOTE_SPACING_WORLD * zoom;

        // Glow
        ctx.globalAlpha = moteAlpha * 0.3;
        ctx.fillStyle = '#ffe680';
        const glowSz = halfSz * 2.0;
        ctx.fillRect(mx - glowSz, my - glowSz, glowSz * 2, glowSz * 2);

        // Core
        ctx.globalAlpha = moteAlpha;
        ctx.fillStyle = MOTE_COLOR;
        ctx.fillRect(mx - halfSz, my - halfSz, halfSz * 2, halfSz * 2);
      }
    }

    ctx.globalAlpha = 1.0;
    ctx.restore();
  }
}
