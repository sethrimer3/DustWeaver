/**
 * Shield Sword Weave — sword-form upgrade built from Storm/Shield motes.
 *
 * The sword is a separate active weave (WEAVE_SHIELD_SWORD).  When equipped:
 *   • If right mouse is NOT held, the player carries a sword formed from
 *     dust motes that auto-swings at nearby enemies through windup → slash →
 *     recovery states.
 *   • If right mouse IS HELD, the sword executes a guard swipe:
 *       1. GUARD_FORMING  — fast form (5 ticks) when sword was idle/orbiting.
 *       2. GUARD_SLASHING — a single mouse-aimed swipe before the shield forms.
 *       3. SHIELDING      — crescent shield while RMB remains held.
 *     The signature feel is "sword cuts open into shield."
 *   • When RMB is released, the sword returns to RECOVERING → READY.
 *
 * Blade length (Phase 6):
 *   activeSwordMoteCount = min(MAX_SWORD_BLADE_MOTES, availableMoteSlotCount)
 *   swordLengthRatio     = activeSwordMoteCount / MAX_SWORD_BLADE_MOTES
 *
 * If swordLengthRatio == 0 (all motes depleted), the sword cannot attack but
 * can still be in READY state visually to indicate its presence.
 *
 * Guard swipe (Phase 7):
 *   RMB press from non-shield state → GUARD_FORMING → GUARD_SLASHING → SHIELDING.
 *   tickSwordWeave returns true when the shield crescent should be applied this
 *   tick (only true once GUARD_SLASHING has completed → SHIELDING).
 *
 * Performance:
 *   • All scratch storage is module-level and pre-allocated.
 *   • No per-tick allocations.
 */

import { WorldState, MAX_SWORD_SLASH_MOTES } from '../world';
import { ClusterState } from '../clusters/state';
import {
  getCircleOfInfluenceRadiusWorld,
  getAvailableMoteSlotCount,
  getAvailableOrderedMoteSlots,
} from '../motes/orderedMoteQueue';
import { BEHAVIOR_MODE_SWORD_SLASH } from '../particles/swordSlashBehaviorMode';
import { applyODCHit } from '../clusters/orbitalDustCoreAi';
import {
  ODC_SMALL_RING_RADII,
  ODC_LARGE_RING_RADII,
  ODC_SMALL_RING_COUNT,
  ODC_LARGE_RING_COUNT,
} from '../clusters/orbitalDustCoreConfig';

// ── Sword state enum ──────────────────────────────────────────────────────────

export const SWORD_STATE_ORBIT        = 0;
export const SWORD_STATE_FORMING      = 1;
export const SWORD_STATE_READY        = 2;
export const SWORD_STATE_WINDUP       = 3;
export const SWORD_STATE_SLASHING     = 4;
export const SWORD_STATE_RECOVERING   = 5;
export const SWORD_STATE_SHIELDING    = 6;
/**
 * Phase 7 — fast sword materialisation when RMB is pressed while the sword
 * is idle (ORBIT or FORMING).  5 ticks; transitions to GUARD_SLASHING.
 */
export const SWORD_STATE_GUARD_FORMING   = 7;
/**
 * Phase 7 — mouse-aimed guard swipe before the crescent shield forms.
 * Uses same arc setup as auto-swing but aims toward playerWeaveAimDirXWorld/Y.
 * After the swipe completes, transitions to SHIELDING.
 */
export const SWORD_STATE_GUARD_SLASHING  = 8;

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Maximum visible blade segments rendered along the sword. */
export const MAX_SWORD_BLADE_MOTES = 8;

/** World-space distance from the hand anchor to the sword tip at full length. */
export const SWORD_REACH_WORLD = 16.0;

/** Auto-target scan radius (world units) measured from the hand anchor. */
const AUTO_TARGET_RADIUS_WORLD = 30.0;
/** Ticks the sword spends in each transient state. */
const SWORD_FORMING_TICKS       = 15;
const SWORD_GUARD_FORMING_TICKS = 5;   // Phase 7: faster materialisation on guard
const SWORD_WINDUP_TICKS        = 12;
const SWORD_SLASH_TICKS         = 10;
const SWORD_RECOVERY_TICKS      = 18;

/** Total angular sweep of a slash (radians). */
const SLASH_ARC_RAD     = Math.PI * 0.75;
/** Half-arc used for "is enemy in slash cone" tests. */
const SLASH_HALF_ARC_RAD = SLASH_ARC_RAD * 0.5;

/** Damage applied to each enemy hit by a slash. */
const SWORD_DAMAGE = 2.0;

/**
 * Resting sword angle (radians) measured from the hand anchor while the
 * sword is idle.  Roughly 35° below horizontal, mirrored when facing left.
 * The sword visually "hangs" toward the ground in the ready stance.
 */
const READY_ANGLE_RIGHT_RAD = Math.PI * 0.20;   // ≈ 36° below horizontal-right
const READY_ANGLE_LEFT_RAD  = Math.PI - READY_ANGLE_RIGHT_RAD; // mirror

