/**
 * phantomCloakParticles.ts — Dissipation particle pool for the phantom cloak.
 *
 * Extracted from phantomCloak.ts so the particle simulation and rendering
 * are self-contained in one focused module.  PhantomCloakExtension holds a
 * PhantomDissipationParticles instance and delegates all particle work to it.
 *
 * The class is allocation-free per frame: all particle data lives in
 * pre-allocated typed arrays.  A deterministic Xorshift32 micro-RNG drives
 * particle aesthetics — independent of Math.random() and the sim-layer RNG.
 */

// ── Particle visual constants ─────────────────────────────────────────────────

/** Particles emitted per dissolved phantom segment. */
const PARTICLE_COUNT_PER_SEGMENT = 3;

/** How long each particle lives (seconds). */
const PARTICLE_LIFETIME_SEC = 0.70;

/** Base outward speed of newly spawned particles (world units / second). */
const PARTICLE_SPEED_WORLD = 16;

/** Slight upward bias on particle spawn (world units / second). */
const PARTICLE_UPWARD_BIAS_WORLD = 8;

/** Downward gravity on dissipation particles (world units / second²). */
const PARTICLE_GRAVITY_WORLD_PER_SEC2 = 28;

/** Fade rate multiplier on normalised age.  Higher = faster fade. */
const PARTICLE_FADE_RATE = 1.4;

/** Scale of particle at end of life, as a fraction of initial size. */
const PARTICLE_MIN_SCALE = 0.25;

/** Golden fill colour (warm, luminous). */
const PHANTOM_FILL_COLOR = '#c89600';

/** Lighter golden colour used for bright particle variation. */
const PHANTOM_FILL_COLOR_BRIGHT = '#f0c830';

// ── PhantomDissipationParticles ───────────────────────────────────────────────

/**
 * Pre-allocated dissipation particle pool for the phantom cloak.
 *
 * Lifecycle:
 *  - Construct once, passing the phantom segment count to size the pool.
 *  - Call `tick(dt)` each frame to advance alive particles.
 *  - Call `emit(spawnX, spawnY)` when a phantom segment dissolves.
 *  - Call `render(ctx, ...)` to draw all alive particles.
 *  - Call `reset()` on room transition or player respawn.
 */
export class PhantomDissipationParticles {

  // ── Pool sizing ────────────────────────────────────────────────────────────
  private readonly maxParticles: number;

  // ── Typed-array particle state (struct-of-arrays layout) ──────────────────
  private readonly posX: Float32Array;
  private readonly posY: Float32Array;
  private readonly velX: Float32Array;
  private readonly velY: Float32Array;
  private readonly ageSec: Float32Array;
  private readonly lifetimeSec: Float32Array;
  private readonly isAliveFlag: Uint8Array;

  /** Ring-buffer write index; wraps at maxParticles. */
  private writeIndex: number = 0;

  // ── Deterministic micro-RNG (Xorshift32) ──────────────────────────────────
  // Used only for particle aesthetics — does not affect simulation determinism.
  private _rngState: number = 0xdeadbeef;

  // ── Constructor ───────────────────────────────────────────────────────────

  constructor(phantomSegmentCount: number) {
    this.maxParticles = phantomSegmentCount * PARTICLE_COUNT_PER_SEGMENT * 5;
    this.posX         = new Float32Array(this.maxParticles);
    this.posY         = new Float32Array(this.maxParticles);
    this.velX         = new Float32Array(this.maxParticles);
    this.velY         = new Float32Array(this.maxParticles);
    this.ageSec       = new Float32Array(this.maxParticles);
    this.lifetimeSec  = new Float32Array(this.maxParticles);
    this.isAliveFlag  = new Uint8Array(this.maxParticles);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Advance all alive particles by `dt` seconds.
   * Apply gravity, integrate position, and expire particles that exceed their
   * lifetime.  Allocation-free.
   */
  tick(dt: number): void {
    for (let pi = 0; pi < this.maxParticles; pi++) {
      if (this.isAliveFlag[pi] === 0) continue;
      this.ageSec[pi] += dt;
      if (this.ageSec[pi] >= this.lifetimeSec[pi]) {
        this.isAliveFlag[pi] = 0;
        continue;
      }
      this.velY[pi]  += PARTICLE_GRAVITY_WORLD_PER_SEC2 * dt;
      this.posX[pi]  += this.velX[pi] * dt;
      this.posY[pi]  += this.velY[pi] * dt;
    }
  }

  /**
   * Spawn `PARTICLE_COUNT_PER_SEGMENT` particles at the given world position.
   * Called once per dissolved phantom segment.
   */
  emit(spawnX: number, spawnY: number): void {
    for (let p = 0; p < PARTICLE_COUNT_PER_SEGMENT; p++) {
      const slot = this.writeIndex % this.maxParticles;
      this.writeIndex++;

      const angle = this._nextFloat() * Math.PI * 2;
      const speed = PARTICLE_SPEED_WORLD * (0.5 + this._nextFloat() * 0.5);

      this.posX[slot]        = spawnX;
      this.posY[slot]        = spawnY;
      this.velX[slot]        = Math.cos(angle) * speed;
      this.velY[slot]        = Math.sin(angle) * speed - PARTICLE_UPWARD_BIAS_WORLD;
      this.ageSec[slot]      = 0;
      this.lifetimeSec[slot] = PARTICLE_LIFETIME_SEC * (0.7 + this._nextFloat() * 0.3);
      this.isAliveFlag[slot] = 1;
    }
  }

  /**
   * Draw all alive particles onto `ctx`.
   * Call after the main cloak's `renderFront()` so particles float over all
   * cloak layers.
   */
  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    for (let pi = 0; pi < this.maxParticles; pi++) {
      if (this.isAliveFlag[pi] === 0) continue;

      const normAge = this.ageSec[pi] / this.lifetimeSec[pi];
      const alpha   = Math.max(0, 1 - normAge * PARTICLE_FADE_RATE) * 0.9;
      if (alpha < 0.01) continue;

      const scale  = 1.0 - normAge * (1 - PARTICLE_MIN_SCALE);
      const sizePx = Math.max(1, scale * 2 * scalePx);

      const sx = this.posX[pi] * scalePx + offsetXPx;
      const sy = this.posY[pi] * scalePx + offsetYPx;

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
   * Reset particle pool state (call on room transitions or player respawn).
   */
  reset(): void {
    this.isAliveFlag.fill(0);
    this.writeIndex = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _nextFloat(): number {
    let x = this._rngState;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this._rngState = x;
    return (x >>> 0) / 0xffffffff;
  }
}
