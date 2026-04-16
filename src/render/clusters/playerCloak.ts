/**
 * playerCloak.ts — Two-layer procedural cloak system for the player character.
 *
 * A single connected garment with:
 *   • One shared simulation chain (point-based trailing motion)
 *   • One shared cloak state (spread, openness, tip, corners, front fold)
 *   • Two rendered surfaces derived from that shared state:
 *       – Back cloak: darker blue, renders behind the body
 *       – Front cloak: lighter blue/white, renders in front of the body
 *
 * Architecture:
 *   • PlayerCloak class owns chain + shape state.
 *   • update() advances simulation and computes shape parameters once per render frame.
 *   • renderBack() / renderFront() draw the two polygon layers.
 *   • renderDebug() visualises anchor, chain, control points, and shape values.
 *
 * The cloak does NOT live in sim/ — it is purely a render-side visual.
 */

import {
  CLOAK_ANCHOR_LOCAL_X,
  CLOAK_ANCHOR_LOCAL_Y,
  CLOAK_SHOULDER_LOCAL_X,
  CLOAK_SHOULDER_LOCAL_Y,
  CLOAK_SEGMENT_COUNT,
  CLOAK_SEGMENT_LENGTH_WORLD,
  CLOAK_MAX_EXTENSION_WORLD,
  CLOAK_DAMPING,
  CLOAK_GRAVITY_WORLD_PER_SEC2,
  CLOAK_VELOCITY_INHERITANCE,
  CLOAK_REST_BIAS_STRENGTH,
  CLOAK_REST_IDLE,
  CLOAK_REST_RUNNING,
  CLOAK_REST_SPRINTING,
  CLOAK_REST_JUMPING,
  CLOAK_REST_FALLING,
  CLOAK_REST_WALL_SLIDE,
  CLOAK_REST_CROUCHING,
  CLOAK_TURN_IMPULSE_WORLD,
  CLOAK_TURN_OVERSHOOT_DURATION_SEC,
  CLOAK_TURN_OVERSHOOT_SPREAD_MULTIPLIER,
  CLOAK_LANDING_IMPULSE_WORLD_PER_SEC,
  CLOAK_LANDING_DURATION_SEC,
  CLOAK_LANDING_COMPRESSION,
  CLOAK_CONSTRAINT_ITERATIONS,
  CLOAK_BACK_WIDTH_ROOT_WORLD,
  CLOAK_BACK_WIDTH_TIP_WORLD,
  CLOAK_BACK_FAST_FALL_TIP_EXTRA_WORLD,
  CLOAK_BACK_FILL_COLOR,
  CLOAK_BACK_OUTLINE_COLOR,
  CLOAK_BACK_OUTLINE_WIDTH_WORLD,
  CLOAK_FRONT_FILL_COLOR,
  CLOAK_FRONT_OUTLINE_COLOR,
  CLOAK_FRONT_OUTLINE_WIDTH_WORLD,
  CLOAK_FRONT_WIDTH_RATIO,
  CLOAK_FRONT_PROJECTION_WORLD,
  CLOAK_FRONT_LENGTH_RATIO,
  CLOAK_FRONT_PROJECTION_TAPER,
  CLOAK_FAST_FALL_CORNER_SHARPNESS,
  CLOAK_DEBUG_POINT_RADIUS_PX,
  CLOAK_MAX_FRAME_DT_SEC,
  CLOAK_MIN_DT_SEC,
  CLOAK_MIN_DISTANCE_WORLD,
  CLOAK_MIN_TANGENT_LENGTH,
  CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD,
  CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD,
  CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD,
  CLOAK_SPREAD_IDLE,
  CLOAK_SPREAD_RUNNING,
  CLOAK_SPREAD_SPRINTING,
  CLOAK_SPREAD_JUMPING,
  CLOAK_SPREAD_FALLING,
  CLOAK_SPREAD_FAST_FALL,
  CLOAK_SPREAD_WALL_SLIDE,
  CLOAK_SPREAD_CROUCHING,
  CLOAK_OPENNESS_IDLE,
  CLOAK_OPENNESS_RUNNING,
  CLOAK_OPENNESS_JUMPING,
  CLOAK_OPENNESS_FALLING,
  CLOAK_OPENNESS_FAST_FALL,
  CLOAK_OPENNESS_WALL_SLIDE,
  CLOAK_SHAPE_LERP_SPEED,
  PLAYER_BACK_X,
  PLAYER_BACK_TOP,
  PLAYER_BACK_BOTTOM,
  BACK_COLLISION_STRENGTH,
  BACK_COLLISION_DAMPING,
  BACK_COMPRESSION_AMOUNT,
  BACK_SLIDE_STRENGTH,
  BACK_DRAPE_SPACING,
  BACK_DRAPE_MIN_SPACING,
  BACK_DRAPE_DAMPING,
  BACK_SURFACE_GRAVITY_BIAS,
  BACK_BUNCHING_FIX_BLEND,
  getCloakTuningValue,
} from './cloakConstants';

// ── Player sprite metrics (duplicated from renderer.ts to avoid circular) ──
const PLAYER_SPRITE_WIDTH_WORLD = 16;
const PLAYER_SPRITE_HEIGHT_WORLD = 24;
const PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD = -1;

// ── Types ─────────────────────────────────────────────────────────────────

/** Minimal player state needed by the cloak each frame. */
export interface CloakPlayerState {
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isFacingLeftFlag: 0 | 1;
  isGroundedFlag: 0 | 1;
  isSprintingFlag: 0 | 1;
  isCrouchingFlag: 0 | 1;
  isWallSlidingFlag: 0 | 1;
  halfWidthWorld: number;
  halfHeightWorld: number;
}

// ── Cloak class ───────────────────────────────────────────────────────────

