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
 * Assembly seats and launches from the shield's canonical center (see
 * `shieldGeometry.ts`), not the player's body — the arrow visually extends
 * from where the shield already sits in front of the player.
 *
 * Timing (measured from when the Shield Weave began, NOT from the input press):
 *   • t=0.00 s — one center mote occupies the arrow center; the straight
 *     trajectory line extends outward along the aim.
 *   • t=0.75 s — the two outermost shield-arc motes (selected deterministically
 *     by center-out queue rank, not physics distance — see
 *     `_pickEdgeAvailableMote`) begin arcing in, forming a 3-mote line once
 *     seated (behind · center · front).
 *   • t=1.25 s — a fourth mote (if available) begins arcing in → 4-mote arrow
 *     once seated.
 *   • t=1.75 s — a fifth mote (if available) begins arcing in → 5-mote arrow
 *     (max) once seated.
 *   Minimum valid arrow = 3 SEATED motes; below 3 total motes available the
 *   bow does not assemble and the Shield Weave behaves normally.
 *
 * Loading vs. seated (task section 6): a mote that has just started its
 * 12-tick arc-in animation is LOADING, not SEATED. Only seated motes count
 * toward the fireable minimum, so releasing the instant the 0.75 s threshold
 * is crossed cannot snap two still-mid-air motes directly into a fired arrow.
 * If release happens before enough motes are even reserved to ever reach the
 * minimum, the arrow cancels immediately; otherwise the release latches and
 * fires automatically the moment enough motes finish seating (see
 * `fireBowArrow` / the coordinator's latch handling).
 *
 * State ownership: an arrow mote is marked BEHAVIOR_MODE_BOW_ARROW, so normal
 * integration + binding skip it and the Shield crescent excludes it (a mote is
 * never simultaneously a shield-slot mote and an arrow mote). On launch
 * resolution (wall bounce, enemy hit, or max-distance curve-home) each mote is
 * handed back to behaviorMode 0 with an initial velocity, so the standard
 * Storm pursuit gradually reclaims it — there is no separate owned "returning"
 * phase.
 *
 * Gold Dust (the default) supplies the projectile baseline via
 * `moteTypeConfig.ts`: 250 px/s outbound speed (constant, independent of load
 * duration), 250 px maximum outbound travel, and non-piercing (each shot
 * resolves on its first enemy hit).
 */

import { WorldState, MAX_BOW_ARROW_MOTES, MIN_BOW_ARROW_MOTES, MAX_CANONICAL_MOTES } from '../world';
import { ClusterState } from '../clusters/state';
import { BEHAVIOR_MODE_BOW_ARROW } from '../particles/bowArrowBehaviorMode';
import { raycastWalls } from '../clusters/grappleShared';
import { getAvailableCanonicalMotes, MoteOwnershipState } from './moteOwnership';
import { MAX_HIT_REGISTRY_SLOTS } from './weaveHitRegistryConfig';
import { segmentPointDistanceSq, applyRoutedWeaveDamage } from './weaveCollisionUtils';
import { getMoteTypeProjectile } from './projectileProperties';
import { nextFloatRange } from '../rng';
import { computeShieldCenterWorld, WorldPoint } from './shieldGeometry';

// ── Phases ───────────────────────────────────────────────────────────────────
export const BOW_ARROW_PHASE_NONE       = 0;
export const BOW_ARROW_PHASE_ASSEMBLING = 1;
export const BOW_ARROW_PHASE_OUTBOUND   = 2;

// ── Per-rank assembly state ─────────────────────────────────────────────────
export const BOW_ARROW_RANK_UNUSED  = 0;
export const BOW_ARROW_RANK_LOADING = 1;
export const BOW_ARROW_RANK_SEATED  = 2;

// ── Timing (ticks at 60 fps, measured from Shield Weave start) ────────────────
export const BOW_ARROW_LOAD_3_TICKS = 45;  // 0.75 s → 3 motes begin loading
export const BOW_ARROW_LOAD_4_TICKS = 75;  // 1.25 s → 4th mote begins loading
export const BOW_ARROW_LOAD_5_TICKS = 105; // 1.75 s → 5th mote begins loading

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

/**
 * Small per-mote hit radius (world units) for the arrow's swept enemy
 * collision, approximating a mote's rendered body + glow footprint. Combined
 * with each enemy's own half-size, matching the Sword Weave's equivalent
 * constant in spirit (see `NEW_SWORD_MOTE_HIT_RADIUS_WORLD` in swordWeave.ts).
 */
const BOW_ARROW_MOTE_HIT_RADIUS_WORLD = 2.0;

/**
 * Whole-number Bow Weave damage policy by fired arrow mote count (task
 * section 1). A single authoritative pure function — no scattered literals.
 */
export function getBowArrowDamage(moteCount: number): number {
  if (moteCount >= 5) return 4;
  if (moteCount === 4) return 3;
  return 2; // minimum 3-mote arrow
}

/** Per-shot enemy hit registry (module-level scratch — reset on every fire). */
const _bowArrowHitFlags = new Uint8Array(MAX_HIT_REGISTRY_SLOTS);

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

/** Number of currently-reserved ranks whose assembly state is SEATED. */
export function countSeatedBowArrowMotes(world: WorldState): number {
  let n = 0;
  for (let r = 0; r < world.bowArrowCount; r++) {
    if (world.bowArrowRankState[r] === BOW_ARROW_RANK_SEATED) n++;
  }
  return n;
}

const _shieldCenterScratch: WorldPoint = { x: 0, y: 0 };

/**
 * Resolves the current shield-center seating/launch origin for `player`,
 * given an aim delta (need not be normalized) and a fallback direction (used
 * when the aim delta is ~zero — see `shieldGeometry.computeShieldCenterWorld`).
 * Writes into the shared scratch point and returns it (allocation-free).
 */
function _resolveShieldCenter(
  player: ClusterState,
  aimDirXWorld: number,
  aimDirYWorld: number,
  fallbackDirXWorld: number,
  fallbackDirYWorld: number,
): WorldPoint {
  return computeShieldCenterWorld(
    _shieldCenterScratch,
    player.positionXWorld, player.positionYWorld,
    aimDirXWorld, aimDirYWorld,
    fallbackDirXWorld, fallbackDirYWorld,
  );
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
  const available = getAvailableCanonicalMotes(world);
  if (available.count < MIN_BOW_ARROW_MOTES) return false;

  const centerPidx = available.indices[0];
  if (centerPidx < 0 || centerPidx >= MAX_CANONICAL_MOTES) {
    return false;
  }

  world.bowArrowPhase           = BOW_ARROW_PHASE_ASSEMBLING;
  world.bowArrowGestureId       = gestureId;
  world.bowArrowShieldStartTick = shieldStartTick;
  world.bowArrowCount           = 1;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
  world.bowArrowRankState.fill(BOW_ARROW_RANK_UNUSED);
  world.bowArrowParticleIndex[0] = centerPidx;
  world.bowArrowSlotStartTick[0] = world.tick;
  world.bowArrowRankState[0]     = BOW_ARROW_RANK_LOADING;
  const fromX = world.canonicalMoteXWorld[centerPidx] !== 0 ? world.canonicalMoteXWorld[centerPidx] : (world.positionXWorld[centerPidx] || 0);
  const fromY = world.canonicalMoteYWorld[centerPidx] !== 0 ? world.canonicalMoteYWorld[centerPidx] : (world.positionYWorld[centerPidx] || 0);
  world.bowArrowArcFromXWorld[0] = fromX;
  world.bowArrowArcFromYWorld[0] = fromY;
  world.bowArrowArcCtrlXWorld[0] = fromX;
  world.bowArrowArcCtrlYWorld[0] = fromY;
  world.canonicalMoteOwnership[centerPidx] = MoteOwnershipState.BowAssembling;
  if (centerPidx < world.behaviorMode.length) {
    world.behaviorMode[centerPidx] = BEHAVIOR_MODE_BOW_ARROW;
  }
  world.bowArrowTravelPx = 0;
  world.bowArrowReleaseLatchedFlag = 0;
  return true;
}

/**
 * Selects the next available player mote for the Bow arrow using the SAME
 * center-out queue ordering the Shield crescent uses to place its slots (see
 * `shieldGeometry.centerOutArcT`): for any available-motes count, the LAST
 * entries of the ordered available-motes list are always the two outermost
 * shield-arc positions (arc-t 0 and 1), and scanning further inward from
 * there visits the next-outermost slots in order. Scanning the available list
 * from its end, skipping already-reserved motes, therefore deterministically
 * picks the outermost unreserved shield-arc mote first, then the
 * next-outermost, purely from queue order — never from transient physics
 * position or floating-point distance.
 */
function _pickEdgeAvailableMote(world: WorldState): number {
  const available = getAvailableCanonicalMotes(world);
  for (let rank = available.count - 1; rank >= 0; rank--) {
    const pidx = available.indices[rank];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    if (_isReserved(world, pidx)) continue;
    return pidx;
  }
  return -1;
}

/** Reserves one additional mote into the arrow at the next center-out rank (state: LOADING). */
function _reserveNextMote(world: WorldState, playerX: number, playerY: number): void {
  const rank = world.bowArrowCount;
  if (rank >= MAX_BOW_ARROW_MOTES) return;
  const pidx = _pickEdgeAvailableMote(world);
  if (pidx === -1) return;

  world.bowArrowParticleIndex[rank] = pidx;
  world.bowArrowSlotStartTick[rank] = world.tick;
  world.bowArrowRankState[rank]     = BOW_ARROW_RANK_LOADING;
  const fromX = world.canonicalMoteXWorld[pidx] !== 0 ? world.canonicalMoteXWorld[pidx] : (world.positionXWorld[pidx] || playerX);
  const fromY = world.canonicalMoteYWorld[pidx] !== 0 ? world.canonicalMoteYWorld[pidx] : (world.positionYWorld[pidx] || playerY);
  world.bowArrowArcFromXWorld[rank] = fromX;
  world.bowArrowArcFromYWorld[rank] = fromY;
  // Control point bulges away from the player so the mote arcs out then curves back.
  const awayX = fromX - playerX;
  const awayY = fromY - playerY;
  const awayLen = Math.hypot(awayX, awayY) || 1;
  world.bowArrowArcCtrlXWorld[rank] = fromX + (awayX / awayLen) * BOW_ARROW_ARC_BULGE_WORLD;
  world.bowArrowArcCtrlYWorld[rank] = fromY + (awayY / awayLen) * BOW_ARROW_ARC_BULGE_WORLD;
  world.canonicalMoteOwnership[pidx] = MoteOwnershipState.BowAssembling;
  if (pidx < world.behaviorMode.length) {
    world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
  }
  world.bowArrowCount++;
}

/**
 * Advances arrow assembly one tick. When `isHeld` is true (the secondary
 * gesture is actively held), updates the firing direction from the current
 * aim (so the arrow rotates smoothly with the aim line without re-running the
 * load timers) and loads new motes as schedule thresholds are crossed. Every
 * call — held or not — drives each already-reserved mote toward its seated
 * line position (arcing in for still-loading motes, transitioning to SEATED
 * once the arc completes), so a release-latched arrow keeps assembling with
 * its already-loading motes even after the gesture ends (task section 6).
 * Safe to call every tick while `bowArrowPhase === ASSEMBLING`.
 */
export function tickBowArrowAssembly(
  world: WorldState,
  aimDirXWorld: number,
  aimDirYWorld: number,
  isHeld: boolean,
): void {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) return;
  const player = _findPlayer(world);
  if (player === null) return;

  let dirX = world.bowArrowDirXWorld;
  let dirY = world.bowArrowDirYWorld;
  if (isHeld) {
    const aimLen = Math.hypot(aimDirXWorld, aimDirYWorld);
    dirX = aimLen > 1e-6 ? aimDirXWorld / aimLen : world.bowArrowDirXWorld;
    dirY = aimLen > 1e-6 ? aimDirYWorld / aimLen : world.bowArrowDirYWorld;
    world.bowArrowDirXWorld = dirX;
    world.bowArrowDirYWorld = dirY;
  }

  const center = _resolveShieldCenter(player, dirX, dirY, dirX, dirY);
  const centerX = center.x;
  const centerY = center.y;

  // ── Load schedule (thresholds measured from Shield start) — only while
  // actively held, so a released gesture never pulls NEW motes; already-
  // reserved motes still finish seating below regardless of `isHeld`. ───────
  if (isHeld) {
    const elapsed = world.tick - world.bowArrowShieldStartTick;
    let targetCount = 1;
    if (elapsed >= BOW_ARROW_LOAD_5_TICKS) targetCount = 5;
    else if (elapsed >= BOW_ARROW_LOAD_4_TICKS) targetCount = 4;
    else if (elapsed >= BOW_ARROW_LOAD_3_TICKS) targetCount = 3;
    targetCount = Math.min(targetCount, MAX_BOW_ARROW_MOTES);

    // At the 0.75 s threshold two motes appear together (→ 3); afterwards one at a time.
    while (world.bowArrowCount < targetCount) {
      const before = world.bowArrowCount;
      _reserveNextMote(world, player.positionXWorld, player.positionYWorld);
      if (world.bowArrowCount === before) break; // no more available motes to pull
    }
  }

  // ── Drive each reserved mote toward its seated line position ──────────────
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;

    const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
    const seatX = centerX + dirX * offset;
    const seatY = centerY + dirY * offset;

    const arcElapsed = world.tick - world.bowArrowSlotStartTick[r];
    if (arcElapsed >= BOW_ARROW_ARC_TICKS) {
      world.canonicalMoteXWorld[pidx] = seatX;
      world.canonicalMoteYWorld[pidx] = seatY;
      world.canonicalMoteVelXWorld[pidx] = 0;
      world.canonicalMoteVelYWorld[pidx] = 0;
      if (pidx < world.positionXWorld.length) {
        world.positionXWorld[pidx] = seatX;
        world.positionYWorld[pidx] = seatY;
        world.velocityXWorld[pidx] = 0;
        world.velocityYWorld[pidx] = 0;
      }
      world.bowArrowRankState[r] = BOW_ARROW_RANK_SEATED;
    } else {
      const t = Math.max(0, arcElapsed) / BOW_ARROW_ARC_TICKS;
      const mt = 1 - t;
      const p0x = world.bowArrowArcFromXWorld[r];
      const p0y = world.bowArrowArcFromYWorld[r];
      const p1x = world.bowArrowArcCtrlXWorld[r];
      const p1y = world.bowArrowArcCtrlYWorld[r];
      const posX = mt * mt * p0x + 2 * mt * t * p1x + t * t * seatX;
      const posY = mt * mt * p0y + 2 * mt * t * p1y + t * t * seatY;
      world.canonicalMoteXWorld[pidx] = posX;
      world.canonicalMoteYWorld[pidx] = posY;
      if (pidx < world.positionXWorld.length) {
        world.positionXWorld[pidx] = posX;
        world.positionYWorld[pidx] = posY;
      }
      world.bowArrowRankState[r] = BOW_ARROW_RANK_LOADING;
    }
    world.canonicalMoteOwnership[pidx] = MoteOwnershipState.BowAssembling;
    if (pidx < world.behaviorMode.length) {
      world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
    }
  }
}

