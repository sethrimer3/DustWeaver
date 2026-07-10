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
/** 2x2 sand — a real multi-cell footprint (see MATERIAL_DEFS), not four independent grains. */
export const MATERIAL_SAND_2X2 = 2;

export type MaterialId = typeof MATERIAL_EMPTY | typeof MATERIAL_SAND | typeof MATERIAL_SAND_2X2;

/**
 * Per-material definition: visual + footprint size + wind response, so
 * additional materials can be added by extending this table rather than
 * touching the renderer, collision, or wind code.
 *
 * `footprintSize` is the material's square footprint in native pixels.
 * `MATERIAL_SAND` is 1x1; `MATERIAL_SAND_2X2` is a real 2x2 rigid multi-cell
 * particle (not four independent grains). It is threaded through placement
 * (`PixelMaterialSystem.place`/`canOccupy`/`isRegionFree`), movement
 * (`stepParticle`/`moveParticle`, which check/reserve the whole
 * `footprintSize x footprintSize` region atomically), wind
 * (`applyWindForce`), and the editor solid-check — no material-specific
 * branching at any of those call sites; a future footprint size only needs a
 * new table entry here.
 *
 * `windResponse` scales how much wind momentum a material accumulates per
 * unit of applied force (see `applyWindForce`) — lower values feel heavier/
 * less reactive. Defaults to `1` (full response) via `getMaterialWindResponse`
 * for any material that doesn't set it explicitly.
 */
export interface MaterialDef {
  /** Square footprint size in native pixels. */
  readonly footprintSize: number;
  /** CSS color string used for solid-fill rendering. */
  readonly color: string;
  /** Wind momentum multiplier (0–1 typical). Omit for the default of 1 (full response). */
  readonly windResponse?: number;
}

export const MATERIAL_DEFS: Readonly<Record<number, MaterialDef>> = {
  [MATERIAL_SAND]: { footprintSize: 1, color: '#d9c07a', windResponse: 1 },
  // Distinct but related hue (deeper/more saturated tan) so a 2x2 grain reads
  // as visually different from 1x1 sand at a glance, not just "bigger sand".
  // Reduced windResponse: a bigger grain should feel heavier/less reactive
  // than 1x1 sand under the same gust, not equally easy to blow around.
  [MATERIAL_SAND_2X2]: { footprintSize: 2, color: '#b8925a', windResponse: 0.55 },
};

/** Returns the material's square footprint size in native pixels (defaults to 1 for unknown ids). */
export function getMaterialFootprintSize(material: number): number {
  return MATERIAL_DEFS[material]?.footprintSize ?? 1;
}

/** Returns true if `material` is a recognized, placeable material id (not `MATERIAL_EMPTY`, not unknown). */
export function isKnownMaterialId(material: number): material is MaterialId {
  return material !== MATERIAL_EMPTY && MATERIAL_DEFS[material] !== undefined;
}

/** Returns the material's wind-momentum multiplier (defaults to 1 — full response — for unknown ids or when unset). */
export function getMaterialWindResponse(material: number): number {
  return MATERIAL_DEFS[material]?.windResponse ?? 1;
}

/**
 * Centralized visual properties per material, so additional materials can be
 * added later without touching the renderer. Structurally a view over
 * `MATERIAL_DEFS` (every `MaterialDef` already has a `color`), kept as a
 * separate exported type so renderer code doesn't need to know about
 * footprints.
 */
export interface MaterialVisual {
  /** CSS color string used for solid-fill rendering. */
  readonly color: string;
}

export const MATERIAL_VISUALS: Readonly<Record<number, MaterialVisual>> = MATERIAL_DEFS;

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
