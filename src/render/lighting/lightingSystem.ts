/**
 * lightingSystem.ts — Frame-level lighting compositor.
 *
 * Manages the offscreen canvas that accumulates scene lights and composites
 * it onto the virtual canvas each frame.
 *
 * Responsibilities:
 *   • Own a single offscreen canvas at virtual resolution.
 *   • Cache room walls; build per-light occluder sets each frame (spatially
 *     culled to each light's radius so large rooms don't pay full cost).
 *   • Cull lights outside the viewport each frame (no draw if invisible).
 *   • Call the per-light draw routines from lightRenderer.ts.
 *   • Composite the accumulated light canvas onto the game canvas.
 *
 * Performance rules:
 *   • Pre-allocate all scratch arrays; no per-frame heap allocation.
 *   • Never call gl / webgl API here — Canvas 2D only.
 *   • Occluder segments are built per-light with tight radius culling so only
 *     the walls near each light are processed — O(walls) per shadow light
 *     instead of O(all-walls × all-shadow-lights) with a global pre-build.
 */

import type { LightDef } from './lightingTypes';
import type { OccluderSegment } from './visibilityPolygon';
import { buildWallOccluders, computeVisibilityPolygon } from './visibilityPolygon';
import { drawLight } from './lightRenderer';
import * as FP from '../../debug/perfFreezeProfiler';
import { resetCanvasPass, resizeCanvasBackingStore } from '../canvasViewport';

// ── Pre-allocated scratch buffers ─────────────────────────────────────────────

const MAX_LIGHTS = 64;
const MIN_SUNRAY_LENGTH_WORLD = 1;

function isSunrayVisible(
  light: LightDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
): boolean {
  const angleRad = light.angleRad ?? light.rotationRad ?? 0;
  const lengthWorld = Math.max(light.lengthWorld ?? light.radiusWorld, MIN_SUNRAY_LENGTH_WORLD);
  const widthStartWorld = Math.max(light.widthStartWorld ?? 1, 1);
  const widthEndWorld = Math.max(light.widthEndWorld ?? widthStartWorld, widthStartWorld);
  const maxHalfWidthWorld = Math.max(widthStartWorld, widthEndWorld) * 0.5;

  const sx = light.xWorld * zoom + offsetXPx;
  const sy = light.yWorld * zoom + offsetYPx;
  const ex = (light.xWorld + Math.cos(angleRad) * lengthWorld) * zoom + offsetXPx;
  const ey = (light.yWorld + Math.sin(angleRad) * lengthWorld) * zoom + offsetYPx;
  const pad = maxHalfWidthWorld * zoom + 6;
  const minX = Math.min(sx, ex) - pad;
  const maxX = Math.max(sx, ex) + pad;
  const minY = Math.min(sy, ey) - pad;
  const maxY = Math.max(sy, ey) + pad;
  if (maxX < 0 || minX > viewportW) return false;
  if (maxY < 0 || minY > viewportH) return false;
  return true;
}

/**
 * Per-light scratch occluder pool.  Each shadow-casting light builds its own
 * spatially-culled segment list here; never shared across lights.
 */
const _lightOccluders: OccluderSegment[] = Array.from({ length: 2048 }, () => ({
  ax: 0, ay: 0, bx: 0, by: 0,
}));

/** Per-frame: viewport-culled lights ready to be drawn. */
const _culledLights: LightDef[] = new Array<LightDef>(MAX_LIGHTS);
let _culledLightCount = 0;

// ── Module state ──────────────────────────────────────────────────────────────

let _offscreenCanvas: HTMLCanvasElement | null = null;
let _offscreenCtx: CanvasRenderingContext2D | null = null;

// Cached room walls updated by markOccludersDirty().
type WallForOccluder = { xWorld: number; yWorld: number; wWorld: number; hWorld: number; isPlatformFlag?: 0 | 1 };
let _cachedWalls: readonly WallForOccluder[] = [];

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialise (or reinitialise) the lighting system for the given virtual
 * resolution.  Safe to call multiple times — reuses the canvas element and
 * only recreates the context when the dimensions actually change.
 *
 * NOTE: Does NOT mark occluders dirty.  Occluder data is world-space and is
 * independent of canvas resolution; call markOccludersDirty() only when room
 * walls change.
 */
export function initLightingSystem(widthPx: number, heightPx: number): void {
  if (_offscreenCanvas === null) {
    _offscreenCanvas = document.createElement('canvas');
    resizeCanvasBackingStore(_offscreenCanvas, widthPx, heightPx);
    _offscreenCtx = _offscreenCanvas.getContext('2d') ?? null;
    return;
  }
  if (resizeCanvasBackingStore(_offscreenCanvas, widthPx, heightPx)) {
    _offscreenCtx = _offscreenCanvas.getContext('2d') ?? null;
  }
}