/**
 * Fires the arrow along `aimDir` when at least the minimum three motes are
 * currently SEATED (task section 6 — a still-loading mote is never snapped
 * into the fired line). Any reserved-but-still-loading mote at fire time is
 * released back to Storm following in place (no teleport) rather than being
 * dragged into the shot; only seated motes are compacted onto the fired line.
 * Snaps the fired motes exactly onto the straight line at the shield center so
 * they launch as a coherent group, captures the projectile dust kind, and
 * transitions to the outbound phase. Returns false (leaving the arrow
 * assembling, and any release latch still pending) when fewer than three
 * motes are seated.
 */
export function fireBowArrow(world: WorldState, aimDirXWorld: number, aimDirYWorld: number): boolean {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) return false;
  // Readiness check first, with NO allocation and NO side effects — this is
  // the path taken every tick while a release latch waits for seating to
  // finish (task section 6), so it must stay allocation-free and must never
  // disturb still-loading motes when we are not actually about to fire.
  if (countSeatedBowArrowMotes(world) < MIN_BOW_ARROW_MOTES) return false;
  const player = _findPlayer(world);
  if (player === null) return false;

  // We ARE firing: compact the SEATED ranks down to a contiguous 0..k-1 list;
  // anything still LOADING is released back to Storm in place, not fired —
  // never snapped into the shot (task section 6).
  const seatedPidx: number[] = [];
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    if (world.bowArrowRankState[r] === BOW_ARROW_RANK_SEATED) {
      seatedPidx.push(pidx);
    } else if (world.canonicalMoteOwnership[pidx] === MoteOwnershipState.BowAssembling || (pidx < world.behaviorMode.length && world.behaviorMode[pidx] === BEHAVIOR_MODE_BOW_ARROW)) {
      world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Resting;
      world.canonicalMoteVelXWorld[pidx] = 0;
      world.canonicalMoteVelYWorld[pidx] = 0;
      if (pidx < world.behaviorMode.length) {
        world.behaviorMode[pidx] = 0;
        world.velocityXWorld[pidx] = 0;
        world.velocityYWorld[pidx] = 0;
      }
    }
  }

  const aimLen = Math.hypot(aimDirXWorld, aimDirYWorld);
  const dirX = aimLen > 1e-6 ? aimDirXWorld / aimLen : world.bowArrowDirXWorld;
  const dirY = aimLen > 1e-6 ? aimDirYWorld / aimLen : world.bowArrowDirYWorld;

  const center = _resolveShieldCenter(player, dirX, dirY, dirX, dirY);

  world.bowArrowDirXWorld    = dirX;
  world.bowArrowDirYWorld    = dirY;
  world.bowArrowOriginXWorld = center.x;
  world.bowArrowOriginYWorld = center.y;
  world.bowArrowTravelPx     = 0;

  world.bowArrowDustKind = world.selectedDustKind || (seatedPidx[0] < world.kindBuffer.length ? world.kindBuffer[seatedPidx[0]] : 0) || 0;

  world.bowArrowCount = seatedPidx.length;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowRankState.fill(BOW_ARROW_RANK_UNUSED);
  for (let r = 0; r < seatedPidx.length; r++) {
    world.bowArrowParticleIndex[r] = seatedPidx[r];
    world.bowArrowRankState[r]     = BOW_ARROW_RANK_SEATED;
  }

  _placeArrowLine(world, world.bowArrowOriginXWorld, world.bowArrowOriginYWorld, dirX, dirY);

  world.bowArrowPhase = BOW_ARROW_PHASE_OUTBOUND;
  world.bowArrowReleaseLatchedFlag = 0;
  _bowArrowHitFlags.fill(0);
  return true;
}

