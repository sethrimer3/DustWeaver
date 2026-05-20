/**
 * Radiant Tether — chain system.
 *
 * Manages the lifecycle of light-chains: raycasting to find anchor points,
 * storing per-chain state, detecting opposing-chain snaps, and producing
 * broken-chain segments that swing from walls.
 *
 * Also owns the new beam-attack system: main beams (3 rays), branch beams
 * (2 per main, splitting from wall impact), energize phase (damage window),
 * and rope decay (branch beams become physics ropes).
 *
 * Chain data lives outside of ClusterState to keep the struct flat.
 * The boss AI module owns a RadiantTetherChainState instance and passes
 * it through the tick and render pipelines via the world state.
 */

import { WorldState } from '../world';
import { RngState, nextFloat, nextFloatRange } from '../rng';
import {
  RT_CHAIN_MAX_RANGE_WORLD,
  RT_CHAIN_RAYCAST_STEP_WORLD,
  RT_ANCHOR_EMBED_WORLD,
  RT_REEL_SPEED_MIN_WORLD,
  RT_REEL_SPEED_MAX_WORLD,
  RT_TIGHTEN_PROBABILITY,
  RT_MIN_CHAIN_LENGTH_WORLD,
  RT_BOSS_ACCEL_WORLD,
  RT_BOSS_DRAG,
  RT_SNAP_OPPOSING_ANGLE_TOLERANCE_RAD,
  RT_SNAP_STRAIGHTNESS_THRESHOLD,
  RT_SNAP_TENSION_RATIO,
  RT_BROKEN_CHAIN_LIFETIME_TICKS,
  RT_BROKEN_CHAIN_GRAVITY_WORLD,
  RT_BROKEN_CHAIN_DRAG,
  RT_MAX_BROKEN_CHAINS,
  RT_CHAIN_COUNT_MAX,
  RT_FIRE_RETRY_COUNT,
  RT_FIRE_RETRY_OFFSET_RAD,
  RT_CHAIN_DAMAGE,
  RT_CHAIN_HITBOX_HALF_WIDTH_WORLD,
  RT_CHAIN_IFRAMES_TICKS,
  RT_WALL_REPEL_DIST_WORLD,
  RT_WALL_REPEL_ACCEL_WORLD,
  RT_WALL_REPEL_MAX_SPEED_WORLD,
  RT_MAIN_BEAM_COUNT,
  RT_MAIN_BEAM_GROW_SPEED_WORLD,
  RT_MAIN_BEAM_MAX_RANGE_WORLD,
  RT_BRANCH_BEAMS_PER_MAIN,
  RT_BRANCH_BEAM_ANGLE_OFFSET_RAD,
  RT_BRANCH_BEAM_GROW_SPEED_WORLD,
  RT_BRANCH_BEAM_MAX_RANGE_WORLD,
  RT_BRANCH_ENERGIZE_DELAY_TICKS,
  RT_BRANCH_DAMAGE,
  RT_BRANCH_HITBOX_HALF_WIDTH_WORLD,
  RT_BRANCH_IFRAMES_TICKS,
  RT_BRANCH_ROPE_LIFETIME_TICKS,
  RT_BRANCH_ROPE_GRAVITY_WORLD,
  RT_BRANCH_ROPE_DRAG,
  RT_BODY_RADIUS_WORLD,
} from './radiantTetherConfig';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import { closestPointOnSegment } from '../physics/collision';

// ── Types ───────────────────────────────────────────────────────────────────

/** State of a single active chain anchored to terrain. */
export interface ActiveChain {
  /** Angle from boss center at which the chain was fired (radians). */
  angleRad: number;
  /** World-space anchor point on solid terrain. */
  anchorXWorld: number;
  anchorYWorld: number;
  /** Natural length = distance from boss to anchor at fire time. */
  naturalLengthWorld: number;
  /** Current effective chain length (modified by reeling). */
  currentLengthWorld: number;
  /** Reel speed (positive = loosening, negative = tightening) in wu/tick. */
  reelSpeedWorld: number;
  /** 1 = tightening this cycle, 0 = loosening. */
  isTighteningFlag: 0 | 1;
  /** 1 = chain is valid/active. */
  isActiveFlag: 0 | 1;
}

/** A detached chain segment swinging from its wall anchor. */
export interface BrokenChain {
  /** Wall anchor position. */
  anchorXWorld: number;
  anchorYWorld: number;
  /** Free-end position (hangs from anchor). */
  freeEndXWorld: number;
  freeEndYWorld: number;
  /** Free-end velocity. */
  freeEndVelXWorld: number;
  freeEndVelYWorld: number;
  /** Total length of the chain (constant after snap). */
  lengthWorld: number;
  /** Remaining ticks before fade-out. */
  lifetimeTicks: number;
  /** 1 = alive. */
  isActiveFlag: 0 | 1;
}

/** A single main attack beam growing from the boss toward a wall. */
export interface MainBeam {
  dirXWorld: number;
  dirYWorld: number;
  /** Current visible length (grows from 0 to maxLengthWorld). */
  currentLengthWorld: number;
  /** Maximum length — wall distance or RT_MAIN_BEAM_MAX_RANGE_WORLD. */
  maxLengthWorld: number;
  /** Wall surface impact point (set when beam first reaches the wall). */
  hitXWorld: number;
  hitYWorld: number;
  /** Outward wall normal at the impact point. */
  normalXWorld: number;
  normalYWorld: number;
  hasHitWall: 0 | 1;
  isActiveFlag: 0 | 1;
  /** 0..1 lifetime fraction when puff was triggered (for short-lived ring VFX). */
  puffProgress: number;
}

