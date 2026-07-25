/**
 * Atomic room-creation and transition-linking transactions for the visual
 * world map editor.
 *
 * Both `showCreateLinkedRoomDialog` (editorVisualMapDialogs.ts) and
 * `applyPendingDoorLink` (editorVisualMapLinkPrompt.ts) need to perform a
 * multi-step operation — mutate room-registry transitions on one or two
 * rooms, register a brand-new room, and persist the affected rooms into the
 * campaign store / pending edits / current in-memory room — where any step
 * failing after the first registry mutation would previously leave the
 * registry, the campaign store, and pending edits disagreeing with each
 * other (a "partial link").
 *
 * This module centralises that sequence as three DOM-free transactions:
 *   - `createLinkedRoomTransaction`       — register + link a brand-new room.
 *   - `linkTransitionTransaction`         — link two already-existing doors.
 *   - `clearTargetRoomTransitionOnDiscard` — discard-time cleanup (see below).
 *
 * The first two follow the same shape: validate every prerequisite BEFORE
 * touching anything, mutate the registry, persist, and — if persistence
 * throws — roll every mutation back (registry transitions restored, any
 * newly-registered room fully unregistered and un-persisted) so the state
 * after a failure is bit-for-bit what it was before the transaction started.
 * Callers only report success once both the registry mutation AND
 * persistence have succeeded.
 *
 * The room registry itself (`ROOM_REGISTRY` and its mutators in
 * `../levels/rooms`) is injected via `RoomRegistryOps` rather than imported
 * directly: `../levels/rooms` transitively reads `import.meta.env.BASE_URL`
 * at module scope (via packedCampaignLoader.ts) and cannot be imported under
 * the plain `node --test` runner used by src/tests/**. Injecting the ops
 * keeps this module — and its tests — fully DOM/Vite-free while the
 * production caller (editorController.ts) supplies the real
 * ROOM_REGISTRY-backed implementation.
 */

import type { RoomDef } from '../levels/roomDef';
import type { EditableCampaignSession } from './editableCampaignSession';
import type { EditorRoomData } from './editorState';
import { roomDefToEditorRoomData } from './editorRoomBuilder';
import {
  loadPersistedCampaignRoom,
  persistCreatedCampaignRoom,
  persistSavedCampaignRoom,
} from './campaignRoomPersistence';
import { computeSpawnBlockForMapLink } from './transitionSpawnMath';

// ── Registry ops (injected) ──────────────────────────────────────────────────

/**
 * The subset of `../levels/rooms`'s registry surface this module needs.
 * Production callers pass an object thinly wrapping the real
 * ROOM_REGISTRY-backed functions; tests pass a Map-backed fake.
 */
export interface RoomRegistryOps {
  get(roomId: string): RoomDef | undefined;
  has(roomId: string): boolean;
  register(room: RoomDef): void;
  unregister(roomId: string): void;
  setNameOverride(roomId: string, name: string): void;
  setWorldOverride(roomId: string, worldId: number): void;
  setMapPosition(roomId: string, mapX: number, mapY: number): void;
  setTransitionLink(roomId: string, transitionIndex: number, targetRoomId: string, targetSpawnBlock: readonly [number, number]): boolean;
}

// ── Shared deps / helpers ────────────────────────────────────────────────────

/** Inputs shared by every transaction in this module. */
export interface CoordinatorDeps {
  readonly registry: RoomRegistryOps;
  readonly session: EditableCampaignSession | null | undefined;
  readonly pendingRoomEdits: Map<string, EditorRoomData>;
  /** The room currently open in the editor, or null. Mutated in place when it is a transaction target. */
  readonly currentRoomData: EditorRoomData | null;
  /** Current `state.nextUid` counter. */
  readonly nextUid: number;
}

