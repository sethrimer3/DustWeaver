/**
 * playerTransfer.ts
 *
 * Explicit player-state capture, detachment, and restoration across resident
 * WorldState hot-swap room transitions (BUILD 416).
 *
 * Responsibility split
 * ────────────────────
 *  capturePlayerTransferState         — snapshot health, facing direction, and
 *                                       owned non-transient dust particles
 *                                       BEFORE detaching from the outgoing world.
 *  detachPlayerFromResidentWorld      — remove the player cluster and kill all
 *                                       player-owned particles; clear grapple
 *                                       flags so the frozen world is clean.
 *  restoreTransferredPlayerParticles  — write captured particles into the target
 *                                       world after the player cluster has been
 *                                       inserted at clusters[0].
 *
 * Invariants upheld by this module:
 *   • After detachPlayerFromResidentWorld(): no live player cluster, no live
 *     player-owned particles in the outgoing world.
 *   • After restoreTransferredPlayerParticles(): particle buffer count has grown
 *     by exactly `restored` slots; all restored slots belong to newPlayerEntityId.
 */

import type { WorldState } from '../sim/world';
import { MAX_PARTICLES } from '../sim/world';
import type { ParticleKind } from '../sim/particles/kinds';

// ── Capture types ─────────────────────────────────────────────────────────────

/**
 * A snapshot of a single player-owned, non-transient dust particle.
 *
 * All position-dependent fields use player-relative (anchor) coordinates so
 * they remain valid after the player is placed at a different world position.
 *
 * Fields intentionally NOT captured (room-local or always reset on entry):
 *   positionXWorld / positionYWorld  — recomputed from anchor at new spawn
 *   velocityXWorld / velocityYWorld  — zeroed; particle settles into orbit naturally
 *   forceX / forceY                  — zeroed each tick by the force integrator
 *   chargeUnits                      — always 0 for player dust in current codebase
 *   disturbanceFactor                — fluid only; irrelevant for player dust
 *   behaviorMode                     — reset to orbit (0); old attack state is stale
 *   attackModeTicksLeft              — reset to 0 for same reason
 */
export interface CapturedPlayerParticle {
  particleKind:       ParticleKind;
  anchorAngleRad:     number;
  anchorRadiusWorld:  number;
  particleDurability: number;
  respawnDelayTicks:  number;
  weaveSlotId:        number;
  noiseTickSeed:      number;
  massKg:             number;
  lifetimeTicks:      number;
  /** Preserved so the particle respawns at a staggered time rather than all at once. */
  ageTicks:           number;
  /**
   * isAliveFlag from the outgoing world.
   * Dead particles with respawnDelayTicks > 0 are still carried so the regen
   * countdown continues in the new world.
   */
  isAliveFlag:        0 | 1;
}

/**
 * Player state captured from the outgoing world before the player is detached.
 * Carried across a true resident hot-swap room transition.
 */
export interface PlayerTransferSnapshot {
  /** HP from the outgoing world's player cluster. */
  healthPoints:     number;
  /** Sprite facing direction — preserved so the player does not snap on entry. */
  isFacingLeftFlag: 0 | 1;
  /** Entity id of the player in the outgoing world (always 1 in this codebase). */
  ownedEntityId:    number;
  /**
   * Non-transient, player-owned particles captured from the outgoing world.
   * Does not include enemy-owned, background, or transient particles.
   */
  ownedParticles:   CapturedPlayerParticle[];
}

// ── capturePlayerTransferState ────────────────────────────────────────────────

/**
 * Snapshot the player's health, facing direction, and all owned non-transient
 * dust particles from `world`.
 *
 * Must be called BEFORE `detachPlayerFromResidentWorld()` while the player
 * cluster and all owned particles are still live (or dead-with-regen) in the
 * outgoing world.
 *
 * Returns `null` if no player cluster is found at `world.clusters[0]`.
 */
export function capturePlayerTransferState(world: WorldState): PlayerTransferSnapshot | null {
  const player = world.clusters[0];
  if (player === undefined || player.isPlayerFlag !== 1) {
    if (import.meta.env.DEV) {
      console.warn('[playerTransfer] capturePlayerTransferState: no player at clusters[0]');
    }
    return null;
  }

  const ownedParticles: CapturedPlayerParticle[] = [];
  for (let pi = 0; pi < world.particleCount; pi++) {
    if (world.ownerEntityId[pi] !== player.entityId) continue;
    // Skip transient particles — they are room-local effects (stone shards,
    // lava embers, etc.) and must not be carried to the new room.
    if (world.isTransientFlag[pi] === 1) continue;
    ownedParticles.push({
      particleKind:       world.kindBuffer[pi] as ParticleKind,
      anchorAngleRad:     world.anchorAngleRad[pi],
      anchorRadiusWorld:  world.anchorRadiusWorld[pi],
      particleDurability: world.particleDurability[pi],
      respawnDelayTicks:  world.respawnDelayTicks[pi],
      weaveSlotId:        world.weaveSlotId[pi],
      noiseTickSeed:      world.noiseTickSeed[pi],
      massKg:             world.massKg[pi],
      lifetimeTicks:      world.lifetimeTicks[pi],
      ageTicks:           world.ageTicks[pi],
      isAliveFlag:        world.isAliveFlag[pi] as 0 | 1,
    });
  }

  return {
    healthPoints:     player.healthPoints,
    isFacingLeftFlag: player.isFacingLeftFlag,
    ownedEntityId:    player.entityId,
    ownedParticles,
  };
}

