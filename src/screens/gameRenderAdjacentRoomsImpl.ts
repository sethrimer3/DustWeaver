/**
 * gameRenderAdjacentRoomsImpl.ts — Production binding of the adjacent-room draw
 * primitives.
 *
 * Separated from the orchestration (`gameRenderAdjacentRooms.ts`) so that module
 * stays free of renderer/canvas imports and remains Node-testable. This file
 * pulls in the non-destructive per-room chunk-draw functions and adapts them to
 * the injected `AdjacentRoomDrawImpl` shape (building each room's
 * WallPrewarmContext from the canonical derivation).
 */

import { drawRoomWallChunksAt } from '../render/walls/blockSpriteRenderer';
import { drawRoomBgChunksAt } from '../render/walls/backgroundBlockRenderer';
import { makeWallPrewarmCtx } from '../render/walls/roomRenderState';
import type { AdjacentRoomDrawImpl } from './gameRenderAdjacentRooms';

/** The real, canvas-drawing adjacent-room implementation. */
export const productionAdjacentRoomDrawImpl: AdjacentRoomDrawImpl = {
  drawBg: (ctx, room, zoom, offXPx, offYPx, clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, maxChunks) => {
    drawRoomBgChunksAt(ctx, room, zoom, offXPx, offYPx, clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, maxChunks);
  },
  drawWall: (ctx, roomId, room, wallSnapshot, offXPx, offYPx, clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, zoom, blockSizePx, maxChunks) => {
    // blockerKeys omitted for the first implementation — neighbour ambient-light
    // blockers are not reproduced (documented limitation); geometry/theme/light
    // come from the canonical room render-state derivation.
    const pctx = makeWallPrewarmCtx(room, wallSnapshot, undefined);
    drawRoomWallChunksAt(ctx, roomId, pctx, offXPx, offYPx, clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, zoom, blockSizePx, maxChunks);
  },
};
