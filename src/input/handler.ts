import { GameCommand, CommandKind } from './commands';

const JOYSTICK_DEAD_ZONE_PX = 12;
export const JOYSTICK_MAX_RADIUS_PX = 60;

/** Hold < 200ms = quick attack; hold ≥ 200ms transitions to block mode. */
const ATTACK_HOLD_THRESHOLD_MS = 200;

export interface InputState {
  isKeyW: boolean;
  isKeyA: boolean;
  isKeyS: boolean;
  isKeyD: boolean;
  isEscapePressed: boolean;
  /** Set to true for one collectCommands call to trigger a jump. */
  isJumpTriggeredFlag: boolean;
  /** True while any jump key (W / Space / ArrowUp) is physically held down. */
  isJumpHeldFlag: boolean;
  /** Tracks whether the joystick is already past the up-flick threshold (edge-detect). */
  isJoystickUpActiveFlag: boolean;
  /** True while the Shift key is physically held down (sprint). */
  isSprintHeldFlag: boolean;
  mouseXPx: number;
  mouseYPx: number;
  // Touch joystick state (populated by touch listeners; read by renderer for visual feedback)
  isTouchJoystickActiveFlag: 0 | 1;
  touchJoystickBaseXPx: number;
  touchJoystickBaseYPx: number;
  touchJoystickCurrentXPx: number;
  touchJoystickCurrentYPx: number;

  // ---- Attack / block input state -----------------------------------------
  /** True while the left mouse button is held (PC). */
  isMouseDownFlag: 0 | 1;
  /** True while the right mouse button is held (PC). */
  isRightMouseDownFlag: 0 | 1;
  /** Timestamp (performance.now()) when mouse button went down. */
  mouseDownTimeMs: number;
  /** Screen position where the mouse button went down. */
  mouseDownXPx: number;
  mouseDownYPx: number;
  /** Set to 1 for one frame when an attack should fire (mouse released quickly). */
  isAttackFiredFlag: 0 | 1;
  /** Attack direction in screen pixels (relative, will be normalized upstream). */
  attackDirXPx: number;
  attackDirYPx: number;
  /** 1 while the player is in block mode (mouse held > threshold or second touch held). */
  isBlockingFlag: 0 | 1;
  // ---- Second touch (mobile attack/block) ---------------------------------
  secondTouchId: number;   // -1 = no second touch
  secondTouchStartXPx: number;
  secondTouchStartYPx: number;
  secondTouchStartTimeMs: number;
  secondTouchCurrentXPx: number;
  secondTouchCurrentYPx: number;
  // ---- Grapple hook -------------------------------------------------------
  /** True while the grapple key (E) is physically held down. */
  isGrappleHeldFlag: 0 | 1;
  /** Set to 1 for one frame when grapple should fire (E pressed). */
  isGrappleFireTriggeredFlag: 0 | 1;
  /** Set to 1 for one frame when grapple should release (E released). */
  isGrappleReleaseTriggeredFlag: 0 | 1;
  /** Screen-space aim position where the grapple fires. */
  grappleAimXPx: number;
  grappleAimYPx: number;
  /** Set to true for one collectCommands call to trigger an interact (F key). */
  isInteractTriggeredFlag: boolean;
}

export function createInputState(): InputState {
  return {
    isKeyW: false,
    isKeyA: false,
    isKeyS: false,
    isKeyD: false,
    isEscapePressed: false,
    isJumpTriggeredFlag: false,
    isJumpHeldFlag: false,
    isJoystickUpActiveFlag: false,
    isSprintHeldFlag: false,
    mouseXPx: 0,
    mouseYPx: 0,
    isTouchJoystickActiveFlag: 0,
    touchJoystickBaseXPx: 0,
    touchJoystickBaseYPx: 0,
    touchJoystickCurrentXPx: 0,
    touchJoystickCurrentYPx: 0,
    isMouseDownFlag: 0,
    isRightMouseDownFlag: 0,
    mouseDownTimeMs: 0,
    mouseDownXPx: 0,
    mouseDownYPx: 0,
    isAttackFiredFlag: 0,
    attackDirXPx: 1,
    attackDirYPx: 0,
    isBlockingFlag: 0,
    secondTouchId: -1,
    secondTouchStartXPx: 0,
    secondTouchStartYPx: 0,
    secondTouchStartTimeMs: 0,
    secondTouchCurrentXPx: 0,
    secondTouchCurrentYPx: 0,
    isGrappleHeldFlag: 0,
    isGrappleFireTriggeredFlag: 0,
    isGrappleReleaseTriggeredFlag: 0,
    grappleAimXPx: 0,
    grappleAimYPx: 0,
    isInteractTriggeredFlag: false,
  };
}

