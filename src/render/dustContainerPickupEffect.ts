/**
 * dustContainerPickupEffect.ts — One-shot cosmetic golden-mote burst played
 * when the player collects a Dust Container (16 motes) or Dust Container
 * Shard (4 motes).
 *
 * Render-only: never touches WorldState, health, capacity, or save data.
 * Visual language follows src/render/stormweaveLifeMoteRenderer.ts (warm-gold
 * head + highlight pixel) but at roughly half size, since these are purely
 * decorative pickup feedback rather than the canonical health-derived motes.
 *
 * Lifecycle: for the first OUTWARD_PHASE_DURATION_SEC seconds after spawn,
 * a mote flies outward along its randomized launch vector with drag applied.
 * After that it switches to strong homing toward the player's live rendered
 * center (re-read every update, so it tracks a moving player) and is removed
 * once it reaches the absorption radius.
 */

/** Bounded pool size — comfortably covers several overlapping bursts (16 + 4 + margin). */
export const MAX_DUST_CONTAINER_PICKUP_MOTES = 64;

/** Duration of the outward ballistic phase before homing begins. */
const OUTWARD_PHASE_DURATION_SEC = 1.0;

const OUTWARD_SPEED_MIN_WORLD = 60;
const OUTWARD_SPEED_MAX_WORLD = 110;
/** Exponential drag coefficient applied during the outward phase (per second). */
const OUTWARD_DRAG_PER_SEC = 1.5;

const HOMING_ACCEL_WORLD_PER_SEC2 = 900;
const HOMING_MAX_SPEED_WORLD = 260;

/** Mote is absorbed (removed) once within this world-unit radius of the player center. */
const ABSORPTION_RADIUS_WORLD = 4;

export type DustContainerPickupKind = 'container' | 'shard';

/** Cosmetic mote count granted per pickup kind — the TODO's exact 16/4 spec. */
export const DUST_CONTAINER_PICKUP_MOTE_COUNT: Record<DustContainerPickupKind, number> = {
  container: 16,
  shard: 4,
};

export class DustContainerPickupEffect {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_DUST_CONTAINER_PICKUP_MOTES);
  private readonly yWorld = new Float32Array(MAX_DUST_CONTAINER_PICKUP_MOTES);
  private readonly vxWorld = new Float32Array(MAX_DUST_CONTAINER_PICKUP_MOTES);
  private readonly vyWorld = new Float32Array(MAX_DUST_CONTAINER_PICKUP_MOTES);
  private readonly ageSec = new Float32Array(MAX_DUST_CONTAINER_PICKUP_MOTES);
  private rngState = 1;

  /** Deterministic PRNG for visual-only randomization (no wall-clock randomness). */
  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  /** Spawns exactly `moteCount` motes radiating from (xWorld, yWorld). */
  spawnBurst(xWorld: number, yWorld: number, moteCount: number): void {
    for (let n = 0; n < moteCount; n++) {
      let i = this.count;
      if (i >= MAX_DUST_CONTAINER_PICKUP_MOTES) {
        // Pool full: recycle the oldest mote rather than growing/dropping the burst.
        i = this.findOldestIndex();
      } else {
        this.count++;
      }
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = OUTWARD_SPEED_MIN_WORLD + this.nextRandom() * (OUTWARD_SPEED_MAX_WORLD - OUTWARD_SPEED_MIN_WORLD);
      this.xWorld[i] = xWorld;
      this.yWorld[i] = yWorld;
      this.vxWorld[i] = Math.cos(angle) * speed;
      this.vyWorld[i] = Math.sin(angle) * speed;
      this.ageSec[i] = 0;
    }
  }

  /** Convenience overload driven by pickup kind — see DUST_CONTAINER_PICKUP_MOTE_COUNT. */
  spawnPickupBurst(kind: DustContainerPickupKind, xWorld: number, yWorld: number): void {
    this.spawnBurst(xWorld, yWorld, DUST_CONTAINER_PICKUP_MOTE_COUNT[kind]);
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
    this.vxWorld[i] = this.vxWorld[this.count];
    this.vyWorld[i] = this.vyWorld[this.count];
    this.ageSec[i] = this.ageSec[this.count];
  }

  /**
   * Advances the pool by dtSec. playerXWorld/playerYWorld should be the
   * player's current *rendered* center so homing tracks a moving target.
   */
  update(dtSec: number, playerXWorld: number, playerYWorld: number): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageSec[i] += dtSec;
      if (this.ageSec[i] < OUTWARD_PHASE_DURATION_SEC) {
        // Outward ballistic phase: integrate with exponential drag.
        const dragFactor = Math.max(0, 1 - OUTWARD_DRAG_PER_SEC * dtSec);
        this.vxWorld[i] *= dragFactor;
        this.vyWorld[i] *= dragFactor;
        this.xWorld[i] += this.vxWorld[i] * dtSec;
        this.yWorld[i] += this.vyWorld[i] * dtSec;
      } else {
        // Homing phase: strong acceleration toward the player's live center.
        const dx = playerXWorld - this.xWorld[i];
        const dy = playerYWorld - this.yWorld[i];
        const dist = Math.hypot(dx, dy);
        if (dist <= ABSORPTION_RADIUS_WORLD) {
          this.removeAt(i);
          continue;
        }
        const invDist = 1 / dist;
        this.vxWorld[i] += dx * invDist * HOMING_ACCEL_WORLD_PER_SEC2 * dtSec;
        this.vyWorld[i] += dy * invDist * HOMING_ACCEL_WORLD_PER_SEC2 * dtSec;
        const speed = Math.hypot(this.vxWorld[i], this.vyWorld[i]);
        if (speed > HOMING_MAX_SPEED_WORLD) {
          const scale = HOMING_MAX_SPEED_WORLD / speed;
          this.vxWorld[i] *= scale;
          this.vyWorld[i] *= scale;
        }
        this.xWorld[i] += this.vxWorld[i] * dtSec;
        this.yWorld[i] += this.vyWorld[i] * dtSec;
      }
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
    ctx.globalAlpha = 1;
    for (let i = 0; i < this.count; i++) {
      const x = Math.round(this.xWorld[i] * scalePx + offsetXPx);
      const y = Math.round(this.yWorld[i] * scalePx + offsetYPx);
      // ~50% smaller than the 2x2 Stormweave life-mote head: a crisp 1x1 pixel.
      ctx.fillStyle = '#ffd451';
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  /** Removes every live mote and clears state — call on room load/activation, respawn, new run, and teardown. */
  reset(): void {
    this.count = 0;
  }

  /** Current live mote count — exposed for tests. */
  get moteCount(): number {
    return this.count;
  }
}
