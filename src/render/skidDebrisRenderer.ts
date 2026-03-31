/**
 * Skid debris renderer — spawns small 1×1 pixel particles from the player's
 * bottom-front corner while skidding.  Purely visual; does not affect sim.
 */

import { WorldState } from '../sim/world';

const MAX_DEBRIS = 60;
const DEBRIS_LIFETIME_MS = 400;
const SPAWN_RATE_PER_TICK = 3;

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
      for (let s = 0; s < SPAWN_RATE_PER_TICK; s++) {
        if (this.count >= MAX_DEBRIS) {
          // Recycle oldest
          this.recycleOldest();
        }
        const i = this.count;
        this.xWorld[i] = world.skidDebrisXWorld + (this.nextRandom() - 0.5) * 2;
        this.yWorld[i] = world.skidDebrisYWorld - this.nextRandom() * 1;
        // Debris flies upward and slightly outward
        this.vxWorld[i] = (this.nextRandom() - 0.5) * 30;
        this.vyWorld[i] = -(this.nextRandom() * 40 + 15);
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
      this.vyWorld[i] += 200 * dt;
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
