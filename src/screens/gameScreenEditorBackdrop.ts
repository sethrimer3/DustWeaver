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

  if (webglRenderer.isAvailable) {
    webglRenderer.render(snapshot, offsetXPx, offsetYPx, zoom);
  } else {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
  }

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
  renderWalls(ctx, snapshot, offsetXPx, offsetYPx, zoom, true);
  renderCustomBlockSprites(ctx, currentRoom, offsetXPx, offsetYPx, zoom);
  renderHazards(ctx, world, offsetXPx, offsetYPx, zoom, world.tick);
  renderClusters(ctx, snapshot, offsetXPx, offsetYPx, zoom, true);
  renderGrasshoppers(ctx, snapshot, offsetXPx, offsetYPx, zoom);
  renderRadiantTether(ctx, snapshot, offsetXPx, offsetYPx, zoom, true);
  renderRadiantWeb(ctx, snapshot, offsetXPx, offsetYPx, zoom, true);
  renderGrapple(ctx, snapshot, offsetXPx, offsetYPx, zoom);
  drawTunnelDarkness(ctx, currentRoom, offsetXPx, offsetYPx, zoom);
  environmentalDust.render(ctx, offsetXPx, offsetYPx, zoom, true);
  skillTombRenderer.render(ctx, offsetXPx, offsetYPx, zoom);
  skillTombEffectRenderer.renderBehind(ctx, offsetXPx, offsetYPx, zoom);
  skillTombEffectRenderer.renderSprite(ctx, offsetXPx, offsetYPx, zoom);
  skillTombEffectRenderer.renderFront(ctx, offsetXPx, offsetYPx, zoom);

  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, offsetXPx, offsetYPx, zoom);
  }

  editorController.render(ctx, offsetXPx, offsetYPx, zoom, virtualWidthPx, virtualHeightPx);

  resetCanvasPass(deviceCtx, canvas.width, canvas.height, false);
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
  renderHighResolutionDebugOverlay({
    deviceCtx,
    canvas,
    virtualCanvas,
    isDebugMode,
    world,
    currentRoom,
    hudState,
    renderProfiler,
  });
}
