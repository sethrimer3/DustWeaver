/**
 * gameDarkRoomLighting.ts — DarkRoom overlay lighting pass for the game renderer.
 *
 * Collects all light sources for the current frame (decoration glows, authored
 * room lights, player lantern, Physical dust particles, transition bubbles) and
 * feeds them to DarkRoomOverlay.render() to punch radial light holes in the
 * near-opaque darkness mask.
 *
 * Owns the module-level scratch buffers so allocations stay off the hot path.
 * Scratch buffers are reset at the start of each renderDarkRoomLighting() call.
 */

import { ParticleKind } from '../sim/particles/kinds';
import {
  LIGHT_BUFFER_STRIDE,
  MAX_LIGHT_BUFFER_COUNT,
  type DarkRoomOverlay,
} from '../render/effects/darkRoomOverlay';
import { buildPlayerShadowOccluders, type ShadowCasterOccluderPx } from '../render/effects/shadowCaster';
import { collectDecorationLights, type WallDecoration } from '../render/effects/wallDecorations';
import type { WorldSnapshot } from '../render/snapshot';
import { BLOCK_SIZE_SMALL, type RoomDef } from '../levels/roomDef';
import { STAGE_LIGHTING, type RenderProfiler } from '../render/hud/renderProfiler';
import type { RenderQualityConfig } from '../render/renderQualityConfig';

// ── Module-level scratch buffers (allocation-free hot path) ────────────────
// Allocated once and reused every frame to collect light sources and shadow
// occluders for the DarkRoom overlay.

/**
 * Pre-allocated flat Float32Array for DarkRoom light sources.
 * Interleaved format: LIGHT_BUFFER_STRIDE floats per light
 *   [0] xPx, [1] yPx, [2] radiusPx, [3] innerFraction,
 *   [4] colorR, [5] colorG, [6] colorB  (all 0–255)
 * Filled each frame by collectDecorationLights() plus inline additions.
 * Sized to hold MAX_LIGHT_BUFFER_COUNT lights (BUILD 272 flat-array refactor).
 */
const _scratchLights = new Float32Array(MAX_LIGHT_BUFFER_COUNT * LIGHT_BUFFER_STRIDE);

/** Number of valid lights currently written into _scratchLights. */
let _scratchLightCount = 0;

/**
 * Write one light entry into the flat _scratchLights buffer and advance the count.
 * No-op when the buffer is full (count ≥ MAX_LIGHT_BUFFER_COUNT).
 */
function _pushLight(
  xPx: number, yPx: number, radiusPx: number, innerFraction: number,
  cr = 255, cg = 255, cb = 255,
): void {
  if (_scratchLightCount >= MAX_LIGHT_BUFFER_COUNT) return;
  const base = _scratchLightCount * LIGHT_BUFFER_STRIDE;
  _scratchLights[base + 0] = xPx;
  _scratchLights[base + 1] = yPx;
  _scratchLights[base + 2] = radiusPx;
  _scratchLights[base + 3] = innerFraction;
  _scratchLights[base + 4] = cr;
  _scratchLights[base + 5] = cg;
  _scratchLights[base + 6] = cb;
  _scratchLightCount++;
}

/**
 * Pre-allocated scratch array for shadow occluder polygons.
 * Cleared and filled by buildPlayerShadowOccluders() each frame.
 */
const _scratchShadows: ShadowCasterOccluderPx[] = [];

// ── Public interface ───────────────────────────────────────────────────────

/** Subset of RenderFrameContext fields required by renderDarkRoomLighting(). */
export interface DarkRoomLightingContext {
  ctx: CanvasRenderingContext2D;
  currentRoom: RoomDef;
  snapshot: WorldSnapshot;
  cachedDecorations: readonly WallDecoration[];
  darkRoomOverlay: DarkRoomOverlay;
  ox: number;
  oy: number;
  zoom: number;
  virtualWidthPx: number;
  virtualHeightPx: number;
  renderProfiler?: RenderProfiler;
}

/**
 * Collect all light sources for the current frame and render the DarkRoom
 * overlay.  Must be called after all geometry/entity drawing is complete
 * and before ctx.restore() closes the room clip.
 *
 * A RenderFrameContext satisfies DarkRoomLightingContext via structural typing —
 * call as renderDarkRoomLighting(r, qc) from renderFrame().
 *
 * @param r   Context snapshot for this frame.
 * @param qc  Quality config for this frame — drives light source caps.
 */
export function renderDarkRoomLighting(r: DarkRoomLightingContext, qc: RenderQualityConfig): void {
  const {
    ctx, currentRoom, snapshot, cachedDecorations,
    darkRoomOverlay,
    ox, oy, zoom, virtualWidthPx, virtualHeightPx, renderProfiler,
  } = r;

  if (renderProfiler !== undefined) renderProfiler.stageBegin(STAGE_LIGHTING);

  // Collect viewport-visible decoration lights into the flat scratch buffer.
  // BUILD 272: collectDecorationLights writes directly into the typed array and
  // returns the updated count, eliminating per-frame object-literal allocations.
  _scratchLightCount = collectDecorationLights(
    _scratchLights, 0, qc.maxDynamicLightCount,
    cachedDecorations, ox, oy, zoom, BLOCK_SIZE_SMALL, virtualWidthPx, virtualHeightPx,
  );

  // ── Authored local light sources (see RoomLightSourceDef) ──────────────
  // Designer-placed lights are serialised in `RoomDef.lightSources`.  When
  // the room is in DarkRoom mode they punch additional holes in the
  // darkness mask just like decoration lights.  Brightness (0-100%) is
  // mapped onto both the inner-radius fraction (brighter → wider fully-lit
  // core) and a radius scalar so low-brightness lights feel dimmer.
  //
  // BUILD 272: colour (colorR/G/B) is now forwarded to the flat light buffer
  // and consumed by the DarkRoomOverlay's coloured additive pass.
  if (currentRoom.lightSources) {
    for (const ls of currentRoom.lightSources) {
      if (_scratchLightCount >= qc.maxDynamicLightCount) break;
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
      _pushLight(lx, ly, radiusPx, innerFraction, ls.colorR, ls.colorG, ls.colorB);
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
    _pushLight(
      playerSnap.positionXWorld * zoom + ox,
      playerSnap.positionYWorld * zoom + oy,
      38 * zoom, 0.18,
    );
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
    _pushLight(plx, ply, plr, 0.05);
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

  darkRoomOverlay.render(ctx, _scratchLights, _scratchLightCount, _scratchShadows);
  if (renderProfiler !== undefined) renderProfiler.stageEnd(STAGE_LIGHTING);
}