/** Places every reserved mote onto the straight line centered at (cx,cy). */
function _placeArrowLine(world: WorldState, cx: number, cy: number, dirX: number, dirY: number): void {
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
    const posX = cx + dirX * offset;
    const posY = cy + dirY * offset;
    world.canonicalMoteXWorld[pidx] = posX;
    world.canonicalMoteYWorld[pidx] = posY;
    world.canonicalMoteVelXWorld[pidx] = 0;
    world.canonicalMoteVelYWorld[pidx] = 0;
    world.canonicalMoteOwnership[pidx] = MoteOwnershipState.BowOutbound;
    if (pidx < world.positionXWorld.length) {
      world.positionXWorld[pidx] = posX;
      world.positionYWorld[pidx] = posY;
      world.velocityXWorld[pidx] = 0;
      world.velocityYWorld[pidx] = 0;
      world.behaviorMode[pidx] = BEHAVIOR_MODE_BOW_ARROW;
    }
  }
}

// ── Release latch (task section 6) ──────────────────────────────────────────

/**
 * Called on gesture release when `fireBowArrow` couldn't yet fire. Latches an
 * automatic fire for the moment enough motes finish seating, UNLESS fewer
 * than the minimum motes are even reserved (bowArrowCount < MIN) — in that
 * case seating could never reach the minimum (no more motes will ever be
 * pulled once the gesture is released), so the caller must cancel instead.
 * Returns true if the latch was armed, false if the caller should cancel.
 */
