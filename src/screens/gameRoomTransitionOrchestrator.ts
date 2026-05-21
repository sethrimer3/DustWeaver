import type { CameraState } from '../render/camera';
import { ENABLE_SIMPLE_ROOM_TRANSITIONS } from '../render/transitions/transitionConfig';
import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { checkRoomTransitions, type TransitionDirection } from './gameTransitions';
import { TRANSITION_COOLDOWN_MS, type GameCameraState } from './gameCameraState';

export interface TransitionDebugState {
  lastTransitionPlayerSpeedWorld: number;
  lastTransitionDestRoomId: string;
}

export function orchestrateRoomTransitions(
  world: WorldState,
  currentRoom: RoomDef,
  roomWidthWorld: number,
  roomHeightWorld: number,
  camState: GameCameraState,
  elapsedMs: number,
  isCrossingInactive: boolean,
  preTransVX: number,
  preTransVY: number,
  /**
   * Called when a transition fires.  Responsible for loading the target room
   * and applying the pre-transition velocity to the new player cluster.
   * The async load path defers velocity application until the generator
   * completes; the sync (cache-hit) path applies it immediately.
   */
  loadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number, vx: number, vy: number, dir: TransitionDirection) => void,
  resolveSpawnBlock: (room: RoomDef, spawnXBlock: number, spawnYBlock: number) => readonly [number, number],
  _camera: CameraState,
  stagingRoomOriginXWorld: number,
  stagingRoomOriginYWorld: number,
  onRoomBecameActive: () => void,
  debugState: TransitionDebugState,
): void {
  if (camState.transitionCooldownMs > 0) {
    camState.transitionCooldownMs = Math.max(0, camState.transitionCooldownMs - elapsedMs);
  }

  if (!isCrossingInactive || camState.transitionCooldownMs > 0) return;

  checkRoomTransitions(
    world,
    currentRoom,
    roomWidthWorld,
    roomHeightWorld,
    (room, spawnX, spawnY, dir) => {
      debugState.lastTransitionPlayerSpeedWorld = Math.sqrt(preTransVX * preTransVX + preTransVY * preTransVY) * 60;
      const [validSpawnX, validSpawnY] = resolveSpawnBlock(room, spawnX, spawnY);

      // Instant room transition — the only supported mode.
      // Velocity application is delegated to the loadRoom callback so that
      // async loads can defer it until the generator completes.
      if (ENABLE_SIMPLE_ROOM_TRANSITIONS) {
        loadRoom(room, validSpawnX, validSpawnY, preTransVX, preTransVY, dir);
      }

      debugState.lastTransitionDestRoomId = room.id;
      camState.transitionCooldownMs = TRANSITION_COOLDOWN_MS;

      onRoomBecameActive();
    },
    stagingRoomOriginXWorld,
    stagingRoomOriginYWorld,
  );
}
