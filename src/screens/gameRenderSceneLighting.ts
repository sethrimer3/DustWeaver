import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { initLightingSystem, markOccludersDirty, renderLightingPass } from '../render/lighting/lightingSystem';

/** Tracks the last room ID to detect room changes for occluder dirty marking. */
let _lastLightingRoomId: string | null = null;

/**
 * Render designer-authored scene-light pass for the current room.
 */
export function renderSceneLightingPass(
  ctx: CanvasRenderingContext2D,
  currentRoom: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  nowMs: number,
): void {
  if (!currentRoom.sceneLights || currentRoom.sceneLights.length === 0) return;

  initLightingSystem(virtualWidthPx, virtualHeightPx);
  if (_lastLightingRoomId !== currentRoom.id) {
    _lastLightingRoomId = currentRoom.id;
    markOccludersDirty(
      currentRoom.walls.map(w => ({
        xWorld: w.xBlock * BLOCK_SIZE_MEDIUM,
        yWorld: w.yBlock * BLOCK_SIZE_MEDIUM,
        wWorld: w.wBlock * BLOCK_SIZE_MEDIUM,
        hWorld: w.hBlock * BLOCK_SIZE_MEDIUM,
        isPlatformFlag: w.isPlatformFlag,
      })),
    );
  }

  renderLightingPass(ctx, currentRoom.sceneLights, ox, oy, zoom, virtualWidthPx, virtualHeightPx, nowMs);
}
