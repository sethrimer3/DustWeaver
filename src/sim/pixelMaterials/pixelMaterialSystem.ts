/**
 * PixelMaterialSystem — the pixel-scale falling-sand simulation layer.
 *
 * Owns:
 *  - Material occupancy + material type per occupied native-pixel cell.
 *  - Active/awake particle tracking (sleeping particles are not simulated).
 *  - Fixed-step simulation (one call to `step()` = one fixed sim step).
 *  - Collision queries against the immutable world-tile solid mask.
 *  - External-force ("wind") application.
 *  - Serialization data (authored placements only — runtime velocity/sleep
 *    state is not persisted).
 *
 * This is a separate simulation layer from the existing tile/collision/entity
 * architecture — it queries world-tile solidity via `SolidMask` but does not
 * modify or participate in the existing collision pipeline. See
 * docs/pixelMaterials.md for the full design writeup.
 *
 * Data-oriented representation: particles are small plain records stored in
 * a `Map` keyed by cell index (sparse — most of the 480x270 native-pixel grid
 * is empty), not one heavyweight object/entity per pixel. No per-frame full
 * grid scans: only active particles are stepped, plus a small active-key set.
 */

import type { SolidMask } from './pixelMaterialSolid';
import {
  MATERIAL_SAND,
  SLEEP_DELAY_STEPS,
  WIND_MOMENTUM_DAMPING,
  WIND_MOMENTUM_EPSILON,
  type MaterialId,
  type PixelMaterialParticle,
  type RoomPixelMaterialDef,
  type WindForceParams,
} from './pixelMaterialTypes';

/** Deterministic alternating diagonal-preference chooser (no RNG). */
function preferLeftFirst(stepCounter: number, x: number): boolean {
  return ((stepCounter + x) & 1) === 0;
}

export class PixelMaterialSystem {
  widthPx: number;
  heightPx: number;
  solid: SolidMask | null = null;

  private readonly occupancy = new Map<number, PixelMaterialParticle>();
  private readonly activeSet = new Set<PixelMaterialParticle>();
  private stepCounter = 0;

  constructor(widthPx: number, heightPx: number, solid: SolidMask | null = null) {
    this.widthPx = Math.max(0, Math.floor(widthPx));
    this.heightPx = Math.max(0, Math.floor(heightPx));
    this.solid = solid;
  }

  private key(x: number, y: number): number {
    return y * this.widthPx + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.widthPx && y < this.heightPx;
  }

  private isFree(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.solid !== null && this.solid.isSolid(x, y)) return false;
    return !this.occupancy.has(this.key(x, y));
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getMaterialAt(x: number, y: number): MaterialId {
    const p = this.occupancy.get(this.key(x, y));
    return p === undefined ? 0 : p.material;
  }

  isOccupied(x: number, y: number): boolean {
    return this.occupancy.has(this.key(x, y));
  }

  /** Returns true if a sand particle could occupy this cell (in bounds, not solid, not already occupied). */
  canOccupy(x: number, y: number): boolean {
    return this.isFree(x, y);
  }

  get occupiedCount(): number {
    return this.occupancy.size;
  }

  get activeCount(): number {
    return this.activeSet.size;
  }

  get sleepingCount(): number {
    return this.occupancy.size - this.activeSet.size;
  }

  /** Read-only iterator over all occupied cells, for rendering/serialization/diagnostics. */
  forEachParticle(fn: (x: number, y: number, material: MaterialId, active: boolean) => void): void {
    for (const p of this.occupancy.values()) fn(p.x, p.y, p.material, p.active);
  }

  // ── Editing (place / erase) ────────────────────────────────────────────

  place(x: number, y: number, material: MaterialId = MATERIAL_SAND): boolean {
    if (!this.isFree(x, y)) return false;
    const p: PixelMaterialParticle = {
      x, y, material, active: true, unchangedSteps: 0, windVelX: 0, windVelY: 0,
    };
    this.occupancy.set(this.key(x, y), p);
    this.activeSet.add(p);
    this.wakeNeighbors(x, y);
    return true;
  }

  erase(x: number, y: number): boolean {
    const k = this.key(x, y);
    const p = this.occupancy.get(k);
    if (p === undefined) return false;
    this.occupancy.delete(k);
    this.activeSet.delete(p);
    this.wakeNeighbors(x, y);
    return true;
  }

  clear(): void {
    this.occupancy.clear();
    this.activeSet.clear();
    this.stepCounter = 0;
  }

  private wake(p: PixelMaterialParticle): void {
    if (p.active) return;
    p.active = true;
    p.unchangedSteps = 0;
    this.activeSet.add(p);
  }

