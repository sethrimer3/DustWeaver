/**
 * iceMoteAura.ts — Ice Mote Freeze Aura System.
 *
 * When the player has Ice Motes equipped, water zones within a configurable
 * radius are temporarily frozen: they become solid one-way-platform ice walls
 * and are suppressed from buoyancy physics and liquid rendering.  When the
 * player moves away (or Ice Motes are unequipped) the ice thaws after a
 * short delay, removing the injected walls and restoring the water zones.
 *
 * Design decisions:
 *  - Frozen walls are injected at the END of the world.wallCount array,
 *    starting at _aura.baseWallCount (captured at room load).  This keeps
 *    authored walls intact and untouched.
 *  - Each frozen zone occupies exactly one wall slot.  On thaw, the slot is
 *    compacted by swapping with the last frozen slot.
 *  - `world.frozenWaterZoneMask[zi]` is 1 while a zone is frozen; hazards.ts
 *    and liquidBodyBuilder.ts skip masked zones.
 *  - `markLiquidBodiesDirty()` is called whenever the frozen set changes so
 *    the liquid renderer rebuilds its cache next frame.
 */

import type { WorldState } from './world';
import { MAX_WALLS } from './world';
import { MAX_WATER_ZONES } from './worldHazardState';
import { SURFACE_RIM_STYLE_INDEX_DEFAULT } from '../render/walls/surfaceRimStyle';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import { ParticleKind } from './particles/kinds';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Freeze radius in world units (1 wu = 1 virtual pixel at zoom 1.0). */
export const ICE_MOTE_FREEZE_RADIUS_WORLD = 80;

/**
 * Fixed lifetime of a frozen zone, in simulation milliseconds.  The sim runs
 * at a fixed 16.666ms tick (60 Hz — see tick.ts), so 1000ms is exactly 60
 * ticks.  This is driven by world.dtMs (accumulated only when tick() runs),
 * never wall-clock time, so pause and deterministic replay are unaffected.
 * Once a zone freezes this timer runs to completion regardless of whether
 * the player remains within the freeze radius the whole time.
 */
export const ICE_MOTE_FREEZE_LIFETIME_MS = 1000;

/**
 * Maximum number of water zones that can be simultaneously frozen.
 * Caps wall-slot usage to avoid overflowing the world.wallCount array.
 */
export const ICE_MOTE_MAX_FROZEN_ZONES = 64;

// ── Internal state ────────────────────────────────────────────────────────────

interface IceMoteAuraState {
  /** True when the effect is currently active (Ice Motes are equipped). */
  isActive: boolean;
  /**
   * Wall index at which frozen-water wall slots begin.
   * Captured from world.wallCount after the room's authored walls are loaded.
   */
  baseWallCount: number;
  /** Current number of frozen wall slots (zones frozen right now). */
  frozenSlotCount: number;
  /**
   * Maps water zone index → frozen wall slot index.
   * Slot indices are relative offsets from baseWallCount.
   */
  readonly zoneToSlot: Map<number, number>;
  /**
   * Maps frozen wall slot index → water zone index (inverse of zoneToSlot).
   */
  readonly slotToZone: Int16Array;
  /**
   * Per-zone elapsed-frozen time in ms, counting up from 0 the instant the
   * zone freezes.  Runs to ICE_MOTE_FREEZE_LIFETIME_MS unconditionally —
   * continued proximity does NOT reset it.  Indexed by zone index.
   */
  readonly frozenElapsedMs: Float32Array;
  /**
   * True while a zone is in its post-thaw cooldown: it has thawed but has
   * not yet left the freeze radius, so it cannot be re-frozen.  Cleared the
   * moment the zone is found outside the radius.  Indexed by zone index.
   */
  readonly postThawCooldown: Uint8Array;
}