export function latchBowArrowRelease(world: WorldState, aimDirXWorld: number, aimDirYWorld: number): boolean {
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) return false;
  if (world.bowArrowCount < MIN_BOW_ARROW_MOTES) return false;
  world.bowArrowReleaseLatchedFlag = 1;
  world.bowArrowLatchedAimXWorld   = aimDirXWorld;
  world.bowArrowLatchedAimYWorld   = aimDirYWorld;
  return true;
}

/**
 * Attempts to resolve a pending release latch: if enough motes have now
 * finished seating, fires using the aim captured at release time and clears
 * the latch. No-op (returns false) if not yet ready or no latch is pending.
 */
export function tryResolveLatchedBowArrowRelease(world: WorldState): boolean {
  if (world.bowArrowReleaseLatchedFlag === 0) return false;
  if (world.bowArrowPhase !== BOW_ARROW_PHASE_ASSEMBLING) {
    world.bowArrowReleaseLatchedFlag = 0;
    return false;
  }
  const fired = fireBowArrow(world, world.bowArrowLatchedAimXWorld, world.bowArrowLatchedAimYWorld);
  if (fired) world.bowArrowReleaseLatchedFlag = 0;
  return fired;
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
 * Swept per-mote enemy collision test over this tick's proposed step: for
 * every not-yet-hit enemy, tests every arrow mote's actual previous→next
 * segment (not just the center point) against the enemy's hit circle,
 * preventing both point-sampling tunneling and "only the center mote counts"
 * blind spots (task section 1). Returns the hit cluster index, or −1.
 */
function _sweptArrowEnemyHit(world: WorldState, stepDist: number): number {
  if (world.bowArrowCount === 0) return -1;
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;
  const baseX = world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx;
  const baseY = world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx;
  const newBaseX = baseX + dirX * stepDist;
  const newBaseY = baseY + dirY * stepDist;

  const limit = Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS);
  for (let ci = 0; ci < limit; ci++) {
    if (_bowArrowHitFlags[ci] === 1) continue;
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0 || c.isPlayerFlag === 1) continue;

    const enemyRadius = Math.min(c.halfWidthWorld, c.halfHeightWorld);
    const hitRadius = BOW_ARROW_MOTE_HIT_RADIUS_WORLD + enemyRadius;
    const hitRadiusSq = hitRadius * hitRadius;

    for (let r = 0; r < world.bowArrowCount; r++) {
      const pidx = world.bowArrowParticleIndex[r];
      if (pidx < 0 || pidx >= world.particleCount || world.isAliveFlag[pidx] === 0) continue;
      const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
      const prevX = baseX + dirX * offset;
      const prevY = baseY + dirY * offset;
      const nextX = newBaseX + dirX * offset;
      const nextY = newBaseY + dirY * offset;

      const distSq = segmentPointDistanceSq(prevX, prevY, nextX, nextY, c.positionXWorld, c.positionYWorld);
      if (distSq <= hitRadiusSq) return ci;
    }
  }
  return -1;
}

