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

import { WorldState } from '../world';
import { ClusterState } from '../clusters/state';
import {
  getCircleOfInfluenceRadiusWorld,
  getAvailableMoteSlotCount,
} from '../motes/orderedMoteQueue';

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
const SWORD_DAMAGE = 1.0;

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
  // ── Phase 6: compute current blade length from available motes ──────────
  const availableCount = getAvailableMoteSlotCount(world);
  const activeSwordMoteCount = Math.min(MAX_SWORD_BLADE_MOTES, availableCount);
  const lengthRatio = world.moteSlotCount > 0
    ? activeSwordMoteCount / MAX_SWORD_BLADE_MOTES
    : 1.0;  // full reach when no mote queue configured
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

// ── Future work (intentionally unimplemented for MVP) ────────────────────────
//
// • Compressed segment data model: per-segment logical mote count + durability.
// • Multi-dust blade ratios derived from the player's equipped dust loadout.
// • Energy preservation: on shield→sword transition, reuse remaining energy.
// • Hand/arm anchor tied to a real player skeleton.
// • Hitstop and polished slash VFX.
