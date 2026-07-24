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
  drawPixelGrid,
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
  drawEditorTimeStopFields,
  drawEditorCrumbleBlocks,
  drawEditorSpikes,
  drawEditorBouncePads,
  drawEditorKineticBlocks,
  drawEditorGrappleCarryBlocks,
  drawEditorZipMoveBlocks,
  drawEditorPhantasmalTiles,
  drawEditorPixelMaterials,
  drawEditorEnvironmentItems,
  drawEditorRopes,
  drawEditorDialogueTriggers,
  drawEditorBackgroundBlocks,
  drawEditorGuideDustPaths,
  drawEditorCustomBlocks,
} from './editorOverlayDrawers';
import {
  drawPlacementPreview,
  drawEditorUIOverlays,
} from './editorPlacementPreviewDrawer';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { getLayerForElementType } from './editorLayers';
import type { SelectedElementType } from './editorElementTypes';
import { buildEditorRenderMask } from './editorRenderMask';

/**
 * Renders all editor overlays on the 2D canvas.
 *
 * @param edgeExtensionCache  Optional pre-built edge extension cache.  When
 *   provided, extension tiles are drawn with a semi-transparent blue tint
 *   (30 % opacity) so they read as non-editable structural extensions.
 */
export function renderEditorOverlays(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
  edgeExtensionCache?: EdgeExtensionCache | null,
): void {
  const room = state.roomData;
  if (room === null) return;

  ctx.save();

  // ── Edge extension ghost tiles ────────────────────────────────────────────
  // Drawn before all other overlays so grid / wall borders sit on top.
  if (edgeExtensionCache !== null && edgeExtensionCache !== undefined) {
    const tileSizePx = BLOCK_SIZE_SMALL * zoom;
    const tiles = edgeExtensionCache.tiles;
    ctx.fillStyle = 'rgba(60,120,255,0.30)';
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!tile.isSolid) continue;
      const sx = Math.round(tile.colBlock * tileSizePx + offsetXPx);
      const sy = Math.round(tile.rowBlock * tileSizePx + offsetYPx);
      // Viewport cull
      if (sx + tileSizePx < 0 || sx > canvasWidth)  continue;
      if (sy + tileSizePx < 0 || sy > canvasHeight) continue;
      ctx.fillRect(sx, sy, Math.ceil(tileSizePx), Math.ceil(tileSizePx));
    }
  }

  const isElementSelected = (type: string, uid: number): boolean =>
    state.selectedElements.some(e => e.type === type && e.uid === uid);

  // Mask derived once from EditorState and passed down — no scattered direct
  // isLayerVisible(state, ...) calls below (or in editorPlacementPreviewDrawer.ts).
  const mask = buildEditorRenderMask(state);

  // Per-element-type visibility gate driven by the editor layer panel. Most
  // drawEditor* functions below cover a single layer's worth of content and
  // are gated with a single `layerOn(...)` check; a few (spawn/tombs,
  // collectibles, critter areas) mix several layers and are always called,
  // filtering per-item internally via `isTypeVisible`.
  const layerOn = (type: SelectedElementType): boolean => mask.isLayerVisible(getLayerForElementType(type));
  const isTypeVisible = (type: SelectedElementType): boolean => layerOn(type);

  // ── Grid ─────────────────────────────────────────────────────────────────
  drawGrid(ctx, room, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);

  if (layerOn('backgroundBlock')) drawEditorBackgroundBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('wall')) drawEditorWalls(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('enemy')) drawEditorEnemies(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('transition')) drawEditorTransitions(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawEditorSpawnAndTombs(ctx, room, state, isElementSelected, isTypeVisible, offsetXPx, offsetYPx, zoom);
  drawEditorCollectibles(ctx, room, state, isElementSelected, isTypeVisible, offsetXPx, offsetYPx, zoom);
  drawEditorCritterAreas(ctx, room, isElementSelected, isTypeVisible, offsetXPx, offsetYPx, zoom);
  if (layerOn('lightSource')) drawEditorLightingOverlays(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('waterZone')) drawEditorLiquidZones(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('timeStopField')) drawEditorTimeStopFields(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('crumbleBlock')) drawEditorCrumbleBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('spike')) drawEditorSpikes(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('bouncePad')) drawEditorBouncePads(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('kineticBlock')) drawEditorKineticBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('phantasmalTile')) drawEditorPhantasmalTiles(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('grappleCarryBlock')) drawEditorGrappleCarryBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('zipMoveBlock')) drawEditorZipMoveBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('pixelMaterial')) drawEditorPixelMaterials(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (state.activeTool === EditorTool.Place && state.selectedPaletteItem?.isPixelMaterialItem === 1) {
    drawPixelGrid(ctx, room, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);
  }
  drawEditorEnvironmentItems(ctx, room, isElementSelected, isTypeVisible, offsetXPx, offsetYPx, zoom);
  if (layerOn('rope')) drawEditorRopes(ctx, room, state, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('dialogueTrigger')) drawEditorDialogueTriggers(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  if (layerOn('guideDustPath')) drawEditorGuideDustPaths(ctx, room, state, offsetXPx, offsetYPx, zoom);
  if (layerOn('customBlock')) drawEditorCustomBlocks(ctx, room, isElementSelected, offsetXPx, offsetYPx, zoom);
  drawPlacementPreview(ctx, room, state, offsetXPx, offsetYPx, zoom);
  drawEditorUIOverlays(ctx, room, state, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight, mask);

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
      (state.selectedPaletteItem.category === 'blocks' || state.selectedPaletteItem.category === 'specialBlocks')) {
    const rampLabels = ['/', '\\', '⌐', '¬'];
    const item = state.selectedPaletteItem;
    let rotHint: string;
    if (item.isStairsItem === 1) {
      const base = state.placementRotationSteps % 4;
      const ori = state.placementFlipH ? (base ^ 1) : base;
      rotHint = `Stairs:${rampLabels[ori]}`;
    } else if (item.isRampItem === 1) {
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