/** Pull-back amount during windup (radians). */
const WINDUP_PULL_BACK_RAD = Math.PI * 0.45;

/** Maximum number of cluster hit-registry slots — must cover all enemies in a room. */
const MAX_HIT_REGISTRY_SLOTS = 64;

/** Hand anchor offsets relative to player center (world units). */
const HAND_ANCHOR_X_OFFSET_WORLD = 3.0;
const HAND_ANCHOR_Y_OFFSET_WORLD = 0.5;

// ── Module-level scratch (pre-allocated, never reallocated) ──────────────────

/**
 * Per-cluster hit flag for the in-progress slash.  Indexed by the cluster's
 * position in world.clusters.  Reset to all zeros at the start of each slash.
 */
const _slashHitFlags = new Uint8Array(MAX_HIT_REGISTRY_SLOTS);

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Resets the sword weave's per-world state.  Called from world creation and
 * whenever the player loadout/room reloads (deferred to the caller).
 */
export function resetSwordWeaveState(world: WorldState): void {
  world.swordWeaveStateEnum             = SWORD_STATE_ORBIT;
  world.swordWeaveStateTicksElapsed     = 0;
  world.swordWeaveAngleRad              = READY_ANGLE_RIGHT_RAD;
  world.swordWeaveTargetClusterIndex    = -1;
  world.swordWeaveSlashStartAngleRad    = 0;
  world.swordWeaveSlashEndAngleRad      = 0;
  world.swordWeaveHandAnchorXWorld      = 0;
  world.swordWeaveHandAnchorYWorld      = 0;
  world.swordWeaveLengthRatio           = 1.0;
  _slashHitFlags.fill(0);
}

/** Returns the canonical hand-anchor world position for the current player facing. */
function _computeHandAnchor(player: ClusterState, outAnchor: { xWorld: number; yWorld: number }): void {
  const facingSign = player.isFacingLeftFlag === 1 ? -1.0 : 1.0;
  outAnchor.xWorld = player.positionXWorld + HAND_ANCHOR_X_OFFSET_WORLD * facingSign;
  outAnchor.yWorld = player.positionYWorld + HAND_ANCHOR_Y_OFFSET_WORLD;
}

/** Single shared anchor scratch — populated each call by _computeHandAnchor. */
const _handAnchorScratch = { xWorld: 0, yWorld: 0 };

/**
 * Finds the nearest non-player, alive enemy cluster within `detectionRadiusWorld`
 * world units of the given anchor point.  Returns the cluster's index in
 * world.clusters, or -1 if none is in range.
 *
 * In Phases 1–4, `detectionRadiusWorld` defaults to `AUTO_TARGET_RADIUS_WORLD`
 * (30 world units) for backward-compatible auto-swing behavior, but is
 * overridden in the READY state to `getCircleOfInfluenceRadiusWorld(world)` so
 * the sword's passive awareness scales with available mote count.
 *
 * @param world                  Current world state.
 * @param anchorXWorld           X coordinate of the sword's hand anchor (world units).
 * @param anchorYWorld           Y coordinate of the sword's hand anchor (world units).
 * @param detectionRadiusWorld   Search radius (world units). Defaults to AUTO_TARGET_RADIUS_WORLD.
 */
function _findNearestEnemyIndex(
  world: WorldState,
  anchorXWorld: number,
  anchorYWorld: number,
  detectionRadiusWorld = AUTO_TARGET_RADIUS_WORLD,
): number {
  const detectionRadiusSq = detectionRadiusWorld * detectionRadiusWorld;
  let bestIndex = -1;
  let bestDistSq = detectionRadiusSq;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;
    if (c.isPlayerFlag === 1) continue;
    const dx = c.positionXWorld - anchorXWorld;
    const dy = c.positionYWorld - anchorYWorld;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      bestIndex = ci;
    }
  }
  return bestIndex;
}

/**
 * Computes the shortest signed angular delta from `from` to `to` in radians,
 * normalized into the range (-π, π].
 */
function _shortestAngleDeltaRad(fromRad: number, toRad: number): number {
  let d = toRad - fromRad;
  while (d > Math.PI) d -= 2.0 * Math.PI;
  while (d <= -Math.PI) d += 2.0 * Math.PI;
  return d;
}

/** Lerps one angle toward another by `t` along the shortest path. */
function _lerpAngleRad(fromRad: number, toRad: number, t: number): number {
  return fromRad + _shortestAngleDeltaRad(fromRad, toRad) * t;
}

/** Returns the bearing from anchor → enemy in radians. */
function _bearingToCluster(anchorXWorld: number, anchorYWorld: number, c: ClusterState): number {
  return Math.atan2(c.positionYWorld - anchorYWorld, c.positionXWorld - anchorXWorld);
}

