/**
 * Bow Weave — actual-mote arrow assembly (replaces the old charge-strength /
 * queued-mote / phantom-arrow system).
 *
 * The Bow Weave loads the player's REAL mote particles into a straight arrow
 * line and fires them together as a constant-speed straight projectile. There
 * is no draw strength, no parabolic preview, no ballistic arc, and no separate
 * ammunition queue — every arrow mote is an actual player mote temporarily in a
 * projectile state, and it is never permanently removed from the inventory.
 *
 * Timing (measured from when the Shield Weave began, NOT from the input press):
 *   • t=0.00 s — one center mote occupies the arrow center; the straight
 *     trajectory line extends outward along the aim.
 *   • t=0.75 s — the two shield motes farthest from center arc into the arrow,
 *     forming a straight 3-mote line (behind · center · front).
 *   • t=1.25 s — a fourth mote (if available) arcs in → 4-mote arrow.
 *   • t=1.75 s — a fifth mote (if available) arcs in → 5-mote arrow (max).
 *   Minimum valid arrow = 3 motes; below 3 total motes the bow does not
 *   assemble and the Shield Weave behaves normally.
 *
 * State ownership: an arrow mote is marked BEHAVIOR_MODE_BOW_ARROW, so normal
 * integration + binding skip it and the Shield crescent excludes it (a mote is
 * never simultaneously a shield-slot mote and an arrow mote). On launch
 * resolution (wall bounce or max-distance curve-home) each mote is handed back
 * to behaviorMode 0 with an initial velocity, so the standard Storm pursuit
 * gradually reclaims it — there is no separate owned "returning" phase.
 *
 * Gold Dust (the default) supplies the projectile baseline via
 * `moteTypeConfig.ts`: 250 px/s outbound speed (constant, independent of load
 * duration) and 250 px maximum outbound travel.
 */

import { WorldState, MAX_BOW_ARROW_MOTES, MIN_BOW_ARROW_MOTES } from '../world';
import { ClusterState } from '../clusters/state';
import { getAvailableOrderedMoteSlots } from '../motes/orderedMoteQueue';
import { getMoteTypeProjectile } from '../motes/moteTypeConfig';
import { BEHAVIOR_MODE_BOW_ARROW } from '../particles/bowArrowBehaviorMode';
import { raycastWalls } from '../clusters/grappleShared';
import { nextFloatRange } from '../rng';

// ── Phases ───────────────────────────────────────────────────────────────────
export const BOW_ARROW_PHASE_NONE       = 0;
export const BOW_ARROW_PHASE_ASSEMBLING = 1;
export const BOW_ARROW_PHASE_OUTBOUND   = 2;

// ── Timing (ticks at 60 fps, measured from Shield Weave start) ────────────────
export const BOW_ARROW_LOAD_3_TICKS = 45;  // 0.75 s → 3 motes
export const BOW_ARROW_LOAD_4_TICKS = 75;  // 1.25 s → 4 motes
export const BOW_ARROW_LOAD_5_TICKS = 105; // 1.75 s → 5 motes

/** Ticks each pulled mote spends arcing from its shield slot into the line. */
const BOW_ARROW_ARC_TICKS = 12;
/** World-space spacing between adjacent motes along the arrow line. */
export const BOW_ARROW_MOTE_SPACING_WORLD = 3.0;
/** How far (world units) the arc control point bulges away from the player before curving back. */
const BOW_ARROW_ARC_BULGE_WORLD = 10.0;

/** Max angular deviation (radians) added to a wall reflection before biasing toward the true angle. */
const BOW_ARROW_REFLECT_MAX_DEVIATION_RAD = 0.45;
/** Speed retained (fraction of outbound speed) as the initial return motion. */
const BOW_ARROW_RETURN_SPEED_FACTOR = 0.85;
/** Base outward angle (radians) for the max-distance curve-home, before randomization. */
const BOW_ARROW_CURVE_HOME_BASE_RAD = 0.6;
const BOW_ARROW_CURVE_HOME_JITTER_RAD = 0.35;
/** Small backoff (world units) from a wall hit point so motes never embed in terrain. */
const BOW_ARROW_WALL_BACKOFF_WORLD = 0.75;

// ── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Signed line offset (in spacing units) for the mote at center-out rank `r`:
 * 0 → 0 (center), 1 → −1 (behind), 2 → +1 (front), 3 → −2, 4 → +2.
 */
