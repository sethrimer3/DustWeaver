/**
 * playerDeathDust.ts — Render-only player-death disintegration effect.
 *
 * Triggers exactly once on the alive→dead transition: samples roughly 80
 * opaque pixels from the player's final displayed sprite silhouette and
 * blows them apart into a bounded pool of warm-gold, one-pixel motes with a
 * dominant leftward drift. Follows the deterministic typed-array/PRNG
 * pattern used by src/render/skidDebrisRenderer.ts and
 * src/render/dustContainerPickupEffect.ts.
 *
 * This module never touches WorldState, health, damage, or simulation
 * particles — it is purely cosmetic and is driven by an externally supplied
 * dtMs so it can keep animating using a real-time clock even while gameplay
 * simulation is frozen behind the death overlay.
 */

/** Number of motes spawned on player death. */
export const PLAYER_DEATH_DUST_MOTE_COUNT = 80;

/** Bounded pool size — comfortably covers the burst plus recycling headroom. */
export const MAX_PLAYER_DEATH_DUST_MOTES = 96;

/** Total lifetime of a single mote, in milliseconds. */
const MOTE_LIFETIME_MS = 1400;

/** Center direction of the outward blow, in radians (PI = straight left). */
const BLOW_DIRECTION_RAD = Math.PI;
/** Half-angle of the leftward spread cone (radians). */
const BLOW_SPREAD_RAD = Math.PI / 3;
/** Outward speed range (world units/s) imparted to each mote. */
const BLOW_SPEED_MIN_WORLD = 40.0;
const BLOW_SPEED_MAX_WORLD = 150.0;
/** Exponential drag coefficient applied to velocity (per second). */
const DRAG_PER_SEC = 0.6;
/** Gentle downward settle so the cloud doesn't hang perfectly flat. */
const GRAVITY_WORLD_PER_SEC2 = 12.0;
/** Small per-mote random turbulence acceleration (world units/s^2). */
const TURBULENCE_ACCEL_WORLD = 40.0;
/** Turbulence direction change rate (radians/sec) — keeps motion organic. */
const TURBULENCE_TURN_RATE_RAD_PER_SEC = 3.0;

/** Warm-gold mote fill color. */
const MOTE_COLOR = '#ffcf3f';

export interface SilhouetteOffsetPx {
  readonly xPx: number;
  readonly yPx: number;
}

/**
 * Pure, Node-testable scan of an opaque/transparent predicate over a
 * rectangular pixel grid. Returns every pixel coordinate considered opaque.
 * The DOM-facing caller supplies `isOpaque` from real sprite pixel data.
 */
export function findOpaqueOffsets(
  isOpaque: (xPx: number, yPx: number) => boolean,
  widthPx: number,
  heightPx: number,
): SilhouetteOffsetPx[] {
  const found: SilhouetteOffsetPx[] = [];
  for (let yPx = 0; yPx < heightPx; yPx++) {
    for (let xPx = 0; xPx < widthPx; xPx++) {
      if (isOpaque(xPx, yPx)) found.push({ xPx, yPx });
    }
  }
  return found;
}

/**
 * Deterministically samples `count` offsets from `offsets` using `rng`
 * (expected to return floats in [0, 1)). If `offsets` has fewer entries than
 * `count`, entries are reused (cycled) so the requested count is always met
 * as long as at least one opaque pixel exists.
 */
export function sampleOffsets(
  offsets: ReadonlyArray<SilhouetteOffsetPx>,
  count: number,
  rng: () => number,
): SilhouetteOffsetPx[] {
  if (offsets.length === 0) return [];
  const picked: SilhouetteOffsetPx[] = [];
  for (let n = 0; n < count; n++) {
    const idx = Math.floor(rng() * offsets.length) % offsets.length;
    picked.push(offsets[idx]);
  }
  return picked;
}

/** Simple deterministic LCG PRNG factory — no wall-clock randomness. */
export function makeDeterministicRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xFFFFFFFF;
  };
}

