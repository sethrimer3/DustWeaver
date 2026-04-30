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
import {
  isTheroShowcaseRoom,
  renderTheroShowcaseEffect,
  renderTheroBackgroundEffect,
  renderCrystallineCracksBackground,
} from '../render/effects/theroEffectManager';
import type { BloomSystem } from '../render/effects/bloomSystem';
import type { DarkRoomOverlay } from '../render/effects/darkRoomOverlay';
import {
  renderDecorationSprites,
  addDecorationBloom,
  collectDecorationLights,
  DecorationWaveState,
} from '../render/effects/wallDecorations';
import type { WallDecoration } from '../render/effects/wallDecorations';
import type { InputState } from '../input/handler';
import { JOYSTICK_MAX_RADIUS_PX } from '../input/handler';
import {
  drawTunnelDarkness,
  DUST_CONTAINER_SIZE_WORLD,
} from './gameRoom';
import { getReachableEdgeGlowOpacity, getInfluenceCircleOpacity, getInfluenceHighlightWidth } from '../ui/renderSettings';
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

// ── Optional high-water glow guard (disabled by default) ──────────────────
// When HIGH_WATER_GLOW_GUARD_ENABLED is true and the cached decoration count
// exceeds HIGH_WATER_DECORATION_BLOOM_LIMIT, addDecorationBloom only processes
// decorations whose screen-space position falls within the virtual canvas
// bounds (cheap sx/sy AABB check), skipping off-screen decorations.
// Flip HIGH_WATER_GLOW_GUARD_ENABLED to true for pathological scenes; see
// DECISIONS.md for full guidance.  Has no effect when false.
const HIGH_WATER_GLOW_GUARD_ENABLED       = false;
const HIGH_WATER_DECORATION_BLOOM_LIMIT   = 128;

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
    world, currentRoom, snapshot,
    cachedDecorations, cachedDecorationCenterX, cachedDecorationCenterY,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx,
    bgColor, isDebugMode, inputState,
    collectedDustContainerKeySet,
    isDustContainerSpriteLoaded,
    dustContainerSprite,
  } = r;

  const nowMs = performance.now();

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

  // Walls before cluster indicators so clusters are drawn on top
  renderDarkAmbientBlockerOverlay(ctx, ox, oy, zoom, BLOCK_SIZE_SMALL);
  renderWalls(ctx, snapshot, ox, oy, zoom, isDebugMode);

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
  renderGrapple(ctx, snapshot, ox, oy, zoom);
  drawGrappleBloom(bloomSystem, snapshot, ox, oy, zoom);
  drawParticleGlow(bloomSystem, snapshot, ox, oy, zoom);

  // Arrow Weave — bow crescent, dissipation, and stuck/in-flight arrows
  arrowWeaveRenderer.render(ctx, snapshot, ox, oy, zoom);
  // Shield Sword Weave — golden-crossguard sword + slash trail (drawn on top
  // of the player so the crossguard reads against the body).
  swordWeaveRenderer.render(ctx, snapshot, ox, oy, zoom);
  // Decoration bloom — always added (even outside DarkRoom) so moss/mushrooms
  // visibly glow with the atmospheric bloom pass on any lighting setting.
  // HIGH_WATER_GLOW_GUARD_ENABLED: when true and decoration count exceeds
  // HIGH_WATER_DECORATION_BLOOM_LIMIT, only viewport-visible decorations are
  // processed (viewport sx/sy AABB check).  Disabled by default — see DECISIONS.md.
  if (HIGH_WATER_GLOW_GUARD_ENABLED && cachedDecorations.length > HIGH_WATER_DECORATION_BLOOM_LIMIT) {
    // TODO: filter cachedDecorations to viewport-visible subset before calling addDecorationBloom.
  }
  addDecorationBloom(bloomSystem, cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, nowMs);

  // Tunnel darkness overlays
  drawTunnelDarkness(ctx, currentRoom, ox, oy, zoom);

  environmentalDust.render(ctx, ox, oy, zoom, isDebugMode);
  skidDebris.render(ctx, ox, oy, zoom);
  crumbleDebris.render(ctx, ox, oy, zoom);

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

  // Particles drawn on top of all game layers (Canvas 2D fallback only —
  // WebGL renders to its own offscreen canvas at virtual resolution)
  if (!webglRenderer.isAvailable) {
    renderParticles(ctx, snapshot, ox, oy, zoom);
  }

  // ── Dark room overlay (applied last, inside the room clip) ───────────────
  // Covers the entire room with a near-opaque darkness layer, then "punches"
  // radial light holes at every light source so only illuminated areas show.
  // The bloom pass (composited later on the device canvas) adds atmospheric
  // glow on top of the darkness, making light sources feel warm and radiant.
  if (isDarkRoom) {
    const lights = collectDecorationLights(cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL);

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
        const bPct = Math.max(0, Math.min(100, ls.brightnessPct)) / 100;
        if (bPct <= 0) continue;
        const worldX = (ls.xBlock + 0.5) * BLOCK_SIZE_SMALL;
        const worldY = (ls.yBlock + 0.5) * BLOCK_SIZE_SMALL;
        const radiusWorld = Math.max(1, ls.radiusBlocks) * BLOCK_SIZE_SMALL;
        // Brightness 100% → full radius + wide core; 25% → half radius + tiny core.
        const radiusPx = radiusWorld * zoom * (0.5 + 0.5 * bPct);
        const innerFraction = 0.1 + 0.3 * bPct;
        lights.push({
          xPx: worldX * zoom + ox,
          yPx: worldY * zoom + oy,
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

    // Alive Physical (golden) dust particles each contribute a small light.
    const MAX_PARTICLE_LIGHTS = 24;
    let particleLightCount = 0;
    const parts = snapshot.particles;
    for (let pi = 0; pi < parts.particleCount && particleLightCount < MAX_PARTICLE_LIGHTS; pi++) {
      if (parts.isAliveFlag[pi] === 0) continue;
      if (parts.kindBuffer[pi] !== ParticleKind.Physical) continue;
      lights.push({
        xPx:          parts.positionXWorld[pi] * zoom + ox,
        yPx:          parts.positionYWorld[pi] * zoom + oy,
        radiusPx:     11 * zoom,
        innerFraction: 0.05,
      });
      particleLightCount++;
    }

    darkRoomOverlay.render(ctx, lights);
  }

  // End room clip before any HUD/screen-space overlays are drawn.
  ctx.restore();

  // ── HUD layers (debug overlay, health bar, dust display, enemy bars, combat text) ──
  renderGameHud(r, nowMs);

  // ── Upscale virtual canvas to device canvas ────────────────────────────
  deviceCtx.imageSmoothingEnabled = false;
  deviceCtx.drawImage(virtualCanvas, 0, 0, canvas.width, canvas.height);
  // Composite WebGL particle canvas on top (also at virtual resolution)
  if (webglRenderer.isAvailable) {
    deviceCtx.drawImage(webglRenderer.canvas, 0, 0, canvas.width, canvas.height);
  }
  bloomSystem.compositeToDevice(deviceCtx, canvas.width, canvas.height);
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
}