export function bowArrowRankLineOffset(rank: number): number {
  if (rank === 0) return 0;
  const step = Math.ceil(rank / 2);
  return rank % 2 === 1 ? -step : step;
}

function _findPlayer(world: WorldState): ClusterState | null {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) return c;
  }
  return null;
}

/** True when the given particle is currently reserved as a bow arrow mote. */
function _isReserved(world: WorldState, pidx: number): boolean {
  for (let r = 0; r < world.bowArrowCount; r++) {
    if (world.bowArrowParticleIndex[r] === pidx) return true;
  }
  return false;
}

// ── Assembly lifecycle ───────────────────────────────────────────────────────

/**
 * Begins arrow assembly when the Shield Weave first forms with the Bow unlocked.
 * Reserves ONE center mote (the first available queue slot's particle) at the
 * shield center. No-op (returns false, shield behaves normally) when fewer than
 * the minimum three total motes are available — the center mote does not count
 * toward the requirement that the player have two more usable motes.
 */
export function beginBowArrowAssembly(
  world: WorldState,
  shieldStartTick: number,
  gestureId: number,
): boolean {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_NONE) return true; // already assembling
  const available = getAvailableOrderedMoteSlots(world);
  if (available.count < MIN_BOW_ARROW_MOTES) return false;

  const centerSlot = available.indices[0];
  const centerPidx = world.moteSlotParticleIndex[centerSlot];
  if (centerPidx < 0 || centerPidx >= world.particleCount || world.isAliveFlag[centerPidx] === 0) {
    return false;
  }

  world.bowArrowPhase           = BOW_ARROW_PHASE_ASSEMBLING;
  world.bowArrowGestureId       = gestureId;
  world.bowArrowShieldStartTick = shieldStartTick;
  world.bowArrowCount           = 1;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
  world.bowArrowParticleIndex[0] = centerPidx;
  world.bowArrowSlotStartTick[0] = world.tick;
  world.bowArrowArcFromXWorld[0] = world.positionXWorld[centerPidx];
  world.bowArrowArcFromYWorld[0] = world.positionYWorld[centerPidx];
  world.bowArrowArcCtrlXWorld[0] = world.positionXWorld[centerPidx];
  world.bowArrowArcCtrlYWorld[0] = world.positionYWorld[centerPidx];
  world.behaviorMode[centerPidx] = BEHAVIOR_MODE_BOW_ARROW;
  world.bowArrowTravelPx = 0;
  return true;
}

/**
 * Picks the available (non-reserved, alive) player mote particle whose current
 * position is farthest from `cx,cy`. Returns the particle index or −1.
 */
function _pickFarthestAvailableMote(world: WorldState, cx: number, cy: number): number {
  const available = getAvailableOrderedMoteSlots(world);
  let bestPidx = -1;
  let bestDistSq = -1;
  for (let k = 0; k < available.count; k++) {
    const pidx = world.moteSlotParticleIndex[available.indices[k]];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.isAliveFlag[pidx] === 0) continue;
    if (_isReserved(world, pidx)) continue;
    const dx = world.positionXWorld[pidx] - cx;
    const dy = world.positionYWorld[pidx] - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestDistSq) { bestDistSq = d2; bestPidx = pidx; }
  }
  return bestPidx;
}

/** Reserves one additional mote into the arrow at the next center-out rank. */
function _reserveNextMote(world: WorldState, centerX: number, centerY: number, playerX: number, playerY: number): void {
  const rank = world.bowArrowCount;
  if (rank >= MAX_BOW_ARROW_MOTES) return;
  const pidx = _pickFarthestAvailableMote(world, centerX, centerY);
  if (pidx === -1) return;

  world.bowArrowParticleIndex[rank] = pidx;
  world.bowArrowSlotStartTick[rank] = world.tick;
  world.bowArrowArcFromXWorld[rank] = world.positionXWorld[pidx];
  world.bowArrowArcFromYWorld[rank] = world.positionYWorld[pidx];
  // Control point bulges away from the player so the mote arcs out then curves back.
  const awayX = world.positionXWorld[pidx] - playerX;
  const awayY = world.positionYWorld[pidx] - playerY;
  const awayLen = Math.hypot(awayX, awayY) || 1;
  world.bowArrowArcCtrlXWorld[rank] = world.positionXWorld[pidx] + (awayX / awayLen) * BOW_ARROW_ARC_BULGE_WORLD;
  world.bowArrowArcCtrlYWorld[rank] = world.positionYWorld[pidx] + (awayY / awayLen) * BOW_ARROW_ARC_BULGE_WORLD;
  world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
  world.bowArrowCount++;
}