// ── detachPlayerFromResidentWorld ─────────────────────────────────────────────

/**
 * Remove the player cluster and kill all player-owned particles in `world`;
 * then clear world-level grapple flags.
 *
 * Must be called AFTER `capturePlayerTransferState()` and BEFORE
 * `freezeRoom()` so the frozen snapshot contains no live player.
 *
 * Postconditions:
 *   • world.clusters[0] is no longer the player (cluster removed).
 *   • No live particles are owned by the detached player entity id.
 *   • All grapple flags are cleared (new room starts without an active grapple).
 */
export function detachPlayerFromResidentWorld(world: WorldState): void {
  if (import.meta.env.DEV) {
    const first = world.clusters[0];
    if (first === undefined || first.isPlayerFlag !== 1) {
      console.error(
        '[playerTransfer] detachPlayerFromResidentWorld: player not at clusters[0] — ' +
        'call capturePlayerTransferState() before detaching.',
      );
    }
  }

  const playerEntityId = world.clusters[0]?.entityId ?? 1;

  // Kill every particle owned by the departing player.
  // Transient and non-transient alike are killed — neither should persist in
  // the frozen world once the player is gone.
  // respawnDelayTicks is cleared so the frozen world won't try to respawn them.
  for (let pi = 0; pi < world.particleCount; pi++) {
    if (world.ownerEntityId[pi] === playerEntityId) {
      world.isAliveFlag[pi]       = 0;
      world.respawnDelayTicks[pi] = 0;
    }
  }

  // Remove the player cluster (always at index 0).
  world.clusters.splice(0, 1);

  // Clear world-level grapple state — the new room starts with a fresh grapple.
  world.isGrappleActiveFlag     = 0;
  world.isGrappleMissActiveFlag = 0;
  world.isGrappleRetractingFlag = 0;
  world.isGrappleZipActiveFlag  = 0;
  world.isGrappleStuckFlag      = 0;
}

// ── restoreTransferredPlayerParticles ─────────────────────────────────────────

/** Result returned by `restoreTransferredPlayerParticles`. */
export interface ParticleRestoreResult {
  restored: number;
  skipped:  number;
}

/**
 * Write captured player particles into `world` after the player cluster has
 * been inserted at `world.clusters[0]`.
 *
 * Particle positions are computed from the new spawn point using the captured
 * anchor angle and radius so the dust cloud appears centred around the player
 * at its new location.
 *
 * Fields always reset on entry (see `CapturedPlayerParticle` JSDoc for rationale):
 *   velocityXWorld / velocityYWorld  → 0
 *   forceX / forceY                  → 0
 *   chargeUnits                      → 0
 *   disturbanceFactor                → 0
 *   behaviorMode                     → 0  (orbit)
 *   attackModeTicksLeft              → 0
 *   isTransientFlag                  → 0
 *
 * If the particle buffer is full, remaining particles are skipped and a DEV
 * warning is logged.  Returns counts for diagnostics.
 */
export function restoreTransferredPlayerParticles(
  world: WorldState,
  snapshot: PlayerTransferSnapshot,
  newPlayerEntityId: number,
  spawnXWorld: number,
  spawnYWorld: number,
): ParticleRestoreResult {
  let restored = 0;
  let skipped  = 0;

  for (const p of snapshot.ownedParticles) {
    if (world.particleCount >= MAX_PARTICLES) {
      skipped++;
      continue;
    }
    const idx = world.particleCount++;

    // Position: anchored to the new spawn point using the preserved orbit parameters.
    world.positionXWorld[idx] = spawnXWorld + Math.cos(p.anchorAngleRad) * p.anchorRadiusWorld;
    world.positionYWorld[idx] = spawnYWorld + Math.sin(p.anchorAngleRad) * p.anchorRadiusWorld;
    world.velocityXWorld[idx] = 0;
    world.velocityYWorld[idx] = 0;
    world.forceX[idx]          = 0;
    world.forceY[idx]          = 0;

    world.massKg[idx]          = p.massKg;
    world.chargeUnits[idx]     = 0;
    world.isAliveFlag[idx]     = p.isAliveFlag;
    world.kindBuffer[idx]      = p.particleKind;
    world.ownerEntityId[idx]   = newPlayerEntityId;

    world.anchorAngleRad[idx]    = p.anchorAngleRad;
    world.anchorRadiusWorld[idx] = p.anchorRadiusWorld;

    world.noiseTickSeed[idx]     = p.noiseTickSeed;
    world.disturbanceFactor[idx] = 0;

    // Combat / behavior — always reset to orbit (0) on room entry; the previous
    // room's attack state is meaningless in the new room.
    world.behaviorMode[idx]        = 0;
    world.particleDurability[idx]  = p.particleDurability;
    world.respawnDelayTicks[idx]   = p.respawnDelayTicks;
    world.attackModeTicksLeft[idx] = 0;

    world.isTransientFlag[idx] = 0;
    world.weaveSlotId[idx]     = p.weaveSlotId;

    world.lifetimeTicks[idx] = p.lifetimeTicks;
    world.ageTicks[idx]      = p.ageTicks;

    restored++;
  }

  return { restored, skipped };
}
