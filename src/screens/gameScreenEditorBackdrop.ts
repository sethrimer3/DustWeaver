import type { WorldState } from '../sim/world';
import type { WorldSnapshot } from '../render/snapshot';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { renderWalls, renderClusters } from '../render/clusters/renderer';
import { renderCustomBlockSprites } from '../render/customBlockGameplayRenderer';
import { renderGrapple } from '../render/clusters/grappleRenderer';
import { renderHazards } from '../render/hazards';
import { renderParticles } from '../render/particles/renderer';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { BloomSystem } from '../render/effects/bloomSystem';
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { renderRadiantWeb } from '../render/clusters/radiantWebRenderer';
import { renderGrasshoppers } from '../render/critters/grasshopperRenderer';
import { drawTunnelDarkness } from './gameRoom';
import type { EditorController } from '../editor/editorController';
import type { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import type { HudState } from '../render/hud/overlay';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import { renderHighResolutionDebugOverlay } from './gameRenderDeviceOverlay';
import { resetCanvasPass } from '../render/canvasViewport';
import { buildEditorRenderMask } from '../editor/editorRenderMask';

/**
 * Renders gameplay scene as a static backdrop while world editor consumes input.
 */
export function renderEditorBackdrop(
  ctx: CanvasRenderingContext2D,
  deviceCtx: CanvasRenderingContext2D,
  virtualCanvas: HTMLCanvasElement,
  canvas: HTMLCanvasElement,
  webglRenderer: WebGLParticleRenderer,
  bloomSystem: BloomSystem,
  world: WorldState,
  snapshot: WorldSnapshot,
  currentRoom: RoomDef,
  backgroundColor: string,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  environmentalDust: EnvironmentalDustLayer,
  skillTombRenderer: SkillTombRenderer,
  skillTombEffectRenderer: SkillTombEffectRenderer,
  editorController: EditorController,
  hudState: HudState,
  renderProfiler: RenderProfiler,
  isDebugMode: boolean,
): void {
  resetCanvasPass(ctx, virtualCanvas.width, virtualCanvas.height, false);
  bloomSystem.beginFrame();

  const layerState = editorController.state;
  const mask = buildEditorRenderMask(layerState);

  if (webglRenderer.isAvailable) {
    webglRenderer.render(snapshot, offsetXPx, offsetYPx, zoom, mask);
  } else {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
  }

  const backgroundVisible = mask.isLayerVisible('background');
  const terrainVisible = mask.isLayerVisible('terrain');
  const hazardsVisible = mask.isLayerVisible('hazards');
  const enemiesVisible = mask.isLayerVisible('enemies');
  const powderVisible = mask.isLayerVisible('powder');
  const objectsVisible = mask.isLayerVisible('objects');
  const dynamicGeometryVisible = mask.isLayerVisible('dynamicGeometry');
  // Editor's hitbox/wall-outline diagnostic overlays (previously hardcoded
  // `true` below) are diagnostic visualizations, so they follow the Debug
  // layer rather than the global runtime debug-mode flag.
  const debugVisible = mask.isLayerVisible('debug');

  if (backgroundVisible) {
    renderWorldBackground(
      ctx,
      currentRoom.worldNumber,
      virtualWidthPx,
      virtualHeightPx,
      offsetXPx,
      offsetYPx,
      currentRoom.widthBlocks * BLOCK_SIZE_SMALL,
      currentRoom.heightBlocks * BLOCK_SIZE_SMALL,
      zoom,
      currentRoom.backgroundId,
    );
    if (isTheroShowcaseRoom(currentRoom.id)) {
      renderTheroShowcaseEffect(ctx, currentRoom.id, virtualWidthPx, virtualHeightPx, performance.now());
    }
    const renderedTheroBackground = renderTheroBackgroundEffect(
      ctx,
      currentRoom.backgroundId,
      virtualWidthPx,
      virtualHeightPx,
      performance.now(),
    );
    if (!renderedTheroBackground && currentRoom.backgroundId === 'crystallineCracks') {
      renderCrystallineCracksBackground(ctx, virtualWidthPx, virtualHeightPx, performance.now());
    }
  }
  if (terrainVisible) {
    renderWalls(ctx, snapshot, offsetXPx, offsetYPx, zoom, debugVisible);
    renderCustomBlockSprites(ctx, currentRoom, offsetXPx, offsetYPx, zoom);
  }
  if (hazardsVisible) {
    renderHazards(ctx, world, offsetXPx, offsetYPx, zoom, world.tick);
  }
  // renderClusters draws exactly two families: the player (always-visible —
  // see renderClusters' own doc comment) and enemy AI entities, gated by the
  // Enemies layer via the mask param. showHitboxes follows the Debug layer.
  renderClusters(ctx, snapshot, offsetXPx, offsetYPx, zoom, debugVisible, undefined, undefined, false, undefined, 'med', mask);
  if (enemiesVisible) {
    renderGrasshoppers(ctx, snapshot, offsetXPx, offsetYPx, zoom);
  }
  if (dynamicGeometryVisible) {
    // Pre-existing Phase 1/2 classification: Radiant Tether/Web are boss
    // enemies but were grouped here under Dynamic Geometry alongside the
    // grapple mechanic when this block was first authored. Not reclassified
    // by Phase 4 — out of scope to avoid an unrelated behavior change.
    renderRadiantTether(ctx, snapshot, offsetXPx, offsetYPx, zoom, debugVisible);
    renderRadiantWeb(ctx, snapshot, offsetXPx, offsetYPx, zoom, debugVisible);
    renderGrapple(ctx, snapshot, offsetXPx, offsetYPx, zoom);
  }
  // Tunnel darkness is gated by the Lighting layer (see drawTunnelDarkness).
  drawTunnelDarkness(ctx, currentRoom, offsetXPx, offsetYPx, zoom, mask);
  if (powderVisible) {
    environmentalDust.render(ctx, offsetXPx, offsetYPx, zoom, true);
  }
  if (objectsVisible) {
    skillTombRenderer.render(ctx, offsetXPx, offsetYPx, zoom);
    skillTombEffectRenderer.renderBehind(ctx, offsetXPx, offsetYPx, zoom);
    skillTombEffectRenderer.renderSprite(ctx, offsetXPx, offsetYPx, zoom);
    skillTombEffectRenderer.renderFront(ctx, offsetXPx, offsetYPx, zoom);
  }

  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, offsetXPx, offsetYPx, zoom, mask);
  }

  editorController.render(ctx, offsetXPx, offsetYPx, zoom, virtualWidthPx, virtualHeightPx);

  resetCanvasPass(deviceCtx, canvas.width, canvas.height, false);
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
  // Gated by the Debug layer (see renderHighResolutionDebugOverlay).
  renderHighResolutionDebugOverlay({
    deviceCtx,
    canvas,
    virtualCanvas,
    isDebugMode,
    world,
    currentRoom,
    hudState,
    renderProfiler,
    mask,
  });
}