/**
 * Advances arrow assembly one tick while the bow is held. Updates the firing
 * direction from the current aim (so the arrow rotates smoothly with the aim
 * line without re-running the load timers), loads motes as schedule thresholds
 * are crossed, and drives each mote toward its seated line position (arcing in
 * for freshly-pulled motes). Safe to call every held tick.
 */
export function tickBowArrowAssembly(
  world: WorldState,
  aimDirXWorld: number,
  aimDirYWorld: number,
): void {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) return;
  const player = _findPlayer(world);
  if (player === null) return;

  const aimLen = Math.hypot(aimDirXWorld, aimDirYWorld);
  const dirX = aimLen > 1e-6 ? aimDirXWorld / aimLen : world.bowArrowDirXWorld;
  const dirY = aimLen > 1e-6 ? aimDirYWorld / aimLen : world.bowArrowDirYWorld;
  world.bowArrowDirXWorld = dirX;
  world.bowArrowDirYWorld = dirY;

  const centerX = player.positionXWorld;
  const centerY = player.positionYWorld;

  // ── Load schedule (thresholds measured from Shield start) ─────────────────
  const elapsed = world.tick - world.bowArrowShieldStartTick;
  let targetCount = 1;
  if (elapsed >= BOW_ARROW_LOAD_5_TICKS) targetCount = 5;
  else if (elapsed >= BOW_ARROW_LOAD_4_TICKS) targetCount = 4;
  else if (elapsed >= BOW_ARROW_LOAD_3_TICKS) targetCount = 3;
  targetCount = Math.min(targetCount, MAX_BOW_ARROW_MOTES);

  // At the 0.75 s threshold two motes appear together (→ 3); afterwards one at a time.
  while (world.bowArrowCount < targetCount) {
    const before = world.bowArrowCount;
    _reserveNextMote(world, centerX, centerY, centerX, centerY);
    if (world.bowArrowCount === before) break; // no more available motes to pull
  }

  // ── Drive each reserved mote toward its seated line position ──────────────
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount || world.isAliveFlag[pidx] === 0) continue;

    const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
    const seatX = centerX + dirX * offset;
    const seatY = centerY + dirY * offset;

    const arcElapsed = world.tick - world.bowArrowSlotStartTick[r];
    if (arcElapsed >= BOW_ARROW_ARC_TICKS) {
      // Seated: track the line exactly (rotates with aim, follows the player).
      world.positionXWorld[pidx] = seatX;
      world.positionYWorld[pidx] = seatY;
      world.velocityXWorld[pidx] = 0;
      world.velocityYWorld[pidx] = 0;
    } else {
      // Arc in: quadratic bezier from the mote's shield slot, bulging outward,
      // to its seated line position.
      const t = Math.max(0, arcElapsed) / BOW_ARROW_ARC_TICKS;
      const mt = 1 - t;
      const p0x = world.bowArrowArcFromXWorld[r];
      const p0y = world.bowArrowArcFromYWorld[r];
      const p1x = world.bowArrowArcCtrlXWorld[r];
      const p1y = world.bowArrowArcCtrlYWorld[r];
      world.positionXWorld[pidx] = mt * mt * p0x + 2 * mt * t * p1x + t * t * seatX;
      world.positionYWorld[pidx] = mt * mt * p0y + 2 * mt * t * p1y + t * t * seatY;
    }
    world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
  }
}

/**
 * Fires the assembled arrow along `aimDir` when at least the minimum three
 * motes are loaded. Snaps all motes exactly onto the straight line at the
 * player center so they launch as a coherent group, captures the projectile
 * dust kind, and transitions to the outbound phase. Returns false (and leaves
 * the arrow assembling) when fewer than three motes are loaded.
 */
