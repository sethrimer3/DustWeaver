/**
 * Crumble debris renderer — spawns small 1×1 pixel particles outward from a
 * crumble block when it is struck or destroyed.  Purely visual; does not affect
 * the simulation.
 *
 * Visual style: earth-toned dust chunks that fly outward and fade, similar to
 * the skid-debris and wall-jump effects.
 *
 * @note This renderer uses its own lightweight LCG PRNG (rngState) purely for
 * visual variety.  The state is never serialized and never affects any
 * simulation logic — simulation determinism is therefore not compromised.
 */

const MAX_DEBRIS = 120;
const DEBRIS_LIFETIME_MS = 500;
/** Particles spawned on a crack hit (first hit). */
const CRACK_SPAWN_COUNT = 6;
/** Particles spawned on a destroy hit (second hit). */
const DESTROY_SPAWN_COUNT = 14;
const DEBRIS_SPEED_MIN_WORLD = 20;
const DEBRIS_SPEED_MAX_WORLD = 80;
const DEBRIS_GRAVITY_WORLD_PER_SEC2 = 160;
/** Half-spread of the spawn jitter around the block center (world units). */
const SPAWN_JITTER_HALF_WORLD = 2;
/** Upward velocity bias applied to all debris particles (world units / s). */
const UPWARD_BIAS_WORLD_PER_SEC = 20;

/** Earthy rock/dust colour palette. */
const COLORS = ['#9a8070', '#b09878', '#706050', '#c8b090', '#504030'];

export class CrumbleDebrisRenderer {
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

  /**
   * Spawn debris at the given world position.
   * @param xWorld - center X of the crumble block
   * @param yWorld - center Y of the crumble block
   * @param isDestroy - true = block destroyed (more particles), false = cracked
   */
  notifyBlockHit(xWorld: number, yWorld: number, isDestroy: boolean): void {
    const count = isDestroy ? DESTROY_SPAWN_COUNT : CRACK_SPAWN_COUNT;
    for (let s = 0; s < count; s++) {
      const idx = this.count < MAX_DEBRIS ? this.count++ : this._recycleOldest();
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = DEBRIS_SPEED_MIN_WORLD +
        this.nextRandom() * (DEBRIS_SPEED_MAX_WORLD - DEBRIS_SPEED_MIN_WORLD);
      this.xWorld[idx] = xWorld + (this.nextRandom() - 0.5) * SPAWN_JITTER_HALF_WORLD * 2;
      this.yWorld[idx] = yWorld + (this.nextRandom() - 0.5) * SPAWN_JITTER_HALF_WORLD * 2;
      this.vxWorld[idx] = Math.cos(angle) * speed;
      this.vyWorld[idx] = Math.sin(angle) * speed - UPWARD_BIAS_WORLD_PER_SEC;
      this.ageMs[idx] = 0;
      this.colorIdx[idx] = (this.nextRandom() * COLORS.length) | 0;
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000.0;
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > DEBRIS_LIFETIME_MS) {
        this.count--;
        this.xWorld[i] = this.xWorld[this.count];
        this.yWorld[i] = this.yWorld[this.count];
        this.vxWorld[i] = this.vxWorld[this.count];
        this.vyWorld[i] = this.vyWorld[this.count];
        this.ageMs[i] = this.ageMs[this.count];
        this.colorIdx[i] = this.colorIdx[this.count];
        continue;
      }
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
      // Draw a slightly larger 2×2 pixel dot so debris is visible at low zoom
      ctx.fillRect(drawX - 1, drawY - 1, 2, 2);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  private _recycleOldest(): number {
    let oldestIdx = 0;
    let oldestAge = this.ageMs[0];
    for (let i = 1; i < this.count; i++) {
      if (this.ageMs[i] > oldestAge) {
        oldestAge = this.ageMs[i];
        oldestIdx = i;
      }
    }
    return oldestIdx;
  }
}
