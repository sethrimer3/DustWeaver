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
 * ── Multi-cell occupancy model (Phase 3: 2x2 sand) ─────────────────────────
 *
 * One `PixelMaterialParticle` record per authored/simulated particle,
 * regardless of footprint size (still cheap/sparse — no per-cell objects).
 * Two collections track them:
 *   - `particles: Set<PixelMaterialParticle>` — the master list, one entry
 *     per particle. Used for iteration (render/serialize/diagnostics) so a
 *     2x2 particle is never visited more than once.
 *   - `occupancy: Map<cellKey, PixelMaterialParticle>` — one entry PER
 *     OCCUPIED CELL. A 1x1 particle owns 1 key; a 2x2 particle owns 4 keys,
 *     all pointing at the same particle object. This is what makes "does
 *     this cell contain something" and "erase whatever covers this cell"
 *     O(1) regardless of footprint size, without scanning all particles.
 *   - `activeSet: Set<PixelMaterialParticle>` — subset of `particles` that
 *     are awake (mirrors Phase 1/2 design).
 *
 * Moving a particle (`moveParticle`) removes ALL of its old footprint keys,
 * then writes ALL of its new footprint keys — never a partial update. Every
 * region-free check before a move (`isRegionFree`) treats cells owned by the
 * particle ITSELF as free (an `ignore` parameter), since a 2x2 particle's
 * destination footprint always overlaps part of its own current footprint
 * (e.g. moving down by 1px, the bottom row of the old footprint overlaps the
 * top row of the new one) — without this self-exclusion a multi-cell
 * particle could never move at all.
 *
 * This design was chosen over "4 independent 1x1 particles logically grouped"
 * because that would require extra bookkeeping to keep the group's 4 members
 * moving in lockstep and to prevent them drifting apart/rotating — the task
 * explicitly requires 2x2 sand NOT split, rotate, or become 4 separate
 * particles. A single record with a multi-key occupancy footprint guarantees
 * that structurally: there is only one `(x, y)` to move, so it cannot drift.
 */