export function fireBowArrow(world: WorldState, aimDirXWorld: number, aimDirYWorld: number): boolean {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) return false;
  if (world.bowArrowCount < MIN_BOW_ARROW_MOTES) return false;
  const player = _findPlayer(world);
  if (player === null) return false;

  const aimLen = Math.hypot(aimDirXWorld, aimDirYWorld);
  const dirX = aimLen > 1e-6 ? aimDirXWorld / aimLen : world.bowArrowDirXWorld;
  const dirY = aimLen > 1e-6 ? aimDirYWorld / aimLen : world.bowArrowDirYWorld;

  world.bowArrowDirXWorld  = dirX;
  world.bowArrowDirYWorld  = dirY;
  world.bowArrowOriginXWorld = player.positionXWorld;
  world.bowArrowOriginYWorld = player.positionYWorld;
  world.bowArrowTravelPx   = 0;

  // Capture dust kind from the center mote's slot (first available at fire time).
  const centerPidx = world.bowArrowParticleIndex[0];
  world.bowArrowDustKind = centerPidx >= 0 ? world.kindBuffer[centerPidx] : 0;

  // Snap the whole line onto the straight firing vector at the origin.
  _placeArrowLine(world, world.bowArrowOriginXWorld, world.bowArrowOriginYWorld, dirX, dirY);

  world.bowArrowPhase = BOW_ARROW_PHASE_OUTBOUND;
  return true;
}

/** Places every reserved mote onto the straight line centered at (cx,cy). */
function _placeArrowLine(world: WorldState, cx: number, cy: number, dirX: number, dirY: number): void {
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
    world.positionXWorld[pidx] = cx + dirX * offset;
    world.positionYWorld[pidx] = cy + dirY * offset;
    world.velocityXWorld[pidx] = 0;
    world.velocityYWorld[pidx] = 0;
    world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
  }
}

// ── Outbound flight ──────────────────────────────────────────────────────────

/** Largest positive line offset (front mote), in world units, for collision leading edge. */
function _frontOffsetWorld(world: WorldState): number {
  let maxOff = 0;
  for (let r = 0; r < world.bowArrowCount; r++) {
    const off = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
    if (off > maxOff) maxOff = off;
  }
  return maxOff;
}

/**
 * Advances the outbound arrow one tick. The whole arrow is treated as one
 * coherent group: only the LEADING mote's swept segment is tested against
 * terrain, so the group bounces/returns exactly once per collision rather than
 * each mote detecting the same wall on successive frames. Travel distance is
 * accumulated from displacement (robust to pauses / variable steps). Returns
 * true when the arrow has resolved this tick (bounced or curved home).
 */
export function tickBowArrowOutbound(world: WorldState): boolean {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_OUTBOUND) return false;

  const proj = getMoteTypeProjectile(world.bowArrowDustKind);
  const dtSec = world.dtMs / 1000.0;
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;

  let stepDist = proj.outboundSpeedPxPerSec * dtSec;
  // Clamp the final step so travel ends exactly at the max distance.
  const remaining = proj.maxTravelPx - world.bowArrowTravelPx;
  const reachedMax = stepDist >= remaining;
  if (reachedMax) stepDist = Math.max(0, remaining);

  // Leading-mote swept collision against terrain over this tick's step.
  const frontOff = _frontOffsetWorld(world);
  const centerX = world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx;
  const centerY = world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx;
  const frontX = centerX + dirX * frontOff;
  const frontY = centerY + dirY * frontOff;

  const hit = stepDist > 1e-6 ? raycastWalls(world, frontX, frontY, dirX, dirY, stepDist) : null;
  if (hit !== null) {
    _resolveBounce(world, hit.normalX, hit.normalY, hit.t);
    return true;
  }

  // No wall: advance the group.
  world.bowArrowTravelPx += stepDist;
  _placeArrowLine(world, world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx,
    world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx, dirX, dirY);

  if (reachedMax) {
    _resolveCurveHome(world);
    return true;
  }
  return false;
}

/** Reflects the group off a wall (biased-random) and releases motes to Storm. */
function _resolveBounce(world: WorldState, normalX: number, normalY: number, hitT: number): void {
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;

  // Advance the group up to just short of the hit point (no embedding).
  const advance = Math.max(0, hitT - BOW_ARROW_WALL_BACKOFF_WORLD);
  world.bowArrowTravelPx += advance;
  const cx = world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx;
  const cy = world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx;
  _placeArrowLine(world, cx, cy, dirX, dirY);

  // Mirror reflection: r = d − 2(d·n)n, then add a small deviation biased
  // strongly toward the true reflection angle (cubed → energetic but not random).
  const dot = dirX * normalX + dirY * normalY;
  let rx = dirX - 2 * dot * normalX;
  let ry = dirY - 2 * dot * normalY;
  const rLen = Math.hypot(rx, ry) || 1;
  rx /= rLen; ry /= rLen;
  const u = nextFloatRange(world.rng, -1, 1);
  const deviation = u * u * u * BOW_ARROW_REFLECT_MAX_DEVIATION_RAD;
  const cosD = Math.cos(deviation);
  const sinD = Math.sin(deviation);
  const outX = rx * cosD - ry * sinD;
  const outY = rx * sinD + ry * cosD;

  const proj = getMoteTypeProjectile(world.bowArrowDustKind);
  const returnSpeed = proj.outboundSpeedPxPerSec * BOW_ARROW_RETURN_SPEED_FACTOR;
  _releaseArrowToStorm(world, outX * returnSpeed, outY * returnSpeed);
}

