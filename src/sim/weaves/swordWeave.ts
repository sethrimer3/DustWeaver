/**
 * Sword Weave — sword-form ability built from canonical motes.
 *
 * This is the independent press-driven single crescent swipe driven by
 * `secondaryWeaveGesture.ts` press events. It is a single press-time-aimed
 * crescent swipe: no continuous retarget once started, swept angular-interval
 * collision so a fast swing cannot tunnel past an enemy, and a resettable
 * per-gesture hit registry so each enemy takes damage at most once per swipe.
 *
 * Performance:
 *   • All scratch storage is module-level and pre-allocated.
 *   • No per-tick allocations.
 */

import { WorldState, MAX_SWORD_SLASH_MOTES, MAX_CANONICAL_MOTES } from '../world';
import { ClusterState } from '../clusters/state';
import { getAvailableCanonicalMotes, MoteOwnershipState } from './moteOwnership';
import { MAX_HIT_REGISTRY_SLOTS } from './weaveHitRegistryConfig';
import { segmentPointDistanceSq, applyRoutedWeaveDamage } from './weaveCollisionUtils';

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Maximum visible blade segments rendered along the sword. */
export const MAX_SWORD_BLADE_MOTES = 8;

/** World-space distance from the hand anchor to the sword tip at full length. */
export const SWORD_REACH_WORLD = 16.0;

/** Hand anchor offsets relative to player center (world units). */
const HAND_ANCHOR_X_OFFSET_WORLD = 3.0;
const HAND_ANCHOR_Y_OFFSET_WORLD = 0.5;

// ── Stage 3: independent Sword Weave (press-driven single crescent swipe) ────

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

  const available = getAvailableCanonicalMotes(world);
  const availableCount = available.count;
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

  world.newSwordMoteParticleIndex.fill(-1);
  world.newSwordMoteCount = 0;
  const bladeCount = Math.min(MAX_SWORD_SLASH_MOTES, availableCount);
  for (let rank = 0; rank < bladeCount; rank++) {
    const pidx = available.indices[rank];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    const r = world.newSwordMoteCount;
    world.newSwordMoteParticleIndex[r] = pidx;
    const fromX = world.canonicalMoteXWorld[pidx] !== 0 ? world.canonicalMoteXWorld[pidx] : anchorX;
    const fromY = world.canonicalMoteYWorld[pidx] !== 0 ? world.canonicalMoteYWorld[pidx] : anchorY;
    world.newSwordMoteFromXWorld[r]    = fromX;
    world.newSwordMoteFromYWorld[r]    = fromY;
    world.newSwordMotePrevXWorld[r]    = fromX;
    world.newSwordMotePrevYWorld[r]    = fromY;
    world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Sword;
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
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;

    const angle = baseAngle - NEW_SWORD_RANK_ANGLE_LAG_RAD * r * swingSign;
    const radius = NEW_SWORD_CRESCENT_RADIUS_WORLD + NEW_SWORD_RANK_RADIAL_STEP_WORLD * r;
    const targetX = cx + Math.cos(angle) * radius;
    const targetY = cy + Math.sin(angle) * radius;

    if (inStaging) {
      const s = _easeOutQuad(t01 / NEW_SWORD_STAGE_FRACTION);
      world.canonicalMoteXWorld[pidx] = world.newSwordMoteFromXWorld[r] + (targetX - world.newSwordMoteFromXWorld[r]) * s;
      world.canonicalMoteYWorld[pidx] = world.newSwordMoteFromYWorld[r] + (targetY - world.newSwordMoteFromYWorld[r]) * s;
    } else {
      world.canonicalMoteXWorld[pidx] = targetX;
      world.canonicalMoteYWorld[pidx] = targetY;
    }
    world.canonicalMoteVelXWorld[pidx] = 0;
    world.canonicalMoteVelYWorld[pidx] = 0;
    world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Sword;
  }
}