/** A branch beam emanating from a main-beam wall-impact point. */
export interface BranchBeam {
  /** Branch origin = main beam hit position. */
  startXWorld: number;
  startYWorld: number;
  dirXWorld: number;
  dirYWorld: number;
  /** Current visible length (grows from 0 to maxLengthWorld). */
  currentLengthWorld: number;
  maxLengthWorld: number;
  hasHitWall: 0 | 1;
  isActiveFlag: 0 | 1;
  /** 1 after startEnergizePhase is called. */
  isEnergizedFlag: 0 | 1;
  /** Counts down from RT_BRANCH_ENERGIZE_DELAY_TICKS to 0 before damage starts. */
  energizeTicks: number;
  /** 1 after this beam has been converted to a rope. */
  isRopeFlag: 0 | 1;
  /** Rope anchor = startXY (branch split point on main-beam wall). */
  ropeAnchorXWorld: number;
  ropeAnchorYWorld: number;
  /** Physics free-end position. */
  ropeFreeEndXWorld: number;
  ropeFreeEndYWorld: number;
  /** Physics free-end velocity. */
  ropeFreeEndVelXWorld: number;
  ropeFreeEndVelYWorld: number;
  /** Rope length (held constant by pendulum constraint). */
  ropeLengthWorld: number;
  /** Remaining lifetime ticks for this rope. */
  ropeLifetimeTicks: number;
  /** Total lifetime ticks (used to compute fade fraction). */
  ropeTotalLifetimeTicks: number;
}

/** Full chain state managed outside ClusterState. */
export interface RadiantTetherChainState {
  /** Pre-allocated active chain slots. */
  chains: ActiveChain[];
  /** Pre-allocated broken chain slots. */
  brokenChains: BrokenChain[];
  /** Player invulnerability ticks remaining from chain damage. */
  playerChainIframeTicks: number;
  /** Entity id of the active Radiant Tether boss in the room. */
  bossEntityId: number;
  /** Last recorded boss HP to detect first-damage transition deterministically. */
  bossLastHealthPoints: number;
  /** Set once the boss has taken damage and should release attack spores. */
  hasBossTakenDamageFlag: 0 | 1;

  // ── Beam attack system ──────────────────────────────────────────────────
  /** Pre-allocated main beam slots (RT_MAIN_BEAM_COUNT). */
  mainBeams: MainBeam[];
  /** Pre-allocated branch beam slots (RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN). */
  branchBeams: BranchBeam[];
  /** General tick counter within the current beam attack sub-phase. */
  attackPhaseTicks: number;
  /** Sub-phase index within the beam attack states. */
  attackPhase: number;
  /** Invulnerability ticks remaining from branch beam / rope damage. */
  branchPlayerIframeTicks: number;
}

// ── Factory ─────────────────────────────────────────────────────────────────

export function createRadiantTetherChainState(): RadiantTetherChainState {
  const chains: ActiveChain[] = [];
  for (let i = 0; i < RT_CHAIN_COUNT_MAX; i++) {
    chains.push(createInactiveChain());
  }
  const brokenChains: BrokenChain[] = [];
  for (let i = 0; i < RT_MAX_BROKEN_CHAINS; i++) {
    brokenChains.push(createInactiveBrokenChain());
  }

  const mainBeams: MainBeam[] = [];
  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    mainBeams.push(createInactiveMainBeam());
  }
  const branchBeams: BranchBeam[] = [];
  const branchBeamCount = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < branchBeamCount; i++) {
    branchBeams.push(createInactiveBranchBeam());
  }

  return {
    chains,
    brokenChains,
    playerChainIframeTicks: 0,
    bossEntityId: -1,
    bossLastHealthPoints: 0,
    hasBossTakenDamageFlag: 0,
    mainBeams,
    branchBeams,
    attackPhaseTicks: 0,
    attackPhase: 0,
    branchPlayerIframeTicks: 0,
  };
}

function createInactiveChain(): ActiveChain {
  return {
    angleRad: 0, anchorXWorld: 0, anchorYWorld: 0,
    naturalLengthWorld: 0, currentLengthWorld: 0,
    reelSpeedWorld: 0, isTighteningFlag: 0, isActiveFlag: 0,
  };
}

function createInactiveBrokenChain(): BrokenChain {
  return {
    anchorXWorld: 0, anchorYWorld: 0,
    freeEndXWorld: 0, freeEndYWorld: 0,
    freeEndVelXWorld: 0, freeEndVelYWorld: 0,
    lengthWorld: 0, lifetimeTicks: 0, isActiveFlag: 0,
  };
}

function createInactiveMainBeam(): MainBeam {
  return {
    dirXWorld: 0, dirYWorld: 0,
    currentLengthWorld: 0, maxLengthWorld: 0,
    hitXWorld: 0, hitYWorld: 0,
    normalXWorld: 0, normalYWorld: 0,
    hasHitWall: 0, isActiveFlag: 0, puffProgress: 0,
  };
}

function createInactiveBranchBeam(): BranchBeam {
  return {
    startXWorld: 0, startYWorld: 0,
    dirXWorld: 0, dirYWorld: 0,
    currentLengthWorld: 0, maxLengthWorld: 0,
    hasHitWall: 0, isActiveFlag: 0, isEnergizedFlag: 0,
    energizeTicks: 0,
    isRopeFlag: 0,
    ropeAnchorXWorld: 0, ropeAnchorYWorld: 0,
    ropeFreeEndXWorld: 0, ropeFreeEndYWorld: 0,
    ropeFreeEndVelXWorld: 0, ropeFreeEndVelYWorld: 0,
    ropeLengthWorld: 0,
    ropeLifetimeTicks: 0, ropeTotalLifetimeTicks: 0,
  };
}

// ── Raycast to find wall anchor ─────────────────────────────────────────────

/**
 * Steps along (dirX,dirY) from (startX,startY) until a solid wall AABB
 * is hit or maxRange is exceeded.  Returns anchor coords or null.
 */
