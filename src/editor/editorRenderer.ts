/**
 * Editor renderer — draws overlays for grid, placement preview,
 * selection highlights, transition zones, enemy markers, and
 * other editor visual feedback on the 2D canvas.
 *
 * Element-group draw functions live in editorOverlayDrawers.ts.
 */

import type { EditorState } from './editorState';
import { EditorTool } from './editorState';
import {
  drawGrid,
} from './editorRendererHelpers';
import {
  drawEditorWalls,
  drawEditorEnemies,
  drawEditorTransitions,
  drawEditorSpawnAndTombs,
  drawEditorCollectibles,
  drawEditorCritterAreas,
  drawEditorLightingOverlays,
  drawEditorLiquidZones,
  drawEditorCrumbleBlocks,
  drawEditorBouncePads,
  drawEditorEnvironmentItems,
  drawEditorRopes,
  drawEditorDialogueTriggers,
} from './editorOverlayDrawers';
import {
  drawPlacementPreview,
  drawEditorUIOverlays,
} from './editorPlacementPreviewDrawer';

/**
 * Renders all editor overlays on the 2D canvas.
 */
export function renderEditorOverlays(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const room = state.roomData;
  if (room === null) return;

  ctx.save();

  const isElementSelected = (type: string, uid: number): boolean =>
    state.selectedElements.some(e => e.type === type && e.uid === uid);

  // ── Grid ─────────────────────────────────────────────────────────────────
  drawGrid(ctx, room, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);

  drawEditorWalls(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorEnemies(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorTransitions(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorSpawnAndTombs(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorCollectibles(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorCritterAreas(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorLightingOverlays(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorLiquidZones(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorCrumbleBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorBouncePads(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorEnvironmentItems(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorRopes(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorDialogueTriggers(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawPlacementPreview(ctx, room, state, offsetXPx, offsetYPx, zoom);
  drawEditorUIOverlays(ctx, room, state, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);

  ctx.restore();
}

/**
 * Draws the "WORLD EDITOR ON" indicator at the top of the screen.
 */
export function renderEditorIndicator(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  state?: EditorState,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,200,100,0.85)';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORLD EDITOR ON', canvasWidth / 2, 6);

  // Show rotation / flip state when Place tool is active and a block item is selected
  if (state !== null && state !== undefined &&
      state.activeTool === EditorTool.Place &&
      state.selectedPaletteItem !== null &&
      state.selectedPaletteItem.category === 'blocks') {
    const rampLabels = ['/', '\\', '⌐', '¬'];
    const item = state.selectedPaletteItem;
    let rotHint: string;
    if (item.isRampItem === 1) {
      const base = state.placementRotationSteps % 4;
      const ori = state.placementFlipH ? (base ^ 1) : base;
      rotHint = `Ramp:${rampLabels[ori]}`;
    } else if (item.isPlatformItem === 1) {
      const platformEdgeMap: readonly string[] = ['↑top', '→rgt', '↓btm', '←lft'];
      rotHint = `Plat:${platformEdgeMap[state.placementRotationSteps % 4]}`;
    } else {
      rotHint = `R${state.placementRotationSteps}`;
    }
    const flipHint = state.placementFlipH ? ' [F]' : '';
    ctx.fillStyle = 'rgba(200,255,200,0.75)';
    ctx.font = '7px monospace';
    ctx.fillText(`${rotHint}${flipHint}  [scroll]=rotate  [F]=flip`, canvasWidth / 2, 16);
  }
  ctx.restore();
}
