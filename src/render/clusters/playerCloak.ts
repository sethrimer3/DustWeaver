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
  CLOAK_BACK_FILL_COLOR,
  CLOAK_BACK_OUTLINE_COLOR,
  CLOAK_BACK_OUTLINE_WIDTH_WORLD,
  CLOAK_FRONT_FILL_COLOR,
  CLOAK_FRONT_OUTLINE_COLOR,
  CLOAK_FRONT_OUTLINE_WIDTH_WORLD,
  CLOAK_FRONT_LENGTH_RATIO,
  CLOAK_MAX_FRAME_DT_SEC,
  CLOAK_MIN_DT_SEC,
  CLOAK_MIN_DISTANCE_WORLD,
  CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD,
  CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD,
  CLOAK_FAST_FALL_VELOCITY_THRESHOLD_WORLD,
  CLOAK_SPREAD_IDLE,
  CLOAK_SPREAD_RUNNING,
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
  BACK_DRAPE_SPACING,
  getCloakTuningValue,
} from './cloakConstants';
import {
  computeBackBoundaryWorldX,
  computeBackBoundaryTopWorldY,
  computeBackBoundaryBottomWorldY,
  applyBackCollision,
} from './cloakBackCollision';
import {
  buildBackCloakPolygon,
  buildFrontCloakPolygon,
  drawCloakPolygon,
  renderCloakDebug,
  type CloakDebugParams,
} from './cloakPolygonRenderer';

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

  /** Pre-compute the landing compression scale for this frame (1.0 = no compression). */
  private _computeLandingScale(): number {
    if (this.landingTimerSec <= 0) return 1.0;
    const compression = this._tunedValue(CLOAK_LANDING_COMPRESSION, 'landingCompression');
    const duration = this._tunedValue(CLOAK_LANDING_DURATION_SEC, 'landingDurationSec');
    return compression + (1 - compression) * (1 - this.landingTimerSec / duration);
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
    applyBackCollision(this.posXWorld, this.posYWorld, this.velXWorld, this.velYWorld, this.pointCount, player, dtClamped);

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
    buildBackCloakPolygon(
      this.posXWorld, this.posYWorld, this.pointCount,
      this.spreadAmount, this.isFastFallActiveFlag, this._computeLandingScale(),
      scalePx, offsetXPx, offsetYPx,
      this.backLeftXPx, this.backLeftYPx, this.backRightXPx, this.backRightYPx,
    );
    drawCloakPolygon(
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
    buildFrontCloakPolygon(
      this.posXWorld, this.posYWorld, this.pointCount, this.frontPointCount,
      this.spreadAmount, this.opennessAmount,
      player.isFacingLeftFlag === 1 ? -1 : 1, this._computeLandingScale(),
      scalePx, offsetXPx, offsetYPx,
      this.frontLeftXPx, this.frontLeftYPx, this.frontRightXPx, this.frontRightYPx,
    );
    drawCloakPolygon(
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
    const params: CloakDebugParams = {
      posXWorld: this.posXWorld,
      posYWorld: this.posYWorld,
      pointCount: this.pointCount,
      frontPointCount: this.frontPointCount,
      spreadAmount: this.spreadAmount,
      opennessAmount: this.opennessAmount,
      isFastFallActive: this.isFastFallActiveFlag,
      turnTimerSec: this.turnTimerSec,
      landingTimerSec: this.landingTimerSec,
      landingScale: this._computeLandingScale(),
      foldDirX: player.isFacingLeftFlag === 1 ? -1 : 1,
      backLeftXPx: this.backLeftXPx,
      backLeftYPx: this.backLeftYPx,
      backRightXPx: this.backRightXPx,
      backRightYPx: this.backRightYPx,
      frontLeftXPx: this.frontLeftXPx,
      frontLeftYPx: this.frontLeftYPx,
      frontRightXPx: this.frontRightXPx,
      frontRightYPx: this.frontRightYPx,
      anchorWorldX: this._anchorWorldX(player),
      anchorWorldY: this._anchorWorldY(player),
      shoulderWorldX: this._shoulderWorldX(player),
      shoulderWorldY: this._shoulderWorldY(player),
      backBoundaryWorldX: computeBackBoundaryWorldX(player),
      backBoundaryTopWorldY: computeBackBoundaryTopWorldY(player),
      backBoundaryBottomWorldY: computeBackBoundaryBottomWorldY(player),
      drapeSpacing: this._tunedValue(BACK_DRAPE_SPACING, 'backDrapeSpacing'),
      isFacingRight: player.isFacingLeftFlag === 0,
      offsetXPx,
      offsetYPx,
      scalePx,
    };
    renderCloakDebug(ctx, params);
  }

  /**
   * Returns the world-space X of the last chain point (cloak tip).
   * Used by PhantomCloakExtension to root its chain at the main cloak's tip.
   */
  getTipXWorld(): number {
    return this.isInitialisedFlag ? this.posXWorld[this.pointCount - 1] : 0;
  }

  /**
   * Returns the world-space Y of the last chain point (cloak tip).
   */
  getTipYWorld(): number {
    return this.isInitialisedFlag ? this.posYWorld[this.pointCount - 1] : 0;
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
