/**
 * Web Spider AI — a spider-like enemy that fires white web lines into nearby
 * terrain, swings toward the player, detaches, and repeats.
 *
 * State machine:
 *   0 = SEEK        — falling/drifting, searching for a wall anchor
 *   1 = SWINGING    — attached to anchor, swinging on rope constraint
 *   2 = COOLDOWN    — brief pause after detaching before next web attempt
 *
 * Tuning constants are exported so level designers can override defaults.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import { raycastWalls } from './grappleShared';
import { resolveClusterSolidWallCollision } from './movementCollision';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Half-size (radius) of the spider body hitbox (world units). */
export const WEB_SPIDER_HALF_SIZE_WORLD = 4.0;

/** Detection radius — spider only activates when player is within this range (world units). */
export const WEB_SPIDER_DETECTION_RADIUS_WORLD = 120.0;

/** Maximum radius the spider searches for wall anchor candidates (world units). */
export const WEB_SPIDER_ANCHOR_SEARCH_RADIUS_WORLD = 64.0;

/** Minimum useful web length — anchors closer than this are ignored (world units). */
export const WEB_SPIDER_WEB_MIN_LENGTH_WORLD = 12.0;

/** Maximum preferred web length. Anchors farther than this are skipped (world units). */
export const WEB_SPIDER_WEB_MAX_LENGTH_WORLD = 60.0;

/** How many ticks the spider stays attached before force-detaching (ticks). */
export const WEB_SPIDER_MAX_SWING_TICKS = 150;

/** Cooldown ticks after detaching before the spider fires another web. */
export const WEB_SPIDER_DETACH_COOLDOWN_TICKS = 35;

/** How often (ticks) the spider re-runs the anchor search while in SEEK state. */
export const WEB_SPIDER_ANCHOR_SEARCH_INTERVAL_TICKS = 18;

/** Gravity applied in SEEK and COOLDOWN states (world units/sec²). */
export const WEB_SPIDER_GRAVITY_WORLD_PER_SEC2 = 300.0;

/** Terminal fall speed cap in SEEK/COOLDOWN (world units/sec). */
export const WEB_SPIDER_FALL_CAP_WORLD_PER_SEC = 200.0;

/** Max horizontal drift speed toward player in SEEK fallback (world units/sec). */
export const WEB_SPIDER_SEEK_DRIFT_SPEED_WORLD_PER_SEC = 45.0;

/** Acceleration toward player drift (world units/sec²). */
export const WEB_SPIDER_SEEK_ACCEL_WORLD_PER_SEC2 = 120.0;

/** Tangential pull force toward player while swinging (world units/sec²). */
export const WEB_SPIDER_SWING_PULL_WORLD_PER_SEC2 = 60.0;

/** Absolute max speed clamp in all states (world units/sec). */
export const WEB_SPIDER_MAX_SPEED_WORLD_PER_SEC = 220.0;

/** Ticks a fading web remnant remains visible before disappearing. */
export const WEB_SPIDER_WEB_FADE_TICKS = 90;

// ── State constants ───────────────────────────────────────────────────────────

export const WEB_SPIDER_STATE_SEEK     = 0;
export const WEB_SPIDER_STATE_SWINGING = 1;
export const WEB_SPIDER_STATE_COOLDOWN = 2;

// ── Anchor candidate sampling ─────────────────────────────────────────────────

/**
 * Attempts to find a good wall-surface anchor point the spider can attach to.
 * Casts rays to candidate surface points on nearby walls, prefers anchors
 * that are above or to the side and help move toward the player.
 * Returns true and sets out parameters if a candidate is found, else false.
 */