export interface SpriteToWorldOptions {
  /** World-space center the sprite is drawn around (cluster render position). */
  readonly centerXWorld: number;
  readonly centerYWorld: number;
  /** X offset (world units, from sprite left edge) used as the flip pivot. */
  readonly pivotXWorld: number;
  /** Half of the sprite's rendered height in world units. */
  readonly spriteHalfHeightWorld: number;
  /** Sprite's native pixel dimensions. */
  readonly spriteWidthPx: number;
  readonly spriteHeightPx: number;
  /** Sprite's rendered dimensions in world units (uniform scale assumed). */
  readonly spriteWidthWorld: number;
  readonly spriteHeightWorld: number;
  readonly isFacingLeft: boolean;
}

/**
 * Converts a sprite-local pixel offset into a world-space position, matching
 * the exact draw transform used by renderClusters (translate to
 * (screenX, spriteCenterY), optional ctx.scale(-1, 1) when facing left, then
 * drawImage(sprite, -pivotXWorld, -spriteHalfHeightWorld, ...)).
 */
export function spriteOffsetToWorld(
  offset: SilhouetteOffsetPx,
  opts: SpriteToWorldOptions,
): { xWorld: number; yWorld: number } {
  const worldPerPxX = opts.spriteWidthWorld / opts.spriteWidthPx;
  const worldPerPxY = opts.spriteHeightWorld / opts.spriteHeightPx;
  const localX = -opts.pivotXWorld + offset.xPx * worldPerPxX;
  const localY = -opts.spriteHalfHeightWorld + offset.yPx * worldPerPxY;
  const mirroredX = opts.isFacingLeft ? -localX : localX;
  return {
    xWorld: opts.centerXWorld + mirroredX,
    yWorld: opts.centerYWorld + localY,
  };
}

export class PlayerDeathDustEffect {
  private count = 0;
  private readonly xWorld = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private readonly yWorld = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private readonly vxWorld = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private readonly vyWorld = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private readonly turbAngleRad = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private readonly ageMs = new Float32Array(MAX_PLAYER_DEATH_DUST_MOTES);
  private hasTriggeredFlag = false;

  /**
   * Spawns the burst from a set of already-sampled sprite-local silhouette
   * offsets. Pure aside from internal pool mutation — no DOM/canvas access
   * happens here, keeping this method directly unit-testable. Safe to call
   * only once per death (see `hasTriggered`); callers should reset() first
   * if triggering again (e.g. a fresh life after respawn).
   */
  trigger(
    offsets: ReadonlyArray<SilhouetteOffsetPx>,
    opts: SpriteToWorldOptions,
    seed: number,
  ): void {
    this.count = 0;
    this.hasTriggeredFlag = true;
    const rng = makeDeterministicRng(seed);
    const picked = sampleOffsets(offsets, PLAYER_DEATH_DUST_MOTE_COUNT, rng);

    for (let m = 0; m < picked.length; m++) {
      if (this.count >= MAX_PLAYER_DEATH_DUST_MOTES) break;
      const i = this.count++;
      const { xWorld, yWorld } = spriteOffsetToWorld(picked[m], opts);
      const angleRad = BLOW_DIRECTION_RAD + (rng() - 0.5) * 2 * BLOW_SPREAD_RAD;
      const speed = BLOW_SPEED_MIN_WORLD + rng() * (BLOW_SPEED_MAX_WORLD - BLOW_SPEED_MIN_WORLD);
      this.xWorld[i] = xWorld;
      this.yWorld[i] = yWorld;
      this.vxWorld[i] = Math.cos(angleRad) * speed;
      this.vyWorld[i] = Math.sin(angleRad) * speed;
      this.turbAngleRad[i] = rng() * Math.PI * 2;
      this.ageMs[i] = 0;
    }
  }

  /** True once trigger() has been called since the last reset(). */
  get hasTriggered(): boolean {
    return this.hasTriggeredFlag;
  }

  /** Current live mote count — exposed for bounded-pool tests. */
  get moteCount(): number {
    return this.count;
  }