function applyJoystickToKeys(state: InputState): void {
  const dx = state.touchJoystickCurrentXPx - state.touchJoystickBaseXPx;
  const dy = state.touchJoystickCurrentYPx - state.touchJoystickBaseYPx;
  // Platformer: joystick only maps horizontal movement
  state.isKeyA = dx < -JOYSTICK_DEAD_ZONE_PX;
  state.isKeyD = dx > JOYSTICK_DEAD_ZONE_PX;
  // Upward flick triggers a one-shot jump on the rising edge only
  const isUpFlick = dy < -JOYSTICK_DEAD_ZONE_PX * 2;
  if (isUpFlick && !state.isJoystickUpActiveFlag) {
    state.isJumpTriggeredFlag = true;
  }
  state.isJoystickUpActiveFlag = isUpFlick;
}

function clearJoystickKeys(state: InputState): void {
  state.isKeyA = false;
  state.isKeyD = false;
}

export function attachInputListeners(canvas: HTMLCanvasElement, state: InputState): () => void {
  // Track joystick touch ID so multi-touch doesn't confuse movement with aiming
  let joystickTouchId = -1;

  function clientToCanvasPx(clientXPx: number, clientYPx: number): { xPx: number; yPx: number } {
    const rect = canvas.getBoundingClientRect();
    const xCssPx = clientXPx - rect.left;
    const yCssPx = clientYPx - rect.top;
    const xNormalized = rect.width > 0 ? xCssPx / rect.width : 0.0;
    const yNormalized = rect.height > 0 ? yCssPx / rect.height : 0.0;
    return {
      xPx: xNormalized * canvas.width,
      yPx: yNormalized * canvas.height,
    };
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'a' || e.key === 'A') state.isKeyA = true;
    if (e.key === 'd' || e.key === 'D') state.isKeyD = true;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') state.isKeyS = true;
    if (e.key === 'ArrowLeft') state.isKeyA = true;
    if (e.key === 'ArrowRight') state.isKeyD = true;
    if (e.key === 'Escape') state.isEscapePressed = true;
    if (e.key === 'w' || e.key === 'W' || e.key === ' ' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!e.repeat) { state.isJumpTriggeredFlag = true; }
      state.isJumpHeldFlag = true;
    }
    if (e.key === 'Shift') {
      e.preventDefault();
      state.isSprintHeldFlag = true;
    }
    if ((e.key === 'e' || e.key === 'E') && !e.repeat) {
      state.isGrappleHeldFlag = 1;
      state.isGrappleFireTriggeredFlag = 1;
      state.grappleAimXPx = state.mouseXPx;
      state.grappleAimYPx = state.mouseYPx;
    }
    if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
      state.isInteractTriggeredFlag = true;
    }
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'a' || e.key === 'A') state.isKeyA = false;
    if (e.key === 'd' || e.key === 'D') state.isKeyD = false;
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') state.isKeyS = false;
    if (e.key === 'ArrowLeft') state.isKeyA = false;
    if (e.key === 'ArrowRight') state.isKeyD = false;
    if (e.key === 'Escape') state.isEscapePressed = false;
    if (e.key === 'w' || e.key === 'W' || e.key === ' ' || e.key === 'ArrowUp') {
      state.isJumpHeldFlag = false;
    }
    if (e.key === 'Shift') {
      state.isSprintHeldFlag = false;
    }
    if (e.key === 'e' || e.key === 'E') {
      state.isGrappleHeldFlag = 0;
      state.isGrappleReleaseTriggeredFlag = 1;
    }
  }
  function onMouseMove(e: MouseEvent): void {
    const mouse = clientToCanvasPx(e.clientX, e.clientY);
    state.mouseXPx = mouse.xPx;
    state.mouseYPx = mouse.yPx;
  }
  function onMouseDown(e: MouseEvent): void {
    const mouse = clientToCanvasPx(e.clientX, e.clientY);
    if (e.button === 0) {
      state.isMouseDownFlag = 1;
      state.mouseDownTimeMs = performance.now();
      state.mouseDownXPx = mouse.xPx;
      state.mouseDownYPx = mouse.yPx;
    } else if (e.button === 2) {
      state.isRightMouseDownFlag = 1;
    }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      if (state.isMouseDownFlag === 0) return;
      state.isMouseDownFlag = 0;
      const holdMs = performance.now() - state.mouseDownTimeMs;
      if (state.isBlockingFlag === 1) {
        // Was blocking — collectCommands will emit BlockEnd on next frame
        // (isMouseDownFlag=0 && isBlockingFlag=1 triggers the BlockEnd path)
      } else if (holdMs < ATTACK_HOLD_THRESHOLD_MS) {
        // Quick click — attack toward current mouse cursor position (gameScreen converts to direction)
        const mouse = clientToCanvasPx(e.clientX, e.clientY);
        state.isAttackFiredFlag = 1;
        state.attackDirXPx = mouse.xPx;
        state.attackDirYPx = mouse.yPx;
      }
    } else if (e.button === 2) {
      state.isRightMouseDownFlag = 0;
    }
  }

  function onTouchStart(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const touch = clientToCanvasPx(t.clientX, t.clientY);
      if (joystickTouchId === -1) {
        // First touch becomes the movement joystick
        joystickTouchId = t.identifier;
        state.isTouchJoystickActiveFlag = 1;
        state.touchJoystickBaseXPx = touch.xPx;
        state.touchJoystickBaseYPx = touch.yPx;
        state.touchJoystickCurrentXPx = touch.xPx;
        state.touchJoystickCurrentYPx = touch.yPx;
      } else if (state.secondTouchId === -1) {
        // Second finger — attack/block gesture
        state.secondTouchId = t.identifier;
        state.secondTouchStartXPx = touch.xPx;
        state.secondTouchStartYPx = touch.yPx;
        state.secondTouchStartTimeMs = performance.now();
        state.secondTouchCurrentXPx = touch.xPx;
        state.secondTouchCurrentYPx = touch.yPx;
      } else {
        // Additional touches update the aim/mouse position
        state.mouseXPx = touch.xPx;
        state.mouseYPx = touch.yPx;
      }
    }
  }

  function onTouchMove(e: TouchEvent): void {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const touch = clientToCanvasPx(t.clientX, t.clientY);
      if (t.identifier === joystickTouchId) {
        const dx = touch.xPx - state.touchJoystickBaseXPx;
        const dy = touch.yPx - state.touchJoystickBaseYPx;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > JOYSTICK_MAX_RADIUS_PX) {
          // Slide the base so the visual thumb never escapes the outer ring
          const scale = (dist - JOYSTICK_MAX_RADIUS_PX) / dist;
          state.touchJoystickBaseXPx += dx * scale;
          state.touchJoystickBaseYPx += dy * scale;
        }
        state.touchJoystickCurrentXPx = touch.xPx;
        state.touchJoystickCurrentYPx = touch.yPx;
        applyJoystickToKeys(state);
      } else if (t.identifier === state.secondTouchId) {
        state.secondTouchCurrentXPx = touch.xPx;
        state.secondTouchCurrentYPx = touch.yPx;
      } else {
        state.mouseXPx = touch.xPx;
        state.mouseYPx = touch.yPx;
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
      } else if (t.identifier === state.secondTouchId) {
        state.secondTouchId = -1;
        if (state.isBlockingFlag === 1) {
          // Let collectCommands emit BlockEnd (isBlockingFlag stays 1 until then)
        } else {
          // Quick swipe — fire attack toward touch release position (gameScreen converts to direction)
          state.isAttackFiredFlag = 1;
          state.attackDirXPx = state.secondTouchCurrentXPx;
          state.attackDirYPx = state.secondTouchCurrentYPx;
        }
      }
    }
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
  // Prevent browser context menu on right-click during gameplay.
  function onContextMenu(e: MouseEvent): void { e.preventDefault(); }
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchmove', onTouchMove);
    canvas.removeEventListener('touchend', onTouchEnd);
    canvas.removeEventListener('touchcancel', onTouchEnd);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}

