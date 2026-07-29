import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { initLightingSystem, markOccludersDirty, renderLightingPass } from '../render/lighting/lightingSystem';
import type { LightDef } from '../render/lighting/lightingTypes';
import type { WorldSnapshot } from '../render/snapshot';
import { updatePlayerLuminantLight } from './gamePlayerLuminantLight';

/** Tracks the last room ID to detect room changes for occluder dirty marking. */
let _lastLightingRoomId: string | null = null;

/**
 * Reusable scratch array combining the room's authored scene lights with the
 * player's dynamic Luminant glow. Sized/filled fresh each frame (no new array
 * allocated) to avoid per-frame heap churn.
 */
const _combinedLights: LightDef[] = [];

/**
 * Render designer-authored scene-light pass for the current room, plus the
 * player's dynamic Luminant-mote glow (see gamePlayerLuminantLight.ts).
 */
export function renderSceneLightingPass(
  ctx: CanvasRenderingContext2D,
  currentRoom: RoomDef,
  snapshot: WorldSnapshot,
  dtSec: number,
  ox: number,
  oy: number,
  zoom: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  nowMs: number,
): void {
  const playerLuminantLight = updatePlayerLuminantLight(snapshot, dtSec);
  const sceneLights = currentRoom.sceneLights;

  if ((!sceneLights || sceneLights.length === 0) && playerLuminantLight === null) return;

  _combinedLights.length = 0;
  if (sceneLights) {
    for (let i = 0; i < sceneLights.length; i++) _combinedLights.push(sceneLights[i]);
  }
  if (playerLuminantLight !== null) _combinedLights.push(playerLuminantLight);

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

  renderLightingPass(ctx, _combinedLights, ox, oy, zoom, virtualWidthPx, virtualHeightPx, nowMs);
}
