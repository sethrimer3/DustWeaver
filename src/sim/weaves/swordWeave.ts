/**
 * Shield Sword Weave — sword-form upgrade built from Storm/Shield motes.
 *
 * The sword is a separate active weave (WEAVE_SHIELD_SWORD).  When equipped:
 *   • If right mouse is NOT held, the player carries a sword formed from
 *     dust motes that auto-swings at nearby enemies through windup → slash →
 *     recovery states.
 *   • If right mouse IS held, the sword instantly transitions into the
 *     existing Shield Weave crescent (delegated to applyShieldCrescent in
 *     weaveCombat.ts).  When released, it returns to sword-ready behavior.
 *
 * MVP scope:
 *   • The sword is rendered visually on the 2D canvas (see
 *     render/effects/swordWeaveRenderer.ts) but does NOT physically move
 *     individual particles into a sword shape.  This avoids fighting the
 *     existing binding/orbit forces for one frame and keeps the change local.
 *     Particles continue to passively orbit the player while the sword is
 *     in any non-shielding state — the visual sword reads as a "compressed"
 *     representation of those motes.  Future work (compressed segments,
 *     multi-dust ratios, energy preservation) can be layered on later.
 *   • Shield mode is delegated entirely to applyShieldCrescent — no second
 *     shield system is created.
 *
 * Damage:
 *   • During SLASHING the sword scans world.clusters for non-player alive
 *     enemies whose center lies within SWORD_REACH_WORLD of the hand anchor
 *     AND whose bearing lies within ±SLASH_HALF_ARC_RAD of the current sword
 *     angle.  Each enemy is hit at most once per slash via a small Uint8Array
 *     hit registry indexed by world.clusters.indexOf().
 *   • Damage is applied directly (cluster.healthPoints -= SWORD_DAMAGE),
 *     matching the pattern used by tickArrows / arrowWeave.
 *
 * Performance:
 *   • All scratch storage is module-level and pre-allocated.
 *   • No per-tick allocations.
 *   • Enemy scan is O(clusters) per slash tick — rooms typically have <16
 *     enemy clusters, so this is negligible.
 */

import { WorldState } from '../world';
import { ClusterState } from '../clusters/state';

// ── Sword state enum ──────────────────────────────────────────────────────────

export const SWORD_STATE_ORBIT      = 0;
export const SWORD_STATE_FORMING    = 1;
export const SWORD_STATE_READY      = 2;
export const SWORD_STATE_WINDUP     = 3;
export const SWORD_STATE_SLASHING   = 4;
export const SWORD_STATE_RECOVERING = 5;
export const SWORD_STATE_SHIELDING  = 6;

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Maximum visible blade segments rendered along the sword. */
export const MAX_SWORD_BLADE_MOTES = 8;

/** World-space distance from the hand anchor to the sword tip. */
export const SWORD_REACH_WORLD = 16.0;

/** Auto-target scan radius (world units) measured from the hand anchor. */
const AUTO_TARGET_RADIUS_WORLD = 30.0;
const AUTO_TARGET_RADIUS_SQ_WORLD = AUTO_TARGET_RADIUS_WORLD * AUTO_TARGET_RADIUS_WORLD;

/** Ticks the sword spends in each transient state. */
const SWORD_FORMING_TICKS    = 15;
const SWORD_WINDUP_TICKS     = 12;
const SWORD_SLASH_TICKS      = 10;
const SWORD_RECOVERY_TICKS   = 18;

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
 * Finds the nearest non-player, alive enemy cluster within
 * AUTO_TARGET_RADIUS_WORLD of the given anchor point.  Returns the cluster's
 * index in world.clusters, or -1 if none is in range.
 */