// Allocates in input layer — acceptable outside sim hot-path
// Right-click sustained Weave hold state (persists across frames within collectCommands)
let _rightMouseWasDown = false;
let _rightMouseDownTimeMs = 0;
let _isRightWeaveSustainedFlag = false;

export function collectCommands(input: InputState): GameCommand[] {
  const commands: GameCommand[] = [];
  let dx = 0;
  if (input.isKeyA) dx -= 1;
  if (input.isKeyD) dx += 1;
  if (dx !== 0) {
    commands.push({ kind: CommandKind.MovePlayer, dx, dy: 0 });
  }
  if (input.isEscapePressed) {
    commands.push({ kind: CommandKind.ReturnToMap });
    input.isEscapePressed = false;
  }

  // ---- Jump command --------------------------------------------------------
  if (input.isJumpTriggeredFlag) {
    input.isJumpTriggeredFlag = false;
    commands.push({ kind: CommandKind.Jump });
  }


  // ---- Attack / block commands (LEGACY — kept for enemy AI compatibility) ---
  // Old attack/block is replaced by Weave commands for the player.
  // The legacy command types are still generated but will be ignored by
  // the game screen for the player; enemy AI still produces them internally.

  // ---- Primary Weave (left click) -----------------------------------------
  if (input.isAttackFiredFlag === 1) {
    input.isAttackFiredFlag = 0;
    // Quick left click → burst activation of primary Weave
    commands.push({ kind: CommandKind.WeaveActivatePrimary, aimXPx: input.attackDirXPx, aimYPx: input.attackDirYPx });
  }

  // Transition from left mouse-down to sustained primary Weave when hold threshold exceeded
  if (input.isMouseDownFlag === 1 && input.isBlockingFlag === 0) {
    const holdMs = performance.now() - input.mouseDownTimeMs;
    if (holdMs >= ATTACK_HOLD_THRESHOLD_MS) {
      input.isBlockingFlag = 1;
      commands.push({ kind: CommandKind.WeaveHoldPrimary, aimXPx: input.mouseXPx, aimYPx: input.mouseYPx });
    }
  }

  if (input.isBlockingFlag === 1 && input.isMouseDownFlag === 1) {
    // Continuously update aim direction while sustaining primary Weave
    commands.push({ kind: CommandKind.WeaveHoldPrimary, aimXPx: input.mouseXPx, aimYPx: input.mouseYPx });
  }

  if (input.isMouseDownFlag === 0 && input.isBlockingFlag === 1 && input.isRightMouseDownFlag === 0) {
    input.isBlockingFlag = 0;
    commands.push({ kind: CommandKind.WeaveEndPrimary });
  }

  // ---- Secondary Weave (right click) --------------------------------------
  if (input.isRightMouseDownFlag === 1 && !_rightMouseWasDown) {
    // Right mouse just went down — for burst weaves, we fire on release.
    // For sustained weaves, we begin holding immediately after threshold.
    _rightMouseDownTimeMs = performance.now();
  }
  if (input.isRightMouseDownFlag === 0 && _rightMouseWasDown) {
    // Right mouse released
    const holdMs = performance.now() - _rightMouseDownTimeMs;
    if (_isRightWeaveSustainedFlag) {
      _isRightWeaveSustainedFlag = false;
      commands.push({ kind: CommandKind.WeaveEndSecondary });
    } else if (holdMs < ATTACK_HOLD_THRESHOLD_MS) {
      // Quick right click → burst activation of secondary Weave
      commands.push({ kind: CommandKind.WeaveActivateSecondary, aimXPx: input.mouseXPx, aimYPx: input.mouseYPx });
    }
  }
  if (input.isRightMouseDownFlag === 1 && !_isRightWeaveSustainedFlag) {
    const holdMs = performance.now() - _rightMouseDownTimeMs;
    if (holdMs >= ATTACK_HOLD_THRESHOLD_MS) {
      _isRightWeaveSustainedFlag = true;
      commands.push({ kind: CommandKind.WeaveHoldSecondary, aimXPx: input.mouseXPx, aimYPx: input.mouseYPx });
    }
  }
  if (_isRightWeaveSustainedFlag && input.isRightMouseDownFlag === 1) {
    commands.push({ kind: CommandKind.WeaveHoldSecondary, aimXPx: input.mouseXPx, aimYPx: input.mouseYPx });
  }
  _rightMouseWasDown = input.isRightMouseDownFlag === 1;

  // ---- Second touch attack/block (mobile) — maps to primary Weave --------
  if (input.secondTouchId !== -1) {
    const holdMs = performance.now() - input.secondTouchStartTimeMs;
    if (holdMs >= ATTACK_HOLD_THRESHOLD_MS && input.isBlockingFlag === 0) {
      input.isBlockingFlag = 1;
      commands.push({ kind: CommandKind.WeaveHoldPrimary, aimXPx: input.secondTouchCurrentXPx, aimYPx: input.secondTouchCurrentYPx });
    }
    if (input.isBlockingFlag === 1) {
      commands.push({ kind: CommandKind.WeaveHoldPrimary, aimXPx: input.secondTouchCurrentXPx, aimYPx: input.secondTouchCurrentYPx });
    }
  }

  // Emit WeaveEndPrimary when second touch ended while holding
  if (input.secondTouchId === -1 && input.isBlockingFlag === 1 && input.isMouseDownFlag === 0) {
    input.isBlockingFlag = 0;
    commands.push({ kind: CommandKind.WeaveEndPrimary });
  }

  // ---- Grapple hook commands ----------------------------------------------
  if (input.isGrappleFireTriggeredFlag === 1) {
    input.isGrappleFireTriggeredFlag = 0;
    commands.push({ kind: CommandKind.GrappleFire, aimXPx: input.grappleAimXPx, aimYPx: input.grappleAimYPx });
  }
  if (input.isGrappleReleaseTriggeredFlag === 1) {
    input.isGrappleReleaseTriggeredFlag = 0;
    commands.push({ kind: CommandKind.GrappleRelease });
  }

  // ---- Interact command ---------------------------------------------------
  if (input.isInteractTriggeredFlag) {
    input.isInteractTriggeredFlag = false;
    commands.push({ kind: CommandKind.Interact });
  }

  return commands;
}
