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
/** 1x1 water — `behavior: 'liquid'` (see MaterialBehavior), spreads laterally instead of piling. */
export const MATERIAL_WATER = 3;
/**
 * 1x1 sandstone — `behavior: 'static'`.  Does not fall or flow.  Fractures
 * into ordinary MATERIAL_SAND when:
 *   (a) the player contacts it with inward velocity ≥ SANDSTONE_FRACTURE_IMPACT_SPEED, or
 *   (b) accumulated wind erosion reaches SANDSTONE_EROSION_THRESHOLD.
 * See pixelMaterialSystem.ts for the fracture logic.
 */
export const MATERIAL_SANDSTONE = 4;

export type MaterialId =
  | typeof MATERIAL_EMPTY
  | typeof MATERIAL_SAND
  | typeof MATERIAL_SAND_2X2
  | typeof MATERIAL_WATER
  | typeof MATERIAL_SANDSTONE;

/**
 * High-level movement behavior a material follows in `PixelMaterialSystem.stepParticle`.
 * - `'sand'`   — falls straight down, then diagonally; sinks through liquids when
 *                falling/diagonal-falling; sleeps when it can't move.
 * - `'liquid'` — falls straight down, then diagonally, then spreads horizontally
 *                instead of piling/sleeping immediately; does not displace sand.
 *
 * - `'static'` — never moves on its own; accumulates wind for erosion only.
 *
 * Dispatch lives in `stepParticle`'s `switch (getMaterialBehavior(p.material))`
 * — add a new case there (and a `stepXParticle` method) for a new behavior,
 * rather than branching on material id throughout the sim.
 */
export type MaterialBehavior = 'sand' | 'liquid' | 'static';

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
  /** Movement behavior — see `MaterialBehavior`. */
  readonly behavior: MaterialBehavior;
}

export const MATERIAL_DEFS: Readonly<Record<number, MaterialDef>> = {
  [MATERIAL_SAND]: { footprintSize: 1, color: '#d9c07a', windResponse: 1, behavior: 'sand' },
  // Distinct but related hue (deeper/more saturated tan) so a 2x2 grain reads
  // as visually different from 1x1 sand at a glance, not just "bigger sand".
  // Reduced windResponse: a bigger grain should feel heavier/less reactive
  // than 1x1 sand under the same gust, not equally easy to blow around.
  [MATERIAL_SAND_2X2]: { footprintSize: 2, color: '#b8925a', windResponse: 0.55, behavior: 'sand' },
  // Distinct blue/cyan, clearly different from either sand tone. Higher
  // windResponse than sand — water is meant to feel lighter/more reactive.
  [MATERIAL_WATER]: { footprintSize: 1, color: '#4fa3d1', windResponse: 1.3, behavior: 'liquid' },
  // Warm grey with a slight ochre tint — reads as compressed stone next to
  // the loose golden hue of 1x1 sand, clearly different but tonally related.
  // windResponse: 0.6 so wind accumulates on sandstone (used for erosion),
  // but more slowly than loose sand, reflecting the material's greater mass.
  [MATERIAL_SANDSTONE]: { footprintSize: 1, color: '#c4a97d', windResponse: 0.6, behavior: 'static' },
};

/** Returns the material's square footprint size in native pixels (defaults to 1 for unknown ids). */
export function getMaterialFootprintSize(material: number): number {
  return MATERIAL_DEFS[material]?.footprintSize ?? 1;
}

/** Returns the material's movement behavior (defaults to `'sand'` for unknown ids — callers should
 *  gate on `isKnownMaterialId` first; this fallback only exists so the lookup itself can't throw). */
export function getMaterialBehavior(material: number): MaterialBehavior {
  return MATERIAL_DEFS[material]?.behavior ?? 'sand';
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

/**
 * One pixel-material particle (1x1 or a larger rigid footprint). Kept as a
 * small plain record, not a heavyweight object/entity. `PixelMaterialSystem`
 * holds exactly one of these per particle in a `particles: Set` (for unique
 * iteration) and additionally indexes it by every occupied cell in an
 * `occupancy: Map<cellKey, particle>` (one key per cell — N*N keys all
 * pointing at this same record for an N×N footprint), so per-cell lookup
 * stays O(1) regardless of footprint size.
 */
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
  /**
   * Accumulated wind-erosion damage for MATERIAL_SANDSTONE particles.
   * Incremented each step by the wind speed hitting this particle
   * (windSpeed × SANDSTONE_EROSION_RATE). Reset to 0 on fracture/conversion.
   * Always 0 for non-sandstone particles.
   */
  erosionDamage: number;
}

