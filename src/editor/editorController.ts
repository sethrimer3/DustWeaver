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
  EditorWall, EditorEnemy, EditorTransition, EditorSkillTomb, EditorDustPile,
  BlockTheme, BackgroundId, LightingEffect,
  SelectedElement, allocateUid, EditorRoomData,
} from './editorState';
import { roomDefToEditorRoomData, editorRoomDataToRoomDef } from './roomJson';
import { updateEditorCamera, EditorCameraInput } from './editorCamera';
import {
  createEditorInputState,
  attachEditorInputListeners, clearEditorOneShots,
} from './editorInput';
import { selectAtCursor, placeAtCursor, deleteAtCursor, rotateSelectedElement, getAllElementsInRect } from './editorTools';
import { createEditorUI, EditorUI } from './editorUI';
import type { RoomEdge } from './editorUI';
import { renderEditorOverlays, renderEditorIndicator } from './editorRenderer';
import { showEditorWorldMap } from './editorWorldMap';
import { showVisualWorldMap } from './editorVisualMap';
import { beginTransitionLink, completeTransitionLink, cancelTransitionLink } from './transitionLinker';
import { exportRoomAsJson, exportAllChanges } from './editorExport';
import { ROOM_REGISTRY } from '../levels/rooms';
import { createEditorHistory, pushSnapshot, undo, redo, clearHistory } from './editorHistory';
import type { EditorHistory } from './editorHistory';

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
  onLoadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number, preserveCamera?: boolean) => void,
  onEditorClose?: () => void,
): EditorController {
  const state = createEditorState();
  const inputState = createEditorInputState();
  const history: EditorHistory = createEditorHistory();
  let inputCleanup: (() => void) | null = null;
  let ui: EditorUI | null = null;
  let worldMapCleanup: (() => void) | null = null;
  let visualMapCleanup: (() => void) | null = null;

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

  // Drag-to-move: original positions of selected elements at drag start
  let dragOriginalPositions: Map<number, { xBlock: number; yBlock: number }> = new Map();

  // ── Pending-edits persistence for multi-room editing ────────────────────
  // Stores EditorRoomData snapshots saved by the user as they navigate rooms.
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  // Room IDs that existed when the editor session started (identifies new rooms).
  let initialRoomIds = new Set<string>();
  // True if any world-map metadata (names, positions, world assignments) changed.
  let isWorldMapDirty = false;
  // True if the current room has unsaved edits since it was last loaded.
  let isCurrentRoomDirty = false;

  function toggle(currentRoom: RoomDef): void {
    state.isActive = !state.isActive;

    if (state.isActive) {
      // Snapshot which rooms already exist so we can identify newly-added ones.
      initialRoomIds = new Set(ROOM_REGISTRY.keys());
      isWorldMapDirty = false;
      isCurrentRoomDirty = false;
      pendingRoomEdits.clear();

      // Save original room for cancel/revert
      originalRoomDef = currentRoom;

      // Initialize editor
      loadRoomForEditing(currentRoom);

      inputCleanup = attachEditorInputListeners(canvas, inputState, state);

      ui = createEditorUI(uiRoot);
      ui.setCallbacks({
        onToolChange: (tool) => { state.activeTool = tool; state.selectedElements = []; },
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
        onPropertyChange: (prop: string, value: string | number) => {
          handlePropertyChange(prop, value);
          applyEdits();
        },
        onRoomDimensionsChange: (dimProp: 'widthBlocks' | 'heightBlocks', value: number) => {
          handleRoomDimensionsChange(dimProp, value);
          applyEdits();
        },
        onEdgeResize: (edge: RoomEdge, delta: 1 | -1) => {
          handleEdgeResize(edge, delta);
          applyEdits();
        },
        onBlockThemeChange: (theme: BlockTheme) => {
          if (state.roomData) state.roomData.blockTheme = theme;
          applyEdits();
        },
        onLightingEffectChange: (lightingEffect: LightingEffect) => {
          if (state.roomData) state.roomData.lightingEffect = lightingEffect;
          applyEdits();
        },
        onBackgroundChange: (bgId: BackgroundId) => {
          if (state.roomData) state.roomData.backgroundId = bgId;
          applyEdits();
        },
        onConfirm: () => confirmEdits(),
        onCancel: () => cancelEdits(),
        onExportAllChanges: () => {
          // Auto-save current room to pending before exporting so it's included.
          if (isCurrentRoomDirty && state.roomData) {
            pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
            isCurrentRoomDirty = false;
          }
          exportAllChanges(pendingRoomEdits, initialRoomIds, isWorldMapDirty);
        },
      });
    } else {
      closeEditor();
    }
  }

  function closeEditor(): void {
    if (inputCleanup) { inputCleanup(); inputCleanup = null; }
    if (ui) { ui.destroy(); ui = null; }
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }
    cancelTransitionLink(state);
    state.isActive = false;
    state.roomData = null;
    state.selectedElements = [];
    state.isDragging = false;
    state.isSelectionBoxActive = false;
    originalRoomDef = null;
    pendingRoomEdits.clear();
    initialRoomIds = new Set();
    isWorldMapDirty = false;
    isCurrentRoomDirty = false;
    clearHistory(history);
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
    // If the current room has unsaved changes, ask whether to save them first.
    if (isCurrentRoomDirty && state.roomData) {
      showSaveChangesDialog(uiRoot, () => {
        // YES — save to pending, then exit
        if (state.roomData) {
          pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
        }
        isCurrentRoomDirty = false;
        const saved = originalRoomDef;
        closeEditor();
        if (saved) onLoadRoom(saved, saved.playerSpawnBlock[0], saved.playerSpawnBlock[1]);
      }, () => {
        // NO — exit without saving
        const saved = originalRoomDef;
        closeEditor();
        if (saved) onLoadRoom(saved, saved.playerSpawnBlock[0], saved.playerSpawnBlock[1]);
      });
    } else {
      // No unsaved changes — exit immediately
      const saved = originalRoomDef;
      closeEditor();
      if (saved) onLoadRoom(saved, saved.playerSpawnBlock[0], saved.playerSpawnBlock[1]);
    }
  }

  /**
   * Rebuild and reload the room from current editor data so changes are
   * immediately visible.  The editor stays active; time remains frozen;
   * player and enemies revert to their spawn positions.
   */
  function applyEdits(): void {
    if (!state.roomData) return;
    isCurrentRoomDirty = true;
    const roomDef = editorRoomDataToRoomDef(state.roomData);
    const sx = state.roomData.playerSpawnBlock[0];
    const sy = state.roomData.playerSpawnBlock[1];
    onLoadRoom(roomDef, sx, sy, true); // preserve camera while in editor
  }

  function loadRoomForEditing(room: RoomDef): void {
    const pending = pendingRoomEdits.get(room.id);
    if (pending) {
      // Restore previously-saved edits for this room.
      state.roomData = deepCloneRoomData(pending);
      // Recalculate nextUid to be above all existing element UIDs.
      let maxUid = 0;
      for (const w of state.roomData.interiorWalls)  maxUid = Math.max(maxUid, w.uid + 1);
      for (const e of state.roomData.enemies)        maxUid = Math.max(maxUid, e.uid + 1);
      for (const t of state.roomData.transitions)    maxUid = Math.max(maxUid, t.uid + 1);
      for (const s of state.roomData.skillTombs)     maxUid = Math.max(maxUid, s.uid + 1);
      for (const p of state.roomData.dustPiles)      maxUid = Math.max(maxUid, p.uid + 1);
      // Ensure nextUid never regresses below its current value (other rooms may
      // already have used higher UIDs during this session).
      state.nextUid = Math.max(state.nextUid, maxUid);
    } else {
      const result = roomDefToEditorRoomData(room, state.nextUid);
      state.roomData = result.data;
      state.nextUid = result.nextUid;
    }
    state.selectedElements = [];
    isCurrentRoomDirty = false;
  }

  function openWorldMap(): void {
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    state.isWorldMapOpen = true;

    const isLinkMode = state.isLinkingTransition;

    worldMapCleanup = showEditorWorldMap(uiRoot, state.roomData?.id ?? '', isLinkMode, {
      onSelectRoom: (room) => {
        state.isWorldMapOpen = false;
        worldMapCleanup = null;

        const doSwitch = () => {
          loadRoomForEditing(room);
          const roomDef = editorRoomDataToRoomDef(state.roomData!);
          onLoadRoom(roomDef, room.playerSpawnBlock[0], room.playerSpawnBlock[1]);
        };

        if (isCurrentRoomDirty && state.roomData) {
          showSaveChangesDialog(uiRoot, () => {
            if (state.roomData) {
              pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
            }
            isCurrentRoomDirty = false;
            doSwitch();
          }, () => {
            isCurrentRoomDirty = false;
            doSwitch();
          });
        } else {
          doSwitch();
        }
      },
      onLinkTransition: (room, transitionIndex) => {
        state.isWorldMapOpen = false;
        worldMapCleanup = null;

        // Complete the link using the selected transition from the target room
        if (linkSourceRoomData && room.transitions[transitionIndex]) {
          const targetTrans = room.transitions[transitionIndex];
          // Build a temporary EditorTransition for completeTransitionLink
          const editorTargetTrans: EditorTransition = {
            uid: -1,
            direction: targetTrans.direction,
            positionBlock: targetTrans.positionBlock,
            openingSizeBlocks: targetTrans.openingSizeBlocks,
            targetRoomId: '',
            targetSpawnBlock: [targetTrans.targetSpawnBlock[0], targetTrans.targetSpawnBlock[1]],
          };
          completeTransitionLink(
            state,
            linkSourceRoomData.transitions,
            room.id,
            editorTargetTrans,
            room.widthBlocks,
          );
          linkSourceRoomData = null;
          linkTargetRoomId = '';

          // Rebuild the current room to reflect the change
          applyEdits();
        }
      },
      onClose: () => {
        state.isWorldMapOpen = false;
        worldMapCleanup = null;
        if (isLinkMode) {
          cancelTransitionLink(state);
        }
      },
      onWorldMapDataChanged: () => { isWorldMapDirty = true; },
    });
  }

  function openVisualMap(): void {
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }
    state.isVisualMapOpen = true;

    visualMapCleanup = showVisualWorldMap(uiRoot, state.roomData?.id ?? '', {
      onJumpToRoom: (room) => {
        state.isVisualMapOpen = false;
        visualMapCleanup = null;

        const doSwitch = () => {
          loadRoomForEditing(room);
          const roomDef = editorRoomDataToRoomDef(state.roomData!);
          onLoadRoom(roomDef, room.playerSpawnBlock[0], room.playerSpawnBlock[1]);
        };

        if (isCurrentRoomDirty && state.roomData) {
          showSaveChangesDialog(uiRoot, () => {
            if (state.roomData) {
              pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
            }
            isCurrentRoomDirty = false;
            doSwitch();
          }, () => {
            isCurrentRoomDirty = false;
            doSwitch();
          });
        } else {
          doSwitch();
        }
      },
      onClose: () => {
        state.isVisualMapOpen = false;
        visualMapCleanup = null;
      },
      onWorldMapDataChanged: () => { isWorldMapDirty = true; },
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
    if (state.isWorldMapOpen || state.isVisualMapOpen) return true;

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
      } else if (state.activeTool === EditorTool.Select && state.selectedElements.length > 0) {
        rotateSelectedElement(state);
      }
    }

    // Q/E keys → rotate placement (Q = counter-clockwise, E = clockwise)
    if (inputState.isRotateLeftPressed && state.activeTool === EditorTool.Place) {
      state.placementRotationSteps = (state.placementRotationSteps + 3) % 4;
    }
    if (inputState.isRotateRightPressed && state.activeTool === EditorTool.Place) {
      state.placementRotationSteps = (state.placementRotationSteps + 1) % 4;
    }

    // F key → flip placement horizontally
    if (inputState.isFlipPressed && state.activeTool === EditorTool.Place) {
      state.placementFlipH = !state.placementFlipH;
    }

    // M key → world map
    if (inputState.isMapToggled) {
      openWorldMap();
    }

    // N key → visual world map editor
    if (inputState.isVisualMapToggled) {
      openVisualMap();
    }

    // ESC → cancel linking or deselect
    if (inputState.isEscapePressed) {
      if (state.isLinkingTransition) {
        cancelTransitionLink(state);
      } else {
        state.selectedElements = [];
      }
    }

    // Undo/Redo
    if (inputState.isUndoPressed && state.roomData) {
      const restored = undo(history, state.roomData);
      if (restored) {
        state.roomData = restored;
        state.selectedElements = [];
        applyEdits();
      }
    }
    if (inputState.isRedoPressed && state.roomData) {
      const restored = redo(history, state.roomData);
      if (restored) {
        state.roomData = restored;
        state.selectedElements = [];
        applyEdits();
      }
    }

    // Copy (Ctrl+C)
    if (inputState.isCopyPressed && state.roomData && state.selectedElements.length > 0) {
      const clipData = serializeSelectedElements(state.roomData, state.selectedElements);
      state.clipboard = clipData;
    }

    // Paste (Ctrl+V)
    if (inputState.isPastePressed && state.roomData && state.clipboard) {
      pushSnapshot(history, state.roomData);
      pasteFromClipboard(state);
      applyEdits();
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
          const clicked = selectAtCursor(state);
          if (clicked) {
            if (inputState.isShiftHeld) {
              // Shift-click: toggle selection
              const idx = state.selectedElements.findIndex(e => e.type === clicked.type && e.uid === clicked.uid);
              if (idx >= 0) {
                state.selectedElements.splice(idx, 1);
              } else {
                state.selectedElements.push(clicked);
              }
            } else {
              // Normal click on object: select it
              state.selectedElements = [clicked];
            }
          } else if (!inputState.isShiftHeld) {
            // Click on empty space without shift: begin selection box
            state.selectedElements = [];
            state.isSelectionBoxActive = true;
            state.selectionBoxStartBlockX = state.cursorBlockX;
            state.selectionBoxStartBlockY = state.cursorBlockY;
          }
        } else if (state.activeTool === EditorTool.Place) {
          pushSnapshot(history, state.roomData);
          placeAtCursor(state);
          applyEdits();
          lastDragBlockX = state.cursorBlockX;
          lastDragBlockY = state.cursorBlockY;
        } else if (state.activeTool === EditorTool.Delete) {
          pushSnapshot(history, state.roomData);
          deleteAtCursor(state);
          applyEdits();
          lastDragBlockX = state.cursorBlockX;
          lastDragBlockY = state.cursorBlockY;
        }
      }
    }

    // Right-click delete (one-shot)
    if (inputState.isRightClickFired && state.roomData !== null) {
      if (inputState.rightClickScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX) {
        pushSnapshot(history, state.roomData);
        deleteAtCursor(state);
        applyEdits();
      }
    }

    // Drag-to-move for Select tool
    if (state.activeTool === EditorTool.Select && inputState.isMouseDown && state.selectedElements.length > 0 && !state.isLinkingTransition && !state.isSelectionBoxActive) {
      if (!state.isDragging) {
        const dxPx = inputState.mouseScreenXPx - inputState.clickScreenXPx;
        const dyPx = inputState.mouseScreenYPx - inputState.clickScreenYPx;
        if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) {
          state.isDragging = true;
          state.dragStartBlockX = state.cursorBlockX;
          state.dragStartBlockY = state.cursorBlockY;
          pushSnapshot(history, state.roomData!);
          storeDragStartPositions(state, dragOriginalPositions);
        }
      }
      if (state.isDragging && state.roomData) {
        const deltaX = state.cursorBlockX - state.dragStartBlockX;
        const deltaY = state.cursorBlockY - state.dragStartBlockY;
        moveSelectedElements(state, dragOriginalPositions, deltaX, deltaY);
      }
    }

    // Selection box dragging
    if (state.isSelectionBoxActive && inputState.isMouseDown && state.activeTool === EditorTool.Select) {
      // Box is being drawn — no action needed; rendering handles the visual
    }

    // Mouse release
    if (!inputState.isMouseDown) {
      if (state.isDragging) {
        state.isDragging = false;
        dragOriginalPositions.clear();
        applyEdits();
      }
      if (state.isSelectionBoxActive) {
        state.isSelectionBoxActive = false;
        if (state.roomData) {
          const boxElements = getAllElementsInRect(
            state.roomData,
            Math.min(state.selectionBoxStartBlockX, state.cursorBlockX),
            Math.min(state.selectionBoxStartBlockY, state.cursorBlockY),
            Math.max(state.selectionBoxStartBlockX, state.cursorBlockX),
            Math.max(state.selectionBoxStartBlockY, state.cursorBlockY),
          );
          if (inputState.isShiftHeld) {
            // Add to existing selection
            for (const el of boxElements) {
              if (!state.selectedElements.some(e => e.type === el.type && e.uid === el.uid)) {
                state.selectedElements.push(el);
              }
            }
          } else {
            state.selectedElements = boxElements;
          }
        }
      }
    }

    // Drag-paint: continue Place/Delete while mouse is held and cursor moves to a new block
    const canDragPaint =
      !inputState.isClickFired &&
      inputState.isMouseDown &&
      state.roomData !== null &&
      !state.isLinkingTransition &&
      !state.isDragging &&
      !state.isSelectionBoxActive &&
      inputState.mouseScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX &&
      (state.activeTool === EditorTool.Place || state.activeTool === EditorTool.Delete);

    if (canDragPaint) {
      if (state.cursorBlockX !== lastDragBlockX || state.cursorBlockY !== lastDragBlockY) {
        lastDragBlockX = state.cursorBlockX;
        lastDragBlockY = state.cursorBlockY;
        if (state.activeTool === EditorTool.Place) {
          placeAtCursor(state);
          applyEdits();
        } else if (state.activeTool === EditorTool.Delete) {
          deleteAtCursor(state);
          applyEdits();
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

    renderEditorIndicator(ctx, canvasWidth, state);
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
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }
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

    for (const pile of room.dustPiles) {
      pile.xBlock = Math.min(Math.max(0, pile.xBlock), maxX);
      pile.yBlock = Math.min(Math.max(0, pile.yBlock), maxY);
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

  /**
   * Add or remove one row/column from the given edge.
   * Adding to top/left shifts all content. Adding to bottom/right just extends.
   * Removing from top/left shifts content the other direction.
   * Minimum room size is 10×10.
   */
  function handleEdgeResize(edge: RoomEdge, delta: 1 | -1): void {
    if (!state.roomData) return;
    pushSnapshot(history, state.roomData);
    const room = state.roomData;

    const isHorizontal = edge === 'left' || edge === 'right';
    const prop = isHorizontal ? 'widthBlocks' : 'heightBlocks';
    const currentSize = room[prop];
    const newSize = currentSize + delta;

    // Enforce minimum room size of 10
    if (newSize < 10) return;

    room[prop] = newSize;

    // When adding/removing from top or left, we need to shift all content
    const needsShift = edge === 'top' || edge === 'left';
    if (needsShift) {
      const shiftX = edge === 'left' ? delta : 0;
      const shiftY = edge === 'top' ? delta : 0;

      // Shift player spawn
      room.playerSpawnBlock[0] += shiftX;
      room.playerSpawnBlock[1] += shiftY;

      // Shift enemies
      for (const enemy of room.enemies) {
        enemy.xBlock += shiftX;
        enemy.yBlock += shiftY;
      }

      // Shift skill tombs
      for (const tomb of room.skillTombs) {
        tomb.xBlock += shiftX;
        tomb.yBlock += shiftY;
      }

      // Shift dust piles
      for (const pile of room.dustPiles) {
        pile.xBlock += shiftX;
        pile.yBlock += shiftY;
      }

      // Shift interior walls
      for (const wall of room.interiorWalls) {
        wall.xBlock += shiftX;
        wall.yBlock += shiftY;
      }

      // Shift transitions along the shifted axis
      for (const trans of room.transitions) {
        if (edge === 'top' && (trans.direction === 'left' || trans.direction === 'right')) {
          trans.positionBlock += shiftY;
        }
        if (edge === 'left' && (trans.direction === 'up' || trans.direction === 'down')) {
          trans.positionBlock += shiftX;
        }
      }
    }

    // Re-clamp everything to new bounds
    handleRoomDimensionsChange(prop, newSize);
  }

  function handlePropertyChange(prop: string, value: string | number): void {
    if (!state.roomData || state.selectedElements.length === 0) return;

    pushSnapshot(history, state.roomData);

    // Apply property to all selected elements of matching type
    for (const el of state.selectedElements) {
      applyPropertyToElement(el, prop, value);
    }
  }

  function applyPropertyToElement(el: SelectedElement, prop: string, value: string | number): void {
    if (!state.roomData) return;
    const room = state.roomData;
    const numVal = typeof value === 'number' ? value : parseInt(value as string, 10);

    if (el.type === 'wall') {
      const wall = room.interiorWalls.find((w: EditorWall) => w.uid === el.uid);
      if (wall) {
        if (prop === 'wall.xBlock' && !isNaN(numVal)) wall.xBlock = numVal;
        if (prop === 'wall.yBlock' && !isNaN(numVal)) wall.yBlock = numVal;
        if (prop === 'wall.wBlock' && !isNaN(numVal)) wall.wBlock = Math.max(1, numVal);
        if (prop === 'wall.hBlock' && !isNaN(numVal)) wall.hBlock = Math.max(1, numVal);
        if (prop === 'wall.blockTheme' && typeof value === 'string') {
          wall.blockTheme = value as BlockTheme;
        }
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
        if (prop === 'transition.fadeColor' && typeof value === 'string') trans.fadeColor = value;
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
    } else if (el.type === 'dustPile') {
      const pile = room.dustPiles.find((p: EditorDustPile) => p.uid === el.uid);
      if (pile) {
        if (prop === 'dustPile.xBlock' && !isNaN(numVal)) pile.xBlock = numVal;
        if (prop === 'dustPile.yBlock' && !isNaN(numVal)) pile.yBlock = numVal;
        if (prop === 'dustPile.dustCount' && !isNaN(numVal)) pile.dustCount = Math.max(1, numVal);
      }
    }
  }

  // ── Drag-to-move helpers ─────────────────────────────────────────────────

  function storeDragStartPositions(s: EditorState, positions: Map<number, { xBlock: number; yBlock: number }>): void {
    positions.clear();
    if (!s.roomData) return;
    for (const el of s.selectedElements) {
      const key = el.type === 'playerSpawn' ? 0 : el.uid;
      if (el.type === 'wall') {
        const w = s.roomData.interiorWalls.find(w2 => w2.uid === el.uid);
        if (w) positions.set(key, { xBlock: w.xBlock, yBlock: w.yBlock });
      } else if (el.type === 'enemy') {
        const e = s.roomData.enemies.find(e2 => e2.uid === el.uid);
        if (e) positions.set(key, { xBlock: e.xBlock, yBlock: e.yBlock });
      } else if (el.type === 'skillTomb') {
        const t = s.roomData.skillTombs.find(t2 => t2.uid === el.uid);
        if (t) positions.set(key, { xBlock: t.xBlock, yBlock: t.yBlock });
      } else if (el.type === 'dustPile') {
        const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
        if (p) positions.set(key, { xBlock: p.xBlock, yBlock: p.yBlock });
      } else if (el.type === 'playerSpawn') {
        positions.set(0, { xBlock: s.roomData.playerSpawnBlock[0], yBlock: s.roomData.playerSpawnBlock[1] });
      } else if (el.type === 'transition') {
        const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
        // Store positionBlock in xBlock; we'll apply the correct delta axis in moveSelectedElements.
        if (tr) positions.set(key, { xBlock: tr.positionBlock, yBlock: tr.positionBlock });
      }
    }
  }

  function moveSelectedElements(
    s: EditorState,
    positions: Map<number, { xBlock: number; yBlock: number }>,
    deltaX: number, deltaY: number,
  ): void {
    if (!s.roomData) return;
    for (const el of s.selectedElements) {
      const key = el.type === 'playerSpawn' ? 0 : el.uid;
      const orig = positions.get(key);
      if (!orig) continue;
      if (el.type === 'wall') {
        const w = s.roomData.interiorWalls.find(w2 => w2.uid === el.uid);
        if (w) { w.xBlock = orig.xBlock + deltaX; w.yBlock = orig.yBlock + deltaY; }
      } else if (el.type === 'enemy') {
        const e = s.roomData.enemies.find(e2 => e2.uid === el.uid);
        if (e) { e.xBlock = orig.xBlock + deltaX; e.yBlock = orig.yBlock + deltaY; }
      } else if (el.type === 'skillTomb') {
        const t = s.roomData.skillTombs.find(t2 => t2.uid === el.uid);
        if (t) { t.xBlock = orig.xBlock + deltaX; t.yBlock = orig.yBlock + deltaY; }
      } else if (el.type === 'dustPile') {
        const p = s.roomData.dustPiles.find(p2 => p2.uid === el.uid);
        if (p) { p.xBlock = orig.xBlock + deltaX; p.yBlock = orig.yBlock + deltaY; }
      } else if (el.type === 'playerSpawn') {
        s.roomData.playerSpawnBlock[0] = orig.xBlock + deltaX;
        s.roomData.playerSpawnBlock[1] = orig.yBlock + deltaY;
      } else if (el.type === 'transition') {
        const tr = s.roomData.transitions.find(t2 => t2.uid === el.uid);
        if (tr) {
          // Left/right transitions slide vertically (Y axis); up/down slide horizontally (X axis).
          const delta = (tr.direction === 'left' || tr.direction === 'right') ? deltaY : deltaX;
          const newPos = orig.xBlock + delta;
          const roomLimit = (tr.direction === 'left' || tr.direction === 'right')
            ? s.roomData.heightBlocks
            : s.roomData.widthBlocks;
          tr.positionBlock = Math.max(1, Math.min(roomLimit - tr.openingSizeBlocks - 1, newPos));
        }
      }
    }
  }

  // ── Copy/Paste helpers ───────────────────────────────────────────────────

  function serializeSelectedElements(room: EditorRoomData, elements: SelectedElement[]): string {
    const data: { walls: EditorWall[]; enemies: EditorEnemy[]; skillTombs: EditorSkillTomb[]; dustPiles: EditorDustPile[] } = {
      walls: [], enemies: [], skillTombs: [], dustPiles: [],
    };
    for (const el of elements) {
      if (el.type === 'wall') {
        const w = room.interiorWalls.find(w2 => w2.uid === el.uid);
        if (w) data.walls.push({ ...w });
      } else if (el.type === 'enemy') {
        const e = room.enemies.find(e2 => e2.uid === el.uid);
        if (e) data.enemies.push({ ...e });
      } else if (el.type === 'skillTomb') {
        const t = room.skillTombs.find(t2 => t2.uid === el.uid);
        if (t) data.skillTombs.push({ ...t });
      } else if (el.type === 'dustPile') {
        const p = room.dustPiles.find(p2 => p2.uid === el.uid);
        if (p) data.dustPiles.push({ ...p });
      }
    }
    return JSON.stringify(data);
  }

  function pasteFromClipboard(s: EditorState): void {
    if (!s.roomData || !s.clipboard) return;
    let data: { walls: EditorWall[]; enemies: EditorEnemy[]; skillTombs: EditorSkillTomb[]; dustPiles: EditorDustPile[] };
    try {
      data = JSON.parse(s.clipboard) as typeof data;
    } catch {
      return;
    }

    const newElements: SelectedElement[] = [];
    // Offset paste by 1 block from cursor
    const offsetX = s.cursorBlockX;
    const offsetY = s.cursorBlockY;
    // Find min coords from clipboard to compute relative offsets
    let minX = Infinity, minY = Infinity;
    for (const w of data.walls) { minX = Math.min(minX, w.xBlock); minY = Math.min(minY, w.yBlock); }
    for (const e of data.enemies) { minX = Math.min(minX, e.xBlock); minY = Math.min(minY, e.yBlock); }
    for (const t of data.skillTombs) { minX = Math.min(minX, t.xBlock); minY = Math.min(minY, t.yBlock); }
    for (const p of (data.dustPiles ?? [])) { minX = Math.min(minX, p.xBlock); minY = Math.min(minY, p.yBlock); }
    if (!isFinite(minX)) minX = 0;
    if (!isFinite(minY)) minY = 0;

    for (const w of data.walls) {
      const newUid = allocateUid(s);
      s.roomData.interiorWalls.push({
        ...w,
        uid: newUid,
        xBlock: w.xBlock - minX + offsetX,
        yBlock: w.yBlock - minY + offsetY,
      });
      newElements.push({ type: 'wall', uid: newUid });
    }
    for (const e of data.enemies) {
      const newUid = allocateUid(s);
      s.roomData.enemies.push({
        ...e,
        uid: newUid,
        xBlock: e.xBlock - minX + offsetX,
        yBlock: e.yBlock - minY + offsetY,
      });
      newElements.push({ type: 'enemy', uid: newUid });
    }
    for (const t of data.skillTombs) {
      const newUid = allocateUid(s);
      s.roomData.skillTombs.push({
        ...t,
        uid: newUid,
        xBlock: t.xBlock - minX + offsetX,
        yBlock: t.yBlock - minY + offsetY,
      });
      newElements.push({ type: 'skillTomb', uid: newUid });
    }
    for (const p of (data.dustPiles ?? [])) {
      const newUid = allocateUid(s);
      s.roomData.dustPiles.push({
        ...p,
        uid: newUid,
        xBlock: p.xBlock - minX + offsetX,
        yBlock: p.yBlock - minY + offsetY,
      });
      newElements.push({ type: 'dustPile', uid: newUid });
    }
    s.selectedElements = newElements;
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

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Deep-clones an EditorRoomData object using structuredClone.
 * Safe because EditorRoomData contains only plain, structured-cloneable values.
 */
function deepCloneRoomData(data: EditorRoomData): EditorRoomData {
  return structuredClone(data) as EditorRoomData;
}

/**
 * Shows a modal "Save Changes?" dialog with a green YES and a red NO button.
 * The dialog is appended to `root` and removed when the user picks an option.
 *
 * @param root    DOM element to append the dialog to (should be the UI overlay root).
 * @param onYes   Called when the user clicks YES.
 * @param onNo    Called when the user clicks NO.
 */
function showSaveChangesDialog(root: HTMLElement, onYes: () => void, onNo: () => void): void {
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: rgba(10,12,20,0.97); border: 1px solid rgba(0,200,100,0.5);
    border-radius: 8px; padding: 24px 32px; display: flex; flex-direction: column;
    align-items: center; gap: 20px; font-family: 'Cinzel', monospace;
    min-width: 260px; box-shadow: 0 0 30px rgba(0,0,0,0.8);
  `;

  const question = document.createElement('div');
  question.textContent = 'Save Changes?';
  question.style.cssText = `
    font-size: 16px; font-weight: bold; color: #c0ffd0; letter-spacing: 0.05em;
  `;
  panel.appendChild(question);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 16px;';

  const yesBtn = document.createElement('button');
  yesBtn.textContent = 'YES';
  yesBtn.style.cssText = `
    min-width: 90px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(0,140,60,0.6); color: #44ff88;
    border: 2px solid #44ff88; transition: background 0.15s;
  `;
  yesBtn.addEventListener('mouseenter', () => { yesBtn.style.background = 'rgba(0,180,80,0.8)'; });
  yesBtn.addEventListener('mouseleave', () => { yesBtn.style.background = 'rgba(0,140,60,0.6)'; });
  yesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onYes();
  });

  const noBtn = document.createElement('button');
  noBtn.textContent = 'NO';
  noBtn.style.cssText = `
    min-width: 90px; padding: 10px 20px; font-size: 14px; font-weight: bold;
    font-family: 'Cinzel', monospace; cursor: pointer; border-radius: 4px;
    background: rgba(160,30,20,0.6); color: #ff6644;
    border: 2px solid #ff6644; transition: background 0.15s;
  `;
  noBtn.addEventListener('mouseenter', () => { noBtn.style.background = 'rgba(200,40,30,0.8)'; });
  noBtn.addEventListener('mouseleave', () => { noBtn.style.background = 'rgba(160,30,20,0.6)'; });
  noBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    onNo();
  });

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  panel.appendChild(btnRow);
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
}
