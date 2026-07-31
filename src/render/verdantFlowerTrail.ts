/**
 * verdantFlowerTrail.ts — Render-only bounded pool of small pixel-art
 * flowers that briefly bloom where the player walks while Verdant Dust is
 * equipped.
 *
 * Spawn *decisions* are made deterministically in simulation
 * (`src/sim/clusters/verdantFlowerSpawn.ts`) once per newly crossed grounded
 * world pixel and published as bounded per-tick events on `WorldState`
 * (`verdantFlowerEventCount` / `verdantFlowerEventXWorld` / `...YWorld`).
 * This module only consumes those events to drive a small cosmetic
 * bloom → hold → wilt/fade animation — it never decides *whether* to spawn,
 * and never touches collision, health, movement, or save data.
 *
 * Deterministic recycling: a fixed-capacity ring buffer. When full, the
 * oldest (soonest to expire) flower is recycled for a new bloom rather than
 * growing or dropping the newest spawn.
 */

import type { WorldState } from '../sim/world';

export const MAX_VERDANT_FLOWERS = 48;

const BLOOM_DURATION_SEC = 0.25;
const HOLD_DURATION_SEC = 1.4;
const WILT_DURATION_SEC = 0.5;
const TOTAL_LIFETIME_SEC = BLOOM_DURATION_SEC + HOLD_DURATION_SEC + WILT_DURATION_SEC;

/** Deterministic per-flower shape/color variant count (small pixel-art variety). */
const FLOWER_VARIANT_COLORS = ['#ff6fae', '#ffd451', '#8fe0ff', '#c98bff', '#7bff8f'];

function hash32(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (Math.imul(h, 0x2545f491) ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

export class VerdantFlowerTrail {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_VERDANT_FLOWERS);
  private readonly yWorld = new Float32Array(MAX_VERDANT_FLOWERS);
  private readonly ageSec = new Float32Array(MAX_VERDANT_FLOWERS);
  private readonly variant = new Uint8Array(MAX_VERDANT_FLOWERS);
  private spawnSeq = 0;

  /**
   * Reads and clears this tick's flower-bloom events off `world`, spawning
   * one cosmetic flower per event (deterministically recycling the oldest
   * live flower if the pool is full).
   */
  consumeSpawnEvents(world: WorldState): void {
    const n = world.verdantFlowerEventCount;
    for (let i = 0; i < n; i++) {
      const x = world.verdantFlowerEventXWorld[i];
      const y = world.verdantFlowerEventYWorld[i];
      this.spawn(x, y);
    }
    world.verdantFlowerEventCount = 0;
  }

  private spawn(xWorld: number, yWorld: number): void {
    let idx = this.count;
    if (idx >= MAX_VERDANT_FLOWERS) {
      idx = this.findOldestIndex();
    } else {
      this.count++;
    }
    this.xWorld[idx] = xWorld;
    this.yWorld[idx] = yWorld;
    this.ageSec[idx] = 0;
    this.spawnSeq = (this.spawnSeq + 1) >>> 0;
    const h = hash32(Math.floor(xWorld), this.spawnSeq);
    this.variant[idx] = h % FLOWER_VARIANT_COLORS.length;
  }

  private findOldestIndex(): number {
    let oldestIdx = 0;
    let oldestAge = this.ageSec[0];
    for (let i = 1; i < this.count; i++) {
      if (this.ageSec[i] > oldestAge) {
        oldestAge = this.ageSec[i];
        oldestIdx = i;
      }
    }
    return oldestIdx;
  }

  private removeAt(i: number): void {
    this.count--;
    this.xWorld[i] = this.xWorld[this.count];
    this.yWorld[i] = this.yWorld[this.count];
    this.ageSec[i] = this.ageSec[this.count];
    this.variant[i] = this.variant[this.count];
  }

  update(dtSec: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageSec[i] += dtSec;
      if (this.ageSec[i] >= TOTAL_LIFETIME_SEC) {
        this.removeAt(i);
      }
    }
  }

  render(ctx: CanvasRenderingContext2D, offsetXPx: number, offsetYPx: number, scalePx: number): void {
    if (this.count === 0) return;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < this.count; i++) {
      const age = this.ageSec[i];
      let scale: number;
      let alpha: number;
      if (age < BLOOM_DURATION_SEC) {
        const t = age / BLOOM_DURATION_SEC;
        scale = t;
        alpha = t;
      } else if (age < BLOOM_DURATION_SEC + HOLD_DURATION_SEC) {
        scale = 1;
        alpha = 1;
      } else {
        const t = (age - BLOOM_DURATION_SEC - HOLD_DURATION_SEC) / WILT_DURATION_SEC;
        scale = 1 - t * 0.4;
        alpha = 1 - t;
      }
      const x = Math.round(this.xWorld[i] * scalePx + offsetXPx);
      const y = Math.round(this.yWorld[i] * scalePx + offsetYPx);
      const sizePx = Math.max(1, Math.round(2 * scale));
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = FLOWER_VARIANT_COLORS[this.variant[i]];
      ctx.fillRect(x - Math.floor(sizePx / 2), y - sizePx, sizePx, sizePx);
      // Small stem pixel rooted at the surface.
      ctx.fillStyle = '#3fae4a';
      ctx.fillRect(x, y - 1, 1, 1);
    }
    ctx.restore();
  }

  /** Removes every live flower and clears state — call on room load/activation, respawn, and session/menu boundaries. */
  reset(): void {
    this.count = 0;
    this.spawnSeq = 0;
  }

  /** Current live flower count — exposed for tests. */
  get flowerCount(): number {
    return this.count;
  }
}