export function raycastToWall(
  world: WorldState,
  startXWorld: number, startYWorld: number,
  dirXWorld: number, dirYWorld: number,
  maxRangeWorld: number,
): { xWorld: number; yWorld: number } | null {
  let x = startXWorld;
  let y = startYWorld;
  const step = RT_CHAIN_RAYCAST_STEP_WORLD;
  const steps = Math.ceil(maxRangeWorld / step);
  for (let s = 0; s < steps; s++) {
    x += dirXWorld * step;
    y += dirYWorld * step;
    // Check against all walls
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) {
        // Hit wall — embed slightly and return
        return {
          xWorld: x + dirXWorld * RT_ANCHOR_EMBED_WORLD,
          yWorld: y + dirYWorld * RT_ANCHOR_EMBED_WORLD,
        };
      }
    }
  }
  return null;
}

/**
 * Same as raycastToWall but also returns the outward wall normal at the impact
 * point, determined by minimum-penetration depth on each face.
 * Returns the hit position at the wall surface (not embedded).
 */
export function raycastToWallWithNormal(
  world: WorldState,
  startXWorld: number, startYWorld: number,
  dirXWorld: number, dirYWorld: number,
  maxRangeWorld: number,
): { xWorld: number; yWorld: number; normalXWorld: number; normalYWorld: number } | null {
  const step = RT_CHAIN_RAYCAST_STEP_WORLD;
  const steps = Math.ceil(maxRangeWorld / step);
  let prevX = startXWorld;
  let prevY = startYWorld;
  let x = startXWorld;
  let y = startYWorld;
  for (let s = 0; s < steps; s++) {
    prevX = x;
    prevY = y;
    x += dirXWorld * step;
    y += dirYWorld * step;
    for (let wi = 0; wi < world.wallCount; wi++) {
      const wx = world.wallXWorld[wi];
      const wy = world.wallYWorld[wi];
      const ww = world.wallWWorld[wi];
      const wh = world.wallHWorld[wi];
      if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) {
        // Determine outward normal via minimum penetration depth
        const leftPen = x - wx;
        const rightPen = wx + ww - x;
        const topPen = y - wy;
        const bottomPen = wy + wh - y;
        const minPen = Math.min(leftPen, rightPen, topPen, bottomPen);
        let normalXWorld = 0;
        let normalYWorld = 0;
        if (minPen === leftPen)        { normalXWorld = -1; normalYWorld =  0; }
        else if (minPen === rightPen)  { normalXWorld =  1; normalYWorld =  0; }
        else if (minPen === topPen)    { normalXWorld =  0; normalYWorld = -1; }
        else                           { normalXWorld =  0; normalYWorld =  1; }
        // Return the last un-embedded position (just at the wall surface)
        return { xWorld: prevX, yWorld: prevY, normalXWorld, normalYWorld };
      }
    }
  }
  return null;
}

// ── Fire chains along evenly-spaced angles ──────────────────────────────────

/**
 * Fires chains from the boss at evenly-spaced angles around baseAngle.
 * If a direction misses terrain, retries with slight offsets.
 */
export function fireChains(
  world: WorldState,
  cs: RadiantTetherChainState,
  bossXWorld: number, bossYWorld: number,
  baseAngleRad: number,
  chainCount: number,
): void {
  const spacing = (Math.PI * 2) / chainCount;
  // Deactivate all first
  for (let i = 0; i < cs.chains.length; i++) cs.chains[i].isActiveFlag = 0;

  for (let i = 0; i < chainCount; i++) {
    const angle = baseAngleRad + i * spacing;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    let anchor = raycastToWall(world, bossXWorld, bossYWorld, dirX, dirY, RT_CHAIN_MAX_RANGE_WORLD);
    // Retry with offsets if missed
    if (anchor === null) {
      for (let r = 1; r <= RT_FIRE_RETRY_COUNT; r++) {
        const offsetAngle = angle + r * RT_FIRE_RETRY_OFFSET_RAD * (r % 2 === 0 ? 1 : -1);
        anchor = raycastToWall(
          world, bossXWorld, bossYWorld,
          Math.cos(offsetAngle), Math.sin(offsetAngle),
          RT_CHAIN_MAX_RANGE_WORLD,
        );
        if (anchor !== null) break;
      }
    }
    if (anchor === null) continue; // Skip this chain entirely

    const dx = anchor.xWorld - bossXWorld;
    const dy = anchor.yWorld - bossYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const chain = cs.chains[i];
    chain.angleRad = angle;
    chain.anchorXWorld = anchor.xWorld;
    chain.anchorYWorld = anchor.yWorld;
    chain.naturalLengthWorld = dist;
    chain.currentLengthWorld = dist;
    chain.reelSpeedWorld = 0;
    chain.isTighteningFlag = 0;
    chain.isActiveFlag = 1;
  }
}

// ── Assign random tighten/loosen to active chains ───────────────────────────

export function assignReelDirections(cs: RadiantTetherChainState, rng: RngState): void {
  for (let i = 0; i < cs.chains.length; i++) {
    const chain = cs.chains[i];
    if (chain.isActiveFlag === 0) continue;
    const isTighten = nextFloat(rng) < RT_TIGHTEN_PROBABILITY;
    chain.isTighteningFlag = isTighten ? 1 : 0;
    const speed = nextFloatRange(rng, RT_REEL_SPEED_MIN_WORLD, RT_REEL_SPEED_MAX_WORLD);
    chain.reelSpeedWorld = isTighten ? -speed : speed;
  }
}

// ── Tick chains: reel + move boss ───────────────────────────────────────────