/**
 * Advances the outbound arrow one tick. The whole arrow is treated as one
 * coherent group: only the LEADING mote's swept segment is tested against
 * terrain, so the group bounces/returns exactly once per collision rather than
 * each mote detecting the same wall on successive frames. Enemy collision is
 * swept per-mote (see `_sweptArrowEnemyHit`) and takes priority within a tick
 * over a wall the arrow would also reach, so an enemy standing in front of a
 * wall is hit rather than the arrow visually clipping through it to bounce.
 * Travel distance is accumulated from displacement (robust to pauses /
 * variable steps). Returns true when the arrow has resolved this tick
 * (bounced, hit an enemy, or curved home).
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

  // ── Enemy collision (swept, per-mote) — takes priority this tick. ────────
  if (stepDist > 1e-6 && !proj.piercing) {
    const hitCi = _sweptArrowEnemyHit(world, stepDist);
    if (hitCi !== -1) {
      _resolveEnemyHit(world, hitCi);
      return true;
    }
  } else if (stepDist > 1e-6 && proj.piercing) {
    // Piercing: apply damage to every not-yet-hit enemy swept this tick, but
    // do not resolve/release the arrow — it keeps flying. (No configured mote
    // type currently sets piercing: true; this is forward-compatible plumbing
    // for task section 1's "unless an explicit piercing behavior permits it".)
    _applyPiercingArrowHits(world, stepDist);
  }

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

/** Applies damage to every enemy swept this tick by a piercing arrow, without resolving flight. */
function _applyPiercingArrowHits(world: WorldState, stepDist: number): void {
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;
  const baseX = world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx;
  const baseY = world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx;
  const newBaseX = baseX + dirX * stepDist;
  const newBaseY = baseY + dirY * stepDist;
  const damage = getBowArrowDamage(world.bowArrowCount);

  const limit = Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS);
  for (let ci = 0; ci < limit; ci++) {
    if (_bowArrowHitFlags[ci] === 1) continue;
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0 || c.isPlayerFlag === 1) continue;

    const enemyRadius = Math.min(c.halfWidthWorld, c.halfHeightWorld);
    const hitRadiusSq = (BOW_ARROW_MOTE_HIT_RADIUS_WORLD + enemyRadius) * (BOW_ARROW_MOTE_HIT_RADIUS_WORLD + enemyRadius);

    let hit = false;
    for (let r = 0; r < world.bowArrowCount && !hit; r++) {
      const offset = bowArrowRankLineOffset(r) * BOW_ARROW_MOTE_SPACING_WORLD;
      const distSq = segmentPointDistanceSq(
        baseX + dirX * offset, baseY + dirY * offset,
        newBaseX + dirX * offset, newBaseY + dirY * offset,
        c.positionXWorld, c.positionYWorld,
      );
      if (distSq <= hitRadiusSq) hit = true;
    }
    if (!hit) continue;

    _bowArrowHitFlags[ci] = 1;
    applyRoutedWeaveDamage(world, ci, damage, c.positionXWorld, c.positionYWorld);
  }
}

