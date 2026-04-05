/**
 * Radiant Tether — chain system.
 *
 * Manages the lifecycle of light-chains: raycasting to find anchor points,
 * storing per-chain state, detecting opposing-chain snaps, and producing
 * broken-chain segments that swing from walls.
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
} from './radiantTetherConfig';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

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
  return {
    chains,
    brokenChains,
    playerChainIframeTicks: 0,
    bossEntityId: -1,
    bossLastHealthPoints: 0,
    hasBossTakenDamageFlag: 0,
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
  let px = bossXWorld + vx;
  let py = bossYWorld + vy;

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
  player: { healthPoints: number; isAliveFlag: 0 | 1; entityId: number; positionXWorld: number; positionYWorld: number; velocityXWorld: number; velocityYWorld: number; isGroundedFlag: 0 | 1 },
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

/** Closest point on segment AB to point P, with squared distance. */
function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { xWorld: number; yWorld: number; distSq: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 0.001) {
    return {
      xWorld: ax,
      yWorld: ay,
      distSq: apx * apx + apy * apy,
    };
  }
  let t = (apx * abx + apy * aby) / abLenSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const xWorld = ax + t * abx;
  const yWorld = ay + t * aby;
  const dx = px - xWorld;
  const dy = py - yWorld;
  return {
    xWorld,
    yWorld,
    distSq: dx * dx + dy * dy,
  };
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