/** Releases every reserved sword mote back to Resting state. */
function _releaseSwordMotes(world: WorldState): void {
  for (let r = 0; r < world.newSwordMoteCount; r++) {
    const pidx = world.newSwordMoteParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    if (world.canonicalMoteOwnership[pidx] === MoteOwnershipState.Sword) {
      world.canonicalMoteOwnership[pidx] = MoteOwnershipState.Resting;
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
  // This angle bookkeeping is retained purely for the renderer's trail
  // visualization (newSwordWeaveRenderer.ts) — hit detection below is driven
  // entirely by the actual mote positions, not this angle.
  const startAngleRad = world.newSwordStartAngleRad;
  const endAngleRad   = world.newSwordEndAngleRad;
  const inStaging = t < NEW_SWORD_STAGE_FRACTION;
  const sweepT = inStaging ? 0 : _smoothstep((t - NEW_SWORD_STAGE_FRACTION) / (1 - NEW_SWORD_STAGE_FRACTION));
  world.newSwordCurrentAngleRad = startAngleRad + (endAngleRad - startAngleRad) * sweepT;

  // Capture each reserved mote's pre-update position, then drive them to
  // their new crescent position — the swept test below covers exactly the
  // path each individual mote traveled this tick (task section 5): visual
  // motes and damage geometry are now the same geometry, at every mote count.
  for (let r = 0; r < world.newSwordMoteCount; r++) {
    const pidx = world.newSwordMoteParticleIndex[r];
    if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;
    world.newSwordMotePrevXWorld[r] = world.canonicalMoteXWorld[pidx];
    world.newSwordMotePrevYWorld[r] = world.canonicalMoteYWorld[pidx];
  }
  _driveSwordMotes(world, t);

  if (world.newSwordReachWorld > 0) {
    _applySweptMoteHits(world);
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
 * Small per-mote hit radius (world units) for sword swept-capsule collision,
 * approximating a blade mote's rendered body + glow footprint. Combined with
 * each enemy's own half-size so larger enemies are correspondingly easier to
 * clip (task section 5 — "give each mote a small canonical hit radius based
 * on its rendered body/glow").
 */
const NEW_SWORD_MOTE_HIT_RADIUS_WORLD = 2.0;

/**
 * Applies NEW_SWORD_DAMAGE to enemies swept by any reserved blade mote's
 * actual previous→current position this tick (a small capsule around each
 * mote's real swept path, not an abstract angular hitbox) — the visual blade
 * and the damage geometry are the same geometry at every mote count and every
 * rank. Each enemy is damaged at most once per swipe via the per-gesture hit
 * registry, checked/set per enemy (not per mote), so multiple motes crossing
 * the same enemy in the same tick still only apply damage once.
 */
function _applySweptMoteHits(world: WorldState): void {
  const limit = Math.min(world.clusters.length, MAX_HIT_REGISTRY_SLOTS);

  for (let ci = 0; ci < limit; ci++) {
    if (_newSwordHitFlags[ci] === 1) continue;
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;
    if (c.isPlayerFlag === 1) continue;

    const enemyRadius = Math.min(c.halfWidthWorld, c.halfHeightWorld);
    const hitRadius = NEW_SWORD_MOTE_HIT_RADIUS_WORLD + enemyRadius;
    const hitRadiusSq = hitRadius * hitRadius;

    let hitByRank = -1;
    for (let r = 0; r < world.newSwordMoteCount; r++) {
      const pidx = world.newSwordMoteParticleIndex[r];
      if (pidx < 0 || pidx >= MAX_CANONICAL_MOTES) continue;

      const distSq = segmentPointDistanceSq(
        world.newSwordMotePrevXWorld[r], world.newSwordMotePrevYWorld[r],
        world.canonicalMoteXWorld[pidx], world.canonicalMoteYWorld[pidx],
        c.positionXWorld, c.positionYWorld,
      );
      if (distSq <= hitRadiusSq) { hitByRank = r; break; }
    }
    if (hitByRank === -1) continue;

    _newSwordHitFlags[ci] = 1;
    const hitPidx = world.newSwordMoteParticleIndex[hitByRank];
    applyRoutedWeaveDamage(world, ci, NEW_SWORD_DAMAGE, world.canonicalMoteXWorld[hitPidx], world.canonicalMoteYWorld[hitPidx]);
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