/** Applies SWORD_DAMAGE to enemies inside the slash cone, once per slash. */
function _applySlashHits(
  world: WorldState,
  anchorXWorld: number,
  anchorYWorld: number,
  centerAngleRad: number,
  reachWorld: number,
): void {
  const reachSq = reachWorld * reachWorld;
  const limit = Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS);
  for (let ci = 0; ci < limit; ci++) {
    if (_slashHitFlags[ci] === 1) continue;
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;
    if (c.isPlayerFlag === 1) continue;

    const dx = c.positionXWorld - anchorXWorld;
    const dy = c.positionYWorld - anchorYWorld;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;

    const bearingRad = Math.atan2(dy, dx);
    const angleDelta = _shortestAngleDeltaRad(centerAngleRad, bearingRad);
    if (Math.abs(angleDelta) > SLASH_HALF_ARC_RAD) continue;

    // Hit!
    _slashHitFlags[ci] = 1;
    // ODC handles its own damage routing (ring protection, shield flash, etc.)
    // Compute hit position at the exposed ring radius in the direction from cluster→anchor,
    // so applyODCHit correctly identifies which ring (or core) was struck.
    if (c.isOrbitalDustCoreFlag === 1) {
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dx / dist; // direction from cluster toward anchor
      const ny = -dy / dist;
      const exposedRing = c.orbitalDustCoreExposedRing;
      const isLarge = c.isOrbitalDustCoreLargeFlag;
      const radii = isLarge === 1 ? ODC_LARGE_RING_RADII : ODC_SMALL_RING_RADII;
      const ringCount = isLarge === 1 ? ODC_LARGE_RING_COUNT : ODC_SMALL_RING_COUNT;
      const hitR = exposedRing >= ringCount ? 0 : radii[exposedRing];
      const hitX = c.positionXWorld + nx * hitR;
      const hitY = c.positionYWorld + ny * hitR;
      applyODCHit(world, ci, hitX, hitY, SWORD_DAMAGE);
      continue;
    }
    c.healthPoints -= SWORD_DAMAGE;
    if (c.healthPoints <= 0) {
      c.healthPoints = 0;
      c.isAliveFlag = 0;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Drives the sword state machine for one tick.  Called from
 * applyPlayerWeaveCombat() in weaveCombat.ts when the player has equipped
 * WEAVE_SHIELD_SWORD as their secondary weave.
 *
 * Returns `true` when the shield crescent should be applied this tick.
 * This is only true once the guard swipe (GUARD_SLASHING) has completed
 * and the sword has entered SHIELDING state.  Returning false during the
 * GUARD_FORMING / GUARD_SLASHING states suppresses the crescent so the
 * "sword cuts open into shield" transition is visually uninterrupted.
 *
 * @param isShieldHeld  True when the player is holding right mouse button.
 */
export function tickSwordWeave(
  world: WorldState,
  player: ClusterState,
  isShieldHeld: boolean,
): boolean {
  // ── Dormant guard: no motes configured → sword stays hidden in ORBIT ────
  // When the player has no mote slots (no dust bound to the secondary weave),
  // the sword cannot exist.  Keep the FSM in ORBIT so the renderer skips
  // drawing, and return false so no shield crescent is attempted via this path.
  if (world.moteSlotCount === 0) {
    world.swordWeaveStateEnum = SWORD_STATE_ORBIT;
    return false;
  }

  // ── Phase 6: compute current blade length from available motes ──────────
  const availableCount = getAvailableMoteSlotCount(world);
  const activeSwordMoteCount = Math.min(MAX_SWORD_BLADE_MOTES, availableCount);
  const lengthRatio = activeSwordMoteCount / MAX_SWORD_BLADE_MOTES;
  world.swordWeaveLengthRatio = lengthRatio;
  const currentReachWorld = SWORD_REACH_WORLD * Math.max(lengthRatio, 0.0);

  // ── Hand anchor ─────────────────────────────────────────────────────────
  _computeHandAnchor(player, _handAnchorScratch);
  world.swordWeaveHandAnchorXWorld = _handAnchorScratch.xWorld;
  world.swordWeaveHandAnchorYWorld = _handAnchorScratch.yWorld;

  // Restful "ready" angle depends on facing direction.
  const readyAngleRad = player.isFacingLeftFlag === 1 ? READY_ANGLE_LEFT_RAD : READY_ANGLE_RIGHT_RAD;
  const facingSign = player.isFacingLeftFlag === 1 ? -1.0 : 1.0;

  // ── Phase 7: detect RMB press (rising edge) ──────────────────────────────
  const isInShieldOrGuardState =
    world.swordWeaveStateEnum === SWORD_STATE_SHIELDING     ||
    world.swordWeaveStateEnum === SWORD_STATE_GUARD_FORMING ||
    world.swordWeaveStateEnum === SWORD_STATE_GUARD_SLASHING;

  // Rising edge: shield was NOT active (we were not in a guard/shield state)
  // and now it IS held — begin the guard sequence.
  const guardPressed = isShieldHeld && !isInShieldOrGuardState;

  if (guardPressed) {
    // Decide entry point based on current sword readiness:
    // - Idle/orbit → fast guard form then guard slash
    // - Any other active state → skip forming, jump straight to guard slash
    const canSkipGuardForm =
      world.swordWeaveStateEnum === SWORD_STATE_READY      ||
      world.swordWeaveStateEnum === SWORD_STATE_WINDUP     ||
      world.swordWeaveStateEnum === SWORD_STATE_SLASHING   ||
      world.swordWeaveStateEnum === SWORD_STATE_RECOVERING;
    if (canSkipGuardForm) {
      world.swordWeaveStateEnum = SWORD_STATE_GUARD_SLASHING;
    } else {
      world.swordWeaveStateEnum = SWORD_STATE_GUARD_FORMING;
    }
    world.swordWeaveStateTicksElapsed = 0;
    world.swordWeaveTargetClusterIndex = -1;
    _slashHitFlags.fill(0);
  }

  // RMB released while in any guard/shield state → return to recovering.
  if (!isShieldHeld && isInShieldOrGuardState) {
    world.swordWeaveStateEnum = SWORD_STATE_RECOVERING;
    world.swordWeaveStateTicksElapsed = 0;
    world.swordWeaveTargetClusterIndex = -1;
    // Caller will release block-mode particles.
    return false;
  }

  // ── Shield mode: crescent only once SHIELDING state is reached ──────────
  if (world.swordWeaveStateEnum === SWORD_STATE_SHIELDING) {
    world.swordWeaveStateTicksElapsed++;
    // When shielding, point the (invisible) sword along the aim direction so
    // the renderer's ready-stance crossguard fades cleanly.
    const aimAngleRad = Math.atan2(world.playerWeaveAimDirYWorld, world.playerWeaveAimDirXWorld);
    world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, aimAngleRad, 0.25);
    return true;  // ← crescent should be active
  }

  // Coming OUT of SHIELDING state via !isShieldHeld is handled above.
  // If somehow we're in SHIELDING with RMB still held (handled above), return.

  // ── Coming OUT of ORBIT: begin forming ────────────────────────────────────
  if (world.swordWeaveStateEnum === SWORD_STATE_ORBIT) {
    world.swordWeaveStateEnum = SWORD_STATE_FORMING;
    world.swordWeaveStateTicksElapsed = 0;
  }

  // ── Main FSM ──────────────────────────────────────────────────────────────
  switch (world.swordWeaveStateEnum) {
    case SWORD_STATE_FORMING: {
      world.swordWeaveStateTicksElapsed++;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.18);
      if (world.swordWeaveStateTicksElapsed >= SWORD_FORMING_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_READY;
        world.swordWeaveStateTicksElapsed = 0;
      }
      break;
    }

    case SWORD_STATE_READY: {
      world.swordWeaveStateTicksElapsed++;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.20);

      // Phase 6: only enter windup if blade has at least one mote.
      if (activeSwordMoteCount > 0) {
        // Phase 4: use circle-of-influence radius for detection.
        const influenceRadiusWorld = getCircleOfInfluenceRadiusWorld(world);
        const targetIndex = _findNearestEnemyIndex(world, _handAnchorScratch.xWorld, _handAnchorScratch.yWorld, influenceRadiusWorld);
        if (targetIndex !== -1) {
          world.swordWeaveTargetClusterIndex = targetIndex;
          world.swordWeaveStateEnum = SWORD_STATE_WINDUP;
          world.swordWeaveStateTicksElapsed = 0;
        }
      }
      break;
    }

    case SWORD_STATE_WINDUP: {
      world.swordWeaveStateTicksElapsed++;
      const targetCluster = _resolveLiveTarget(world);
      if (targetCluster === null) {
        world.swordWeaveStateEnum = SWORD_STATE_RECOVERING;
        world.swordWeaveStateTicksElapsed = 0;
        break;
      }
      const bearingRad = _bearingToCluster(_handAnchorScratch.xWorld, _handAnchorScratch.yWorld, targetCluster);
      const windupAngleRad = bearingRad - WINDUP_PULL_BACK_RAD * facingSign;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, windupAngleRad, 0.30);

      if (world.swordWeaveStateTicksElapsed >= SWORD_WINDUP_TICKS) {
        const startAngleRad = bearingRad - SLASH_HALF_ARC_RAD * facingSign;
        const endAngleRad   = bearingRad + SLASH_HALF_ARC_RAD * facingSign;
        world.swordWeaveSlashStartAngleRad = startAngleRad;
        world.swordWeaveSlashEndAngleRad   = endAngleRad;
        world.swordWeaveAngleRad           = startAngleRad;
        world.swordWeaveStateEnum          = SWORD_STATE_SLASHING;
        world.swordWeaveStateTicksElapsed  = 0;
        _slashHitFlags.fill(0);
      }
      break;
    }

    case SWORD_STATE_SLASHING: {
      world.swordWeaveStateTicksElapsed++;
      const t = Math.min(1.0, world.swordWeaveStateTicksElapsed / SWORD_SLASH_TICKS);
      const eased = t * t * (3.0 - 2.0 * t);
      const startRad = world.swordWeaveSlashStartAngleRad;
      const endRad   = world.swordWeaveSlashEndAngleRad;
      const sweepDelta = _shortestAngleDeltaRad(startRad, endRad);
      const currentAngleRad = startRad + sweepDelta * eased;
      world.swordWeaveAngleRad = currentAngleRad;

      // Phase 6: hit detection uses current (possibly reduced) reach.
      _applySlashHits(world, _handAnchorScratch.xWorld, _handAnchorScratch.yWorld, currentAngleRad, currentReachWorld);

      if (world.swordWeaveStateTicksElapsed >= SWORD_SLASH_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_RECOVERING;
        world.swordWeaveStateTicksElapsed = 0;
      }
      break;
    }

    case SWORD_STATE_RECOVERING: {
      world.swordWeaveStateTicksElapsed++;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.15);
      if (world.swordWeaveStateTicksElapsed >= SWORD_RECOVERY_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_READY;
        world.swordWeaveStateTicksElapsed = 0;
        world.swordWeaveTargetClusterIndex = -1;
      }
      break;
    }

    // ── Phase 7: guard states ──────────────────────────────────────────────

    case SWORD_STATE_GUARD_FORMING: {
      world.swordWeaveStateTicksElapsed++;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.40);
      if (world.swordWeaveStateTicksElapsed >= SWORD_GUARD_FORMING_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_GUARD_SLASHING;
        world.swordWeaveStateTicksElapsed = 0;
        _slashHitFlags.fill(0);
        // Pre-compute guard slash arc from current aim direction.
        const aimAngleRad = Math.atan2(world.playerWeaveAimDirYWorld, world.playerWeaveAimDirXWorld);
        world.swordWeaveSlashStartAngleRad = aimAngleRad - SLASH_HALF_ARC_RAD * facingSign;
        world.swordWeaveSlashEndAngleRad   = aimAngleRad + SLASH_HALF_ARC_RAD * facingSign;
        world.swordWeaveAngleRad           = world.swordWeaveSlashStartAngleRad;
      }
      break;
    }

    case SWORD_STATE_GUARD_SLASHING: {
      world.swordWeaveStateTicksElapsed++;
      const t = Math.min(1.0, world.swordWeaveStateTicksElapsed / SWORD_SLASH_TICKS);
      const eased = t * t * (3.0 - 2.0 * t);
      const startRad = world.swordWeaveSlashStartAngleRad;
      const endRad   = world.swordWeaveSlashEndAngleRad;
      const sweepDelta = _shortestAngleDeltaRad(startRad, endRad);
      const currentAngleRad = startRad + sweepDelta * eased;
      world.swordWeaveAngleRad = currentAngleRad;

      // Phase 6: guard slash hits also use current reach.
      if (activeSwordMoteCount > 0) {
        _applySlashHits(world, _handAnchorScratch.xWorld, _handAnchorScratch.yWorld, currentAngleRad, currentReachWorld);
      }

      if (world.swordWeaveStateTicksElapsed >= SWORD_SLASH_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_SHIELDING;
        world.swordWeaveStateTicksElapsed = 0;
      }
      break;
    }

    default: {
      world.swordWeaveStateEnum = SWORD_STATE_FORMING;
      world.swordWeaveStateTicksElapsed = 0;
      break;
    }
  }

  return false;  // crescent not active during sword states
}

