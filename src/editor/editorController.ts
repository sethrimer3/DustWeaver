/**
 * Editor controller — orchestrates editor lifecycle, input processing,
 * tool actions, camera updates, UI, world map, transition linking,
 * and room loading. This is the single integration point consumed by
 * gameScreen.ts.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RoomDef } from '../levels/roomDef';
import type { CameraState } from '../render/camera';
import { buildEdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';

import { EditorState, createEditorState, EditorTool,
  BackgroundId, LightingEffect, RoomSongId, AmbientLightDirection,
  BlockTheme,
  EditorTransition, EditorRoomData,
  selectBlockTheme,
} from './editorState';
import { roomDefToEditorRoomData, editorRoomDataToRoomDef } from './editorRoomBuilder';
import { updateEditorCamera, EditorCameraInput } from './editorCamera';
import {
  createEditorInputState,
  attachEditorInputListeners, clearEditorOneShots,
} from './editorInput';
import { selectAtCursor, deleteAtCursor, rotateSelectedElement, flipSelectedTransition, getAllElementsInRect } from './editorTools';
import { placeAtCursor } from './editorPlaceTool';
import { createEditorUI, EditorUI } from './editorUI';
import type { RoomEdge } from './editorUI';
import { renderEditorOverlays, renderEditorIndicator } from './editorRenderer';
import { showEditorWorldMap } from './editorWorldMap';
import { showVisualWorldMap } from './editorVisualMap';
import { beginTransitionLink, completeTransitionLink, cancelTransitionLink } from './transitionLinker';
import { transitionLinkWarningMessage } from './transitionValidation';
import { exportRoomAsJson, exportAllChanges, exportCampaignJson, exportMainCampaignJson } from './editorExport';
import { ROOM_REGISTRY, initRoomRegistry, registerRoom } from '../levels/rooms';
import { createEditorHistory, pushSnapshot, undo, redo, clearHistory } from './editorHistory';
import type { EditorHistory } from './editorHistory';
import {
  storeDragStartPositions, moveSelectedElements,
  serializeSelectedElements, pasteFromClipboard,
} from './editorDragCopyPaste';
import { deepCloneRoomData, showSaveChangesDialog } from './editorSaveChangesDialog';
import { applyRoomDimensionChange, applyEdgeResize } from './editorRoomResize';
import { handlePropertyChange } from './editorPropertyChange';
import type { EditableCampaignSession } from './editableCampaignSession';
import {
  isTransitionAtRoomEdge,
  showTransitionConnectPopup,
  showConnectedRoomCreationDialog,
} from './editorTransitionConnectPopup';

import { invalidateRoomContour } from '../ui/mapSketchRenderer';

const BS = BLOCK_SIZE_MEDIUM;

/** Width of the editor UI panel in CSS pixels. */
const EDITOR_PANEL_WIDTH_CSS_PX = 260;

export interface EditorController {
  state: EditorState;
  /** Toggle editor on/off. */
  toggle: (currentRoom: RoomDef) => void;
  /** Opens the visual world map overlay (editor must be active). */
  openVisualMap: () => void;
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
 * Shows a temporary warning toast message in the editor UI root.
 * Auto-dismisses after 3 seconds.
 */
function showEditorToast(root: HTMLElement, message: string): void {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:absolute', 'left:50%', 'top:32px',
    'transform:translateX(-50%)',
    'background:rgba(180,60,0,0.92)',
    'color:#fff',
    'font:bold 13px monospace',
    'padding:8px 18px',
    'border-radius:6px',
    'border:1.5px solid #ff9933',
    'z-index:10000',
    'pointer-events:none',
    'white-space:pre',
    'text-align:center',
  ].join(';');
  root.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3000);
}