/**
 * Resolves a non-piercing arrow's first enemy hit: applies whole-number
 * damage (routed through the Orbital Dust Core's specialized hit function
 * when applicable), then releases the arrow back to Storm with a gentle
 * curved peel-off — the same clean "resolve and hand back to Storm" shape as
 * a wall bounce or max-distance curve-home, so exactly one resolution path
 * exists for ending outbound flight.
 */
function _resolveEnemyHit(world: WorldState, clusterIndex: number): void {
  const c = world.clusters[clusterIndex];
  const damage = getBowArrowDamage(world.bowArrowCount);
  applyRoutedWeaveDamage(world, clusterIndex, damage, c.positionXWorld, c.positionYWorld);
  _bowArrowHitFlags[clusterIndex] = 1;

  // Re-place the line at its current (pre-step) position — the arrow does not
  // advance further into the enemy this tick, so it never visually embeds.
  const dirX = world.bowArrowDirXWorld;
  const dirY = world.bowArrowDirYWorld;
  _placeArrowLine(
    world,
    world.bowArrowOriginXWorld + dirX * world.bowArrowTravelPx,
    world.bowArrowOriginYWorld + dirY * world.bowArrowTravelPx,
    dirX, dirY,
  );

  _releaseWithCurvedPeel(world, dirX, dirY);
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
  _releaseWithCurvedPeel(world, dirX, dirY);
}

