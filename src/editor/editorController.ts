/**
 * Editor controller — orchestrates editor lifecycle, input processing,
 * tool actions, camera updates, UI, world map, transition linking,
 * and room loading. This is the single integration point consumed by
 * gameScreen.ts.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { RoomDef } from '../levels/roomDef';
import { parseCustomBlockSource, serializeCustomBlock, toNamespacedId, makeUniqueId, countCustomBlockUsage } from '../levels/customBlocks';
import { registerCustomBlockSprite, invalidateCustomBlockSprite, updateCustomBlockProperties, clearCustomBlockSpriteCache } from '../render/customBlockSpriteCache';
import { openCustomBlockDialog } from './editorCustomBlockDialog';
import {
  loadEditorWorkspacePreferences, createDebouncedWorkspacePreferencesSaver,
  applyWorkspacePreferencesToLayers, extractWorkspaceLayerPrefs,
  applyLayerPreset, resetWorkspaceLayers, defaultEditorWorkspacePreferences,
  type EditorWorkspacePreferences,
} from './editorWorkspacePreferences';
import type { CameraState } from '../render/camera';
import { CAMERA_DEFAULT_ZOOM, getCameraOffset } from '../render/camera';
import { buildEdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';

import { EditorState, createEditorState, EditorTool,
  BackgroundId, LightingEffect, RoomSongId, AmbientLightDirection,
  BlockTheme,
  EditorTransition, EditorRoomData,
  selectBlockTheme,
  activateBlockThemeSlot,
  assignBlockThemeSlot,
} from './editorState';
import { roomDefToEditorRoomData, editorRoomDataToRoomDef } from './editorRoomBuilder';
import { editorPerfCounters } from './editorPerfCounters';
import { bumpSelectionRevision } from './editorSelectionCache';
import {
  isPointerOwnedByGesture, shouldScanHover,
  type PointerOwnershipInput,
} from './editorPointerOwnership';
import {
  createStrokeRevisionState, noteContentMutation, flushStrokeRevision,
  discardPendingStrokeRevision,
} from './editorContentRevision';
import { saveBlockThemeSlots } from './editorThemeSlotPreferences';
import { updateEditorCamera, EditorCameraInput, applyEditorZoomInput, panEditorCameraByScreenDelta } from './editorCamera';
import {
  createEditorInputState,
  attachEditorInputListeners, clearEditorOneShots,
} from './editorInput';
import { selectAtCursor, deleteAtCursorBrushed, getAllElementsInRect } from './editorTools';
import { hitTestTransitionResizeEdge } from './editorHitTest';
import { hitTestRectResizeEdge, resizeBlockRect, type RectResizeEdge } from './editorRectResize';
import { placeAtCursor, evaluateBrushOperation } from './editorPlaceTool';
import { pixelFromCursor, placePixelMaterialAt, erasePixelMaterialAt, paintPixelMaterialLine } from './editorPixelMaterialTool';
import { getPlacementStatus, describePlacementBlockReason, canMutateElement, canMutateSelection } from './editorLayers';
import { createEditorUI, EditorUI } from './editorUI';
import type { RoomEdge } from './editorUI';
import { renderEditorOverlays, renderEditorIndicator } from './editorRenderer';
import { showEditorWorldMap } from './editorWorldMap';
import { showVisualWorldMap } from './editorVisualMap';
import { beginTransitionLink, completeTransitionLink, cancelTransitionLink } from './transitionLinker';
import { transitionLinkWarningMessage } from './transitionValidation';
import { exportRoomAsJson, exportAllChanges, exportCampaignJson, exportMainCampaignJson } from './editorExport';
import { ROOM_REGISTRY, registerRoom, getLoadedOfficialCampaignSpawn, WORLD_NAMES, WORLD_ORDER, WORLD_MAP_POSITIONS } from '../levels/rooms';
import { loadRoomForGameplayAsync } from '../levels/roomFileLoader';
import {
  createEditorHistory, clearHistory, capturePendingSnapshot, commitPendingSnapshot,
  markHistorySaved, isHistoryDirty, getHistoryDiagnostics,
} from './editorHistory';
import type { EditorHistory } from './editorHistory';
import { runRoomFieldMutation as transactRoomFieldMutation } from './editorRoomMutation';
import { beginPaintTransaction } from './editorPaintHistoryCoordinator';
import { beginGesture, finishGesture, rollbackGesture, type EditorGestureTransaction } from './editorGesture';
import {
  storeDragStartPositions, moveSelectedElements,
} from './editorDragCopyPaste';
/** Snapshots the CURRENT block positions of the selected elements (reusing
 *  `storeDragStartPositions`'s live-lookup logic) so an in-progress drag's
 *  `hasChanged` check can compare "now" against the captured pre-drag
 *  originals without duplicating the per-type lookup switch. */
function currentSelectedElementPositions(
  s: EditorState,
): Map<number | string, { xBlock: number; yBlock: number }> {
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(s, positions);
  return positions;
}

/** Compares two drag-position maps for exact equality (same keys, same
 *  xBlock/yBlock values) — used to detect a zero-delta drag (including one
 *  that moved away and returned to its origin) so it can be discarded
 *  without committing a no-op undo entry. */
function arePositionMapsEqual(
  a: Map<number | string, { xBlock: number; yBlock: number }>,
  b: Map<number | string, { xBlock: number; yBlock: number }>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [key, val] of a) {
    const other = b.get(key);
    if (other === undefined || other.xBlock !== val.xBlock || other.yBlock !== val.yBlock) return false;
  }
  return true;
}
import { deepCloneRoomData, showSaveChangesDialog } from './editorSaveChangesDialog';
import { applyRoomDimensionChange, applyEdgeResize } from './editorRoomResize';
import { handlePropertyChange } from './editorPropertyChange';
import type { EditableCampaignSession } from './editableCampaignSession';
import {
  isTransitionAtRoomEdge,
  showTransitionConnectPopup,
  showConnectedRoomCreationDialog,
} from './editorTransitionConnectPopup';
import {
  CampaignSpawnContext,
  syncCampaignSpawnBlockFromSession,
  syncCampaignSpawnToSessionAfterDelete,
  placeCampaignSpawn,
  showCampaignSpawnReplaceModal,
  captureCampaignSpawnSnapshot,
  commitCampaignSpawnSnapshot,
} from './editorCampaignSpawn';
import type { PendingSnapshot } from './editorHistory';

