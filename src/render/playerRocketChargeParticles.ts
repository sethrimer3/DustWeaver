/**
 * playerRocketChargeParticles.ts — Charged trailing particles for the
 * Movement V2 rocket-boost state (see isRocketBoostedFlag on ClusterState).
 *
 * While rocket-boosted, glowing particles spawn at a random offset around the
 * player and are pulled toward the player's current position, travelling at
 * the player's own speed plus ROCKET_BOOST_PARTICLE_EXTRA_SPEED_WORLD_PER_SEC —
 * fast enough to always catch up, giving a comet-trail / "gravitated toward
 * the player" look. Cosmetic only — no sim state is touched.
 *
 * Randomness note: Math.random() is acceptable here — purely cosmetic
 * render-layer state with no gameplay impact (see DECISIONS.md §Randomness).
 */

import { ROCKET_BOOST_PARTICLE_EXTRA_SPEED_WORLD_PER_SEC } from '../sim/clusters/movementConstants';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Maximum number of charge particles alive at once. */
const CHARGE_PARTICLE_POOL_SIZE = 40;
/** Ticks between spawns while boosted (spawns ~10/sec at 60fps). */
const CHARGE_SPAWN_INTERVAL_TICKS = 6;
/** Random spawn offset radius range around the player (world units). */
const CHARGE_SPAWN_RADIUS_MIN_WORLD = 6;
const CHARGE_SPAWN_RADIUS_MAX_WORLD = 16;
/** Particle lifetime backstop in ticks, in case it never catches up. */
const CHARGE_PARTICLE_MAX_AGE_TICKS = 90;
/** Distance (world units) at which a particle is considered to have caught up and is recycled. */
const CHARGE_CATCH_UP_DIST_WORLD = 1.5;

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChargeParticle {
  xWorld: number;
  yWorld: number;
  ageTicks: number;
  radius: number;
  hue: number;
}

// ── Module-level pool ─────────────────────────────────────────────────────────

const _particles: ChargeParticle[] = [];
let _ticksSinceSpawn = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advances existing charge particles and spawns new ones while boosted.
 * Call once per render frame.
 */
export function tickPlayerRocketChargeParticles(
  playerXWorld: number,
  playerYWorld: number,
  playerVelXWorld: number,
  playerVelYWorld: number,
  isBoosted: boolean,
  dtSec: number,
): void {
  const playerSpeed = Math.hypot(playerVelXWorld, playerVelYWorld);
  const pullSpeed = playerSpeed + ROCKET_BOOST_PARTICLE_EXTRA_SPEED_WORLD_PER_SEC;

  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.ageTicks++;

    const dx = playerXWorld - p.xWorld;
    const dy = playerYWorld - p.yWorld;
    const dist = Math.hypot(dx, dy);

    if (dist <= CHARGE_CATCH_UP_DIST_WORLD || p.ageTicks >= CHARGE_PARTICLE_MAX_AGE_TICKS) {
      _particles[i] = _particles[_particles.length - 1];
      _particles.pop();
      continue;
    }

    p.xWorld += (dx / dist) * pullSpeed * dtSec;
    p.yWorld += (dy / dist) * pullSpeed * dtSec;
  }

  if (!isBoosted) return;

  _ticksSinceSpawn++;
  if (_ticksSinceSpawn < CHARGE_SPAWN_INTERVAL_TICKS) return;
  _ticksSinceSpawn = 0;

  if (_particles.length >= CHARGE_PARTICLE_POOL_SIZE) return;

  const angle = Math.random() * Math.PI * 2;
  const radius = CHARGE_SPAWN_RADIUS_MIN_WORLD
    + Math.random() * (CHARGE_SPAWN_RADIUS_MAX_WORLD - CHARGE_SPAWN_RADIUS_MIN_WORLD);

  _particles.push({
    xWorld: playerXWorld + Math.cos(angle) * radius,
    yWorld: playerYWorld + Math.sin(angle) * radius,
    ageTicks: 0,
    radius: 0.6 + Math.random() * 0.7,
    hue: 190 + Math.random() * 40, // cyan-blue charged glow
  });
}

/**
 * Renders all active charge particles.
 * Call after tickPlayerRocketChargeParticles each frame.
 */
export function drawPlayerRocketChargeParticles(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (let i = 0; i < _particles.length; i++) {
    const p = _particles[i];
    const life = 1 - p.ageTicks / CHARGE_PARTICLE_MAX_AGE_TICKS;
    if (life <= 0.02) continue;

    const px = p.xWorld * zoom + offsetXPx;
    const py = p.yWorld * zoom + offsetYPx;
    const r = p.radius * zoom;

    ctx.fillStyle = `hsla(${p.hue.toFixed(0)},90%,70%,${(life * 0.8).toFixed(2)})`;
    ctx.fillRect(px - r, py - r, r * 2, r * 2);

    ctx.fillStyle = `hsla(${p.hue.toFixed(0)},100%,90%,${(life * 0.5).toFixed(2)})`;
    ctx.fillRect(px - r * 0.4, py - r * 0.4, r * 0.8, r * 0.8);
  }
}
