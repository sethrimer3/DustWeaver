/**
 * Break effect renderer (Phase 2C) — spawns small material-tinted debris
 * particles outward from a destroyed fragile custom block. Purely visual;
 * mirrors the existing CrumbleDebrisRenderer pattern (own bounded arrays, own
 * deterministic LCG, no effect on simulation state).
 *
 * One `notifyBreak()` call = one break event = one logical placement (a 2x2
 * group is a single call with a modestly scaled-up count, never four calls).
 *
 * @note Uses its own lightweight LCG PRNG purely for visual variety. Never
 * serialized, never read by the simulation — determinism of gameplay is
 * unaffected. Tests can instantiate a fresh renderer (deterministic seed) and
 * assert on bounded counts without needing a canvas.
 */

import type { MaterialResponsePreset } from '../levels/customBlockProperties';
import type { GraphicsQuality } from '../ui/renderSettings';

const MAX_DEBRIS = 100;
const DEBRIS_GRAVITY_DEFAULT_WORLD_PER_SEC2 = 160;
/** Half-spread of the spawn jitter around the event center (world units). */
const SPAWN_JITTER_HALF_WORLD = 3;

export interface MaterialParticleProfile {
  /** Color palette this material's debris is drawn from. */
  readonly colors: readonly string[];
  readonly speedMinWorld: number;
  readonly speedMaxWorld: number;
  readonly gravityWorldPerSec2: number;
  readonly lifetimeMs: number;
  /** Particle count for a single (1x1, ungrouped) break event. */
  readonly baseCount: number;
  /** Particle count for a grouped (2x2) break event — modestly scaled, never 4x. */
  readonly groupedCount: number;
}

/** Compact gray/brown rocky debris — heavier and slower than wood or metal. */
const STONE_PROFILE: MaterialParticleProfile = {
  colors: ['#9a8070', '#b09878', '#706050', '#8c8c8c', '#504030'],
  speedMinWorld: 20,
  speedMaxWorld: 80,
  gravityWorldPerSec2: DEBRIS_GRAVITY_DEFAULT_WORLD_PER_SEC2,
  lifetimeMs: 500,
  baseCount: 10,
  groupedCount: 16,
};

/** Small tan/brown splinter-like debris. */
const WOOD_PROFILE: MaterialParticleProfile = {
  colors: ['#a97c50', '#c4995f', '#8a5a34', '#deb887', '#6b4423'],
  speedMinWorld: 24,
  speedMaxWorld: 90,
  gravityWorldPerSec2: DEBRIS_GRAVITY_DEFAULT_WORLD_PER_SEC2 * 0.85,
  lifetimeMs: 460,
  baseCount: 9,
  groupedCount: 14,
};

/** Brief bright spark-like particles — fast, low gravity, short-lived. */
const METAL_PROFILE: MaterialParticleProfile = {
  colors: ['#fff6c8', '#ffe066', '#e0e0e0', '#cfd8dc', '#fff2a8'],
  speedMinWorld: 60,
  speedMaxWorld: 160,
  gravityWorldPerSec2: DEBRIS_GRAVITY_DEFAULT_WORLD_PER_SEC2 * 0.35,
  lifetimeMs: 280,
  baseCount: 8,
  groupedCount: 13,
};

/** Returns the bounded, engine-owned particle profile for a material preset. */
export function getMaterialParticleProfile(material: MaterialResponsePreset): MaterialParticleProfile {
  switch (material) {
    case 'stone': return STONE_PROFILE;
    case 'wood': return WOOD_PROFILE;
    case 'metal': return METAL_PROFILE;
  }
}

/** Per-quality-tier particle count multiplier. 'low' visibly reduces cosmetic output. */
function qualityCountScale(quality: GraphicsQuality): number {
  switch (quality) {
    case 'low': return 0.4;
    case 'med': return 1.0;
    case 'high': return 1.3;
  }
}

/**
 * Resolves the actual particle count to spawn for one break event, given its
 * material, whether it is a grouped (2x2) placement, and the active graphics
 * quality tier. Pure and directly testable without a canvas or renderer
 * instance. Always spawns at least 1 particle unless quality-scaling would
 * round down to 0, in which case 0 is a valid (fully suppressed) result.
 */
