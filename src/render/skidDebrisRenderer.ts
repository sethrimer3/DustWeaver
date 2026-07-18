/**
 * Skid debris renderer — spawns small 1×1 pixel particles from the player's
 * bottom-front corner while skidding.  Purely visual; does not affect sim.
 *
 * Two distinct skid effects feed this renderer (see world.ts):
 *   • Direction-reversal skid (Movement V2) — scaled from the *latched*
 *     entry velocity (world.playerSkidEntryVelocityXWorld), not the live,
 *     already-decelerating velocity, via the soft-knee curve below.
 *   • High-speed landing skid — scaled from world.playerLandingSkidSpeedFactor,
 *     unchanged from its prior behavior.
 */

import { WorldState } from '../sim/world';
import {
  GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC,
  SKID_VISUAL_SOFT_KNEE_WORLD_PER_SEC,
} from '../sim/clusters/movementConstants';

/** Exported for bounded-pool tests (see movementV2Skid.test.ts). */
export const MAX_DEBRIS = 200;
const DEBRIS_LIFETIME_MS = 400;
const SPAWN_RATE_PER_TICK = 3;
/** Spawn rate multiplier when the player is grapple-stuck and decelerating. */
const GRAPPLE_STUCK_SPAWN_MULTIPLIER = 3;
const DEBRIS_SPAWN_SPREAD_X_WORLD = 2;
const DEBRIS_SPAWN_SPREAD_Y_WORLD = 1;
const DEBRIS_VX_VARIANCE_WORLD = 30;
const DEBRIS_VY_MIN_WORLD = 15;
const DEBRIS_VY_RANGE_WORLD = 40;
const DEBRIS_GRAVITY_WORLD_PER_SEC2 = 200;

/** Debris particle color palette — earthy browns. */
const COLORS = ['#8b7355', '#a08060', '#6b5330', '#c4a57b'];

// ============================================================================
// Speed-scaled skid visual intensity (direction-reversal skid only)
// ============================================================================
// A normal-speed skid (walking-speed entry) keeps the original, readable
// baseline effect. Faster skid entries scale the effect up through a pure,
// testable soft-knee curve — approximately linear near walking speed, with
// smooth diminishing returns at extreme (grapple-launch-range) speeds. No
// hard clamp: see movement.md and skidJumpHeight.ts for the sibling
// height-solver approach to the same "speed-scaled technique" idea.

/**
 * extraSpeed = max(0, skidSpeed - walkingSpeed)
 * softenedExtra = softKnee * log1p(extraSpeed / softKnee)
 * effectiveVisualSpeed = walkingSpeed + softenedExtra
 *
 * Pure function — exported for direct unit testing of the curve shape
 * (linear-ish near walking speed, monotonic, diminishing slope at extremes).
 */
export function computeSkidVisualSpeedWorld(
  skidSpeedWorld: number,
  walkingSpeedWorld: number,
  softKneeWorld: number,
): number {
  const extraSpeed = Math.max(0, skidSpeedWorld - walkingSpeedWorld);
  const softenedExtra = softKneeWorld * Math.log1p(extraSpeed / softKneeWorld);
  return walkingSpeedWorld + softenedExtra;
}

/** Defensive upper bound on the visual-intensity ratio (practically unreachable — see computeSkidVisualSpeedWorld's slow log growth). */
const SKID_VISUAL_INTENSITY_MAX = 4.0;

/**
 * Bounded visual-intensity ratio (>= 1) derived from a skid-entry speed.
 * 1.0 exactly at walking speed (baseline, unscaled effect); grows slowly
 * and smoothly above that per the soft-knee curve.
 */
function computeSkidVisualIntensity(skidEntrySpeedWorld: number): number {
  const walkingSpeed = GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC;
  const visualSpeed = computeSkidVisualSpeedWorld(
    Math.abs(skidEntrySpeedWorld), walkingSpeed, SKID_VISUAL_SOFT_KNEE_WORLD_PER_SEC,
  );
  return Math.min(SKID_VISUAL_INTENSITY_MAX, visualSpeed / walkingSpeed);
}