function fallbackFromRegistry(registry: RoomRegistryOps, roomId: string, startUid: number): { roomData: EditorRoomData; nextUid: number; source: 'legacy-pending-edits' } | null {
  const registryRoomDef = registry.get(roomId);
  if (!registryRoomDef) return null;
  const { data, nextUid } = roomDefToEditorRoomData(registryRoomDef, startUid);
  return { roomData: data, nextUid, source: 'legacy-pending-edits' };
}

/**
 * Synchronizes an existing room's transition target/spawn into persisted
 * storage — patches `state.roomData` in place (and marks it dirty in the
 * store) when the room is the currently-open one, respecting the
 * persistence-cadence rule that ordinary current-room edits stay in memory
 * until an explicit save boundary; otherwise loads/patches/writes the room
 * back immediately via `persistSavedCampaignRoom`, since a non-current room
 * has no in-progress edit session to preserve.
 *
 * Throws if the room or transition cannot be found/persisted — callers are
 * expected to catch this and roll back.
 */
function syncExistingRoomTransition(
  roomId: string,
  transitionIndex: number,
  targetRoomId: string,
  targetSpawnBlock: readonly [number, number],
  deps: CoordinatorDeps,
): { patchedCurrentRoom: boolean; nextUid: number } {
  if (deps.currentRoomData && deps.currentRoomData.id === roomId) {
    const trans = deps.currentRoomData.transitions[transitionIndex];
    if (!trans) throw new Error(`Room "${roomId}" (currently open) has no transition #${transitionIndex + 1}.`);
    trans.targetRoomId = targetRoomId;
    trans.targetSpawnBlock = [targetSpawnBlock[0], targetSpawnBlock[1]];
    if (deps.session?.campaignStore !== undefined) {
      deps.session.campaignStore.setActiveRoomId(deps.currentRoomData.id);
      deps.session.campaignStore.markRoomDirty(deps.currentRoomData.id, deps.currentRoomData);
    }
    return { patchedCurrentRoom: true, nextUid: deps.nextUid };
  }

  const loaded = loadPersistedCampaignRoom(deps.session, deps.pendingRoomEdits, roomId, deps.nextUid)
    ?? fallbackFromRegistry(deps.registry, roomId, deps.nextUid);
  if (!loaded) throw new Error(`Room "${roomId}" could not be found in pendingRoomEdits, campaign store, or the room registry.`);
  const trans = loaded.roomData.transitions[transitionIndex];
  if (!trans) throw new Error(`Room "${roomId}" has no transition #${transitionIndex + 1}.`);
  trans.targetRoomId = targetRoomId;
  trans.targetSpawnBlock = [targetSpawnBlock[0], targetSpawnBlock[1]];
  persistSavedCampaignRoom(deps.session, deps.pendingRoomEdits, loaded.roomData);
  return { patchedCurrentRoom: false, nextUid: loaded.nextUid };
}

/** Best-effort rollback of a non-throwing `syncExistingRoomTransition` call — used to restore a room's persisted transition after a later step in the same transaction fails. Never throws. */
function bestEffortRestoreExistingRoomTransition(
  roomId: string,
  transitionIndex: number,
  targetRoomId: string,
  targetSpawnBlock: readonly [number, number],
  deps: CoordinatorDeps,
): void {
  try {
    syncExistingRoomTransition(roomId, transitionIndex, targetRoomId, targetSpawnBlock, deps);
  } catch (err) {
    console.error(`[visualMapRoomPersistenceCoordinator] Rollback of room "${roomId}" transition #${transitionIndex + 1} failed:`, err);
  }
}

// ── Transaction 1: create a brand-new linked room ────────────────────────────

export interface CreateLinkedRoomInput extends CoordinatorDeps {
  readonly sourceRoomId: string;
  readonly sourceTransIndex: number;
  /** Fully built but NOT YET registered RoomDef for the new room (its transitions[0] is the reciprocal door, target is a placeholder). */
  readonly newRoomDef: RoomDef;
  readonly newRoomName: string;
  readonly newRoomWorldId: number;
  readonly mapX: number;
  readonly mapY: number;
}