function _findNearestEnemyIndex(world: WorldState, anchorXWorld: number, anchorYWorld: number): number {
  let bestIndex = -1;
  let bestDistSq = AUTO_TARGET_RADIUS_SQ_WORLD;
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
): void {
  const reachSq = SWORD_REACH_WORLD * SWORD_REACH_WORLD;
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
 * The caller has already determined whether shield mode is active (right
 * mouse held).  When `isShieldActive` is true this function snaps the sword
 * into SWORD_STATE_SHIELDING and bails out without damage / state work; the
 * caller is responsible for invoking the existing applyShieldCrescent() each
 * tick to position the actual mote particles.
 *
 * When `isShieldActive` is false the function runs the auto-swing FSM:
 *   ORBIT → FORMING → READY ↔ WINDUP → SLASHING → RECOVERING → READY
 */
export function tickSwordWeave(world: WorldState, player: ClusterState, isShieldActive: boolean): void {
  // ── Hand anchor ─────────────────────────────────────────────────────────
  _computeHandAnchor(player, _handAnchorScratch);
  world.swordWeaveHandAnchorXWorld = _handAnchorScratch.xWorld;
  world.swordWeaveHandAnchorYWorld = _handAnchorScratch.yWorld;

  // Restful "ready" angle depends on facing direction.
  const readyAngleRad = player.isFacingLeftFlag === 1 ? READY_ANGLE_LEFT_RAD : READY_ANGLE_RIGHT_RAD;

  // ── Shield mode preempts everything ─────────────────────────────────────
  if (isShieldActive) {
    if (world.swordWeaveStateEnum !== SWORD_STATE_SHIELDING) {
      world.swordWeaveStateEnum = SWORD_STATE_SHIELDING;
      world.swordWeaveStateTicksElapsed = 0;
      world.swordWeaveTargetClusterIndex = -1;
    } else {
      world.swordWeaveStateTicksElapsed++;
    }
    // When shielding, point the (invisible) sword along the aim direction so
    // the renderer's ready-stance crossguard fades cleanly.  Use the existing
    // weave aim direction.
    const aimAngleRad = Math.atan2(world.playerWeaveAimDirYWorld, world.playerWeaveAimDirXWorld);
    world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, aimAngleRad, 0.25);
    return;
  }

  // ── Coming OUT of shielding → start re-forming sword ─────────────────────
  if (world.swordWeaveStateEnum === SWORD_STATE_SHIELDING) {
    world.swordWeaveStateEnum = SWORD_STATE_FORMING;
    world.swordWeaveStateTicksElapsed = 0;
    world.swordWeaveTargetClusterIndex = -1;
  }

  // First-time entry from ORBIT: begin forming.
  if (world.swordWeaveStateEnum === SWORD_STATE_ORBIT) {
    world.swordWeaveStateEnum = SWORD_STATE_FORMING;
    world.swordWeaveStateTicksElapsed = 0;
  }

  switch (world.swordWeaveStateEnum) {
    case SWORD_STATE_FORMING: {
      world.swordWeaveStateTicksElapsed++;
      // Smoothly settle to the ready angle.
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.18);
      if (world.swordWeaveStateTicksElapsed >= SWORD_FORMING_TICKS) {
        world.swordWeaveStateEnum = SWORD_STATE_READY;
        world.swordWeaveStateTicksElapsed = 0;
      }
      break;
    }

    case SWORD_STATE_READY: {
      world.swordWeaveStateTicksElapsed++;
      // Hold the ready pose; passively snap to the ready angle.
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, readyAngleRad, 0.20);

      // Auto-target scan.
      const targetIndex = _findNearestEnemyIndex(world, _handAnchorScratch.xWorld, _handAnchorScratch.yWorld);
      if (targetIndex !== -1) {
        world.swordWeaveTargetClusterIndex = targetIndex;
        world.swordWeaveStateEnum = SWORD_STATE_WINDUP;
        world.swordWeaveStateTicksElapsed = 0;
      }
      break;
    }

    case SWORD_STATE_WINDUP: {
      world.swordWeaveStateTicksElapsed++;
      const targetCluster = _resolveLiveTarget(world);
      if (targetCluster === null) {
        // Target died/expired — abort to recovery.
        world.swordWeaveStateEnum = SWORD_STATE_RECOVERING;
        world.swordWeaveStateTicksElapsed = 0;
        break;
      }
      const bearingRad = _bearingToCluster(_handAnchorScratch.xWorld, _handAnchorScratch.yWorld, targetCluster);
      // Pull back perpendicular-ish to the strike: subtract the wind-up amount.
      const sign = player.isFacingLeftFlag === 1 ? -1.0 : 1.0;
      const windupAngleRad = bearingRad - WINDUP_PULL_BACK_RAD * sign;
      world.swordWeaveAngleRad = _lerpAngleRad(world.swordWeaveAngleRad, windupAngleRad, 0.30);

      if (world.swordWeaveStateTicksElapsed >= SWORD_WINDUP_TICKS) {
        // Lock in the slash arc start/end based on bearing at slash start.
        const startAngleRad = bearingRad - SLASH_HALF_ARC_RAD * sign;
        const endAngleRad   = bearingRad + SLASH_HALF_ARC_RAD * sign;
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
      // Ease-in-out for snappy slash motion.
      const eased = t * t * (3.0 - 2.0 * t);
      const startRad = world.swordWeaveSlashStartAngleRad;
      const endRad   = world.swordWeaveSlashEndAngleRad;
      const sweepDelta = _shortestAngleDeltaRad(startRad, endRad);
      const currentAngleRad = startRad + sweepDelta * eased;
      world.swordWeaveAngleRad = currentAngleRad;

      // Apply hits using the current sword angle as the cone center.
      _applySlashHits(world, _handAnchorScratch.xWorld, _handAnchorScratch.yWorld, currentAngleRad);

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

    default: {
      // Unknown state — reset to forming for safety.
      world.swordWeaveStateEnum = SWORD_STATE_FORMING;
      world.swordWeaveStateTicksElapsed = 0;
      break;
    }
  }
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
