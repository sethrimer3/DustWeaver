/**
 * Radiant Tether — AI state machine and per-tick behavior.
 *
 * States:
 *   0 = inactive       — dormant, awaiting player proximity
 *   1 = telegraph      — laser lines rotate around the boss
 *   2 = lock           — lasers stop rotating for player reaction window
 *   3 = firing         — chains shoot to anchors
 *   4 = movement       — boss moves via chain winching
 *   5 = reset          — old chains retract, prepare next cycle
 *   6 = dead
 *
 * Called from tick.ts after applyRockElementalAI (step 0.5d).
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import {
  RT_TELEGRAPH_DURATION_TICKS,
  RT_LOCK_DURATION_TICKS,
  RT_FIRE_DURATION_TICKS,
  RT_MOVEMENT_DURATION_TICKS,
  RT_RESET_DURATION_TICKS,
  RT_TELEGRAPH_ROTATION_SPEED_RAD,
  RT_CHAIN_COUNT_THRESHOLDS,
  RT_CHAIN_COUNT_MIN,
  RT_CHAIN_COUNT_MAX,
} from './radiantTetherConfig';
import {
  RadiantTetherChainState,
  createRadiantTetherChainState,
  fireChains,
  assignReelDirections,
  tickChains,
  detectAndSnapChains,
  tickBrokenChains,
  retractAllChains,
  checkChainPlayerCollision,
  getChainCountForHealth,
} from './radiantTetherChains';

// ── State enum ──────────────────────────────────────────────────────────────

export const RT_STATE_INACTIVE  = 0;
export const RT_STATE_TELEGRAPH = 1;
export const RT_STATE_LOCK      = 2;
export const RT_STATE_FIRING    = 3;
export const RT_STATE_MOVEMENT  = 4;
export const RT_STATE_RESET     = 5;
export const RT_STATE_DEAD      = 6;

/** Distance at which the boss activates (world units). */
const RT_ACTIVATION_RANGE_WORLD = 250.0;

// ── Module-level chain state (one boss per room) ────────────────────────────

let _chainState: RadiantTetherChainState | null = null;

/** Returns the current chain state (for rendering). */
export function getRadiantTetherChainState(): RadiantTetherChainState | null {
  return _chainState;
}

/** Resets chain state when loading a new room. */
export function resetRadiantTetherState(): void {
  _chainState = null;
}

// ── Main AI update ──────────────────────────────────────────────────────────

