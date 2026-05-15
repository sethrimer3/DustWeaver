/**
 * Weak Wall Jump Debris Renderer.
 *
 * Spawns ~15 heavy debris chips from the wall surface when the player performs
 * their 3rd+ consecutive wall jump (world.weakWallJumpCascadeFlag = 1).  The
 * particles look like heavy crumbling grit — earthy tones, fast gravity, short
 * lifetime — to communicate that the wall surface is slippery/weakened.
 *
 * Particles perform a simplified wall-bounce collision pass each tick so they
 * interact with solid geometry rather than flying straight through blocks.
 *
 * @note This renderer is purely visual.  It reads sim flags from WorldState but
 * never writes to it.  Its own LCG PRNG (rngState) is never serialized and never
 * influences deterministic simulation logic.
 */

import type { WorldState } from '../sim/world';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Number of particles spawned on each eligible (3rd+) wall jump. */
const CASCADE_SPAWN_COUNT = 15;

/** Maximum simultaneous debris particles tracked by this renderer. */
const MAX_CASCADE_DEBRIS = 120;

/** Minimum particle lifetime (ms). */
const LIFETIME_MIN_MS = 250;
/** Maximum particle lifetime (ms) — randomized per particle. */
const LIFETIME_RANGE_MS = 350;

/** Gravity applied to debris (world units / s²). Tuned heavy for gritty feel. */
const DEBRIS_GRAVITY_WORLD_PER_SEC2 = 350.0;

/**
 * Initial burst speed away from the wall surface (world units / s).
 * Particles burst outward (away from the wall), then arc downward.
 */
const BURST_SPEED_MIN_WORLD = 25.0;
const BURST_SPEED_RANGE_WORLD = 55.0;

/**
 * Initial vertical spread of spawn positions along the wall surface
 * (world units) — particles originate from a vertical band at the contact edge.
 */
const SPAWN_SPREAD_Y_WORLD = 8.0;

/** Horizontal jitter of the spawn position (world units). */
const SPAWN_JITTER_X_WORLD = 2.0;

/** Vertical velocity variance applied on top of the burst direction (world units/s). */
const BURST_VERTICAL_VARIANCE_WORLD = 30.0;

/** Restitution factor applied to velocity on a wall bounce (0 = no bounce). */
const WALL_RESTITUTION = 0.25;

/** Friction factor applied to the non-bounce axis velocity on a wall impact. */
const WALL_FRICTION = 0.55;

/**
 * Minimum impact speed (world units / s) required for a debris particle to
 * potentially play a soft thud sound.  Filters out very slow grazing contacts.
 */
const MIN_DEBRIS_THUD_SPEED_WORLD = 30.0;

/**
 * Maximum number of debris-thud sounds that may play within a single rate-limit
 * window.
 */
const THUD_RATE_LIMIT_COUNT = 4;

/**
 * Size of the thud rate-limit window in ticks.
 * At 60 fps, 9 ticks ≈ 150 ms — keeps audio non-spammy while feeling organic.
 */
const THUD_RATE_LIMIT_WINDOW_TICKS = 9;

/** Earthy, gritty color palette for wall debris chips. */
const COLORS = ['#8b7355', '#7a6448', '#6b5330', '#9a8465', '#c4a57b'];

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Signature for the audio callback injected via setThudCallback(). */
type DebrisThudCallback = (opts: {
  volumeLinear: number;
  pitchFactor: number;
  durationMs: number;
}) => void;

/** Monotonically increasing instance counter used to seed PRNG so that each
 * renderer instance produces a different visual pattern without using wall-clock
 * time anywhere in the rendering or update path.
 */
let _instanceCounter = 0;

// ── Main renderer class ───────────────────────────────────────────────────────

export class WeakWallJumpDebrisRenderer {
  private count = 0;

  // Struct-of-arrays particle state — pre-allocated, no per-frame allocation.
  private readonly xWorld     = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly yWorld     = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly vxWorld    = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly vyWorld    = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly ageMs      = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly lifetimeMs = new Float32Array(MAX_CASCADE_DEBRIS);
  private readonly colorIdx   = new Uint8Array(MAX_CASCADE_DEBRIS);
  /** 1 if this particle is still eligible to play one impact sound. */
  private readonly canPlaySoundFlag = new Uint8Array(MAX_CASCADE_DEBRIS);

  // PRNG state for purely visual randomness.
  // Seeded from a module-level instance counter so different instances produce
  // different patterns without using wall-clock time anywhere in the update path.
  private rngState: number;

  /**
   * Optional audio callback for debris thud sounds.  Injected via
   * setThudCallback() so this renderer has no compile-time dependency on
   * the audio system.  Guarded with try/catch so audio failures never crash
   * gameplay.
   */
  private _thudCallback: DebrisThudCallback | null = null;

  /**
   * Wire a thud-sound callback.  Call once at startup (e.g., in gameScreen.ts)
   * after the SFX manager is created.  Pass `null` to remove the callback.
   */
  setThudCallback(cb: DebrisThudCallback | null): void {
    this._thudCallback = cb;
  }

