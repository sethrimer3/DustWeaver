/**
 * playerWaterSkipSpray.ts — Cosmetic droplet burst for the water-skip bounce.
 *
 * When the player skips off a water surface (shallow, fast impact — see
 * computeWaterSkipBounce), a burst of droplets sprays out behind them,
 * opposite their direction of travel, and arcs under gravity. Cosmetic
 * only — no sim state is touched.
 *
 * Randomness note: Math.random() is acceptable here — purely cosmetic
 * render-layer state with no gameplay impact (see docs/decisions/DECISIONS.md §Randomness).
 */

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Number of droplets spawned per skip event. */
const SKIP_SPRAY_PARTICLE_COUNT = 16;
/** Maximum number of skip droplets in the pool at once. */
const SKIP_SPRAY_POOL_SIZE = 64;
/** Downward acceleration applied to droplets (world units/s²). */
const SKIP_SPRAY_GRAVITY_WORLD_PER_SEC2 = 480;
/** Base droplet lifetime in ticks. */
const SKIP_SPRAY_MAX_AGE_TICKS = 34;
/** Droplet speed range as a fraction of the player's incoming entry speed. */
const SKIP_SPRAY_SPEED_MIN_FRACTION = 0.35;
const SKIP_SPRAY_SPEED_MAX_FRACTION = 0.85;
/** Angular spread (radians) of the spray cone around the reverse-travel direction. */
const SKIP_SPRAY_SPREAD_RAD = (40 * Math.PI) / 180;

// ── Types ─────────────────────────────────────────────────────────────────────

interface SkipDroplet {
  xWorld: number;
  yWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  ageTicks: number;
  maxAgeTicks: number;
  radius: number;
}

// ── Module-level pool ─────────────────────────────────────────────────────────

const _droplets: SkipDroplet[] = [];
let _lastSeenEventSequence = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advances all skip droplets one tick and spawns a new burst when the skip
 * event sequence advances. Call once per render frame.
 *
 * @param eventSequence  world.playerWaterSkipEventSequence.
 * @param eventXWorld    world.playerWaterSkipEventXWorld.
 * @param eventYWorld    world.playerWaterSkipEventYWorld.
 * @param entryVelXWorld Incoming horizontal velocity at the moment of the skip.
 * @param entryVelYWorld Incoming vertical velocity at the moment of the skip.
 * @param dtSec          Fixed tick duration in seconds.
 */
export function tickPlayerWaterSkipSpray(
  eventSequence: number,
  eventXWorld: number,
  eventYWorld: number,
  entryVelXWorld: number,
  entryVelYWorld: number,
  dtSec: number,
): void {
  // ── Advance existing droplets ─────────────────────────────────────────────
  for (let i = _droplets.length - 1; i >= 0; i--) {
    const d = _droplets[i];
    d.ageTicks++;
    d.velocityYWorld += SKIP_SPRAY_GRAVITY_WORLD_PER_SEC2 * dtSec;
    d.xWorld += d.velocityXWorld * dtSec;
    d.yWorld += d.velocityYWorld * dtSec;

    if (d.ageTicks >= d.maxAgeTicks) {
      _droplets[i] = _droplets[_droplets.length - 1];
      _droplets.pop();
    }
  }

  // ── Spawn a new burst when a fresh skip event arrives ─────────────────────
  if (eventSequence === _lastSeenEventSequence) return;
  _lastSeenEventSequence = eventSequence;

  const entrySpeed = Math.hypot(entryVelXWorld, entryVelYWorld);
  if (entrySpeed < 1) return;

  // Spray behind the player: opposite their incoming direction of travel.
  const baseAngleRad = Math.atan2(-entryVelYWorld, -entryVelXWorld);

  for (let n = 0; n < SKIP_SPRAY_PARTICLE_COUNT; n++) {
    if (_droplets.length >= SKIP_SPRAY_POOL_SIZE) break;

    const angle = baseAngleRad + (Math.random() - 0.5) * SKIP_SPRAY_SPREAD_RAD;
    const speedFrac = SKIP_SPRAY_SPEED_MIN_FRACTION
      + Math.random() * (SKIP_SPRAY_SPEED_MAX_FRACTION - SKIP_SPRAY_SPEED_MIN_FRACTION);
    const dropletSpeed = entrySpeed * speedFrac;

    _droplets.push({
      xWorld: eventXWorld,
      yWorld: eventYWorld,
      velocityXWorld: Math.cos(angle) * dropletSpeed,
      velocityYWorld: Math.sin(angle) * dropletSpeed,
      ageTicks: 0,
      maxAgeTicks: Math.floor(SKIP_SPRAY_MAX_AGE_TICKS * (0.6 + Math.random() * 0.5)),
      radius: 0.5 + Math.random() * 0.6,
    });
  }
}

/**
 * Renders all active skip droplets.
 * Call after tickPlayerWaterSkipSpray each frame.
 */
export function drawPlayerWaterSkipSpray(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (let i = 0; i < _droplets.length; i++) {
    const d = _droplets[i];
    const life = 1 - d.ageTicks / d.maxAgeTicks;
    if (life <= 0.02) continue;

    const px = d.xWorld * zoom + offsetXPx;
    const py = d.yWorld * zoom + offsetYPx;
    const r = d.radius * (0.5 + life * 0.7) * zoom;

    ctx.fillStyle = `rgba(200,235,255,${(life * 0.75).toFixed(2)})`;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);

    ctx.fillStyle = `rgba(235,250,255,${(life * 0.45).toFixed(2)})`;
    ctx.fillRect(px - r * 0.35, py - r * 0.7, r * 0.4, r * 0.4);
  }
}
