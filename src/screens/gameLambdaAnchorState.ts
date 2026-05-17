/**
 * gameLambdaAnchorState.ts — Lambda anchor link + teleport flash state.
 *
 * Keeps the mutable lambda-anchor gameplay state in a focused helper so
 * gameScreen.ts can delegate state transitions without changing behavior.
 */
export interface GameLambdaAnchorState {
  linkedAnchorIndex: number;
  linkedAnchorRoomId: string;
  teleportFlashAlpha: number;
  setLambdaAnchorLink: (index: number, roomId: string) => void;
  clearLambdaAnchorLink: () => void;
  lambdaTeleportFlash: () => void;
  setTeleportFlashAlpha: (alpha: number) => void;
}

export function createGameLambdaAnchorState(onTeleportFlash: () => void): GameLambdaAnchorState {
  const state: GameLambdaAnchorState = {
    linkedAnchorIndex: -1,
    linkedAnchorRoomId: '',
    teleportFlashAlpha: 0,
    setLambdaAnchorLink: (index: number, roomId: string): void => {
      state.linkedAnchorIndex = index;
      state.linkedAnchorRoomId = roomId;
    },
    clearLambdaAnchorLink: (): void => {
      state.linkedAnchorIndex = -1;
      state.linkedAnchorRoomId = '';
    },
    lambdaTeleportFlash: (): void => {
      state.teleportFlashAlpha = 1.0;
      // Lambda anchor teleport is an in-room positional snap, not a room transition.
      // Reset reveal state so any in-progress transition reveal doesn't persist
      // after the player is teleported to a different part of the room.
      onTeleportFlash();
    },
    setTeleportFlashAlpha: (alpha: number): void => {
      state.teleportFlashAlpha = alpha;
    },
  };

  return state;
}