/** Returns the live target cluster, or null if it has died/become invalid. */
function _resolveLiveTarget(world: WorldState): ClusterState | null {
  const idx = world.swordWeaveTargetClusterIndex;
  if (idx < 0 || idx >= world.clusters.length) return null;
  const c = world.clusters[idx];
  if (c.isAliveFlag === 0 || c.isPlayerFlag === 1) return null;
  return c;
}

// ── Stage 3: independent Sword Weave (press-driven single crescent swipe) ────
//
// Unlike the legacy `tickSwordWeave` FSM above (auto-swing + guard-swipe,
// driven by the single equipped-secondary-weave slot and only reachable in
// `combatMode === 'legacy'`), this is the new independently-unlockable Sword
// Weave driven by `secondaryWeaveGesture.ts` press events. It is a single
// press-time-aimed crescent swipe: no continuous retarget once started, no
// idle auto-target/auto-swing, swept angular-interval collision (not
// single-angle) so a fast swing cannot tunnel past an enemy, and a
// resettable per-gesture hit registry so each enemy takes damage at most
// once per swipe.

/** Ticks the new sword swipe takes to complete (press → recovery-free end). */
export const NEW_SWORD_SLASH_TICKS = 10;
/**
 * Crescent geometry (task section 3). The blade STAGES behind the aim, then
 * sweeps forward around the player to terminate in front of the aim:
 *   startAngle = aim + STAGE_BACK * swing   (rear staging)
 *   endAngle   = aim − FRONT_LEAD  * swing   (front of aim)
 * so the total sweep is ≈ π (a strong crescent that passes through the aim
 * direction near the end).
 */