export function tickChains(
  cs: RadiantTetherChainState,
  world: WorldState,
  bossXWorld: number, bossYWorld: number,
  bossVelXWorld: number, bossVelYWorld: number,
): { newVelX: number; newVelY: number; newPosX: number; newPosY: number } {
  // Reel chains
  for (let i = 0; i < cs.chains.length; i++) {
    const chain = cs.chains[i];
    if (chain.isActiveFlag === 0) continue;
    chain.currentLengthWorld += chain.reelSpeedWorld;
    if (chain.currentLengthWorld < RT_MIN_CHAIN_LENGTH_WORLD) {
      chain.currentLengthWorld = RT_MIN_CHAIN_LENGTH_WORLD;
    }
    if (chain.currentLengthWorld > chain.naturalLengthWorld * 1.3) {
      chain.currentLengthWorld = chain.naturalLengthWorld * 1.3;
    }
  }

  // Accumulate net force from tightening chains pulling boss toward anchors
  let forceX = 0;
  let forceY = 0;
  for (let i = 0; i < cs.chains.length; i++) {
    const chain = cs.chains[i];
    if (chain.isActiveFlag === 0) continue;
    const dx = chain.anchorXWorld - bossXWorld;
    const dy = chain.anchorYWorld - bossYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.1) continue;

    // Only pull if boss is farther than current length (chain is taut)
    if (dist > chain.currentLengthWorld) {
      const excess = dist - chain.currentLengthWorld;
      const pull = excess * RT_BOSS_ACCEL_WORLD;
      forceX += (dx / dist) * pull;
      forceY += (dy / dist) * pull;
    }
  }

  let vx = (bossVelXWorld + forceX) * RT_BOSS_DRAG;
  let vy = (bossVelYWorld + forceY) * RT_BOSS_DRAG;

  // Wall repulsion — applied as direct velocity impulses after drag to avoid
  // drag dampening, giving a smooth magnetic repel feel.
  const bossHalf = RT_BODY_RADIUS_WORLD;
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    const ww = world.wallWWorld[wi];
    const wh = world.wallHWorld[wi];

    const dLeft = bossXWorld - wx;
    if (dLeft >= 0 && dLeft < RT_WALL_REPEL_DIST_WORLD &&
        bossYWorld >= wy - bossHalf && bossYWorld <= wy + wh + bossHalf) {
      vx -= RT_WALL_REPEL_ACCEL_WORLD * (1.0 - dLeft / RT_WALL_REPEL_DIST_WORLD);
    }
    const dRight = wx + ww - bossXWorld;
    if (dRight >= 0 && dRight < RT_WALL_REPEL_DIST_WORLD &&
        bossYWorld >= wy - bossHalf && bossYWorld <= wy + wh + bossHalf) {
      vx += RT_WALL_REPEL_ACCEL_WORLD * (1.0 - dRight / RT_WALL_REPEL_DIST_WORLD);
    }
    const dTop = bossYWorld - wy;
    if (dTop >= 0 && dTop < RT_WALL_REPEL_DIST_WORLD &&
        bossXWorld >= wx - bossHalf && bossXWorld <= wx + ww + bossHalf) {
      vy -= RT_WALL_REPEL_ACCEL_WORLD * (1.0 - dTop / RT_WALL_REPEL_DIST_WORLD);
    }
    const dBottom = wy + wh - bossYWorld;
    if (dBottom >= 0 && dBottom < RT_WALL_REPEL_DIST_WORLD &&
        bossXWorld >= wx - bossHalf && bossXWorld <= wx + ww + bossHalf) {
      vy += RT_WALL_REPEL_ACCEL_WORLD * (1.0 - dBottom / RT_WALL_REPEL_DIST_WORLD);
    }
  }

  // Clamp speed to wall-repel max
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed > RT_WALL_REPEL_MAX_SPEED_WORLD && speed > 0) {
    const scale = RT_WALL_REPEL_MAX_SPEED_WORLD / speed;
    vx *= scale;
    vy *= scale;
  }

  const px = bossXWorld + vx;
  const py = bossYWorld + vy;

  return { newVelX: vx, newVelY: vy, newPosX: px, newPosY: py };
}

// ── Detect and trigger opposing-chain snaps ─────────────────────────────────

/**
 * Checks all pairs of active tightening chains for opposing tension snaps.
 * Snapped chains are deactivated and added to broken-chain list.
 */
export function detectAndSnapChains(
  cs: RadiantTetherChainState,
  bossXWorld: number, bossYWorld: number,
): void {
  for (let i = 0; i < cs.chains.length; i++) {
    const a = cs.chains[i];
    if (a.isActiveFlag === 0 || a.isTighteningFlag === 0) continue;
    for (let j = i + 1; j < cs.chains.length; j++) {
      const b = cs.chains[j];
      if (b.isActiveFlag === 0 || b.isTighteningFlag === 0) continue;

      // Check if opposing
      let angleDiff = Math.abs(a.angleRad - b.angleRad);
      if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
      if (Math.abs(angleDiff - Math.PI) > RT_SNAP_OPPOSING_ANGLE_TOLERANCE_RAD) continue;

      // Check tension ratio
      const ratioA = a.currentLengthWorld / a.naturalLengthWorld;
      const ratioB = b.currentLengthWorld / b.naturalLengthWorld;
      if (ratioA > RT_SNAP_TENSION_RATIO || ratioB > RT_SNAP_TENSION_RATIO) continue;

      // Check straightness: distance from anchor A to anchor B vs sum of chain lengths
      const dxAB = b.anchorXWorld - a.anchorXWorld;
      const dyAB = b.anchorYWorld - a.anchorYWorld;
      const distAB = Math.sqrt(dxAB * dxAB + dyAB * dyAB);
      const sumLengths = a.currentLengthWorld + b.currentLengthWorld;
      if (sumLengths < distAB * RT_SNAP_STRAIGHTNESS_THRESHOLD) continue;

      // Snap! Convert both to broken chains
      snapChainToBroken(cs, a, bossXWorld, bossYWorld);
      snapChainToBroken(cs, b, bossXWorld, bossYWorld);
    }
  }
}

