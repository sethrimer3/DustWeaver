/**
 * Owns the deterministic Return to Last Save respawn transaction: resolving
 * the saved-room target or campaign fallback, loading it, and resetting
 * transition/frame-clock state before the optional post-respawn callback.
 */
import type { RoomDef } from '../levels/roomDef';
import type { PlayerProgress } from '../progression/playerProgress';

export interface GameDeathRespawnPorts {
  getRoomById(roomId: string): RoomDef | undefined;
  loadRoom(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void;
  resetTransitionReveal(): void;
  resetFrameClock(): void;
  onRespawn?: () => void;
}

export function executeGameDeathRespawn(
  progress: PlayerProgress | undefined,
  campaignSpawnRoom: RoomDef,
  campaignSpawnBlock: readonly [number, number],
  ports: GameDeathRespawnPorts,
): void {
  let targetRoom = campaignSpawnRoom;
  let targetBlock: readonly [number, number] = campaignSpawnBlock;

  if (progress && progress.lastSaveRoomId) {
    const saveRoom = ports.getRoomById(progress.lastSaveRoomId);
    if (saveRoom && progress.lastSaveSpawnBlock) {
      targetRoom = saveRoom;
      targetBlock = progress.lastSaveSpawnBlock;
    }
  }

  ports.loadRoom(targetRoom, targetBlock[0], targetBlock[1]);
  ports.resetTransitionReveal();
  ports.resetFrameClock();
  if (ports.onRespawn) ports.onRespawn();
}
