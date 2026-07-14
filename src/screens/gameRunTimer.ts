/**
 * Owns the in-session speedrun timer state independently from screen, save,
 * render, and wall-clock concerns.
 *
 * The gameplay screen decides which frames are eligible to tick. This module
 * only applies the existing intent, alive-player, checkpoint, and respawn
 * rules to scalar inputs, without allocating in the frame hot path.
 */

export interface GameRunTimer {
  getCurrentMs(): number;
  getCheckpointMs(): number;
  isWaitingForMovement(): boolean;
  tick(
    elapsedMs: number,
    playerAlive: boolean,
    moveDx: number,
    jumpTriggered: boolean,
    jumpHeld: boolean,
  ): void;
  captureCheckpoint(): number;
  restoreCheckpoint(): void;
}

function normalizeTimerMs(value: number | undefined): number {
  const resolved = value ?? 0;
  return Math.max(0, isFinite(resolved) ? resolved : 0);
}

export function createGameRunTimer(
  initialRunTimerMs?: number,
  initialCheckpointRunTimerMs?: number,
): GameRunTimer {
  let currentMs = normalizeTimerMs(initialRunTimerMs);
  let checkpointMs = normalizeTimerMs(initialCheckpointRunTimerMs);
  let waitingForMovement = true;

  return {
    getCurrentMs: () => currentMs,
    getCheckpointMs: () => checkpointMs,
    isWaitingForMovement: () => waitingForMovement,
    tick: (elapsedMs, playerAlive, moveDx, jumpTriggered, jumpHeld) => {
      if (waitingForMovement) {
        const hasIntentionalInput = moveDx !== 0 || jumpTriggered || jumpHeld;
        if (hasIntentionalInput && playerAlive) {
          waitingForMovement = false;
        }
      }

      if (!waitingForMovement && playerAlive) {
        currentMs = Math.max(0, currentMs + elapsedMs);
      }
    },
    captureCheckpoint: () => {
      checkpointMs = currentMs;
      return checkpointMs;
    },
    restoreCheckpoint: () => {
      currentMs = checkpointMs;
      waitingForMovement = true;
    },
  };
}
