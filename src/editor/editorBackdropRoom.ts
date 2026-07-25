/**
 * Lightweight editor-backdrop room view (Item E).
 *
 * While the editor is open, gameScreen.ts renders the gameplay scene behind
 * the editor overlays once per frame, and used to obtain the room it needs
 * via `editorController.getRoomDef()`. That getter returns a cached full
 * `RoomDef`, but `applyEdits('placement')` nulls the cache — so every
 * ordinary placement forced a complete `editorRoomDataToRoomDef()`
 * reconversion of the WHOLE room on the very next frame (and, during a
 * drag-paint stroke, once per painted block).
 *
 * The backdrop does not need a whole RoomDef. Tracing every consumer in
 * gameScreenEditorBackdrop.ts, the fields actually read are:
 *
 *   - `worldNumber`, `widthBlocks`, `heightBlocks`, `backgroundId`
 *        -> renderWorldBackground()
 *   - `id`             -> isTheroShowcaseRoom()
 *   - `backgroundId`   -> renderTheroBackgroundEffect() /
 *                         renderCrystallineCracksBackground()
 *   - `customBlockPlacements` -> renderCustomBlockSprites()
 *   - `transitions`    -> drawTunnelDarkness() (tunnel gradient geometry)
 *   - `name`           -> renderHighResolutionDebugOverlay() room label
 *
 * Nothing else. This module rebuilds exactly that struct, and only when the
 * room's content revision advances (once per completed operation, see
 * editorContentRevision.ts) — so it is O(transitions + custom blocks), never
 * O(whole room), and never per frame.
 *
 * Full `RoomDef` conversion is still used, unchanged, for Save, Save & Test,
 * export, room activation, and every other full-data consumer.
 */

import type { RoomDef } from '../levels/roomDef';
import type { EditorRoomData } from './editorElementTypes';

/**
 * The exact slice of `RoomDef` the editor backdrop renders from. A real
 * `RoomDef` structurally satisfies this, so gameScreen's
 * `?? currentRoom` fallback keeps working.
 */
export type EditorBackdropRoom = Pick<
  RoomDef,
  'id' | 'name' | 'worldNumber' | 'widthBlocks' | 'heightBlocks'
  | 'backgroundId' | 'backgroundBlur' | 'customBlockPlacements' | 'transitions'
>;

export interface EditorBackdropRoomCache {
  view: EditorBackdropRoom | null;
  roomId: string;
  revision: number;
}

export function createEditorBackdropRoomCache(): EditorBackdropRoomCache {
  return { view: null, roomId: '', revision: -1 };
}

export function resetEditorBackdropRoomCache(cache: EditorBackdropRoomCache): void {
  cache.view = null;
  cache.roomId = '';
  cache.revision = -1;
}

/** Builds the backdrop view from live editor room data. */
export function buildEditorBackdropRoom(data: EditorRoomData): EditorBackdropRoom {
  return {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    backgroundId: data.backgroundId,
    backgroundBlur: data.backgroundBlur,
    customBlockPlacements: (data.customBlockPlacements ?? []).length > 0
      ? (data.customBlockPlacements ?? []).map(p =>
          [p.xBlock, p.yBlock, p.blockId, p.tileWidth, p.tileHeight] as [number, number, string, number, number],
        )
      : undefined,
    transitions: data.transitions.map(t => ({
      direction: t.direction,
      targetRoomId: t.targetRoomId,
      xBlock: t.xBlock,
      yBlock: t.yBlock,
      positionBlock: t.positionBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
      fadeColor: t.fadeColor,
      depthBlock: t.depthBlock,
      isSecretDoor: t.isSecretDoor,
      gradientWidthBlocks: t.gradientWidthBlocks,
      longTransition: t.longTransition,
    })),
  };
}

/**
 * Returns the cached backdrop view, rebuilding it only when the room identity
 * or content revision changed. Called once per editor frame.
 */
export function resolveEditorBackdropRoom(
  cache: EditorBackdropRoomCache,
  data: EditorRoomData,
  revision: number,
): EditorBackdropRoom {
  if (cache.view === null || cache.roomId !== data.id || cache.revision !== revision) {
    cache.view = buildEditorBackdropRoom(data);
    cache.roomId = data.id;
    cache.revision = revision;
  }
  return cache.view;
}