function findWebAnchor(
  world: WorldState,
  spider: ClusterState,
  playerPosXWorld: number,
  playerPosYWorld: number,
  outAnchor: { x: number; y: number },
): boolean {
  const sx = spider.positionXWorld;
  const sy = spider.positionYWorld;
  const dxToPlayer = playerPosXWorld - sx;
  const dyToPlayer = playerPosYWorld - sy;

  let bestScore = -Infinity;
  let bestX = 0;
  let bestY = 0;
  let found = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // Skip invisible, platform, and ramp walls (not suitable anchor surfaces)
    if (world.wallIsInvisibleFlag[wi] === 1) continue;
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    const ww = world.wallWWorld[wi];
    const wh = world.wallHWorld[wi];

    // Sample up to 6 candidate anchor points on the wall surface edges:
    // top-center, bottom-center, left-center, right-center, top-left-quarter, top-right-quarter
    _candidateAnchors[0][0] = wx + ww * 0.5;  _candidateAnchors[0][1] = wy;
    _candidateAnchors[1][0] = wx + ww * 0.5;  _candidateAnchors[1][1] = wy + wh;
    _candidateAnchors[2][0] = wx;              _candidateAnchors[2][1] = wy + wh * 0.5;
    _candidateAnchors[3][0] = wx + ww;         _candidateAnchors[3][1] = wy + wh * 0.5;
    _candidateAnchors[4][0] = wx + ww * 0.25;  _candidateAnchors[4][1] = wy;
    _candidateAnchors[5][0] = wx + ww * 0.75;  _candidateAnchors[5][1] = wy;

    for (let ci = 0; ci < _candidateAnchors.length; ci++) {
      const cx = _candidateAnchors[ci][0];
      const cy = _candidateAnchors[ci][1];
      const dx = cx - sx;
      const dy = cy - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < WEB_SPIDER_WEB_MIN_LENGTH_WORLD || dist > WEB_SPIDER_ANCHOR_SEARCH_RADIUS_WORLD) continue;

      // Line-of-sight check: raycast from spider to candidate
      const invDist = 1.0 / dist;
      const hit = raycastWalls(world, sx, sy, dx * invDist, dy * invDist, dist + 1.0);
      // Valid if the hit is ON the target wall (same index) at approximately dist
      if (hit === null) continue; // ray missed all walls — candidate is in empty space
      if (hit.wallIndex !== wi) continue; // a different wall blocked the path

      // Score: prefer anchors that are above/to-the-side and move toward player
      // Higher Y = lower on screen (Y-down coordinate system), so cy < sy means ABOVE
      const aboveBonus    = cy < sy ? 30.0 : 0.0;
      const sideBonus     = Math.abs(cx - sx) > 8.0 ? 15.0 : 0.0;
      const playerDotScore = (dx * dxToPlayer + dy * dyToPlayer) / (dist + 1.0);
      const score = aboveBonus + sideBonus + playerDotScore * 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestX = cx;
        bestY = cy;
        found = true;
      }
    }
  }

  if (found) {
    outAnchor.x = bestX;
    outAnchor.y = bestY;
  }
  return found;
}

// ── Per-spider fading-web helpers ─────────────────────────────────────────────

/** Pushes a new fading web remnant into the world's fading-web ring buffer. */
function addFadingWeb(
  world: WorldState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  const maxWebs = world.webSpiderFadingWebMaxCount;
  if (maxWebs === 0) return;
  const slot = world.webSpiderFadingWebWriteIndex % maxWebs;
  world.webSpiderFadingWebFromXWorld[slot] = fromX;
  world.webSpiderFadingWebFromYWorld[slot] = fromY;
  world.webSpiderFadingWebToXWorld[slot] = toX;
  world.webSpiderFadingWebToYWorld[slot] = toY;
  world.webSpiderFadingWebRemainingTicks[slot] = WEB_SPIDER_WEB_FADE_TICKS;
  world.webSpiderFadingWebMaxTicks[slot] = WEB_SPIDER_WEB_FADE_TICKS;
  world.webSpiderFadingWebWriteIndex = (slot + 1) % maxWebs;
  // Extend active count up to maxWebs
  if (world.webSpiderFadingWebActiveCount < maxWebs) {
    world.webSpiderFadingWebActiveCount++;
  }
}

// ── Rope swing constraint ─────────────────────────────────────────────────────

/**
 * Applies the pendulum rope constraint: if the spider is farther from the anchor
 * than `ropeLength`, snap it back to the rope circle and remove the outward
 * radial velocity component.
 */
function applyRopeConstraint(spider: ClusterState, anchorX: number, anchorY: number, ropeLength: number): void {
  const dx = spider.positionXWorld - anchorX;
  const dy = spider.positionYWorld - anchorY;
  const distSq = dx * dx + dy * dy;
  if (distSq <= ropeLength * ropeLength + 0.01) return;

  const dist = Math.sqrt(distSq);
  const nx = dx / dist; // outward unit vector
  const ny = dy / dist;

  // Snap position back to rope circle
  spider.positionXWorld = anchorX + nx * ropeLength;
  spider.positionYWorld = anchorY + ny * ropeLength;

  // Remove the outward radial velocity component (keep tangential)
  const radialVel = spider.velocityXWorld * nx + spider.velocityYWorld * ny;
  if (radialVel > 0) {
    spider.velocityXWorld -= radialVel * nx;
    spider.velocityYWorld -= radialVel * ny;
  }
}

// ── Main per-spider tick ──────────────────────────────────────────────────────

/** Pre-allocated candidate anchor points (6 × [x, y]) to avoid hot-path allocation. */
const _candidateAnchors: Array<[number, number]> = [
  [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0],
];

const scratchAnchorOut = { x: 0, y: 0 };