/** A single authored (serialized) pixel-material placement. */
export interface RoomPixelMaterialDef {
  readonly xPixel: number;
  readonly yPixel: number;
  readonly material: number;
}

// ── Sandstone fracture configuration ────────────────────────────────────────
//
// Velocity scale reference (all in native px/s = world units/s):
//   Walk/run: ≤120  Elevated ground speed (fast skid, carried momentum): ≤157.5
//   Momentum-combat activation: ≥175  Grapple swings routinely reach 250–420+ px/s.
//
// Impact threshold (200 px/s) is above ordinary elevated ground speed but
// well within grapple range, so only intentional high-speed impacts
// fracture sandstone.
//
// Fracture radius scales with excess speed above the threshold:
//   At 200 px/s → radius 0 (exactly 1 pixel).
//   At 420 px/s → excess 220 → radius ~2.2 px → about 3 pixels in total.
//
// Wind erosion: applyWindForce adds up to MAX_FORCE=130 px/s per tick.
// WIND_MOMENTUM_DAMPING=0.85, so steady-state peak ≈ 130/(1-0.85)×0.6≈520 px/s.
// Minimum erosion wind speed (40 px/s) is set well below typical gusts so
// even light environmental wind counts; strong grapple-driven wind erodes fast.
// At steady-state max wind the threshold (1800) is reached in ~23 ticks (<0.5s).
// At minimum wind (40 px/s) it takes ~1800/40 = 45 ticks (~0.75s).

/** Minimum inward player speed (px/s) needed to fracture sandstone on impact. */
export const SANDSTONE_FRACTURE_IMPACT_SPEED = 200;

/** Maximum sandstone fracture radius (px) at very high impact speed.
 *  Actual radius = clamp(0, MAX) × (impactSpeed - threshold) / SPEED_PER_RADIUS_PX. */
export const SANDSTONE_MAX_FRACTURE_RADIUS = 3;

/** Impact speed (px/s) above threshold that yields one additional pixel of fracture radius. */
export const SANDSTONE_SPEED_PER_RADIUS_PX = 100;

/** Ticks before another player-impact fracture event can occur in the same region.
 *  Prevents a single high-speed contact from fracturing the same block every frame. */
export const SANDSTONE_IMPACT_COOLDOWN_TICKS = 12;

/** Minimum wind speed (px/s, after windResponse scaling) for erosion to accumulate. */
export const SANDSTONE_MIN_EROSION_WIND_SPEED = 40;

/** Accumulated erosion damage at which a sandstone particle fractures into sand. */
export const SANDSTONE_EROSION_THRESHOLD = 1800;

/** Per-tick erosion rate: erosionDamage += windSpeed × this value each step. */
export const SANDSTONE_EROSION_RATE = 1.0;

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
  /**
   * Phase 2H: optional deterministic forward-only directional gate, for
   * custom-block wind vents (see customBlockWindVents.ts). Both `dirX` and
   * `dirY` must form a UNIT vector when provided together; a candidate cell
   * at offset (dx, dy) from the center is affected only if the angle between
   * (dx, dy) and (dirX, dirY) is within `cosHalfFanAngle` of parallel (i.e.
   * `dot((dx,dy)/|(dx,dy)|, (dirX,dirY)) >= cosHalfFanAngle`) — an oriented
   * cone intersected with the existing circular radius+falloff region, so
   * "forward range" is just `radiusPx` and "lateral fan width" is just this
   * angle, with NO new geometry primitive. Omitted (the default for every
   * existing caller — movement wind, tests, etc.) disables the gate entirely,
   * so every cell within `radiusPx` is affected exactly as before Phase 2H.
   * A cell exactly at the center (zero-length offset) always counts as
   * "forward" (undefined direction, never excluded).
   */
  readonly dirX?: number;
  readonly dirY?: number;
  /** Cosine of the half-angle of the forward cone. Ignored unless `dirX`/`dirY` are set. Defaults to 0 (a full forward half-plane, 90° each side) when `dirX`/`dirY` are set but this is omitted. */
  readonly cosHalfFanAngle?: number;
}
