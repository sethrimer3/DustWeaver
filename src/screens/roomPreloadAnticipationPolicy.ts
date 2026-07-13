/**
 * Room preload anticipation policy — BUILD 443
 *
 * Stateless, Node-safe module that decides which adjacent room(s) should
 * receive urgent preparation work based on the player's current position and
 * velocity.  All side effects are delegated through injected ports; this
 * module owns no queues, caches, workers, timers, or animation frames.
 *
 * Two policies run each frame:
 *
 *  1. Proximity policy — when the player is within
 *     URGENT_PRELOAD_PROXIMITY_BLOCKS of a boundary facing a transition, boost
 *     that target's runtime-cache priority, decode its theme sprites and
 *     background, ensure its render-chunk prewarm task exists, and raise its
 *     resident build to priority 1.  Only the first authored match fires.
 *
 *  2. Velocity-direction policy — when the player's dominant velocity axis
 *     exceeds MIN_VEL_DIRECTION, raise the first matching-direction
 *     transition's resident build to priority 2.
 *
 * Neither policy deduplicates across both policies; the ResidentBuildScheduler
 * coalesces and never downgrades priority.
 */

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

// ── Constants ────────────────────────────────────────────────────────────────

/** Medium blocks from a room boundary at which proximity preload triggers. */
const URGENT_PRELOAD_PROXIMITY_BLOCKS = 10;

/** Minimum per-axis velocity (world units/tick) to enable direction policy. */
const MIN_VEL_DIRECTION = 1.0;

// ── Direction helper ─────────────────────────────────────────────────────────

export type TransitionDir = 'left' | 'right' | 'up' | 'down';

/**
 * Derive the dominant travel direction from velocity components.
 * Returns `undefined` when neither axis exceeds `MIN_VEL_DIRECTION`.
 *
 * Tie rule: horizontal wins when |vx| === |vy|.
 * Strict threshold: exactly ±1.0 does NOT qualify.
 *
 * NOTE: semantics deliberately match the gameScreen.ts inline block, not the
 * slightly different `vx >= 0` used in roomRenderChunkWarmScheduler.ts's
 * post-transition velocity ordering.  The cases differ only when vx === 0,
 * which is unreachable when |vx| > 1 is required on the dominant axis.
 */
export function dominantVelocityDirection(vx: number, vy: number): TransitionDir | undefined {
  const absX = Math.abs(vx);
  const absY = Math.abs(vy);
  if (absX <= MIN_VEL_DIRECTION && absY <= MIN_VEL_DIRECTION) return undefined;
  if (absX >= absY) return vx > 0 ? 'right' : 'left';
  return vy > 0 ? 'down' : 'up';
}

// ── Proximity helper ─────────────────────────────────────────────────────────

/**
 * Return the first transition in authored order for which the player is within
 * URGENT_PRELOAD_PROXIMITY_BLOCKS of the boundary it faces, or `undefined` if
 * none qualifies.
 *
 * @param px  Player position in room-local X (world units).
 * @param py  Player position in room-local Y (world units).
 * @param room  Current room definition.
 */
export function selectProximityTarget(
  px: number,
  py: number,
  room: RoomDef,
): RoomTransitionDef | undefined {
  const thresh = URGENT_PRELOAD_PROXIMITY_BLOCKS * BLOCK_SIZE_MEDIUM;
  for (const t of room.transitions) {
    let near = false;
    switch (t.direction) {
      case 'right': near = px >= (room.widthBlocks  - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
      case 'left':  near = px <= thresh; break;
      case 'down':  near = py >= (room.heightBlocks - URGENT_PRELOAD_PROXIMITY_BLOCKS) * BLOCK_SIZE_MEDIUM; break;
      case 'up':    near = py <= thresh; break;
    }
    if (near) return t;
  }
  return undefined;
}

/**
 * Return the first transition in authored order whose direction matches
 * `dir`, or `undefined` if none matches.
 */
export function selectVelocityTarget(
  dir: TransitionDir,
  room: RoomDef,
): RoomTransitionDef | undefined {
  for (const t of room.transitions) {
    if (t.direction === dir) return t;
  }
  return undefined;
}

// ── Dependency ports ─────────────────────────────────────────────────────────

/**
 * External systems the policy delegates side effects to.
 * Create this object once during `startGameScreen`, not once per frame.
 */
export interface RoomPreloadAnticipationPorts {
  /** Returns the runtime-cache entry for a room, or undefined if absent/not started. */
  getRuntimeEntry(roomId: string): { fullyPrepared: boolean } | undefined;

  /** Promote this room to the front of the active preload schedule (no-op when no schedule). */
  prioritizeRuntime(roomId: string): void;

  /** Fire-and-forget: request GPU decode of the room's theme sprites. */
  decodeThemeSprites(roomId: string): void;

  /** Fire-and-forget: request decode of the room's background image. */
  decodeBackground(roomId: string): void;

  /** Ensure a render-chunk prewarm task exists for this room at 'proximity' priority. */
  ensureChunkPrewarm(roomId: string): void;

  /**
   * Returns the resident for a room, or undefined if none exists.
   * `runtimeReady` indicates the world state is built and hot-swap capable.
   */
  getResident(roomId: string): { runtimeReady: boolean } | undefined;

  /** Enqueue the room for background resident build at the given priority. */
  enqueueResidentBuild(roomId: string, priority: 1 | 2, reason: 'proximity' | 'velocityDirection'): void;
}

// ── Main policy call ─────────────────────────────────────────────────────────

/**
 * Minimal player snapshot needed by the policy — extracted from the cluster
 * array by the caller so the policy stays decoupled from cluster internals.
 */
export interface PolicyPlayerState {
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isAliveFlag: 0 | 1;
}

/**
 * Run both preload anticipation policies for one gameplay frame.
 *
 * Call site creates `ports` once during `startGameScreen` and passes it on
 * every frame.  `player` and `room` are existing objects — no copies are made.
 *
 * No-ops when `player` is undefined (cluster missing) or dead.
 */
export function applyRoomPreloadAnticipationPolicy(
  player: PolicyPlayerState | undefined,
  room: RoomDef,
  originXWorld: number,
  originYWorld: number,
  ports: RoomPreloadAnticipationPorts,
): void {
  if (player === undefined || player.isAliveFlag !== 1) return;

  const px = player.positionXWorld - originXWorld;
  const py = player.positionYWorld - originYWorld;

  // ── Proximity policy ─────────────────────────────────────────────────────
  const proxTarget = selectProximityTarget(px, py, room);
  if (proxTarget !== undefined) {
    const tId = proxTarget.targetRoomId;
    const entry = ports.getRuntimeEntry(tId);
    if (entry === undefined || !entry.fullyPrepared) {
      ports.prioritizeRuntime(tId);
      ports.decodeThemeSprites(tId);
      ports.decodeBackground(tId);
    }
    ports.ensureChunkPrewarm(tId);
    const resident = ports.getResident(tId);
    if (resident === undefined || !resident.runtimeReady) {
      ports.enqueueResidentBuild(tId, 1, 'proximity');
    }
  }

  // ── Velocity-direction policy ─────────────────────────────────────────────
  const velDir = dominantVelocityDirection(player.velocityXWorld, player.velocityYWorld);
  if (velDir !== undefined) {
    const velTarget = selectVelocityTarget(velDir, room);
    if (velTarget !== undefined) {
      const vResident = ports.getResident(velTarget.targetRoomId);
      if (vResident === undefined || !vResident.runtimeReady) {
        ports.enqueueResidentBuild(velTarget.targetRoomId, 2, 'velocityDirection');
      }
    }
  }
}
