/**
 * Cracked-block shatter particle renderer.
 *
 * Spawns a burst of small, sharp, rotating fragments when a cracked (crumble)
 * block is destroyed by a momentum-speed impact (see
 * `sim/crackedBlockShatter.ts` / `sim/clusters/movementAxisResolvers.ts`).
 * Purely visual — never touches WorldState or gameplay simulation.
 *
 * Colours are drawn from the destroyed block's actual sprite/theme palette
 * (see `crackedBlockPaletteCache.ts`) rather than a generic palette.
 *
 * @note Uses its own lightweight LCG PRNG, exactly like CrumbleDebrisRenderer.
 * This state is never serialized and never affects simulation logic, so
 * gameplay determinism is unaffected by this renderer's randomness.
 */

import { getGraphicsQuality } from '../ui/renderSettings';
import { getCrackedBlockShatterPalette, type RgbColor } from './crackedBlockPaletteCache';
import { indexToBlockTheme } from '../levels/blockTheme';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';

const MAX_PARTICLES = 220;

/** Per-quality base particle count for a 1x1-block footprint at threshold speed. */
const BASE_COUNT_BY_QUALITY: Record<'low' | 'med' | 'high', number> = {
  low: 7,
  med: 16,
  high: 30,
};
/** Fraction of BASE_COUNT allowed as "long-lived fragments" on high quality only. */
const LONG_LIVED_FRACTION_HIGH = 0.15;

const LIFETIME_MS_MIN = 260;
const LIFETIME_MS_MAX = 520;
const LONG_LIVED_LIFETIME_MS_MIN = 700;
const LONG_LIVED_LIFETIME_MS_MAX = 1100;

const SPEED_MIN_WORLD = 30;
const SPEED_MAX_WORLD = 170;
const GRAVITY_WORLD_PER_SEC2 = 260;
const ANGULAR_VEL_MAX_RAD_PER_SEC = 14;
const SIZE_MIN_PX = 1;
const SIZE_MAX_PX = 3;

/** Bounded diminishing-returns scaling caps so huge footprints/speeds can't blow the particle budget. */
const MAX_FOOTPRINT_SCALE = 1.8;
const MAX_SPEED_SCALE = 1.5;

/** Landing dust begins above the ordinary landing-sound threshold. */
const LANDING_MIN_SPEED_WORLD = 105;
const LANDING_FULL_SPEED_WORLD = 420;
const LANDING_BASE_COUNT_BY_QUALITY: Record<'low' | 'med' | 'high', number> = {
  low: 3,
  med: 6,
  high: 10,
};
const LANDING_SPEED_MIN_WORLD = 22;
const LANDING_SPEED_MAX_WORLD = 155;