/**
 * Shared "peel off and hand back to Storm" release used by both the
 * max-distance curve-home and the enemy-hit resolution: rotates the outbound
 * direction away by a randomized angle so the motes peel off smoothly (no
 * instant reversal, no sharp corner) — the Storm pursuit then arcs them home
 * from this initial curved velocity.
 */
function _releaseWithCurvedPeel(world: WorldState, dirX: number, dirY: number): void {
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
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    if (world.canonicalMoteOwnership[pidx] === MoteOwnershipState.BowAssembling || world.canonicalMoteOwnership[pidx] === MoteOwnershipState.BowOutbound || (pidx < world.behaviorMode.length && world.behaviorMode[pidx] === BEHAVIOR_MODE_BOW_ARROW)) {
      world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Resting;
      world.canonicalMoteVelXWorld[pidx] = velX;
      world.canonicalMoteVelYWorld[pidx] = velY;
      if (pidx < world.behaviorMode.length) {
        world.behaviorMode[pidx] = 0;
        world.velocityXWorld[pidx] = velX;
        world.velocityYWorld[pidx] = velY;
      }
    }
  }
  _clearArrowInstance(world);
}

/** Clears the arrow instance bookkeeping (does not touch particle modes). */
function _clearArrowInstance(world: WorldState): void {
  world.bowArrowPhase           = BOW_ARROW_PHASE_NONE;
  world.bowArrowGestureId       = -1;
  world.bowArrowCount           = 0;
  world.bowArrowTravelPx        = 0;
  world.bowArrowReleaseLatchedFlag = 0;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
  world.bowArrowRankState.fill(BOW_ARROW_RANK_UNUSED);
}