const NEW_SWORD_STAGE_BACK_RAD = Math.PI * 0.85;
const NEW_SWORD_FRONT_LEAD_RAD = Math.PI * 0.15;
/** Whole-number damage applied to each enemy hit once per swipe. */
const NEW_SWORD_DAMAGE = 2;

/**
 * Fraction of the swipe the motes spend "shooting" from orbit into the rear
 * staging arc before the forward sweep begins. Small, so the staging feels
 * like an explosive wind-up, not a slow drift.
 */
const NEW_SWORD_STAGE_FRACTION = 0.18;
/** Base crescent radius (world units) at which the leading mote sweeps. */
const NEW_SWORD_CRESCENT_RADIUS_WORLD = 9.0;
/** Extra radius (world units) per rank — each mote sits farther out than the preceding. */
const NEW_SWORD_RANK_RADIAL_STEP_WORLD = 1.4;
/** Angular lag (radians) per rank — each mote trails slightly behind the preceding. */
const NEW_SWORD_RANK_ANGLE_LAG_RAD = 0.14;

/** Per-gesture hit registry for the new sword swipe — reset at swipe start. */
const _newSwordHitFlags = new Uint8Array(MAX_HIT_REGISTRY_SLOTS);

/** Computes the hand anchor position for the new sword, mirroring the legacy formula. */
export function computeNewSwordHandAnchor(player: ClusterState, out: { xWorld: number; yWorld: number }): void {
  const facingSign = player.isFacingLeftFlag === 1 ? -1.0 : 1.0;
  out.xWorld = player.positionXWorld + HAND_ANCHOR_X_OFFSET_WORLD * facingSign;
  out.yWorld = player.positionYWorld + HAND_ANCHOR_Y_OFFSET_WORLD;
}

