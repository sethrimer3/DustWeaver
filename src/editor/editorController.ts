/**
 * Editor controller — orchestrates editor lifecycle, input processing,
 * tool actions, camera updates, UI, world map, transition linking,
 * and room loading. This is the single integration point consumed by
 * gameScreen.ts.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RoomDef } from '../levels/roomDef';
import type { CameraState } from '../render/camera';

import {
  EditorState, createEditorState, EditorTool,
  EditorWall, EditorEnemy, EditorTransition, EditorSkillTomb,
  BlockTheme, BackgroundId, LightingEffect,
} from './editorState';
import { roomDefToEditorRoomData, editorRoomDataToRoomDef } from './roomJson';
import { updateEditorCamera, EditorCameraInput } from './editorCamera';
import {
  createEditorInputState,
  attachEditorInputListeners, clearEditorOneShots,
} from './editorInput';
import { selectAtCursor, placeAtCursor, deleteAtCursor, rotateSelectedElement } from './editorTools';
import { createEditorUI, EditorUI } from './editorUI';
import { renderEditorOverlays, renderEditorIndicator } from './editorRenderer';
import { showEditorWorldMap } from './editorWorldMap';
import { beginTransitionLink, completeTransitionLink, cancelTransitionLink } from './transitionLinker';
import { exportRoomAsJson } from './editorExport';

const BS = BLOCK_SIZE_MEDIUM;

/** Width of the editor UI panel in CSS pixels. */
const EDITOR_PANEL_WIDTH_CSS_PX = 260;

export interface EditorController {
  state: EditorState;
  /** Toggle editor on/off. */
  toggle: (currentRoom: RoomDef) => void;
  /** Called each frame. Returns true if editor is active (gameplay should be suppressed). */
  update: (
    dtSec: number,
    camera: CameraState,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    cssWidthPx: number,
    cssHeightPx: number,
    virtualWidthPx: number,
    virtualHeightPx: number,
  ) => boolean;
  /** Render editor overlays onto the 2D context. */
  render: (
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
  ) => void;
  /** Load a room for editing (called when jumping to a room from the world map). */
  loadRoomForEditing: (room: RoomDef) => void;
  /** Get a RoomDef rebuilt from the current editor data. */
  getRoomDef: () => RoomDef | null;
  /** Cleanup. */
  destroy: () => void;
}

/**
 * Creates the editor controller. Call once at game screen init.
 * @param onEditorClose Called when the editor closes via confirm or cancel.
 */
