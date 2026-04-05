/**
 * playerCloak.ts — Procedural cloak system for the player character.
 *
 * Simulates a short point-chain cloak attached to the player sprite's upper
 * back / shoulder area.  The simulation runs in world-space floats; positions
 * are pixel-snapped only at final render time.
 *
 * Architecture:
 *   • PlayerCloak class owns the chain state and exposes update() / render().
 *   • update() is called once per render frame, NOT per sim tick, because
 *     the cloak is a visual-only effect that reads from the snapshot.
 *   • render() draws the filled cloak polygon + outline behind the body sprite.
 *   • renderDebug() optionally visualises anchor, chain points, and polygon.
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
  CLOAK_LANDING_IMPULSE_WORLD_PER_SEC,
  CLOAK_CONSTRAINT_ITERATIONS,
  CLOAK_FILL_COLOR,
  CLOAK_OUTLINE_COLOR,
  CLOAK_OUTLINE_WIDTH_WORLD,
  CLOAK_WIDTH_ROOT_WORLD,
  CLOAK_WIDTH_TIP_WORLD,
  CLOAK_DEBUG_POINT_RADIUS_PX,
  CLOAK_MAX_FRAME_DT_SEC,
  CLOAK_MIN_DT_SEC,
  CLOAK_MIN_DISTANCE_WORLD,
  CLOAK_MIN_TANGENT_LENGTH,
  CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD,
  CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD,
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

  // Pre-allocated render buffers (reused each frame to avoid per-frame allocations).
  private readonly leftXPx: Float32Array;
  private readonly leftYPx: Float32Array;
  private readonly rightXPx: Float32Array;
  private readonly rightYPx: Float32Array;

  // Previous-frame facing direction for turn detection.
  private prevIsFacingLeftFlag: 0 | 1 = 0;
  // Previous-frame grounded flag for landing detection.
  private prevIsGroundedFlag: 0 | 1 = 0;

  /** Whether the chain has been initialised to a valid world position. */
  private isInitialisedFlag = false;

  constructor() {
    this.pointCount = 1 + CLOAK_SEGMENT_COUNT;
    this.posXWorld = new Float32Array(this.pointCount);
    this.posYWorld = new Float32Array(this.pointCount);
    this.velXWorld = new Float32Array(this.pointCount);
    this.velYWorld = new Float32Array(this.pointCount);
    this.leftXPx = new Float32Array(this.pointCount);
    this.leftYPx = new Float32Array(this.pointCount);
    this.rightXPx = new Float32Array(this.pointCount);
    this.rightYPx = new Float32Array(this.pointCount);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Advance the cloak simulation for one render frame.
   * @param dtSec  Frame delta in seconds (render dt, NOT fixed sim dt).
   * @param player Snapshot of the player state this frame.
   */
  update(dtSec: number, player: CloakPlayerState): void {
    // Clamp dt to avoid explosion on tab-switch / large frame gaps.
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

    // ── 5. Determine state-based rest bias direction ──────────────────
    const restDir = this._getRestDirection(player);
    // Convert to world-relative: backward = opposite facing.
    const facingSignX = player.isFacingLeftFlag === 1 ? 1 : -1; // backward direction

    // ── 6. Update trailing points ─────────────────────────────────────
    // Pre-compute clamped dt divisor to avoid repeated Math.max calls in the loop.
    const dtClamped = Math.max(dt, CLOAK_MIN_DT_SEC);

    for (let i = 1; i < this.pointCount; i++) {
      // Velocity inheritance from player.
      this.velXWorld[i] += player.velocityXWorld * CLOAK_VELOCITY_INHERITANCE * dt;
      this.velYWorld[i] += player.velocityYWorld * CLOAK_VELOCITY_INHERITANCE * dt;

      // Gravity (mild, purely visual).
      this.velYWorld[i] += CLOAK_GRAVITY_WORLD_PER_SEC2 * dt;

      // State-aware rest bias: pull toward preferred pose.
      const prevX = this.posXWorld[i - 1];
      const prevY = this.posYWorld[i - 1];
      const targetX = prevX + restDir[0] * facingSignX;
      const targetY = prevY + restDir[1];
      const biasX = (targetX - this.posXWorld[i]) * CLOAK_REST_BIAS_STRENGTH;
      const biasY = (targetY - this.posYWorld[i]) * CLOAK_REST_BIAS_STRENGTH;
      this.velXWorld[i] += biasX / dtClamped;
      this.velYWorld[i] += biasY / dtClamped;

      // Turn impulse.
      if (isTurning) {
        this.velXWorld[i] += CLOAK_TURN_IMPULSE_WORLD * facingSignX / dtClamped;
      }

      // Landing impulse.
      if (isLanding) {
        this.velYWorld[i] += CLOAK_LANDING_IMPULSE_WORLD_PER_SEC;
      }

      // Damping.
      this.velXWorld[i] *= (1 - CLOAK_DAMPING);
      this.velYWorld[i] *= (1 - CLOAK_DAMPING);

      // Integrate position.
      this.posXWorld[i] += this.velXWorld[i] * dt;
      this.posYWorld[i] += this.velYWorld[i] * dt;
    }

    // ── 7. Distance constraints (iterated relaxation) ─────────────────
    for (let iter = 0; iter < CLOAK_CONSTRAINT_ITERATIONS; iter++) {
      for (let i = 1; i < this.pointCount; i++) {
        const parentX = this.posXWorld[i - 1];
        const parentY = this.posYWorld[i - 1];
        let dx = this.posXWorld[i] - parentX;
        let dy = this.posYWorld[i] - parentY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > CLOAK_MIN_DISTANCE_WORLD) {
          const targetDist = CLOAK_SEGMENT_LENGTH_WORLD;
          const diff = (dist - targetDist) / dist;
          // Only child point moves (parent is pinned or already resolved).
          this.posXWorld[i] -= dx * diff;
          this.posYWorld[i] -= dy * diff;
        }
      }
    }

    // ── 8. Max extension clamp from root ──────────────────────────────
    const tipIdx = this.pointCount - 1;
    const extDx = this.posXWorld[tipIdx] - rootWorldX;
    const extDy = this.posYWorld[tipIdx] - rootWorldY;
    const extDist = Math.sqrt(extDx * extDx + extDy * extDy);
    if (extDist > CLOAK_MAX_EXTENSION_WORLD) {
      const scale = CLOAK_MAX_EXTENSION_WORLD / extDist;
      // Proportionally pull all points toward root.
      for (let i = 1; i < this.pointCount; i++) {
        const t = i / (this.pointCount - 1);
        this.posXWorld[i] = rootWorldX + (this.posXWorld[i] - rootWorldX) * (1 - t + t * scale);
        this.posYWorld[i] = rootWorldY + (this.posYWorld[i] - rootWorldY) * (1 - t + t * scale);
      }
    }

    // ── 9. Store previous-frame state for next frame ──────────────────
    this.prevIsFacingLeftFlag = player.isFacingLeftFlag;
    this.prevIsGroundedFlag = player.isGroundedFlag;
  }

  /**
   * Render the filled cloak polygon + outline behind the player body.
   * Should be called BEFORE the player sprite is drawn.
   *
   * @param ctx     2D canvas context (virtual canvas).
   * @param offsetXPx Camera offset X (virtual px).
   * @param offsetYPx Camera offset Y (virtual px).
   * @param scalePx  Zoom scale (world units → virtual px).
   */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (!this.isInitialisedFlag || this.pointCount < 2) return;

    // Build screen-space points for the polygon using pre-allocated buffers.
    // The cloak is a tapered shape: left edge, then right edge reversed.
    const leftXPx = this.leftXPx;
    const leftYPx = this.leftYPx;
    const rightXPx = this.rightXPx;
    const rightYPx = this.rightYPx;

    for (let i = 0; i < this.pointCount; i++) {
      const screenX = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
      const screenY = Math.round(this.posYWorld[i] * scalePx + offsetYPx);

      // Interpolate width from root to tip.
      const t = i / (this.pointCount - 1);
      const halfWidth = ((CLOAK_WIDTH_ROOT_WORLD * (1 - t) + CLOAK_WIDTH_TIP_WORLD * t) * scalePx) * 0.5;

      // Perpendicular direction: approximate from chain segment tangent.
      let tangentX = 0;
      let tangentY = 1;
      if (i < this.pointCount - 1) {
        const nextScreenX = Math.round(this.posXWorld[i + 1] * scalePx + offsetXPx);
        const nextScreenY = Math.round(this.posYWorld[i + 1] * scalePx + offsetYPx);
        tangentX = nextScreenX - screenX;
        tangentY = nextScreenY - screenY;
      } else if (i > 0) {
        const prevScreenX = Math.round(this.posXWorld[i - 1] * scalePx + offsetXPx);
        const prevScreenY = Math.round(this.posYWorld[i - 1] * scalePx + offsetYPx);
        tangentX = screenX - prevScreenX;
        tangentY = screenY - prevScreenY;
      }
      const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY);
      let perpX = 0;
      let perpY = 0;
      if (tangentLen > CLOAK_MIN_TANGENT_LENGTH) {
        // Perpendicular = rotate tangent 90 degrees.
        perpX = -tangentY / tangentLen;
        perpY = tangentX / tangentLen;
      } else {
        perpX = 1;
        perpY = 0;
      }

      leftXPx[i] = Math.round(screenX + perpX * halfWidth);
      leftYPx[i] = Math.round(screenY + perpY * halfWidth);
      rightXPx[i] = Math.round(screenX - perpX * halfWidth);
      rightYPx[i] = Math.round(screenY - perpY * halfWidth);
    }

    // Draw filled polygon: left edge forward, then right edge backward.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(leftXPx[0], leftYPx[0]);
    for (let i = 1; i < this.pointCount; i++) {
      ctx.lineTo(leftXPx[i], leftYPx[i]);
    }
    for (let i = this.pointCount - 1; i >= 0; i--) {
      ctx.lineTo(rightXPx[i], rightYPx[i]);
    }
    ctx.closePath();

    // Fill.
    ctx.fillStyle = CLOAK_FILL_COLOR;
    ctx.fill();

    // Outline.
    ctx.strokeStyle = CLOAK_OUTLINE_COLOR;
    ctx.lineWidth = CLOAK_OUTLINE_WIDTH_WORLD * scalePx;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Debug overlay: draw anchor, shoulder reference, chain points, polygon edges.
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

    ctx.restore();
  }

  /** Reset chain state (e.g. on room transition). */
  reset(): void {
    this.isInitialisedFlag = false;
    this.posXWorld.fill(0);
    this.posYWorld.fill(0);
    this.velXWorld.fill(0);
    this.velYWorld.fill(0);
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Compute the world-space X of the cloak anchor, accounting for sprite
   * centering and horizontal flip.
   */
  private _anchorWorldX(player: CloakPlayerState): number {
    const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
    if (player.isFacingLeftFlag === 1) {
      // Mirror: anchor from right edge of sprite.
      return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - CLOAK_ANCHOR_LOCAL_X);
    }
    return spriteLeftWorldX + CLOAK_ANCHOR_LOCAL_X;
  }

  /** Compute the world-space Y of the cloak anchor. */
  private _anchorWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + CLOAK_ANCHOR_LOCAL_Y;
  }

  /** Compute the world-space X of the shoulder reference point. */
  private _shoulderWorldX(player: CloakPlayerState): number {
    const spriteLeftWorldX = player.positionXWorld - PLAYER_SPRITE_WIDTH_WORLD * 0.5;
    if (player.isFacingLeftFlag === 1) {
      return spriteLeftWorldX + (PLAYER_SPRITE_WIDTH_WORLD - CLOAK_SHOULDER_LOCAL_X);
    }
    return spriteLeftWorldX + CLOAK_SHOULDER_LOCAL_X;
  }

  /** Compute the world-space Y of the shoulder reference point. */
  private _shoulderWorldY(player: CloakPlayerState): number {
    const spriteTopWorldY = player.positionYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD
      - PLAYER_SPRITE_HEIGHT_WORLD * 0.5;
    return spriteTopWorldY + CLOAK_SHOULDER_LOCAL_Y;
  }

  /**
   * Select a rest-pose offset based on the player's current movement state.
   * Returns [dx_backward, dy_downward] per segment in facing-local space.
   */
  private _getRestDirection(player: CloakPlayerState): readonly [number, number] {
    // Crouching takes priority over grounded states.
    if (player.isCrouchingFlag === 1) return CLOAK_REST_CROUCHING;
    if (player.isWallSlidingFlag === 1) return CLOAK_REST_WALL_SLIDE;

    // Airborne states.
    if (player.isGroundedFlag === 0) {
      if (player.velocityYWorld < CLOAK_JUMPING_VELOCITY_THRESHOLD_WORLD) return CLOAK_REST_JUMPING;
      return CLOAK_REST_FALLING;
    }

    // Grounded states.
    if (player.isSprintingFlag === 1) return CLOAK_REST_SPRINTING;
    const isMovingHorizontally = Math.abs(player.velocityXWorld) > CLOAK_RUNNING_VELOCITY_THRESHOLD_WORLD;
    if (isMovingHorizontally) return CLOAK_REST_RUNNING;
    return CLOAK_REST_IDLE;
  }

  /**
   * Place all chain points at their rest pose relative to the root anchor.
   */
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