const _newSwordAnchorScratch = { xWorld: 0, yWorld: 0 };

/**
 * Starts a new sword swipe using the gesture's press-time aim world position.
 * Reach scales from currently-available ordinary motes using the same
 * formula as the legacy sword (`SWORD_REACH_WORLD * lengthRatio`). If zero
 * motes are available, the swipe still runs its full animation (so input is
 * consumed cleanly) but with zero reach, so it deals no damage — it is NOT a
 * full-length fallback blade.
 */
export function startNewSwordSwipe(
  world: WorldState,
  player: ClusterState,
  gestureId: number,
  pressAimXWorld: number,
  pressAimYWorld: number,
): void {
  computeNewSwordHandAnchor(player, _newSwordAnchorScratch);
  const anchorX = _newSwordAnchorScratch.xWorld;
  const anchorY = _newSwordAnchorScratch.yWorld;

  const availableCount = getAvailableMoteSlotCount(world);
  const activeMoteCount = Math.min(MAX_SWORD_BLADE_MOTES, availableCount);
  const lengthRatio = activeMoteCount / MAX_SWORD_BLADE_MOTES;

  const dx = pressAimXWorld - anchorX;
  const dy = pressAimYWorld - anchorY;
  const aimAngleRad = (dx * dx + dy * dy) > 1e-9 ? Math.atan2(dy, dx) : 0;

  // Swing counter-clockwise for a right-facing player, mirrored when facing
  // left, so the crescent always winds up behind the player and cuts forward.
  const swingSign = player.isFacingLeftFlag === 1 ? -1.0 : 1.0;
  const startAngleRad = aimAngleRad + NEW_SWORD_STAGE_BACK_RAD * swingSign;
  const endAngleRad   = aimAngleRad - NEW_SWORD_FRONT_LEAD_RAD * swingSign;

  world.newSwordActiveFlag       = 1;
  world.newSwordGestureId        = gestureId;
  world.newSwordTicksElapsed     = 0;
  world.newSwordAimAngleRad      = aimAngleRad;
  world.newSwordStartAngleRad    = startAngleRad;
  world.newSwordEndAngleRad      = endAngleRad;
  world.newSwordCurrentAngleRad  = startAngleRad;
  world.newSwordHandAnchorXWorld = anchorX;
  world.newSwordHandAnchorYWorld = anchorY;
  world.newSwordReachWorld       = SWORD_REACH_WORLD * Math.max(lengthRatio, 0.0);
  world.newSwordToShieldTransition01 = 0;
  _newSwordHitFlags.fill(0);

  // Reserve the player's available motes as the actual blade. Each participating
  // mote records its pre-swipe position so it can "shoot" from orbit into the
  // rear staging arc, and is marked BEHAVIOR_MODE_SWORD_SLASH so integration,
  // binding and the Shield crescent leave it fully under sword control.
  world.newSwordMoteParticleIndex.fill(-1);
  world.newSwordMoteCount = 0;
  const available = getAvailableOrderedMoteSlots(world);
  const bladeCount = Math.min(MAX_SWORD_SLASH_MOTES, available.count);
  for (let rank = 0; rank < bladeCount; rank++) {
    const pidx = world.moteSlotParticleIndex[available.indices[rank]];
    if (pidx < 0 || pidx >= world.particleCount || world.isAliveFlag[pidx] === 0) continue;
    const r = world.newSwordMoteCount;
    world.newSwordMoteParticleIndex[r] = pidx;
    world.newSwordMoteFromXWorld[r]    = world.positionXWorld[pidx];
    world.newSwordMoteFromYWorld[r]    = world.positionYWorld[pidx];
    world.behaviorMode[pidx]           = BEHAVIOR_MODE_SWORD_SLASH;
    world.newSwordMoteCount++;
  }
}

