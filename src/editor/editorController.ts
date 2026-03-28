/**
 * Editor controller — orchestrates editor lifecycle, input processing,
 * tool actions, camera updates, UI, world map, transition linking,
 * and room loading. This is the single integration point consumed by
 * gameScreen.ts.
 */

import { BLOCK_SIZE_WORLD } from '../levels/roomDef';
import type { RoomDef } from '../levels/roomDef';
import type { CameraState } from '../render/camera';

import {
  EditorState, createEditorState, EditorTool,
  EditorWall, EditorEnemy, EditorTransition, EditorSkillTomb,
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

const BS = BLOCK_SIZE_WORLD;

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
 */
export function createEditorController(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  onLoadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number) => void,
): EditorController {
  const state = createEditorState();
  const inputState = createEditorInputState();
  let inputCleanup: (() => void) | null = null;
  let ui: EditorUI | null = null;
  let worldMapCleanup: (() => void) | null = null;

  // Saved source room data for transition linking across rooms
  let linkSourceRoomData: typeof state.roomData = null;
  let linkTargetRoomId = '';

  function toggle(currentRoom: RoomDef): void {
    state.isActive = !state.isActive;

    if (state.isActive) {
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
      });
    } else {
      // Cleanup editor
      if (inputCleanup) { inputCleanup(); inputCleanup = null; }
      if (ui) { ui.destroy(); ui = null; }
      if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
      cancelTransitionLink(state);
      state.roomData = null;
      state.selectedElement = null;
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
  ): boolean {
    if (!state.isActive) return false;
    if (state.isWorldMapOpen) return true;

    // Camera movement
    const camInput: EditorCameraInput = {
      isUp: inputState.isCamUp,
      isDown: inputState.isCamDown,
      isLeft: inputState.isCamLeft,
      isRight: inputState.isCamRight,
    };
    updateEditorCamera(camera, camInput, dtSec);

    // Update cursor position (screen → world → block)
    const worldX = (inputState.mouseScreenXPx - offsetXPx) / zoom;
    const worldY = (inputState.mouseScreenYPx - offsetYPx) / zoom;
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

    // Click handling
    if (inputState.isClickFired && state.roomData !== null) {
      // Ignore clicks on the UI panel area
      if (inputState.clickScreenXPx > 260) {
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
