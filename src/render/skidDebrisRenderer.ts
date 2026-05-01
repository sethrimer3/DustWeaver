/**
 * Skid debris renderer — spawns small 1×1 pixel particles from the player's
 * bottom-front corner while skidding.  Purely visual; does not affect sim.
 */

import { WorldState } from '../sim/world';

const MAX_DEBRIS = 120;
const DEBRIS_LIFETIME_MS = 400;
const SPAWN_RATE_PER_TICK = 3;
/** Spawn rate multiplier when the player is grapple-stuck and decelerating. */
const GRAPPLE_STUCK_SPAWN_MULTIPLIER = 3;
const DEBRIS_SPAWN_SPREAD_X_WORLD = 2;
const DEBRIS_SPAWN_SPREAD_Y_WORLD = 1;
const DEBRIS_VX_VARIANCE_WORLD = 30;
const DEBRIS_VY_MIN_WORLD = 15;
const DEBRIS_VY_RANGE_WORLD = 40;
const DEBRIS_GRAVITY_WORLD_PER_SEC2 = 200;

/** Debris particle color palette — earthy browns. */
const COLORS = ['#8b7355', '#a08060', '#6b5330', '#c4a57b'];

export class SkidDebrisRenderer {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_DEBRIS);
  private readonly yWorld = new Float32Array(MAX_DEBRIS);
  private readonly vxWorld = new Float32Array(MAX_DEBRIS);
  private readonly vyWorld = new Float32Array(MAX_DEBRIS);
  private readonly ageMs = new Float32Array(MAX_DEBRIS);
  private readonly colorIdx = new Uint8Array(MAX_DEBRIS);
  private rngState = 1;

  /** Simple deterministic PRNG for visual-only effects. */
  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  update(world: WorldState, dtMs: number): void {
    const dt = dtMs / 1000.0;

    // Spawn new debris if skidding
    if (world.isPlayerSkiddingFlag === 1) {
      // Landing skid at high speed: scale spawn rate, spread, and velocity by
      // (1 + landingFactor), so faster landings kick up more and farther dust.
      const landFactor = world.playerLandingSkidSpeedFactor;
      const speedScale = 1.0 + landFactor;

      // Grapple-stuck skid uses its own multiplier (applied on top of speedScale).
      const baseRate = world.isGrappleStuckFlag === 1
        ? SPAWN_RATE_PER_TICK * GRAPPLE_STUCK_SPAWN_MULTIPLIER
        : SPAWN_RATE_PER_TICK;
      const rate = Math.ceil(baseRate * speedScale);

      const spreadX = DEBRIS_SPAWN_SPREAD_X_WORLD * speedScale;
      const spreadY = DEBRIS_SPAWN_SPREAD_Y_WORLD * speedScale;
      const vxVar   = DEBRIS_VX_VARIANCE_WORLD * speedScale;
      const vyMin   = DEBRIS_VY_MIN_WORLD;
      const vyRange = DEBRIS_VY_RANGE_WORLD * speedScale;

      for (let s = 0; s < rate; s++) {
        if (this.count >= MAX_DEBRIS) {
          // Recycle oldest
          this.recycleOldest();
        }
        const i = this.count;
        this.xWorld[i] = world.skidDebrisXWorld + (this.nextRandom() - 0.5) * spreadX;
        this.yWorld[i] = world.skidDebrisYWorld - this.nextRandom() * spreadY;
        // Debris flies upward and slightly outward
        this.vxWorld[i] = (this.nextRandom() - 0.5) * vxVar;
        this.vyWorld[i] = -(this.nextRandom() * vyRange + vyMin);
        this.ageMs[i] = 0;
        this.colorIdx[i] = (this.nextRandom() * COLORS.length) | 0;
        this.count++;
      }
    }

    // Update existing particles
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > DEBRIS_LIFETIME_MS) {
        // Remove by swapping with last
        this.count--;
        this.xWorld[i] = this.xWorld[this.count];
        this.yWorld[i] = this.yWorld[this.count];
        this.vxWorld[i] = this.vxWorld[this.count];
        this.vyWorld[i] = this.vyWorld[this.count];
        this.ageMs[i] = this.ageMs[this.count];
        this.colorIdx[i] = this.colorIdx[this.count];
        continue;
      }
      // Apply gravity and integrate
      this.vyWorld[i] += DEBRIS_GRAVITY_WORLD_PER_SEC2 * dt;
      this.xWorld[i] += this.vxWorld[i] * dt;
      this.yWorld[i] += this.vyWorld[i] * dt;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
  ): void {
    if (this.count === 0) return;
    ctx.save();
    for (let i = 0; i < this.count; i++) {
      const alpha = 1.0 - this.ageMs[i] / DEBRIS_LIFETIME_MS;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[this.colorIdx[i]];
      const drawX = this.xWorld[i] * scalePx + offsetXPx;
      const drawY = this.yWorld[i] * scalePx + offsetYPx;
      ctx.fillRect(drawX, drawY, 1, 1);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  private recycleOldest(): void {
    // Find oldest particle and remove it
    let oldestIdx = 0;
    let oldestAge = this.ageMs[0];
    for (let i = 1; i < this.count; i++) {
      if (this.ageMs[i] > oldestAge) {
        oldestAge = this.ageMs[i];
        oldestIdx = i;
      }
    }
    this.count--;
    this.xWorld[oldestIdx] = this.xWorld[this.count];
    this.yWorld[oldestIdx] = this.yWorld[this.count];
    this.vxWorld[oldestIdx] = this.vxWorld[this.count];
    this.vyWorld[oldestIdx] = this.vyWorld[this.count];
    this.ageMs[oldestIdx] = this.ageMs[this.count];
    this.colorIdx[oldestIdx] = this.colorIdx[this.count];
  }
}
