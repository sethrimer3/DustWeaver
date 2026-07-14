/**
 * Coordinates the synchronous editor-playtest transaction that replaces an
 * edited room in the live runtime. Subsystem behavior remains behind narrow
 * ports so this ordering contract stays Node-testable.
 */

import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { bfsNearbyRooms } from './roomPrewarmNeighborhood';

export interface GameEditorRoomActivationPorts {
  resolveSpawn(room: RoomDef, spawnX: number, spawnY: number): readonly [number, number];
  bumpRoomVersion(roomId: string): void;
  invalidateRuntime(roomId: string): void;
  invalidateChunkPrewarm(roomId: string): void;
  invalidateResidentWorld(roomId: string): void;
  invalidateZone(worldNumber: number): void;
  queueRebuildAfterEdit(roomId: string): void;
  loadRoom(
    room: RoomDef,
    spawnX: number,
    spawnY: number,
    preserveCamera: boolean | undefined,
  ): void;
  getActiveWorld(): WorldState;
  ensureResident(room: RoomDef): void;
  setActiveResidentId(roomId: string): void;
  setResidentWorld(roomId: string, world: WorldState, isActive: boolean): void;
}

export function applyGameEditorRoomActivation(
  room: RoomDef,
  spawnX: number,
  spawnY: number,
  preserveCamera: boolean | undefined,
  registry: ReadonlyMap<string, RoomDef>,
  ports: GameEditorRoomActivationPorts,
): void {
  const [validX, validY] = ports.resolveSpawn(room, spawnX, spawnY);

  ports.bumpRoomVersion(room.id);
  ports.invalidateRuntime(room.id);
  ports.invalidateChunkPrewarm(room.id);
  ports.invalidateResidentWorld(room.id);

  const editedNeighbours = bfsNearbyRooms(room.id, registry, 1);
  for (const [adjacentRoomId] of editedNeighbours) {
    ports.invalidateResidentWorld(adjacentRoomId);
    ports.invalidateChunkPrewarm(adjacentRoomId);
  }

  ports.invalidateZone(room.worldNumber ?? 1);
  ports.queueRebuildAfterEdit(room.id);
  for (const [adjacentRoomId] of editedNeighbours) {
    ports.queueRebuildAfterEdit(adjacentRoomId);
  }

  ports.loadRoom(room, validX, validY, preserveCamera);
  const activeWorld = ports.getActiveWorld();
  ports.ensureResident(room);
  ports.setActiveResidentId(room.id);
  ports.setResidentWorld(room.id, activeWorld, true);
}