export function resolveBreakParticleCount(
  material: MaterialResponsePreset,
  isGrouped: boolean,
  quality: GraphicsQuality,
): number {
  const profile = getMaterialParticleProfile(material);
  const base = isGrouped ? profile.groupedCount : profile.baseCount;
  return Math.round(base * qualityCountScale(quality));
}

export class BreakEffectRenderer {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_DEBRIS);
  private readonly yWorld = new Float32Array(MAX_DEBRIS);
  private readonly vxWorld = new Float32Array(MAX_DEBRIS);
  private readonly vyWorld = new Float32Array(MAX_DEBRIS);
  private readonly gravityWorld = new Float32Array(MAX_DEBRIS);
  private readonly ageMs = new Float32Array(MAX_DEBRIS);
  private readonly lifetimeMs = new Float32Array(MAX_DEBRIS);
  private readonly colorIdx = new Uint8Array(MAX_DEBRIS);
  private readonly materialIdx = new Uint8Array(MAX_DEBRIS);
  private rngState = 1;

  /** Simple deterministic PRNG for visual-only effects. */
  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  /**
   * Spawns debris for one break event.
   *
   * @param xWorld    Event footprint center X (world units).
   * @param yWorld    Event footprint center Y (world units).
   * @param material  Material-response preset selecting the color/physics profile.
   * @param isGrouped Whether this event covers a multi-cell (2x2) placement.
   * @param quality   Active graphics-quality tier — scales particle count.
   */
  notifyBreak(
    xWorld: number,
    yWorld: number,
    material: MaterialResponsePreset,
    isGrouped: boolean,
    quality: GraphicsQuality,
  ): void {
    const profile = getMaterialParticleProfile(material);
    const count = resolveBreakParticleCount(material, isGrouped, quality);

    for (let s = 0; s < count; s++) {
      const idx = this.count < MAX_DEBRIS ? this.count++ : this._recycleOldest();
      const angle = this.nextRandom() * Math.PI * 2;
      const speed = profile.speedMinWorld + this.nextRandom() * (profile.speedMaxWorld - profile.speedMinWorld);
      this.xWorld[idx] = xWorld + (this.nextRandom() - 0.5) * SPAWN_JITTER_HALF_WORLD * 2;
      this.yWorld[idx] = yWorld + (this.nextRandom() - 0.5) * SPAWN_JITTER_HALF_WORLD * 2;
      this.vxWorld[idx] = Math.cos(angle) * speed;
      this.vyWorld[idx] = Math.sin(angle) * speed;
      this.gravityWorld[idx] = profile.gravityWorldPerSec2;
      this.ageMs[idx] = 0;
      this.lifetimeMs[idx] = profile.lifetimeMs;
      this.colorIdx[idx] = (this.nextRandom() * profile.colors.length) | 0;
      this.materialIdx[idx] = material === 'stone' ? 0 : material === 'wood' ? 1 : 2;
    }
  }

  update(dtMs: number): void {
    const dt = dtMs / 1000.0;
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > this.lifetimeMs[i]) {
        this.count--;
        this.xWorld[i] = this.xWorld[this.count];
        this.yWorld[i] = this.yWorld[this.count];
        this.vxWorld[i] = this.vxWorld[this.count];
        this.vyWorld[i] = this.vyWorld[this.count];
        this.gravityWorld[i] = this.gravityWorld[this.count];
        this.ageMs[i] = this.ageMs[this.count];
        this.lifetimeMs[i] = this.lifetimeMs[this.count];
        this.colorIdx[i] = this.colorIdx[this.count];
        this.materialIdx[i] = this.materialIdx[this.count];
        continue;
      }
      this.vyWorld[i] += this.gravityWorld[i] * dt;
      this.xWorld[i] += this.vxWorld[i] * dt;
      this.yWorld[i] += this.vyWorld[i] * dt;
    }
  }

  /** Current live particle count — exposed for tests to assert bounded output. */
  get liveCount(): number {
    return this.count;
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
      const profile = this.materialIdx[i] === 0 ? STONE_PROFILE : this.materialIdx[i] === 1 ? WOOD_PROFILE : METAL_PROFILE;
      const alpha = 1.0 - this.ageMs[i] / this.lifetimeMs[i];
      ctx.globalAlpha = alpha;
      ctx.fillStyle = profile.colors[this.colorIdx[i]];
      const drawX = this.xWorld[i] * scalePx + offsetXPx;
      const drawY = this.yWorld[i] * scalePx + offsetYPx;
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