import type { SolidMask } from './pixelMaterialSolid';
import {
  MATERIAL_SAND,
  SLEEP_DELAY_STEPS,
  WIND_MOMENTUM_DAMPING,
  WIND_MOMENTUM_EPSILON,
  getMaterialFootprintSize,
  isKnownMaterialId,
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

  /** One entry per occupied CELL (a size-N particle owns N*N keys, all pointing to the same particle). */
  private readonly occupancy = new Map<number, PixelMaterialParticle>();
  /** One entry per PARTICLE (unique) — used for iteration so multi-cell particles aren't visited more than once. */
  private readonly particles = new Set<PixelMaterialParticle>();
  private readonly activeSet = new Set<PixelMaterialParticle>();
  private stepCounter = 0;

  /**
   * Tracks the last-seen (x, y, w, h) of runtime wall slots that can move or
   * be destroyed after room load (falling blocks, crumble/breakable blocks),
   * keyed by wall index. Owned here (rather than as a module-level map) so
   * it resets automatically whenever a fresh `PixelMaterialSystem` is created
   * on room load — see `syncPixelMaterialSolidGeometry` in
   * `pixelMaterialSolidSync.ts`, which is the sole reader/writer.
   */
  readonly dynamicWallSnapshots = new Map<number, { x: number; y: number; w: number; h: number }>();

  /** Diagnostics for the current tick — see `resetWindDiagnostics()`. Dev-only consumers. */
  windImpulsesThisTick = 0;
  windParticlesAffectedThisTick = 0;

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

  /**
   * Returns true if (x, y) can be occupied — in bounds, not solid, and either
   * unoccupied or occupied only by `ignore` (used so a particle's own
   * footprint cells don't block its own move — see class doc comment).
   */
  private isFree(x: number, y: number, ignore?: PixelMaterialParticle): boolean {
    if (!this.inBounds(x, y)) return false;
    if (this.solid !== null && this.solid.isSolid(x, y)) return false;
    const occupant = this.occupancy.get(this.key(x, y));
    return occupant === undefined || occupant === ignore;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getMaterialAt(x: number, y: number): MaterialId {
    const p = this.occupancy.get(this.key(x, y));
    return p === undefined ? 0 : p.material;
  }

  isOccupied(x: number, y: number): boolean {
    return this.occupancy.has(this.key(x, y));
  }

  /** Returns true if a 1x1 particle could occupy this single cell (in bounds, not solid, not already occupied). */
  canOccupy(x: number, y: number): boolean {
    return this.isFree(x, y);
  }

  /**
   * Returns true if every cell of a `size x size` footprint anchored at
   * (x, y) is free (see `isFree`'s `ignore` semantics). `size` comes from
   * `getMaterialFootprintSize()`. This is the one shared footprint-region
   * check used by placement, movement, and wind — no per-material special
   * casing at any call site.
   */
  private isRegionFree(x: number, y: number, size: number, ignore?: PixelMaterialParticle): boolean {
    if (size <= 1) return this.isFree(x, y, ignore);
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        if (!this.isFree(x + dx, y + dy, ignore)) return false;
      }
    }
    return true;
  }

  /** Total occupied CELLS (a 2x2 particle counts as 4). Useful as a coverage diagnostic. */
  get occupiedCount(): number {
    return this.occupancy.size;
  }

  /** Total distinct PARTICLES (a 2x2 particle counts as 1). */
  get particleCount(): number {
    return this.particles.size;
  }

  get activeCount(): number {
    return this.activeSet.size;
  }

  get sleepingCount(): number {
    return this.particles.size - this.activeSet.size;
  }

  /** Read-only iterator over all particles (one call per particle, regardless
   *  of footprint size), for rendering/serialization/diagnostics. */
  forEachParticle(fn: (x: number, y: number, material: MaterialId, active: boolean) => void): void {
    for (const p of this.particles) fn(p.x, p.y, p.material, p.active);
  }

  // ── Editing (place / erase) ────────────────────────────────────────────

  place(x: number, y: number, material: MaterialId = MATERIAL_SAND): boolean {
    const size = getMaterialFootprintSize(material);
    if (!this.isRegionFree(x, y, size)) return false;
    const p: PixelMaterialParticle = {
      x, y, material, active: true, unchangedSteps: 0, windVelX: 0, windVelY: 0,
    };
    this.setFootprintKeys(p, x, y, size);
    this.particles.add(p);
    this.activeSet.add(p);
    this.wakeAround(x, y, size);
    return true;
  }

  /** Erases whatever particle (of any footprint size) covers cell (x, y), if any. */
  erase(x: number, y: number): boolean {
    const p = this.occupancy.get(this.key(x, y));
    if (p === undefined) return false;
    const size = getMaterialFootprintSize(p.material);
    this.clearFootprintKeys(p.x, p.y, size);
    this.particles.delete(p);
    this.activeSet.delete(p);
    this.wakeAround(p.x, p.y, size);
    return true;
  }

  clear(): void {
    this.occupancy.clear();
    this.particles.clear();
    this.activeSet.clear();
    this.stepCounter = 0;
    this.dynamicWallSnapshots.clear();
  }

  private setFootprintKeys(p: PixelMaterialParticle, x: number, y: number, size: number): void {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.occupancy.set(this.key(x + dx, y + dy), p);
      }
    }
  }

  private clearFootprintKeys(x: number, y: number, size: number): void {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        this.occupancy.delete(this.key(x + dx, y + dy));
      }
    }
  }

  private wake(p: PixelMaterialParticle): void {
    if (p.active) return;
    p.active = true;
    p.unchangedSteps = 0;
    this.activeSet.add(p);
  }

  /**
   * Wakes every particle (sleeping or already active) whose footprint
   * intersects the `size x size` region anchored at (x, y), PLUS a 1-cell
   * margin all around — used whenever a cell's occupant changes (moved away,
   * placed, or erased), since that may remove support or destabilize an
   * adjacent settled particle. For `size === 1` this is exactly the original
   * Phase 1/2 "8 neighbours + self" wake, so 1x1 behavior is unchanged.
   */
  private wakeAround(x: number, y: number, size: number): void {
    this.wakeRegion(x - 1, y - 1, x + size, y + size);
  }

  /**
   * Wakes every particle (sleeping or already active) whose cell falls
   * within the given native-pixel AABB. Used when solid geometry changes in
   * a bounded region (a falling block moving, a crumble block being
   * destroyed) — see `notifySolidGeometryChanged` in `pixelMaterialSolidSync.ts`.
   * Bounded loop over the region only, not the full occupancy map.
   *
   * Correctly wakes multi-cell particles whose ANCHOR lies outside the given
   * bounds but whose footprint partially overlaps it: `occupancy` has one key
   * per occupied cell (see class doc comment), so any footprint cell that
   * falls inside the scanned region resolves to the owning particle exactly
   * like a 1x1 particle would.
   */
  wakeRegion(x0: number, y0: number, x1: number, y1: number): void {
    const minX = Math.max(0, Math.floor(x0));
    const maxX = Math.min(this.widthPx - 1, Math.ceil(x1));
    const minY = Math.max(0, Math.floor(y0));
    const maxY = Math.min(this.heightPx - 1, Math.ceil(y1));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = this.occupancy.get(this.key(x, y));
        if (p !== undefined) this.wake(p);
      }
    }
  }

  /** Resets the per-tick wind diagnostic counters. Call once per tick before
   *  any wind emitters run (see `pixelMaterialMovementWind.ts`). Cheap
   *  (two integer writes) — safe to call unconditionally every tick. */
  resetWindDiagnostics(): void {
    this.windImpulsesThisTick = 0;
    this.windParticlesAffectedThisTick = 0;
  }

  // ── External force (wind) ──────────────────────────────────────────────

  /**
   * Applies an impulse to every particle within `radiusPx` of the given
   * center, waking sleeping particles and adding wind momentum. Reusable by
   * any future caller (player dash, enemy ability, environmental gust) —
   * this system has no knowledge of who the source is beyond the optional
   * `sourceId` tag.
   *
   * Multi-cell policy (Phase 3): a particle is affected if ANY of its
   * footprint cells falls within the force area — chosen because it matches
   * how `wakeRegion`/collision already work (per-cell occupancy lookups) and
   * feels more physically right for a "gust hits part of a boulder" gust than
   * requiring the whole footprint or just the anchor to be inside the
   * radius. Force is applied to each affected particle exactly ONCE per call
   * (deduped via a local `Set`) regardless of how many of its footprint
   * cells fall inside the radius — otherwise a 2x2 particle would receive up
   * to 4x the momentum of a 1x1 particle for the same gust, which would make
   * bigger particles feel MORE fragile, the opposite of intended game feel.
   */
  applyWindForce(params: WindForceParams): void {
    const { centerXPx, centerYPx, radiusPx, forceX, forceY } = params;
    const falloff = params.falloff ?? 1;
    if (radiusPx <= 0) return;
    const minX = Math.max(0, Math.floor(centerXPx - radiusPx));
    const maxX = Math.min(this.widthPx - 1, Math.ceil(centerXPx + radiusPx));
    const minY = Math.max(0, Math.floor(centerYPx - radiusPx));
    const maxY = Math.min(this.heightPx - 1, Math.ceil(centerYPx + radiusPx));
    const affectedThisCall = new Set<PixelMaterialParticle>();
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p = this.occupancy.get(this.key(x, y));
        if (p === undefined || affectedThisCall.has(p)) continue;
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
        affectedThisCall.add(p);
      }
    }
    this.windImpulsesThisTick++;
    this.windParticlesAffectedThisTick += affectedThisCall.size;
    this.recordWindDebugEvent(centerXPx, centerYPx, radiusPx, forceX, forceY);
  }

  // ── Debug wind-event visualization (dev-only consumer) ──────────────────
  //
  // Fixed-capacity ring buffer of typed arrays — recording a wind event is an
  // O(1) write into pre-allocated storage, never a per-event object
  // allocation. `ageSteps` increments in `step()`; a debug renderer reads
  // `windDebugEventCapacity`/the typed arrays and ignores anything past its
  // own fade lifetime. See `render/pixelMaterials/pixelMaterialDebugRenderer.ts`,
  // which IS wired into the normal render path (gated behind `isDebugMode`).

  private static readonly DEBUG_WIND_EVENT_CAPACITY = 24;
  readonly windDebugCenterX = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY);
  readonly windDebugCenterY = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY);
  readonly windDebugRadius = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY);
  readonly windDebugDirX = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY);
  readonly windDebugDirY = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY);
  readonly windDebugAgeSteps = new Float32Array(PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY).fill(Infinity);
  private windDebugWriteIndex = 0;

  private recordWindDebugEvent(cx: number, cy: number, radius: number, forceX: number, forceY: number): void {
    const mag = Math.sqrt(forceX * forceX + forceY * forceY);
    const i = this.windDebugWriteIndex;
    this.windDebugCenterX[i] = cx;
    this.windDebugCenterY[i] = cy;
    this.windDebugRadius[i] = radius;
    this.windDebugDirX[i] = mag > 0 ? forceX / mag : 0;
    this.windDebugDirY[i] = mag > 0 ? forceY / mag : 0;
    this.windDebugAgeSteps[i] = 0;
    this.windDebugWriteIndex = (i + 1) % PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY;
  }

  /** Capacity of the debug wind-event ring buffer (for iterating the typed arrays above). */
  get windDebugEventCapacity(): number {
    return PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY;
  }

  // ── Simulation step (fixed timestep — call once per fixed sim tick) ────

  step(): void {
    this.stepCounter++;
    for (let i = 0; i < PixelMaterialSystem.DEBUG_WIND_EVENT_CAPACITY; i++) {
      this.windDebugAgeSteps[i]++;
    }
    if (this.activeSet.size === 0) return;
    const activeParticles = Array.from(this.activeSet);
    for (const p of activeParticles) this.stepParticle(p);
  }

  /** Atomically moves `p`'s entire footprint from its current position to (nx, ny) — never a partial update. */
  private moveParticle(p: PixelMaterialParticle, nx: number, ny: number): void {
    const size = getMaterialFootprintSize(p.material);
    const oldX = p.x;
    const oldY = p.y;
    this.clearFootprintKeys(oldX, oldY, size);
    p.x = nx;
    p.y = ny;
    this.setFootprintKeys(p, nx, ny, size);
    p.unchangedSteps = 0;
    this.wakeAround(oldX, oldY, size);
    this.wakeAround(nx, ny, size);
  }

  private stepParticle(p: PixelMaterialParticle): void {
    const size = getMaterialFootprintSize(p.material);

    // Decay wind momentum every step regardless of whether it moves this step.
    p.windVelX *= WIND_MOMENTUM_DAMPING;
    p.windVelY *= WIND_MOMENTUM_DAMPING;
    if (Math.abs(p.windVelX) < WIND_MOMENTUM_EPSILON) p.windVelX = 0;
    if (Math.abs(p.windVelY) < WIND_MOMENTUM_EPSILON) p.windVelY = 0;

    // 1. Gravity: attempt straight down (whole footprint must be free).
    if (this.isRegionFree(p.x, p.y + 1, size, p)) {
      this.moveParticle(p, p.x, p.y + 1);
      return;
    }

    // 2. Diagonal fall, alternating preference so piles don't lean one way.
    const leftFirst = preferLeftFirst(this.stepCounter, p.x);
    const dx1 = leftFirst ? -1 : 1;
    const dx2 = -dx1;
    if (this.isRegionFree(p.x + dx1, p.y + 1, size, p)) {
      this.moveParticle(p, p.x + dx1, p.y + 1);
      return;
    }
    if (this.isRegionFree(p.x + dx2, p.y + 1, size, p)) {
      this.moveParticle(p, p.x + dx2, p.y + 1);
      return;
    }

    // 3. Wind-driven upward displacement (temporary disturbance).
    if (p.windVelY < -WIND_MOMENTUM_EPSILON && this.isRegionFree(p.x, p.y - 1, size, p)) {
      this.moveParticle(p, p.x, p.y - 1);
      return;
    }

    // 4. Wind-driven sideways displacement.
    if (p.windVelX !== 0) {
      const dir = p.windVelX > 0 ? 1 : -1;
      if (this.isRegionFree(p.x + dir, p.y, size, p)) {
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

  /** Serializes current particles as authored placements (sparse list — most
   *  of the native-pixel grid is empty, so this avoids storing a dense
   *  480x270 array). One entry per PARTICLE (anchor position + material),
   *  never one entry per occupied cell — a 2x2 particle serializes to exactly
   *  one entry, matching how it was authored/placed. Runtime-only state
   *  (velocity, sleep counters) is not included; reloaded particles start
   *  active and re-settle naturally. */
  serialize(): RoomPixelMaterialDef[] {
    const list = Array.from(this.particles);
    // Sorted for deterministic output (stable diffs, deterministic tests).
    list.sort((a, b) => this.key(a.x, a.y) - this.key(b.x, b.y));
    return list.map(p => ({ xPixel: p.x, yPixel: p.y, material: p.material }));
  }

  /** Loads authored placements. Invalid/unknown-material/out-of-bounds/
   *  overlapping entries are silently skipped rather than throwing, so
   *  malformed room data can't crash room loading. */
  loadFromDefs(defs: readonly RoomPixelMaterialDef[]): void {
    for (const d of defs) {
      if (!Number.isFinite(d.xPixel) || !Number.isFinite(d.yPixel)) continue;
      if (!isKnownMaterialId(d.material)) continue;
      const x = Math.floor(d.xPixel);
      const y = Math.floor(d.yPixel);
      this.place(x, y, d.material as MaterialId);
    }
  }
}