function snapChainToBroken(
  cs: RadiantTetherChainState,
  chain: ActiveChain,
  bossXWorld: number, bossYWorld: number,
): void {
  chain.isActiveFlag = 0;
  // Find a free broken-chain slot
  for (let k = 0; k < cs.brokenChains.length; k++) {
    if (cs.brokenChains[k].isActiveFlag === 0) {
      const bc = cs.brokenChains[k];
      bc.anchorXWorld = chain.anchorXWorld;
      bc.anchorYWorld = chain.anchorYWorld;
      bc.freeEndXWorld = bossXWorld;
      bc.freeEndYWorld = bossYWorld;
      bc.freeEndVelXWorld = 0;
      bc.freeEndVelYWorld = 0;
      bc.lengthWorld = chain.currentLengthWorld;
      bc.lifetimeTicks = RT_BROKEN_CHAIN_LIFETIME_TICKS;
      bc.isActiveFlag = 1;
      return;
    }
  }
  // No free slot — oldest broken chain is overwritten (slot 0)
  const bc = cs.brokenChains[0];
  bc.anchorXWorld = chain.anchorXWorld;
  bc.anchorYWorld = chain.anchorYWorld;
  bc.freeEndXWorld = bossXWorld;
  bc.freeEndYWorld = bossYWorld;
  bc.freeEndVelXWorld = 0;
  bc.freeEndVelYWorld = 0;
  bc.lengthWorld = chain.currentLengthWorld;
  bc.lifetimeTicks = RT_BROKEN_CHAIN_LIFETIME_TICKS;
  bc.isActiveFlag = 1;
}

// ── Tick broken chains (pendulum swing + fade) ──────────────────────────────

export function tickBrokenChains(cs: RadiantTetherChainState): void {
  for (let i = 0; i < cs.brokenChains.length; i++) {
    const bc = cs.brokenChains[i];
    if (bc.isActiveFlag === 0) continue;

    bc.lifetimeTicks--;
    if (bc.lifetimeTicks <= 0) {
      bc.isActiveFlag = 0;
      continue;
    }

    // Apply gravity to free end
    bc.freeEndVelYWorld += RT_BROKEN_CHAIN_GRAVITY_WORLD;
    bc.freeEndVelXWorld *= RT_BROKEN_CHAIN_DRAG;
    bc.freeEndVelYWorld *= RT_BROKEN_CHAIN_DRAG;

    bc.freeEndXWorld += bc.freeEndVelXWorld;
    bc.freeEndYWorld += bc.freeEndVelYWorld;

    // Constrain free end to chain length from anchor (pendulum constraint)
    const dx = bc.freeEndXWorld - bc.anchorXWorld;
    const dy = bc.freeEndYWorld - bc.anchorYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > bc.lengthWorld && dist > 0.01) {
      const scale = bc.lengthWorld / dist;
      bc.freeEndXWorld = bc.anchorXWorld + dx * scale;
      bc.freeEndYWorld = bc.anchorYWorld + dy * scale;

      // Project velocity along the constraint direction
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = bc.freeEndVelXWorld * nx + bc.freeEndVelYWorld * ny;
      if (dot > 0) {
        bc.freeEndVelXWorld -= dot * nx;
        bc.freeEndVelYWorld -= dot * ny;
      }
    }
  }
}

// ── Retract all active chains ───────────────────────────────────────────────

export function retractAllChains(cs: RadiantTetherChainState): void {
  for (let i = 0; i < cs.chains.length; i++) {
    cs.chains[i].isActiveFlag = 0;
  }
}

// ── Chain-player collision ──────────────────────────────────────────────────

/** Number of dust particles per armor point. */
const DUST_PARTICLES_PER_ARMOR = 4;

/**
 * Checks whether the player cluster overlaps any active chain or broken chain.
 * If a hit occurs and the player is not in iframes, deals damage and grants
 * iframes.  Uses point-to-segment distance for each chain.
 */
export function checkChainPlayerCollision(
  cs: RadiantTetherChainState,
  world: WorldState,
  bossXWorld: number, bossYWorld: number,
): void {
  if (cs.playerChainIframeTicks > 0) {
    cs.playerChainIframeTicks--;
    return;
  }

  let player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) {
    for (let i = 0; i < world.clusters.length; i++) {
      const candidate = world.clusters[i];
      if (candidate.isPlayerFlag === 1 && candidate.isAliveFlag === 1) {
        player = candidate;
        break;
      }
    }
  }
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) return;
  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const playerRadiusWorld = Math.max(player.halfWidthWorld, player.halfHeightWorld);
  const chainHitRadiusWorld = RT_CHAIN_HITBOX_HALF_WIDTH_WORLD + playerRadiusWorld;
  const chainHitRadiusSq = chainHitRadiusWorld * chainHitRadiusWorld;

  // Check active chains
  for (let i = 0; i < cs.chains.length; i++) {
    const chain = cs.chains[i];
    if (chain.isActiveFlag === 0) continue;
    const activeClosest = closestPointOnSegment(px, py, bossXWorld, bossYWorld, chain.anchorXWorld, chain.anchorYWorld);
    if (activeClosest.distSq <= chainHitRadiusSq) {
      applyChainDamage(player, cs, world, activeClosest.xWorld, activeClosest.yWorld);
      return;
    }
  }

  // Check broken chains (line from anchor to free end)
  for (let i = 0; i < cs.brokenChains.length; i++) {
    const bc = cs.brokenChains[i];
    if (bc.isActiveFlag === 0) continue;
    const brokenClosest = closestPointOnSegment(px, py, bc.anchorXWorld, bc.anchorYWorld, bc.freeEndXWorld, bc.freeEndYWorld);
    if (brokenClosest.distSq <= chainHitRadiusSq) {
      applyChainDamage(player, cs, world, brokenClosest.xWorld, brokenClosest.yWorld);
      return;
    }
  }
}