export type CreateLinkedRoomResult =
  | {
      readonly ok: true;
      readonly newRoomDef: RoomDef;
      readonly newRoomData: EditorRoomData;
      readonly newNextUid: number;
      /** True when the source room was the currently-open room and was patched in memory (dirty, unsaved) rather than persisted immediately. */
      readonly sourcePatchedCurrentRoom: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Registers a brand-new room and links it reciprocally to an existing
 * transition, persisting both halves atomically:
 *   1. Validate every prerequisite (source room/transition exist, new room id
 *      is free, new room has a transition to link back) BEFORE any mutation.
 *   2. Mutate the registry: register the new room, apply its name/world/map
 *      overrides, and link both transitions.
 *   3. Persist: commit the new room immediately (mirrors in-room connected-
 *      room creation), then sync the source room's reciprocal transition
 *      (in-memory patch if it is the current room, otherwise an immediate
 *      store write).
 *   4. On any persistence failure, roll every registry mutation back and
 *      remove the newly-registered room's persisted state, so nothing is
 *      left registry-only, payload-only, or half-linked.
 */
export function createLinkedRoomTransaction(input: CreateLinkedRoomInput): CreateLinkedRoomResult {
  const { registry, sourceRoomId, sourceTransIndex, newRoomDef, newRoomName, newRoomWorldId, mapX, mapY, session, pendingRoomEdits, currentRoomData, nextUid } = input;

  // ── 1. Validate before any mutation ──
  const sourceRoom = registry.get(sourceRoomId);
  if (!sourceRoom) return { ok: false, reason: `Source room "${sourceRoomId}" not found.` };
  const sourceTrans = sourceRoom.transitions[sourceTransIndex];
  if (!sourceTrans) return { ok: false, reason: `Source room "${sourceRoomId}" has no transition #${sourceTransIndex + 1}.` };
  if (registry.has(newRoomDef.id)) return { ok: false, reason: `Room ID "${newRoomDef.id}" already exists.` };
  const newTrans = newRoomDef.transitions[0];
  if (!newTrans) return { ok: false, reason: 'New room has no transition to link back to the source room.' };

  const sourceTransBefore: { targetRoomId: string; targetSpawnBlock: readonly [number, number] } = {
    targetRoomId: sourceTrans.targetRoomId,
    targetSpawnBlock: sourceTrans.targetSpawnBlock,
  };

  // ── 2. Mutate registry ──
  registry.register(newRoomDef);
  registry.setNameOverride(newRoomDef.id, newRoomName);
  registry.setWorldOverride(newRoomDef.id, newRoomWorldId);
  registry.setMapPosition(newRoomDef.id, mapX, mapY);

  const sourceSpawn = computeSpawnBlockForMapLink(sourceRoom, sourceTrans);
  const targetSpawn = computeSpawnBlockForMapLink(newRoomDef, newTrans);
  const linkedNew = registry.setTransitionLink(newRoomDef.id, 0, sourceRoomId, sourceSpawn);
  const linkedSource = registry.setTransitionLink(sourceRoomId, sourceTransIndex, newRoomDef.id, targetSpawn);

  const rollbackRegistry = (): void => {
    registry.unregister(newRoomDef.id);
    registry.setTransitionLink(sourceRoomId, sourceTransIndex, sourceTransBefore.targetRoomId, sourceTransBefore.targetSpawnBlock);
  };

  if (!linkedNew || !linkedSource) {
    rollbackRegistry();
    return { ok: false, reason: 'Failed to link the new room\'s reciprocal transition.' };
  }

  // ── 3. Persist ──
  const { data: newRoomData, nextUid: nextUidAfterNew } = roomDefToEditorRoomData(newRoomDef, nextUid);
  let sourcePatchedCurrentRoom = false;
  try {
    persistCreatedCampaignRoom(session, pendingRoomEdits, newRoomData);

    const sourceSync = syncExistingRoomTransition(sourceRoomId, sourceTransIndex, newRoomDef.id, targetSpawn, {
      registry, session, pendingRoomEdits, currentRoomData, nextUid: nextUidAfterNew,
    });
    sourcePatchedCurrentRoom = sourceSync.patchedCurrentRoom;

    return { ok: true, newRoomDef, newRoomData, newNextUid: nextUidAfterNew, sourcePatchedCurrentRoom };
  } catch (err) {
    // ── 4. Roll back registry + persisted state ──
    rollbackRegistry();
    // Unconditional: `persistCreatedCampaignRoom` itself is not atomic (it
    // may call markRoomDirty before a later commitRoom throws), so even a
    // failure inside that single call can leave store-level residue
    // (hydratedRoomsById / dirtyRoomIds) for the new room. deleteRoom /
    // pendingRoomEdits.delete are no-ops when nothing was actually written.
    if (session?.campaignStore !== undefined) session.campaignStore.deleteRoom(newRoomDef.id);
    else pendingRoomEdits.delete(newRoomDef.id);
    if (sourcePatchedCurrentRoom) {
      // Source was patched in-memory only (never persisted). `currentRoomData`
      // is a distinct EditorRoomData object from the registry RoomDef
      // rollbackRegistry() just restored, so it must be reverted separately.
      const trans = currentRoomData?.transitions[sourceTransIndex];
      if (trans) {
        trans.targetRoomId = sourceTransBefore.targetRoomId;
        trans.targetSpawnBlock = [sourceTransBefore.targetSpawnBlock[0], sourceTransBefore.targetSpawnBlock[1]];
      }
    } else {
      // Source was persisted immediately (non-current room) — restore its
      // previous persisted transition too.
      bestEffortRestoreExistingRoomTransition(
        sourceRoomId, sourceTransIndex, sourceTransBefore.targetRoomId, sourceTransBefore.targetSpawnBlock,
        { registry, session, pendingRoomEdits, currentRoomData, nextUid: nextUidAfterNew },
      );
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Persistence failed: ${reason}` };
  }
}

// ── Transaction 2: link two already-existing doors ──────────────────────────

export interface LinkTransitionInput extends CoordinatorDeps {
  readonly sourceRoomId: string;
  readonly sourceTransIndex: number;
  readonly targetRoomId: string;
  readonly targetTransIndex: number;
}

export type LinkTransitionResult =
  | {
      readonly ok: true;
      readonly sourceSpawnBlock: readonly [number, number];
      readonly targetSpawnBlock: readonly [number, number];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Links two existing doors together, persisting both sides atomically:
 * validates both rooms/transitions exist BEFORE any mutation, mutates both
 * registry transitions, persists both rooms, and rolls every mutation back
 * (registry + persisted state) if either persistence step fails.
 */
export function linkTransitionTransaction(input: LinkTransitionInput): LinkTransitionResult {
  const { registry, sourceRoomId, sourceTransIndex, targetRoomId, targetTransIndex, session, pendingRoomEdits, currentRoomData, nextUid } = input;

  // ── 1. Validate before any mutation ──
  const sourceRoom = registry.get(sourceRoomId);
  const sourceTrans = sourceRoom?.transitions[sourceTransIndex];
  if (!sourceRoom || !sourceTrans) return { ok: false, reason: `Source room "${sourceRoomId}" has no transition #${sourceTransIndex + 1}.` };
  const targetRoom = registry.get(targetRoomId);
  const targetTrans = targetRoom?.transitions[targetTransIndex];
  if (!targetRoom || !targetTrans) return { ok: false, reason: `Target room "${targetRoomId}" has no transition #${targetTransIndex + 1}.` };

  const sourceBefore: { targetRoomId: string; targetSpawnBlock: readonly [number, number] } = {
    targetRoomId: sourceTrans.targetRoomId,
    targetSpawnBlock: sourceTrans.targetSpawnBlock,
  };
  const targetBefore: { targetRoomId: string; targetSpawnBlock: readonly [number, number] } = {
    targetRoomId: targetTrans.targetRoomId,
    targetSpawnBlock: targetTrans.targetSpawnBlock,
  };

  const sourceSpawn = computeSpawnBlockForMapLink(sourceRoom, sourceTrans);
  const targetSpawn = computeSpawnBlockForMapLink(targetRoom, targetTrans);

  // ── 2. Mutate registry ──
  const didSource = registry.setTransitionLink(sourceRoomId, sourceTransIndex, targetRoomId, targetSpawn);
  const didTarget = registry.setTransitionLink(targetRoomId, targetTransIndex, sourceRoomId, sourceSpawn);

  const rollbackRegistry = (): void => {
    registry.setTransitionLink(sourceRoomId, sourceTransIndex, sourceBefore.targetRoomId, sourceBefore.targetSpawnBlock);
    registry.setTransitionLink(targetRoomId, targetTransIndex, targetBefore.targetRoomId, targetBefore.targetSpawnBlock);
  };

  if (!didSource || !didTarget) {
    rollbackRegistry();
    return { ok: false, reason: 'Failed to link transitions.' };
  }

  // ── 3. Persist both sides ──
  const deps: CoordinatorDeps = { registry, session, pendingRoomEdits, currentRoomData, nextUid };
  try {
    syncExistingRoomTransition(sourceRoomId, sourceTransIndex, targetRoomId, targetSpawn, deps);
    syncExistingRoomTransition(targetRoomId, targetTransIndex, sourceRoomId, sourceSpawn, deps);
    return { ok: true, sourceSpawnBlock: targetSpawn, targetSpawnBlock: sourceSpawn };
  } catch (err) {
    // ── 4. Roll back registry, then best-effort restore persisted state ──
    rollbackRegistry();
    bestEffortRestoreExistingRoomTransition(sourceRoomId, sourceTransIndex, sourceBefore.targetRoomId, sourceBefore.targetSpawnBlock, deps);
    bestEffortRestoreExistingRoomTransition(targetRoomId, targetTransIndex, targetBefore.targetRoomId, targetBefore.targetSpawnBlock, deps);
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Persistence failed: ${reason}` };
  }
}

// ── Transaction 3: discard-time cleanup of a one-way target link ────────────

export interface ClearTargetTransitionInput extends CoordinatorDeps {
  readonly targetRoomId: string;
  readonly targetTransIndex: number;
}

/**
 * Clears a target room's transition back to "unlinked" (`targetRoomId: ''`).
 * Used when the source room's in-memory link is discarded: the target room
 * (already committed via `createLinkedRoomTransaction`, immediate-persist,
 * per the existing new-room architecture) must not keep a one-way transition
 * pointing at a source room that no longer links back to it. The target room
 * itself is never deleted — only its reciprocal transition is unlinked.
 *
 * The target room is by construction never the currently-open room (a room
 * cannot be linked to itself), so this always persists immediately,
 * regardless of the current-room save-boundary cadence.
 */
export function clearTargetRoomTransitionOnDiscard(input: ClearTargetTransitionInput): { ok: true } | { ok: false; reason: string } {
  const { registry, targetRoomId, targetTransIndex, session, pendingRoomEdits, currentRoomData, nextUid } = input;
  const targetRoom = registry.get(targetRoomId);
  const targetTrans = targetRoom?.transitions[targetTransIndex];
  if (!targetRoom || !targetTrans) {
    // Nothing to clean up — the room/transition is already gone.
    return { ok: true };
  }
  const emptySpawn: readonly [number, number] = [0, 0];
  registry.setTransitionLink(targetRoomId, targetTransIndex, '', emptySpawn);
  try {
    syncExistingRoomTransition(targetRoomId, targetTransIndex, '', emptySpawn, { registry, session, pendingRoomEdits, currentRoomData, nextUid });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[visualMapRoomPersistenceCoordinator] Failed to clear discarded target room "${targetRoomId}" transition #${targetTransIndex + 1}:`, reason);
    return { ok: false, reason };
  }
}