/** Eases 0..1 with a fast, decisive ease-out (for the explosive staging shot). */
function _easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Smoothstep 0..1 for the forward crescent sweep. */
function _smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Drives every reserved sword mote to its crescent position for progress
 * `t01` (0..1 across the whole swipe). Motes shoot from their pre-swipe
 * position into the rear staging arc during the first NEW_SWORD_STAGE_FRACTION,
 * then sweep forward; each successive mote trails slightly behind and sits
 * slightly farther out, forming a layered claw-like crescent.
 */
function _driveSwordMotes(world: WorldState, t01: number): void {
  const startRad = world.newSwordStartAngleRad;
  const endRad   = world.newSwordEndAngleRad;
  const sweepDelta = endRad - startRad;
  const cx = world.newSwordHandAnchorXWorld;
  const cy = world.newSwordHandAnchorYWorld;
  const swingSign = sweepDelta >= 0 ? 1 : -1;

  const inStaging = t01 < NEW_SWORD_STAGE_FRACTION;
  const sweepT = inStaging ? 0 : _smoothstep((t01 - NEW_SWORD_STAGE_FRACTION) / (1 - NEW_SWORD_STAGE_FRACTION));
  const baseAngle = startRad + sweepDelta * sweepT;

  for (let r = 0; r < world.newSwordMoteCount; r++) {
    const pidx = world.newSwordMoteParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount || world.isAliveFlag[pidx] === 0) continue;

    const angle = baseAngle - NEW_SWORD_RANK_ANGLE_LAG_RAD * r * swingSign;
    const radius = NEW_SWORD_CRESCENT_RADIUS_WORLD + NEW_SWORD_RANK_RADIAL_STEP_WORLD * r;
    const targetX = cx + Math.cos(angle) * radius;
    const targetY = cy + Math.sin(angle) * radius;

    if (inStaging) {
      // Shoot from the pre-swipe orbit position into the rear staging point.
      const s = _easeOutQuad(t01 / NEW_SWORD_STAGE_FRACTION);
      world.positionXWorld[pidx] = world.newSwordMoteFromXWorld[r] + (targetX - world.newSwordMoteFromXWorld[r]) * s;
      world.positionYWorld[pidx] = world.newSwordMoteFromYWorld[r] + (targetY - world.newSwordMoteFromYWorld[r]) * s;
    } else {
      world.positionXWorld[pidx] = targetX;
      world.positionYWorld[pidx] = targetY;
    }
    world.velocityXWorld[pidx] = 0;
    world.velocityYWorld[pidx] = 0;
    world.behaviorMode[pidx] = BEHAVIOR_MODE_SWORD_SLASH;
  }
}

/** Releases every reserved sword mote back to Storm following (behaviorMode 0). */
function _releaseSwordMotes(world: WorldState): void {
  for (let r = 0; r < world.newSwordMoteCount; r++) {
    const pidx = world.newSwordMoteParticleIndex[r];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.behaviorMode[pidx] === BEHAVIOR_MODE_SWORD_SLASH) {
      world.behaviorMode[pidx] = 0;
    }
  }
  world.newSwordMoteCount = 0;
  world.newSwordMoteParticleIndex.fill(-1);
}

/**
 * Advances the in-progress new-sword swipe by one tick. Returns true once the
 * swipe has completed this tick (caller should then clear `newSwordActiveFlag`
 * and, if the gesture is still held and Shield is unlocked, hand the same
 * motes to the shield crescent — see secondaryWeaveCoordinator.ts).
 */
export function tickNewSwordSwipe(world: WorldState): boolean {
  if (world.newSwordActiveFlag === 0) return true;

  world.newSwordTicksElapsed++;
  const t = Math.min(1.0, world.newSwordTicksElapsed / NEW_SWORD_SLASH_TICKS);

  // Sweep angle follows the staged crescent (rear staging during the first
  // NEW_SWORD_STAGE_FRACTION, then a smooth forward sweep to the front).
  const startAngleRad = world.newSwordStartAngleRad;
  const endAngleRad   = world.newSwordEndAngleRad;
  const inStaging = t < NEW_SWORD_STAGE_FRACTION;
  const sweepT = inStaging ? 0 : _smoothstep((t - NEW_SWORD_STAGE_FRACTION) / (1 - NEW_SWORD_STAGE_FRACTION));

  // Swept angular-interval collision: test every enemy against the arc swept
  // THIS tick (previous angle → current angle), not just the current sample,
  // so a fast swipe cannot skip past an enemy between ticks.
  const prevAngleRad = world.newSwordCurrentAngleRad;
  const currentAngleRad = startAngleRad + (endAngleRad - startAngleRad) * sweepT;
  world.newSwordCurrentAngleRad = currentAngleRad;

  // Drive the actual motes along the crescent (identities preserved).
  _driveSwordMotes(world, t);

  if (world.newSwordReachWorld > 0) {
    _applySweptSlashHits(
      world,
      world.newSwordHandAnchorXWorld,
      world.newSwordHandAnchorYWorld,
      prevAngleRad,
      currentAngleRad,
      world.newSwordReachWorld,
    );
  }

  if (world.newSwordTicksElapsed >= NEW_SWORD_SLASH_TICKS) {
    world.newSwordActiveFlag = 0;
    // Release the blade motes so the sword→shield handoff (or Storm) can claim
    // them in place next tick — no stale sword control persists.
    _releaseSwordMotes(world);
    return true;
  }
  return false;
}

