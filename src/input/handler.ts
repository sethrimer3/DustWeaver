import { GameCommand, CommandKind } from './commands';

const JOYSTICK_DEAD_ZONE_PX = 12;
export const JOYSTICK_MAX_RADIUS_PX = 60;

export interface InputState {
  isKeyW: boolean;
  isKeyA: boolean;
  isKeyS: boolean;
  isKeyD: boolean;
  isEscapePressed: boolean;
  mouseXPx: number;
  mouseYPx: number;
  // Touch joystick state (populated by touch listeners; read by renderer for visual feedback)
  isTouchJoystickActiveFlag: 0 | 1;
  touchJoystickBaseXPx: number;
  touchJoystickBaseYPx: number;
  touchJoystickCurrentXPx: number;
  touchJoystickCurrentYPx: number;
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
    isTouchJoystickActiveFlag: 0,
    touchJoystickBaseXPx: 0,
    touchJoystickBaseYPx: 0,
    touchJoystickCurrentXPx: 0,
    touchJoystickCurrentYPx: 0,
  };
}

function applyJoystickToKeys(state: InputState): void {
  const dx = state.touchJoystickCurrentXPx - state.touchJoystickBaseXPx;
  const dy = state.touchJoystickCurrentYPx - state.touchJoystickBaseYPx;
  state.isKeyW = dy < -JOYSTICK_DEAD_ZONE_PX;
  state.isKeyS = dy > JOYSTICK_DEAD_ZONE_PX;
  state.isKeyA = dx < -JOYSTICK_DEAD_ZONE_PX;
  state.isKeyD = dx > JOYSTICK_DEAD_ZONE_PX;
}

function clearJoystickKeys(state: InputState): void {
  state.isKeyW = false;
  state.isKeyA = false;
  state.isKeyS = false;
  state.isKeyD = false;
}

export function attachInputListeners(canvas: HTMLCanvasElement, state: InputState): () => void {
  // Track joystick touch ID so multi-touch doesn't confuse movement with aiming
  let joystickTouchId = -1;

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

  function onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (joystickTouchId === -1) {
        // First touch becomes the movement joystick
        joystickTouchId = t.identifier;
        state.isTouchJoystickActiveFlag = 1;
        state.touchJoystickBaseXPx = t.clientX;
        state.touchJoystickBaseYPx = t.clientY;
        state.touchJoystickCurrentXPx = t.clientX;
        state.touchJoystickCurrentYPx = t.clientY;
      } else {
        // Additional touches update the aim/mouse position
        state.mouseXPx = t.clientX;
        state.mouseYPx = t.clientY;
      }
    }
  }

  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joystickTouchId) {
        const dx = t.clientX - state.touchJoystickBaseXPx;
        const dy = t.clientY - state.touchJoystickBaseYPx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_MAX_RADIUS_PX) {
          // Slide the base so the visual thumb never escapes the outer ring
          const scale = (dist - JOYSTICK_MAX_RADIUS_PX) / dist;
          state.touchJoystickBaseXPx += dx * scale;
          state.touchJoystickBaseYPx += dy * scale;
        }
        state.touchJoystickCurrentXPx = t.clientX;
        state.touchJoystickCurrentYPx = t.clientY;
        applyJoystickToKeys(state);
      } else {
        state.mouseXPx = t.clientX;
        state.mouseYPx = t.clientY;
      }
    }
  }

  function onTouchEnd(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === joystickTouchId) {
        joystickTouchId = -1;
        state.isTouchJoystickActiveFlag = 0;
        clearJoystickKeys(state);
      }
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    canvas.removeEventListener('touchcancel', onTouchEnd);
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
