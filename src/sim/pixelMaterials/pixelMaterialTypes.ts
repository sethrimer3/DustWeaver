/**
 * Pixel-material system — shared types and tuning constants.
 *
 * Coordinate space: native game pixels (1 unit = 1 native px = 1 world unit,
 * matching the rest of the sim — see ARCHITECTURE.md "Native-resolution
 * rendering"). An 8x8 world tile occupies an 8x8 block of these cells.
 */

/** Native game resolution (matches `BASE_VIRTUAL_WIDTH_PX` / `FIXED_VIRTUAL_HEIGHT_PX` in gameScreen.ts). */
export const NATIVE_WIDTH_PX = 480;
export const NATIVE_HEIGHT_PX = 270;

/** Material identifiers for occupied pixel-material cells. 0 = empty (not stored). */
export const MATERIAL_EMPTY = 0;
export const MATERIAL_SAND = 1;

export type MaterialId = typeof MATERIAL_EMPTY | typeof MATERIAL_SAND;

/**
 * Centralized visual properties per material, so additional materials can be
 * added later without touching the renderer.
 */
export interface MaterialVisual {
  /** CSS color string used for solid-fill rendering. */
  readonly color: string;
}

export const MATERIAL_VISUALS: Readonly<Record<number, MaterialVisual>> = {
  [MATERIAL_SAND]: { color: '#d9c07a' },
};

/** Ticks (fixed sim steps) an unmoving particle waits before it goes to sleep. */
export const SLEEP_DELAY_STEPS = 20;

/** Horizontal wind-momentum damping factor applied per fixed step (multiplicative). */
export const WIND_MOMENTUM_DAMPING = 0.85;

/** Minimum |momentum| (px/s) below which it is snapped to zero. */
export const WIND_MOMENTUM_EPSILON = 4;

/** One occupied pixel-material particle. Kept as a small plain record — the
 *  system stores these in a Map keyed by cell index, not as heavyweight
 *  per-particle objects/entities. */
export interface PixelMaterialParticle {
  x: number;
  y: number;
  material: MaterialId;
  /** True while this particle is being simulated every step. */
  active: boolean;
  /** Consecutive fixed-steps this particle has not moved. */
  unchangedSteps: number;
  /** Horizontal wind momentum, in px/s. Decays via damping each step. */
  windVelX: number;
  /** Vertical wind momentum, in px/s. Decays via damping each step; gravity dominates once it settles. */
  windVelY: number;
}

/** A single authored (serialized) pixel-material placement. */
export interface RoomPixelMaterialDef {
  readonly xPixel: number;
  readonly yPixel: number;
  readonly material: number;
}

/** Parameters for an external force ("wind") applied over an area. */
export interface WindForceParams {
  readonly centerXPx: number;
  readonly centerYPx: number;
  readonly radiusPx: number;
  readonly forceX: number;
  readonly forceY: number;
  /** 0 = no falloff (uniform within radius), 1 = full linear falloff to 0 at the edge. Default 1. */
  readonly falloff?: number;
  readonly sourceId?: string;
}