const _aura: IceMoteAuraState = {
  isActive:       false,
  baseWallCount:  0,
  frozenSlotCount: 0,
  zoneToSlot:     new Map<number, number>(),
  slotToZone:     new Int16Array(ICE_MOTE_MAX_FROZEN_ZONES).fill(-1),
  frozenElapsedMs: new Float32Array(MAX_WATER_ZONES),
  postThawCooldown: new Uint8Array(MAX_WATER_ZONES),
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call after each room's hazards are loaded (Phase E in gameLoadRoomPhases.ts).
 * Records the base wall count so frozen walls can be appended without
 * interfering with authored geometry, and clears any stale freeze state.
 */
export function resetIceMoteAuraForRoom(world: WorldState): void {
  // Thaw everything without triggering wall array writes (room is being rebuilt).
  _aura.zoneToSlot.clear();
  _aura.slotToZone.fill(-1);
  _aura.frozenSlotCount = 0;
  _aura.isActive = false;
  _aura.frozenElapsedMs.fill(0);
  _aura.postThawCooldown.fill(0);
  world.frozenWaterZoneMask.fill(0);
  _aura.baseWallCount = world.wallCount;
  // Liquid bodies will rebuild naturally on the next getLiquidBodies() call
  // (markLiquidBodiesDirty is called by loadRoomHazards already; no extra call needed).
}

/**
 * Per-tick update — call as the very first step in tick() before
 * computePlayerWaterState so the frozen mask and wall slots are current.
 */
export function tickIceMoteAura(world: WorldState): void {
  const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
  const playerIsAlive = player !== undefined && player.isAliveFlag === 1;
  const active = world.selectedDustKind === ParticleKind.Ice && playerIsAlive;
  const dt = world.dtMs;

  if (active !== _aura.isActive) {
    _aura.isActive = active;
  }

  // ── Unconditionally advance the fixed lifetime of every frozen zone ──────
  // Continued proximity never resets or extends this timer — it always runs
  // to exactly ICE_MOTE_FREEZE_LIFETIME_MS from the tick it froze on.
  // Iterate backwards over slotToZone so that _thawZone's slot compaction
  // (swap-with-last) never disturbs indices we haven't visited yet.
  for (let s = _aura.frozenSlotCount - 1; s >= 0; s--) {
    const zi = _aura.slotToZone[s];
    _aura.frozenElapsedMs[zi] += dt;
    if (_aura.frozenElapsedMs[zi] >= ICE_MOTE_FREEZE_LIFETIME_MS) {
      _thawZone(world, zi);
    }
  }

  // ── Post-thaw cooldown clearing: a thawed zone becomes eligible to freeze
  //    again only once it is found outside the freeze radius (prevents
  //    instant re-freeze while the player never left range). ────────────────
  if (player !== undefined) {
    const px0 = player.positionXWorld;
    const py0 = player.positionYWorld;
    const r02 = ICE_MOTE_FREEZE_RADIUS_WORLD * ICE_MOTE_FREEZE_RADIUS_WORLD;
    for (let i = 0; i < world.waterZoneCount; i++) {
      if (_aura.postThawCooldown[i] !== 1) continue;
      const rx = world.waterZoneXWorld[i];
      const ry = world.waterZoneYWorld[i];
      const rw = world.waterZoneWWorld[i];
      const rh = world.waterZoneHWorld[i];
      if (_distSqToRect(px0, py0, rx, ry, rw, rh) > r02) {
        _aura.postThawCooldown[i] = 0;
      }
    }
  }

  if (!active) return;

  // ── Ice Motes are equipped; player is alive — freeze newly-in-range water zones ──
  const px  = player!.positionXWorld;
  const py  = player!.positionYWorld;
  const r2  = ICE_MOTE_FREEZE_RADIUS_WORLD * ICE_MOTE_FREEZE_RADIUS_WORLD;

  const usedSlots = _aura.frozenSlotCount;
  const available = ICE_MOTE_MAX_FROZEN_ZONES - usedSlots; // remaining capacity
  let newFreezes = 0;

  for (let i = 0; i < world.waterZoneCount && newFreezes < available; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue; // already frozen
    if (_aura.postThawCooldown[i] === 1) continue; // must leave radius first

    const rx  = world.waterZoneXWorld[i];
    const ry  = world.waterZoneYWorld[i];
    const rw  = world.waterZoneWWorld[i];
    const rh  = world.waterZoneHWorld[i];

    if (_distSqToRect(px, py, rx, ry, rw, rh) <= r2) {
      _freezeZone(world, i);
      newFreezes++;
    }
  }
}

/**
 * Returns a snapshot of debug info for the current frame.
 * Safe to call only when debug mode is active (allocates a small object).
 */
export interface IceMoteAuraDebugInfo {
  isActive: boolean;
  frozenZoneCount: number;
  radiusWorld: number;
}

export function getIceMoteAuraDebugInfo(): IceMoteAuraDebugInfo {
  return {
    isActive:        _aura.isActive,
    frozenZoneCount: _aura.frozenSlotCount,
    radiusWorld:     ICE_MOTE_FREEZE_RADIUS_WORLD,
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Squared nearest-point-on-AABB distance from point (px,py) to rectangle
 * at (rx,ry,rw,rh).  Returns 0 when the point is inside the rectangle.
 */
function _distSqToRect(
  px: number, py: number,
  rx: number, ry: number, rw: number, rh: number,
): number {
  const dx = Math.max(rx - px, 0, px - (rx + rw));
  const dy = Math.max(ry - py, 0, py - (ry + rh));
  return dx * dx + dy * dy;
}

/**
 * Freeze a water zone: inject a one-way-platform ice wall covering its bounds,
 * set the frozen mask, and mark the liquid cache dirty.
 */
function _freezeZone(world: WorldState, zi: number): void {
  if (_aura.frozenSlotCount >= ICE_MOTE_MAX_FROZEN_ZONES) return;
  const slot = _aura.frozenSlotCount;
  const wi   = _aura.baseWallCount + slot;
  if (wi >= MAX_WALLS) return; // safety guard

  // ── Inject wall ──────────────────────────────────────────────────────────
  world.wallXWorld[wi]                  = world.waterZoneXWorld[zi];
  world.wallYWorld[wi]                  = world.waterZoneYWorld[zi];
  world.wallWWorld[wi]                  = world.waterZoneWWorld[zi];
  world.wallHWorld[wi]                  = world.waterZoneHWorld[zi];
  world.wallIsPlatformFlag[wi]          = 1;
  world.wallPlatformEdge[wi]            = 0; // top surface only
  world.wallIsIceFlag[wi]               = 1;
  world.wallIsUltraIceFlag[wi]          = 0;
  world.wallRampOrientationIndex[wi]    = 255; // not a ramp
  world.wallIsBouncePadFlag[wi]         = 0;
  world.wallBouncePadSpeedFactorIndex[wi] = 0;
  world.wallIsKineticBlockFlag[wi]      = 0;
  world.wallKineticBlockIndex[wi]       = -1;
  world.wallIsInvisibleFlag[wi]         = 0;
  world.wallIsPillarHalfWidthFlag[wi]   = 0;
  world.wallThemeIndex[wi]              = 255; // use room default
  world.wallSurfaceRimStyleIndex[wi]    = SURFACE_RIM_STYLE_INDEX_DEFAULT;
  world.wallSoundHardnessIndex[wi]      = 1;   // normal hardness

  // ── Update tracking state ────────────────────────────────────────────────
  _aura.zoneToSlot.set(zi, slot);
  _aura.slotToZone[slot] = zi;
  _aura.frozenSlotCount++;
  world.wallCount = _aura.baseWallCount + _aura.frozenSlotCount;
  world.frozenWaterZoneMask[zi] = 1;
  _aura.frozenElapsedMs[zi] = 0;

  markLiquidBodiesDirty();
}

/**
 * Thaw a water zone: remove its injected wall slot (compact array by swapping
 * with the last frozen slot), clear the frozen mask, and mark the liquid cache
 * dirty.
 */
function _thawZone(world: WorldState, zi: number): void {
  const slot = _aura.zoneToSlot.get(zi);
  if (slot === undefined) return;

  const lastSlot = _aura.frozenSlotCount - 1;
  if (slot !== lastSlot) {
    // Swap this slot with the last slot to keep the array compact.
    const lastZi = _aura.slotToZone[lastSlot];
    const lastWi = _aura.baseWallCount + lastSlot;
    const thisWi = _aura.baseWallCount + slot;

    // Copy last wall into this slot.
    world.wallXWorld[thisWi]                   = world.wallXWorld[lastWi];
    world.wallYWorld[thisWi]                   = world.wallYWorld[lastWi];
    world.wallWWorld[thisWi]                   = world.wallWWorld[lastWi];
    world.wallHWorld[thisWi]                   = world.wallHWorld[lastWi];
    world.wallIsPlatformFlag[thisWi]           = world.wallIsPlatformFlag[lastWi];
    world.wallPlatformEdge[thisWi]             = world.wallPlatformEdge[lastWi];
    world.wallIsIceFlag[thisWi]                = world.wallIsIceFlag[lastWi];
    world.wallIsUltraIceFlag[thisWi]           = world.wallIsUltraIceFlag[lastWi];
    world.wallRampOrientationIndex[thisWi]     = world.wallRampOrientationIndex[lastWi];
    world.wallIsBouncePadFlag[thisWi]          = world.wallIsBouncePadFlag[lastWi];
    world.wallBouncePadSpeedFactorIndex[thisWi]= world.wallBouncePadSpeedFactorIndex[lastWi];
    world.wallIsKineticBlockFlag[thisWi]       = world.wallIsKineticBlockFlag[lastWi];
    world.wallKineticBlockIndex[thisWi]        = world.wallKineticBlockIndex[lastWi];
    world.wallIsInvisibleFlag[thisWi]          = world.wallIsInvisibleFlag[lastWi];
    world.wallIsPillarHalfWidthFlag[thisWi]    = world.wallIsPillarHalfWidthFlag[lastWi];
    world.wallThemeIndex[thisWi]               = world.wallThemeIndex[lastWi];
    world.wallSurfaceRimStyleIndex[thisWi]     = world.wallSurfaceRimStyleIndex[lastWi];
    world.wallSoundHardnessIndex[thisWi]       = world.wallSoundHardnessIndex[lastWi];

    // Update index maps for the moved zone.
    _aura.zoneToSlot.set(lastZi, slot);
    _aura.slotToZone[slot] = lastZi;
  }

  // Remove the last slot.
  _aura.slotToZone[lastSlot] = -1;
  _aura.zoneToSlot.delete(zi);
  _aura.frozenSlotCount--;
  world.wallCount = _aura.baseWallCount + _aura.frozenSlotCount;
  world.frozenWaterZoneMask[zi] = 0;
  _aura.frozenElapsedMs[zi] = 0;
  // Enter post-thaw cooldown: this zone cannot re-freeze until it is
  // observed outside the freeze radius at least once.
  _aura.postThawCooldown[zi] = 1;

  markLiquidBodiesDirty();
}
