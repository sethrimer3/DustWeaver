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
import { RoomDef, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { ParticleKind } from '../sim/particles/kinds';
import { renderWorldBackground } from '../render/backgroundRenderer';
import { renderWalls, renderClusters } from '../render/clusters/renderer';
import { renderGrapple } from '../render/clusters/grappleRenderer';
import { renderRadiantTether } from '../render/clusters/radiantTetherRenderer';
import { renderHazards } from '../render/hazards';
import { renderParticles } from '../render/particles/renderer';
import type { HudState } from '../render/hud/overlay';
import type { CombatTextSystem } from '../render/hud/combatText';
import type { RenderProfiler } from '../render/hud/renderProfiler';
import { STAGE_BACKGROUND, STAGE_WALLS, STAGE_ENTITIES, STAGE_PARTICLES, STAGE_DUST, STAGE_SUNBEAMS, STAGE_BLOOM, STAGE_LIGHTING, STAGE_HUD } from '../render/hud/renderProfiler';
import type { WebGLParticleRenderer } from '../render/particles/webglRenderer';
import type { EnvironmentalDustLayer } from '../render/environmentalDust';
import type { SkidDebrisRenderer } from '../render/skidDebrisRenderer';
import type { CrumbleDebrisRenderer } from '../render/crumbleDebrisRenderer';
import type { SkillTombRenderer } from '../render/skillTombRenderer';
import type { SkillTombEffectRenderer } from '../render/skillTombEffectRenderer';
import type { PlayerCloak } from '../render/clusters/playerCloak';
import type { PhantomCloakExtension } from '../render/clusters/phantomCloak';
import type { ArrowWeaveRenderer } from '../render/effects/arrowWeaveRenderer';
import type { SwordWeaveRenderer } from '../render/effects/swordWeaveRenderer';
import type { SunbeamRenderer } from '../render/effects/sunbeamRenderer';
import type { AtmosphericLightDust } from '../render/effects/atmosphericLightDust';
import type { FallingBlockDustRenderer } from '../render/fallingBlocks/fallingBlockRenderer';
import { renderFallingBlocks } from '../render/fallingBlocks/fallingBlockRenderer';
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { DarkRoomOverlay, LightSourcePx } from '../render/effects/darkRoomOverlay';
import { buildPlayerShadowOccluders, type ShadowCasterOccluderPx } from '../render/effects/shadowCaster';
import {
  renderDecorationSprites,
  addDecorationBloom,
  collectDecorationLights,
  DecorationWaveState,
} from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import { renderRopes } from '../render/ropes/ropeRenderer';
import type { InputState } from '../input/handler';
import { JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import {
  drawTunnelDarkness,
  DUST_CONTAINER_SIZE_WORLD,
} from './gameRoom';
import { getReachableEdgeGlowOpacity, getInfluenceCircleOpacity, getInfluenceHighlightWidth } from '../ui/renderSettings';
import type { GraphicsQuality } from '../ui/renderSettings';
import { getQualityConfig } from '../render/renderQualityConfig';
import { renderGrappleInfluenceVisuals } from '../render/grappleInfluenceRenderer';
import { renderDarkAmbientBlockerOverlay, getActiveProceduralMaterial, setRenderViewportSize, getChunkCacheStats } from '../render/walls/blockSpriteRenderer';
import {
  drawGrappleBloom,
  drawParticleGlow,
  drawOffensiveDustOutlineOverlay,
} from './gameRenderHelpers';
import { renderGameHud } from './gameHudRenderer';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { renderEdgeExtension } from '../render/transitions/edgeExtensionRenderer';
import type { PreviewBubbleState } from '../render/transitions/previewBubbleState';
import { renderPreviewBubbles } from '../render/transitions/previewBubbleRenderer';
import { renderLambdaAnchors, renderTeleportFlash } from '../render/lambdaAnchorRenderer';
import { getLiquidDebugStats } from '../render/liquidBodyCache';

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

/** Touch joystick outer radius matches the max drag radius from handler.ts. */
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// ── Module-level scratch buffers (allocation-free hot path) ────────────────
// These arrays are allocated once and reused every frame to collect light
// sources and shadow occluders for the DarkRoom overlay.  Using stable module-
// level arrays avoids the per-frame cost of allocating new arrays and the GC
// pressure from discarding them.

/**
 * Pre-allocated scratch array for DarkRoom light sources.
 * Filled each frame by collectDecorationLights() plus inline additions for the
 * player, particle lights, authored lights, and preview bubbles.
 * Sized for the maximum possible lights per frame.
 */
const _scratchLights: LightSourcePx[] = [];

/**
 * Pre-allocated scratch array for shadow occluder polygons.
 * Cleared and filled by buildPlayerShadowOccluders() each frame.
 */
const _scratchShadows: ShadowCasterOccluderPx[] = [];

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

  // Graphics quality for this frame — drives quality-tier rendering decisions.
  graphicsQuality: GraphicsQuality;
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
   * Room transition fade overlay alpha (0 = transparent, 1 = fully opaque black).
   * When non-zero a full-screen black rectangle is composited on the device
   * canvas after all game content, WebGL particles, and bloom — so it covers
   * everything.  Driven by the fade-out/in state machine in gameScreen.ts.
   */
  transitionFadeAlpha: number;

  /**
   * Cached edge extension tile data for the current room.
   * Built once per loadRoom() call; null before the first room is loaded.
   * Passed to renderEdgeExtension() to draw wall tiles beyond the room boundary.
   */
  edgeExtensionCache: EdgeExtensionCache | null;

  /**
   * Pre-allocated array of PreviewBubbleState entries.
   * Written by computePreviewBubbles() in gameScreen.ts each frame.
   * Only entries [0, previewBubbleCount) are valid for this frame.
   */
  previewBubbles: PreviewBubbleState[];

  /**
   * Number of valid entries in previewBubbles for this frame (0 = none active).
   */
  previewBubbleCount: number;
}

/**
 * Returns a CSS colour string for a given dust kind name.
 * Used to tint dust swarm particles cosmetically.
 */
function getDustKindColor(dustKind: string): string {
  switch (dustKind) {
    case 'Fire':      return '#ff6020';
    case 'Ice':       return '#60c8ff';
    case 'Lightning': return '#ffe040';
    case 'Poison':    return '#60ff40';
    case 'Arcane':    return '#c060ff';
    case 'Wind':      return '#c0f0ff';
    case 'Holy':      return '#ffffa0';
    case 'Shadow':    return '#8040a0';
    case 'Metal':     return '#b0b8c8';
    case 'Earth':     return '#a07040';
    case 'Nature':    return '#40c840';
    case 'Crystal':   return '#80ffe0';
    case 'Void':      return '#4020a0';
    case 'Water':     return '#2080ff';
    case 'Lava':      return '#ff4010';
    case 'Stone':     return '#909090';
    default:          return '#d0c080'; // Physical / unknown
  }
}

/**
 * Render a single frame to the virtual canvas and upscale to the device
 * canvas.  Handles every rendering layer: world background, geometry,
 * particles, HUD, touch-joystick overlay.
 */
export function renderFrame(r: RenderFrameContext): void {
  const {
    ctx, deviceCtx, virtualCanvas, canvas,
    webglRenderer, environmentalDust, skidDebris, crumbleDebris, skillTombRenderer, skillTombEffectRenderer, bloomSystem,
    playerCloak, phantomCloak, darkRoomOverlay, decorationWaveState, arrowWeaveRenderer, swordWeaveRenderer,
    sunbeamRenderer, atmosphericLightDust, fallingBlockDust,
    world, currentRoom, snapshot,
    cachedDecorations, cachedDecorationCenterX, cachedDecorationCenterY,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, inputState,
    collectedDustContainerKeySet,
    isDustContainerSpriteLoaded,
    dustContainerSprite,
    collectedDustSwarmKeySet,
    linkedAnchorIndex,
    linkedAnchorRoomId,
    teleportFlashAlpha,
    setTeleportFlashAlpha,
    graphicsQuality,
    renderProfiler,
  } = r;

  const nowMs = performance.now();

  // ── Quality tier config ────────────────────────────────────────────────────
  // Derive all rendering cost parameters from the current quality tier.  This
  // object is a small immutable constant reference — no allocation per frame.
  const qc = getQualityConfig(graphicsQuality);

  // Apply quality-dependent bloom parameters.  Mutates the BloomSystem's
  // internal config object in place — no resize needed since glowTargetScale
  // is left unchanged (all tiers share the same 0.5× downscale canvas).
  bloomSystem.setQualityParams(qc.isBloomEnabled, qc.bloomIntensity, qc.bloomBlurRadiusPx);

  // Propagate sunbeam enable/disable to the renderer.
  sunbeamRenderer.setEnabled(qc.isSunbeamEnabled);

  // Propagate mote cap to the atmospheric dust system.
  atmosphericLightDust.setMaxMotes(qc.maxDustMoteCount);

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

  // ── Edge extension layer (drawn BEFORE room clip) ────────────────────────
  // Renders procedural wall tiles 6 blocks beyond every room edge so the
  // void outside the room appears as a continuation of the boundary walls
  // rather than a hard black cutout.  The tiles have no collision.
  // Must be called here (before ctx.clip()) so tiles outside the room rect
  // are visible.
  if (r.edgeExtensionCache !== null) {
    renderEdgeExtension(
      ctx,
      r.edgeExtensionCache,
      ox,
      oy,
      zoom,
      virtualWidthPx,
      virtualHeightPx,
      bgColor,
      currentRoom.lightingEffect ?? 'Ambient',
    );
  }

  // Constrain all world-space rendering to the room rectangle so out-of-room
  // areas remain black even when camera framing shows beyond room extents.
  ctx.save();
  ctx.beginPath();
  ctx.rect(roomScreenXPx, roomScreenYPx, roomScreenWidthPx, roomScreenHeightPx);
  ctx.clip();

  // ── World background with parallax ──────────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_BACKGROUND);
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

  // Relative camera offset (from room centre) used for procedural background parallax.
  // When the camera is centred on the room this is 0; it grows as the camera pans.
  const roomCenterOffsetXPx = virtualWidthPx * 0.5 - (roomWidthWorld * 0.5 * zoom);
  const roomCenterOffsetYPx = virtualHeightPx * 0.5 - (roomHeightWorld * 0.5 * zoom);
  const relCameraOffsetXPx = ox - roomCenterOffsetXPx;
  const relCameraOffsetYPx = oy - roomCenterOffsetYPx;

  // ── Thero effect procedural overlays ─────────────────────────────────────
  const renderedTheroBackground = renderTheroBackgroundEffect(
    ctx,
    currentRoom.backgroundId,
    virtualWidthPx,
    virtualHeightPx,
    nowMs,
    relCameraOffsetXPx,
    relCameraOffsetYPx,
  );
  // Legacy showcase rooms still use room-id dispatch when no explicit
  // thero_* background override is present.
  if (!renderedTheroBackground && isTheroShowcaseRoom(currentRoom.id)) {
    renderTheroShowcaseEffect(
      ctx, currentRoom.id, virtualWidthPx, virtualHeightPx, nowMs,
      relCameraOffsetXPx, relCameraOffsetYPx,
    );
  }

  // ── Crystalline Cracks procedural background effect ──────────────────────
  if (currentRoom.backgroundId === 'crystallineCracks') {
    renderCrystallineCracksBackground(
      ctx, virtualWidthPx, virtualHeightPx, nowMs,
      relCameraOffsetXPx, relCameraOffsetYPx,
    );
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_BACKGROUND);

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
  renderDarkAmbientBlockerOverlay(ctx, ox, oy, zoom, BLOCK_SIZE_SMALL);
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRopes(ctx, snapshot, ox, oy, zoom);
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

  renderDecorationSprites(ctx, cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, decorationWaveState);
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
  renderHazards(ctx, world, ox, oy, zoom, world.tick);
  if (renderProfiler !== undefined && isDebugMode) {
    renderProfiler.updateLiquidStats(getLiquidDebugStats());
  }

  renderClusters(ctx, snapshot, ox, oy, zoom, isDebugMode, playerCloak, phantomCloak, /* isDebugCloak */ isDebugMode);
  renderRadiantTether(ctx, snapshot, ox, oy, zoom, isDebugMode);
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

  // ── Nearby-transition preview bubbles ────────────────────────────────────
  // Glowing aperture cues rendered at each nearby room transition.  The
  // bubble grows and brightens as the player approaches the opening.
  // Drawn on top of tunnel darkness but below HUD elements so the glow
  // integrates naturally with the room edge.
  if (r.previewBubbleCount > 0) {
    renderPreviewBubbles(ctx, r.previewBubbles, r.previewBubbleCount);
  }

  // ── Atmospheric effects (dust, debris) ──────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_DUST);
  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  atmosphericLightDust.render(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  skidDebris.render(ctx, ox, oy, zoom);
  crumbleDebris.render(ctx, ox, oy, zoom);
  // Falling block groups — tiles + dust effects
  if (world.fallingBlockGroups.length > 0) {
    renderFallingBlocks(ctx, world, ox, oy, zoom, r.world.dtMs, fallingBlockDust, isDebugMode, getActiveProceduralMaterial(), r.renderAlpha, r.prevFallingBlockOffsetY);
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_DUST);

  // Save tombs (sprite + swirling/falling dust particles)
  skillTombRenderer.render(ctx, ox, oy, zoom);

  // Skill tombs — background particles (behind sprite), sprite, then foreground particles
  skillTombEffectRenderer.renderBehind(ctx, ox, oy, zoom);
  skillTombEffectRenderer.renderSprite(ctx, ox, oy, zoom);
  skillTombEffectRenderer.renderFront(ctx, ox, oy, zoom);

  // Dust containers (collectibles)
  if (isDustContainerSpriteLoaded) {
    const roomDustContainers = currentRoom.dustContainers ?? [];
    const bobOffsetWorld = Math.sin(nowMs * 0.0032) * 1.5;
    for (let i = 0; i < roomDustContainers.length; i++) {
      const pickupKey = `${currentRoom.id}:${i}`;
      if (collectedDustContainerKeySet.has(pickupKey)) continue;

      const dc = roomDustContainers[i];
      const dx = (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const dy = (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM + bobOffsetWorld;
      const drawSize = DUST_CONTAINER_SIZE_WORLD * zoom;
      ctx.drawImage(
        dustContainerSprite,
        dx * zoom + ox - drawSize * 0.5,
        dy * zoom + oy - drawSize * 0.5,
        drawSize,
        drawSize,
      );
    }
  }

  // Dust swarms (collectibles — press F to collect)
  {
    const roomDustSwarms = currentRoom.dustSwarms ?? [];
    const t = nowMs * 0.001;
    ctx.save();
    for (let i = 0; i < roomDustSwarms.length; i++) {
      const swarmKey = `${currentRoom.id}:dustswarm:${i}`;
      if (collectedDustSwarmKeySet.has(swarmKey)) continue;
      const sw = roomDustSwarms[i];
      const cx = (sw.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      const cy = (sw.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
      // Draw a swirling cluster of ~12 small dots using deterministic time/index math.
      const particleCount = 12;
      for (let p = 0; p < particleCount; p++) {
        const angle = (p / particleCount) * Math.PI * 2 + t * (1.4 + (p % 3) * 0.3);
        const wobble = Math.sin(t * 2.0 + p * 1.1) * 0.5;
        const radius = (3.5 + (p % 4) * 1.2 + wobble) * BLOCK_SIZE_MEDIUM * 0.12;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius * 0.6 + Math.sin(t * 1.7 + p) * 1.0;
        const alpha = 0.55 + Math.sin(t * 2.5 + p * 0.9) * 0.25;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = getDustKindColor(sw.dustKind);
        const size = (1.2 + (p % 3) * 0.4) * zoom;
        ctx.fillRect(
          Math.round((px * zoom + ox) - size * 0.5),
          Math.round((py * zoom + oy) - size * 0.5),
          Math.ceil(size), Math.ceil(size),
        );
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Lambda Anchors (recall points — press F to link, press F again to teleport)
  renderLambdaAnchors(
    ctx,
    currentRoom.lambdaAnchors ?? [],
    linkedAnchorRoomId === currentRoom.id ? linkedAnchorIndex : -1,
    ox,
    oy,
    zoom,
    nowMs,
  );

  // ── Particles ─────────────────────────────────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_PARTICLES);
  // Particles drawn on top of all game layers (Canvas 2D fallback only —
  // WebGL renders to its own offscreen canvas at virtual resolution)
  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, ox, oy, zoom);
  }
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_PARTICLES);

  // ── Dark room overlay (applied last, inside the room clip) ───────────────
  // Covers the entire room with a near-opaque darkness layer, then "punches"
  // radial light holes at every light source so only illuminated areas show.
  // The bloom pass (composited later on the device canvas) adds atmospheric
  // glow on top of the darkness, making light sources feel warm and radiant.
  if (isDarkRoom) {
    if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_LIGHTING);

    // Collect viewport-visible decoration lights into the module-level scratch
    // array (cleared inside collectDecorationLights), capped by quality tier.
    // This avoids allocating a new LightSourcePx[] array every frame.
    collectDecorationLights(
      _scratchLights, cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL,
      qc.maxDynamicLightCount, virtualWidthPx, virtualHeightPx,
    );

    // ── Authored local light sources (see RoomLightSourceDef) ──────────────
    // Designer-placed lights are serialised in `RoomDef.lightSources`.  When
    // the room is in DarkRoom mode they punch additional holes in the
    // darkness mask just like decoration lights.  Brightness (0-100%) is
    // mapped onto both the inner-radius fraction (brighter → wider fully-lit
    // core) and a radius scalar so low-brightness lights feel dimmer.
    //
    // NOTE: colour is stored on RoomLightSourceDef but the DarkRoom overlay
    // currently uses an achromatic darkness mask, so colour is not applied
    // here yet.  This is consistent with the existing decoration-light path
    // and matches phase-1 scope (see task spec §9).  The colour data is
    // preserved end-to-end for a future coloured-light pass.
    if (currentRoom.lightSources) {
      for (const ls of currentRoom.lightSources) {
        if (_scratchLights.length >= qc.maxDynamicLightCount) break;
        const bPct = Math.max(0, Math.min(100, ls.brightnessPct)) / 100;
        if (bPct <= 0) continue;
        const worldX = (ls.xBlock + 0.5) * BLOCK_SIZE_SMALL;
        const worldY = (ls.yBlock + 0.5) * BLOCK_SIZE_SMALL;
        const radiusWorld = Math.max(1, ls.radiusBlocks) * BLOCK_SIZE_SMALL;
        const lx = worldX * zoom + ox;
        const ly = worldY * zoom + oy;
        // Viewport cull: skip lights whose radius circle is entirely offscreen.
        const radiusPx = radiusWorld * zoom * (0.5 + 0.5 * bPct);
        if (lx + radiusPx < 0 || lx - radiusPx > virtualWidthPx) continue;
        if (ly + radiusPx < 0 || ly - radiusPx > virtualHeightPx) continue;
        const innerFraction = 0.1 + 0.3 * bPct;
        _scratchLights.push({
          xPx: lx,
          yPx: ly,
          radiusPx,
          innerFraction,
        });
      }
    }

    // Player emits a personal lantern-sized light.
    // Use a for-loop instead of Array.find() to avoid closure allocation.
    let playerSnap: (typeof snapshot.clusters)[0] | undefined;
    for (let ci = 0; ci < snapshot.clusters.length; ci++) {
      const c = snapshot.clusters[ci];
      if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) { playerSnap = c; break; }
    }
    if (playerSnap !== undefined) {
      _scratchLights.push({
        xPx:          playerSnap.positionXWorld * zoom + ox,
        yPx:          playerSnap.positionYWorld * zoom + oy,
        radiusPx:     38 * zoom,
        innerFraction: 0.18,
      });
    }

    // Alive Physical (golden) dust particles each contribute a small light,
    // capped by the quality-tier particle light limit.
    let particleLightCount = 0;
    const parts = snapshot.particles;
    for (let pi = 0; pi < parts.particleCount && particleLightCount < qc.maxParticleLightCount; pi++) {
      if (parts.isAliveFlag[pi] === 0) continue;
      if (parts.kindBuffer[pi] !== ParticleKind.Physical) continue;
      const plx = parts.positionXWorld[pi] * zoom + ox;
      const ply = parts.positionYWorld[pi] * zoom + oy;
      const plr = 11 * zoom;
      // Viewport cull particle lights.
      if (plx + plr < 0 || plx - plr > virtualWidthPx) continue;
      if (ply + plr < 0 || ply - plr > virtualHeightPx) continue;
      _scratchLights.push({
        xPx:          plx,
        yPx:          ply,
        radiusPx:     plr,
        innerFraction: 0.05,
      });
      particleLightCount++;
    }

    // ── Player shadow occluders ──────────────────────────────────────────────
    // For each authored local light source, build a tapered shadow polygon
    // that the player casts away from the light.  The occluders are drawn into
    // the darkness mask *after* the light holes so the player visibly blocks
    // part of each light cone.  Only authored lightSources are used — not
    // decoration glows or particle lights.
    // Reuse module-level _scratchShadows array (cleared inside buildPlayerShadowOccluders).
    if (playerSnap !== undefined && currentRoom.lightSources && currentRoom.lightSources.length > 0) {
      buildPlayerShadowOccluders(
        playerSnap.positionXWorld * zoom + ox,
        playerSnap.positionYWorld * zoom + oy,
        playerSnap.halfWidthWorld  * zoom,
        playerSnap.halfHeightWorld * zoom,
        currentRoom.lightSources,
        ox,
        oy,
        zoom,
        _scratchShadows,
      );
    } else {
      _scratchShadows.length = 0;
    }

    // ── Preview bubbles as DarkRoom light sources ────────────────────────────
    // Each active preview bubble punches a small aperture-shaped hole in the
    // darkness mask at the transition opening.  This ensures the glowing cue
    // is visible through the DarkRoom overlay and blends naturally with the
    // player's lantern light.  The bubble opacity drives the inner-fraction so
    // the hole fades in as the player approaches, matching the glow animation.
    for (let bi = 0; bi < r.previewBubbleCount; bi++) {
      const b = r.previewBubbles[bi];
      if (b.opacity <= 0 || b.radiusPx <= 0) continue;
      _scratchLights.push({
        xPx:          b.centerXPx,
        yPx:          b.centerYPx,
        radiusPx:     b.radiusPx,
        innerFraction: b.opacity * 0.4,
      });
    }

    darkRoomOverlay.render(ctx, _scratchLights, _scratchShadows);
    if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_LIGHTING);
  }

  // End room clip before any HUD/screen-space overlays are drawn.
  ctx.restore();

  // ── HUD layers (debug overlay, health bar, dust display, enemy bars, combat text) ──
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_HUD);
  renderGameHud(r, nowMs);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_HUD);

  // ── Upscale virtual canvas to device canvas ────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_BLOOM);
  deviceCtx.imageSmoothingEnabled = false;
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  // Composite WebGL particle canvas on top (also at virtual resolution)
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_BLOOM);
  drawOffensiveDustOutlineOverlay(deviceCtx, snapshot, canvas.width, canvas.height, ox, oy, zoom);

  // ── Touch joystick (drawn on device canvas in screen space) ───────────
  if (inputState.isTouchJoystickActiveFlag === 1) {
    const bx = inputState.touchJoystickBaseXPx;
    const by = inputState.touchJoystickBaseYPx;
    const joystickCurrentXPx = inputState.touchJoystickCurrentXPx;
    const joystickCurrentYPx = inputState.touchJoystickCurrentYPx;

    // Scale radii from virtual pixels to device canvas pixels so the joystick
    // appears at the correct physical size regardless of device resolution.
    const joystickScale = canvas.height / virtualCanvas.height;
    const outerRadiusPx = JOYSTICK_OUTER_RADIUS_PX * joystickScale;
    const innerRadiusPx = JOYSTICK_INNER_RADIUS_PX * joystickScale;

    deviceCtx.save();
    deviceCtx.beginPath();
    deviceCtx.arc(bx, by, outerRadiusPx, 0, Math.PI * 2);
    deviceCtx.strokeStyle = 'rgba(0,207,255,0.35)';
    deviceCtx.lineWidth = 2 * joystickScale;
    deviceCtx.stroke();
    deviceCtx.fillStyle = 'rgba(0,207,255,0.08)';
    deviceCtx.fill();

    const joystickDx = joystickCurrentXPx - bx;
    const joystickDy = joystickCurrentYPx - by;
    const dist = Math.sqrt(joystickDx * joystickDx + joystickDy * joystickDy);
    let thumbXPx = joystickCurrentXPx;
    let thumbYPx = joystickCurrentYPx;
    if (dist > outerRadiusPx) {
      thumbXPx = bx + (joystickDx / dist) * outerRadiusPx;
      thumbYPx = by + (joystickDy / dist) * outerRadiusPx;
    }

    deviceCtx.beginPath();
    deviceCtx.arc(thumbXPx, thumbYPx, innerRadiusPx, 0, Math.PI * 2);
    deviceCtx.fillStyle = 'rgba(0,207,255,0.45)';
    deviceCtx.fill();
    deviceCtx.restore();
  }

  // ── Control hints (debug only, drawn on device canvas) ──────────────────
  if (isDebugMode) {
    const controlHintText = IS_TOUCH_DEVICE
      ? 'L.thumb L/R=walk  |  L.thumb up=jump  |  2nd finger tap=attack  |  2nd finger hold=block  |  TAP MENU to return'
      : 'A/D=walk  |  W/Space/↑=jump  |  Shift=sprint  |  Click=attack  |  Hold=block  |  Hold Left Click=grapple  |  ESC=menu';
    deviceCtx.fillStyle = 'rgba(255,255,255,0.3)';
    deviceCtx.font = '12px monospace';
    const hintWidthPx = deviceCtx.measureText(controlHintText).width;
    deviceCtx.fillText(controlHintText, (canvas.width - hintWidthPx) / 2, canvas.height - 10);
  }

  // ── Transition fade overlay ─────────────────────────────────────────────
  // Drawn on the device canvas after all compositing so it covers WebGL
  // particles, bloom, and the touch joystick.  Alpha = 1 means fully black.
  if (r.transitionFadeAlpha > 0) {
    deviceCtx.save();
    deviceCtx.globalAlpha = r.transitionFadeAlpha;
    deviceCtx.fillStyle = '#000000';
    deviceCtx.fillRect(0, 0, canvas.width, canvas.height);
    deviceCtx.restore();
  }

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