function tickSingleWebSpider(
  world: WorldState,
  spider: ClusterState,
  dtSec: number,
  playerPosXWorld: number,
  playerPosYWorld: number,
): void {
  spider.webSpiderStateTicks++;

  const state = spider.webSpiderState;

  // Capture previous position for wall collision resolver
  const prevX = spider.positionXWorld;
  const prevY = spider.positionYWorld;
  const wasGrounded = spider.isGroundedFlag === 1;

  // ── Gravity always applies (except when swinging at anchor, handled below) ──
  if (state !== WEB_SPIDER_STATE_SWINGING) {
    spider.velocityYWorld += WEB_SPIDER_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (spider.velocityYWorld > WEB_SPIDER_FALL_CAP_WORLD_PER_SEC) {
      spider.velocityYWorld = WEB_SPIDER_FALL_CAP_WORLD_PER_SEC;
    }
  }

  if (state === WEB_SPIDER_STATE_SEEK) {
    // ── SEEK: drift toward player, periodically search for an anchor ──────────

    // Horizontal drift toward player
    const dxToPlayer = playerPosXWorld - spider.positionXWorld;
    const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;
    const targetVelX = absDx > 6.0
      ? (dxToPlayer > 0 ? 1 : -1) * WEB_SPIDER_SEEK_DRIFT_SPEED_WORLD_PER_SEC
      : 0.0;
    const accelAlpha = Math.min(1.0, WEB_SPIDER_SEEK_ACCEL_WORLD_PER_SEC2 * dtSec / WEB_SPIDER_SEEK_DRIFT_SPEED_WORLD_PER_SEC);
    spider.velocityXWorld += (targetVelX - spider.velocityXWorld) * accelAlpha;

    // Periodically search for a web anchor
    spider.webSpiderAnchorSearchTicks--;
    if (spider.webSpiderAnchorSearchTicks <= 0) {
      spider.webSpiderAnchorSearchTicks = WEB_SPIDER_ANCHOR_SEARCH_INTERVAL_TICKS;
      if (findWebAnchor(world, spider, playerPosXWorld, playerPosYWorld, scratchAnchorOut)) {
        // Attach!
        spider.webSpiderAnchorXWorld = scratchAnchorOut.x;
        spider.webSpiderAnchorYWorld = scratchAnchorOut.y;
        const dx = spider.positionXWorld - scratchAnchorOut.x;
        const dy = spider.positionYWorld - scratchAnchorOut.y;
        spider.webSpiderRopeLengthWorld = Math.sqrt(dx * dx + dy * dy);
        spider.webSpiderState = WEB_SPIDER_STATE_SWINGING;
        spider.webSpiderStateTicks = 0;
      }
    }

  } else if (state === WEB_SPIDER_STATE_SWINGING) {
    // ── SWINGING: rope constraint + gravity + pull toward player ──────────────

    const ax = spider.webSpiderAnchorXWorld;
    const ay = spider.webSpiderAnchorYWorld;

    // Gravity
    spider.velocityYWorld += WEB_SPIDER_GRAVITY_WORLD_PER_SEC2 * dtSec;

    // Tangential pull toward player: compute tangent direction, add impulse
    const dx = spider.positionXWorld - ax;
    const dy = spider.positionYWorld - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0.5) {
      const nx = dx / dist;
      const ny = dy / dist;
      // Project player direction onto tangent plane (perpendicular to rope normal)
      const dxToPlayer = playerPosXWorld - spider.positionXWorld;
      const dyToPlayer = playerPosYWorld - spider.positionYWorld;
      const dot = dxToPlayer * nx + dyToPlayer * ny;
      const tangX = dxToPlayer - dot * nx;
      const tangY = dyToPlayer - dot * ny;
      const tangLen = Math.sqrt(tangX * tangX + tangY * tangY);
      if (tangLen > 0.5) {
        const tangNX = tangX / tangLen;
        const tangNY = tangY / tangLen;
        spider.velocityXWorld += tangNX * WEB_SPIDER_SWING_PULL_WORLD_PER_SEC2 * dtSec;
        spider.velocityYWorld += tangNY * WEB_SPIDER_SWING_PULL_WORLD_PER_SEC2 * dtSec;
      }
    }

    // Apply rope constraint
    applyRopeConstraint(spider, ax, ay, spider.webSpiderRopeLengthWorld);

    // Detach conditions
    const dxToPlayer2 = playerPosXWorld - spider.positionXWorld;
    const dyToPlayer2 = playerPosYWorld - spider.positionYWorld;
    const distToPlayer = Math.sqrt(dxToPlayer2 * dxToPlayer2 + dyToPlayer2 * dyToPlayer2);
    const tooLong = spider.webSpiderStateTicks >= WEB_SPIDER_MAX_SWING_TICKS;
    const closeToPlayer = distToPlayer < 12.0;
    if (tooLong || closeToPlayer) {
      // Add fading web remnant
      addFadingWeb(
        world,
        spider.positionXWorld, spider.positionYWorld,
        spider.webSpiderAnchorXWorld, spider.webSpiderAnchorYWorld,
      );
      spider.webSpiderState = WEB_SPIDER_STATE_COOLDOWN;
      spider.webSpiderStateTicks = 0;
      spider.webSpiderCooldownTicks = WEB_SPIDER_DETACH_COOLDOWN_TICKS;
    }

  } else if (state === WEB_SPIDER_STATE_COOLDOWN) {
    // ── COOLDOWN: wait, then transition to SEEK ───────────────────────────────
    spider.webSpiderCooldownTicks--;
    if (spider.webSpiderCooldownTicks <= 0) {
      spider.webSpiderState = WEB_SPIDER_STATE_SEEK;
      spider.webSpiderStateTicks = 0;
      spider.webSpiderAnchorSearchTicks = 0; // search immediately
    }
  }

  // ── Clamp velocity ────────────────────────────────────────────────────────
  const speed = Math.sqrt(
    spider.velocityXWorld * spider.velocityXWorld +
    spider.velocityYWorld * spider.velocityYWorld,
  );
  if (speed > WEB_SPIDER_MAX_SPEED_WORLD_PER_SEC) {
    const inv = WEB_SPIDER_MAX_SPEED_WORLD_PER_SEC / speed;
    spider.velocityXWorld *= inv;
    spider.velocityYWorld *= inv;
  }

  // ── Wall collision ────────────────────────────────────────────────────────
  spider.positionXWorld += spider.velocityXWorld * dtSec;
  spider.positionYWorld += spider.velocityYWorld * dtSec;
  resolveClusterSolidWallCollision(spider, world, prevX, prevY, dtSec, wasGrounded);

  // If swinging, re-apply rope constraint after wall resolution
  if (spider.webSpiderState === WEB_SPIDER_STATE_SWINGING) {
    applyRopeConstraint(
      spider,
      spider.webSpiderAnchorXWorld,
      spider.webSpiderAnchorYWorld,
      spider.webSpiderRopeLengthWorld,
    );
  }
}