function applyChainDamage(
  player: { healthPoints: number; isAliveFlag: 0 | 1; entityId: number; positionXWorld: number; positionYWorld: number; velocityXWorld: number; velocityYWorld: number; isGroundedFlag: 0 | 1; invulnerabilityTicks: number; hurtTicks: number },
  cs: RadiantTetherChainState,
  world: WorldState,
  sourceXWorld: number,
  sourceYWorld: number,
): void {
  // Calculate player's armor from dust particles
  let playerDustCount = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.ownerEntityId[i] === player.entityId && world.isAliveFlag[i] === 1 && world.isTransientFlag[i] === 0) {
      playerDustCount++;
    }
  }
  const armor = Math.floor(playerDustCount / DUST_PARTICLES_PER_ARMOR);

  // Apply damage with armor reduction
  const damage = Math.max(1, RT_CHAIN_DAMAGE - armor);
  applyPlayerDamageWithKnockback(player, damage, sourceXWorld, sourceYWorld);
  cs.playerChainIframeTicks = RT_CHAIN_IFRAMES_TICKS;
}

// ── Beam attack system ──────────────────────────────────────────────────────

/**
 * Begins a new beam attack cycle from the boss toward the player.
 * Picks 3 directions spaced ~120° apart, one aimed near the player.
 * Raycasts each beam to find max length and wall impact data.
 */
export function startBeamAttack(
  cs: RadiantTetherChainState,
  world: WorldState,
  bossXWorld: number, bossYWorld: number,
  playerXWorld: number, playerYWorld: number,
): void {
  cs.attackPhaseTicks = 0;
  cs.attackPhase = 0;

  const dxP = playerXWorld - bossXWorld;
  const dyP = playerYWorld - bossYWorld;
  // Base direction toward player with small random offset (±15°) for fairness
  const baseAngleRad = Math.atan2(dyP, dxP);
  const jitter = (nextFloat(world.rng) - 0.5) * (Math.PI / 6);
  const beam0Angle = baseAngleRad + jitter;
  const twoThirdsPi = (Math.PI * 2) / 3;

  const angles = [
    beam0Angle,
    beam0Angle + twoThirdsPi + (nextFloat(world.rng) - 0.5) * 0.3,
    beam0Angle - twoThirdsPi + (nextFloat(world.rng) - 0.5) * 0.3,
  ];

  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    const mb = cs.mainBeams[i];
    const a = angles[i];
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);

    mb.dirXWorld = dirX;
    mb.dirYWorld = dirY;
    mb.currentLengthWorld = 0;
    mb.hasHitWall = 0;
    mb.isActiveFlag = 1;
    mb.puffProgress = 0;

    const hit = raycastToWallWithNormal(
      world, bossXWorld, bossYWorld, dirX, dirY, RT_MAIN_BEAM_MAX_RANGE_WORLD,
    );
    if (hit !== null) {
      mb.maxLengthWorld = Math.sqrt(
        (hit.xWorld - bossXWorld) * (hit.xWorld - bossXWorld) +
        (hit.yWorld - bossYWorld) * (hit.yWorld - bossYWorld),
      );
      mb.hitXWorld = hit.xWorld;
      mb.hitYWorld = hit.yWorld;
      mb.normalXWorld = hit.normalXWorld;
      mb.normalYWorld = hit.normalYWorld;
    } else {
      mb.maxLengthWorld = RT_MAIN_BEAM_MAX_RANGE_WORLD;
      mb.hitXWorld = bossXWorld + dirX * RT_MAIN_BEAM_MAX_RANGE_WORLD;
      mb.hitYWorld = bossYWorld + dirY * RT_MAIN_BEAM_MAX_RANGE_WORLD;
      mb.normalXWorld = -dirX;
      mb.normalYWorld = -dirY;
    }
  }
}

/**
 * Grows main beams by RT_MAIN_BEAM_GROW_SPEED_WORLD per tick.
 * Returns true when all active beams have reached their walls.
 */
export function tickBeamGrow(
  cs: RadiantTetherChainState,
  bossXWorld: number, bossYWorld: number,
): boolean {
  cs.attackPhaseTicks++;
  let allHit = true;
  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    const mb = cs.mainBeams[i];
    if (mb.isActiveFlag === 0) continue;
    if (mb.hasHitWall === 0) {
      mb.currentLengthWorld += RT_MAIN_BEAM_GROW_SPEED_WORLD;
      if (mb.currentLengthWorld >= mb.maxLengthWorld) {
        mb.currentLengthWorld = mb.maxLengthWorld;
        mb.hasHitWall = 1;
        // Update actual hit point in case the boss drifted
        mb.hitXWorld = bossXWorld + mb.dirXWorld * mb.maxLengthWorld;
        mb.hitYWorld = bossYWorld + mb.dirYWorld * mb.maxLengthWorld;
      } else {
        allHit = false;
      }
    }
  }
  return allHit;
}

/**
 * Launches branch beams from the wall-impact points of all completed main beams.
 * Two branches per main beam, rotated ±RT_BRANCH_BEAM_ANGLE_OFFSET_RAD from the wall normal.
 */