export class PlayerCloak {
  // Total chain length = root (index 0) + CLOAK_SEGMENT_COUNT trailing points.
  private readonly pointCount: number;

  // Parallel arrays for chain point state (world-space floats).
  private readonly posXWorld: Float32Array;
  private readonly posYWorld: Float32Array;
  private readonly velXWorld: Float32Array;
  private readonly velYWorld: Float32Array;

  // Pre-allocated render buffers for back cloak (reused each frame).
  private readonly backLeftXPx: Float32Array;
  private readonly backLeftYPx: Float32Array;
  private readonly backRightXPx: Float32Array;
  private readonly backRightYPx: Float32Array;

  // Pre-allocated render buffers for front cloak.
  private readonly frontLeftXPx: Float32Array;
  private readonly frontLeftYPx: Float32Array;
  private readonly frontRightXPx: Float32Array;
  private readonly frontRightYPx: Float32Array;

  // Previous-frame state for event detection.
  private prevIsFacingLeftFlag: 0 | 1 = 0;
  private prevIsGroundedFlag: 0 | 1 = 0;

  /** Whether the chain has been initialised to a valid world position. */
  private isInitialisedFlag = false;

  // ── Shared shape state (smoothly interpolated) ──────────────────────
  /** Current spread amount (0 = compact, 1 = fully open). */
  private spreadAmount = 0;
  /** Current openness amount (0 = closed, 1 = fully open). */
  private opennessAmount = 0;
  /** Whether fast-fall visual state is active. */
  private isFastFallActiveFlag = false;

  // ── State timers ────────────────────────────────────────────────────
  /** Remaining turn overshoot timer (seconds). */
  private turnTimerSec = 0;
  /** Remaining landing compression timer (seconds). */
  private landingTimerSec = 0;

  // ── Front cloak point count (derived from main chain) ───────────────
  private readonly frontPointCount: number;

  private _tunedValue(value: number, overrideKey: Parameters<typeof getCloakTuningValue>[1]): number {
    return getCloakTuningValue(value, overrideKey);
  }

