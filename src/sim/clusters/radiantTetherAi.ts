/**
 * Radiant Tether — AI state machine and per-tick behavior (chains only).
 *
 * States:
 *   0 = inactive  — dormant, awaiting player proximity
 *   1 = active    — chains fired, boss moves via chain winching
 *   2 = reset     — chains retract, brief pause before next cycle
 *   3 = dead
 *
 * Called from tick.ts after applyRockElementalAI (step 0.5d).
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { dist } from '../../utils/math';
import {
  RT_RESET_DURATION_TICKS,
  RT_MOVEMENT_DURATION_TICKS,
  RT_CHAIN_COUNT_THRESHOLDS,
  RT_CHAIN_COUNT_MIN,
  RT_CHAIN_COUNT_MAX,
  RT_ACTIVATION_RANGE_WORLD,
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

export const RT_STATE_INACTIVE = 0;
export const RT_STATE_ACTIVE   = 1;
export const RT_STATE_RESET    = 2;
export const RT_STATE_DEAD     = 3;

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
    if (cluster.isRadiantTetherFlag !== 1) continue;
    if (cluster.isAliveFlag === 0) {
      cluster.radiantTetherState = RT_STATE_DEAD;
      const cs = ensureChainState();
      retractAllChains(cs);
      continue;
    }

    const cs = ensureChainState();
    const state = cluster.radiantTetherState;
    cluster.radiantTetherStateTicks += 1;

    const dxToPlayer = playerFound ? playerX - cluster.positionXWorld : 0;
    const dyToPlayer = playerFound ? playerY - cluster.positionYWorld : 0;
    const distToPlayer = playerFound
      ? dist(cluster.positionXWorld, cluster.positionYWorld, playerX, playerY)
      : 0;

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
          cluster.radiantTetherState = RT_STATE_ACTIVE;
          cluster.radiantTetherStateTicks = 0;
          cluster.radiantTetherBaseAngleRad = Math.atan2(dyToPlayer, dxToPlayer);
          cluster.radiantTetherChainCount = chainCount;
          fireChains(world, cs, cluster.positionXWorld, cluster.positionYWorld, cluster.radiantTetherBaseAngleRad, chainCount);
          assignReelDirections(cs, world.rng);
        }
        break;

      // ── ACTIVE — boss moves via chain winching ───────────────────────────
      case RT_STATE_ACTIVE: {
        if (cluster.radiantTetherStateTicks > 0 && cluster.radiantTetherStateTicks % 60 === 0) {
          assignReelDirections(cs, world.rng);
        }

        const moveResult = tickChains(
          cs, world,
          cluster.positionXWorld, cluster.positionYWorld,
          cluster.radiantTetherVelXWorld, cluster.radiantTetherVelYWorld,
        );
        cluster.radiantTetherVelXWorld = moveResult.newVelX;
        cluster.radiantTetherVelYWorld = moveResult.newVelY;
        cluster.positionXWorld = moveResult.newPosX;
        cluster.positionYWorld = moveResult.newPosY;
        detectAndSnapChains(cs, cluster.positionXWorld, cluster.positionYWorld);

        if (cluster.radiantTetherStateTicks >= RT_MOVEMENT_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_RESET;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── RESET — retract chains, brief pause, restart ────────────────────
      case RT_STATE_RESET:
        retractAllChains(cs);
        if (cluster.radiantTetherStateTicks >= RT_RESET_DURATION_TICKS) {
          cluster.radiantTetherState = RT_STATE_ACTIVE;
          cluster.radiantTetherStateTicks = 0;
          cluster.radiantTetherBaseAngleRad += 0.7 + nextFloat(world.rng) * 0.6;
          cluster.radiantTetherChainCount = chainCount;
          if (playerFound) {
            fireChains(world, cs, cluster.positionXWorld, cluster.positionYWorld, cluster.radiantTetherBaseAngleRad, chainCount);
            assignReelDirections(cs, world.rng);
          }
        }
        break;

      // ── DEAD ────────────────────────────────────────────────────────────
      case RT_STATE_DEAD:
        retractAllChains(cs);
        break;
    }

    tickBrokenChains(cs);

    if (state === RT_STATE_ACTIVE || state === RT_STATE_RESET) {
      checkChainPlayerCollision(cs, world, cluster.positionXWorld, cluster.positionYWorld);
    } else if (cs.playerChainIframeTicks > 0) {
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