export function startBranchGrow(
  cs: RadiantTetherChainState,
  world: WorldState,
  bossXWorld: number, bossYWorld: number,
): void {
  cs.attackPhaseTicks = 0;
  cs.attackPhase = 1;

  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    const mb = cs.mainBeams[i];
    if (mb.isActiveFlag === 0 || mb.hasHitWall === 0) continue;

    const hitX = bossXWorld + mb.dirXWorld * mb.maxLengthWorld;
    const hitY = bossYWorld + mb.dirYWorld * mb.maxLengthWorld;
    const nx = mb.normalXWorld;
    const ny = mb.normalYWorld;

    for (let b = 0; b < RT_BRANCH_BEAMS_PER_MAIN; b++) {
      const angle = b === 0
        ? -RT_BRANCH_BEAM_ANGLE_OFFSET_RAD
        : RT_BRANCH_BEAM_ANGLE_OFFSET_RAD;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const dirX = nx * cosA - ny * sinA;
      const dirY = nx * sinA + ny * cosA;

      const slotIndex = i * RT_BRANCH_BEAMS_PER_MAIN + b;
      const bb = cs.branchBeams[slotIndex];
      bb.startXWorld = hitX;
      bb.startYWorld = hitY;
      bb.dirXWorld = dirX;
      bb.dirYWorld = dirY;
      bb.currentLengthWorld = 0;
      bb.hasHitWall = 0;
      bb.isActiveFlag = 1;
      bb.isEnergizedFlag = 0;
      bb.energizeTicks = 0;
      bb.isRopeFlag = 0;

      const hit = raycastToWallWithNormal(
        world, hitX, hitY, dirX, dirY, RT_BRANCH_BEAM_MAX_RANGE_WORLD,
      );
      if (hit !== null) {
        bb.maxLengthWorld = Math.sqrt(
          (hit.xWorld - hitX) * (hit.xWorld - hitX) +
          (hit.yWorld - hitY) * (hit.yWorld - hitY),
        );
      } else {
        bb.maxLengthWorld = RT_BRANCH_BEAM_MAX_RANGE_WORLD;
      }
    }
  }
}

/**
 * Grows branch beams by RT_BRANCH_BEAM_GROW_SPEED_WORLD per tick.
 * Returns true when all active branch beams have completed.
 */
export function tickBranchGrow(cs: RadiantTetherChainState): boolean {
  cs.attackPhaseTicks++;
  let allDone = true;
  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0) continue;
    if (bb.hasHitWall === 0) {
      bb.currentLengthWorld += RT_BRANCH_BEAM_GROW_SPEED_WORLD;
      if (bb.currentLengthWorld >= bb.maxLengthWorld) {
        bb.currentLengthWorld = bb.maxLengthWorld;
        bb.hasHitWall = 1;
      } else {
        allDone = false;
      }
    }
  }
  return allDone;
}

/**
 * Marks all branch beams as energized and begins their charge-up countdown.
 * Deactivates all main beams (they flash off in puffs).
 */
export function startEnergizePhase(cs: RadiantTetherChainState): void {
  cs.attackPhaseTicks = 0;
  cs.attackPhase = 2;

  // Deactivate main beams — they disappear with a puff in the renderer
  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    cs.mainBeams[i].puffProgress = 1.0;
    cs.mainBeams[i].isActiveFlag = 0;
  }

  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0) continue;
    bb.isEnergizedFlag = 1;
    bb.energizeTicks = RT_BRANCH_ENERGIZE_DELAY_TICKS;
  }
}

/**
 * Ticks the energize charge-down on each branch beam.
 * Once energizeTicks reaches 0 the beam is fully charged and damage is live.
 */
export function tickEnergizePhase(cs: RadiantTetherChainState): void {
  cs.attackPhaseTicks++;
  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0) continue;
    if (bb.energizeTicks > 0) bb.energizeTicks--;
  }
}

/**
 * Converts all energized branch beams into physics ropes.
 * Each rope is anchored at the branch origin (startXY) with the free end
 * at the beam's current tip position.
 */
export function startRopeDecay(cs: RadiantTetherChainState): void {
  cs.attackPhaseTicks = 0;
  cs.attackPhase = 3;

  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0) continue;
    bb.isRopeFlag = 1;
    bb.isEnergizedFlag = 0;
    bb.ropeAnchorXWorld = bb.startXWorld;
    bb.ropeAnchorYWorld = bb.startYWorld;
    bb.ropeFreeEndXWorld = bb.startXWorld + bb.dirXWorld * bb.currentLengthWorld;
    bb.ropeFreeEndYWorld = bb.startYWorld + bb.dirYWorld * bb.currentLengthWorld;
    bb.ropeFreeEndVelXWorld = 0;
    bb.ropeFreeEndVelYWorld = 0;
    bb.ropeLengthWorld = bb.currentLengthWorld;
    bb.ropeLifetimeTicks = RT_BRANCH_ROPE_LIFETIME_TICKS;
    bb.ropeTotalLifetimeTicks = RT_BRANCH_ROPE_LIFETIME_TICKS;
  }
}

/**
 * Ticks all rope-mode branch beams: gravity, drag, length constraint, lifetime.
 * Returns true when all ropes have expired.
 */
export function tickRopeDecay(cs: RadiantTetherChainState): boolean {
  cs.attackPhaseTicks++;
  let anyAlive = false;
  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isRopeFlag === 0) continue;

    bb.ropeLifetimeTicks--;
    if (bb.ropeLifetimeTicks <= 0) {
      bb.isActiveFlag = 0;
      bb.isRopeFlag = 0;
      continue;
    }
    anyAlive = true;

    // Gravity and drag on free end
    bb.ropeFreeEndVelYWorld += RT_BRANCH_ROPE_GRAVITY_WORLD;
    bb.ropeFreeEndVelXWorld *= RT_BRANCH_ROPE_DRAG;
    bb.ropeFreeEndVelYWorld *= RT_BRANCH_ROPE_DRAG;

    bb.ropeFreeEndXWorld += bb.ropeFreeEndVelXWorld;
    bb.ropeFreeEndYWorld += bb.ropeFreeEndVelYWorld;

    // Pendulum length constraint from anchor
    const dx = bb.ropeFreeEndXWorld - bb.ropeAnchorXWorld;
    const dy = bb.ropeFreeEndYWorld - bb.ropeAnchorYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > bb.ropeLengthWorld && dist > 0.01) {
      const scale = bb.ropeLengthWorld / dist;
      bb.ropeFreeEndXWorld = bb.ropeAnchorXWorld + dx * scale;
      bb.ropeFreeEndYWorld = bb.ropeAnchorYWorld + dy * scale;
      const nx = dx / dist;
      const ny = dy / dist;
      const dot = bb.ropeFreeEndVelXWorld * nx + bb.ropeFreeEndVelYWorld * ny;
      if (dot > 0) {
        bb.ropeFreeEndVelXWorld -= dot * nx;
        bb.ropeFreeEndVelYWorld -= dot * ny;
      }
    }
  }
  return !anyAlive;
}