export function applyRadiantTetherAI(world: WorldState): void {
  // Find player
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.radiantTetherState === undefined) continue;
    if (cluster.isRadiantTetherFlag !== 1) continue;
    if (cluster.isAliveFlag === 0) {
      cluster.radiantTetherState = RT_STATE_DEAD;
      retractAllChains(ensureChainState());
      continue;
    }

    const cs = ensureChainState();
    const state = cluster.radiantTetherState;
    cluster.radiantTetherStateTicks += 1;

    // Distance to player
    const dxToPlayer = playerFound ? playerX - cluster.positionXWorld : 0;
    const dyToPlayer = playerFound ? playerY - cluster.positionYWorld : 0;
    const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);

    // Chain count based on current health
    const chainCount = getChainCountForHealth(
      cluster.healthPoints,
      cluster.maxHealthPoints,
      RT_CHAIN_COUNT_THRESHOLDS,
      RT_CHAIN_COUNT_MIN,
      RT_CHAIN_COUNT_MAX,
    );

    switch (state) {
      // ── INACTIVE ────────────────────────────────────────────────────────
      case RT_STATE_INACTIVE:
        if (playerFound && distToPlayer <= RT_ACTIVATION_RANGE_WORLD) {
          cluster.radiantTetherState = RT_STATE_TELEGRAPH;
          cluster.radiantTetherStateTicks = 0;
          // Pick initial base angle pointing toward player
          cluster.radiantTetherBaseAngleRad = Math.atan2(dyToPlayer, dxToPlayer);
        }
        break;

      // ── TELEGRAPH — rotating laser previews ─────────────────────────────
      case RT_STATE_TELEGRAPH:
        // Rotate base angle
        cluster.radiantTetherBaseAngleRad += RT_TELEGRAPH_ROTATION_SPEED_RAD;
        if (cluster.radiantTetherBaseAngleRad > Math.PI * 2) {
          cluster.radiantTetherBaseAngleRad -= Math.PI * 2;
        }
        cluster.radiantTetherChainCount = chainCount;

        if (cluster.radiantTetherStateTicks >= RT_TELEGRAPH_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_LOCK;
          cluster.radiantTetherStateTicks = 0;
        }
        break;

      // ── LOCK — lasers fixed for reaction window ─────────────────────────
      case RT_STATE_LOCK:
        // Base angle stays fixed (no rotation)
        if (cluster.radiantTetherStateTicks >= RT_LOCK_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_FIRING;
          cluster.radiantTetherStateTicks = 0;
          // Fire chains!
          fireChains(
            world, cs,
            cluster.positionXWorld, cluster.positionYWorld,
            cluster.radiantTetherBaseAngleRad,
            chainCount,
            world.rng,
          );
        }
        break;

      // ── FIRING — chains extending to anchors ────────────────────────────
      case RT_STATE_FIRING:
        if (cluster.radiantTetherStateTicks >= RT_FIRE_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_MOVEMENT;
          cluster.radiantTetherStateTicks = 0;
          // Assign random tighten/loosen
          assignReelDirections(cs, world.rng);
        }
        break;

      // ── MOVEMENT — boss moves via chain winching ────────────────────────
      case RT_STATE_MOVEMENT: {
        // Re-assign reel directions every 60 ticks for variety
        if (cluster.radiantTetherStateTicks > 0 && cluster.radiantTetherStateTicks % 60 === 0) {
          assignReelDirections(cs, world.rng);
        }

        const result = tickChains(
          cs,
          cluster.positionXWorld, cluster.positionYWorld,
          cluster.radiantTetherVelXWorld, cluster.radiantTetherVelYWorld,
        );
        cluster.radiantTetherVelXWorld = result.newVelX;
        cluster.radiantTetherVelYWorld = result.newVelY;
        cluster.positionXWorld = result.newPosX;
        cluster.positionYWorld = result.newPosY;

        // Detect opposing-chain snaps
        detectAndSnapChains(cs, cluster.positionXWorld, cluster.positionYWorld);

        if (cluster.radiantTetherStateTicks >= RT_MOVEMENT_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_RESET;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── RESET — retract chains, prepare next cycle ──────────────────────
      case RT_STATE_RESET:
        retractAllChains(cs);
        if (cluster.radiantTetherStateTicks >= RT_RESET_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_TELEGRAPH;
          cluster.radiantTetherStateTicks = 0;
          // Rotate starting angle for variety
          cluster.radiantTetherBaseAngleRad += 0.7 + nextFloat(world.rng) * 0.6;
        }
        break;

      // ── DEAD ────────────────────────────────────────────────────────────
      case RT_STATE_DEAD:
        retractAllChains(cs);
        break;
    }

    // Tick broken chains (always, regardless of phase)
    tickBrokenChains(cs);

    // Chain-player collision check (active during movement, firing, and reset)
    if (state >= RT_STATE_FIRING && state <= RT_STATE_RESET) {
      checkChainPlayerCollision(cs, world, cluster.positionXWorld, cluster.positionYWorld);
    }
    // Broken chains can also damage during any phase
    if (cs.playerChainIframeTicks === 0) {
      // Already checked inside checkChainPlayerCollision for active chains;
      // broken chains are also checked there.
      // But we need to tick iframes even outside collision phases
    }
    if (cs.playerChainIframeTicks > 0 && state < RT_STATE_FIRING) {
      cs.playerChainIframeTicks--;
    }
  }
}

function ensureChainState(): RadiantTetherChainState {
  if (_chainState === null) {
    _chainState = createRadiantTetherChainState();
  }
  return _chainState;
}