export function createEditorController(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  onLoadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number, preserveCamera?: boolean) => void,
  onEditorClose?: () => void,
  campaignSession?: EditableCampaignSession | null,
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
  const dragOriginalPositions: Map<number, { xBlock: number; yBlock: number }> = new Map();

  // ── Pending-edits persistence for multi-room editing ────────────────────
  // Stores EditorRoomData snapshots saved by the user as they navigate rooms.
  const pendingRoomEdits = new Map<string, EditorRoomData>();
  // Room IDs that existed when the editor session started (identifies new rooms).
  let initialRoomIds = new Set<string>();
  // True if any world-map metadata (names, positions, world assignments) changed.
  let isWorldMapDirty = false;
  // True if the current room has unsaved edits since it was last loaded.
  let isCurrentRoomDirty = false;

  // Edge extension cache rebuilt whenever a new room is loaded into the editor.
  // Passed to renderEditorOverlays so extension tiles are visible as blue ghost
  // tiles (30 % opacity) outside the room boundary.
  let editorEdgeExtensionCache: EdgeExtensionCache | null = null;

  // Cleanup function for any currently-visible "Create connected room?" popup.
  let dismissConnectPopup: (() => void) | null = null;

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

      const campaignTitle = campaignSession ? campaignSession.campaign.campaign.title : null;
      ui = createEditorUI(uiRoot, campaignTitle);
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
          if (prop.startsWith('campaignSpawn.')) {
            // Campaign spawn properties are not stored in room data — update state + session directly.
            if (state.campaignSpawnBlock !== null && campaignSession?.campaign?.campaign != null) {
              const numVal = typeof value === 'number' ? value : parseInt(String(value));
              if (!isNaN(numVal)) {
                if (prop === 'campaignSpawn.xBlock') {
                  state.campaignSpawnBlock = [numVal, state.campaignSpawnBlock[1]];
                  if (campaignSession.campaign.campaign.campaignSpawn) {
                    campaignSession.campaign.campaign.campaignSpawn.xBlock = numVal;
                  }
                } else if (prop === 'campaignSpawn.yBlock') {
                  state.campaignSpawnBlock = [state.campaignSpawnBlock[0], numVal];
                  if (campaignSession.campaign.campaign.campaignSpawn) {
                    campaignSession.campaign.campaign.campaignSpawn.yBlock = numVal;
                  }
                }
              }
            }
            return; // No applyEdits needed — campaign spawn is not in room data
          }
          if (state.roomData) handlePropertyChange(state.roomData, state.selectedElements, history, prop, value);
          applyEdits();
        },
        onRoomDimensionsChange: (dimProp: 'widthBlocks' | 'heightBlocks', value: number) => {
          if (state.roomData) applyRoomDimensionChange(state.roomData, dimProp, value);
          applyEdits();
        },
        onEdgeResize: (edge: RoomEdge, delta: 1 | -1) => {
          if (state.roomData) applyEdgeResize(state.roomData, history, edge, delta);
          applyEdits();
        },
        onBlockThemeChange: (theme: BlockTheme) => {
          selectBlockTheme(state, theme);
        },
        onLightingEffectChange: (lightingEffect: LightingEffect) => {
          if (state.roomData) state.roomData.lightingEffect = lightingEffect;
          applyEdits();
        },
        onAmbientLightDirectionChange: (direction: AmbientLightDirection | undefined) => {
          if (state.roomData) state.roomData.ambientLightDirection = direction;
          applyEdits();
        },
        onBackgroundChange: (bgId: BackgroundId) => {
          if (state.roomData) state.roomData.backgroundId = bgId;
          applyEdits();
        },
        onRoomSongChange: (songId: RoomSongId) => {
          if (state.roomData) state.roomData.songId = songId;
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
          const exportedFileCount = exportAllChanges(pendingRoomEdits, initialRoomIds, isWorldMapDirty);
          if (exportedFileCount === 0) {
            window.alert('No changed rooms or world-map edits to export yet.');
          }
        },
        onExportCampaignJson: () => {
          // Auto-save current room to pending before exporting so it's included.
          if (state.roomData) {
            pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
            isCurrentRoomDirty = false;
          }
          if (campaignSession) {
            exportCampaignJson(campaignSession, pendingRoomEdits);
          } else {
            exportMainCampaignJson(pendingRoomEdits);
          }
        },
        onOpenVisualMap: () => openVisualMap(),
        onSkillTombWeaveChange: (weaveId: string) => {
          state.pendingSkillTombWeaveId = weaveId;
        },
        onCrumbleVariantChange: (variant) => {
          state.pendingCrumbleVariant = variant;
        },
        onDustBoostJarKindChange: (dustKind: string) => {
          state.pendingDustBoostJarKind = dustKind;
        },
        onDustBoostJarCountChange: (dustCount: number) => {
          state.pendingDustBoostJarCount = dustCount;
        },
        onBrushModeChange: (mode) => {
          state.brushMode = mode;
          if (mode !== 'rect') {
            state.brushRectStartBlockX = null;
            state.brushRectStartBlockY = null;
          }
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
    if (dismissConnectPopup) { dismissConnectPopup(); dismissConnectPopup = null; }
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
    // Apply the current editor changes: register the updated RoomDef so the
    // rest of the game (ROOM_REGISTRY, visual map) sees the new geometry/transitions.
    // Then save to pending edits so the changes are preserved across editor sessions.
    //
    // Crucially, this does NOT call onLoadRoom — Confirm must NOT start gameplay,
    // respawn the player, or close the editor unexpectedly.  Use a dedicated
    // Play/Test action to enter gameplay.
    if (state.roomData) {
      const newRoomDef = editorRoomDataToRoomDef(state.roomData);
      registerRoom(newRoomDef); // update ROOM_REGISTRY so visual map sees new transitions
      pendingRoomEdits.set(state.roomData.id, deepCloneRoomData(state.roomData));
      isCurrentRoomDirty = false;
      // Invalidate the world-map sketch contour cache for this room so the
      // updated wall geometry is reflected the next time the map is opened.
      invalidateRoomContour(newRoomDef.id);
    }
    // Stay in the editor — just close any transient UI that was open.
    if (dismissConnectPopup) { dismissConnectPopup(); dismissConnectPopup = null; }
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
    registerRoom(roomDef); // keep ROOM_REGISTRY in sync while editing
    const sx = state.roomData.playerSpawnBlock[0];
    const sy = state.roomData.playerSpawnBlock[1];
    onLoadRoom(roomDef, sx, sy, true); // preserve camera while in editor
  }

  /**
   * Reads campaign.campaignSpawn from the session and sets state.campaignSpawnBlock
   * if the current room is the campaign spawn room, otherwise null.
   */
  function syncCampaignSpawnBlockFromSession(): void {
    const spawn = campaignSession?.campaign.campaign.campaignSpawn ?? null;
    if (spawn !== null && state.roomData !== null && spawn.roomId === state.roomData.id) {
      state.campaignSpawnBlock = [spawn.xBlock, spawn.yBlock];
    } else {
      state.campaignSpawnBlock = null;
    }
  }

  /**
   * After a delete action, syncs state.campaignSpawnBlock = null back to the
   * campaign session (clears campaignSpawn if it was in the current room).
   * Note: `campaign.initialRoomId` is intentionally NOT reset on deletion —
   * it serves as a fallback room when no campaignSpawn is present, so it should
   * continue pointing at the last known spawn room for backward-compat exports.
   */
  function syncCampaignSpawnToSessionAfterDelete(): void {
    if (!campaignSession || !state.roomData) return;
    const spawn = campaignSession.campaign.campaign.campaignSpawn;
    if (spawn && spawn.roomId === state.roomData?.id && state.campaignSpawnBlock === null) {
      delete campaignSession.campaign.campaign.campaignSpawn;
    }
  }

  /**
   * Shows the "This will remove the current campaign spawn, proceed?" confirmation
   * modal and then places the new campaign spawn when the user clicks Yes.
   */
  function showCampaignSpawnReplaceModal(newXBlock: number, newYBlock: number): void {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'background:rgba(0,0,0,0.75)', 'z-index:2000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'pointer-events:auto',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:rgba(10,12,20,0.97)',
      'border:1px solid rgba(255,200,30,0.6)',
      'border-radius:8px', 'padding:24px 32px',
      'display:flex', 'flex-direction:column', 'align-items:center', 'gap:20px',
      "font-family:'Cinzel',monospace",
      'min-width:300px', 'box-shadow:0 0 30px rgba(0,0,0,0.8)',
    ].join(';');

    const msg = document.createElement('div');
    msg.textContent = 'This will remove the current campaign spawn, proceed?';
    msg.style.cssText = [
      'font-size:15px', 'font-weight:bold', 'color:#ffe060',
      'letter-spacing:0.04em', 'text-align:center', 'max-width:280px',
    ].join(';');
    panel.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:16px;';

    function makeBtn(label: string, bg: string, color: string, border: string): HTMLButtonElement {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = [
        'min-width:90px', 'padding:10px 20px', 'font-size:14px', 'font-weight:bold',
        "font-family:'Cinzel',monospace", 'cursor:pointer', 'border-radius:4px',
        `background:${bg}`, `color:${color}`, `border:2px solid ${border}`,
      ].join(';');
      return b;
    }

    const yesBtn = makeBtn('Yes', 'rgba(180,100,0,0.6)', '#ffe060', '#ffe060');
    const noBtn  = makeBtn('No',  'rgba(40,40,60,0.6)',  '#c0d0e0', '#4a5a6a');

    function dismiss(): void { backdrop.remove(); }

    yesBtn.addEventListener('click', () => {
      dismiss();
      placeCampaignSpawn(newXBlock, newYBlock);
    });
    noBtn.addEventListener('click', () => { dismiss(); });

    btnRow.appendChild(yesBtn);
    btnRow.appendChild(noBtn);
    panel.appendChild(btnRow);
    backdrop.appendChild(panel);
    uiRoot.appendChild(backdrop);
  }

  /**
   * Places the campaign spawn at (newXBlock, newYBlock) in the current room,
   * clearing any old campaign spawn from other rooms, and updates the session.
   * Does NOT push a history snapshot (the caller's Place tool branch does that).
   */
  function placeCampaignSpawn(newXBlock: number, newYBlock: number): void {
    if (!state.roomData || !campaignSession) return;
    const roomId = state.roomData.id;
    state.campaignSpawnBlock = [newXBlock, newYBlock];
    campaignSession.campaign.campaign.campaignSpawn = { roomId, xBlock: newXBlock, yBlock: newYBlock };
    // Keep initialRoomId in sync with the campaign spawn room.
    campaignSession.campaign.campaign.initialRoomId = roomId;
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
      for (const s of state.roomData.saveTombs)      maxUid = Math.max(maxUid, s.uid + 1);
      for (const s of state.roomData.skillTombs)     maxUid = Math.max(maxUid, s.uid + 1);
      for (const p of state.roomData.dustPiles)      maxUid = Math.max(maxUid, p.uid + 1);
      for (const d of (state.roomData.decorations ?? [])) maxUid = Math.max(maxUid, d.uid + 1);
      // Ensure nextUid never regresses below its current value (other rooms may
      // already have used higher UIDs during this session).
      state.nextUid = Math.max(state.nextUid, maxUid);
    } else {
      const result = roomDefToEditorRoomData(room, state.nextUid);
      state.roomData = result.data;
      state.nextUid = result.nextUid;
    }
    state.selectedElements = [];
    // Set the active theme to match the room's default without affecting the
    // recent-theme list — recent themes reflect only explicit user selections.
    state.selectedBlockTheme = state.roomData?.blockTheme ?? 'blackRock';
    isCurrentRoomDirty = false;
    // Sync campaign spawn block for this room from the campaign session.
    syncCampaignSpawnBlockFromSession();
    // Rebuild edge extension cache for the newly loaded room so the editor
    // can show extension tiles as non-editable ghost overlays.
    editorEdgeExtensionCache = buildEdgeExtensionCache(room);
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
          // Build a temporary EditorTransition for completeTransitionLink.
          // Prefer xBlock/yBlock from the RoomTransitionDef; fall back to positionBlock migration.
          const isHoriz = targetTrans.direction === 'left' || targetTrans.direction === 'right';
          const gw = targetTrans.gradientWidthBlocks ?? 3;
          const xB = targetTrans.xBlock !== undefined
            ? targetTrans.xBlock
            : (isHoriz ? (targetTrans.depthBlock ?? 0) : targetTrans.positionBlock);
          const yB = targetTrans.yBlock !== undefined
            ? targetTrans.yBlock
            : (isHoriz ? targetTrans.positionBlock : (targetTrans.depthBlock ?? 0));
          const editorTargetTrans: EditorTransition = {
            uid: -1,
            direction: targetTrans.direction,
            xBlock: xB,
            yBlock: yB,
            openingSizeBlocks: targetTrans.openingSizeBlocks,
            targetRoomId: '',
            targetSpawnBlock: [targetTrans.targetSpawnBlock[0], targetTrans.targetSpawnBlock[1]],
            positionBlock: targetTrans.positionBlock,
            gradientWidthBlocks: gw,
          };
          const result = completeTransitionLink(
            state,
            linkSourceRoomData.transitions,
            room.id,
            editorTargetTrans,
            room.widthBlocks,
            room.heightBlocks,
          );
          if (!result.ok) {
            showEditorToast(uiRoot, transitionLinkWarningMessage(result));
          } else {
            linkSourceRoomData = null;
            linkTargetRoomId = '';
            // Rebuild the current room to reflect the change
            applyEdits();
          }
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

  async function openVisualMap(): Promise<void> {
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }

    // Failsafe: if the room registry is empty (e.g. startup load race or
    // campaign file fetch hiccup), reload it before opening the visual map.
    if (ROOM_REGISTRY.size === 0) {
      try {
        await initRoomRegistry();
      } catch (err) {
        console.error('[editor] Failed to reload room registry before opening visual map:', err);
      }
    }

    // Refresh the currently edited room before the visual map snapshots
    // ROOM_REGISTRY. Door moves can otherwise render from a stale RoomDef.
    if (state.roomData) {
      registerRoom(editorRoomDataToRoomDef(state.roomData));
    }

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
    // Q/E in Select mode → rotate the selected transition
    if (state.activeTool === EditorTool.Select && state.selectedElements.length > 0 && state.roomData) {
      const selType = state.selectedElements[0]?.type;
      if (selType === 'transition') {
        if (inputState.isRotateRightPressed || inputState.isRotateLeftPressed) {
          pushSnapshot(history, state.roomData);
          rotateSelectedElement(state);
          applyEdits();
        }
      }
    }

    // F key → flip placement horizontally (Place mode) or flip selected transition (Select mode)
    if (inputState.isFlipPressed) {
      if (state.activeTool === EditorTool.Place) {
        state.placementFlipH = !state.placementFlipH;
      } else if (state.activeTool === EditorTool.Select && state.roomData &&
                 state.selectedElements.length > 0 && state.selectedElements[0]?.type === 'transition') {
        pushSnapshot(history, state.roomData);
        flipSelectedTransition(state);
        applyEdits();
      }
    }

    // N key → world map list
    if (inputState.isMapToggled) {
      openWorldMap();
    }

    // M key → visual world map editor
    if (inputState.isVisualMapToggled) {
      openVisualMap();
    }

    // ESC → cancel linking or deselect
    if (inputState.isEscapePressed) {
      if (state.isLinkingTransition) {
        cancelTransitionLink(state);
      } else {
        state.selectedElements = [];
        state.brushRectStartBlockX = null;
        state.brushRectStartBlockY = null;
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
              const result = completeTransitionLink(
                state,
                linkSourceRoomData.transitions,
                linkTargetRoomId || state.roomData.id,
                targetTrans,
                state.roomData.widthBlocks,
                state.roomData.heightBlocks,
              );
              if (!result.ok) {
                showEditorToast(uiRoot, transitionLinkWarningMessage(result));
              } else {
                linkSourceRoomData = null;
                linkTargetRoomId = '';
              }
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
              // Normal click: if the element is already in the selection keep
              // everything selected (so the whole group can be dragged).
              // Only replace the selection if clicking a new, unselected element.
              const isAlreadySelected = state.selectedElements.some(
                e => e.type === clicked.type && e.uid === clicked.uid,
              );
              if (!isAlreadySelected) {
                state.selectedElements = [clicked];
              }
            }
          } else if (!inputState.isShiftHeld) {
            // Click on empty space without shift: begin selection box
            state.selectedElements = [];
            state.isSelectionBoxActive = true;
            state.selectionBoxStartBlockX = state.cursorBlockX;
            state.selectionBoxStartBlockY = state.cursorBlockY;
          }
        } else if (state.activeTool === EditorTool.Place) {
          if (state.brushMode === 'rect' && state.brushRectStartBlockX === null) {
            // Rect brush: first click sets the drag start — don't place yet.
            state.brushRectStartBlockX = state.cursorBlockX;
            state.brushRectStartBlockY = state.cursorBlockY;
          } else if (state.selectedPaletteItem?.id === 'campaign_spawn') {
            // Campaign spawn: singleton logic — only one allowed in the entire campaign.
            const bx = state.cursorBlockX;
            const by = state.cursorBlockY;
            if (!campaignSession) {
              showEditorToast(uiRoot, 'Campaign Spawn requires an open campaign session.');
            } else {
              const existingSpawn = campaignSession.campaign.campaign.campaignSpawn;
              const isInCurrentRoom = existingSpawn !== undefined &&
                existingSpawn.roomId === state.roomData?.id;
              if (existingSpawn !== undefined && !isInCurrentRoom) {
                // Spawn exists in a different room — ask before replacing.
                showCampaignSpawnReplaceModal(bx, by);
              } else {
                // Either no spawn yet, or spawn is already in this room — update silently.
                placeCampaignSpawn(bx, by);
              }
            }
          } else {
            pushSnapshot(history, state.roomData);
            const transCountBefore = state.roomData.transitions.length;
            placeAtCursor(state);
            // Rect brush: clear drag start after placement.
            if (state.brushMode === 'rect') {
              state.brushRectStartBlockX = null;
              state.brushRectStartBlockY = null;
            }
            applyEdits();
            lastDragBlockX = state.cursorBlockX;
            lastDragBlockY = state.cursorBlockY;

            // Show "Create connected room?" popup if a new unlinked transition
            // was just placed on a room edge.
            const newTrans = state.roomData.transitions.length > transCountBefore
              ? state.roomData.transitions[state.roomData.transitions.length - 1]
              : null;
            if (newTrans && !newTrans.targetRoomId && isTransitionAtRoomEdge(newTrans, state.roomData)) {
              if (dismissConnectPopup) { dismissConnectPopup(); dismissConnectPopup = null; }
              const capturedTrans = newTrans;
              const capturedRoom = state.roomData;
              dismissConnectPopup = showTransitionConnectPopup(uiRoot, capturedTrans, () => {
                dismissConnectPopup = null;
                if (!capturedRoom || !capturedTrans) return;
                showConnectedRoomCreationDialog(uiRoot, capturedTrans, capturedRoom, {
                  onRoomCreated: (newRoomDef) => {
                    // Save new room to pendingRoomEdits so it can be exported later.
                    const { data: newRoomData, nextUid: newNextUid } = roomDefToEditorRoomData(newRoomDef, state.nextUid);
                    state.nextUid = newNextUid;
                    pendingRoomEdits.set(newRoomDef.id, newRoomData);
                    isWorldMapDirty = true;
                    isCurrentRoomDirty = true;
                    // Rebuild the current room to reflect the updated source transition.
                    applyEdits();
                    showEditorToast(uiRoot, `Room "${newRoomDef.id}" created and linked.`);
                  },
                  onWorldMapDataChanged: () => { isWorldMapDirty = true; },
                });
              });
            }
          }
        } else if (state.activeTool === EditorTool.Delete) {
          pushSnapshot(history, state.roomData);
          deleteAtCursor(state);
          syncCampaignSpawnToSessionAfterDelete();
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
        syncCampaignSpawnToSessionAfterDelete();
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
      state.brushMode !== 'rect' &&
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

    // Compute hover element for tooltip (Select tool only, outside the editor panel)
    if (
      state.activeTool === EditorTool.Select &&
      inputState.mouseScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX
    ) {
      state.hoverElement = selectAtCursor(state);
    } else {
      state.hoverElement = null;
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
    renderEditorOverlays(ctx, state, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight, editorEdgeExtensionCache);
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

  return {
    state,
    toggle,
    openVisualMap,
    update,
    render,
    loadRoomForEditing,
    getRoomDef,
    destroy,
  };
}