  /** Wakes any sleeping particles in the 8 neighbours of (x, y) — used when a
   *  cell's occupant changes (moved away, placed, or erased), since that may
   *  remove support or destabilize an adjacent settled particle. */
  private wakeNeighbors(x: number, y: number): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const p = this.occupancy.get(this.key(x + dx, y + dy));
        if (p !== undefined) this.wake(p);
      }
    }
  }

  // ── External force (wind) ──────────────────────────────────────────────

  /**
   * Applies an impulse to every particle within `radiusPx` of the given
   * center, waking sleeping particles and adding wind momentum. Reusable by
   * any future caller (player dash, enemy ability, environmental gust) —
   * this system has no knowledge of who the source is beyond the optional
   * `sourceId` tag.
   */
  applyWindForce(params: WindForceParams): void {
    const { centerXPx, centerYPx, radiusPx, forceX, forceY } = params;
    const falloff = params.falloff ?? 1;
    if (radiusPx <= 0) return;
    const minX = Math.max(0, Math.floor(centerXPx - radiusPx));
    const maxX = Math.min(this.widthPx - 1, Math.ceil(centerXPx + radiusPx));
    const minY = Math.max(0, Math.floor(centerYPx - radiusPx));
    const maxY = Math.min(this.heightPx - 1, Math.ceil(centerYPx + radiusPx));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = this.occupancy.get(this.key(x, y));
        if (p === undefined) continue;
        const dx = x - centerXPx;
        const dy = y - centerYPx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radiusPx) continue;
        const t = radiusPx > 0 ? dist / radiusPx : 0;
        const strength = 1 - falloff * t;
        if (strength <= 0) continue;
        p.windVelX += forceX * strength;
        p.windVelY += forceY * strength;
        this.wake(p);
      }
    }
  }

  // ── Simulation step (fixed timestep — call once per fixed sim tick) ────

  step(): void {
    this.stepCounter++;
    if (this.activeSet.size === 0) return;
    const particles = Array.from(this.activeSet);
    for (const p of particles) this.stepParticle(p);
  }

  private moveParticle(p: PixelMaterialParticle, nx: number, ny: number): void {
    this.occupancy.delete(this.key(p.x, p.y));
    const oldX = p.x;
    const oldY = p.y;
    p.x = nx;
    p.y = ny;
    this.occupancy.set(this.key(nx, ny), p);
    p.unchangedSteps = 0;
    this.wakeNeighbors(oldX, oldY);
    this.wakeNeighbors(nx, ny);
  }

  private stepParticle(p: PixelMaterialParticle): void {
    // Decay wind momentum every step regardless of whether it moves this step.
    p.windVelX *= WIND_MOMENTUM_DAMPING;
    p.windVelY *= WIND_MOMENTUM_DAMPING;
    if (Math.abs(p.windVelX) < WIND_MOMENTUM_EPSILON) p.windVelX = 0;
    if (Math.abs(p.windVelY) < WIND_MOMENTUM_EPSILON) p.windVelY = 0;

    // 1. Gravity: attempt straight down.
    if (this.isFree(p.x, p.y + 1)) {
      this.moveParticle(p, p.x, p.y + 1);
      return;
    }

    // 2. Diagonal fall, alternating preference so piles don't lean one way.
    const leftFirst = preferLeftFirst(this.stepCounter, p.x);
    const dx1 = leftFirst ? -1 : 1;
    const dx2 = -dx1;
    if (this.isFree(p.x + dx1, p.y + 1)) {
      this.moveParticle(p, p.x + dx1, p.y + 1);
      return;
    }
    if (this.isFree(p.x + dx2, p.y + 1)) {
      this.moveParticle(p, p.x + dx2, p.y + 1);
      return;
    }

    // 3. Wind-driven upward displacement (temporary disturbance).
    if (p.windVelY < -WIND_MOMENTUM_EPSILON && this.isFree(p.x, p.y - 1)) {
      this.moveParticle(p, p.x, p.y - 1);
      return;
    }

    // 4. Wind-driven sideways displacement.
    if (p.windVelX !== 0) {
      const dir = p.windVelX > 0 ? 1 : -1;
      if (this.isFree(p.x + dir, p.y)) {
        this.moveParticle(p, p.x + dir, p.y);
        return;
      }
    }

    // 5. No valid movement — remain stationary; count toward sleep.
    p.unchangedSteps++;
    if (p.unchangedSteps >= SLEEP_DELAY_STEPS && p.windVelX === 0 && p.windVelY === 0) {
      p.active = false;
      this.activeSet.delete(p);
    }
  }

  // ── Serialization ───────────────────────────────────────────────────────

  /** Serializes current occupancy as authored placements (sparse list — most
   *  of the native-pixel grid is empty, so this avoids storing a dense
   *  480x270 array). Runtime-only state (velocity, sleep counters) is not
   *  included; reloaded particles start active and re-settle naturally. */
  serialize(): RoomPixelMaterialDef[] {
    const out: RoomPixelMaterialDef[] = [];
    // Sorted for deterministic output (stable diffs, deterministic tests).
    const keys = Array.from(this.occupancy.keys()).sort((a, b) => a - b);
    for (const k of keys) {
      const p = this.occupancy.get(k)!;
      out.push({ xPixel: p.x, yPixel: p.y, material: p.material });
    }
    return out;
  }

  /** Loads authored placements. Invalid/out-of-bounds/duplicate entries are
   *  silently skipped rather than throwing, so malformed room data can't
   *  crash room loading. */
  loadFromDefs(defs: readonly RoomPixelMaterialDef[]): void {
    for (const d of defs) {
      if (!Number.isFinite(d.xPixel) || !Number.isFinite(d.yPixel)) continue;
      const x = Math.floor(d.xPixel);
      const y = Math.floor(d.yPixel);
      const material = (d.material === MATERIAL_SAND ? MATERIAL_SAND : 0) as MaterialId;
      if (material === 0) continue;
      this.place(x, y, material);
    }
  }
}