export function cancelBowArrow(world: WorldState): void {
  if (world.bowArrowPhase === BOW_ARROW_PHASE_NONE && world.bowArrowCount === 0) return;
  for (let r = 0; r < world.bowArrowCount; r++) {
    const pidx = world.bowArrowParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    if (world.canonicalMoteOwnership[pidx] === MoteOwnershipState.BowAssembling || world.canonicalMoteOwnership[pidx] === MoteOwnershipState.BowOutbound || (pidx < world.behaviorMode.length && world.behaviorMode[pidx] === BEHAVIOR_MODE_BOW_ARROW)) {
      world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Resting;
      if (pidx < world.behaviorMode.length) {
        world.behaviorMode[pidx] = 0;
      }
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
  world.bowArrowReleaseLatchedFlag = 0;
  world.bowArrowLatchedAimXWorld   = 0;
  world.bowArrowLatchedAimYWorld   = 0;
  world.bowArrowParticleIndex.fill(-1);
  world.bowArrowSlotStartTick.fill(-1);
  world.bowArrowRankState.fill(BOW_ARROW_RANK_UNUSED);
  _bowArrowHitFlags.fill(0);
}

/** True while any bow arrow is assembling or in flight. */
export function isBowArrowActive(world: WorldState): boolean {
  return world.bowArrowPhase !== BOW_ARROW_PHASE_NONE;
}
