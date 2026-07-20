/**
 * timeStopFieldRenderer.ts — TimeStop Field translucent connected-region visual.
 *
 * Draws every connected TimeStop Field region as one seamless, rounded,
 * translucent fill with a glowing boundary and (on MED/HIGH graphics) a
 * subtle internal shimmer. Geometry is cached in WORLD-space units, keyed by
 * object identity of the region set returned from the sim-side cache
 * (`getTimeStopFieldRegions`) — a region set only changes identity when the
 * cache is rebuilt (room load/edit), so camera pan/zoom never triggers a
 * geometry rebuild; they're applied as a canvas transform instead.
 */

import type { WorldState } from '../sim/world';
import { getTimeStopFieldRegions } from '../sim/timeStopField/timeStopFieldCache';
import { decodeTimeStopTileKey, encodeTimeStopTileKey, type TimeStopFieldRegionSet } from '../sim/timeStopField/timeStopFieldBuilder';
import { buildRoundedRegionPath, type TileCell } from './timeStopFieldGeometry';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  TIME_STOP_FIELD_OPACITY,
  TIME_STOP_FIELD_EDGE_GLOW_STRENGTH,
  TIME_STOP_FIELD_CORNER_RADIUS_FRACTION,
  TIME_STOP_FIELD_ANIMATION_SPEED,
} from '../sim/timeStopField/timeStopFieldConfig';
import type { RenderQualityConfig } from './renderQualityConfig';

let _cachedForRegionSet: TimeStopFieldRegionSet | null = null;
let _cachedWorldSpacePaths: Path2D[] = [];

function getCachedWorldSpacePaths(regionSet: TimeStopFieldRegionSet): Path2D[] {
  if (regionSet === _cachedForRegionSet) return _cachedWorldSpacePaths;

  const B = BLOCK_SIZE_MEDIUM;
  const radius = B * TIME_STOP_FIELD_CORNER_RADIUS_FRACTION;
  _cachedWorldSpacePaths = regionSet.regions.map(region => {
    const cells: TileCell[] = [];
    for (const key of region.tileSet) cells.push(decodeTimeStopTileKey(key));
    const isOccupied = (gx: number, gy: number): boolean =>
      region.tileSet.has(encodeTimeStopTileKey(gx, gy));
    return buildRoundedRegionPath(cells, isOccupied, 0, 0, B, radius);
  });
  _cachedForRegionSet = regionSet;
  return _cachedWorldSpacePaths;
}

/**
 * Draws all TimeStop Field regions currently loaded in `world`.
 * No-op when the room has no TimeStop Field tiles.
 */
export function renderTimeStopField(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
  qc: Pick<RenderQualityConfig, 'isTimeStopShimmerEnabled' | 'isTimeStopEdgeGlowEnabled'>,
): void {
  if (world.timeStopFieldCount === 0) return;
  const regionSet = getTimeStopFieldRegions(world);
  if (regionSet.regions.length === 0) return;

  const paths = getCachedWorldSpacePaths(regionSet);

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(zoom, zoom);

  // Slow internal shimmer: a gentle alpha pulse standing in for true fluid
  // distortion — cheap (one sinusoid), reads as "flowing" at this game's
  // pixel-art scale without a per-pixel displacement pass.
  const shimmer = qc.isTimeStopShimmerEnabled
    ? 0.85 + 0.15 * Math.sin(world.tick * TIME_STOP_FIELD_ANIMATION_SPEED)
    : 1.0;

  for (const path of paths) {
    ctx.fillStyle = `rgba(150,110,255,${(TIME_STOP_FIELD_OPACITY * shimmer).toFixed(3)})`;
    ctx.fill(path);

    ctx.strokeStyle = `rgba(200,170,255,${Math.min(1, TIME_STOP_FIELD_EDGE_GLOW_STRENGTH + 0.3).toFixed(3)})`;
    ctx.lineWidth = 1.5 / zoom;
    if (qc.isTimeStopEdgeGlowEnabled) {
      ctx.shadowColor = 'rgba(180,140,255,0.9)';
      // shadowBlur is affected by the current transform (we've scaled by
      // `zoom`), so divide to keep the glow a constant size on screen.
      ctx.shadowBlur = 3 / zoom;
    } else {
      ctx.shadowBlur = 0;
    }
    ctx.stroke(path);
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

/**
 * Returns the SCREEN-space Path2D for the player's currently active
 * connected region (world.timeStopField.activeRegionId), or null when the
 * player isn't inside any field. Used by the inversion compositor to punch
 * the "stays normal" hole — sharing this cache means the mask and the field
 * visual are always pixel-identical, never drifting apart.
 */
export function getActiveRegionScreenPath(
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
): Path2D | null {
  const regionId = world.timeStopField.activeRegionId;
  if (regionId < 0) return null;
  const regionSet = getTimeStopFieldRegions(world);
  const worldPaths = getCachedWorldSpacePaths(regionSet);
  const worldPath = worldPaths[regionId];
  if (worldPath === undefined) return null;

  // Re-express the cached world-space path in screen space via a transform
  // matrix rather than rebuilding geometry — cheap, and exactly matches
  // where the field visual itself is drawn.
  const screenPath = new Path2D();
  const m = new DOMMatrix([zoom, 0, 0, zoom, ox, oy]);
  screenPath.addPath(worldPath, m);
  return screenPath;
}

/** Test/debug helper: forces the next render to rebuild its cached geometry. */
export function invalidateTimeStopFieldRenderCache(): void {
  _cachedForRegionSet = null;
  _cachedWorldSpacePaths = [];
}
