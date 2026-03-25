import { GameCommand, CommandKind } from './commands';

export interface InputState {
  isKeyW: boolean;
  isKeyA: boolean;
  isKeyS: boolean;
  isKeyD: boolean;
  isEscapePressed: boolean;
  mouseXPx: number;
  mouseYPx: number;
}

export function createInputState(): InputState {
  return {
    isKeyW: false,
    isKeyA: false,
    isKeyS: false,
    isKeyD: false,
    isEscapePressed: false,
    mouseXPx: 0,
    mouseYPx: 0,
  };
}

export function attachInputListeners(canvas: HTMLCanvasElement, state: InputState): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'w' || e.key === 'W') state.isKeyW = true;
    if (e.key === 'a' || e.key === 'A') state.isKeyA = true;
    if (e.key === 's' || e.key === 'S') state.isKeyS = true;
    if (e.key === 'd' || e.key === 'D') state.isKeyD = true;
    if (e.key === 'Escape') state.isEscapePressed = true;
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'w' || e.key === 'W') state.isKeyW = false;
    if (e.key === 'a' || e.key === 'A') state.isKeyA = false;
    if (e.key === 's' || e.key === 'S') state.isKeyS = false;
    if (e.key === 'd' || e.key === 'D') state.isKeyD = false;
    if (e.key === 'Escape') state.isEscapePressed = false;
  }
  function onMouseMove(e: MouseEvent): void {
    state.mouseXPx = e.clientX;
    state.mouseYPx = e.clientY;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
  };
}

// Allocates in input layer — acceptable outside sim hot-path
export function collectCommands(input: InputState): GameCommand[] {
  const commands: GameCommand[] = [];
  let dx = 0;
  let dy = 0;
  if (input.isKeyW) dy -= 1;
  if (input.isKeyS) dy += 1;
  if (input.isKeyA) dx -= 1;
  if (input.isKeyD) dx += 1;
  if (dx !== 0 || dy !== 0) {
    commands.push({ kind: CommandKind.MovePlayer, dx, dy });
  }
  if (input.isEscapePressed) {
    commands.push({ kind: CommandKind.ReturnToMap });
    input.isEscapePressed = false;
  }
  return commands;
}
