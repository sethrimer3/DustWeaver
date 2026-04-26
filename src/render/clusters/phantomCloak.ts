/**
 * phantomCloak.ts — Phantasmal golden cloak extension for grapple-swinging.
 *
 * A golden spectral extension of the player's cloak that gradually appears
 * while the player is actively swinging via the grapple hook.  It is a
 * purely render-side visual — no sim state is touched.
 *
 * Behaviour overview:
 *   • Grows from shoulder → tip while grappling (speed ∝ player velocity).
 *   • Extends approximately 2× the normal cloak length, making the total
 *     visible cloak 3× the normal length (normal + phantom = 3× normal).
 *   • Dissipates from base → tip when grappling ends, emitting golden particles.
 *   • Rendered behind the main back cloak for a ghostly extension effect.
 *
 * All physics constants are tunable in the configuration section below.
 */

import {
  CLOAK_SEGMENT_COUNT,
  CLOAK_SEGMENT_LENGTH_WORLD,
  CLOAK_DAMPING,
  CLOAK_GRAVITY_WORLD_PER_SEC2,
  CLOAK_VELOCITY_INHERITANCE,
  CLOAK_REST_BIAS_STRENGTH,
  CLOAK_REST_FALLING,
  CLOAK_CONSTRAINT_ITERATIONS,
  CLOAK_MAX_FRAME_DT_SEC,
  CLOAK_MIN_DT_SEC,
  CLOAK_MIN_DISTANCE_WORLD,
  CLOAK_MIN_TANGENT_LENGTH,
  CLOAK_BACK_WIDTH_ROOT_WORLD,
  CLOAK_BACK_WIDTH_TIP_WORLD,
} from './cloakConstants';

// ============================================================================
// Phantom cloak configuration — all tunable constants in one place.
// ============================================================================

/**
 * Total visible-length multiplier.
 * A value of 3 means phantom + normal = 3× the normal cloak length.
 */
export const PHANTOM_LENGTH_MULTIPLIER = 3;

/** Number of phantom extension segments — (MULTIPLIER-1) × normal cloak segments = 2× normal. */
const PHANTOM_SEGMENT_COUNT = CLOAK_SEGMENT_COUNT * (PHANTOM_LENGTH_MULTIPLIER - 1);

/** Total chain point slots: root anchor + trailing phantom segments. */
const PHANTOM_POINT_COUNT = 1 + PHANTOM_SEGMENT_COUNT;

// ── Growth behaviour ─────────────────────────────────────────────────────────

/**
 * Base growth rate: phantom segments added per second regardless of speed.
 * Reduced so the cloak extends gradually at rest.
 */
const BASE_GROWTH_RATE = 2.0;

/**
 * Additional growth rate per world-unit of player velocity magnitude.
 * Faster swinging → faster cloak growth.  Increased so high-speed swings
 * produce a noticeably wider cloak trail quickly.
 */
const SPEED_GROWTH_MULTIPLIER = 0.06;

/** Maximum phantom length in active segments. */
const MAX_PHANTOM_LENGTH = PHANTOM_SEGMENT_COUNT;

// ── Dissipation behaviour ────────────────────────────────────────────────────

/**
 * Rate at which the tip end of the phantom dissolves once grappling ends
 * (active segments consumed per second from the tip / outer end).
 * Dissipation now travels from outside → inside so the visible end retreats
 * toward the shoulder rather than the base disappearing first.
 */
const DISSIPATION_SPEED = 4.5;

// ── Visual appearance ────────────────────────────────────────────────────────

/** Opacity of the phantom fill (0 = transparent, 1 = opaque). More translucent than before. */
const PHANTOM_ALPHA = 0.28;

/** Opacity of the phantom glow outline — bright gold, more prominent than the fill. */
const PHANTOM_OUTLINE_ALPHA = 0.70;

/** Opacity of the secondary wider glow halo pass (softer outer ring). */
const PHANTOM_GLOW_HALO_ALPHA = 0.25;

/** Golden fill colour (warm, luminous). */
const PHANTOM_FILL_COLOR = '#c89600';

/** Lighter golden colour used for bright particle variation. */
const PHANTOM_FILL_COLOR_BRIGHT = '#f0c830';

/** Bright luminous gold for the glowing outline. */
const PHANTOM_OUTLINE_COLOR = '#ffe066';

