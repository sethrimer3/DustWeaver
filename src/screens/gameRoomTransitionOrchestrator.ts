import type { CameraState } from '../render/camera';
import { ENABLE_SIMPLE_ROOM_TRANSITIONS, ENABLE_TRANSITION_CAMERA_REVEAL } from '../render/transitions/transitionConfig';
import {
  notifyTransitionRoomEntered,
  notifyFreshRoomLoaded,
  type TransitionRevealState,
} from '../render/transitions/transitionCameraReveal';
import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { checkRoomTransitions, getOppositeTransitionDirection, type TransitionDirection } from './gameTransitions';
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
  camera: CameraState,
  transitionRevealState: TransitionRevealState,
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

      if (ENABLE_SIMPLE_ROOM_TRANSITIONS) {
        // Velocity application is delegated to the loadRoom callback so that
        // async loads can defer it until the generator completes.
        loadRoom(room, validSpawnX, validSpawnY, preTransVX, preTransVY, dir);
      } else {
        const oldCamX = camera.centerXWorld;
        const oldCamY = camera.centerYWorld;
        loadRoom(room, validSpawnX, validSpawnY, preTransVX, preTransVY, dir);
        const targetCamX = camera.centerXWorld;
        const targetCamY = camera.centerYWorld;
        camera.centerXWorld = oldCamX;
        camera.centerYWorld = oldCamY;
        camState.isTransitionActive = true;
        camState.transitionStartXWorld = oldCamX;
        camState.transitionStartYWorld = oldCamY;
        camState.transitionTargetXWorld = targetCamX;
        camState.transitionTargetYWorld = targetCamY;
        camState.transitionElapsedSec = 0;
      }

      debugState.lastTransitionDestRoomId = room.id;
      camState.transitionCooldownMs = TRANSITION_COOLDOWN_MS;

      if (ENABLE_TRANSITION_CAMERA_REVEAL) {
        const entryEdge = getOppositeTransitionDirection(dir);
        const entryTi = room.transitions.findIndex(t => t.direction === entryEdge);
        notifyTransitionRoomEntered(transitionRevealState, entryEdge, entryTi);
      } else {
        notifyFreshRoomLoaded(transitionRevealState);
      }

      onRoomBecameActive();
    },
    stagingRoomOriginXWorld,
    stagingRoomOriginYWorld,
  );
}