  constructor() {
    this.pointCount = 1 + CLOAK_SEGMENT_COUNT;
    this.posXWorld = new Float32Array(this.pointCount);
    this.posYWorld = new Float32Array(this.pointCount);
    this.velXWorld = new Float32Array(this.pointCount);
    this.velYWorld = new Float32Array(this.pointCount);
    this.backLeftXPx = new Float32Array(this.pointCount);
    this.backLeftYPx = new Float32Array(this.pointCount);
    this.backRightXPx = new Float32Array(this.pointCount);
    this.backRightYPx = new Float32Array(this.pointCount);

    // Front cloak uses fewer points (shorter garment). Clamped to never exceed main chain.
    this.frontPointCount = Math.min(this.pointCount, Math.max(2, Math.ceil(this.pointCount * CLOAK_FRONT_LENGTH_RATIO)));
    this.frontLeftXPx = new Float32Array(this.frontPointCount);
    this.frontLeftYPx = new Float32Array(this.frontPointCount);
    this.frontRightXPx = new Float32Array(this.frontPointCount);
    this.frontRightYPx = new Float32Array(this.frontPointCount);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance the cloak simulation for one render frame.
   * @param dtSec  Frame delta in seconds (render dt, NOT fixed sim dt).
   * @param player Snapshot of the player state this frame.
   */
  update(dtSec: number, player: CloakPlayerState): void {
    const dt = Math.min(dtSec, CLOAK_MAX_FRAME_DT_SEC);

    // ── 1. Compute root anchor world position ─────────────────────────
    const rootWorldX = this._anchorWorldX(player);
    const rootWorldY = this._anchorWorldY(player);

    // ── 2. Initialise chain if first frame ────────────────────────────
    if (!this.isInitialisedFlag) {
      this._initChain(rootWorldX, rootWorldY, player);
      this.prevIsFacingLeftFlag = player.isFacingLeftFlag;
      this.prevIsGroundedFlag = player.isGroundedFlag;
      this.isInitialisedFlag = true;
      return;
    }

    // ── 3. Pin root to anchor ─────────────────────────────────────────
    this.posXWorld[0] = rootWorldX;
    this.posYWorld[0] = rootWorldY;
    this.velXWorld[0] = 0;
    this.velYWorld[0] = 0;

    // ── 4. Detect turn and landing events ─────────────────────────────
    const isTurning = player.isFacingLeftFlag !== this.prevIsFacingLeftFlag;
    const isLanding = player.isGroundedFlag === 1 && this.prevIsGroundedFlag === 0;

    if (isTurning) this.turnTimerSec = this._tunedValue(CLOAK_TURN_OVERSHOOT_DURATION_SEC, 'turnOvershootDurationSec');
    if (isLanding) this.landingTimerSec = this._tunedValue(CLOAK_LANDING_DURATION_SEC, 'landingDurationSec');

    // ── 5. Determine state-based rest bias direction ──────────────────
    const restDir = this._getRestDirection(player);
    const facingSignX = player.isFacingLeftFlag === 1 ? 1 : -1; // backward direction

    // ── 6. Determine fast-fall state ──────────────────────────────────
    this.isFastFallActiveFlag = player.isGroundedFlag === 0
      && player.velocityYWorld > this._tunedValue(CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD, 'fastFallVelocityThresholdWorld');

    // ── 7. Compute target spread & openness from player state ─────────
    const targetSpread = this._getTargetSpread(player);
    const targetOpenness = this._getTargetOpenness(player);

    // Apply turn overshoot multiplier.
    const turnMultiplier = this.turnTimerSec > 0 ? this._tunedValue(CLOAK_TURN_OVERSHOOT_SPREAD_MULTIPLIER, 'turnOvershootSpreadMultiplier') : 1.0;
    const adjustedTargetSpread = Math.min(1.0, targetSpread * turnMultiplier);

    // Smooth lerp toward targets.
    const lerpT = 1 - Math.exp(-this._tunedValue(CLOAK_SHAPE_LERP_SPEED, 'shapeLerpSpeed') * dt);
    this.spreadAmount += (adjustedTargetSpread - this.spreadAmount) * lerpT;
    this.opennessAmount += (targetOpenness - this.opennessAmount) * lerpT;

    // ── 8. Tick down timers ───────────────────────────────────────────
    if (this.turnTimerSec > 0) this.turnTimerSec = Math.max(0, this.turnTimerSec - dt);
    if (this.landingTimerSec > 0) this.landingTimerSec = Math.max(0, this.landingTimerSec - dt);

    // ── 9. Update trailing points ─────────────────────────────────────
    const dtClamped = Math.max(dt, CLOAK_MIN_DT_SEC);

    for (let i = 1; i < this.pointCount; i++) {
      // Velocity inheritance from player.
      const velocityInheritance = this._tunedValue(CLOAK_VELOCITY_INHERITANCE, 'velocityInheritance');
      this.velXWorld[i] += player.velocityXWorld * velocityInheritance * dt;
      this.velYWorld[i] += player.velocityYWorld * velocityInheritance * dt;

      // Gravity.
      this.velYWorld[i] += this._tunedValue(CLOAK_GRAVITY_WORLD_PER_SEC2, 'gravityWorldPerSec2') * dt;

      // State-aware rest bias.
      const prevX = this.posXWorld[i - 1];
      const prevY = this.posYWorld[i - 1];
      const targetX = prevX + restDir[0] * facingSignX;
      const targetY = prevY + restDir[1];
      const restBiasStrength = this._tunedValue(CLOAK_REST_BIAS_STRENGTH, 'restBiasStrength');
      const biasX = (targetX - this.posXWorld[i]) * restBiasStrength;
      const biasY = (targetY - this.posYWorld[i]) * restBiasStrength;
      this.velXWorld[i] += biasX / dtClamped;
      this.velYWorld[i] += biasY / dtClamped;

      // Turn impulse.
      if (isTurning) {
        this.velXWorld[i] += this._tunedValue(CLOAK_TURN_IMPULSE_WORLD, 'turnImpulseWorld') * facingSignX / dtClamped;
      }

      // Landing impulse.
      if (isLanding) {
        this.velYWorld[i] += this._tunedValue(CLOAK_LANDING_IMPULSE_WORLD_PER_SEC, 'landingImpulseWorldPerSec');
      }

      // Damping.
      const damping = this._tunedValue(CLOAK_DAMPING, 'damping');
      this.velXWorld[i] *= (1 - damping);
      this.velYWorld[i] *= (1 - damping);

      // Integrate position.
      this.posXWorld[i] += this.velXWorld[i] * dt;
      this.posYWorld[i] += this.velYWorld[i] * dt;
    }

    // ── 10. Distance constraints (iterated relaxation) ────────────────
    for (let iter = 0; iter < CLOAK_CONSTRAINT_ITERATIONS; iter++) {
      for (let i = 1; i < this.pointCount; i++) {
        const parentX = this.posXWorld[i - 1];
        const parentY = this.posYWorld[i - 1];
        const dx = this.posXWorld[i] - parentX;
        const dy = this.posYWorld[i] - parentY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > CLOAK_MIN_DISTANCE_WORLD) {
          const targetDist = CLOAK_SEGMENT_LENGTH_WORLD;
          const diff = (dist - targetDist) / dist;
          this.posXWorld[i] -= dx * diff;
          this.posYWorld[i] -= dy * diff;
        }
      }
    }

    // ── 10b. Back collision constraint ─────────────────────────────────
    // Prevents cloak from passing through the player's back.
    this._applyBackCollision(player, dtClamped);

    // ── 11. Max extension clamp from root ─────────────────────────────
    const tipIdx = this.pointCount - 1;
    const extDx = this.posXWorld[tipIdx] - rootWorldX;
    const extDy = this.posYWorld[tipIdx] - rootWorldY;
    const extDist = Math.sqrt(extDx * extDx + extDy * extDy);
    if (extDist > CLOAK_MAX_EXTENSION_WORLD) {
      const scale = CLOAK_MAX_EXTENSION_WORLD / extDist;
      for (let i = 1; i < this.pointCount; i++) {
        const t = i / (this.pointCount - 1);
        this.posXWorld[i] = rootWorldX + (this.posXWorld[i] - rootWorldX) * (1 - t + t * scale);
        this.posYWorld[i] = rootWorldY + (this.posYWorld[i] - rootWorldY) * (1 - t + t * scale);
      }
    }

    // ── 12. Store previous-frame state for next frame ─────────────────
    this.prevIsFacingLeftFlag = player.isFacingLeftFlag;
    this.prevIsGroundedFlag = player.isGroundedFlag;
  }

  /**
   * Render the back cloak polygon — drawn BEFORE the player body sprite.
   */
  renderBack(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (!this.isInitialisedFlag || this.pointCount < 2) return;
    this._buildBackPolygon(offsetXPx, offsetYPx, scalePx);
    this._drawPolygon(
      ctx,
      this.backLeftXPx, this.backLeftYPx,
      this.backRightXPx, this.backRightYPx,
      this.pointCount,
      CLOAK_BACK_FILL_COLOR,
      CLOAK_BACK_OUTLINE_COLOR,
      CLOAK_BACK_OUTLINE_WIDTH_WORLD * scalePx,
    );
  }

