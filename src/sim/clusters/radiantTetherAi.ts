/**
 * Radiant Tether — AI state machine and per-tick behavior.
 *
 * States:
 *   0 = inactive      — dormant, awaiting player proximity
 *   1 = beam_grow     — 3 main beams grow from boss toward walls
 *   2 = branch_grow   — 2 branch beams grow from each main beam's wall impact
 *   3 = energized     — branch beams glow and deal damage for a window
 *   4 = rope_decay    — branch beams become physics ropes that sag and fade
 *   5 = reset         — chains retract, attack state clears, cycle restarts
 *   6 = dead
 *
 * The boss also fires movement chains on entering beam_grow and moves via
 * chain winching throughout states 1–4.  The beam attack and chain movement
 * run in parallel.
 *
 * Called from tick.ts after applyRockElementalAI (step 0.5d).
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { dist } from '../../utils/math';
import {
  RT_RESET_DURATION_TICKS,
  RT_BRANCH_DAMAGE_TICKS,
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
  startBeamAttack,
  tickBeamGrow,
  startBranchGrow,
  tickBranchGrow,
  startEnergizePhase,
  tickEnergizePhase,
  startRopeDecay,
  tickRopeDecay,
  tickBranchPlayerCollision,
  resetAttackState,
} from './radiantTetherChains';

// ── State enum ──────────────────────────────────────────────────────────────

export const RT_STATE_INACTIVE    = 0;
export const RT_STATE_BEAM_GROW   = 1;
export const RT_STATE_BRANCH_GROW = 2;
export const RT_STATE_ENERGIZED   = 3;
export const RT_STATE_ROPE_DECAY  = 4;
export const RT_STATE_RESET       = 5;
export const RT_STATE_DEAD        = 6;

/** Distance at which the boss activates (world units). */
const RT_ACTIVATION_RANGE_WORLD = 250.0;
const RT_SPORE_FALL_ACCEL_WORLD = 30.0;
const RT_SPORE_FALL_SPEED_MAX_WORLD = 24.0;
const RT_SPORE_SWAY_ACCEL_WORLD = 18.0;
const RT_SPORE_SWAY_FREQ_RAD = 0.11;
const RT_SPORE_DRAG_FACTOR = 0.985;
const RT_SPORE_ATTACK_MODE_TICKS = 3.0;

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

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Fires movement chains and starts a beam attack — shared by INACTIVE and RESET transitions. */
function beginBeamAttackCycle(
  world: WorldState,
  cs: RadiantTetherChainState,
  bossXWorld: number, bossYWorld: number,
  chainCount: number,
  baseAngleRad: number,
  playerXWorld: number, playerYWorld: number,
): void {
  fireChains(world, cs, bossXWorld, bossYWorld, baseAngleRad, chainCount);
  assignReelDirections(cs, world.rng);
  startBeamAttack(cs, world, bossXWorld, bossYWorld, playerXWorld, playerYWorld);
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
      const cs = ensureChainState();
      retractAllChains(cs);
      resetAttackState(cs);
      continue;
    }

    const cs = ensureChainState();
    if (cs.bossEntityId !== cluster.entityId) {
      cs.bossEntityId = cluster.entityId;
      cs.bossLastHealthPoints = cluster.healthPoints;
      cs.hasBossTakenDamageFlag = 0;
    }
    if (cluster.healthPoints < cs.bossLastHealthPoints) {
      cs.hasBossTakenDamageFlag = 1;
    }
    cs.bossLastHealthPoints = cluster.healthPoints;

    if (cs.hasBossTakenDamageFlag === 1) {
      releaseRadiantTetherSpores(world, cluster.entityId);
    } else {
      suppressRadiantTetherDustAttacks(world, cluster.entityId);
    }

    const state = cluster.radiantTetherState;
    cluster.radiantTetherStateTicks += 1;

    const dxToPlayer = playerFound ? playerX - cluster.positionXWorld : 0;
    const dyToPlayer = playerFound ? playerY - cluster.positionYWorld : 0;
    const distToPlayer = playerFound ? dist(cluster.positionXWorld, cluster.positionYWorld, playerX, playerY) : 0;

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
          cluster.radiantTetherState = RT_STATE_BEAM_GROW;
          cluster.radiantTetherStateTicks = 0;
          cluster.radiantTetherBaseAngleRad = Math.atan2(dyToPlayer, dxToPlayer);
          cluster.radiantTetherChainCount = chainCount;
          // Fire movement chains and launch first beam attack
          beginBeamAttackCycle(world, cs, cluster.positionXWorld, cluster.positionYWorld, chainCount, cluster.radiantTetherBaseAngleRad, playerX, playerY);
        }
        break;

      // ── BEAM_GROW — main beams extend toward walls ───────────────────────
      case RT_STATE_BEAM_GROW: {
        // Re-assign reel directions periodically for natural movement
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

        const allHit = tickBeamGrow(cs, cluster.positionXWorld, cluster.positionYWorld);
        if (allHit) {
          startBranchGrow(cs, world);
          cluster.radiantTetherState = RT_STATE_BRANCH_GROW;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── BRANCH_GROW — branch beams extend from main-beam wall impacts ────
      case RT_STATE_BRANCH_GROW: {
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

        const allDone = tickBranchGrow(cs);
        if (allDone) {
          startEnergizePhase(cs);
          cluster.radiantTetherState = RT_STATE_ENERGIZED;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── ENERGIZED — branch beams deal damage ────────────────────────────
      case RT_STATE_ENERGIZED: {
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

        tickEnergizePhase(cs);
        tickBranchPlayerCollision(cs, world);

        if (cluster.radiantTetherStateTicks >= RT_BRANCH_DAMAGE_TICKS) {
          startRopeDecay(cs);
          cluster.radiantTetherState = RT_STATE_ROPE_DECAY;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── ROPE_DECAY — ropes sag under gravity and dissolve ────────────────
      case RT_STATE_ROPE_DECAY: {
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

        const ropesGone = tickRopeDecay(cs);
        tickBranchPlayerCollision(cs, world);

        if (ropesGone) {
          cluster.radiantTetherState = RT_STATE_RESET;
          cluster.radiantTetherStateTicks = 0;
        }
        break;
      }

      // ── RESET — retract chains, clear attack, restart ───────────────────
      case RT_STATE_RESET:
        retractAllChains(cs);
        if (cluster.radiantTetherStateTicks >= RT_RESET_DURATION_TICKS) {
          resetAttackState(cs);
          cluster.radiantTetherState = RT_STATE_BEAM_GROW;
          cluster.radiantTetherStateTicks = 0;
          // Rotate base angle for variety and re-fire chains + beams
          cluster.radiantTetherBaseAngleRad += 0.7 + nextFloat(world.rng) * 0.6;
          cluster.radiantTetherChainCount = chainCount;
          if (playerFound) {
            beginBeamAttackCycle(world, cs, cluster.positionXWorld, cluster.positionYWorld, chainCount, cluster.radiantTetherBaseAngleRad, playerX, playerY);
          }
        }
        break;

      // ── DEAD ────────────────────────────────────────────────────────────
      case RT_STATE_DEAD:
        retractAllChains(cs);
        resetAttackState(cs);
        break;
    }

    // Tick broken chains always
    tickBrokenChains(cs);

    // Chain-player collision check during active movement phases
    if (state >= RT_STATE_BEAM_GROW && state <= RT_STATE_RESET) {
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

function suppressRadiantTetherDustAttacks(world: WorldState, bossEntityId: number): void {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0) continue;
    if (world.ownerEntityId[i] !== bossEntityId) continue;
    if (world.isTransientFlag[i] === 1) continue;
    if (world.behaviorMode[i] !== 0) {
      world.behaviorMode[i] = 0;
      world.attackModeTicksLeft[i] = 0;
    }
  }
}

function releaseRadiantTetherSpores(world: WorldState, bossEntityId: number): void {
  const dtSec = world.dtMs / 1000.0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0) continue;
    if (world.ownerEntityId[i] !== bossEntityId) continue;
    if (world.isTransientFlag[i] === 1) continue;

    world.behaviorMode[i] = 1;
    world.attackModeTicksLeft[i] = RT_SPORE_ATTACK_MODE_TICKS;

    const swayAccelWorld = Math.sin((world.tick + world.noiseTickSeed[i]) * RT_SPORE_SWAY_FREQ_RAD) * RT_SPORE_SWAY_ACCEL_WORLD;
    world.velocityXWorld[i] += swayAccelWorld * dtSec;
    world.velocityXWorld[i] *= RT_SPORE_DRAG_FACTOR;
    world.velocityYWorld[i] += RT_SPORE_FALL_ACCEL_WORLD * dtSec;
    if (world.velocityYWorld[i] > RT_SPORE_FALL_SPEED_MAX_WORLD) {
      world.velocityYWorld[i] = RT_SPORE_FALL_SPEED_MAX_WORLD;
    }
  }
}