  // Rate limiter for debris thud sounds — tracked in simulation ticks so
  // timing remains consistent regardless of frame rate.
  private thudCountInWindow = 0;
  private thudWindowStartTick = -1;

  constructor() {
    _instanceCounter++;
    // Mix counter with a constant so seed(1) and seed(2) aren't trivially similar.
    this.rngState = (_instanceCounter * 1664525 + 1013904223) >>> 0 || 1;
  }

  /** Simple LCG PRNG — never affects simulation determinism. */
  private nextRandom(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  /**
   * Update all live particles and spawn new ones if the world signals a cascade
   * this tick.  Must be called every simulation tick (after tick()) with the
   * fixed simulation dt.
   *
   * @param world   Current world state — read-only for visual signals and tick counter.
   * @param dtMs    Fixed simulation timestep in milliseconds.
   */
  update(world: WorldState, dtMs: number): void {
    const dt = dtMs / 1000.0;

    // ── Spawn cascade if triggered ────────────────────────────────────────
    if (world.weakWallJumpCascadeFlag === 1) {
      this._spawnCascade(
        world.weakWallJumpCascadeXWorld,
        world.weakWallJumpCascadeYWorld,
        world.weakWallJumpCascadeWallSideX,
      );
    }

    // ── Update existing particles ─────────────────────────────────────────
    for (let i = this.count - 1; i >= 0; i--) {
      this.ageMs[i] += dtMs;
      if (this.ageMs[i] >= this.lifetimeMs[i]) {
        // Expire — swap with last active slot (fast removal without copy).
        this._removeAt(i);
        continue;
      }

      // Gravity
      this.vyWorld[i] += DEBRIS_GRAVITY_WORLD_PER_SEC2 * dt;

      // Integrate
      const newX = this.xWorld[i] + this.vxWorld[i] * dt;
      const newY = this.yWorld[i] + this.vyWorld[i] * dt;

      // ── Simplified wall collision ─────────────────────────────────────
      // Check whether the particle overlaps any solid wall AABB.  We treat the
      // particle as a point for the overlap test; resolution pushes it to the
      // nearest face and reflects the appropriate velocity component.
      //
      // Ramp orientations (0/1 = floor ramps, 2/3 = ceiling ramps):
      //   0: rises going right (/), surfaceY = wallBottom − t×wallHeight
      //   1: rises going left  (\), surfaceY = wallTop   + t×wallHeight
      //   2/3: ceiling ramps — debris falling down rarely reaches these; skip.
      let resolvedX = newX;
      let resolvedY = newY;
      let hitAWall = false;

      for (let wi = 0; wi < world.wallCount; wi++) {
        if (world.wallIsPlatformFlag[wi] === 1) continue; // pass through one-ways

        const wl = world.wallXWorld[wi];
        const wt = world.wallYWorld[wi];
        const ww2 = world.wallWWorld[wi];
        const wh2 = world.wallHWorld[wi];
        const wr = wl + ww2;
        const wb = wt + wh2;

        const ori = world.wallRampOrientationIndex[wi];

        if (ori !== 255) {
          // ── Ramp wall ───────────────────────────────────────────────────
          // Only handle floor ramps (ori 0 and 1); ceiling ramps are skipped.
          if (ori === 2 || ori === 3) continue;

          // Skip if particle is clearly outside the ramp's AABB.
          if (resolvedX <= wl || resolvedX >= wr || resolvedY <= wt || resolvedY >= wb) continue;

          // Sample ramp surface height at the particle's X position.
          // t = 0 at left edge, 1 at right edge.
          const t2 = ww2 > 0 ? (resolvedX - wl) / ww2 : 0;
          // ori 0: surface rises going right; ori 1: surface falls going right.
          const surfaceY = (ori === 0)
            ? wb - t2 * wh2   // wallBottom − t×wallHeight
            : wt + t2 * wh2;  // wallTop    + t×wallHeight

          if (resolvedY >= surfaceY) {
            // Particle penetrated the ramp floor surface — push it above.
            resolvedY = surfaceY;
            // Bounce vertical component; apply friction to horizontal.
            this.vyWorld[i] *= -WALL_RESTITUTION;
            this.vxWorld[i] *= WALL_FRICTION;
            hitAWall = true;
          }
        } else {
          // ── Solid rectangular wall ──────────────────────────────────────
          if (resolvedX > wl && resolvedX < wr && resolvedY > wt && resolvedY < wb) {
            // Particle is inside wall — resolve by the smallest penetration axis.
            const overlapL = resolvedX - wl;
            const overlapR = wr - resolvedX;
            const overlapT = resolvedY - wt;
            const overlapB = wb - resolvedY;
            const minX = overlapL < overlapR ? overlapL : overlapR;
            const minY = overlapT < overlapB ? overlapT : overlapB;

            if (minX < minY) {
              // Push out horizontally
              if (overlapL < overlapR) {
                resolvedX = wl;
              } else {
                resolvedX = wr;
              }
              // Bounce X, friction Y
              this.vxWorld[i] *= -WALL_RESTITUTION;
              this.vyWorld[i] *= WALL_FRICTION;
            } else {
              // Push out vertically
              if (overlapT < overlapB) {
                resolvedY = wt;
              } else {
                resolvedY = wb;
              }
              // Bounce Y, friction X
              this.vyWorld[i] *= -WALL_RESTITUTION;
              this.vxWorld[i] *= WALL_FRICTION;
            }

            hitAWall = true;
            break; // one-collision-per-tick is sufficient for small debris
          }
        }
      }

      this.xWorld[i] = resolvedX;
      this.yWorld[i] = resolvedY;

      // ── Rate-limited debris thud sound ────────────────────────────────
      if (
        hitAWall &&
        this.canPlaySoundFlag[i] === 1
      ) {
        const impactSpeed = Math.sqrt(
          this.vxWorld[i] * this.vxWorld[i] + this.vyWorld[i] * this.vyWorld[i],
        );
        if (impactSpeed > MIN_DEBRIS_THUD_SPEED_WORLD) {
          // Reset rate-limit window if it has expired (tick-based).
          const currentTick = world.tick;
          if (currentTick - this.thudWindowStartTick >= THUD_RATE_LIMIT_WINDOW_TICKS) {
            this.thudCountInWindow = 0;
            this.thudWindowStartTick = currentTick;
          }
          if (this.thudCountInWindow < THUD_RATE_LIMIT_COUNT) {
            this.thudCountInWindow++;
            if (this._thudCallback !== null) {
              try {
                this._thudCallback({
                  volumeLinear: 0.025 + this.nextRandom() * 0.045,
                  pitchFactor:  0.85  + this.nextRandom() * 0.35,
                  durationMs:   25    + this.nextRandom() * 30,
                });
              } catch {
                // Guard: audio errors must never crash gameplay.
              }
            }
          }
        }
        // Each particle can trigger at most one sound impact per lifetime.
        this.canPlaySoundFlag[i] = 0;
      }
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
      const progress = this.ageMs[i] / this.lifetimeMs[i];
      ctx.globalAlpha = 1.0 - progress;
      ctx.fillStyle = COLORS[this.colorIdx[i]];
      const drawX = this.xWorld[i] * scalePx + offsetXPx;
      const drawY = this.yWorld[i] * scalePx + offsetYPx;
      // 2×2 crisp pixel squares — readable at low zoom, consistent with skid debris.
      ctx.fillRect(drawX - 1, drawY - 1, 2, 2);
    }
    ctx.globalAlpha = 1.0;
    ctx.restore();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _spawnCascade(
    originXWorld: number,
    originYWorld: number,
    wallSideX: number, // +1 = right wall, –1 = left wall
  ): void {
    // Outward burst direction: away from the wall into the room interior.
    const burstDirX = -wallSideX; // opposite the wall side = toward interior

    for (let s = 0; s < CASCADE_SPAWN_COUNT; s++) {
      const idx = this.count < MAX_CASCADE_DEBRIS ? this.count++ : this._recycleOldest();

      // Spawn position: small jitter along the wall contact edge.
      this.xWorld[idx] = originXWorld
        + (this.nextRandom() - 0.5) * SPAWN_JITTER_X_WORLD;
      this.yWorld[idx] = originYWorld
        + (this.nextRandom() - 0.5) * SPAWN_SPREAD_Y_WORLD;

      // Initial velocity: burst outward from wall surface + vertical spread.
      const burstSpeed = BURST_SPEED_MIN_WORLD
        + this.nextRandom() * BURST_SPEED_RANGE_WORLD;
      this.vxWorld[idx] = burstDirX * burstSpeed;
      this.vyWorld[idx] = (this.nextRandom() - 0.5) * BURST_VERTICAL_VARIANCE_WORLD;

      this.ageMs[idx]       = 0;
      this.lifetimeMs[idx]  = LIFETIME_MIN_MS + this.nextRandom() * LIFETIME_RANGE_MS;
      this.colorIdx[idx]    = (this.nextRandom() * COLORS.length) | 0;
      // ~40 % chance of being sound-eligible so not every particle thuds.
      this.canPlaySoundFlag[idx] = this.nextRandom() < 0.4 ? 1 : 0;
    }
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

  private _removeAt(i: number): void {
    this.count--;
    this.xWorld[i]          = this.xWorld[this.count];
    this.yWorld[i]          = this.yWorld[this.count];
    this.vxWorld[i]         = this.vxWorld[this.count];
    this.vyWorld[i]         = this.vyWorld[this.count];
    this.ageMs[i]           = this.ageMs[this.count];
    this.lifetimeMs[i]      = this.lifetimeMs[this.count];
    this.colorIdx[i]        = this.colorIdx[this.count];
    this.canPlaySoundFlag[i] = this.canPlaySoundFlag[this.count];
  }
}