// ── Bounded, named per-aspect scale factors driven by visual intensity ──────
// Each is `1 + (intensity - 1) * scale`, clamped to its own max multiplier,
// so no single derived value can grow unbounded even if the intensity ratio
// itself somehow grew large.

const DEBRIS_SPAWN_RATE_INTENSITY_SCALE = 1.6;
const DEBRIS_SPAWN_RATE_MAX_MULTIPLIER = 3.0;
const DEBRIS_VELOCITY_INTENSITY_SCALE = 1.5;
const DEBRIS_VELOCITY_MAX_MULTIPLIER = 3.0;
const DEBRIS_SPREAD_INTENSITY_SCALE = 0.5;
const DEBRIS_SPREAD_MAX_MULTIPLIER = 1.75;

/** Signed backward/trailing horizontal impulse (world units/s) at baseline (intensity = 1). */
const DEBRIS_TRAILING_VX_BASE_WORLD = 18;

function boundedMultiplier(intensity: number, scale: number, maxMultiplier: number): number {
  return Math.min(maxMultiplier, 1.0 + (intensity - 1.0) * scale);
}

export class SkidDebrisRenderer {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_DEBRIS);
  private readonly yWorld = new Float32Array(MAX_DEBRIS);
  private readonly vxWorld = new Float32Array(MAX_DEBRIS);
  private readonly vyWorld = new Float32Array(MAX_DEBRIS);
  private readonly ageMs = new Float32Array(MAX_DEBRIS);
  private readonly colorIdx = new Uint8Array(MAX_DEBRIS);
  private rngState = 1;

  /** Simple deterministic PRNG for visual-only effects. */
  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  update(world: WorldState, dtMs: number): void {
    const dt = dtMs / 1000.0;

    // Spawn new debris if skidding
    if (world.isPlayerSkiddingFlag === 1) {
      const isLandingSkid = world.playerLandingSkidSpeedFactor > 0;

      // Landing skid at high speed: scale spawn rate, spread, and velocity by
      // (1 + landingFactor), so faster landings kick up more and farther dust.
      // Direction-reversal skid: scale by the soft-knee visual-intensity
      // curve derived from the latched skid-entry speed, with a signed
      // trailing bias toward the player's original travel direction.
      const effectMultiplier = isLandingSkid
        ? 1.0 + world.playerLandingSkidSpeedFactor
        : boundedMultiplier(
            computeSkidVisualIntensity(world.playerSkidEntryVelocityXWorld),
            DEBRIS_VELOCITY_INTENSITY_SCALE,
            DEBRIS_VELOCITY_MAX_MULTIPLIER,
          );
      const spawnRateMultiplier = isLandingSkid
        ? effectMultiplier
        : boundedMultiplier(
            computeSkidVisualIntensity(world.playerSkidEntryVelocityXWorld),
            DEBRIS_SPAWN_RATE_INTENSITY_SCALE,
            DEBRIS_SPAWN_RATE_MAX_MULTIPLIER,
          );
      const spreadMultiplier = isLandingSkid
        ? effectMultiplier
        : boundedMultiplier(
            computeSkidVisualIntensity(world.playerSkidEntryVelocityXWorld),
            DEBRIS_SPREAD_INTENSITY_SCALE,
            DEBRIS_SPREAD_MAX_MULTIPLIER,
          );
      // Signed trailing bias: reversal-skid debris sprays predominantly
      // toward the player's original (pre-reversal) travel direction, with
      // random variance layered on top — not purely directionless X noise.
      const trailingVx = isLandingSkid
        ? 0
        : Math.sign(world.playerSkidEntryVelocityXWorld || 1)
          * DEBRIS_TRAILING_VX_BASE_WORLD
          * effectMultiplier;

      // Grapple-stuck skid uses its own multiplier (applied on top of effectMultiplier).
      const baseRate = world.isGrappleStuckFlag === 1
        ? SPAWN_RATE_PER_TICK * GRAPPLE_STUCK_SPAWN_MULTIPLIER
        : SPAWN_RATE_PER_TICK;
      const rate = Math.ceil(baseRate * spawnRateMultiplier);

      const spreadX = DEBRIS_SPAWN_SPREAD_X_WORLD * spreadMultiplier;
      const spreadY = DEBRIS_SPAWN_SPREAD_Y_WORLD * spreadMultiplier;
      const vxVar   = DEBRIS_VX_VARIANCE_WORLD * effectMultiplier;
      const vyMin   = DEBRIS_VY_MIN_WORLD;
      const vyRange = DEBRIS_VY_RANGE_WORLD * effectMultiplier;

      for (let s = 0; s < rate; s++) {
        if (this.count >= MAX_DEBRIS) {
          // Recycle oldest
          this.recycleOldest();
        }
        const i = this.count;
        this.xWorld[i] = world.skidDebrisXWorld + (this.nextRandom() - 0.5) * spreadX;
        this.yWorld[i] = world.skidDebrisYWorld - this.nextRandom() * spreadY;
        // Debris flies upward and slightly outward, trailing behind the
        // original travel direction for a reversal skid.
        this.vxWorld[i] = trailingVx + (this.nextRandom() - 0.5) * vxVar;
        this.vyWorld[i] = -(this.nextRandom() * vyRange + vyMin);
        this.ageMs[i] = 0;
        this.colorIdx[i] = (this.nextRandom() * COLORS.length) | 0;
        this.count++;
      }
    }

    // Update existing particles
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] > DEBRIS_LIFETIME_MS) {
        // Remove by swapping with last
        this.count--;
        this.xWorld[i] = this.xWorld[this.count];
        this.yWorld[i] = this.yWorld[this.count];
        this.vxWorld[i] = this.vxWorld[this.count];
        this.vyWorld[i] = this.vyWorld[this.count];
        this.ageMs[i] = this.ageMs[this.count];
        this.colorIdx[i] = this.colorIdx[this.count];
        continue;
      }
      // Apply gravity and integrate
      this.vyWorld[i] += DEBRIS_GRAVITY_WORLD_PER_SEC2 * dt;
      this.xWorld[i] += this.vxWorld[i] * dt;
      this.yWorld[i] += this.vyWorld[i] * dt;
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
    for (let i = 0; i < this.count; i++) {
      const alpha = 1.0 - this.ageMs[i] / DEBRIS_LIFETIME_MS;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS[this.colorIdx[i]];
      const drawX = this.xWorld[i] * scalePx + offsetXPx;
      const drawY = this.yWorld[i] * scalePx + offsetYPx;
      ctx.fillRect(drawX, drawY, 1, 1);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  /** Current live particle count — exposed for deterministic bounded-pool tests. */
  get debrisCount(): number {
    return this.count;
  }

  /**
   * Deterministic summary checksum of all live particle state — exposed
   * purely for test comparisons (two identically-driven renderer instances
   * should always produce the same checksum, since the internal PRNG is
   * seeded identically and the update sequence is deterministic).
   */
  debugStateChecksum(): number {
    let sum = 0;
    for (let i = 0; i < this.count; i++) {
      sum += this.xWorld[i] + this.yWorld[i] * 3 + this.vxWorld[i] * 7 + this.vyWorld[i] * 11 + this.ageMs[i] * 13;
    }
    return sum;
  }

  private recycleOldest(): void {
    // Find oldest particle and remove it
    let oldestIdx = 0;
    let oldestAge = this.ageMs[0];
    for (let i = 1; i < this.count; i++) {
      if (this.ageMs[i] > oldestAge) {
        oldestAge = this.ageMs[i];
        oldestIdx = i;
      }
    }
    this.count--;
    this.xWorld[oldestIdx] = this.xWorld[this.count];
    this.yWorld[oldestIdx] = this.yWorld[this.count];
    this.vxWorld[oldestIdx] = this.vxWorld[this.count];
    this.vyWorld[oldestIdx] = this.vyWorld[this.count];
    this.ageMs[oldestIdx] = this.ageMs[this.count];
    this.colorIdx[oldestIdx] = this.colorIdx[this.count];
  }
}
