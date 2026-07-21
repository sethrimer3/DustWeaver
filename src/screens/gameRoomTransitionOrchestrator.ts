import type { CameraState } from '../render/camera';
import { ENABLE_SIMPLE_ROOM_TRANSITIONS } from '../render/transitions/transitionConfig';
import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import { checkRoomTransitions, type TransitionDirection } from './gameTransitions';
import { TRANSITION_COOLDOWN_MS, type GameCameraState } from './gameCameraState';
import { releaseTimeStopFieldMomentumIfActive } from '../sim/timeStopField/timeStopFieldPlayerState';

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
      // A TimeStop Field region cannot span two rooms, so a transition is
      // treated as an implicit field exit — release any stored momentum into
      // velocity right here, at the moment a transition is CONFIRMED to
      // fire (not every frame — this callback only runs when the player has
      // actually crossed a transition trigger), so player-earned momentum is
      // carried into the new room instead of silently discarded. Re-read
      // velocity after releasing rather than using the closure-captured
      // preTransVX/preTransVY, which were sampled before this release.
      releaseTimeStopFieldMomentumIfActive(world);
      const player = world.clusters.length > 0 ? world.clusters[0] : undefined;
      const vx = player?.velocityXWorld ?? preTransVX;
      const vy = player?.velocityYWorld ?? preTransVY;

      debugState.lastTransitionPlayerSpeedWorld = Math.sqrt(vx * vx + vy * vy) * 60;
      const [validSpawnX, validSpawnY] = resolveSpawnBlock(room, spawnX, spawnY);

      // Instant room transition — the only supported mode.
      // Velocity application is delegated to the loadRoom callback so that
      // async loads can defer it until the generator completes.
      if (ENABLE_SIMPLE_ROOM_TRANSITIONS) {
        loadRoom(room, validSpawnX, validSpawnY, vx, vy, dir);
      }

      debugState.lastTransitionDestRoomId = room.id;
      camState.transitionCooldownMs = TRANSITION_COOLDOWN_MS;

      onRoomBecameActive();
    },
    stagingRoomOriginXWorld,
    stagingRoomOriginYWorld,
  );
}