/**
 * Update the cached room walls.  Call when the room changes, when the editor
 * modifies walls, or when destructible geometry changes.
 *
 * The occluder segments are now built per-light each frame (spatially culled),
 * so this simply updates the wall source for subsequent per-light builds.
 */
export function markOccludersDirty(
  walls: readonly WallForOccluder[],
): void {
  _cachedWalls = walls;
}

// ── Per-frame render ──────────────────────────────────────────────────────────

/**
 * Render all scene lights onto `targetCtx` (the virtual canvas).
 *
 * Must be called within the room clip (after `ctx.save()` sets the room
 * scissor rectangle, before `ctx.restore()`).
 *
 * For shadow-casting lights the occluder set is built per-light, spatially
 * culled to each light's radius.  This is O(walls) per shadow light rather
 * than O(all-walls) once up-front + O(all-segs) per light — a significant
 * win for large rooms where most walls are far from any given light.
 *
 * @param targetCtx   Virtual canvas 2D context.
 * @param lights      Scene lights from the current room's `RoomDef.sceneLights`.
 * @param offsetXPx   Camera X offset (world→canvas translation) in virtual pixels.
 * @param offsetYPx   Camera Y offset.
 * @param zoom        Camera zoom (virtual pixels per world unit).
 * @param viewportW   Viewport width in virtual pixels.
 * @param viewportH   Viewport height in virtual pixels.
 * @param nowMs       Current time in milliseconds (for animations).
 */
export function renderLightingPass(
  targetCtx: CanvasRenderingContext2D,
  lights: readonly LightDef[] | undefined,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  viewportW: number,
  viewportH: number,
  nowMs: number,
): void {
  if (!lights || lights.length === 0) return;
  if (_offscreenCtx === null || _offscreenCanvas === null) return;

  const ctx = _offscreenCtx;

  // Cull lights that are entirely outside the viewport.
  _culledLightCount = 0;
  for (let i = 0; i < lights.length && _culledLightCount < MAX_LIGHTS; i++) {
    const l = lights[i];
    if (l.kind === 'sunray') {
      if (!isSunrayVisible(l, offsetXPx, offsetYPx, zoom, viewportW, viewportH)) continue;
    } else {
      // Light screen centre
      const screenX = l.xWorld * zoom + offsetXPx;
      const screenY = l.yWorld * zoom + offsetYPx;
      const screenR = l.radiusWorld * zoom;
      if (screenX + screenR < 0 || screenX - screenR > viewportW) continue;
      if (screenY + screenR < 0 || screenY - screenR > viewportH) continue;
    }
    _culledLights[_culledLightCount++] = l;
  }
  if (_culledLightCount === 0) {
    FP.recordSceneLightStats(lights.length, 0, 0, 0);
    return;
  }

  // Clear the entire target in identity space and reset any leaked pass state.
  resetCanvasPass(ctx, _offscreenCanvas.width, _offscreenCanvas.height, false);

  // Draw each light.
  let shadowLightCount = 0;
  let totalOccluderSegs = 0;

  // Apply camera transform so we draw in world space.
  ctx.save();
  try {
    ctx.translate(offsetXPx, offsetYPx);
    ctx.scale(zoom, zoom);

    for (let i = 0; i < _culledLightCount; i++) {
      const light = _culledLights[i];
      let visResult = null;

      if (light.castsShadowsFlag === 1 && _cachedWalls.length > 0) {
        const visRadiusWorld = light.kind === 'sunray'
          ? Math.max(light.radiusWorld, light.lengthWorld ?? light.radiusWorld)
          : light.radiusWorld;
        // Build occluder segments spatially culled to this light's radius.
        // Only walls within `visRadiusWorld` of the light origin are included,
        // so large rooms don't pay the cost of distant walls.
        const lightSegCount = buildWallOccluders(
          _cachedWalls,
          light.xWorld, light.yWorld, visRadiusWorld,
          _lightOccluders,
        );
        if (lightSegCount > 0) {
          visResult = computeVisibilityPolygon(
            light.xWorld, light.yWorld, visRadiusWorld,
            _lightOccluders, lightSegCount,
          );
          totalOccluderSegs += lightSegCount;
        }
        shadowLightCount++;
      }

      drawLight(ctx, light, nowMs, visResult);
    }
  } finally {
    ctx.restore();
  }

  FP.recordSceneLightStats(lights.length, _culledLightCount, shadowLightCount, totalOccluderSegs);

  // Composite the accumulated light canvas onto the target (game canvas).
  // Use 'lighter' (additive) so overlapping lights brighten the scene.
  targetCtx.save();
  targetCtx.globalCompositeOperation = 'lighter';
  targetCtx.globalAlpha = 1;
  targetCtx.drawImage(_offscreenCanvas, 0, 0);
  targetCtx.restore();
}