/** Ends max-distance travel by curving the group away and releasing to Storm. */
function _resolveCurveHome(world: WorldState): void {
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;
  // Rotate the outbound direction away by a randomized angle so the motes peel
  // off smoothly (no instant reversal, no sharp corner) — the Storm pursuit
  // then arcs them home from this initial curved velocity.
  const side = nextFloatRange(world.rng, -1, 1) >= 0 ? 1 : -1;
  const jitter = nextFloatRange(world.rng, 0, BOW_ARROW_CURVE_HOME_JITTER_RAD);
  const angle = side * (BOW_ARROW_CURVE_HOME_BASE_RAD + jitter);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const outX = dirX * cosA - dirY * sinA;
  const outY = dirX * sinA + dirY * cosA;

  const proj = getMoteTypeProjectile(world.bowArrowDustKind);
  const returnSpeed = proj.outboundSpeedPxPerSec * BOW_ARROW_RETURN_SPEED_FACTOR;
  _releaseArrowToStorm(world, outX * returnSpeed, outY * returnSpeed);
}

/**
 * Hands every arrow mote back to Storm following (behaviorMode 0) with the
 * given initial velocity, then clears the arrow instance. The motes keep their
 * identities and inventory slots — nothing is destroyed or depleted.
 */
function _releaseArrowToStorm(world: WorldState, velX: number, velY: number): void {
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.behaviorMode[pidx] === BEHAVIOR_MODE_BOW_ARROW) {
      world.behaviorMode[pidx] = 0;
      world.velocityXWorld[pidx] = velX;
      world.velocityYWorld[pidx] = velY;
    }
  }
  _clearArrowInstance(world);
}

/** Clears the arrow instance bookkeeping (does not touch particle modes). */
function _clearArrowInstance(world: WorldState): void {
  world.bowArrowPhase     = BOW_ARROW_PHASE_NONE;
  world.bowArrowGestureId = -1;
  world.bowArrowCount     = 0;
  world.bowArrowTravelPx  = 0;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
}

/**
 * Cancels an in-progress arrow (assembling or outbound), releasing every
 * reserved mote back to Storm following in place (zero initial velocity).
 * Used when the player releases before the minimum three-mote arrow forms, on
 * damage cancellation, dust-wheel/pause/dialogue cancellation, etc.
 */
export function cancelBowArrow(world: WorldState): void {
  if (world.bowArrowPhase === BOW_ARROW_PHASE_NONE && world.bowArrowCount === 0) return;
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.behaviorMode[pidx] === BEHAVIOR_MODE_BOW_ARROW) {
      world.behaviorMode[pidx] = 0;
    }
  }
  _clearArrowInstance(world);
}

/**
 * Hard reset for room teardown / death / campaign reset: clears all arrow state
 * WITHOUT touching particles (the particle buffer is being rebuilt, so leaving
 * behaviorMode alone is safe and avoids indexing freed slots).
 */
export function resetBowArrowState(world: WorldState): void {
  world.bowArrowPhase           = BOW_ARROW_PHASE_NONE;
  world.bowArrowGestureId       = -1;
  world.bowArrowShieldStartTick = -1;
  world.bowArrowCount           = 0;
  world.bowArrowDirXWorld       = 1;
  world.bowArrowDirYWorld       = 0;
  world.bowArrowOriginXWorld    = 0;
  world.bowArrowOriginYWorld    = 0;
  world.bowArrowTravelPx        = 0;
  world.bowArrowDustKind        = 0;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
}

/** True while any bow arrow is assembling or in flight. */
export function isBowArrowActive(world: WorldState): boolean {
  return world.bowArrowPhase !== BOW_ARROW_PHASE_NONE;
}