/** Phantom outline width (world units) — slightly thicker for the glow effect. */
const PHANTOM_OUTLINE_WIDTH_WORLD = 1.0;

/** Width of the wider soft halo pass behind the main glow stroke (world units). */
const PHANTOM_GLOW_HALO_WIDTH_WORLD = 2.5;

/**
 * Slight width reduction relative to main cloak so the phantom appears as a
 * ghostly extension rather than a full-width duplicate (1.0 = same width).
 */
const PHANTOM_WIDTH_SCALE = 0.92;

// ── Dissipation particles ────────────────────────────────────────────────────

/** Particle count emitted per dissolved phantom segment. */
const PARTICLE_COUNT_PER_SEGMENT = 3;

/**
 * Pre-allocated particle pool size.
 * Calculated to accommodate multiple dissolve bursts without resizing.
 */
const MAX_PARTICLES = PHANTOM_SEGMENT_COUNT * PARTICLE_COUNT_PER_SEGMENT * 5;

/** How long each particle lives (seconds). */
const PARTICLE_LIFETIME_SEC = 0.70;

/** Base outward speed of newly spawned particles (world units / second). */
const PARTICLE_SPEED_WORLD = 16;

/** Slight upward bias on particle spawn (world units / second). */
const PARTICLE_UPWARD_BIAS_WORLD = 8;

/** Downward gravity on dissipation particles (world units / second²). */
const PARTICLE_GRAVITY_WORLD_PER_SEC2 = 28;

/** Fade rate multiplier on normalised age. Higher = faster fade. */
const PARTICLE_FADE_RATE = 1.4;

/** Scale of particle at end of life, as a fraction of initial size. */
const PARTICLE_MIN_SCALE = 0.25;

// ── Debug ─────────────────────────────────────────────────────────────────────

/**
 * Set to true to visualise phantom chain points, growth progress, and
 * particle spawn locations in the canvas debug overlay.
 */
export const PHANTOM_DEBUG_ENABLED = false;

// ============================================================================
// Public interface
// ============================================================================

/**
 * State data required by PhantomCloakExtension.update() each render frame.
 * Deliberately minimal — only what the phantom needs.
 */
export interface PhantomCloakState {
  /** Player world-space position. */
  readonly positionXWorld: number;
  readonly positionYWorld: number;
  /** Player world-space velocity (world units / second). */
  readonly velocityXWorld: number;
  readonly velocityYWorld: number;
  /** 1 when player faces left; sprites face right by default. */
  readonly isFacingLeftFlag: 0 | 1;
  /** 1 while the player's grapple hook is actively attached and swinging. */
  readonly isGrappleActiveFlag: 0 | 1;
  /**
   * World-space X of the main cloak chain's tip.
   * The phantom extension roots here, creating a continuous visual.
   */
  readonly rootXWorld: number;
  /**
   * World-space Y of the main cloak chain's tip.
   */
  readonly rootYWorld: number;
}

// ============================================================================
// PhantomCloakExtension class
// ============================================================================

/**
 * Renders a golden spectral cloak extension that grows while grappling and
 * dissipates (with golden particle burst) when the grapple is released.
 *
 * Lifecycle:
 *   1. Inactive   — growthProgress = 0, nothing visible.
 *   2. Growing    — grapple attached; growthProgress rises toward MAX_PHANTOM_LENGTH.
 *   3. Active     — growthProgress at maximum; full phantom visible.
 *   4. Dissolving — grapple released; dissolveProgress rises from root end;
 *                   particles emitted as each segment is consumed.
 */
export class PhantomCloakExtension {