  /** Advances the pool using a real-time delta (safe to call while sim is frozen). */
  update(dtMs: number): void {
    if (this.count === 0) return;
    const dt = dtMs / 1000;
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] >= MOTE_LIFETIME_MS) {
        this.removeAt(i);
        continue;
      }
      // Organic turbulence: slowly rotating small acceleration.
      this.turbAngleRad[i] += TURBULENCE_TURN_RATE_RAD_PER_SEC * dt;
      this.vxWorld[i] += Math.cos(this.turbAngleRad[i]) * TURBULENCE_ACCEL_WORLD * dt;
      this.vyWorld[i] += Math.sin(this.turbAngleRad[i]) * TURBULENCE_ACCEL_WORLD * dt;
      this.vyWorld[i] += GRAVITY_WORLD_PER_SEC2 * dt;
      const dragFactor = Math.max(0, 1 - DRAG_PER_SEC * dt);
      this.vxWorld[i] *= dragFactor;
      this.vyWorld[i] *= dragFactor;
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
      const fadeInMs = 80;
      const fadeOutStartMs = MOTE_LIFETIME_MS - 400;
      let alpha = 1.0;
      if (this.ageMs[i] < fadeInMs) alpha = this.ageMs[i] / fadeInMs;
      else if (this.ageMs[i] > fadeOutStartMs) alpha = 1.0 - (this.ageMs[i] - fadeOutStartMs) / (MOTE_LIFETIME_MS - fadeOutStartMs);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = MOTE_COLOR;
      const x = Math.round(this.xWorld[i] * scalePx + offsetXPx);
      const y = Math.round(this.yWorld[i] * scalePx + offsetYPx);
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  /** Removes every live mote and clears trigger state — call on room load/activation, respawn, new run, and teardown. */
  reset(): void {
    this.count = 0;
    this.hasTriggeredFlag = false;
  }

  private removeAt(i: number): void {
    this.count--;
    this.xWorld[i] = this.xWorld[this.count];
    this.yWorld[i] = this.yWorld[this.count];
    this.vxWorld[i] = this.vxWorld[this.count];
    this.vyWorld[i] = this.vyWorld[this.count];
    this.turbAngleRad[i] = this.turbAngleRad[this.count];
    this.ageMs[i] = this.ageMs[this.count];
  }
}

/**
 * DOM-facing helper: samples the given sprite's opaque pixels via an
 * offscreen canvas and triggers the burst. Isolated from PlayerDeathDustEffect
 * itself so the effect's core logic stays Node-testable without a DOM/canvas
 * harness. Silently no-ops if the sprite has no natural size yet (not
 * decoded) or canvas access fails (e.g. tainted canvas) — non-fatal, since
 * this is a purely cosmetic effect.
 */
export function triggerPlayerDeathDustFromSprite(
  effect: PlayerDeathDustEffect,
  sprite: HTMLImageElement,
  centerXWorld: number,
  centerYWorld: number,
  isFacingLeft: boolean,
  spriteWidthWorld: number,
  spriteHeightWorld: number,
  pivotXWorld: number,
  seed: number,
): void {
  const widthPx = sprite.naturalWidth;
  const heightPx = sprite.naturalHeight;
  if (widthPx <= 0 || heightPx <= 0) return;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.drawImage(sprite, 0, 0);
    const data = ctx.getImageData(0, 0, widthPx, heightPx).data;
    const isOpaque = (xPx: number, yPx: number): boolean => data[(yPx * widthPx + xPx) * 4 + 3] > 0;
    const offsets = findOpaqueOffsets(isOpaque, widthPx, heightPx);
    if (offsets.length === 0) return;

    effect.trigger(offsets, {
      centerXWorld,
      centerYWorld,
      pivotXWorld,
      spriteHalfHeightWorld: spriteHeightWorld / 2,
      spriteWidthPx: widthPx,
      spriteHeightPx: heightPx,
      spriteWidthWorld,
      spriteHeightWorld,
      isFacingLeft,
    }, seed);
  } catch {
    // Non-fatal: skip the cosmetic effect if canvas access is unavailable.
  }
}