/**
 * Applies NEW_SWORD_DAMAGE to enemies whose bearing falls within the swept
 * angular interval [min(prev,current), max(prev,current)] (clamped to the
 * swipe's total arc), each enemy hit at most once per swipe via the
 * per-gesture hit registry.
 */
function _applySweptSlashHits(
  world: WorldState,
  anchorXWorld: number,
  anchorYWorld: number,
  prevAngleRad: number,
  currentAngleRad: number,
  reachWorld: number,
): void {
  const reachSq = reachWorld * reachWorld;
  const loAngle = Math.min(prevAngleRad, currentAngleRad);
  const hiAngle = Math.max(prevAngleRad, currentAngleRad);
  const limit = Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS);

  for (let ci = 0; ci < limit; ci++) {
    if (_newSwordHitFlags[ci] === 1) continue;
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;
    if (c.isPlayerFlag === 1) continue;

    const dx = c.positionXWorld - anchorXWorld;
    const dy = c.positionYWorld - anchorYWorld;
    const distSq = dx * dx + dy * dy;
    if (distSq > reachSq) continue;

    const bearingRad = Math.atan2(dy, dx);
    // Normalize bearing into the same winding as [loAngle, hiAngle] by
    // shifting by full turns until it falls within [loAngle - 2π, hiAngle + 2π].
    let normalizedBearing = bearingRad;
    while (normalizedBearing < loAngle - Math.PI) normalizedBearing += 2.0 * Math.PI;
    while (normalizedBearing > hiAngle + Math.PI) normalizedBearing -= 2.0 * Math.PI;
    if (normalizedBearing < loAngle || normalizedBearing > hiAngle) continue;

    _newSwordHitFlags[ci] = 1;
    if (c.isOrbitalDustCoreFlag === 1) {
      const dist = Math.sqrt(distSq) || 1;
      const nx = -dx / dist;
      const ny = -dy / dist;
      const exposedRing = c.orbitalDustCoreExposedRing;
      const isLarge = c.isOrbitalDustCoreLargeFlag;
      const radii = isLarge === 1 ? ODC_LARGE_RING_RADII : ODC_SMALL_RING_RADII;
      const ringCount = isLarge === 1 ? ODC_LARGE_RING_COUNT : ODC_SMALL_RING_COUNT;
      const hitR = exposedRing >= ringCount ? 0 : radii[exposedRing];
      applyODCHit(world, ci, c.positionXWorld + nx * hitR, c.positionYWorld + ny * hitR, NEW_SWORD_DAMAGE);
      continue;
    }
    c.healthPoints -= NEW_SWORD_DAMAGE;
    if (c.healthPoints <= 0) {
      c.healthPoints = 0;
      c.isAliveFlag = 0;
    }
  }
}

/**
 * Resets all new-sword transient state (cancel / room teardown). Releases any
 * reserved blade motes back to Storm following first (guarded by particleCount,
 * so it is safe even after the particle buffer has been rebuilt — stale indices
 * simply won't be in BEHAVIOR_MODE_SWORD_SLASH and are skipped).
 */
export function resetNewSwordState(world: WorldState): void {
  _releaseSwordMotes(world);
  world.newSwordActiveFlag           = 0;
  world.newSwordGestureId            = -1;
  world.newSwordTicksElapsed         = 0;
  world.newSwordAimAngleRad          = 0;
  world.newSwordStartAngleRad        = 0;
  world.newSwordEndAngleRad          = 0;
  world.newSwordCurrentAngleRad      = 0;
  world.newSwordHandAnchorXWorld     = 0;
  world.newSwordHandAnchorYWorld     = 0;
  world.newSwordReachWorld           = 0;
  world.newSwordToShieldTransition01 = 0;
  world.newSwordMoteCount            = 0;
  world.newSwordMoteParticleIndex.fill(-1);
  _newSwordHitFlags.fill(0);
}

// ── Future work (intentionally unimplemented for MVP) ────────────────────────
//
// • Compressed segment data model: per-segment logical mote count + durability.
// • Multi-dust blade ratios derived from the player's equipped dust loadout.
// • Energy preservation: on shield→sword transition, reuse remaining energy.
// • Hand/arm anchor tied to a real player skeleton.
// • Hitstop and polished slash VFX.