import { handleEditorKeyboardShortcuts } from './editorKeyboardShortcuts';
import { analyzeEditorRoomComplexity } from './editorRoomComplexity';
import { formatRoomComplexityWarningMessage, isRoomComplexitySeverityAtLeast } from '../levels/roomComplexity';
import { invalidateRoomContour } from '../ui/mapSketchRenderer';
import { setActiveSeamBlending } from '../render/walls/blockSpriteRenderer';
import { editorRoomDataToJson } from './roomJson';
import type { RoomJsonDef } from './roomJson';
import { buildWorldMapFromRegistry } from './editableCampaignSession';
import { dehydrateRoom, hydrateV2Room } from '../levels/roomSchemaV2';
import type { SavedRoomV2 } from '../levels/roomSchemaV2';
import { auditRoomJson, printRoomAuditTable } from '../levels/roomFileAudit';
import { printRoundTripReport, validateRoundTrip } from '../levels/roomRoundTripValidator';

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
  let activePaintPending: PendingSnapshot | null = null;
  let activePaintTracksCampaignSpawn = false;
  if (import.meta.env.DEV) {
    (window as unknown as { __dwEditorHistory?: () => ReturnType<typeof getHistoryDiagnostics> }).__dwEditorHistory =
      () => getHistoryDiagnostics(history);
  }
  let inputCleanup: (() => void) | null = null;
  let ui: EditorUI | null = null;
  let worldMapCleanup: (() => void) | null = null;
  let visualMapCleanup: (() => void) | null = null;
  // Reference to the shared gameplay CameraState most recently passed to
  // update(), kept so closeEditor() can reset zoom back to default and
  // avoid leaking editor zoom into gameplay rendering.
  let activeCameraRef: CameraState | null = null;

  // Drag-paint tracking: last block position where Place/Delete acted during a drag
  // Initialized to out-of-range sentinels so the first drag always triggers.
  const INVALID_DRAG_BLOCK = -0x7fff;
  let lastDragBlockX = INVALID_DRAG_BLOCK;
  let lastDragBlockY = INVALID_DRAG_BLOCK;

  // Drag-paint tracking for the pixel-material tool, at native-pixel granularity.
  let lastDragPixelX = INVALID_DRAG_BLOCK;
  let lastDragPixelY = INVALID_DRAG_BLOCK;
  // Throttles the blocked-placement toast so a held/repeated click on the
  // same blocked target doesn't spam a toast every attempt — a genuinely
  // different reason (or target) shows immediately.
  let lastBlockedPlacementSig = '';
  let lastBlockedPlacementToastAt = 0;
  const BLOCKED_PLACEMENT_TOAST_THROTTLE_MS = 1500;

  // Saved source room data for transition linking across rooms
  let linkSourceRoomData: typeof state.roomData = null;
  let linkTargetRoomId = '';

  // Original room snapshot for cancel/revert
  let originalRoomDef: RoomDef | null = null;

  // Drag-to-move: original positions of selected elements at drag start
  const dragOriginalPositions: Map<number | string, { xBlock: number; yBlock: number }> = new Map();

  // Edge-resize: original zone geometry of the transition being resized, captured at drag start.
  let resizeOriginalGeometry: { xBlock: number; yBlock: number; gradientWidthBlocks: number; openingSizeBlocks: number; positionBlock: number } | null = null;
  let challengeResize: { type: 'challengeField' | 'challengeGate' | 'gate' | 'zipMoveBlock'; uid: number; edge: RectResizeEdge; original: { xBlock: number; yBlock: number; wBlock: number; hBlock: number } } | null = null;

  // ── Gesture transaction (drag-move / rect-resize / transition-resize) ───
  //
  // At most one of these three continuous gestures can be active at a time
  // (mutual exclusion is enforced at each gesture's start site below). This
  // single slot backs all three so cancellation/commit logic doesn't need to
  // be duplicated per gesture kind — see editorGesture.ts.
  let activeGesture: EditorGestureTransaction | null = null;

  /**
   * Last value written to `canvas.style.cursor`. Assigning the same string
   * every frame is a needless style write (and, in some browsers, a style
   * recalc), so we only touch it when the resolved cursor actually changes.
   * Reset on editor close so a re-open re-applies the cursor from scratch.
   */
  let lastAppliedCanvasCursor = '';

  /**
   * Deferral slot for a continuous drag-paint/erase stroke's single
   * `roomContentRevision` bump — see editorContentRevision.ts.
   */
  const strokeRevision = createStrokeRevisionState();

  /**
   * Cancels whatever continuous gesture (drag / rect-resize / transition-
   * resize) is currently active: restores the live room data it touched back
   * to its pre-gesture geometry, discards the pending snapshot, and clears
   * every piece of gesture-tracking state. Never touches history/dirty state
   * — the room is back to exactly what it was before the gesture began, so
   * there is nothing new to persist. Safe to call when no gesture is active
   * (no-op). Centralised here so every cancellation trigger (layer
   * hidden/locked/solo-excluded, tool/room change, editor close, Escape)
   * shares one rollback path instead of duplicating it.
   */
  function cancelActiveGesture(): void {
    if (activePaintPending) {
      state.roomData = structuredClone(activePaintPending.before) as EditorRoomData;
      if (activePaintTracksCampaignSpawn && activeCampaignSession?.campaign?.campaign) {
        const campaign = activeCampaignSession.campaign.campaign;
        const before = activePaintPending.campaignSpawnBefore;
        if (before?.campaignSpawn) campaign.campaignSpawn = structuredClone(before.campaignSpawn);
        else delete campaign.campaignSpawn;
        if (before?.initialRoomId !== undefined) campaign.initialRoomId = before.initialRoomId;
        syncCampaignSpawnBlockFromSession(campaignSpawnCtx);
      }
      activePaintPending = null;
      activePaintTracksCampaignSpawn = false;
      isCurrentRoomDirty = isHistoryDirty(history);
    }
    if (activeGesture) {
      rollbackGesture(activeGesture);
      activeGesture = null;
    }
    if (state.isDragging) {
      state.isDragging = false;
      dragOriginalPositions.clear();
    }
    if (challengeResize) {
      challengeResize = null;
    }
    if (state.isResizingTransition) {
      state.isResizingTransition = false;
      state.resizeTransitionUid = -1;
      state.resizeEdge = null;
      resizeOriginalGeometry = null;
    }
  }

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
  let liveEditorRoomDef: RoomDef | null = null;

  // Cleanup function for any currently-visible "Create connected room?" popup.
  let dismissConnectPopup: (() => void) | null = null;
  const loadedMainCampaignSpawn = getLoadedOfficialCampaignSpawn();
  const mainCampaignSession: EditableCampaignSession = {
    source: 'main',
    campaign: {
      v: 1,
      kind: 'DustWeaverCampaign',
      campaign: {
        id: 'DUSTWEAVER_CAMPAIGN',
        title: 'DustWeaver',
        creator: 'GravyThyme',
        description: '',
        initialRoomId: loadedMainCampaignSpawn?.roomId ?? 'lobby',
        initialRoomImagePath: null,
        ...(loadedMainCampaignSpawn !== null ? { campaignSpawn: { ...loadedMainCampaignSpawn } } : {}),
      },
      worldMap: { worlds: [], rooms: [] },
      rooms: [],
      editor: {
        createdWithBuild: '',
        lastEditedIso: '',
      },
    },
  };
  const activeCampaignSession = campaignSession ?? mainCampaignSession;
  // Shared context for campaign spawn helpers (avoids repeating state/session/uiRoot).
  const campaignSpawnCtx: CampaignSpawnContext = { state, campaignSession: activeCampaignSession, uiRoot };
  const usesCampaignStore = campaignSession?.campaignStore !== undefined;

  // ── Editor workspace preferences (Phase 6) ────────────────────────────────
  // Per-campaign, per-browser editor UI preferences (layer visibility/lock/
  // select-only, layer-panel collapse, active category, brush mode, sidebar
  // scroll) — never room/campaign data, never dirty/history, never exported.
  // activeCampaignSession.campaign.campaign.id is stable for the lifetime of
  // this controller (one controller per campaign-editing session), including
  // the built-in campaign (id 'DUSTWEAVER_CAMPAIGN').
  const workspaceCampaignKey = activeCampaignSession.campaign.campaign.id;
  const workspaceSaver = createDebouncedWorkspacePreferencesSaver(workspaceCampaignKey);

  /** Snapshots the live, persistable slice of workspace state and schedules a debounced write. */
  function scheduleWorkspaceSave(): void {
    const prefs: EditorWorkspacePreferences = {
      ...defaultEditorWorkspacePreferences(),
      layers: extractWorkspaceLayerPrefs(state.layers),
      activeCategory: state.activeCategory,
      brushMode: state.brushMode,
      layerPanelCollapsed: ui?.getWorkspaceUIPrefsSnapshot().layerPanelCollapsed ?? false,
      sidebarScrollTop: ui?.getWorkspaceUIPrefsSnapshot().sidebarScrollTop ?? 0,
    };
    workspaceSaver.schedule(prefs);
  }

  function logEditorPerf(label: string, startMs: number): void {
    if (!import.meta.env.DEV) return;
    console.log(`[campaignPerf] ${label}: ${(performance.now() - startMs).toFixed(2)}ms`);
  }

  /**
   * Dev-only: logs elapsed time for a placement-path operation with threshold warnings.
   * >16 ms → warn; >50 ms → error (blocking).
   */
  function logEditorPerfWarned(label: string, startMs: number, roomId?: string): void {
    if (!import.meta.env.DEV) return;
    const elapsedMs = performance.now() - startMs;
    const roomPart = roomId != null ? ` room=${roomId}` : '';
    if (elapsedMs > 50) {
      console.error(`[editor-perf] ⛔ ${label}: ${elapsedMs.toFixed(2)}ms (>50ms blocking!)${roomPart}`);
    } else if (elapsedMs > 16) {
      console.warn(`[editor-perf] ⚠️ ${label}: ${elapsedMs.toFixed(2)}ms (>16ms slow)${roomPart}`);
    } else {
      console.log(`[editor-perf] ${label}: ${elapsedMs.toFixed(2)}ms${roomPart}`);
    }
  }

  function commitActiveRoomToCampaign(
    reason: 'change-room' | 'playtest' | 'export' | 'manual-save',
  ): boolean {
    if (!state.roomData || !isCurrentRoomDirty) return false;
    const roomId = state.roomData.id;
    if (usesCampaignStore && campaignSession?.campaignStore !== undefined) {
      campaignSession.campaignStore.setActiveRoomId(roomId);
      campaignSession.campaignStore.commitRoom(roomId, state.roomData);
    } else {
      pendingRoomEdits.set(roomId, deepCloneRoomData(state.roomData));
    }
    isCurrentRoomDirty = false;
    markHistorySaved(history);
    if (import.meta.env.DEV) {
      console.log(`[editor-perf] commitActiveRoomToCampaign reason=${reason} room=${roomId}`);
    }
    return true;
  }

  function collectActiveSavedRoomsForDevChecks(): SavedRoomV2[] {
    const roomById = new Map<string, SavedRoomV2>();
    if (campaignSession?.campaignStore !== undefined) {
      for (const [id, rawRoom] of campaignSession.campaignStore.rawRoomsById) {
        roomById.set(id, rawRoom);
      }
    } else {
      for (const [id, roomDef] of ROOM_REGISTRY) {
        const { data } = roomDefToEditorRoomData(roomDef, 1);
        roomById.set(id, dehydrateRoom(editorRoomDataToJson(data)));
      }
    }
    for (const [id, data] of pendingRoomEdits) {
      roomById.set(id, dehydrateRoom(editorRoomDataToJson(data)));
    }
    if (state.roomData !== null) {
      roomById.set(state.roomData.id, dehydrateRoom(editorRoomDataToJson(state.roomData)));
    }

    const worldMap = buildWorldMapFromRegistry(WORLD_NAMES, ROOM_REGISTRY, WORLD_ORDER);
    const worldMapRoomById = new Map(worldMap.rooms.map(room => [room.id, room]));
    const rooms: SavedRoomV2[] = [];
    for (const [roomId, room] of roomById) {
      const mapRoom = worldMapRoomById.get(roomId);
      rooms.push(mapRoom === undefined ? room : {
        ...room,
        name: mapRoom.name,
        world: mapRoom.worldId,
        map: [mapRoom.mapX, mapRoom.mapY],
      });
    }
    return rooms;
  }

  function runDevRoomAudit(): void {
    if (!import.meta.env.DEV) return;
    const savedRooms = collectActiveSavedRoomsForDevChecks();
    if (savedRooms.length === 0) {
      console.warn('[RoomAudit] No active campaign rooms were available to audit.');
      return;
    }

    const rawRooms = savedRooms.map(room => ({
      id: room.id,
      rawJson: JSON.stringify(room, null, 2),
    }));
    printRoomAuditTable(rawRooms);

    let warningCount = 0;
    for (const room of rawRooms) {
      const entry = auditRoomJson(room.rawJson);
      if (entry === null) {
        warningCount++;
        console.warn(`[RoomAudit] Room "${room.id}" cannot be audited because raw JSON is unavailable or invalid.`);
        continue;
      }
      if (entry.version < 3) {
        warningCount++;
        console.warn(`[RoomAudit] Room "${entry.roomId}" is schema v${entry.version}; active optimized rooms should be v3.`);
      }
      if (entry.version === 3 && entry.exactWallCount > 0) {
        warningCount++;
        console.warn(`[RoomAudit] Room "${entry.roomId}" is v3 but still contains exactWalls=${entry.exactWallCount}.`);
      }
      const legacyCount = entry.waterZoneLegacy + entry.lavaZoneLegacy + entry.ambientBlockerLegacy + entry.bgBlockLegacy;
      if (entry.version === 3 && legacyCount > 0) {
        warningCount++;
        console.warn(
          `[RoomAudit] Room "${entry.roomId}" is v3 but still uses legacy fields: ` +
          `waterZones=${entry.waterZoneLegacy}, lavaZones=${entry.lavaZoneLegacy}, ` +
          `ambientBlockers=${entry.ambientBlockerLegacy}, bgBlocks=${entry.bgBlockLegacy}.`,
        );
      }
    }

    if (warningCount === 0) {
      console.log(`[RoomAudit] All ${rawRooms.length} active room(s) passed audit warnings.`);
    } else {
      console.warn(`[RoomAudit] Completed with ${warningCount} warning(s).`);
    }
  }

  function runDevRoomRoundTripValidation(): void {
    if (!import.meta.env.DEV) return;
    const rooms: RoomJsonDef[] = [];
    for (const savedRoom of collectActiveSavedRoomsForDevChecks()) {
      try {
        rooms.push(hydrateV2Room(savedRoom));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[RoundTrip] Room "${savedRoom.id}" could not be hydrated for validation: ${msg}`);
      }
    }
    if (rooms.length === 0) {
      console.warn('[RoundTrip] No active campaign rooms were available to validate.');
      return;
    }

    printRoundTripReport(rooms);
    const failedRooms = rooms
      .map(room => validateRoundTrip(room))
      .filter(result => !result.passed);
    if (failedRooms.length === 0) {
      console.log(`[RoundTrip] All ${rooms.length} active room(s) passed.`);
    } else {
      console.error(`[RoundTrip] ${failedRooms.length} active room(s) failed round-trip validation.`);
    }
  }

  function discardCurrentRoomSessionChanges(roomData: EditorRoomData | null): void {
    if (!usesCampaignStore || campaignSession?.campaignStore === undefined || roomData === null) return;
    campaignSession.campaignStore.discardRoomChanges(roomData.id);
  }

  function rebuildLiveEditorRoomDef(): RoomDef | null {
    if (state.roomData === null) {
      liveEditorRoomDef = null;
      return null;
    }
    liveEditorRoomDef = editorRoomDataToRoomDef(state.roomData);
    editorPerfCounters.roomDefConversions++;
    return liveEditorRoomDef;
  }

  /** Returns `def` with spriteRevision bumped past whatever this block id previously had. */
  function bumpSpriteRevision(def: import('../levels/customBlocks').CustomBlockDef): import('../levels/customBlocks').CustomBlockDef {
    const prevRevision = state.customBlockRegistry.get(def.id)?.spriteRevision ?? 0;
    return { ...def, spriteRevision: prevRevision + 1 };
  }

  function rebuildCustomBlockUsage(): void {
    state.customBlockUsage.clear();
    const allRooms = campaignSession?.campaignStore?.rawRoomsById;
    if (allRooms === undefined) return;
    for (const rawId of state.customBlockRegistry.keys()) {
      const { count } = countCustomBlockUsage(rawId, allRooms as ReadonlyMap<string, { customBlockPlacements?: ReadonlyArray<readonly [number, number, string]> }>);
      if (count > 0) state.customBlockUsage.set(rawId, count);
    }
  }

  function toggle(currentRoom: RoomDef): void {
    state.isActive = !state.isActive;

    if (state.isActive) {
      // Snapshot which rooms already exist so we can identify newly-added ones.
      initialRoomIds = new Set(ROOM_REGISTRY.keys());
      isWorldMapDirty = false;
      isCurrentRoomDirty = false;
      pendingRoomEdits.clear();

      // Load custom block definitions from the campaign into the registry.
      state.customBlockRegistry.clear();
      state.customBlockUsage.clear();
      clearCustomBlockSpriteCache();
      const incomingDefs = campaignSession?.campaign?.customBlockDefs ?? [];
      for (const src of incomingDefs) {
        const result = parseCustomBlockSource(src, { blockId: src.id });
        if (result.ok) {
          state.customBlockRegistry.set(result.def.id, result.def);
          registerCustomBlockSprite(result.def);
        } else {
          console.warn(`[editor] Skipping malformed custom block "${src.id}":`, result.errors);
        }
      }
      rebuildCustomBlockUsage();

      // Save original room for cancel/revert
      originalRoomDef = currentRoom;

      // Initialize editor
      loadRoomForEditing(currentRoom);

      inputCleanup = attachEditorInputListeners(canvas, inputState, state);

      // Load workspace preferences BEFORE createEditorUI() so the layers
      // panel and palette are built already reflecting the restored state
      // (preferences override defaults, never the other way around) —
      // createEditorState() above already set every layer to its default.
      const workspacePrefs = loadEditorWorkspacePreferences(workspaceCampaignKey);
      state.layers = applyWorkspacePreferencesToLayers(workspacePrefs);
      state.activeCategory = workspacePrefs.activeCategory;
      state.brushMode = workspacePrefs.brushMode;

      const campaignTitle = activeCampaignSession.campaign.campaign.title;
      ui = createEditorUI(uiRoot, campaignTitle);
      ui.applyWorkspaceUIPrefs({
        layerPanelCollapsed: workspacePrefs.layerPanelCollapsed,
        sidebarScrollTop: workspacePrefs.sidebarScrollTop,
      });
      ui.setCallbacks({
        onToolChange: (tool) => {
          cancelActiveGesture();
          state.activeTool = tool;
          state.selectedElements = [];
          bumpSelectionRevision(state);
        },
        onCategoryChange: (cat) => { state.activeCategory = cat; scheduleWorkspaceSave(); },
        onPaletteItemSelect: (item) => {
          cancelActiveGesture();
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
            if (state.campaignSpawnBlock !== null && activeCampaignSession.campaign?.campaign != null) {
              const pending = captureCampaignSpawnSnapshot(campaignSpawnCtx, `Property:${prop}`);
              const spawn = activeCampaignSession.campaign.campaign.campaignSpawn;
              const numVal = typeof value === 'number' ? value : parseInt(String(value));
              if (prop === 'campaignSpawn.xBlock' && !isNaN(numVal)) {
                state.campaignSpawnBlock = [numVal, state.campaignSpawnBlock[1]];
                if (spawn) spawn.xBlock = numVal;
              } else if (prop === 'campaignSpawn.yBlock' && !isNaN(numVal)) {
                state.campaignSpawnBlock = [state.campaignSpawnBlock[0], numVal];
                if (spawn) spawn.yBlock = numVal;
              } else if (prop === 'campaignSpawn.startingHealth' && spawn) {
                // "startingHealth" is the wire field name (kept for backward-compat
                // with existing saved campaigns) but represents starting dust motes,
                // which have no upper cap and may legitimately be zero.
                if (!isNaN(numVal) && numVal >= 0) {
                  spawn.startingHealth = numVal;
                } else {
                  delete spawn.startingHealth;
                }
                if (state.campaignSpawnStartingOptions) {
                  state.campaignSpawnStartingOptions.startingHealth = spawn.startingHealth;
                }
              } else if (prop === 'campaignSpawn.startingDustContainerCount' && spawn) {
                if (!isNaN(numVal) && numVal >= 0) {
                  spawn.startingDustContainerCount = numVal;
                } else {
                  delete spawn.startingDustContainerCount;
                }
                if (state.campaignSpawnStartingOptions) {
                  state.campaignSpawnStartingOptions.startingDustContainerCount = spawn.startingDustContainerCount;
                }
              } else if (prop === 'campaignSpawn.startingDustTypes' && spawn) {
                const strVal = String(value);
                try {
                  const parsed = JSON.parse(strVal);
                  spawn.startingDustTypes = Array.isArray(parsed) ? parsed : undefined;
                } catch {
                  spawn.startingDustTypes = undefined;
                }
                if (state.campaignSpawnStartingOptions) {
                  state.campaignSpawnStartingOptions.startingDustTypes = spawn.startingDustTypes;
                }
              } else if (prop === 'campaignSpawn.startingWeaves' && spawn) {
                const strVal = String(value);
                try {
                  const parsed = JSON.parse(strVal);
                  spawn.startingWeaves = Array.isArray(parsed) ? parsed : undefined;
                } catch {
                  spawn.startingWeaves = undefined;
                }
                if (state.campaignSpawnStartingOptions) {
                  state.campaignSpawnStartingOptions.startingWeaves = spawn.startingWeaves;
                }
              } else if (prop === 'campaignSpawn.startingPassives' && spawn) {
                const strVal = String(value);
                try {
                  const parsed = JSON.parse(strVal);
                  spawn.startingPassives = Array.isArray(parsed) ? parsed : undefined;
                } catch {
                  spawn.startingPassives = undefined;
                }
                if (state.campaignSpawnStartingOptions) {
                  state.campaignSpawnStartingOptions.startingPassives = spawn.startingPassives;
                }
              }
              const commitResult = commitCampaignSpawnSnapshot(campaignSpawnCtx, history, pending);
              if (commitResult !== 'noop') applyEdits('metadata');
            }
            return; // No applyEdits needed — campaign spawn is not in room data
          }
          const propertyChanged = state.roomData
            ? handlePropertyChange(state, history, prop, value, state.guideDustPathSelectedPointIndex)
            : false;
          if (propertyChanged) applyEdits('metadata');
        },
        onRoomDimensionsChange: (dimProp: 'widthBlocks' | 'heightBlocks', value: number) => {
          runRoomFieldMutation(dimProp, room => applyRoomDimensionChange(room, dimProp, value));
        },
        onEdgeResize: (edge: RoomEdge, delta: 1 | -1) => {
          if (state.roomData) applyEdgeResize(state.roomData, history, edge, delta);
          applyEdits('metadata');
        },
        onBlockThemeChange: (theme: BlockTheme) => {
          selectBlockTheme(state, theme);
        },
        onBlockThemeSlotActivate: (slotIndex: number) => {
          activateBlockThemeSlot(state, slotIndex);
          saveBlockThemeSlots(state.blockThemeSlots, state.activeBlockThemeSlotIndex);
        },
        onBlockThemeSlotAssign: (slotIndex: number, theme: BlockTheme) => {
          assignBlockThemeSlot(state, slotIndex, theme);
          saveBlockThemeSlots(state.blockThemeSlots, state.activeBlockThemeSlotIndex);
        },
        onLightingEffectChange: (lightingEffect: LightingEffect) => {
          runRoomFieldMutation('lightingEffect', room => { room.lightingEffect = lightingEffect; });
        },
        onAmbientLightDirectionChange: (direction: AmbientLightDirection | undefined) => {
          runRoomFieldMutation('ambientLightDirection', room => { room.ambientLightDirection = direction; });
        },
        onDirectionalBiasChange: (value: number) => {
          runRoomFieldMutation('directionalBias', room => { room.directionalBias = value; });
        },
        onSideExposureStrengthChange: (value: number) => {
          runRoomFieldMutation('sideExposureStrength', room => { room.sideExposureStrength = value; });
        },
        onMinimumWallLightChange: (value: number) => {
          runRoomFieldMutation('minimumWallLight', room => { room.minimumWallLight = value; });
        },
        onFalloffPowerChange: (value: number) => {
          runRoomFieldMutation('falloffPower', room => { room.falloffPower = value; });
        },
        onBackgroundLightSpillChange: (value: number) => {
          runRoomFieldMutation('backgroundLightSpill', room => { room.backgroundLightSpill = value; });
        },
        onSolidLightSoftnessChange: (value: number) => {
          runRoomFieldMutation('solidLightSoftness', room => { room.solidLightSoftness = value; });
        },
        onSunraysEnabledChange: (enabled: boolean) => {
          runRoomFieldMutation('sunrays.enabled', room => {
            const prev = room.sunrays;
            room.sunrays = {
            enabled,
            style: prev?.style ?? 'soft',
            source: 'top',
            angleDeg: prev?.angleDeg ?? 100,
            intensity: prev?.intensity,
            rayCount: prev?.rayCount,
            animationEnabled: prev?.animationEnabled,
            };
          });
        },
        onSunraysStyleChange: (style: 'hard' | 'soft') => {
          runRoomFieldMutation('sunrays.style', room => { if (room.sunrays) room.sunrays.style = style; });
        },
        onSunraysAngleChange: (angleDeg: number) => {
          runRoomFieldMutation('sunrays.angleDeg', room => { if (room.sunrays) room.sunrays.angleDeg = angleDeg; });
        },
        onSunraysIntensityChange: (value: number) => {
          runRoomFieldMutation('sunrays.intensity', room => { if (room.sunrays) room.sunrays.intensity = value; });
        },
        onSunraysRayCountChange: (value: number) => {
          runRoomFieldMutation('sunrays.rayCount', room => { if (room.sunrays) room.sunrays.rayCount = value; });
        },
        onSunraysAnimationChange: (enabled: boolean) => {
          runRoomFieldMutation('sunrays.animationEnabled', room => { if (room.sunrays) room.sunrays.animationEnabled = enabled; });
        },
        onSeamBlendingChange: (mode) => {
          runRoomFieldMutation('blockSeamBlending', room => { room.blockSeamBlending = mode; });
          // Live-preview: update the active renderer immediately so the
          // editor backdrop reflects the change without a full playtest cycle.
          // setActiveSeamBlending already invalidates the chunk cache.
          setActiveSeamBlending(mode);
        },
        onVoidEdgeStyleChange: (style) => {
          runRoomFieldMutation('voidEdgeStyle', room => { room.voidEdgeStyle = style; });
        },
        onBackgroundChange: (bgId: BackgroundId) => {
          runRoomFieldMutation('backgroundId', room => { room.backgroundId = bgId; });
        },
        onRoomSongChange: (songId: RoomSongId) => {
          runRoomFieldMutation('songId', room => { room.songId = songId; });
        },
        onSave: () => saveEdits(),
        onConfirm: () => confirmEdits(),
        onCancel: () => cancelEdits(),
        onExportAllChanges: () => {
          commitActiveRoomToCampaign('export');
          const exportedFileCount = exportAllChanges(pendingRoomEdits, initialRoomIds, isWorldMapDirty);
          if (exportedFileCount === 0) {
            window.alert('No changed rooms or world-map edits to export yet.');
          }
        },
        onExportCampaignJson: () => {
          if (campaignSession) {
            const customBlockDefs = state.customBlockRegistry.size > 0
              ? [...state.customBlockRegistry.values()].map(def =>
                  serializeCustomBlock(def.id, def.name, def.tileWidth, def.tileHeight, def.pixelData))
              : undefined;
            exportCampaignJson(campaignSession, pendingRoomEdits, state.roomData, uiRoot, customBlockDefs);
          } else {
            const exportRoomEdits = new Map(pendingRoomEdits);
            if (isCurrentRoomDirty && state.roomData !== null) {
              exportRoomEdits.set(state.roomData.id, state.roomData);
            }
            exportMainCampaignJson(
              exportRoomEdits,
              uiRoot,
              activeCampaignSession.campaign.campaign.campaignSpawn ?? null,
            );
          }
        },
        onRunRoomAudit: () => runDevRoomAudit(),
        onRunRoomRoundTripValidation: () => runDevRoomRoundTripValidation(),
        onOpenVisualMap: () => openVisualMap(),
        onSkillTombWeaveChange: (weaveId: string) => {
          state.pendingSkillTombWeaveId = weaveId;
        },
        onCrumbleVariantChange: (variant) => {
          state.pendingCrumbleVariant = variant;
        },
        onBlockPlacementModifierChange: (modifier) => {
          // Enforce incompatible-modifier rules: Background must not produce
          // cracked/falling/collidable blocks, so selecting 'background'
          // clears the crumble-variant selection state's relevance and vice
          // versa — only one of {cracked, tough, sensitive, crumbling,
          // background} can be active at a time, which the single
          // pendingBlockPlacementModifier field already guarantees. Toggling
          // Background off (modifier -> 'none') also resets the light-block
          // sub-flag so it doesn't silently linger for the next enable.
          state.pendingBlockPlacementModifier = modifier;
          if (modifier !== 'background') {
            state.pendingBackgroundBlocksLight = false;
          }
        },
        onBackgroundBlocksLightChange: (blocksLight: boolean) => {
          state.pendingBackgroundBlocksLight = blocksLight;
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
          scheduleWorkspaceSave();
        },
        onCreateCustomBlock: (tileWidth: 1 | 2) => {
          const existingIds = new Set(state.customBlockRegistry.keys());
          openCustomBlockDialog({ defaultTileSize: tileWidth, existingIds }, (result) => {
            if (result.action !== 'save' || !result.sourceDef) return;
            const parsed = parseCustomBlockSource(result.sourceDef, { blockId: result.sourceDef.id });
            if (!parsed.ok) {
              console.error('[editor] Created custom block failed validation:', parsed.errors);
              return;
            }
            state.customBlockRegistry.set(parsed.def.id, bumpSpriteRevision(parsed.def));
            registerCustomBlockSprite(parsed.def);
            rebuildCustomBlockUsage();
            ui?.update(state);
          });
        },
        onEditCustomBlock: (blockId: string) => {
          const def = state.customBlockRegistry.get(blockId);
          if (!def) return;
          const existingIds = new Set(state.customBlockRegistry.keys());
          openCustomBlockDialog({ existingDef: def, existingIds }, (result) => {
            if (result.action !== 'save' || !result.sourceDef) return;
            const parsed = parseCustomBlockSource(result.sourceDef, { blockId: result.sourceDef.id });
            if (!parsed.ok) {
              console.error('[editor] Edited custom block failed validation:', parsed.errors);
              return;
            }
            // Only bump spriteRevision / rebuild the cached canvas when pixel
            // data actually changed — a properties-only edit (e.g.
            // materialResponse) updates the cached property bundle in place
            // instead (Phase 2C) and doesn't need a sprite-level rebuild.
            const pixelsUnchanged = def.pixelData.length === parsed.def.pixelData.length &&
              def.pixelData.every((byte, i) => byte === parsed.def.pixelData[i]);
            state.customBlockRegistry.set(parsed.def.id, pixelsUnchanged ? parsed.def : bumpSpriteRevision(parsed.def));
            if (!pixelsUnchanged || !updateCustomBlockProperties(parsed.def.id, parsed.def.properties)) {
              invalidateCustomBlockSprite(parsed.def);
              registerCustomBlockSprite(parsed.def);
            }
            ui?.update(state);
          });
        },
        onRenameCustomBlock: (blockId: string, newName: string) => {
          const def = state.customBlockRegistry.get(blockId);
          if (!def) return;
          const trimmed = newName.trim();
          if (trimmed.length === 0) return;
          // Rebuild def with the new name — ID and properties stay unchanged.
          // spriteRevision carries over as-is (the name itself is already
          // part of computeCustomBlockRegistrySig, so the rename still
          // triggers a rebuild; spriteRevision only tracks pixel changes).
          const sourceDef = serializeCustomBlock(def.id, trimmed, def.tileWidth, def.tileHeight, def.pixelData, def.properties);
          const parsed = parseCustomBlockSource(sourceDef, { blockId: def.id });
          if (!parsed.ok) return;
          state.customBlockRegistry.set(blockId, { ...parsed.def, spriteRevision: def.spriteRevision });
          // Sprite pixels didn't change — no need to invalidate the cached canvas.
          ui?.update(state);
        },
        onDuplicateCustomBlock: (blockId: string) => {
          const def = state.customBlockRegistry.get(blockId);
          if (!def) return;
          const existingIds = new Set(state.customBlockRegistry.keys());
          const newId = makeUniqueId(def.id, existingIds);
          const newName = `${def.name} Copy`;
          const newPixelData = new Uint8ClampedArray(def.pixelData); // independent copy
          const sourceDef = serializeCustomBlock(newId, newName, def.tileWidth, def.tileHeight, newPixelData, def.properties);
          const parsed = parseCustomBlockSource(sourceDef, { blockId: newId });
          if (!parsed.ok) {
            console.error('[editor] Duplicate custom block failed validation:', parsed.errors);
            return;
          }
          state.customBlockRegistry.set(parsed.def.id, bumpSpriteRevision(parsed.def));
          registerCustomBlockSprite(parsed.def);
          rebuildCustomBlockUsage();
          ui?.update(state);
        },
        onDeleteCustomBlock: (blockId: string) => {
          // Check if any room uses this block before deleting.
          const namespacedId = toNamespacedId(blockId);
          const allRooms = campaignSession?.campaignStore?.rawRoomsById;
          const usedInRooms: string[] = [];
          if (allRooms !== undefined) {
            for (const [roomId, room] of allRooms) {
              const placements = room.customBlockPlacements ?? [];
              if (placements.some(([, , id]) => id === namespacedId)) {
                usedInRooms.push(roomId);
              }
            }
          }
          // Also check the current room's in-editor placements.
          const currentPlacements = state.roomData?.customBlockPlacements ?? [];
          if (currentPlacements.some(p => p.blockId === namespacedId)) {
            if (state.roomData) usedInRooms.push(state.roomData.id + ' (unsaved)');
          }
          if (usedInRooms.length > 0) {
            window.alert(`Cannot delete "${blockId}" — it is used in ${usedInRooms.length} room(s):\n${usedInRooms.join('\n')}\nRemove all placements first.`);
            return;
          }
          state.customBlockRegistry.delete(blockId);
          state.customBlockUsage.delete(blockId);
          invalidateCustomBlockSprite({ id: blockId } as import('../levels/customBlocks').CustomBlockDef);
          ui?.update(state);
        },
        onSelectCustomBlockForPlacement: (blockId: string) => {
          const def = state.customBlockRegistry.get(blockId);
          if (!def) return;
          const item: import('./editorDropdownData').PaletteItem = {
            id: `custom:${blockId}`,
            label: def.name,
            category: 'customBlocks',
            isCustomBlockItem: 1,
            customBlockId: blockId,
            customBlockTileWidth: def.tileWidth,
            customBlockTileHeight: def.tileHeight,
          };
          state.selectedPaletteItem = item;
          state.activeTool = EditorTool.Place;
          ui?.update(state);
        },
        onLayerStateChange: (id, patch) => {
          Object.assign(state.layers[id], patch);
          // A layer flipping to hidden/locked/select-only-excluded can make
          // previously-valid selection or an in-progress drag/resize invalid.
          //
          // IMPORTANT: this check must run against the selection as it stood
          // BEFORE any pruning below. Checking `canMutateSelection` after
          // already filtering out the ineligible elements is vacuously true
          // (a pruned/empty selection trivially "every() passes"), so an
          // active drag would never actually be detected as invalid. Policy:
          // if ANY currently-dragged element becomes ineligible, the whole
          // drag is cancelled (all-or-nothing) — we do not silently continue
          // dragging only the remaining eligible subset. Post-drag selection
          // pruning (below) is a separate, independent concern and is allowed
          // to keep just the eligible subset.
          const dragSelectionBecameInvalid = state.selectedElements.some(el => !canMutateElement(state, el));
          if (state.isDragging && dragSelectionBecameInvalid) {
            cancelActiveGesture();
          }
          // Selection-list pruning for post-drag/idle state: drop elements
          // that are no longer eligible so future operations don't act on
          // them. This is independent of (and happens after) the drag-cancel
          // decision above, which used the pre-prune selection.
          state.selectedElements = state.selectedElements.filter(el => canMutateElement(state, el));
          bumpSelectionRevision(state);
          if (challengeResize !== null && !canMutateElement(state, { type: challengeResize.type })) {
            cancelActiveGesture();
          }
          if (state.isResizingTransition && !canMutateElement(state, { type: 'transition' })) {
            cancelActiveGesture();
          }
          ui?.update(state);
          scheduleWorkspaceSave();
        },
        onApplyLayerPreset: (presetId) => {
          // Direct state mutation — deliberately bypasses editorHistory (Phase
          // 6: presets must never enter room undo history, and this isn't
          // room data to begin with).
          state.layers = applyLayerPreset(state.layers, presetId);
          state.selectedElements = state.selectedElements.filter(el => canMutateElement(state, el));
          bumpSelectionRevision(state);
          ui?.update(state);
          scheduleWorkspaceSave();
        },
        onResetWorkspace: () => {
          state.layers = resetWorkspaceLayers();
          state.activeCategory = 'blocks';
          state.brushMode = 'single';
          ui?.applyWorkspaceUIPrefs({ layerPanelCollapsed: false, sidebarScrollTop: 0 });
          ui?.update(state);
          scheduleWorkspaceSave();
        },
      });
    } else {
      closeEditor();
    }
  }

  function closeEditor(): void {
    // Flush any pending workspace-preference write BEFORE ui.destroy() so we
    // can still read the live collapse/scroll state from it.
    scheduleWorkspaceSave();
    workspaceSaver.flush();
    // Cancel any in-progress drag/resize gesture BEFORE tearing down state —
    // an uncommitted live mutation must never survive editor close without
    // going through the normal commit/rollback flow.
    cancelActiveGesture();
    // Reset the shared camera's zoom so editor zoom never leaks into
    // gameplay rendering after the editor closes.
    if (activeCameraRef) { activeCameraRef.zoom = CAMERA_DEFAULT_ZOOM; activeCameraRef = null; }
    if (inputCleanup) { inputCleanup(); inputCleanup = null; }
    if (ui) { ui.destroy(); ui = null; }
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }
    if (dismissConnectPopup) { dismissConnectPopup(); dismissConnectPopup = null; }
    cancelTransitionLink(state);
    state.isActive = false;
    state.roomData = null;
    state.selectedElements = [];
    bumpSelectionRevision(state);
    state.isDragging = false;
    state.isSelectionBoxActive = false;
    lastAppliedCanvasCursor = '';
    discardPendingStrokeRevision(strokeRevision);
    originalRoomDef = null;
    pendingRoomEdits.clear();
    initialRoomIds = new Set();
    isWorldMapDirty = false;
    isCurrentRoomDirty = false;
    clearHistory(history);
    // NOTE: do NOT call clearCustomBlockSpriteCache() here. closeEditor() is
    // only ever invoked to return to gameplay of the SAME active campaign
    // (confirm/playtest, or cancel back to the room that was open before
    // entering the editor) — never to unload/switch campaigns. Gameplay
    // rendering (renderCustomBlockSprites) reads the module-level sprite
    // cache, not state.customBlockRegistry, so clearing it here would strand
    // gameplay with no sprites for any custom block placed/edited this
    // session even though the collision walls were already baked into the
    // room. Ownership of the sprite cache's clear-and-repopulate lifecycle
    // belongs to exactly two boundaries: entering the editor (toggle(), which
    // clears + re-registers from the campaign's committed customBlockDefs)
    // and loading/switching a campaign for real gameplay (game.ts, which also
    // clears + re-registers from the packed campaign's customBlockDefs).
    // state.customBlockRegistry/customBlockUsage ARE editor-session-only
    // bookkeeping (never read by gameplay) and are safely cleared here; they
    // are rebuilt from scratch the next time the editor is opened.
    state.customBlockRegistry.clear();
    state.customBlockUsage.clear();
    onEditorClose?.();
  }

  function saveEdits(): RoomDef | null {
    if (!state.roomData) return null;
    const newRoomDef = editorRoomDataToRoomDef(state.roomData);
    registerRoom(newRoomDef);
    commitActiveRoomToCampaign('manual-save');
    invalidateRoomContour(newRoomDef.id);
    originalRoomDef = newRoomDef;
    return newRoomDef;
  }

  function confirmEdits(): void {
    const confirmStartMs = import.meta.env.DEV ? performance.now() : 0;
    if (state.roomData) {
      const newRoomDef = saveEdits();
      if (newRoomDef === null) return;
      const sx = state.roomData.playerSpawnBlock[0];
      const sy = state.roomData.playerSpawnBlock[1];
      closeEditor();
      onLoadRoom(newRoomDef, sx, sy, true);
    } else {
      closeEditor();
    }
    if (import.meta.env.DEV) {
      logEditorPerf('confirm/playtest startup', confirmStartMs);
    }
  }

  function cancelEdits(): void {
    if (isCurrentRoomDirty && state.roomData) discardCurrentRoomSessionChanges(state.roomData);
    const saved = originalRoomDef;
    closeEditor();
    if (saved) onLoadRoom(saved, saved.playerSpawnBlock[0], saved.playerSpawnBlock[1]);
  }

  /**
   * Mark active-room edits dirty and update only editor-local state.
   * Placement edits never trigger full room rebuild/reload.
   */
  function applyEdits(
    changeKind: 'placement' | 'metadata' = 'metadata',
    options?: { continuous?: boolean },
  ): void {
    if (!state.roomData) return;
    isCurrentRoomDirty = isHistoryDirty(history) || activePaintPending !== null;
    state.pendingComplexityCheck = true;
    // Item C: a continuous drag-paint / drag-erase stroke calls this once per
    // painted block. Working data, the campaign store, and the live preview
    // must all update per block, but `roomContentRevision` — which
    // invalidates whole-room derived summaries such as the sidebar
    // complexity analysis — is bumped only once, on release. See
    // editorContentRevision.ts.
    noteContentMutation(state, strokeRevision, options?.continuous === true);
    if (usesCampaignStore && campaignSession?.campaignStore !== undefined) {
      campaignSession.campaignStore.setActiveRoomId(state.roomData.id);
      campaignSession.campaignStore.markRoomDirty(state.roomData.id, state.roomData);
    }
    if (changeKind === 'metadata') {
      const toRoomDefStartMs = import.meta.env.DEV ? performance.now() : 0;
      const roomDef = rebuildLiveEditorRoomDef();
      if (roomDef === null) return;
      registerRoom(roomDef); // keep registry metadata in sync for map tooling
      if (import.meta.env.DEV) {
        logEditorPerfWarned('editorRoomDataToRoomDef', toRoomDefStartMs, state.roomData.id);
      }
    } else {
      liveEditorRoomDef = null;
    }
  }

  /** Transactional owner for direct room metadata controls. Repeated input
   * events for the same field coalesce through the Property: label. */
  function runRoomFieldMutation(field: string, mutate: (room: EditorRoomData) => void): void {
    if (!state.roomData) return;
    const result = transactRoomFieldMutation(history, state.roomData, field, mutate);
    if (result !== 'noop') applyEdits('metadata');
  }

  /**
   * Runs the room-complexity analyzer and shows a non-blocking toast if the
   * severity has risen to a strictly higher tier than the last one warned
   * about for this room (so growing/shrinking within the same tier, or
   * every single placement during a batch, does not spam popups).
   * Called at most once per completed operation — see the
   * `pendingComplexityCheck` flag in update().
   */
  function maybeWarnRoomComplexity(): void {
    if (!state.roomData) return;
    const report = analyzeEditorRoomComplexity(state.roomData);
    if (report.shouldWarn && !isRoomComplexitySeverityAtLeast(state.lastWarnedComplexitySeverity, report.severity)) {
      state.lastWarnedComplexitySeverity = report.severity;
      showEditorToast(uiRoot, formatRoomComplexityWarningMessage(report));
    }
  }

  // Campaign spawn management (syncCampaignSpawnBlockFromSession,
  // syncCampaignSpawnToSessionAfterDelete, placeCampaignSpawn,
  // showCampaignSpawnReplaceModal) have been extracted to editorCampaignSpawn.ts.

  function loadRoomForEditing(room: RoomDef): void {
    // Cancel any in-progress gesture from the room being left — its captured
    // originals/pending snapshot referred to the outgoing room's data and
    // must not be carried over or left dangling against the new room.
    cancelActiveGesture();
    clearHistory(history);
    // Reset complexity-warning state for the newly-loaded room so a density
    // warning already shown for a previous room doesn't suppress a fresh
    // warning here, and so this room doesn't inherit a stale check flag.
    state.pendingComplexityCheck = false;
    state.lastWarnedComplexitySeverity = 'normal';
    // Room load invalidates derived summaries exactly once, and supersedes
    // (discards) any deferred stroke bump from the outgoing room.
    noteContentMutation(state, strokeRevision);
    if (usesCampaignStore && campaignSession?.campaignStore !== undefined) {
      const loaded = campaignSession.campaignStore.getRoom(room.id, state.nextUid);
      state.roomData = loaded.roomData;
      state.nextUid = loaded.nextUid;
      campaignSession.campaignStore.setActiveRoomId(room.id);
      // Patch tileWidth/tileHeight on custom block placements from the registry.
      if (state.roomData.customBlockPlacements) {
        for (const p of state.roomData.customBlockPlacements) {
          const rawId = p.blockId.startsWith('custom:') ? p.blockId.slice(7) : p.blockId;
          const def = state.customBlockRegistry.get(rawId);
          if (def) { p.tileWidth = def.tileWidth; p.tileHeight = def.tileHeight; }
        }
      }
      state.selectedElements = [];
      bumpSelectionRevision(state);
      state.selectedBlockTheme = state.roomData?.blockTheme ?? 'blackRock';
      isCurrentRoomDirty = false;
      syncCampaignSpawnBlockFromSession(campaignSpawnCtx);
      editorEdgeExtensionCache = buildEdgeExtensionCache(room);
      rebuildLiveEditorRoomDef();
      return;
    }
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
      for (const s of state.roomData.challengeFields ?? []) maxUid = Math.max(maxUid, s.uid + 1);
      for (const s of state.roomData.challengeGates ?? []) maxUid = Math.max(maxUid, s.uid + 1);
      for (const s of state.roomData.gates ?? []) maxUid = Math.max(maxUid, s.uid + 1);
      for (const s of state.roomData.challengeTotems ?? []) maxUid = Math.max(maxUid, s.uid + 1);
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
    bumpSelectionRevision(state);
    // Set the active theme to match the room's default without affecting the
    // recent-theme list — recent themes reflect only explicit user selections.
    state.selectedBlockTheme = state.roomData?.blockTheme ?? 'blackRock';
    isCurrentRoomDirty = false;
    // Sync campaign spawn block for this room from the campaign session.
    syncCampaignSpawnBlockFromSession(campaignSpawnCtx);
    // Rebuild edge extension cache for the newly loaded room so the editor
    // can show extension tiles as non-editable ghost overlays.
    editorEdgeExtensionCache = buildEdgeExtensionCache(room);
    rebuildLiveEditorRoomDef();
  }

  // Room ids that failed to load during the most recent map-overlay catalogue
  // build. Non-empty means the map is showing a partial campaign — surfaced
  // to the user via a toast rather than silently rendering as "complete".
  let lastMapCatalogueFailedRoomIds: string[] = [];

  /**
   * Ensures ROOM_REGISTRY holds every room in the active campaign before a
   * map overlay reads it. Two cases can leave it only partially populated:
   *   - Main campaign on Electron: gameplay uses lazy per-room file loading
   *     (see main.ts), so only visited rooms are registered.
   *   - Custom campaign session: rooms only get registered once opened in
   *     the editor (loadRoomForEditing). Register the rest from the store.
   *
   * This function is ADDITIVE ONLY — it never clears or reloads ROOM_REGISTRY
   * wholesale (that would discard in-progress editor edits and any dirty
   * campaign-store rooms). It only fetches and registers rooms that are
   * currently missing, and never overwrites a room ROOM_REGISTRY already has.
   */
  async function ensureFullRoomRegistryForMapOverlay(): Promise<void> {
    lastMapCatalogueFailedRoomIds = [];
    if (usesCampaignStore && campaignSession?.campaignStore !== undefined) {
      const store = campaignSession.campaignStore;
      for (const id of store.rawRoomsById.keys()) {
        if (ROOM_REGISTRY.has(id)) continue;
        const loaded = store.getRoom(id, state.nextUid);
        state.nextUid = loaded.nextUid;
        registerRoom(editorRoomDataToRoomDef(loaded.roomData));
      }
      if (import.meta.env.DEV) {
        console.log(
          `[editor-map] expectedRooms=${store.rawRoomsById.size} loadedRooms=${ROOM_REGISTRY.size} ` +
          `displayedRooms=${ROOM_REGISTRY.size} source=campaignStore`,
        );
      }
      return;
    }

    // Main campaign: WORLD_MAP_POSITIONS is fully populated at startup (both
    // the eager and Electron lazy-file-cache init paths populate world-map
    // metadata for every campaign room up front — see main.ts), so it is the
    // authoritative room-id catalogue even when ROOM_REGISTRY itself is only
    // partially populated (lazy gameplay loading). Fetch only what's missing.
    const missingIds = [...WORLD_MAP_POSITIONS.keys()].filter(id => !ROOM_REGISTRY.has(id));
    if (missingIds.length > 0) {
      const results = await Promise.all(missingIds.map(async id => {
        try {
          return await loadRoomForGameplayAsync(id);
        } catch (err) {
          console.error(`[editor-map] Failed to load room "${id}" for map overlay:`, err);
          return undefined;
        }
      }));
      lastMapCatalogueFailedRoomIds = missingIds.filter((id, i) => results[i] === undefined && !ROOM_REGISTRY.has(id));
      if (lastMapCatalogueFailedRoomIds.length > 0) {
        console.error(
          `[editor-map] ${lastMapCatalogueFailedRoomIds.length} room(s) could not be loaded for the map overlay: ` +
          lastMapCatalogueFailedRoomIds.join(', '),
        );
      }
    }
    if (import.meta.env.DEV) {
      console.log(
        `[editor-map] expectedRooms=${WORLD_MAP_POSITIONS.size} loadedRooms=${ROOM_REGISTRY.size} ` +
        `displayedRooms=${ROOM_REGISTRY.size - lastMapCatalogueFailedRoomIds.length} source=main`,
      );
    }
  }

  async function openWorldMap(): Promise<void> {
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    await ensureFullRoomRegistryForMapOverlay();
    if (lastMapCatalogueFailedRoomIds.length > 0) {
      showEditorToast(
        uiRoot,
        `⚠ ${lastMapCatalogueFailedRoomIds.length} room(s) failed to load — map is showing a partial campaign.`,
      );
    }
    if (state.roomData) {
      registerRoom(editorRoomDataToRoomDef(state.roomData));
    }
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
            commitActiveRoomToCampaign('change-room');
            doSwitch();
          }, () => {
            discardCurrentRoomSessionChanges(state.roomData);
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
            applyEdits('metadata');
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

    await ensureFullRoomRegistryForMapOverlay();
    if (lastMapCatalogueFailedRoomIds.length > 0) {
      showEditorToast(
        uiRoot,
        `⚠ ${lastMapCatalogueFailedRoomIds.length} room(s) failed to load — map is showing a partial campaign.`,
      );
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
            commitActiveRoomToCampaign('change-room');
            doSwitch();
          }, () => {
            discardCurrentRoomSessionChanges(state.roomData);
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
    _zoom: number,
    cssWidthPx: number,
    cssHeightPx: number,
    virtualWidthPx: number,
    virtualHeightPx: number,
  ): boolean {
    if (!state.isActive) return false;
    activeCameraRef = camera;
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
    panEditorCameraByScreenDelta(
      camera,
      (inputState.middleDragDeltaXPx / cssWidthPx) * virtualWidthPx,
      (inputState.middleDragDeltaYPx / cssHeightPx) * virtualHeightPx,
    );

    // Zoom (mouse wheel restricted to the Select tool; +/- keys work in any tool).
    // Cursor-anchored for wheel zoom, viewport-centered for keyboard zoom.
    applyEditorZoomInput(
      camera,
      inputState.wheelDelta,
      state.activeTool === EditorTool.Select,
      inputState.isZoomInPressed,
      inputState.isZoomOutPressed,
      virtualMouseX,
      virtualMouseY,
      virtualWidthPx / 2,
      virtualHeightPx / 2,
      offsetXPx,
      offsetYPx,
    );

    // Recompute the camera offset in case zoom changed above, so cursor
    // math is accurate this same frame rather than lagging one frame.
    const freshOffset = getCameraOffset(camera, virtualWidthPx, virtualHeightPx);

    // Update cursor position (virtual → world → block)
    const worldX = (virtualMouseX - freshOffset.offsetXPx) / camera.zoom;
    const worldY = (virtualMouseY - freshOffset.offsetYPx) / camera.zoom;
    state.cursorWorldX = worldX;
    state.cursorWorldY = worldY;
    state.cursorBlockX = Math.floor(worldX / BS);
    state.cursorBlockY = Math.floor(worldY / BS);

    // Keyboard shortcuts (tool keys, rotation/flip, map toggles, ESC, undo/redo, copy/paste)
    handleEditorKeyboardShortcuts(state, inputState, history, openWorldMap, openVisualMap, applyEdits, campaignSpawnCtx, cancelActiveGesture);

    // Click handling (one-shot on press)
    if (inputState.isClickFired && state.roomData !== null) {
      // Ignore clicks on the UI panel area (CSS pixel comparison)
      if (inputState.clickScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX) {
        if (
          activePaintPending === null &&
          (state.activeTool === EditorTool.Place || state.activeTool === EditorTool.Delete) &&
          state.selectedPaletteItem?.id !== 'campaign_spawn' &&
          state.brushMode !== 'rect'
        ) {
          activePaintTracksCampaignSpawn = state.activeTool === EditorTool.Delete;
          const campaign = activeCampaignSession.campaign.campaign;
          activePaintPending = beginPaintTransaction(
            state.roomData,
            campaign.campaignSpawn,
            campaign.initialRoomId,
            activePaintTracksCampaignSpawn,
          ).pending;
        }
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
          const soleChallenge = state.selectedElements.length === 1 &&
            (state.selectedElements[0].type === 'challengeField' || state.selectedElements[0].type === 'challengeGate' || state.selectedElements[0].type === 'gate' || state.selectedElements[0].type === 'zipMoveBlock')
            ? state.selectedElements[0] : null;
          const challengeElements = soleChallenge?.type === 'challengeField'
            ? state.roomData.challengeFields : soleChallenge?.type === 'gate' ? state.roomData.gates : soleChallenge?.type === 'zipMoveBlock' ? state.roomData.zipMoveBlocks : state.roomData.challengeGates;
          const challengeRect = soleChallenge ? (challengeElements ?? []).find(element => element.uid === soleChallenge.uid) : undefined;
          const challengeEdge = challengeRect
            ? hitTestRectResizeEdge(challengeRect, state.cursorWorldX, state.cursorWorldY) : null;
          if (challengeRect && soleChallenge && challengeEdge && activeGesture === null &&
              canMutateElement(state, { type: soleChallenge.type })) {
            const resizeType = soleChallenge.type as 'challengeField' | 'challengeGate' | 'gate' | 'zipMoveBlock';
            const resizeUid = soleChallenge.uid;
            const original = { ...challengeRect };
            challengeResize = { type: resizeType, uid: resizeUid, edge: challengeEdge, original };
            const getRect = () => {
              const elements = resizeType === 'challengeField' ? state.roomData!.challengeFields
                : resizeType === 'gate' ? state.roomData!.gates
                : resizeType === 'zipMoveBlock' ? state.roomData!.zipMoveBlocks
                : state.roomData!.challengeGates;
              return (elements ?? []).find(element => element.uid === resizeUid);
            };
            activeGesture = beginGesture(
              state.roomData,
              () => {
                const rect = getRect();
                return rect !== undefined && (
                  rect.xBlock !== original.xBlock || rect.yBlock !== original.yBlock ||
                  rect.wBlock !== original.wBlock || rect.hBlock !== original.hBlock
                );
              },
              () => {
                const rect = getRect();
                if (rect) Object.assign(rect, original);
              },
            );
          }
          // If exactly one transition is already selected, check whether the
          // click landed on one of its (non-trigger) zone edges — if so,
          // begin an edge-resize drag instead of re-selecting/deselecting.
          const soleSelectedTrans = state.selectedElements.length === 1 && state.selectedElements[0].type === 'transition'
            ? state.roomData.transitions.find((t: EditorTransition) => t.uid === state.selectedElements[0].uid) ?? null
            : null;
          const grabbedEdge = soleSelectedTrans !== null
            ? hitTestTransitionResizeEdge(soleSelectedTrans, state.cursorWorldX, state.cursorWorldY, 0.4)
            : null;
          if (challengeResize !== null) {
            // Generic rectangle resize owns this drag.
          } else if (soleSelectedTrans !== null && grabbedEdge !== null && activeGesture === null &&
                     canMutateElement(state, { type: 'transition' })) {
            state.isResizingTransition = true;
            state.resizeTransitionUid = soleSelectedTrans.uid;
            state.resizeEdge = grabbedEdge;
            const transUid = soleSelectedTrans.uid;
            const original = {
              xBlock: soleSelectedTrans.xBlock,
              yBlock: soleSelectedTrans.yBlock,
              gradientWidthBlocks: soleSelectedTrans.gradientWidthBlocks ?? 3,
              openingSizeBlocks: soleSelectedTrans.openingSizeBlocks,
              positionBlock: soleSelectedTrans.positionBlock,
            };
            resizeOriginalGeometry = original;
            const getTrans = () => state.roomData!.transitions.find((t: EditorTransition) => t.uid === transUid);
            activeGesture = beginGesture(
              state.roomData,
              () => {
                const trans = getTrans();
                return trans !== undefined && (
                  trans.xBlock !== original.xBlock || trans.yBlock !== original.yBlock ||
                  (trans.gradientWidthBlocks ?? 3) !== original.gradientWidthBlocks ||
                  trans.openingSizeBlocks !== original.openingSizeBlocks
                );
              },
              () => {
                const trans = getTrans();
                if (trans) {
                  trans.xBlock = original.xBlock;
                  trans.yBlock = original.yBlock;
                  trans.gradientWidthBlocks = original.gradientWidthBlocks;
                  trans.openingSizeBlocks = original.openingSizeBlocks;
                  trans.positionBlock = original.positionBlock;
                }
              },
            );
          } else {
          const clicked = selectAtCursor(state);
          if (clicked) {
            if (inputState.isShiftHeld) {
              // Shift-click: toggle selection
              const idx = state.selectedElements.findIndex(e => e.type === clicked.type && e.uid === clicked.uid);
              if (idx >= 0) {
                state.selectedElements.splice(idx, 1);
                bumpSelectionRevision(state);
              } else {
                state.selectedElements.push(clicked);
                bumpSelectionRevision(state);
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
                bumpSelectionRevision(state);
              }
            }
          } else if (!inputState.isShiftHeld) {
            // Click on empty space without shift: begin selection box
            state.selectedElements = [];
            bumpSelectionRevision(state);
            state.isSelectionBoxActive = true;
            state.selectionBoxStartBlockX = state.cursorBlockX;
            state.selectionBoxStartBlockY = state.cursorBlockY;
          }
          }
        } else if (state.activeTool === EditorTool.Place && !getPlacementStatus(state, () => {
          const op = evaluateBrushOperation(state);
          return op.validCount > 0 ? true : (op.reason ?? false);
        }).allowed) {
          const status = getPlacementStatus(state, () => {
            const op = evaluateBrushOperation(state);
            return op.validCount > 0 ? true : (op.reason ?? false);
          });
          const sig = `${status.targetLayer ?? ''}:${status.reason ?? ''}`;
          const now = performance.now();
          if (sig !== lastBlockedPlacementSig || now - lastBlockedPlacementToastAt > BLOCKED_PLACEMENT_TOAST_THROTTLE_MS) {
            showEditorToast(uiRoot, describePlacementBlockReason(status.reason, status.targetLayer));
            lastBlockedPlacementSig = sig;
            lastBlockedPlacementToastAt = now;
          }
        } else if (state.activeTool === EditorTool.Place && state.selectedPaletteItem?.isPixelMaterialItem === 1) {
          const px = pixelFromCursor(state);
          const placed = placePixelMaterialAt(state, px.x, px.y, state.selectedPaletteItem.pixelMaterialId ?? 1);
          if (placed) applyEdits('placement');
          lastDragPixelX = px.x;
          lastDragPixelY = px.y;
        } else if (state.activeTool === EditorTool.Place && state.selectedPaletteItem?.id === 'campaign_spawn') {
            // Campaign spawn: singleton logic — only one allowed in the entire campaign.
            // This branch is checked BEFORE any brush-mode expansion (rect/fill/3x3/5x5)
            // so campaign spawn always places as a single cell regardless of the
            // currently selected brush mode, and never leaves stray rect-brush state.
            state.brushRectStartBlockX = null;
            state.brushRectStartBlockY = null;
            const bx = state.cursorBlockX;
            const by = state.cursorBlockY;
            const existingSpawn = activeCampaignSession.campaign.campaign.campaignSpawn;
            const isInCurrentRoom = existingSpawn !== undefined &&
              existingSpawn.roomId === state.roomData?.id;
            if (existingSpawn !== undefined && !isInCurrentRoom) {
                // Spawn exists in a different room — ask before replacing.
                // Auto-select happens inside the modal's confirm callback (see
                // editorCampaignSpawn.ts), which also pushes the undo snapshot
                // atomically right before mutating — nothing has moved yet here.
              showCampaignSpawnReplaceModal(campaignSpawnCtx, bx, by, history);
            } else {
                // Either no spawn yet, or spawn is already in this room — update silently.
              const pending = captureCampaignSpawnSnapshot(campaignSpawnCtx, 'Place campaign spawn');
              placeCampaignSpawn(campaignSpawnCtx, bx, by);
              const commitResult = commitCampaignSpawnSnapshot(campaignSpawnCtx, history, pending);
              if (commitResult !== 'noop') applyEdits('metadata');
              // Auto-select the marker so the inspector shows it immediately.
              state.selectedElements = [{ type: 'campaignSpawn', uid: 0 }];
              bumpSelectionRevision(state);
            }
        } else if (state.activeTool === EditorTool.Place) {
          if (state.brushMode === 'rect' && state.brushRectStartBlockX === null) {
            // Rect brush: first click sets the drag start — don't place yet.
            state.brushRectStartBlockX = state.cursorBlockX;
            state.brushRectStartBlockY = state.cursorBlockY;
          } else {
            const totalPlacementStartMs = import.meta.env.DEV ? performance.now() : 0;
            // Measure snapshot-capture cost separately on the placement hot path.
            // Capturing is side-effect-free (doesn't touch undo/redo), so a
            // no-op placement below can discard `pending` without having
            // disturbed history at all.
            const snapshotStartMs = import.meta.env.DEV ? performance.now() : 0;
            const pending = activePaintPending ?? capturePendingSnapshot(state.roomData, undefined, undefined, false, 'Paint stroke');
            const snapshotElapsedMs = import.meta.env.DEV ? performance.now() - snapshotStartMs : 0;
            if (import.meta.env.DEV) {
              logEditorPerfWarned('pushSnapshot (undo)', snapshotStartMs, state.roomData.id);
            }
            const transCountBefore = state.roomData.transitions.length;
            const placementMutationStartMs = import.meta.env.DEV ? performance.now() : 0;
            const placed = placeAtCursor(state);
            const placementMutationElapsedMs = import.meta.env.DEV ? performance.now() - placementMutationStartMs : 0;
            if (import.meta.env.DEV) {
              logEditorPerfWarned('placeAtCursor mutation', placementMutationStartMs, state.roomData.id);
            }
            // Rect brush: clear drag start after placement.
            if (state.brushMode === 'rect') {
              state.brushRectStartBlockX = null;
              state.brushRectStartBlockY = null;
            }
            if (placed && activePaintPending === null) {
              // Only now commit the snapshot to the undo stack and clear
              // redo — a no-op placement (blocked layer, dedup, overlap)
              // leaves undo/redo completely untouched.
              activePaintPending = pending;
              activePaintTracksCampaignSpawn = false;
            }
            const applyEditsStartMs = import.meta.env.DEV ? performance.now() : 0;
            if (placed) applyEdits('placement');
            const applyEditsElapsedMs = import.meta.env.DEV ? performance.now() - applyEditsStartMs : 0;
            if (import.meta.env.DEV) {
              const totalElapsedMs = performance.now() - totalPlacementStartMs;
              const slowestStage = [
                { label: 'pushSnapshot', elapsedMs: snapshotElapsedMs },
                { label: 'placeAtCursor', elapsedMs: placementMutationElapsedMs },
                { label: 'applyEdits', elapsedMs: applyEditsElapsedMs },
              ].sort((a, b) => b.elapsedMs - a.elapsedMs)[0];
              console.log(
                `[editor-perf] placeBlock total=${totalElapsedMs.toFixed(2)}ms room=${state.roomData.id} touchedCampaign=false committedRoom=false stringified=false localStorage=false dehydrated=false campaignValidated=false allRoomsLooped=false cacheInvalidation=local`,
              );
              if (totalElapsedMs > 50) {
                console.error(
                  `[editor-perf] ⛔ placeBlock total=${totalElapsedMs.toFixed(2)}ms expensiveFunction=${slowestStage.label}:${slowestStage.elapsedMs.toFixed(2)}ms`,
                );
              } else if (totalElapsedMs > 16) {
                console.warn(
                  `[editor-perf] ⚠️ placeBlock total=${totalElapsedMs.toFixed(2)}ms expensiveFunction=${slowestStage.label}:${slowestStage.elapsedMs.toFixed(2)}ms`,
                );
              }
            }
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
                    if (usesCampaignStore && campaignSession?.campaignStore !== undefined) {
                      campaignSession.campaignStore.markRoomDirty(newRoomDef.id, newRoomData);
                      campaignSession.campaignStore.commitRoom(newRoomDef.id, newRoomData);
                    } else {
                      pendingRoomEdits.set(newRoomDef.id, newRoomData);
                    }
                    isWorldMapDirty = true;
                    isCurrentRoomDirty = true;
                    // Rebuild the current room to reflect the updated source transition.
                    applyEdits('metadata');
                    showEditorToast(uiRoot, `Room "${newRoomDef.id}" created and linked.`);
                  },
                  onWorldMapDataChanged: () => { isWorldMapDirty = true; },
                });
              });
            }
          }
        } else if (state.activeTool === EditorTool.Delete && state.selectedPaletteItem?.isPixelMaterialItem === 1) {
          const px = pixelFromCursor(state);
          const erased = erasePixelMaterialAt(state, px.x, px.y);
          if (erased) applyEdits('placement');
          lastDragPixelX = px.x;
          lastDragPixelY = px.y;
        } else if (state.activeTool === EditorTool.Delete) {
          const deleted = deleteAtCursorBrushed(state);
          if (deleted) {
            syncCampaignSpawnToSessionAfterDelete(campaignSpawnCtx);
            applyEdits('placement');
          }
          lastDragBlockX = state.cursorBlockX;
          lastDragBlockY = state.cursorBlockY;
        }
      }
    }

    // Right-click delete (one-shot). Works regardless of active tool, and
    // respects the active brush mode (single/3x3/5x5/rect/fill) the same way
    // left-click placement does, so brush tools can also be used to erase.
    if (inputState.isRightClickFired && state.roomData !== null) {
      if (inputState.rightClickScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX) {
        if (activePaintPending === null) {
          const campaign = activeCampaignSession.campaign.campaign;
          activePaintPending = beginPaintTransaction(
            state.roomData, campaign.campaignSpawn, campaign.initialRoomId, true,
          ).pending;
          activePaintTracksCampaignSpawn = true;
        }
        let changed: boolean;
        if (state.selectedPaletteItem?.isPixelMaterialItem === 1) {
          // Pixel-material tool: right-click erases the exact native pixel
          // under the cursor, not whatever block-grid element deleteAtCursor
          // would otherwise find there.
          const px = pixelFromCursor(state);
          changed = erasePixelMaterialAt(state, px.x, px.y);
          lastDragPixelX = px.x;
          lastDragPixelY = px.y;
        } else {
          changed = deleteAtCursorBrushed(state);
          if (changed) syncCampaignSpawnToSessionAfterDelete(campaignSpawnCtx);
        }
        if (changed) {
          if (state.selectedPaletteItem?.isPixelMaterialItem !== 1) {
            syncCampaignSpawnToSessionAfterDelete(campaignSpawnCtx);
          }
          applyEdits('placement');
        }
        lastDragBlockX = state.cursorBlockX;
        lastDragBlockY = state.cursorBlockY;
      }
    }

    if (challengeResize && inputState.isMouseDown && state.roomData) {
      const elements = challengeResize.type === 'challengeField'
        ? state.roomData.challengeFields : challengeResize.type === 'gate' ? state.roomData.gates : challengeResize.type === 'zipMoveBlock' ? state.roomData.zipMoveBlocks : state.roomData.challengeGates;
      const rect = (elements ?? []).find(element => element.uid === challengeResize!.uid);
      // Permission check lives in the resize call site itself (not just the
      // handle's initial hit-test), so a locked/hidden layer can't be resized
      // via an in-progress drag even if the layer state changed mid-drag.
      if (rect && canMutateElement(state, { type: challengeResize.type })) Object.assign(rect, resizeBlockRect(
        challengeResize.original,
        challengeResize.edge,
        state.cursorBlockX,
        state.cursorBlockY,
        state.roomData.widthBlocks,
        state.roomData.heightBlocks,
        challengeResize.type === 'zipMoveBlock' ? 3 : 1,
        challengeResize.type === 'zipMoveBlock' ? 3 : 1,
      ));
    }

    // Edge-resize for a selected transition
    if (state.isResizingTransition && inputState.isMouseDown && state.roomData && resizeOriginalGeometry) {
      const trans = state.roomData.transitions.find((t: EditorTransition) => t.uid === state.resizeTransitionUid);
      // Defend this mutation directly — don't rely solely on
      // onLayerStateChange having cancelled the resize after the fact.
      if (trans && canMutateElement(state, { type: 'transition' })) {
        const orig = resizeOriginalGeometry;
        const isHoriz = trans.direction === 'left' || trans.direction === 'right';
        const cx = state.cursorBlockX;
        const cy = state.cursorBlockY;
        if (state.resizeEdge === 'left') {
          const rightEdge = orig.xBlock + (isHoriz ? orig.gradientWidthBlocks : orig.openingSizeBlocks);
          const newXBlock = Math.min(cx, rightEdge - (isHoriz ? 0 : 1));
          if (isHoriz) {
            trans.gradientWidthBlocks = Math.max(0, rightEdge - newXBlock);
            trans.xBlock = rightEdge - trans.gradientWidthBlocks;
          } else {
            trans.openingSizeBlocks = Math.max(1, rightEdge - newXBlock);
            trans.xBlock = rightEdge - trans.openingSizeBlocks;
            trans.positionBlock = trans.xBlock;
          }
        } else if (state.resizeEdge === 'right') {
          if (isHoriz) {
            trans.gradientWidthBlocks = Math.max(0, cx - orig.xBlock);
          } else {
            trans.openingSizeBlocks = Math.max(1, cx - orig.xBlock);
          }
        } else if (state.resizeEdge === 'top') {
          const bottomEdge = orig.yBlock + (isHoriz ? orig.openingSizeBlocks : orig.gradientWidthBlocks);
          const newYBlock = Math.min(cy, bottomEdge - (isHoriz ? 1 : 0));
          if (isHoriz) {
            trans.openingSizeBlocks = Math.max(1, bottomEdge - newYBlock);
            trans.yBlock = bottomEdge - trans.openingSizeBlocks;
            trans.positionBlock = trans.yBlock;
          } else {
            trans.gradientWidthBlocks = Math.max(0, bottomEdge - newYBlock);
            trans.yBlock = bottomEdge - trans.gradientWidthBlocks;
          }
        } else if (state.resizeEdge === 'bottom') {
          if (isHoriz) {
            trans.openingSizeBlocks = Math.max(1, cy - orig.yBlock);
          } else {
            trans.gradientWidthBlocks = Math.max(0, cy - orig.yBlock);
          }
        }
      }
    }

    // Drag-to-move for Select tool
    if (state.activeTool === EditorTool.Select && inputState.isMouseDown && state.selectedElements.length > 0 && !state.isLinkingTransition && !state.isSelectionBoxActive && !state.isResizingTransition) {
      if (!state.isDragging) {
        const dxPx = inputState.mouseScreenXPx - inputState.clickScreenXPx;
        const dyPx = inputState.mouseScreenYPx - inputState.clickScreenYPx;
        if ((Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) && activeGesture === null && canMutateSelection(state)) {
          state.isDragging = true;
          state.dragStartBlockX = state.cursorBlockX;
          state.dragStartBlockY = state.cursorBlockY;
          storeDragStartPositions(state, dragOriginalPositions);
          activeGesture = beginGesture(
            state.roomData!,
            () => !arePositionMapsEqual(currentSelectedElementPositions(state), dragOriginalPositions),
            () => { moveSelectedElements(state, dragOriginalPositions, 0, 0); },
          );
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
      if (activePaintPending && !inputState.isRightMouseDown) {
        let commitResult;
        if (activePaintTracksCampaignSpawn) {
          commitResult = commitCampaignSpawnSnapshot(campaignSpawnCtx, history, activePaintPending);
        } else {
          commitResult = commitPendingSnapshot(history, activePaintPending);
        }
        activePaintPending = null;
        activePaintTracksCampaignSpawn = false;
        isCurrentRoomDirty = isHistoryDirty(history);
        if (commitResult !== 'noop') applyEdits('placement');
      }
      if (state.isDragging) {
        state.isDragging = false;
        dragOriginalPositions.clear();
        const committed = activeGesture ? finishGesture(history, activeGesture) : 'noop';
        activeGesture = null;
        // Only rebuild/dirty the room when the drag actually moved something —
        // a click-release with no movement (or a drag that returned to its
        // origin) leaves undo/redo and dirty state completely untouched.
        if (committed !== 'noop') applyEdits('metadata');
      }
      if (state.isResizingTransition) {
        state.isResizingTransition = false;
        state.resizeTransitionUid = -1;
        state.resizeEdge = null;
        resizeOriginalGeometry = null;
        const committed = activeGesture ? finishGesture(history, activeGesture) : 'noop';
        activeGesture = null;
        if (committed !== 'noop') applyEdits('metadata');
      }
      if (challengeResize) {
        challengeResize = null;
        const committed = activeGesture ? finishGesture(history, activeGesture) : 'noop';
        activeGesture = null;
        if (committed !== 'noop') applyEdits('metadata');
      }
      if (state.isSelectionBoxActive) {
        state.isSelectionBoxActive = false;
        if (state.roomData) {
          const boxElements = getAllElementsInRect(
            state,
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
                bumpSelectionRevision(state);
              }
            }
          } else {
            state.selectedElements = boxElements;
            bumpSelectionRevision(state);
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

    if (canDragPaint && state.selectedPaletteItem?.isPixelMaterialItem === 1) {
      const px = pixelFromCursor(state);
      if (px.x !== lastDragPixelX || px.y !== lastDragPixelY) {
        const fromX = lastDragPixelX === INVALID_DRAG_BLOCK ? px.x : lastDragPixelX;
        const fromY = lastDragPixelY === INVALID_DRAG_BLOCK ? px.y : lastDragPixelY;
        const changed = paintPixelMaterialLine(
          state, fromX, fromY, px.x, px.y,
          state.selectedPaletteItem.pixelMaterialId ?? 1,
          state.activeTool === EditorTool.Delete,
        );
        lastDragPixelX = px.x;
        lastDragPixelY = px.y;
        if (changed) applyEdits('placement', { continuous: true });
      }
    } else if (canDragPaint) {
      if (state.cursorBlockX !== lastDragBlockX || state.cursorBlockY !== lastDragBlockY) {
        lastDragBlockX = state.cursorBlockX;
        lastDragBlockY = state.cursorBlockY;
        if (state.activeTool === EditorTool.Place) {
          const placementStartMs = import.meta.env.DEV ? performance.now() : 0;
          const placed = placeAtCursor(state);
          if (placed) applyEdits('placement', { continuous: true });
          if (import.meta.env.DEV) {
            logEditorPerf('editor placement mutation', placementStartMs);
          }
        } else if (state.activeTool === EditorTool.Delete) {
          const placementStartMs = import.meta.env.DEV ? performance.now() : 0;
          const deleted = deleteAtCursorBrushed(state);
          if (deleted) applyEdits('placement', { continuous: true });
          if (import.meta.env.DEV) {
            logEditorPerf('editor placement mutation', placementStartMs);
          }
        }
      }
    }

    // Drag-erase: right mouse button held erases as the cursor moves to a new
    // block, regardless of active tool — mirrors left-click drag-paint above
    // but always deletes, and respects the active brush mode.
    const canRightDragPaint =
      !inputState.isRightClickFired &&
      inputState.isRightMouseDown &&
      state.roomData !== null &&
      !state.isLinkingTransition &&
      !state.isDragging &&
      !state.isSelectionBoxActive &&
      state.brushMode !== 'rect' &&
      inputState.mouseScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX;

    if (canRightDragPaint && state.selectedPaletteItem?.isPixelMaterialItem === 1) {
      const px = pixelFromCursor(state);
      if (px.x !== lastDragPixelX || px.y !== lastDragPixelY) {
        const fromX = lastDragPixelX === INVALID_DRAG_BLOCK ? px.x : lastDragPixelX;
        const fromY = lastDragPixelY === INVALID_DRAG_BLOCK ? px.y : lastDragPixelY;
        const changed = paintPixelMaterialLine(
          state, fromX, fromY, px.x, px.y,
          state.selectedPaletteItem.pixelMaterialId ?? 1,
          true,
        );
        lastDragPixelX = px.x;
        lastDragPixelY = px.y;
        if (changed) applyEdits('placement', { continuous: true });
      }
    } else if (canRightDragPaint) {
      if (state.cursorBlockX !== lastDragBlockX || state.cursorBlockY !== lastDragBlockY) {
        lastDragBlockX = state.cursorBlockX;
        lastDragBlockY = state.cursorBlockY;
        const deleted = deleteAtCursorBrushed(state);
        if (deleted) applyEdits('placement', { continuous: true });
      }
    }

    // ── Hover resolution ─────────────────────────────────────────────────
    // Item B: while a continuous gesture owns the pointer (drag-to-move,
    // rect/transition resize, marquee, link-drag) we skip the whole-room
    // hover hit-test entirely — the pointer is already committed to the
    // element being manipulated, so scanning is pure waste (and makes the
    // tooltip flicker onto swept-over elements). hoverElement is left as-is
    // rather than nulled so the tooltip stays stable for the gesture's
    // duration. Every ownership flag is cleared in the same update pass as
    // the mouse release, so hover resumes on the very next frame.
    const ownership: PointerOwnershipInput = {
      hasActiveGesture: activeGesture !== null,
      isDragging: state.isDragging,
      isSelectionBoxActive: state.isSelectionBoxActive,
      isResizingTransition: state.isResizingTransition,
      isResizingRect: challengeResize !== null,
      isLinkingTransition: state.isLinkingTransition,
    };
    const pointerOwned = isPointerOwnedByGesture(ownership);
    if (!pointerOwned) {
      if (shouldScanHover({
        ...ownership,
        isSelectTool: state.activeTool === EditorTool.Select,
        isOverCanvas: inputState.mouseScreenXPx > EDITOR_PANEL_WIDTH_CSS_PX,
      })) {
        state.hoverElement = selectAtCursor(state);
      } else {
        state.hoverElement = null;
      }
    }

    // Cursor: frozen for the duration of an owned gesture (the pointer can
    // wander off the grabbed edge mid-resize; the cursor must not change to
    // reflect that). Only re-assigned when the resolved value differs, so an
    // idle editor never touches canvas.style.
    if (!pointerOwned) {
      let resizeCursor = 'default';
      const selectedForCursor = state.selectedElements.length === 1 ? state.selectedElements[0] : null;
      if (selectedForCursor?.type === 'challengeField' || selectedForCursor?.type === 'challengeGate' || selectedForCursor?.type === 'gate') {
        const elements = selectedForCursor.type === 'challengeField' ? state.roomData?.challengeFields : selectedForCursor.type === 'gate' ? state.roomData?.gates : state.roomData?.challengeGates;
        const rect = (elements ?? []).find(element => element.uid === selectedForCursor.uid);
        const edge = rect ? hitTestRectResizeEdge(rect, state.cursorWorldX, state.cursorWorldY) : null;
        if (edge === 'left' || edge === 'right') resizeCursor = 'ew-resize';
        if (edge === 'top' || edge === 'bottom') resizeCursor = 'ns-resize';
        if (edge === 'topLeft' || edge === 'bottomRight') resizeCursor = 'nwse-resize';
        if (edge === 'topRight' || edge === 'bottomLeft') resizeCursor = 'nesw-resize';
      }
      if (resizeCursor !== lastAppliedCanvasCursor) {
        canvas.style.cursor = resizeCursor;
        lastAppliedCanvasCursor = resizeCursor;
      }
    }

    // Item C: a completed drag-paint / drag-erase stroke bumps
    // roomContentRevision exactly once, here on release, rather than once per
    // painted block. Runs before the complexity check and the ui.update()
    // below so the single re-analysis this frame sees the final content.
    if (!inputState.isMouseDown && !inputState.isRightMouseDown) {
      flushStrokeRevision(state, strokeRevision);
    }

    // Room-complexity warning: check at most once per completed operation
    // (drag/paint/paste/fill/undo/redo), never mid-drag.
    if (state.pendingComplexityCheck && !inputState.isMouseDown) {
      state.pendingComplexityCheck = false;
      maybeWarnRoomComplexity();
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
    return liveEditorRoomDef ?? rebuildLiveEditorRoomDef();
  }

  function destroy(): void {
    if (inputCleanup) { inputCleanup(); inputCleanup = null; }
    if (ui) { ui.destroy(); ui = null; }
    if (worldMapCleanup) { worldMapCleanup(); worldMapCleanup = null; }
    if (visualMapCleanup) { visualMapCleanup(); visualMapCleanup = null; }
    liveEditorRoomDef = null;
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