// ── Fading web tick ───────────────────────────────────────────────────────────

/** Decrements all fading web timers each tick; marks expired slots by setting remainingTicks to 0. */
function tickFadingWebs(world: WorldState): void {
  const max = world.webSpiderFadingWebMaxCount;
  if (max === 0) return;
  for (let i = 0; i < max; i++) {
    if (world.webSpiderFadingWebRemainingTicks[i] > 0) {
      world.webSpiderFadingWebRemainingTicks[i]--;
    }
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Ticks all web spider clusters.  Called from tick.ts in the enemy AI pass.
 */
export function applyWebSpiderAI(world: WorldState): void {
  // Find player
  let playerPosXWorld = 0;
  let playerPosYWorld = 0;
  let hasPlayer = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerPosXWorld = c.positionXWorld;
      playerPosYWorld = c.positionYWorld;
      hasPlayer = true;
      break;
    }
  }

  const dtMs  = world.dtMs;
  const dtSec = dtMs / 1000.0;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const spider = world.clusters[ci];
    if (spider.isWebSpiderFlag !== 1 || spider.isAliveFlag === 0) continue;

    if (!hasPlayer) continue;

    // Only activate when player is within detection radius
    const dxToPlayer = playerPosXWorld - spider.positionXWorld;
    const dyToPlayer = playerPosYWorld - spider.positionYWorld;
    const distSq = dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer;
    const detectionSq = WEB_SPIDER_DETECTION_RADIUS_WORLD * WEB_SPIDER_DETECTION_RADIUS_WORLD;
    if (distSq > detectionSq) {
      // Outside detection range — just apply gravity and drift
      const prevX = spider.positionXWorld;
      const prevY = spider.positionYWorld;
      const wasGrounded = spider.isGroundedFlag === 1;
      spider.velocityYWorld += WEB_SPIDER_GRAVITY_WORLD_PER_SEC2 * dtSec;
      if (spider.velocityYWorld > WEB_SPIDER_FALL_CAP_WORLD_PER_SEC) {
        spider.velocityYWorld = WEB_SPIDER_FALL_CAP_WORLD_PER_SEC;
      }
      spider.positionXWorld += spider.velocityXWorld * dtSec;
      spider.positionYWorld += spider.velocityYWorld * dtSec;
      resolveClusterSolidWallCollision(spider, world, prevX, prevY, dtSec, wasGrounded);
      continue;
    }

    tickSingleWebSpider(world, spider, dtSec, playerPosXWorld, playerPosYWorld);
  }

  tickFadingWebs(world);
}
