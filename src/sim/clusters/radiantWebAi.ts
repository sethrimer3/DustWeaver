/**
 * Radiant Web — AI state machine.
 *
 * States:
 *   0 = inactive      — dormant, awaiting player proximity
 *   1 = beam_grow     — 3 main beams grow toward walls
 *   2 = branch_grow   — 2 branch beams per main beam grow from wall impacts
 *   3 = energized     — branch beams deal damage
 *   4 = rope_decay    — branch beams become physics ropes
 *   5 = reset         — brief pause before next attack cycle
 *   6 = dead
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { dist } from '../../utils/math';
import {
  RW_RESET_DURATION_TICKS,
  RW_BRANCH_DAMAGE_TICKS,
  RW_ACTIVATION_RANGE_WORLD,
} from './radiantWebConfig';
import {
  RadiantWebBeamState,
  createRadiantWebBeamState,
  startBeamAttack,
  tickBeamGrow,
  startBranchGrow,
  tickBranchGrow,
  startEnergizePhase,
  tickEnergizePhase,
  startRopeDecay,
  tickRopeDecay,
  tickBranchPlayerCollision,
  resetBeamAttackState,
} from './radiantWebBeams';

export const RW_STATE_INACTIVE    = 0;
export const RW_STATE_BEAM_GROW   = 1;
export const RW_STATE_BRANCH_GROW = 2;
export const RW_STATE_ENERGIZED   = 3;
export const RW_STATE_ROPE_DECAY  = 4;
export const RW_STATE_RESET       = 5;
export const RW_STATE_DEAD        = 6;

let _beamState: RadiantWebBeamState | null = null;

export function getRadiantWebBeamState(): RadiantWebBeamState | null {
  return _beamState;
}

export function resetRadiantWebState(): void {
  _beamState = null;
}

export function applyRadiantWebAI(world: WorldState): void {
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
    if (cluster.isRadiantWebFlag !== 1) continue;
    if (cluster.isAliveFlag === 0) {
      cluster.radiantWebState = RW_STATE_DEAD;
      if (_beamState !== null) resetBeamAttackState(_beamState);
      continue;
    }

    const bs = ensureBeamState();
    const state = cluster.radiantWebState;
    cluster.radiantWebStateTicks += 1;

    const distToPlayer = playerFound
      ? dist(cluster.positionXWorld, cluster.positionYWorld, playerX, playerY)
      : 0;

    switch (state) {
      case RW_STATE_INACTIVE:
        if (playerFound && distToPlayer <= RW_ACTIVATION_RANGE_WORLD) {
          cluster.radiantWebState = RW_STATE_BEAM_GROW;
          cluster.radiantWebStateTicks = 0;
          startBeamAttack(bs, world, cluster.positionXWorld, cluster.positionYWorld, playerX, playerY);
        }
        break;

      case RW_STATE_BEAM_GROW: {
        const allHit = tickBeamGrow(bs);
        if (allHit) {
          startBranchGrow(bs, world);
          cluster.radiantWebState = RW_STATE_BRANCH_GROW;
          cluster.radiantWebStateTicks = 0;
        }
        break;
      }

      case RW_STATE_BRANCH_GROW: {
        const allDone = tickBranchGrow(bs);
        if (allDone) {
          startEnergizePhase(bs);
          cluster.radiantWebState = RW_STATE_ENERGIZED;
          cluster.radiantWebStateTicks = 0;
        }
        break;
      }

      case RW_STATE_ENERGIZED:
        tickEnergizePhase(bs);
        tickBranchPlayerCollision(bs, world);
        if (cluster.radiantWebStateTicks >= RW_BRANCH_DAMAGE_TICKS) {
          startRopeDecay(bs);
          cluster.radiantWebState = RW_STATE_ROPE_DECAY;
          cluster.radiantWebStateTicks = 0;
        }
        break;

      case RW_STATE_ROPE_DECAY: {
        const ropesGone = tickRopeDecay(bs);
        tickBranchPlayerCollision(bs, world);
        if (ropesGone) {
          cluster.radiantWebState = RW_STATE_RESET;
          cluster.radiantWebStateTicks = 0;
        }
        break;
      }

      case RW_STATE_RESET:
        if (cluster.radiantWebStateTicks >= RW_RESET_DURATION_TICKS) {
          resetBeamAttackState(bs);
          cluster.radiantWebState = RW_STATE_BEAM_GROW;
          cluster.radiantWebStateTicks = 0;
          if (playerFound) {
            startBeamAttack(bs, world, cluster.positionXWorld, cluster.positionYWorld, playerX, playerY);
          }
          // Drift slightly toward player to prevent camping
          if (playerFound) {
            const dxP = playerX - cluster.positionXWorld;
            const dyP = playerY - cluster.positionYWorld;
            const dP = Math.sqrt(dxP * dxP + dyP * dyP);
            if (dP > 0.1) {
              const driftSpeed = 0.3 + nextFloat(world.rng) * 0.2;
              cluster.velocityXWorld = (dxP / dP) * driftSpeed;
              cluster.velocityYWorld = (dyP / dP) * driftSpeed;
            }
          }
        }
        break;

      case RW_STATE_DEAD:
        resetBeamAttackState(bs);
        break;
    }
  }
}

function ensureBeamState(): RadiantWebBeamState {
  if (_beamState === null) {
    _beamState = createRadiantWebBeamState();
  }
  return _beamState;
}
