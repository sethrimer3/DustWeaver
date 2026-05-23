/**
 * gameRender.ts — Rendering orchestration for the main game frame.
 *
 * Owns all canvas draw calls: background, world geometry, particles, HUD
 * overlays, device-canvas upscale, and touch-joystick visuals.
 *
 * No simulation state is mutated here — the function reads world/room state
 * and writes only to canvas contexts.  Health-bar display Maps are updated
 * in-place (passed by reference) as part of the HUD tracking logic.
 */

import type { WorldSnapshot } from '../render/snapshot';
import type { WorldState } from '../sim/world';
import { BLOCK_SIZE_SMALL, type RoomDef } from '../levels/roomDef';
import { renderWalls, renderClusters } from '../render/clusters/renderer';
import { renderGrapple } from '../render/clusters/grappleRenderer';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { renderRadiantWeb } from '../render/clusters/radiantWebRenderer';
import { renderHazards } from '../render/hazards';
import { renderParticles } from '../render/particles/renderer';
import { renderPixelLockedDust } from '../render/particles/pixelLockedDustRenderer';
import type { HudState } from '../render/hud/overlay';
import type { CombatTextSystem } from '../render/hud/combatText';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import { STAGE_WALLS, STAGE_ENTITIES, STAGE_PARTICLES, STAGE_DUST, STAGE_SUNBEAMS, STAGE_BLOOM, STAGE_HUD, STAGE_BG_BLOCKS, STAGE_DARK_BLOCKER, STAGE_UPSCALE } from '../render/hud/renderProfiler';
import type { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import type { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';
import type { WeakWallJumpDebrisRenderer } from '../render/weakWallJumpDebrisRenderer';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { PlayerCloak } from '../render/clusters/playerCloak';
import type { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { ArrowWeaveRenderer } from '../render/effects/arrowWeaveRenderer';
import type { SwordWeaveRenderer } from '../render/effects/swordWeaveRenderer';
import type { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import type { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import type { GuideDustPathRenderer } from '../render/effects/guideDustPathRenderer';
import type { FallingBlockDustRenderer } from '../render/fallingBlocks/fallingBlockRenderer';
import { renderFallingBlocks } from '../render/fallingBlocks/fallingBlockRenderer';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import {
  renderDecorationSprites,
  addDecorationBloom,
  DecorationWaveState,
} from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { renderRopes } from '../render/ropes/ropeRenderer';
import type { InputState } from '../input/handler';
import {
  drawTunnelDarkness,
  renderTransitionPassageGradients,
} from './gameRoom';
import { getReachableEdgeGlowOpacity, getInfluenceCircleOpacity, getInfluenceHighlightWidth } from '../ui/renderSettings';
import type { GraphicsQuality } from '../ui/renderSettings';
import { renderGrappleInfluenceVisuals } from '../render/grappleInfluenceRenderer';
import { renderDarkAmbientBlockerOverlay, getActiveProceduralMaterial, setRenderViewportSize, getChunkCacheStats } from '../render/walls/blockSpriteRenderer';
import { renderBackgroundBlocks, getBgChunkCacheStats } from '../render/walls/backgroundBlockRenderer';
import {
  drawGrappleBloom,
  drawParticleGlow,
  drawOffensiveDustOutlineOverlay,
} from './gameRenderHelpers';
import { renderGameHud } from './gameHudRenderer';
import { renderDarkRoomLighting } from './gameDarkRoomLighting';
import { applyRenderQualitySettings } from './gameRenderQuality';
import { renderBackgroundPass, type StagedRoomBgInfo } from './gameRenderBackgroundPass';
import { renderSceneLightingPass } from './gameRenderSceneLighting';
import { renderTeleportFlash } from '../render/lambdaAnchorRenderer';
import { getLiquidDebugStats } from '../render/liquidBodyCache';
import { renderRoomCollectibles } from './gameRenderCollectibles';
import { renderDeviceOverlay } from './gameRenderDeviceOverlay';
import { renderSnakes } from '../render/clusters/snakeRenderer';

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

// ── Public interface ───────────────────────────────────────────────────────

/** All data needed by `renderFrame` — avoids a 20+ positional parameter list. */
export interface RenderFrameContext {
  // Canvas contexts
  ctx: CanvasRenderingContext2D;
  deviceCtx: CanvasRenderingContext2D;
  virtualCanvas: HTMLCanvasElement;
  canvas: HTMLCanvasElement;

  // Renderer instances
  webglRenderer: WebGLParticleRenderer;
  environmentalDust: EnvironmentalDustLayer;
  skidDebris: SkidDebrisRenderer;
  crumbleDebris: CrumbleDebrisRenderer;
  /** Weak wall jump cascade debris — spawns on 3rd+ consecutive wall jump. */
  weakWallJumpDebris: WeakWallJumpDebrisRenderer;
  skillTombRenderer: SkillTombRenderer;
  skillTombEffectRenderer: SkillTombEffectRenderer;
  bloomSystem: BloomSystem;
  playerCloak: PlayerCloak;
  /** Phantasmal golden cloak extension — visible while the player is grappling. */
  phantomCloak: PhantomCloakExtension;
  darkRoomOverlay: DarkRoomOverlay;
  /** Arrow Weave renderer — bow crescent, dissipation, and arrow bodies. */
  arrowWeaveRenderer: ArrowWeaveRenderer;
  /** Shield Sword Weave renderer — golden-crossguard sword and slash trail. */
  swordWeaveRenderer: SwordWeaveRenderer;
  /** Pixel-art atmospheric sunbeam shafts. */
  sunbeamRenderer: SunbeamRenderer;
  /** Floating dust motes near local light sources. */
  atmosphericLightDust: AtmosphericLightDust;
  /** Golden mote particles traveling along editor-authored guide paths. */
  guideDustPathRenderer: GuideDustPathRenderer;
  /** Decoration sway state for push-wave animation driven by entity velocity. */
  decorationWaveState: DecorationWaveState;
  /** Falling block group dust + tile renderer. */
  fallingBlockDust: FallingBlockDustRenderer;

  // World / room
  world: WorldState;
  currentRoom: RoomDef;
  /**
   * Pre-computed snapshot updated once per frame via `updateSnapshotInPlace()`
   * before `renderFrame()` is called.  Allocation-free — reuses pooled objects.
   */
  snapshot: WorldSnapshot;
  /**
   * Room decorations built once per room load in `loadRoom()`.
   * Avoids allocating a new WallDecoration[] array every frame.
   */
  cachedDecorations: readonly WallDecoration[];
  /**
   * Pre-computed center X (world units) for each entry in `cachedDecorations`.
   * Index i corresponds to cachedDecorations[i].  Populated in `loadRoom()`.
   */
  cachedDecorationCenterX: Float32Array;
  /**
   * Pre-computed center Y (world units) for each entry in `cachedDecorations`.
   * Index i corresponds to cachedDecorations[i].  Populated in `loadRoom()`.
   */
  cachedDecorationCenterY: Float32Array;

  // Camera
  ox: number;
  oy: number;
  zoom: number;
  virtualWidthPx: number;
  virtualHeightPx: number;

  // Display state
  bgColor: string;
  isDebugMode: boolean;
  hudState: HudState;
  inputState: InputState;

  // Health-bar tracking (mutated in-place)
  prevHealthMap: Map<number, number>;
  healthBarDisplayUntilTick: Map<number, number>;

  // Combat text floaters
  combatText: CombatTextSystem;
  /**
   * Mutable box holding the last `world.lastPlayerBlockedTick` value seen by
   * the renderer.  Updated each frame so repeated ticks don't re-trigger the
   * same BLOCKED event.  Lives as a single-element object to allow mutation
   * through the interface.
   */
  prevLastPlayerBlockedTick: { value: number };

  // Collectibles
  collectedDustContainerKeySet: Set<string>;
  isDustContainerSpriteLoaded: boolean;
  dustContainerSprite: HTMLImageElement;
  isDustContainerShardSpriteLoaded: boolean;
  dustContainerShardSprite: HTMLImageElement;
  /** Keys for already-collected dust swarms (passed from gameScreen). */
  collectedDustSwarmKeySet: Set<string>;
  /** Index of the linked lambda anchor in currentRoom.lambdaAnchors, or -1 if not linked. */
  linkedAnchorIndex: number;
  /** Room ID of the room where the linked anchor lives, or '' if none. */
  linkedAnchorRoomId: string;
  /** Current alpha of the full-screen teleport flash (0 = none, 1 = full). */
  teleportFlashAlpha: number;
  /** Called by renderFrame to decay and update the teleport flash alpha. */
  setTeleportFlashAlpha: (a: number) => void;

  // Callbacks
  getPlayerDustCount: () => number;
  /** Number of dust containers the player owns (from progress.dustContainerCount).
   * Passed through to renderGameHud so the HUD shows owned container outlines. */
  playerContainerCount: number;
  /** Current speedrun timer value in milliseconds (0 = not started).
   * Passed to renderGameHud to display in the top-right HUD corner. */
  runTimerMs: number;

  // Graphics quality for this frame — drives quality-tier rendering decisions.
  graphicsQuality: GraphicsQuality;
  /**
   * When true, adaptive quality has triggered and rendering should use reduced
   * caps (lower dust mote count, fewer dynamic lights) to recover frame rate.
   * Set by the adaptive quality monitor in gameScreen.ts.
   */
  isAdaptiveReductionActive: boolean;
  /**
   * When true (tier 2), adaptive quality has entered deep reduction mode:
   * sunbeam rendering and bloom are also disabled in addition to tier-1 caps.
   * Set by the adaptive quality monitor in gameScreen.ts.
   */
  isDeepReductionActive: boolean;
  /** Render-stage profiler.  When provided, timings are recorded when debug is on. */
  renderProfiler?: RenderProfiler;
  /**
   * Fraction of a fixed tick elapsed since the last physics step.
   * Used to interpolate falling block tile positions between sim updates
   * (0 = just ticked, 1 = full tick elapsed with no physics step yet).
   */
  renderAlpha: number;
  /**
   * Per-group Y offsets captured immediately before the most recent physics
   * tick.  Indexed by fallingBlockGroups array position (capped at
   * MAX_FALLING_BLOCK_GROUPS = 64).  Used by renderFallingBlocks to blend
   * between the pre-tick and post-tick offsetYWorld values for smooth motion.
   */
  prevFallingBlockOffsetY: Float32Array;

  /**
   * BUILD 279/284 legacy: two-room crossing and staged-room clip rect.
   * These are always false/zero since ENABLE_TWO_ROOM_CAMERA_CROSSING is disabled.
   * Kept to avoid breaking the call sites; will be removed in a future pass.
   * @deprecated Use instant room transitions only (ENABLE_SIMPLE_ROOM_TRANSITIONS).
   */
  isCrossing: boolean;
  crossingUnionMinXWorld: number;
  crossingUnionMinYWorld: number;
  crossingUnionMaxXWorld: number;
  crossingUnionMaxYWorld: number;
  /**
   * When true, the camera is not clamped to room bounds — the player stays
   * centred on screen and areas outside the room render as black void.
   * In this mode the room clip rect is removed so out-of-room content is
   * visible without being cut off.
   */
  alwaysCenterCamera: boolean;

  /**
   * When a previous room is staged after a seamless crossing, provides the
   * minimal metadata needed to render its background layer clipped to its
   * screen-space rect.  Null when no staging is active (always null now).
   */
  stagedRoom: StagedRoomBgInfo | null;
}

/**
 * Render a single frame to the virtual canvas and upscale to the device
 * canvas.  Handles every rendering layer: world background, geometry,
 * particles, HUD, touch-joystick overlay.
 */
export function renderFrame(r: RenderFrameContext): void {
  const {
    ctx, deviceCtx, virtualCanvas, canvas,
    webglRenderer, environmentalDust, skidDebris, crumbleDebris, weakWallJumpDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
    playerCloak, phantomCloak, decorationWaveState, arrowWeaveRenderer, swordWeaveRenderer,
    sunbeamRenderer, atmosphericLightDust, guideDustPathRenderer, fallingBlockDust,
    world, currentRoom, snapshot,
    cachedDecorations, cachedDecorationCenterX, cachedDecorationCenterY,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, inputState,
    teleportFlashAlpha,
    setTeleportFlashAlpha,
    graphicsQuality,
    isAdaptiveReductionActive,
    isDeepReductionActive,
    renderProfiler,
  } = r;

  const nowMs = performance.now();

  const qc = applyRenderQualitySettings({
    graphicsQuality,
    isAdaptiveReductionActive,
    isDeepReductionActive,
    bloomSystem,
    sunbeamRenderer,
    atmosphericLightDust,
  });

  // Start the render profiler for this frame.
  if (renderProfiler !== undefined) renderProfiler.beginFrame(isDebugMode);

  const roomWidthWorld = currentRoom.widthBlocks * BLOCK_SIZE_SMALL;
  const roomHeightWorld = currentRoom.heightBlocks * BLOCK_SIZE_SMALL;
  const roomScreenXPx = ox;
  const roomScreenYPx = oy;
  const roomScreenWidthPx = roomWidthWorld * zoom;
  const roomScreenHeightPx = roomHeightWorld * zoom;
  // Keep sprite sampling nearest-neighbour even if context state changed.
  ctx.imageSmoothingEnabled = false;
  bloomSystem.beginFrame();

  // ── Clear / fill virtual canvas ─────────────────────────────────────────
  // Always start from black so anything outside the room remains pure black.
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, virtualWidthPx, virtualHeightPx);
  if (webglRenderer.isAvailable) {
    webglRenderer.render(snapshot, ox, oy, zoom);
  } else if (bgColor !== '#000000') {
    // Keep legacy room-local background tinting behavior when no WebGL layer
    // is active, while preserving black room margins via clipping below.
    ctx.fillStyle = bgColor;
    ctx.fillRect(roomScreenXPx, roomScreenYPx, roomScreenWidthPx, roomScreenHeightPx);
  }

  // ── Transition passage gradients (drawn BEFORE room clip) ────────────────
  // Fills transition opening passages with the authored fade gradient so the
  // black void in the passage is replaced by a proper depth-darkness effect.
  renderTransitionPassageGradients(ctx, currentRoom, ox, oy, zoom);

  // ── Clip rect: room bounds ────────────────────────────────────────────────
  // Always clip to the current room bounds (instant room transitions only).
  const clipXWorld = 0;
  const clipYWorld = 0;
  const clipWWorld = roomWidthWorld;
  const clipHWorld = roomHeightWorld;
  const clipScreenXPx = clipXWorld * zoom + ox;
  const clipScreenYPx = clipYWorld * zoom + oy;
  const clipScreenWPx = clipWWorld * zoom;
  const clipScreenHPx = clipHWorld * zoom;

  // Constrain all world-space rendering to the clip rect so out-of-bounds
  // areas remain black even when camera framing shows beyond room extents.
  // In always-center camera mode the clip is skipped — black void outside the
  // room is shown intentionally, so we must not cut off room content at edges.
  ctx.save();
  if (!r.alwaysCenterCamera) {
    ctx.beginPath();
    ctx.rect(clipScreenXPx, clipScreenYPx, clipScreenWPx, clipScreenHPx);
    ctx.clip();
  }

  // ── World background with parallax ──────────────────────────────────────
  renderBackgroundPass({
    ctx,
    currentRoom,
    stagedRoom: r.stagedRoom,
    ox,
    oy,
    zoom,
    virtualWidthPx,
    virtualHeightPx,
    roomWidthWorld,
    roomHeightWorld,
    nowMs,
    renderProfiler,
  });

  // ── Background blocks (visual-only, rendered behind sunbeams and walls) ───
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_BG_BLOCKS);
  renderBackgroundBlocks(ctx, currentRoom, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined) {
    renderProfiler.stageEnd(STAGE_BG_BLOCKS);
    if (isDebugMode) renderProfiler.updateBgChunkStats(getBgChunkCacheStats());
  }

  // ── Sunbeams (light shafts behind walls) ────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_SUNBEAMS);
  sunbeamRenderer.render(ctx, ox, oy, zoom, nowMs, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_SUNBEAMS);

  // ── Walls ────────────────────────────────────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_WALLS);
  // Inform the chunk cache of the current viewport dimensions so it can cull
  // invisible chunks correctly (virtualWidthPx can be > 480 on wider screens).
  setRenderViewportSize(virtualWidthPx, virtualHeightPx);
  // Walls before cluster indicators so clusters are drawn on top
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_DARK_BLOCKER);
  renderDarkAmbientBlockerOverlay(ctx, ox, oy, zoom, BLOCK_SIZE_SMALL, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_DARK_BLOCKER);
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRopes(ctx, snapshot, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined && isDebugMode) {
    renderProfiler.updateChunkStats(getChunkCacheStats());
  }

  const isDarkRoom = currentRoom.lightingEffect === 'DarkRoom';

  // ── Wall decorations (glowing moss & mushrooms) ──────────────────────────
  // Built once per room load (see `loadRoom()`) and passed in via `cachedDecorations`.
  // Update decoration wave state — apply entity-velocity pushes and advance spring.
  // dtSec is approximated as the fixed sim timestep (frame time is consistent at 60 fps).
  decorationWaveState.update(
    FIXED_DT_MS * 0.001,
    cachedDecorations,
    snapshot.clusters,
    cachedDecorationCenterX,
    cachedDecorationCenterY,
  );

  renderDecorationSprites(ctx, cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, decorationWaveState, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_WALLS);

  // ── Entities and grapple ─────────────────────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_ENTITIES);

  // Grapple influence visuals (golden circle + edge glow) drawn on top of walls
  // but behind clusters/particles so they don't obscure the action.
  renderGrappleInfluenceVisuals(
    ctx, snapshot, ox, oy, zoom,
    inputState.mouseXPx, inputState.mouseYPx,
    canvas.width, canvas.height,
    virtualWidthPx, virtualHeightPx,
    getReachableEdgeGlowOpacity(),
    getInfluenceCircleOpacity(),
    getInfluenceHighlightWidth(),
  );

  // Environmental hazards (water/lava zones behind, spikes/jars/fireflies on top)
  renderHazards(ctx, world, ox, oy, zoom, world.tick, virtualWidthPx, virtualHeightPx);
  if (renderProfiler !== undefined && isDebugMode) {
    renderProfiler.updateLiquidStats(getLiquidDebugStats());
  }

  renderClusters(ctx, snapshot, ox, oy, zoom, isDebugMode, playerCloak, phantomCloak, /* isDebugCloak */ isDebugMode);
  renderSnakes(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRadiantTether(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRadiantWeb(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderGrapple(ctx, snapshot, ox, oy, zoom, isDebugMode);

  // Arrow Weave — bow crescent, dissipation, and stuck/in-flight arrows
  arrowWeaveRenderer.render(ctx, snapshot, ox, oy, zoom);
  // Shield Sword Weave — golden-crossguard sword + slash trail (drawn on top
  // of the player so the crossguard reads against the body).
  swordWeaveRenderer.render(ctx, snapshot, ox, oy, zoom);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_ENTITIES);

  // ── Bloom glow pass (skipped entirely on low quality) ────────────────────
  if (qc.isBloomEnabled) {
    drawGrappleBloom(bloomSystem, snapshot, ox, oy, zoom);
    drawParticleGlow(bloomSystem, snapshot, ox, oy, zoom);
    // Decoration bloom — capped by quality tier and viewport-culled so only
    // visible decorations submit glow circles.
    addDecorationBloom(
      bloomSystem, cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, nowMs,
      qc.maxDecorationBloomCount, virtualWidthPx, virtualHeightPx,
    );
  }

  // Tunnel darkness overlays
  drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

  // (Preview bubble glow removed in BUILD 277 — the blue growing glow near
  //  transitions was visually distracting and is replaced by proper ambient-
  //  depth shading on edge and facing-edge tiles.)

  // ── Atmospheric effects (dust, debris) ──────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_DUST);
  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  atmosphericLightDust.render(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  guideDustPathRenderer.render(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  skidDebris.render(ctx, ox, oy, zoom);
  crumbleDebris.render(ctx, ox, oy, zoom);
  weakWallJumpDebris.render(ctx, ox, oy, zoom);
  // Falling block groups — tiles + dust effects
  if (world.fallingBlockGroups.length > 0) {
    renderFallingBlocks(ctx, world, ox, oy, zoom, r.world.dtMs, fallingBlockDust, isDebugMode, getActiveProceduralMaterial(), r.renderAlpha, r.prevFallingBlockOffsetY);
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_DUST);

  // Save tombs (sprite + swirling/falling dust particles)
  skillTombRenderer.render(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);

  // Skill tombs — background particles (behind sprite), sprite, then foreground particles
  skillTombEffectRenderer.renderBehind(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  skillTombEffectRenderer.renderSprite(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  skillTombEffectRenderer.renderFront(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);

  // ── Collectibles (dust containers, dust swarms, lambda anchors) ──────────
  renderRoomCollectibles(r, ctx, ox, oy, zoom, nowMs, virtualWidthPx, virtualHeightPx);

  // ── Particles ─────────────────────────────────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_PARTICLES);
  // When WebGL is available it handles Fluid background particles; all other
  // gameplay-relevant particles are drawn by renderPixelLockedDust() on the
  // virtual canvas so they appear crisp and pixel-locked before upscaling.
  // When WebGL is unavailable, renderParticles() handles Fluid (soft fallback)
  // and then also delegates to renderPixelLockedDust() internally.
  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, ox, oy, zoom);
  } else {
    // WebGL path: gameplay particles → pixel-locked Canvas 2D renderer.
    renderPixelLockedDust(ctx, snapshot, ox, oy, zoom);
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_PARTICLES);

  // ── Dark room overlay (applied last, inside the room clip) ───────────────
  // Covers the entire room with a near-opaque darkness layer, then "punches"
  // radial light holes at every light source so only illuminated areas show.
  // The bloom pass (composited later on the device canvas) adds atmospheric
  // glow on top of the darkness, making light sources feel warm and radiant.
  // Light collection and overlay rendering extracted to gameDarkRoomLighting.ts.
  if (isDarkRoom) {
    renderDarkRoomLighting(r, qc);
  }

  // ── Scene-light visibility-polygon lighting pass ─────────────────────────
  // Renders designer-placed scene lights (softGlow / spotlight / floodlight /
  // backlight / sunray) with optional raytraced shadow polygons.
  renderSceneLightingPass(ctx, currentRoom, ox, oy, zoom, virtualWidthPx, virtualHeightPx, nowMs);

  // End room clip before any HUD/screen-space overlays are drawn.
  ctx.restore();

  // ── HUD layers (debug overlay, health bar, dust display, enemy bars, combat text) ──
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_HUD);
  renderGameHud(r, nowMs);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_HUD);

  // ── Upscale virtual canvas to device canvas ────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_UPSCALE);
  deviceCtx.imageSmoothingEnabled = false;
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  // Composite WebGL particle canvas on top (also at virtual resolution)
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_UPSCALE);
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_BLOOM);
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_BLOOM);
  drawOffensiveDustOutlineOverlay(deviceCtx, snapshot, canvas.width, canvas.height, ox, oy, zoom);

  // ── Device-canvas overlays (touch joystick, debug control hints) ─────────
  renderDeviceOverlay(r);

  // ── Teleport flash overlay ───────────────────────────────────────────────
  // Golden flash when the player teleports back to a Lambda Anchor.
  // Rendered on the virtual canvas; decays over ~12 frames at 60 fps.
  if (teleportFlashAlpha > 0) {
    renderTeleportFlash(ctx, virtualWidthPx, virtualHeightPx, teleportFlashAlpha);
    setTeleportFlashAlpha(Math.max(0, teleportFlashAlpha - 1 / 12));
  }

  // Finalise the profiler — updates EMA-smoothed values used by next frame's overlay.
  if (renderProfiler !== undefined) renderProfiler.endFrame();
}