export function createEditorController(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  onLoadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number) => void,
  onEditorClose?: () => void,
): EditorController {
  const state = createEditorState();
  const inputState = createEditorInputState();
  let inputCleanup: (() => void) | null = null;
  let ui: EditorUI | null = null;
  let worldMapCleanup: (() => void) | null = null;

  // Drag-paint tracking: last block position where Place/Delete acted during a drag
  // Initialized to out-of-range sentinels so the first drag always triggers.
  const INVALID_DRAG_BLOCK = -0x7fff;
  let lastDragBlockX = INVALID_DRAG_BLOCK;
  let lastDragBlockY = INVALID_DRAG_BLOCK;

  // Saved source room data for transition linking across rooms
  let linkSourceRoomData: typeof state.roomData = null;
  let linkTargetRoomId = '';

  // Original room snapshot for cancel/revert
  let originalRoomDef: RoomDef | null = null;

  function toggle(currentRoom: RoomDef): void {
    state.isActive = !state.isActive;

    if (state.isActive) {
      // Save original room for cancel/revert
      originalRoomDef = currentRoom;

      // Initialize editor
      loadRoomForEditing(currentRoom);

      inputCleanup = attachEditorInputListeners(canvas, inputState, state);

      ui = createEditorUI(uiRoot);
      ui.setCallbacks({
        onToolChange: (tool) => { state.activeTool = tool; state.selectedElement = null; },
        onCategoryChange: (cat) => { state.activeCategory = cat; },
        onPaletteItemSelect: (item) => {
          state.selectedPaletteItem = item;
          state.activeTool = EditorTool.Place;
        },
        onExport: () => {
          if (state.roomData) exportRoomAsJson(state.roomData);
        },
        onLinkTransition: () => {
          if (beginTransitionLink(state)) {
            linkSourceRoomData = state.roomData;
            openWorldMap();
          }
        },
        onPropertyChange: handlePropertyChange,
        onRoomDimensionsChange: handleRoomDimensionsChange,
        onBlockThemeChange: (theme: BlockTheme) => {
          if (state.roomData) state.roomData.blockTheme = theme;
        },
        onLightingEffectChange: (lightingEffect: LightingEffect) => {
          if (state.roomData) state.roomData.lightingEffect = lightingEffect;
        },
        onBackgroundChange: (bgId: BackgroundId) => {
          if (state.roomData) state.roomData.backgroundId = bgId;
        },
        onConfirm: () => confirmEdits(),
        onCancel: () => cancelEdits(),
      });
    } else {
      closeEditor();
    }
  }

  function closeEditor(): void {
    if (inputCleanup) { inputCleanup(); inputCleanup = null; }
    if (ui) { ui.destroy(); ui = null; }
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    cancelTransitionLink(state);
    state.isActive = false;
    state.roomData = null;
    state.selectedElement = null;
    originalRoomDef = null;
    onEditorClose?.();
  }

  function confirmEdits(): void {
    // Build a RoomDef from the current editor data and load it
    if (state.roomData) {
      const newRoomDef = editorRoomDataToRoomDef(state.roomData);
      const sx = state.roomData.playerSpawnBlock[0];
      const sy = state.roomData.playerSpawnBlock[1];
      closeEditor();
      onLoadRoom(newRoomDef, sx, sy);
    } else {
      closeEditor();
    }
  }

  function cancelEdits(): void {
    // Restore the original room
    const saved = originalRoomDef;
    closeEditor();
    if (saved) {
      onLoadRoom(saved, saved.playerSpawnBlock[0], saved.playerSpawnBlock[1]);
    }
  }

  function loadRoomForEditing(room: RoomDef): void {
    const result = roomDefToEditorRoomData(room, state.nextUid);
    state.roomData = result.data;
    state.nextUid = result.nextUid;
    state.selectedElement = null;
  }

  function openWorldMap(): void {
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    state.isWorldMapOpen = true;

    worldMapCleanup = showEditorWorldMap(uiRoot, state.roomData?.id ?? '', {
      onSelectRoom: (room) => {
        state.isWorldMapOpen = false;
        worldMapCleanup = null;

        if (state.isLinkingTransition) {
          linkTargetRoomId = room.id;
        }

        // Load the new room for editing
        loadRoomForEditing(room);

        // Build a RoomDef and use the game's loadRoom to set up runtime state
        const roomDef = editorRoomDataToRoomDef(state.roomData!);
        onLoadRoom(roomDef, room.playerSpawnBlock[0], room.playerSpawnBlock[1]);
      },
      onClose: () => {
        state.isWorldMapOpen = false;
        worldMapCleanup = null;
      },
    });
  }

  function update(
    dtSec: number,
    camera: CameraState,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    cssWidthPx: number,
    cssHeightPx: number,
    virtualWidthPx: number,
    virtualHeightPx: number,
  ): boolean {
    if (!state.isActive) return false;
    if (state.isWorldMapOpen) return true;

    // Camera movement (shift doubles speed)
    const camInput: EditorCameraInput = {
      isUp: inputState.isCamUp,
      isDown: inputState.isCamDown,
      isLeft: inputState.isCamLeft,
      isRight: inputState.isCamRight,
      isShiftHeld: inputState.isShiftHeld,
    };
    updateEditorCamera(camera, camInput, dtSec);

    // Convert CSS screen mouse coordinates to virtual canvas coordinates.
    // e.clientX/clientY are in CSS pixels; cssWidthPx/cssHeightPx must be
    // the CSS display dimensions (not the canvas buffer dimensions).
    const virtualMouseX = (inputState.mouseScreenXPx / cssWidthPx) * virtualWidthPx;
    const virtualMouseY = (inputState.mouseScreenYPx / cssHeightPx) * virtualHeightPx;

    // Update cursor position (virtual → world → block)
    const worldX = (virtualMouseX - offsetXPx) / zoom;
    const worldY = (virtualMouseY - offsetYPx) / zoom;
    state.cursorWorldX = worldX;
    state.cursorWorldY = worldY;
    state.cursorBlockX = Math.floor(worldX / BS);
    state.cursorBlockY = Math.floor(worldY / BS);

    // Tool key shortcuts
    if (inputState.toolKeyPressed === 1) state.activeTool = EditorTool.Select;
    if (inputState.toolKeyPressed === 2) state.activeTool = EditorTool.Place;
    if (inputState.toolKeyPressed === 3) state.activeTool = EditorTool.Delete;

    // Mouse wheel → rotation
    if (inputState.wheelDelta !== 0) {
      if (state.activeTool === EditorTool.Place) {
        state.placementRotationSteps = (state.placementRotationSteps + (inputState.wheelDelta > 0 ? 1 : 3)) % 4;
      } else if (state.activeTool === EditorTool.Select && state.selectedElement) {
        rotateSelectedElement(state);
      }
    }

    // M key → world map
    if (inputState.isMapToggled) {
      openWorldMap();
    }

    // ESC → cancel linking or deselect
    if (inputState.isEscapePressed) {
      if (state.isLinkingTransition) {
        cancelTransitionLink(state);
      } else {
        state.selectedElement = null;
      }
    }

    // Click handling (one-shot on press)
    if (inputState.isClickFired && state.roomData !== null) {
      // Ignore clicks on the UI panel area (CSS pixel comparison)
      if (inputState.clickScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX) {
        if (state.isLinkingTransition) {
          // In link mode: clicking a transition completes the link
          const clicked = selectAtCursor(state);
          if (clicked && clicked.type === 'transition' && linkSourceRoomData) {
            const targetTrans = state.roomData.transitions.find((t: EditorTransition) => t.uid === clicked.uid);
            if (targetTrans) {
              completeTransitionLink(
                state,
                linkSourceRoomData.transitions,
                linkTargetRoomId || state.roomData.id,
                targetTrans,
                state.roomData.widthBlocks,
              );
              linkSourceRoomData = null;
              linkTargetRoomId = '';
            }
          }
        } else if (state.activeTool === EditorTool.Select) {
          state.selectedElement = selectAtCursor(state);
        } else if (state.activeTool === EditorTool.Place) {
          placeAtCursor(state);
          lastDragBlockX = state.cursorBlockX;
          lastDragBlockY = state.cursorBlockY;
        } else if (state.activeTool === EditorTool.Delete) {
          deleteAtCursor(state);
          lastDragBlockX = state.cursorBlockX;
          lastDragBlockY = state.cursorBlockY;
        }
      }
    }

    // Drag-paint: continue Place/Delete while mouse is held and cursor moves to a new block
    const canDragPaint =
      !inputState.isClickFired &&
      inputState.isMouseDown &&
      state.roomData !== null &&
      !state.isLinkingTransition &&
      inputState.mouseScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX &&
      (state.activeTool === EditorTool.Place || state.activeTool === EditorTool.Delete);

    if (canDragPaint) {
      if (state.cursorBlockX !== lastDragBlockX || state.cursorBlockY !== lastDragBlockY) {
        lastDragBlockX = state.cursorBlockX;
        lastDragBlockY = state.cursorBlockY;
        if (state.activeTool === EditorTool.Place) {
          placeAtCursor(state);
        } else if (state.activeTool === EditorTool.Delete) {
          deleteAtCursor(state);
        }
      }
    }

    // Update UI panel
    if (ui) ui.update(state);

    clearEditorOneShots(inputState);
    return true;
  }

  function render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
  ): void {
    if (!state.isActive) return;

    renderEditorIndicator(ctx, canvasWidth);
    renderEditorOverlays(ctx, state, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);
  }

  function getRoomDef(): RoomDef | null {
    if (!state.roomData) return null;
    return editorRoomDataToRoomDef(state.roomData);
  }

  function destroy(): void {
    if (inputCleanup) { inputCleanup(); inputCleanup = null; }
    if (ui) { ui.destroy(); ui = null; }
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
  }

  function handleRoomDimensionsChange(prop: 'widthBlocks' | 'heightBlocks', value: number): void {
    if (!state.roomData) return;

    const room = state.roomData;
    const clamped = Math.max(10, value);
    if (prop === 'widthBlocks') {
      room.widthBlocks = clamped;
    } else {
      room.heightBlocks = clamped;
    }

    const maxX = room.widthBlocks - 1;
    const maxY = room.heightBlocks - 1;

    // Keep spawn and point entities inside the new room bounds.
    room.playerSpawnBlock[0] = Math.min(Math.max(0, room.playerSpawnBlock[0]), maxX);
    room.playerSpawnBlock[1] = Math.min(Math.max(0, room.playerSpawnBlock[1]), maxY);

    for (const enemy of room.enemies) {
      enemy.xBlock = Math.min(Math.max(0, enemy.xBlock), maxX);
      enemy.yBlock = Math.min(Math.max(0, enemy.yBlock), maxY);
    }

    for (const tomb of room.skillTombs) {
      tomb.xBlock = Math.min(Math.max(0, tomb.xBlock), maxX);
      tomb.yBlock = Math.min(Math.max(0, tomb.yBlock), maxY);
    }

    // Clamp interior wall rectangles so they stay fully inside the room.
    for (const wall of room.interiorWalls) {
      wall.wBlock = Math.max(1, Math.min(wall.wBlock, room.widthBlocks));
      wall.hBlock = Math.max(1, Math.min(wall.hBlock, room.heightBlocks));
      wall.xBlock = Math.min(Math.max(0, wall.xBlock), room.widthBlocks - wall.wBlock);
      wall.yBlock = Math.min(Math.max(0, wall.yBlock), room.heightBlocks - wall.hBlock);
    }

    // Keep transitions valid for the updated room dimensions.
    for (const trans of room.transitions) {
      if (trans.direction === 'left' || trans.direction === 'right') {
        const maxOpening = Math.max(1, room.heightBlocks - 2);
        trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
        trans.positionBlock = Math.min(
          Math.max(1, trans.positionBlock),
          room.heightBlocks - 1 - trans.openingSizeBlocks,
        );
      } else {
        const maxOpening = Math.max(1, room.widthBlocks - 2);
        trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
        trans.positionBlock = Math.min(
          Math.max(1, trans.positionBlock),
          room.widthBlocks - 1 - trans.openingSizeBlocks,
        );
      }
    }
  }

  function handlePropertyChange(prop: string, value: string | number): void {
    if (!state.roomData || !state.selectedElement) return;
    const el = state.selectedElement;
    const room = state.roomData;
    const numVal = typeof value === 'number' ? value : parseInt(value as string, 10);

    if (el.type === 'wall') {
      const wall = room.interiorWalls.find((w: EditorWall) => w.uid === el.uid);
      if (wall) {
        if (prop === 'wall.xBlock' && !isNaN(numVal)) wall.xBlock = numVal;
        if (prop === 'wall.yBlock' && !isNaN(numVal)) wall.yBlock = numVal;
        if (prop === 'wall.wBlock' && !isNaN(numVal)) wall.wBlock = Math.max(1, numVal);
        if (prop === 'wall.hBlock' && !isNaN(numVal)) wall.hBlock = Math.max(1, numVal);
      }
    } else if (el.type === 'enemy') {
      const enemy = room.enemies.find((e: EditorEnemy) => e.uid === el.uid);
      if (enemy) {
        if (prop === 'enemy.xBlock' && !isNaN(numVal)) enemy.xBlock = numVal;
        if (prop === 'enemy.yBlock' && !isNaN(numVal)) enemy.yBlock = numVal;
        if (prop === 'enemy.kinds' && typeof value === 'string') {
          enemy.kinds = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        }
        if (prop === 'enemy.particleCount' && !isNaN(numVal)) enemy.particleCount = Math.max(1, numVal);
        if (prop === 'enemy.type') {
          if (value === 'rolling') {
            enemy.isRollingEnemyFlag = 1;
            enemy.isFlyingEyeFlag = 0;
          } else {
            enemy.isRollingEnemyFlag = 0;
            enemy.isFlyingEyeFlag = 1;
          }
        }
        if (prop === 'enemy.rollingEnemySpriteIndex' && !isNaN(numVal)) {
          enemy.rollingEnemySpriteIndex = Math.max(1, Math.min(6, numVal));
        }
        if (prop === 'enemy.isBossFlag') {
          enemy.isBossFlag = numVal ? 1 : 0;
        }
      }
    } else if (el.type === 'transition') {
      const trans = room.transitions.find((t: EditorTransition) => t.uid === el.uid);
      if (trans) {
        if (prop === 'transition.direction' && typeof value === 'string') {
          trans.direction = value as 'left' | 'right' | 'up' | 'down';
        }
        if (prop === 'transition.positionBlock' && !isNaN(numVal)) trans.positionBlock = numVal;
        if (prop === 'transition.openingSizeBlocks' && !isNaN(numVal)) trans.openingSizeBlocks = Math.max(1, numVal);
        if (prop === 'transition.targetRoomId' && typeof value === 'string') trans.targetRoomId = value;
        if (prop === 'transition.targetSpawnBlockX' && !isNaN(numVal)) trans.targetSpawnBlock[0] = numVal;
        if (prop === 'transition.targetSpawnBlockY' && !isNaN(numVal)) trans.targetSpawnBlock[1] = numVal;
      }
    } else if (el.type === 'playerSpawn') {
      if (prop === 'playerSpawn.xBlock' && !isNaN(numVal)) room.playerSpawnBlock[0] = numVal;
      if (prop === 'playerSpawn.yBlock' && !isNaN(numVal)) room.playerSpawnBlock[1] = numVal;
    } else if (el.type === 'skillTomb') {
      const tomb = room.skillTombs.find((s: EditorSkillTomb) => s.uid === el.uid);
      if (tomb) {
        if (prop === 'skillTomb.xBlock' && !isNaN(numVal)) tomb.xBlock = numVal;
        if (prop === 'skillTomb.yBlock' && !isNaN(numVal)) tomb.yBlock = numVal;
      }
    }
  }

  return {
    state,
    toggle,
    update,
    render,
    loadRoomForEditing,
    getRoomDef,
    destroy,
  };
}