export class CrackedBlockShatterRenderer {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_PARTICLES);
  private readonly yWorld = new Float32Array(MAX_PARTICLES);
  private readonly vxWorld = new Float32Array(MAX_PARTICLES);
  private readonly vyWorld = new Float32Array(MAX_PARTICLES);
  private readonly ageMs = new Float32Array(MAX_PARTICLES);
  private readonly lifetimeMs = new Float32Array(MAX_PARTICLES);
  private readonly rotationRad = new Float32Array(MAX_PARTICLES);
  private readonly angularVelRadPerSec = new Float32Array(MAX_PARTICLES);
  private readonly sizePx = new Float32Array(MAX_PARTICLES);
  private readonly colorR = new Uint8Array(MAX_PARTICLES);
  private readonly colorG = new Uint8Array(MAX_PARTICLES);
  private readonly colorB = new Uint8Array(MAX_PARTICLES);
  private rngState = 1;

  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  /**
   * Spawns a short, upward-biased spray from the block beneath a hard landing.
   * Count and launch speed both increase continuously with impact speed, while
   * colours come from the supporting block's rendered sprite palette.
   */
  notifyLanding(xWorld: number, groundYWorld: number, themeIndex: number, impactSpeedWorld: number): void {
    if (impactSpeedWorld < LANDING_MIN_SPEED_WORLD) return;

    const quality = getGraphicsQuality();
    const impactT = Math.min(1, Math.max(0,
      (impactSpeedWorld - LANDING_MIN_SPEED_WORLD) / (LANDING_FULL_SPEED_WORLD - LANDING_MIN_SPEED_WORLD),
    ));
    const spawnCount = Math.max(1, Math.round(LANDING_BASE_COUNT_BY_QUALITY[quality] * (0.45 + impactT * 1.55)));
    const launchSpeedMax = LANDING_SPEED_MIN_WORLD +
      (LANDING_SPEED_MAX_WORLD - LANDING_SPEED_MIN_WORLD) * (0.25 + impactT * 0.75);
    const palette = getCrackedBlockShatterPalette(indexToBlockTheme(themeIndex));

    for (let s = 0; s < spawnCount; s++) {
      const idx = this.count < MAX_PARTICLES ? this.count++ : this._recycleOldest();
      const side = this.nextRandom() < 0.5 ? -1 : 1;
      const horizontalSpread = 0.25 + this.nextRandom() * 0.75;
      const speed = LANDING_SPEED_MIN_WORLD + this.nextRandom() * (launchSpeedMax - LANDING_SPEED_MIN_WORLD);

      this.xWorld[idx] = xWorld + (this.nextRandom() - 0.5) * 8;
      this.yWorld[idx] = groundYWorld - this.nextRandom() * 1.5;
      this.vxWorld[idx] = side * speed * horizontalSpread;
      this.vyWorld[idx] = -speed * (0.35 + this.nextRandom() * 0.65);
      this.ageMs[idx] = 0;
      this.lifetimeMs[idx] = 220 + this.nextRandom() * 300;
      this.rotationRad[idx] = this.nextRandom() * Math.PI * 2;
      this.angularVelRadPerSec[idx] = (this.nextRandom() - 0.5) * 2 * ANGULAR_VEL_MAX_RAD_PER_SEC;
      this.sizePx[idx] = SIZE_MIN_PX + this.nextRandom() * (SIZE_MAX_PX - SIZE_MIN_PX);

      const color: RgbColor = palette[(this.nextRandom() * palette.length) | 0];
      this.colorR[idx] = color.r;
      this.colorG[idx] = color.g;
      this.colorB[idx] = color.b;
    }
  }

  /**
   * Spawns a shatter burst for one destroyed cracked-block footprint.
   *
   * @param xWorld/yWorld     Footprint center (world units).
   * @param wWorld/hWorld     Footprint size (world units) — burst is spread
   *                          across the whole footprint, not just the center.
   * @param impactXWorld/Y    Point of impact — extra energy/density here.
   * @param normalX/Y         Impacted surface normal; burst is biased away
   *                          from it while retaining wide scatter.
   * @param themeIndex        Wall theme index (see world.wallThemeIndex).
   * @param speedWorld        Player horizontal speed at impact (world units/sec).
   */
  notifyShatter(
    xWorld: number, yWorld: number, wWorld: number, hWorld: number,
    impactXWorld: number, impactYWorld: number,
    normalX: number, normalY: number,
    themeIndex: number, speedWorld: number,
  ): void {
    const quality = getGraphicsQuality();
    const baseCount = BASE_COUNT_BY_QUALITY[quality];

    // Bounded diminishing-returns scaling: footprint area and excess speed
    // each nudge the count up, but neither can multiply it beyond its cap,
    // and the two together can't exceed the product of both caps.
    const footprintArea = Math.max(wWorld * hWorld, 1);
    const footprintScale = Math.min(MAX_FOOTPRINT_SCALE, 1 + 0.25 * (Math.sqrt(footprintArea) / 24 - 1));
    const excessSpeedRatio = Math.max(0, speedWorld - MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED) / MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED;
    const speedScale = Math.min(MAX_SPEED_SCALE, 1 + 0.35 * Math.sqrt(excessSpeedRatio));

    const targetCount = Math.round(baseCount * Math.max(1, footprintScale) * speedScale);
    const spawnCount = Math.min(targetCount, MAX_PARTICLES);

    const themeId = indexToBlockTheme(themeIndex);
    const palette = getCrackedBlockShatterPalette(themeId);

    const halfW = wWorld * 0.5;
    const halfH = hWorld * 0.5;
    const longLivedCount = quality === 'high' ? Math.round(spawnCount * LONG_LIVED_FRACTION_HIGH) : 0;

    for (let s = 0; s < spawnCount; s++) {
      const idx = this.count < MAX_PARTICLES ? this.count++ : this._recycleOldest();

      // 55% of particles scatter across the whole footprint; 45% cluster near
      // the impact point for extra energy/density right where the hit landed.
      let px: number, py: number;
      if (this.nextRandom() < 0.45) {
        const jitter = Math.max(footprintArea > 0 ? Math.sqrt(footprintArea) * 0.25 : 4, 3);
        px = impactXWorld + (this.nextRandom() - 0.5) * jitter * 2;
        py = impactYWorld + (this.nextRandom() - 0.5) * jitter * 2;
      } else {
        px = xWorld + (this.nextRandom() - 0.5) * wWorld;
        py = yWorld + (this.nextRandom() - 0.5) * hWorld;
      }
      // Keep spawn points within (a small margin beyond) the footprint.
      px = Math.min(xWorld + halfW + 2, Math.max(xWorld - halfW - 2, px));
      py = Math.min(yWorld + halfH + 2, Math.max(yWorld - halfH - 2, py));

      // Bias the initial burst direction away from the impacted surface
      // (normalX/Y) while retaining wide scatter: pick a random angle, then
      // fold it into the outward hemisphere when it points into the surface.
      let angle = this.nextRandom() * Math.PI * 2;
      if (normalX !== 0 || normalY !== 0) {
        const dot = Math.cos(angle) * normalX + Math.sin(angle) * normalY;
        if (dot < 0) {
          // Reflect the velocity direction across the surface tangent so it
          // points outward instead, preserving scatter width.
          angle = Math.atan2(
            Math.sin(angle) - 2 * dot * normalY,
            Math.cos(angle) - 2 * dot * normalX,
          );
        }
      }

      const nearImpact = 1 - Math.min(1, Math.hypot(px - impactXWorld, py - impactYWorld) / (Math.max(wWorld, hWorld) + 1));
      const speed = SPEED_MIN_WORLD + this.nextRandom() * (SPEED_MAX_WORLD - SPEED_MIN_WORLD) * (0.6 + 0.6 * nearImpact);

      this.xWorld[idx] = px;
      this.yWorld[idx] = py;
      this.vxWorld[idx] = Math.cos(angle) * speed;
      this.vyWorld[idx] = Math.sin(angle) * speed;
      this.ageMs[idx] = 0;

      const isLongLived = s < longLivedCount;
      this.lifetimeMs[idx] = isLongLived
        ? LONG_LIVED_LIFETIME_MS_MIN + this.nextRandom() * (LONG_LIVED_LIFETIME_MS_MAX - LONG_LIVED_LIFETIME_MS_MIN)
        : LIFETIME_MS_MIN + this.nextRandom() * (LIFETIME_MS_MAX - LIFETIME_MS_MIN);

      this.rotationRad[idx] = this.nextRandom() * Math.PI * 2;
      this.angularVelRadPerSec[idx] = (this.nextRandom() - 0.5) * 2 * ANGULAR_VEL_MAX_RAD_PER_SEC;
      this.sizePx[idx] = SIZE_MIN_PX + this.nextRandom() * (SIZE_MAX_PX - SIZE_MIN_PX);

      const color: RgbColor = palette[(this.nextRandom() * palette.length) | 0];
      this.colorR[idx] = color.r;
      this.colorG[idx] = color.g;
      this.colorB[idx] = color.b;
    }
  }

  update(dtMs: number): void {
    if (this.count === 0) return;
    const dt = dtMs / 1000.0;
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > this.lifetimeMs[i]) {
        this.count--;
        this.xWorld[i] = this.xWorld[this.count];
        this.yWorld[i] = this.yWorld[this.count];
        this.vxWorld[i] = this.vxWorld[this.count];
        this.vyWorld[i] = this.vyWorld[this.count];
        this.ageMs[i] = this.ageMs[this.count];
        this.lifetimeMs[i] = this.lifetimeMs[this.count];
        this.rotationRad[i] = this.rotationRad[this.count];
        this.angularVelRadPerSec[i] = this.angularVelRadPerSec[this.count];
        this.sizePx[i] = this.sizePx[this.count];
        this.colorR[i] = this.colorR[this.count];
        this.colorG[i] = this.colorG[this.count];
        this.colorB[i] = this.colorB[this.count];
        continue;
      }
      this.vyWorld[i] += GRAVITY_WORLD_PER_SEC2 * dt;
      this.xWorld[i] += this.vxWorld[i] * dt;
      this.yWorld[i] += this.vyWorld[i] * dt;
      this.rotationRad[i] += this.angularVelRadPerSec[i] * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D, offsetXPx: number, offsetYPx: number, scalePx: number): void {
    if (this.count === 0) return;
    ctx.save();
    for (let i = 0; i < this.count; i++) {
      const lifeFrac = this.ageMs[i] / this.lifetimeMs[i];
      const alpha = 1.0 - lifeFrac;
      // Gradual shrink toward the end of life.
      const size = this.sizePx[i] * (1.0 - 0.5 * lifeFrac);
      if (alpha <= 0 || size <= 0) continue;

      const drawX = this.xWorld[i] * scalePx + offsetXPx;
      const drawY = this.yWorld[i] * scalePx + offsetYPx;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = `rgb(${this.colorR[i]}, ${this.colorG[i]}, ${this.colorB[i]})`;
      ctx.translate(drawX, drawY);
      ctx.rotate(this.rotationRad[i]);
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.rotate(-this.rotationRad[i]);
      ctx.translate(-drawX, -drawY);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  private _recycleOldest(): number {
    let oldestIdx = 0;
    let oldestFrac = this.ageMs[0] / this.lifetimeMs[0];
    for (let i = 1; i < this.count; i++) {
      const frac = this.ageMs[i] / this.lifetimeMs[i];
      if (frac > oldestFrac) {
        oldestFrac = frac;
        oldestIdx = i;
      }
    }
    return oldestIdx;
  }
}
