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
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import { ParticleKind } from './particles/kinds';
import { MOTE_STATE_AVAILABLE } from './motes/orderedMoteQueue';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Freeze radius in world units (1 wu = 1 virtual pixel at zoom 1.0). */
export const ICE_MOTE_FREEZE_RADIUS_WORLD = 48;

/** Thaw delay in ms after a zone leaves the freeze radius (or motes unequip). */
export const ICE_MOTE_THAW_DELAY_MS = 600;

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
   * Per-zone thaw countdown in ms.  > 0 while counting down.  0 = not thawing.
   * Indexed by zone index (not slot index).
   */
  readonly thawTimers: Float32Array;
}

const _aura: IceMoteAuraState = {
  isActive:       false,
  baseWallCount:  0,
  frozenSlotCount: 0,
  zoneToSlot:     new Map<number, number>(),
  slotToZone:     new Int16Array(ICE_MOTE_MAX_FROZEN_ZONES).fill(-1),
  thawTimers:     new Float32Array(MAX_WATER_ZONES),
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
  _aura.thawTimers.fill(0);
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
  const equipped = _hasIceMoteEquipped(world);
  const player   = world.clusters.length > 0 ? world.clusters[0] : undefined;
  const playerAlive = player !== undefined && player.isAliveFlag === 1;
  const dt = world.dtMs;

  if (equipped !== _aura.isActive) {
    _aura.isActive = equipped;
  }

  if (!equipped || !playerAlive) {
    // Start or advance thaw timers for all currently frozen zones.
    // We iterate a copy of keys to avoid mutation-during-iteration issues.
    for (const zi of _aura.zoneToSlot.keys()) {
      _aura.thawTimers[zi] += dt;
      if (_aura.thawTimers[zi] >= ICE_MOTE_THAW_DELAY_MS) {
        _thawZone(world, zi);
      }
    }
    return;
  }

  // ── Ice Motes are equipped; player is alive ───────────────────────────────

  const px  = player!.positionXWorld;
  const py  = player!.positionYWorld;
  const r2  = ICE_MOTE_FREEZE_RADIUS_WORLD * ICE_MOTE_FREEZE_RADIUS_WORLD;

  // ── Advance thaw timers for zones outside the radius ─────────────────────
  // Snapshot keys before mutating (thawing removes entries).
  const frozenKeys = Array.from(_aura.zoneToSlot.keys());
  for (const zi of frozenKeys) {
    const rx  = world.waterZoneXWorld[zi];
    const ry  = world.waterZoneYWorld[zi];
    const rw  = world.waterZoneWWorld[zi];
    const rh  = world.waterZoneHWorld[zi];
    if (_distSqToRect(px, py, rx, ry, rw, rh) <= r2) {
      // Still inside radius — cancel any pending thaw.
      _aura.thawTimers[zi] = 0;
    } else {
      // Outside radius — advance thaw timer.
      _aura.thawTimers[zi] += dt;
      if (_aura.thawTimers[zi] >= ICE_MOTE_THAW_DELAY_MS) {
        _thawZone(world, zi);
      }
    }
  }

  // ── Freeze newly-in-range water zones ────────────────────────────────────
  const cap = world.wallCount - _aura.baseWallCount; // already-frozen slots
  const available = ICE_MOTE_MAX_FROZEN_ZONES - cap; // headroom
  let newFreezes = 0;

  for (let i = 0; i < world.waterZoneCount && newFreezes < available; i++) {
    if (world.frozenWaterZoneMask[i] === 1) continue; // already frozen

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

/** Returns true if any Ice Mote slot is in the AVAILABLE (equipped) state. */
function _hasIceMoteEquipped(world: WorldState): boolean {
  for (let i = 0; i < world.moteSlotCount; i++) {
    if (
      world.moteSlotKind[i]  === ParticleKind.Ice &&
      world.moteSlotState[i] === MOTE_STATE_AVAILABLE
    ) {
      return true;
    }
  }
  return false;
}

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
  world.wallSoundHardnessIndex[wi]      = 1;   // normal hardness

  // ── Update tracking state ────────────────────────────────────────────────
  _aura.zoneToSlot.set(zi, slot);
  _aura.slotToZone[slot] = zi;
  _aura.frozenSlotCount++;
  world.wallCount = _aura.baseWallCount + _aura.frozenSlotCount;
  world.frozenWaterZoneMask[zi] = 1;
  _aura.thawTimers[zi] = 0;

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
  _aura.thawTimers[zi] = 0;

  markLiquidBodiesDirty();
}
