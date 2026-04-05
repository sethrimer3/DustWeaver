/**
 * Editor input handler — captures keyboard and mouse input for editor mode.
 * Isolated from normal gameplay input to avoid interference.
 */

import type { EditorState } from './editorState';

export interface EditorInputState {
  /** WASD camera movement. */
  isCamUp: boolean;
  isCamDown: boolean;
  isCamLeft: boolean;
  isCamRight: boolean;
  /** Shift key held (doubles camera pan speed). */
  isShiftHeld: boolean;
  /** M key toggles world map. */
  isMapToggled: boolean;
  /** N key toggles visual world map editor. */
  isVisualMapToggled: boolean;
  /** Left mouse button currently held down (persistent, not one-shot). */
  isMouseDown: boolean;
  /** Left mouse click fired (one-shot). */
  isClickFired: boolean;
  clickScreenXPx: number;
  clickScreenYPx: number;
  /** Mouse position in screen pixels. */
  mouseScreenXPx: number;
  mouseScreenYPx: number;
  /** Mouse wheel delta (positive = scroll down = rotate clockwise). */
  wheelDelta: number;
  /** ESC key pressed. */
  isEscapePressed: boolean;
  /** 1–3 number key pressed (tool shortcuts). */
  toolKeyPressed: number;
}

export function createEditorInputState(): EditorInputState {
  return {
    isCamUp: false,
    isCamDown: false,
    isCamLeft: false,
    isCamRight: false,
    isShiftHeld: false,
    isMapToggled: false,
    isVisualMapToggled: false,
    isMouseDown: false,
    isClickFired: false,
    clickScreenXPx: 0,
    clickScreenYPx: 0,
    mouseScreenXPx: 0,
    mouseScreenYPx: 0,
    wheelDelta: 0,
    isEscapePressed: false,
    toolKeyPressed: 0,
  };
}

/**
 * Attaches editor-specific input listeners. Returns a cleanup function.
 * These listeners are separate from the gameplay input listeners.
 */
export function attachEditorInputListeners(
  canvas: HTMLCanvasElement,
  state: EditorInputState,
  editorState: EditorState,
): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if (!editorState.isActive) return;

    if (e.key === 'Shift') state.isShiftHeld = true;
    const key = e.key.toLowerCase();
    if (key === 'w') { state.isCamUp = true; e.preventDefault(); }
    if (key === 's') { state.isCamDown = true; e.preventDefault(); }
    if (key === 'a') { state.isCamLeft = true; e.preventDefault(); }
    if (key === 'd') { state.isCamRight = true; e.preventDefault(); }
    if (key === 'm' && !e.repeat) { state.isMapToggled = true; e.preventDefault(); }
    if (key === 'n' && !e.repeat) { state.isVisualMapToggled = true; e.preventDefault(); }
    if (key === 'escape') { state.isEscapePressed = true; e.preventDefault(); }
    if (key === '1') state.toolKeyPressed = 1;
    if (key === '2') state.toolKeyPressed = 2;
    if (key === '3') state.toolKeyPressed = 3;
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (!editorState.isActive) return;

    const key = e.key.toLowerCase();
    if (key === 'shift') state.isShiftHeld = false;
    if (key === 'w') state.isCamUp = false;
    if (key === 's') state.isCamDown = false;
    if (key === 'a') state.isCamLeft = false;
    if (key === 'd') state.isCamRight = false;
  }

  function onMouseMove(e: MouseEvent): void {
    state.mouseScreenXPx = e.clientX;
    state.mouseScreenYPx = e.clientY;
  }

  function onMouseDown(e: MouseEvent): void {
    if (!editorState.isActive) return;
    if (e.button === 0) {
      state.isMouseDown = true;
      state.isClickFired = true;
      state.clickScreenXPx = e.clientX;
      state.clickScreenYPx = e.clientY;
    }
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      state.isMouseDown = false;
    }
  }

  function onWheel(e: WheelEvent): void {
    if (!editorState.isActive) return;
    e.preventDefault();
    state.wheelDelta += e.deltaY > 0 ? 1 : -1;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('wheel', onWheel);
  };
}

/**
 * Consumes one-shot input flags. Called each frame after processing.
 */
export function clearEditorOneShots(state: EditorInputState): void {
  state.isClickFired = false;
  state.isMapToggled = false;
  state.isVisualMapToggled = false;
  state.wheelDelta = 0;
  state.isEscapePressed = false;
  state.toolKeyPressed = 0;
}