/**
 * Checks player collision against energized branch beams (after energize delay)
 * and rope-mode branch beams.  Deals RT_BRANCH_DAMAGE with RT_BRANCH_IFRAMES_TICKS.
 */
export function tickBranchPlayerCollision(
  cs: RadiantTetherChainState,
  world: WorldState,
): void {
  if (cs.branchPlayerIframeTicks > 0) {
    cs.branchPlayerIframeTicks--;
    return;
  }

  let player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) {
    for (let i = 0; i < world.clusters.length; i++) {
      const candidate = world.clusters[i];
      if (candidate.isPlayerFlag === 1 && candidate.isAliveFlag === 1) {
        player = candidate;
        break;
      }
    }
  }
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag !== 1) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const playerRadius = Math.max(player.halfWidthWorld, player.halfHeightWorld);
  const hitRadius = RT_BRANCH_HITBOX_HALF_WIDTH_WORLD + playerRadius;
  const hitRadiusSq = hitRadius * hitRadius;

  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;

  // Check energized beams (non-rope)
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isEnergizedFlag === 0 || bb.isRopeFlag === 1) continue;
    if (bb.energizeTicks > 0) continue; // Still charging up

    const endX = bb.startXWorld + bb.dirXWorld * bb.currentLengthWorld;
    const endY = bb.startYWorld + bb.dirYWorld * bb.currentLengthWorld;
    const closest = closestPointOnSegment(px, py, bb.startXWorld, bb.startYWorld, endX, endY);
    if (closest.distSq <= hitRadiusSq) {
      applyBranchDamage(player, cs, world, closest.xWorld, closest.yWorld);
      return;
    }
  }

  // Check rope beams
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    if (bb.isActiveFlag === 0 || bb.isRopeFlag === 0) continue;

    const closest = closestPointOnSegment(
      px, py, bb.ropeAnchorXWorld, bb.ropeAnchorYWorld,
      bb.ropeFreeEndXWorld, bb.ropeFreeEndYWorld,
    );
    if (closest.distSq <= hitRadiusSq) {
      applyBranchDamage(player, cs, world, closest.xWorld, closest.yWorld);
      return;
    }
  }
}

function applyBranchDamage(
  player: { healthPoints: number; isAliveFlag: 0 | 1; entityId: number; positionXWorld: number; positionYWorld: number; velocityXWorld: number; velocityYWorld: number; isGroundedFlag: 0 | 1; invulnerabilityTicks: number; hurtTicks: number },
  cs: RadiantTetherChainState,
  world: WorldState,
  sourceXWorld: number,
  sourceYWorld: number,
): void {
  let playerDustCount = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.ownerEntityId[i] === player.entityId && world.isAliveFlag[i] === 1 && world.isTransientFlag[i] === 0) {
      playerDustCount++;
    }
  }
  const armor = Math.floor(playerDustCount / 4);
  const damage = Math.max(1, RT_BRANCH_DAMAGE - armor);
  applyPlayerDamageWithKnockback(player, damage, sourceXWorld, sourceYWorld);
  cs.branchPlayerIframeTicks = RT_BRANCH_IFRAMES_TICKS;
}

/** Resets all beam and branch beam state for the next attack cycle. */
export function resetAttackState(cs: RadiantTetherChainState): void {
  for (let i = 0; i < RT_MAIN_BEAM_COUNT; i++) {
    const mb = cs.mainBeams[i];
    mb.isActiveFlag = 0;
    mb.hasHitWall = 0;
    mb.currentLengthWorld = 0;
    mb.puffProgress = 0;
  }
  const count = RT_MAIN_BEAM_COUNT * RT_BRANCH_BEAMS_PER_MAIN;
  for (let i = 0; i < count; i++) {
    const bb = cs.branchBeams[i];
    bb.isActiveFlag = 0;
    bb.isEnergizedFlag = 0;
    bb.isRopeFlag = 0;
    bb.hasHitWall = 0;
    bb.currentLengthWorld = 0;
    bb.energizeTicks = 0;
    bb.ropeLifetimeTicks = 0;
  }
  cs.attackPhaseTicks = 0;
  cs.attackPhase = 0;
  cs.branchPlayerIframeTicks = 0;
}

// ── Chain count from health ─────────────────────────────────────────────────

export function getChainCountForHealth(
  healthPoints: number,
  maxHealthPoints: number,
  thresholds: readonly number[],
  minChains: number,
  maxChains: number,
): number {
  if (maxHealthPoints <= 0) return minChains;
  const ratio = healthPoints / maxHealthPoints;
  // Thresholds are descending (e.g., [0.85, 0.70, 0.55, 0.40, 0.25]).
  // Each threshold crossed below adds one chain.
  // ratio=0.90 → 3 chains, ratio=0.60 → 5 chains, ratio=0.10 → 8 chains.
  let count = minChains;
  for (let i = 0; i < thresholds.length; i++) {
    if (ratio < thresholds[i]) {
      count = minChains + 1 + i;
    } else {
      break;
    }
  }
  if (count > maxChains) count = maxChains;
  return count;
}
