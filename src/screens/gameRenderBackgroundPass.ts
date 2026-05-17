import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { renderWorldBackground } from '../render/backgroundRenderer';
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import { STAGE_BACKGROUND, type RenderProfiler } from '../render/hud/renderProfiler';

/**
 * Minimal metadata for the staged (previous) room's background rendering.
 * Used only when seamless room crossing staging is active.
 */
export interface StagedRoomBgInfo {
  /** RoomDef of the staged room — used for worldNumber and backgroundId. */
  room: RoomDef;
  /** World-space X origin of the staged room. */
  originXWorld: number;
  /** World-space Y origin of the staged room. */
  originYWorld: number;
}

export interface BackgroundPassContext {
  ctx: CanvasRenderingContext2D;
  currentRoom: RoomDef;
  stagedRoom: StagedRoomBgInfo | null;
  ox: number;
  oy: number;
  zoom: number;
  virtualWidthPx: number;
  virtualHeightPx: number;
  roomWidthWorld: number;
  roomHeightWorld: number;
  nowMs: number;
  renderProfiler?: RenderProfiler;
}

/**
 * Render room background and procedural background effects for the current frame.
 */
export function renderBackgroundPass(r: BackgroundPassContext): void {
  const {
    ctx,
    currentRoom,
    stagedRoom,
    ox,
    oy,
    zoom,
    virtualWidthPx,
    virtualHeightPx,
    roomWidthWorld,
    roomHeightWorld,
    nowMs,
    renderProfiler,
  } = r;

  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_BACKGROUND);

  if (stagedRoom !== null) {
    const stagedW = stagedRoom.room.widthBlocks * BLOCK_SIZE_MEDIUM;
    const stagedH = stagedRoom.room.heightBlocks * BLOCK_SIZE_MEDIUM;
    const stagedOx = ox + stagedRoom.originXWorld * zoom;
    const stagedOy = oy + stagedRoom.originYWorld * zoom;

    ctx.save();
    ctx.beginPath();
    ctx.rect(stagedOx, stagedOy, stagedW * zoom, stagedH * zoom);
    ctx.clip();
    renderWorldBackground(
      ctx,
      stagedRoom.room.worldNumber,
      virtualWidthPx,
      virtualHeightPx,
      stagedOx,
      stagedOy,
      stagedW,
      stagedH,
      zoom,
      stagedRoom.room.backgroundId,
    );
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, roomWidthWorld * zoom, roomHeightWorld * zoom);
    ctx.clip();
    renderWorldBackground(
      ctx,
      currentRoom.worldNumber,
      virtualWidthPx,
      virtualHeightPx,
      ox,
      oy,
      roomWidthWorld,
      roomHeightWorld,
      zoom,
      currentRoom.backgroundId,
    );
    ctx.restore();
  } else {
    renderWorldBackground(
      ctx,
      currentRoom.worldNumber,
      virtualWidthPx,
      virtualHeightPx,
      ox,
      oy,
      roomWidthWorld,
      roomHeightWorld,
      zoom,
      currentRoom.backgroundId,
    );
  }

  const roomCenterOffsetXPx = virtualWidthPx * 0.5 - roomWidthWorld * 0.5 * zoom;
  const roomCenterOffsetYPx = virtualHeightPx * 0.5 - roomHeightWorld * 0.5 * zoom;
  const relCameraOffsetXPx = ox - roomCenterOffsetXPx;
  const relCameraOffsetYPx = oy - roomCenterOffsetYPx;

  const renderedTheroBackground = renderTheroBackgroundEffect(
    ctx,
    currentRoom.backgroundId,
    virtualWidthPx,
    virtualHeightPx,
    nowMs,
    relCameraOffsetXPx,
    relCameraOffsetYPx,
  );
  if (!renderedTheroBackground && isTheroShowcaseRoom(currentRoom.id)) {
    renderTheroShowcaseEffect(
      ctx,
      currentRoom.id,
      virtualWidthPx,
      virtualHeightPx,
      nowMs,
      relCameraOffsetXPx,
      relCameraOffsetYPx,
    );
  }

  if (currentRoom.backgroundId === 'crystallineCracks') {
    renderCrystallineCracksBackground(
      ctx,
      virtualWidthPx,
      virtualHeightPx,
      nowMs,
      relCameraOffsetXPx,
      relCameraOffsetYPx,
    );
  }

  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_BACKGROUND);
}
