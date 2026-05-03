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
import { renderWalls, renderClusters, renderGrapple } from '../render/clusters/renderer';
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
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
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
import { renderDarkAmbientBlockerOverlay } from '../render/walls/blockSpriteRenderer';
import {
  drawGrappleBloom,
  drawParticleGlow,
  drawOffensiveDustOutlineOverlay,
} from './gameRenderHelpers';
import { renderGameHud } from './gameHudRenderer';

// ── Constants ──────────────────────────────────────────────────────────────

/** Fixed simulation timestep for tick-to-ms conversion. */
const FIXED_DT_MS = 16.666;

/** Touch joystick outer radius matches the max drag radius from handler.ts. */
const JOYSTICK_OUTER_RADIUS_PX = JOYSTICK_MAX_RADIUS_PX;
const JOYSTICK_INNER_RADIUS_PX = 22;

const IS_TOUCH_DEVICE = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

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

  // Callbacks
  getPlayerDustCount: () => number;

  // Graphics quality for this frame — drives quality-tier rendering decisions.
  graphicsQuality: GraphicsQuality;
  /** Render-stage profiler.  When provided, timings are recorded when debug is on. */
  renderProfiler?: RenderProfiler;
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
    sunbeamRenderer, atmosphericLightDust,
    world, currentRoom, snapshot,
    cachedDecorations, cachedDecorationCenterX, cachedDecorationCenterY,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, inputState,
    collectedDustContainerKeySet,
    isDustContainerSpriteLoaded,
    dustContainerSprite,
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
  // Walls before cluster indicators so clusters are drawn on top
  renderDarkAmbientBlockerOverlay(ctx, ox, oy, zoom, BLOCK_SIZE_SMALL);
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);
  renderRopes(ctx, snapshot, ox, oy, zoom);

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

  // ── Atmospheric effects (dust, debris) ──────────────────────────────────
  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_DUST);
  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  atmosphericLightDust.render(ctx, ox, oy, zoom, virtualWidthPx, virtualHeightPx);
  skidDebris.render(ctx, ox, oy, zoom);
  crumbleDebris.render(ctx, ox, oy, zoom);
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

    // Collect viewport-visible decoration lights, capped by quality tier.
    const lights = collectDecorationLights(
      cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL,
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
        if (lights.length >= qc.maxDynamicLightCount) break;
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
        lights.push({
          xPx: lx,
          yPx: ly,
          radiusPx,
          innerFraction,
        });
      }
    }

    // Player emits a personal lantern-sized light.
    const playerSnap = snapshot.clusters.find(c => c.isPlayerFlag === 1 && c.isAliveFlag === 1);
    if (playerSnap !== undefined) {
      lights.push({
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
      lights.push({
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
    const shadows: ShadowCasterOccluderPx[] = [];
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
        shadows,
      );
    }

    darkRoomOverlay.render(ctx, lights, shadows);
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

  // Finalise the profiler — updates EMA-smoothed values used by next frame's overlay.
  if (renderProfiler !== undefined) renderProfiler.endFrame();
}