  /**
   * Render the front cloak polygon — drawn AFTER the player body sprite.
   */
  renderFront(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    player: CloakPlayerState,
  ): void {
    if (!this.isInitialisedFlag || this.pointCount < 2) return;
    this._buildFrontPolygon(offsetXPx, offsetYPx, scalePx, player);
    this._drawPolygon(
      ctx,
      this.frontLeftXPx, this.frontLeftYPx,
      this.frontRightXPx, this.frontRightYPx,
      this.frontPointCount,
      CLOAK_FRONT_FILL_COLOR,
      CLOAK_FRONT_OUTLINE_COLOR,
      CLOAK_FRONT_OUTLINE_WIDTH_WORLD * scalePx,
    );
  }

  // Legacy API — renders only back cloak (for backwards compat if called).
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    this.renderBack(ctx, offsetXPx, offsetYPx, scalePx);
  }

  /**
   * Debug overlay: anchor, shoulder, chain points, polygon edges, shape values.
   */
  renderDebug(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    player: CloakPlayerState,
  ): void {
    if (!this.isInitialisedFlag) return;
    ctx.save();

    // Anchor point (red).
    const anchorSX = Math.round(this._anchorWorldX(player) * scalePx + offsetXPx);
    const anchorSY = Math.round(this._anchorWorldY(player) * scalePx + offsetYPx);
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(anchorSX, anchorSY, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    // Shoulder reference (yellow).
    const shoulderSX = Math.round(this._shoulderWorldX(player) * scalePx + offsetXPx);
    const shoulderSY = Math.round(this._shoulderWorldY(player) * scalePx + offsetYPx);
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(shoulderSX, shoulderSY, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
    ctx.fill();

    // Chain points (cyan circles + lines).
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1;
    for (let i = 0; i < this.pointCount; i++) {
      const sx = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
      const sy = Math.round(this.posYWorld[i] * scalePx + offsetYPx);

      ctx.fillStyle = i === 0 ? '#ff8800' : '#00ffff';
      ctx.beginPath();
      ctx.arc(sx, sy, CLOAK_DEBUG_POINT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();

      if (i > 0) {
        const prevSx = Math.round(this.posXWorld[i - 1] * scalePx + offsetXPx);
        const prevSy = Math.round(this.posYWorld[i - 1] * scalePx + offsetYPx);
        ctx.beginPath();
        ctx.moveTo(prevSx, prevSy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
    }

    // Back polygon outline (magenta, dashed).
    this._buildBackPolygon(offsetXPx, offsetYPx, scalePx);
    ctx.strokeStyle = '#ff00ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(this.backLeftXPx[0], this.backLeftYPx[0]);
    for (let i = 1; i < this.pointCount; i++) {
      ctx.lineTo(this.backLeftXPx[i], this.backLeftYPx[i]);
    }
    for (let i = this.pointCount - 1; i >= 0; i--) {
      ctx.lineTo(this.backRightXPx[i], this.backRightYPx[i]);
    }
    ctx.closePath();
    ctx.stroke();

    // Front polygon outline (green, dashed).
    this._buildFrontPolygon(offsetXPx, offsetYPx, scalePx, player);
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(this.frontLeftXPx[0], this.frontLeftYPx[0]);
    for (let i = 1; i < this.frontPointCount; i++) {
      ctx.lineTo(this.frontLeftXPx[i], this.frontLeftYPx[i]);
    }
    for (let i = this.frontPointCount - 1; i >= 0; i--) {
      ctx.lineTo(this.frontRightXPx[i], this.frontRightYPx[i]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // Shape value text.
    const textX = anchorSX + 12;
    let textY = anchorSY - 20;
    ctx.font = '8px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`spread: ${this.spreadAmount.toFixed(2)}`, textX, textY); textY += 10;
    ctx.fillText(`openness: ${this.opennessAmount.toFixed(2)}`, textX, textY); textY += 10;
    ctx.fillText(`fastFall: ${this.isFastFallActiveFlag ? 'YES' : 'no'}`, textX, textY); textY += 10;
    if (this.turnTimerSec > 0) {
      ctx.fillText(`turn: ${this.turnTimerSec.toFixed(2)}s`, textX, textY); textY += 10;
    }
    if (this.landingTimerSec > 0) {
      ctx.fillText(`land: ${this.landingTimerSec.toFixed(2)}s`, textX, textY); textY += 10;
    }

    // ── Back collision boundary line (orange) ──────────────────────────
    const backBoundX = this._backBoundaryWorldX(player);
    const backTopY = this._backBoundaryTopWorldY(player);
    const backBottomY = this._backBoundaryBottomWorldY(player);
    const backLineSX = Math.round(backBoundX * scalePx + offsetXPx);
    const backLineTopSY = Math.round(backTopY * scalePx + offsetYPx);
    const backLineBottomSY = Math.round(backBottomY * scalePx + offsetYPx);

    ctx.strokeStyle = '#ff8800';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(backLineSX, backLineTopSY);
    ctx.lineTo(backLineSX, backLineBottomSY);
    ctx.stroke();

    // Back boundary top/bottom markers (small horizontal ticks).
    const tickHalfLenPx = 2;
    ctx.beginPath();
    ctx.moveTo(backLineSX - tickHalfLenPx, backLineTopSY);
    ctx.lineTo(backLineSX + tickHalfLenPx, backLineTopSY);
    ctx.moveTo(backLineSX - tickHalfLenPx, backLineBottomSY);
    ctx.lineTo(backLineSX + tickHalfLenPx, backLineBottomSY);
    ctx.stroke();

    // Highlight cloak points that are within the back boundary Y range.
    const backToleranceWorld = 1.5;
    const isFacingRight = player.isFacingLeftFlag === 0;
    for (let i = 1; i < this.pointCount; i++) {
      const py = this.posYWorld[i];
      if (py >= backTopY && py <= backBottomY) {
        const sx = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
        const sy = Math.round(py * scalePx + offsetYPx);

        // Check if point is on the back surface (constrained).
        const px = this.posXWorld[i];
        const distFromBack = isFacingRight ? (backBoundX - px) : (px - backBoundX);
        const isConstrained = distFromBack >= -0.5 && distFromBack <= backToleranceWorld;

        ctx.fillStyle = isConstrained ? '#ff00ff' : '#ff4400';
        ctx.beginPath();
        ctx.arc(sx, sy, CLOAK_DEBUG_POINT_RADIUS_PX + 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Drape target positions along the back (small green diamonds).
    const drapeSpacing = this._tunedValue(BACK_DRAPE_SPACING, 'backDrapeSpacing');
    const anchorY = this.posYWorld[0];
    ctx.fillStyle = '#00ff88';
    for (let i = 1; i < this.pointCount; i++) {
      const idealY = anchorY + (i * drapeSpacing);
      const targetY = Math.min(Math.max(idealY, backTopY), backBottomY);
      const dtsx = backLineSX;
      const dtsy = Math.round(targetY * scalePx + offsetYPx);
      // Draw a small diamond marker.
      ctx.beginPath();
      ctx.moveTo(dtsx, dtsy - 2);
      ctx.lineTo(dtsx + 2, dtsy);
      ctx.lineTo(dtsx, dtsy + 2);
      ctx.lineTo(dtsx - 2, dtsy);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#ff8800';
    ctx.fillText('backCol', backLineSX + 4, backLineTopSY - 2);

    ctx.restore();
  }

  /** Reset chain state (e.g. on room transition). */
  reset(): void {
    this.isInitialisedFlag = false;
    this.posXWorld.fill(0);
    this.posYWorld.fill(0);
    this.velXWorld.fill(0);
    this.velYWorld.fill(0);
    this.spreadAmount = 0;
    this.opennessAmount = 0;
    this.isFastFallActiveFlag = false;
    this.turnTimerSec = 0;
    this.landingTimerSec = 0;
  }

  // ── Private: polygon builders ──────────────────────────────────────────

  /**
   * Build the back cloak polygon edges into pre-allocated buffers.
   * Shape is wider at spread, with sharp outer corners during fast fall.
   */
  private _buildBackPolygon(
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    const spread = this.spreadAmount;
    const isFastFall = this.isFastFallActiveFlag;
    const landingScale = this.landingTimerSec > 0
      ? this._tunedValue(CLOAK_LANDING_COMPRESSION, 'landingCompression')
        + (1 - this._tunedValue(CLOAK_LANDING_COMPRESSION, 'landingCompression'))
          * (1 - this.landingTimerSec / this._tunedValue(CLOAK_LANDING_DURATION_SEC, 'landingDurationSec'))
      : 1.0;

    for (let i = 0; i < this.pointCount; i++) {
      const screenX = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
      const screenY = Math.round(this.posYWorld[i] * scalePx + offsetYPx);

      // Interpolate base width from root to tip.
      const t = i / (this.pointCount - 1);
      const baseRootW = CLOAK_BACK_WIDTH_ROOT_WORLD;
      let baseTipW = CLOAK_BACK_WIDTH_TIP_WORLD;

      // During fast fall, tip widens dramatically.
      if (isFastFall) {
        baseTipW += CLOAK_BACK_FAST_FALL_TIP_EXTRA_WORLD * spread;
      }

      const baseWidth = baseRootW * (1 - t) + baseTipW * t;
      // Apply spread multiplier: spread makes the whole cloak wider.
      const widthWorld = baseWidth * (1 + spread * 0.8) * landingScale;
      const halfWidth = (widthWorld * scalePx) * 0.5;

      // Compute perpendicular from chain tangent.
      const perp = this._getPerp(i, offsetXPx, offsetYPx, scalePx, screenX, screenY);

      // During fast fall, push outer corners outward for a sharper silhouette.
      // cornerSharpX uses 2× horizontal emphasis for a visually dramatic wing-out.
      // cornerSharpY forces upward (negative) to lift corners regardless of perp direction.
      let cornerSharpX = 0;
      let cornerSharpY = 0;
      if (isFastFall && t > 0.5) {
        const cornerT = (t - 0.5) * 2; // 0..1 over bottom half
        cornerSharpX = perp[0] * CLOAK_FAST_FALL_CORNER_SHARPNESS * cornerT * spread * scalePx * 2;
        cornerSharpY = -Math.abs(perp[1]) * CLOAK_FAST_FALL_CORNER_SHARPNESS * cornerT * spread * scalePx;
      }

      this.backLeftXPx[i] = Math.round(screenX + perp[0] * halfWidth + cornerSharpX);
      this.backLeftYPx[i] = Math.round(screenY + perp[1] * halfWidth + cornerSharpY);
      this.backRightXPx[i] = Math.round(screenX - perp[0] * halfWidth - cornerSharpX);
      this.backRightYPx[i] = Math.round(screenY - perp[1] * halfWidth + cornerSharpY);
    }
  }

  /**
   * Build the front cloak polygon edges — shorter, narrower, offset toward player front.
   */
  private _buildFrontPolygon(
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    player: CloakPlayerState,
  ): void {
    const spread = this.spreadAmount;
    const openness = this.opennessAmount;
    // Front fold direction: toward the player's facing side.
    const foldDirX = player.isFacingLeftFlag === 1 ? -1 : 1;
    const projectionPx = CLOAK_FRONT_PROJECTION_WORLD * openness * scalePx * foldDirX;

    const landingScale = this.landingTimerSec > 0
      ? this._tunedValue(CLOAK_LANDING_COMPRESSION, 'landingCompression')
        + (1 - this._tunedValue(CLOAK_LANDING_COMPRESSION, 'landingCompression'))
          * (1 - this.landingTimerSec / this._tunedValue(CLOAK_LANDING_DURATION_SEC, 'landingDurationSec'))
      : 1.0;

    for (let i = 0; i < this.frontPointCount; i++) {
      // Map front index to the chain (front is shorter, so use proportional indexing).
      const chainT = i / (this.frontPointCount - 1);
      const chainIdx = Math.min(this.pointCount - 1, chainT * (this.pointCount - 1));
      const lowerIdx = Math.floor(chainIdx);
      const upperIdx = Math.min(this.pointCount - 1, lowerIdx + 1);
      const frac = chainIdx - lowerIdx;

      // Interpolated chain position.
      const worldX = this.posXWorld[lowerIdx] + (this.posXWorld[upperIdx] - this.posXWorld[lowerIdx]) * frac;
      const worldY = this.posYWorld[lowerIdx] + (this.posYWorld[upperIdx] - this.posYWorld[lowerIdx]) * frac;
      const screenX = Math.round(worldX * scalePx + offsetXPx);
      const screenY = Math.round(worldY * scalePx + offsetYPx);

      // Front cloak width: narrower via FRONT_WIDTH_RATIO, modulated by spread.
      const t = i / (this.frontPointCount - 1);
      const backWidth = CLOAK_BACK_WIDTH_ROOT_WORLD * (1 - t) + CLOAK_BACK_WIDTH_TIP_WORLD * t;
      const frontWidth = backWidth * CLOAK_FRONT_WIDTH_RATIO * (1 + spread * 0.4) * landingScale;
      const halfWidth = (frontWidth * scalePx) * 0.5;

      // Perpendicular from nearest chain segment.
      const perpIdx = Math.min(lowerIdx, this.pointCount - 2);
      const perp = this._getPerp(perpIdx, offsetXPx, offsetYPx, scalePx, screenX, screenY);

      // Offset toward front (projection).
      // Root projects more, tip less — creates a front fold that tapers toward the cloak's end.
      const projX = projectionPx * (1 - t * CLOAK_FRONT_PROJECTION_TAPER);

      this.frontLeftXPx[i] = Math.round(screenX + perp[0] * halfWidth + projX);
      this.frontLeftYPx[i] = Math.round(screenY + perp[1] * halfWidth);
      this.frontRightXPx[i] = Math.round(screenX - perp[0] * halfWidth + projX);
      this.frontRightYPx[i] = Math.round(screenY - perp[1] * halfWidth);
    }
  }

  // ── Private: render helpers ────────────────────────────────────────────

  /** Draw a tapered polygon from left/right edge buffers. */
  private _drawPolygon(
    ctx: CanvasRenderingContext2D,
    leftX: Float32Array, leftY: Float32Array,
    rightX: Float32Array, rightY: Float32Array,
    count: number,
    fillColor: string,
    outlineColor: string,
    outlineWidth: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftX[0], leftY[0]);
    for (let i = 1; i < count; i++) {
      ctx.lineTo(leftX[i], leftY[i]);
    }
    for (let i = count - 1; i >= 0; i--) {
      ctx.lineTo(rightX[i], rightY[i]);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // ── Private: perpendicular calculation ─────────────────────────────────

  // Scratch perpendicular to avoid allocation.
  private readonly _scratchPerp: [number, number] = [0, 0];

  /** Get perpendicular unit vector at chain index. Returns shared scratch buffer. */
  private _getPerp(
    i: number,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    screenX: number,
    screenY: number,
  ): readonly [number, number] {
    let tangentX = 0;
    let tangentY = 1;
    if (i < this.pointCount - 1) {
      const nextSX = Math.round(this.posXWorld[i + 1] * scalePx + offsetXPx);
      const nextSY = Math.round(this.posYWorld[i + 1] * scalePx + offsetYPx);
      tangentX = nextSX - screenX;
      tangentY = nextSY - screenY;
    } else if (i > 0) {
      const prevSX = Math.round(this.posXWorld[i - 1] * scalePx + offsetXPx);
      const prevSY = Math.round(this.posYWorld[i - 1] * scalePx + offsetYPx);
      tangentX = screenX - prevSX;
      tangentY = screenY - prevSY;
    }
    const len = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
    if (len > CLOAK_MIN_TANGENT_LENGTH) {
      this._scratchPerp[0] = -tangentY / len;
      this._scratchPerp[1] = tangentX / len;
    } else {
      this._scratchPerp[0] = 1;
      this._scratchPerp[1] = 0;
    }
    return this._scratchPerp;
  }

  // ── Private: anchor / shoulder helpers ─────────────────────────────────

  private _anchorWorldX(player: CloakPlayerState): number {
    const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
    if (player.isFacingLeftFlag === 1) {
      return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - CLOAK_ANCHOR_LOCAL_X);
    }
    return spriteLeftWorldX + CLOAK_ANCHOR_LOCAL_X;
  }

  private _anchorWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + CLOAK_ANCHOR_LOCAL_Y;
  }

  private _shoulderWorldX(player: CloakPlayerState): number {
    const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
    if (player.isFacingLeftFlag === 1) {
      return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - CLOAK_SHOULDER_LOCAL_X);
    }
    return spriteLeftWorldX + CLOAK_SHOULDER_LOCAL_X;
  }

  private _shoulderWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + CLOAK_SHOULDER_LOCAL_Y;
  }

  // ── Private: state-to-shape mapping ────────────────────────────────────

  /** Select rest-pose direction based on movement state. */
  private _getRestDirection(player: CloakPlayerState): readonly [number, number] {
    if (player.isCrouchingFlag === 1) return CLOAK_REST_CROUCHING;
    if (player.isWallSlidingFlag === 1) return CLOAK_REST_WALL_SLIDE;
    if (player.isGroundedFlag === 0) {
      if (player.velocityYWorld < this._tunedValue(CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD, 'jumpingVelocityThresholdWorld')) return CLOAK_REST_JUMPING;
      return CLOAK_REST_FALLING;
    }
    if (player.isSprintingFlag === 1) return CLOAK_REST_SPRINTING;
    if (Math.abs(player.velocityXWorld) > this._tunedValue(CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD, 'runningVelocityThresholdWorld')) return CLOAK_REST_RUNNING;
    return CLOAK_REST_IDLE;
  }

  /** Get target spread from player state (0–1). */
  private _getTargetSpread(player: CloakPlayerState): number {
    if (player.isCrouchingFlag === 1) return this._tunedValue(CLOAK_SPREAD_CROUCHING, 'spreadCrouching');
    if (player.isWallSlidingFlag === 1) return this._tunedValue(CLOAK_SPREAD_WALL_SLIDE, 'spreadWallSlide');
    if (player.isGroundedFlag === 0) {
      if (player.velocityYWorld > this._tunedValue(CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD, 'fastFallVelocityThresholdWorld')) {
        return this._tunedValue(CLOAK_SPREAD_FAST_FALL, 'spreadFastFall');
      }
      if (player.velocityYWorld < this._tunedValue(CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD, 'jumpingVelocityThresholdWorld')) {
        return this._tunedValue(CLOAK_SPREAD_JUMPING, 'spreadJumping');
      }
      return this._tunedValue(CLOAK_SPREAD_FALLING, 'spreadFalling');
    }
    if (player.isSprintingFlag === 1) return this._tunedValue(CLOAK_SPREAD_SPRINTING, 'spreadSprinting');
    if (Math.abs(player.velocityXWorld) > this._tunedValue(CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD, 'runningVelocityThresholdWorld')) {
      return this._tunedValue(CLOAK_SPREAD_RUNNING, 'spreadRunning');
    }
    return this._tunedValue(CLOAK_SPREAD_IDLE, 'spreadIdle');
  }

  /** Get target openness from player state (0–1). */
  private _getTargetOpenness(player: CloakPlayerState): number {
    if (player.isWallSlidingFlag === 1) return this._tunedValue(CLOAK_OPENNESS_WALL_SLIDE, 'opennessWallSlide');
    if (player.isGroundedFlag === 0) {
      if (player.velocityYWorld > this._tunedValue(CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD, 'fastFallVelocityThresholdWorld')) {
        return this._tunedValue(CLOAK_OPENNESS_FAST_FALL, 'opennessFastFall');
      }
      if (player.velocityYWorld < this._tunedValue(CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD, 'jumpingVelocityThresholdWorld')) {
        return this._tunedValue(CLOAK_OPENNESS_JUMPING, 'opennessJumping');
      }
      return this._tunedValue(CLOAK_OPENNESS_FALLING, 'opennessFalling');
    }
    if (Math.abs(player.velocityXWorld) > this._tunedValue(CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD, 'runningVelocityThresholdWorld')) {
      return this._tunedValue(CLOAK_OPENNESS_RUNNING, 'opennessRunning');
    }
    return this._tunedValue(CLOAK_OPENNESS_IDLE, 'opennessIdle');
  }

  // ── Private: back collision helpers ──────────────────────────────────

  /**
   * Compute the world-space X of the player's back boundary line,
   * correctly mirrored for facing direction.
   */
  private _backBoundaryWorldX(player: CloakPlayerState): number {
    const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
    if (player.isFacingLeftFlag === 1) {
      // Facing left: "back" is on the right side of the sprite.
      return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - PLAYER_BACK_X);
    }
    // Facing right: "back" is on the left side of the sprite.
    return spriteLeftWorldX + PLAYER_BACK_X;
  }

  /** World-space Y of the top of the back boundary. */
  private _backBoundaryTopWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + PLAYER_BACK_TOP;
  }

  /** World-space Y of the bottom of the back boundary. */
  private _backBoundaryBottomWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + PLAYER_BACK_BOTTOM;
  }

  /**
   * Apply soft back collision to all trailing cloak points (skip root).
   * If a point crosses the back boundary into the body, push it back
   * toward the boundary with damping. After clamping, applies a drape/slide
   * pass that redistributes constrained points downward along the back
   * surface, preventing bunching near the shoulder.
   */
  private _applyBackCollision(player: CloakPlayerState, dtSec: number): void {
    const backX = this._backBoundaryWorldX(player);
    const backTopY = this._backBoundaryTopWorldY(player);
    const backBottomY = this._backBoundaryBottomWorldY(player);

    const strength = this._tunedValue(BACK_COLLISION_STRENGTH, 'backCollisionStrength');
    const damping = this._tunedValue(BACK_COLLISION_DAMPING, 'backCollisionDamping');
    const compression = this._tunedValue(BACK_COMPRESSION_AMOUNT, 'backCompressionAmount');

    // Drape parameters.
    const slideStrength = this._tunedValue(BACK_SLIDE_STRENGTH, 'backSlideStrength');
    const drapeSpacing = this._tunedValue(BACK_DRAPE_SPACING, 'backDrapeSpacing');
    const drapeMinSpacing = this._tunedValue(BACK_DRAPE_MIN_SPACING, 'backDrapeMinSpacing');
    const drapeDamping = this._tunedValue(BACK_DRAPE_DAMPING, 'backDrapeDamping');
    const surfaceGravityBias = this._tunedValue(BACK_SURFACE_GRAVITY_BIAS, 'backSurfaceGravityBias');
    const bunchingFixBlend = this._tunedValue(BACK_BUNCHING_FIX_BLEND, 'backBunchingFixBlend');

    // Determine if player is moving backward relative to facing.
    const isMovingBackwardFlag = player.isFacingLeftFlag === 1
      ? player.velocityXWorld > 0
      : player.velocityXWorld < 0;

    const isFacingRight = player.isFacingLeftFlag === 0;

    // ── Pass 1: Standard back-collision clamping ─────────────────────
    for (let i = 1; i < this.pointCount; i++) {
      const py = this.posYWorld[i];

      // Only apply constraint within the vertical extent of the back.
      if (py < backTopY || py > backBottomY) continue;

      const px = this.posXWorld[i];

      // Check if point has crossed the back boundary into the body.
      const penetration = isFacingRight ? (px - backX) : (backX - px);

      if (penetration > 0) {
        // Soft push: move point back toward boundary proportional to strength.
        const pushBack = penetration * strength;

        if (isFacingRight) {
          this.posXWorld[i] -= pushBack;
          this.velXWorld[i] *= (1 - damping);
        } else {
          this.posXWorld[i] += pushBack;
          this.velXWorld[i] *= (1 - damping);
        }

        // Apply extra downward gravity bias so constrained points slide down
        // instead of stacking near the shoulder.
        this.velYWorld[i] += surfaceGravityBias * dtSec;

        // Damp horizontal velocity harder on the back surface, but preserve
        // vertical (tangential) motion — only apply gentle tangential damping.
        this.velYWorld[i] *= (1 - drapeDamping * dtSec);
      }

      // Extra compression when moving backward: gently push point toward boundary.
      if (isMovingBackwardFlag) {
        const distFromBack = isFacingRight ? (backX - px) : (px - backX);
        if (distFromBack >= 0 && distFromBack < compression * 2) {
          const compressionPush = compression * dtSec;
          if (isFacingRight) {
            this.posXWorld[i] += compressionPush;
          } else {
            this.posXWorld[i] -= compressionPush;
          }
        }
      }
    }

    // ── Pass 2: Drape redistribution along the back surface ──────────
    // Collect indices of points currently on or touching the back boundary,
    // in chain order (ascending index = top-to-bottom along the garment).
    // Then distribute them downward with stable spacing.

    // Re-check which points are now on the back surface after clamping.
    // A point is "on the back" if its X is very close to the back boundary
    // and its Y is within the back range.
    const backToleranceWorld = 1.5; // world units — how close to backX counts as "on surface"

    // Build ordered list of constrained point indices.
    let constrainedPointCount = 0;
    // Reuse a stack-local array approach — pointCount is small (4), safe to iterate.
    // We avoid allocation by using two passes.

    // First, count constrained points and compute drape target Y positions.
    for (let i = 1; i < this.pointCount; i++) {
      const py = this.posYWorld[i];
      if (py < backTopY - 1 || py > backBottomY + 1) continue;

      const px = this.posXWorld[i];
      const distFromBack = isFacingRight ? (backX - px) : (px - backX);
      // Point is on the back surface if it's within tolerance.
      if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
        constrainedPointCount++;
      }
    }

    // Only run redistribution if at least 2 points are constrained (can bunch).
    if (constrainedPointCount >= 2) {
      // Compute ideal drape target Y for each constrained point.
      // Start from the anchor (root) Y and space downward by drapeSpacing.
      const anchorY = this.posYWorld[0];
      let drapeIndex = 0;

      for (let i = 1; i < this.pointCount; i++) {
        const py = this.posYWorld[i];
        if (py < backTopY - 1 || py > backBottomY + 1) continue;

        const px = this.posXWorld[i];
        const distFromBack = isFacingRight ? (backX - px) : (px - backX);
        if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
          // Compute target Y: anchor + (chainIndex * drapeSpacing), clamped to back range.
          const idealY = anchorY + (i * drapeSpacing);
          const targetY = Math.min(Math.max(idealY, backTopY), backBottomY);

          // Blend current Y toward drape target.
          const currentY = this.posYWorld[i];
          const dy = targetY - currentY;
          this.posYWorld[i] += dy * slideStrength * bunchingFixBlend;

          drapeIndex++;
        }
      }

      // ── Pass 3: Enforce minimum spacing between consecutive constrained points.
      // Walk chain in order and ensure each constrained point is at least
      // drapeMinSpacing below its predecessor.
      let prevConstrainedY = this.posYWorld[0]; // root anchor

      for (let i = 1; i < this.pointCount; i++) {
        const py = this.posYWorld[i];
        if (py < backTopY - 1 || py > backBottomY + 1) continue;

        const px = this.posXWorld[i];
        const distFromBack = isFacingRight ? (backX - px) : (px - backX);
        if (distFromBack >= -0.5 && distFromBack <= backToleranceWorld) {
          const minY = prevConstrainedY + drapeMinSpacing;
          if (this.posYWorld[i] < minY) {
            // Blend toward minimum to prevent hard snapping.
            const correction = (minY - this.posYWorld[i]) * bunchingFixBlend;
            this.posYWorld[i] += correction;
          }
          prevConstrainedY = this.posYWorld[i];
        }
      }
    }
  }

  /** Place all chain points at their rest pose relative to the root anchor. */
  private _initChain(rootX: number, rootY: number, player: CloakPlayerState): void {
    const restDir = this._getRestDirection(player);
    const facingSignX = player.isFacingLeftFlag === 1 ? 1 : -1;

    this.posXWorld[0] = rootX;
    this.posYWorld[0] = rootY;
    this.velXWorld[0] = 0;
    this.velYWorld[0] = 0;

    for (let i = 1; i < this.pointCount; i++) {
      this.posXWorld[i] = this.posXWorld[i - 1] + restDir[0] * facingSignX;
      this.posYWorld[i] = this.posYWorld[i - 1] + restDir[1];
      this.velXWorld[i] = 0;
      this.velYWorld[i] = 0;
    }
  }
}