  // ── Chain state (pre-allocated typed arrays) ────────────────────────────────
  private readonly posXWorld: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly posYWorld: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly velXWorld: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly velYWorld: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);

  // ── Growth / dissolution tracking ────────────────────────────────────────────
  /**
   * Float in [0, MAX_PHANTOM_LENGTH].
   * floor(growthProgress) = index of last active chain point.
   */
  private growthProgress: number = 0;
  /**
   * Float in [0, growthProgress].
   * floor(dissolveProgress) = index of the first still-visible point.
   * Increases from the root end during dissolution.
   */
  private dissolveProgress: number = 0;
  /** True once the grapple has been released and dissipation is underway. */
  private isDissipating: boolean = false;
  /** Previous-frame grapple state for edge detection. */
  private prevIsGrappleActiveFlag: 0 | 1 = 0;
  /** True once the chain arrays have been placed at a valid world position. */
  private isInitialisedFlag: boolean = false;

  // ── Render buffers (pre-allocated, reused every frame) ──────────────────────
  private readonly leftXPx: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly leftYPx: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly rightXPx: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  private readonly rightYPx: Float32Array = new Float32Array(PHANTOM_POINT_COUNT);
  /** Scratch perpendicular vector reused by _getPerp — avoids per-call allocation. */
  private readonly _scratchPerp: [number, number] = [0, 0];

  // ── Dissipation particle pool (pre-allocated, allocation-free per frame) ─────
  private readonly particlePosX: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particlePosY: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particleVelX: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particleVelY: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particleAgeSec: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particleLifetimeSec: Float32Array = new Float32Array(MAX_PARTICLES);
  private readonly particleIsAliveFlag: Uint8Array = new Uint8Array(MAX_PARTICLES);
  /** Ring-buffer write index for the particle pool (wraps at MAX_PARTICLES). */
  private particleWriteIndex: number = 0;

  // ── Deterministic micro-RNG (render-side pseudo-random, no Math.random) ──────
  // Xorshift32 seeded from a fixed constant.  Used only for particle aesthetics;
  // does not affect simulation determinism.
  private _rngState: number = 0xdeadbeef;

  private _nextFloat(): number {
    let x = this._rngState;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this._rngState = x;
    return (x >>> 0) / 0xffffffff;
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Advance the phantom cloak simulation by one render frame.
   *
   * @param dtSec  Frame delta (seconds).  Clamped internally against tab-switch spikes.
   * @param state  Current player / grapple state for this frame.
   */
  update(dtSec: number, state: PhantomCloakState): void {
    const dt = Math.min(dtSec, CLOAK_MAX_FRAME_DT_SEC);

    // ── 1. Detect grapple state changes ───────────────────────────────────────
    const isGrappleActive = state.isGrappleActiveFlag;
    const justAttached = isGrappleActive === 1 && this.prevIsGrappleActiveFlag === 0;
    const justReleased  = isGrappleActive === 0 && this.prevIsGrappleActiveFlag === 1;

    if (justReleased && this.growthProgress > 0) {
      this.isDissipating = true;
    }
    if (justAttached) {
      // New attach: cancel any in-progress dissipation so the cloak grows fresh.
      this.isDissipating   = false;
      this.dissolveProgress = 0;
    }
    this.prevIsGrappleActiveFlag = isGrappleActive;

    // ── 2. Pin chain root to main cloak tip ───────────────────────────────────
    const rootX = state.rootXWorld;
    const rootY = state.rootYWorld;

    if (!this.isInitialisedFlag) {
      for (let i = 0; i < PHANTOM_POINT_COUNT; i++) {
        this.posXWorld[i] = rootX;
        this.posYWorld[i] = rootY + i * CLOAK_SEGMENT_LENGTH_WORLD;
      }
      this.isInitialisedFlag = true;
    }

    this.posXWorld[0] = rootX;
    this.posYWorld[0] = rootY;
    this.velXWorld[0] = 0;
    this.velYWorld[0] = 0;

    // ── 3. Update growth / dissolution progress ───────────────────────────────
    if (isGrappleActive === 1 && !this.isDissipating) {
      // Growing: rate proportional to player velocity magnitude.
      const speedWorldPerSec = Math.sqrt(
        state.velocityXWorld * state.velocityXWorld +
        state.velocityYWorld * state.velocityYWorld,
      );
      const growRate = BASE_GROWTH_RATE + speedWorldPerSec * SPEED_GROWTH_MULTIPLIER;
      this.growthProgress = Math.min(MAX_PHANTOM_LENGTH, this.growthProgress + growRate * dt);
    } else if (this.isDissipating) {
      // Dissolving from tip (outer end) inward toward the root.
      // We shrink growthProgress so the visible active end retreats toward
      // the shoulder — the "outside-in" fade direction.
      // Floor at 0 (not dissolveProgress, which stays 0 in this path) to
      // prevent the value going negative due to floating-point drift.
      const prevGrowth = this.growthProgress;
      this.growthProgress = Math.max(
        0,
        this.growthProgress - DISSIPATION_SPEED * dt,
      );

      // Emit particles for every newly consumed whole segment at the tip.
      const prevFloor = Math.floor(prevGrowth);
      const currFloor = Math.floor(this.growthProgress);
      for (let s = currFloor; s < prevFloor; s++) {
        this._emitDissipationParticles(s);
      }

      // Fully dissolved — return to inactive state.
      if (this.growthProgress <= 0) {
        this.growthProgress   = 0;
        this.dissolveProgress = 0;
        this.isDissipating    = false;
      }
    } else {
      // No grapple, not actively dissipating: gently bleed growth so it never
      // stays fully extended after an abrupt state reset.
      this.growthProgress = Math.max(0, this.growthProgress - 3.0 * dt);
    }

    // ── 4. Advance trailing chain points ─────────────────────────────────────
    const dtClamped = Math.max(dt, CLOAK_MIN_DT_SEC);
    // The phantom inherits the same directional rest-bias as the main cloak
    // (trailing behind the player's motion direction).
    const facingSignX = state.isFacingLeftFlag === 1 ? 1 : -1;

    for (let i = 1; i < PHANTOM_POINT_COUNT; i++) {
      // Velocity inheritance from player.
      this.velXWorld[i] += state.velocityXWorld * CLOAK_VELOCITY_INHERITANCE * dt;
      this.velYWorld[i] += state.velocityYWorld * CLOAK_VELOCITY_INHERITANCE * dt;

      // Gravity.
      this.velYWorld[i] += CLOAK_GRAVITY_WORLD_PER_SEC2 * dt;

      // Rest-pose bias: trail behind and below, matching the falling/swinging posture.
      const prevX = this.posXWorld[i - 1];
      const prevY = this.posYWorld[i - 1];
      const targetX = prevX + CLOAK_REST_FALLING[0] * facingSignX;
      const targetY = prevY + CLOAK_REST_FALLING[1];
      const biasX = (targetX - this.posXWorld[i]) * CLOAK_REST_BIAS_STRENGTH;
      const biasY = (targetY - this.posYWorld[i]) * CLOAK_REST_BIAS_STRENGTH;
      this.velXWorld[i] += biasX / dtClamped;
      this.velYWorld[i] += biasY / dtClamped;

      // Damping.
      this.velXWorld[i] *= (1 - CLOAK_DAMPING);
      this.velYWorld[i] *= (1 - CLOAK_DAMPING);

      // Integrate.
      this.posXWorld[i] += this.velXWorld[i] * dt;
      this.posYWorld[i] += this.velYWorld[i] * dt;
    }

    // ── 5. Distance constraint relaxation ─────────────────────────────────────
    for (let iter = 0; iter < CLOAK_CONSTRAINT_ITERATIONS; iter++) {
      for (let i = 1; i < PHANTOM_POINT_COUNT; i++) {
        const parentX = this.posXWorld[i - 1];
        const parentY = this.posYWorld[i - 1];
        const dx = this.posXWorld[i] - parentX;
        const dy = this.posYWorld[i] - parentY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > CLOAK_MIN_DISTANCE_WORLD) {
          const diff = (dist - CLOAK_SEGMENT_LENGTH_WORLD) / dist;
          this.posXWorld[i] -= dx * diff;
          this.posYWorld[i] -= dy * diff;
        }
      }
    }

    // ── 6. Advance dissipation particles ─────────────────────────────────────
    for (let pi = 0; pi < MAX_PARTICLES; pi++) {
      if (this.particleIsAliveFlag[pi] === 0) continue;
      this.particleAgeSec[pi] += dt;
      if (this.particleAgeSec[pi] >= this.particleLifetimeSec[pi]) {
        this.particleIsAliveFlag[pi] = 0;
        continue;
      }
      this.particleVelY[pi] += PARTICLE_GRAVITY_WORLD_PER_SEC2 * dt;
      this.particlePosX[pi] += this.particleVelX[pi] * dt;
      this.particlePosY[pi] += this.particleVelY[pi] * dt;
    }
  }

  /**
   * Render the phantom cloak polygon.
   * Call this BEFORE the main cloak's renderBack() so the back cloak overlaps
   * and anchors the phantom visually.
   */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (!this.isInitialisedFlag || this.growthProgress < 0.5) return;

    const dissolveStart = Math.floor(this.dissolveProgress);
    const activeEnd     = Math.min(PHANTOM_POINT_COUNT - 1, Math.floor(this.growthProgress));
    if (activeEnd <= dissolveStart) return;

    const visibleCount = activeEnd - dissolveStart + 1;
    if (visibleCount < 2) return;

    this._buildPolygon(dissolveStart, visibleCount, offsetXPx, offsetYPx, scalePx);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';

    // Build shared path for fill + outline passes.
    ctx.beginPath();
    ctx.moveTo(this.leftXPx[0], this.leftYPx[0]);
    for (let i = 1; i < visibleCount; i++) {
      ctx.lineTo(this.leftXPx[i], this.leftYPx[i]);
    }
    for (let i = visibleCount - 1; i >= 0; i--) {
      ctx.lineTo(this.rightXPx[i], this.rightYPx[i]);
    }
    ctx.closePath();

    // Pass 1: translucent golden fill.
    ctx.globalAlpha = PHANTOM_ALPHA;
    ctx.fillStyle = PHANTOM_FILL_COLOR;
    ctx.fill();

    // Pass 2: wide soft halo stroke for the golden glow effect.
    ctx.globalAlpha = PHANTOM_GLOW_HALO_ALPHA;
    ctx.strokeStyle = PHANTOM_OUTLINE_COLOR;
    ctx.lineWidth   = PHANTOM_GLOW_HALO_WIDTH_WORLD * scalePx;
    ctx.stroke();

    // Pass 3: bright tight outline for the crisp golden edge.
    ctx.globalAlpha = PHANTOM_OUTLINE_ALPHA;
    ctx.strokeStyle = PHANTOM_OUTLINE_COLOR;
    ctx.lineWidth   = PHANTOM_OUTLINE_WIDTH_WORLD * scalePx;
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Render dissipation particles.
   * Call this AFTER the main cloak's renderFront() so particles float over all
   * cloak layers.
   */
  renderParticles(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    for (let pi = 0; pi < MAX_PARTICLES; pi++) {
      if (this.particleIsAliveFlag[pi] === 0) continue;

      const age           = this.particleAgeSec[pi];
      const lifetime      = this.particleLifetimeSec[pi];
      const normAge       = age / lifetime;
      const alpha         = Math.max(0, 1 - normAge * PARTICLE_FADE_RATE) * 0.9;
      if (alpha < 0.01) continue;

      const scale  = 1.0 - normAge * (1 - PARTICLE_MIN_SCALE);
      const sizePx = Math.max(1, scale * 2 * scalePx);

      const sx = this.particlePosX[pi] * scalePx + offsetXPx;
      const sy = this.particlePosY[pi] * scalePx + offsetYPx;

      ctx.save();
      ctx.globalAlpha = alpha;
      // Alternate colour for a sparkling variation between adjacent particles.
      ctx.fillStyle = (pi & 1) === 0 ? PHANTOM_FILL_COLOR_BRIGHT : PHANTOM_FILL_COLOR;
      ctx.fillRect(
        Math.round(sx - sizePx * 0.5),
        Math.round(sy - sizePx * 0.5),
        Math.ceil(sizePx),
        Math.ceil(sizePx),
      );
      ctx.restore();
    }
  }

  /**
   * Debug overlay: draws chain points, active range, and growth/dissolve text.
   * Only active when PHANTOM_DEBUG_ENABLED is true.
   */
  renderDebug(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (!PHANTOM_DEBUG_ENABLED || !this.isInitialisedFlag) return;

    ctx.save();
    const rx = Math.round(this.posXWorld[0] * scalePx + offsetXPx);
    const ry = Math.round(this.posYWorld[0] * scalePx + offsetYPx);

    ctx.font = '7px monospace';
    ctx.fillStyle = '#ffd700';
    ctx.fillText(
      `phantom grow:${this.growthProgress.toFixed(1)} diss:${this.dissolveProgress.toFixed(1)}`,
      rx + 12,
      ry - 8,
    );

    // Chain points.
    for (let i = 0; i < PHANTOM_POINT_COUNT; i++) {
      const sx = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
      const sy = Math.round(this.posYWorld[i] * scalePx + offsetYPx);
      ctx.fillStyle = i === 0 ? '#ff8800' : '#ffd700';
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Active range indicators.
    const dissolveStart = Math.floor(this.dissolveProgress);
    const activeEnd     = Math.min(PHANTOM_POINT_COUNT - 1, Math.floor(this.growthProgress));
    ctx.strokeStyle = '#ff4400';
    ctx.lineWidth   = 1;
    for (let i = dissolveStart; i <= activeEnd; i++) {
      const sx = Math.round(this.posXWorld[i] * scalePx + offsetXPx);
      const sy = Math.round(this.posYWorld[i] * scalePx + offsetYPx);
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Reset all phantom cloak state (call on room transitions or respawn).
   */
  reset(): void {
    this.isInitialisedFlag       = false;
    this.growthProgress          = 0;
    this.dissolveProgress        = 0;
    this.isDissipating           = false;
    this.prevIsGrappleActiveFlag = 0;
    this.posXWorld.fill(0);
    this.posYWorld.fill(0);
    this.velXWorld.fill(0);
    this.velYWorld.fill(0);
    this.particleIsAliveFlag.fill(0);
    this.particleWriteIndex = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Populate the pre-allocated left/right pixel buffers for `count` visible
   * chain points starting at `startChainIdx`.
   */
  private _buildPolygon(
    startChainIdx: number,
    count: number,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const chainIdx = startChainIdx + i;
      const worldX   = this.posXWorld[chainIdx];
      const worldY   = this.posYWorld[chainIdx];
      const screenX  = Math.round(worldX * scalePx + offsetXPx);
      const screenY  = Math.round(worldY * scalePx + offsetYPx);

      // Interpolate width from root width at point 0 to a slightly wider tip.
      const t         = i / Math.max(1, count - 1);
      const baseWidth = CLOAK_BACK_WIDTH_ROOT_WORLD * (1 - t) + CLOAK_BACK_WIDTH_TIP_WORLD * t;
      const halfWidth = (baseWidth * PHANTOM_WIDTH_SCALE * scalePx) * 0.5;

      const perp = this._getPerp(chainIdx, offsetXPx, offsetYPx, scalePx, screenX, screenY);
      this.leftXPx[i]  = Math.round(screenX + perp[0] * halfWidth);
      this.leftYPx[i]  = Math.round(screenY + perp[1] * halfWidth);
      this.rightXPx[i] = Math.round(screenX - perp[0] * halfWidth);
      this.rightYPx[i] = Math.round(screenY - perp[1] * halfWidth);
    }
  }

  /**
   * Compute the perpendicular unit vector at chain index `i`.
   * Returns the shared _scratchPerp buffer — do not cache the reference.
   */
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

    if (i < PHANTOM_POINT_COUNT - 1) {
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
      this._scratchPerp[1] =  tangentX / len;
    } else {
      this._scratchPerp[0] = 1;
      this._scratchPerp[1] = 0;
    }
    return this._scratchPerp;
  }

  /**
   * Spawn PARTICLE_COUNT_PER_SEGMENT particles at chain point `segmentIndex`
   * using the internal deterministic micro-RNG.
   */
  private _emitDissipationParticles(segmentIndex: number): void {
    const chainIdx = Math.min(PHANTOM_POINT_COUNT - 1, segmentIndex);
    const spawnX   = this.posXWorld[chainIdx];
    const spawnY   = this.posYWorld[chainIdx];

    for (let p = 0; p < PARTICLE_COUNT_PER_SEGMENT; p++) {
      const slot = this.particleWriteIndex % MAX_PARTICLES;
      this.particleWriteIndex++;

      // Scatter in a random direction with gentle speed variation.
      const angle = this._nextFloat() * Math.PI * 2;
      const speed = PARTICLE_SPEED_WORLD * (0.5 + this._nextFloat() * 0.5);

      this.particlePosX[slot]        = spawnX;
      this.particlePosY[slot]        = spawnY;
      this.particleVelX[slot]        = Math.cos(angle) * speed;
      this.particleVelY[slot]        = Math.sin(angle) * speed - PARTICLE_UPWARD_BIAS_WORLD;
      this.particleAgeSec[slot]      = 0;
      this.particleLifetimeSec[slot] = PARTICLE_LIFETIME_SEC * (0.7 + this._nextFloat() * 0.3);
      this.particleIsAliveFlag[slot] = 1;
    }
  }
}
