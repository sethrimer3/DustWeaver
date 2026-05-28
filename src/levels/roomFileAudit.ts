/**
 * roomFileAudit.ts — Dev-only room file audit / report.
 *
 * Logs a summary table for each room in a campaign, covering:
 *   • JSON byte size
 *   • schema version
 *   • exactWalls count (legacy v2 format — should be 0 in all v3 rooms)
 *   • v1ByTheme primitive counts (runs, points) by theme
 *   • byTheme primitive counts (rects, runs, points) by theme
 *   • waterLayer / lavaLayer primitives (v3 compact zones)
 *   • ambientBlockersClear / ambientBlockersDark primitives (v3 compact blockers)
 *   • bgLayers group count and total primitives (v3 compact background)
 *   • hydrated wall count
 *
 * Usage (DEV mode only):
 *   import { auditRoomFiles } from './roomFileAudit';
 *   auditRoomFiles(campaignRooms);
 *
 * This module tree-shakes out of production builds via the DEV guard.
 */

import type { SavedRoomV2, SavedSolids, Saved1x1Layer, SavedSolidLayer } from './roomSavedTypes';
import { isSavedRoomV2, hydrateSolidsByTheme } from './roomSchemaHydrator';

export interface RoomFileAuditEntry {
  roomId: string;
  version: number;
  widthBlocks: number;
  heightBlocks: number;
  jsonBytes: number;
  exactWallCount: number;
  v1ByThemePrimitives: number;
  v1ByThemeRuns: number;
  v1ByThemePoints: number;
  byThemePrimitives: number;
  byThemeRects: number;
  byThemeRuns: number;
  byThemePoints: number;
  /** Primitives in the compact waterLayer (v3+); 0 if using legacy waterZones. */
  waterLayerPrimitives: number;
  /** Primitives in the compact lavaLayer (v3+); 0 if using legacy lavaZones. */
  lavaLayerPrimitives: number;
  /** Legacy waterZones rect count (v2 only; 0 in v3 rooms). */
  waterZoneLegacy: number;
  /** Legacy lavaZones rect count (v2 only; 0 in v3 rooms). */
  lavaZoneLegacy: number;
  /** Primitives in the compact ambientBlockersClear layer (v3+). */
  ambientClearPrimitives: number;
  /** Primitives in the compact ambientBlockersDark layer (v3+). */
  ambientDarkPrimitives: number;
  /** Legacy ambientBlockers count (v2 only; 0 in v3 rooms). */
  ambientBlockerLegacy: number;
  /** Number of background layer groups in bgLayers (v3+). */
  bgLayerGroups: number;
  /** Total primitives across all bgLayer groups (v3+). */
  bgLayerPrimitives: number;
  /** Legacy bgBlocks count (v2 only; 0 in v3 rooms). */
  bgBlockLegacy: number;
  hydratedWallCount: number;
}

/** Count rects/runs/points across all themes in a solids block. */
function countSolids(solids: SavedSolids | undefined): {
  byThemeRects: number; byThemeRuns: number; byThemePoints: number;
  v1Runs: number; v1Points: number;
} {
  let byThemeRects = 0, byThemeRuns = 0, byThemePoints = 0;
  let v1Runs = 0, v1Points = 0;
  if (!solids) return { byThemeRects, byThemeRuns, byThemePoints, v1Runs, v1Points };

  for (const layer of Object.values(solids.byTheme ?? {})) {
    byThemeRects  += layer.rects?.length  ?? 0;
    byThemeRuns   += layer.runs?.length   ?? 0;
    byThemePoints += layer.points?.length ?? 0;
  }
  for (const layer of Object.values(solids.v1ByTheme ?? {})) {
    v1Runs   += layer.runs?.length   ?? 0;
    v1Points += layer.points?.length ?? 0;
  }
  return { byThemeRects, byThemeRuns, byThemePoints, v1Runs, v1Points };
}

/** Count total primitives (rects + runs + points) in a SavedSolidLayer. */
function countSolidLayer(layer: SavedSolidLayer | undefined): number {
  if (!layer) return 0;
  return (layer.rects?.length ?? 0) + (layer.runs?.length ?? 0) + (layer.points?.length ?? 0);
}

/** Count total primitives (runs + points) in a Saved1x1Layer. */
function count1x1Layer(layer: Saved1x1Layer | undefined): number {
  if (!layer) return 0;
  return (layer.runs?.length ?? 0) + (layer.points?.length ?? 0);
}

/**
 * Audit a single room's raw JSON string and return a structured summary.
 * The `rawJson` should be the full room file content as a string.
 */
export function auditRoomJson(rawJson: string): RoomFileAuditEntry | null {
  let data: unknown;
  try { data = JSON.parse(rawJson); } catch { return null; }
  if (!isSavedRoomV2(data)) return null;
  const saved = data as SavedRoomV2;

  const [w, h] = saved.size;
  const solidCounts = countSolids(saved.solids);
  const hydratedWalls = hydrateSolidsByTheme(saved.solids);
  const exactWallCount = saved.exactWalls?.length ?? 0;

  // Compact zone layers (v3+)
  const waterLayerPrimitives = countSolidLayer(saved.waterLayer);
  const lavaLayerPrimitives  = countSolidLayer(saved.lavaLayer);
  // Legacy zone arrays (v2)
  const waterZoneLegacy = saved.waterZones?.length ?? 0;
  const lavaZoneLegacy  = saved.lavaZones?.length  ?? 0;

  // Compact blocker layers (v3+)
  const ambientClearPrimitives = count1x1Layer(saved.ambientBlockersClear);
  const ambientDarkPrimitives  = count1x1Layer(saved.ambientBlockersDark);
  // Legacy blocker array (v2)
  const ambientBlockerLegacy = saved.ambientBlockers?.length ?? 0;

  // Compact background layers (v3+)
  let bgLayerGroups = 0, bgLayerPrimitives = 0;
  if (saved.bgLayers) {
    bgLayerGroups = saved.bgLayers.length;
    for (const group of saved.bgLayers) bgLayerPrimitives += countSolidLayer(group.layer);
  }
  const bgBlockLegacy = saved.bgBlocks?.length ?? 0;

  return {
    roomId:                 saved.id,
    version:                saved.v,
    widthBlocks:            w,
    heightBlocks:           h,
    jsonBytes:              rawJson.length,
    exactWallCount,
    v1ByThemePrimitives:    solidCounts.v1Runs + solidCounts.v1Points,
    v1ByThemeRuns:          solidCounts.v1Runs,
    v1ByThemePoints:        solidCounts.v1Points,
    byThemePrimitives:      solidCounts.byThemeRects + solidCounts.byThemeRuns + solidCounts.byThemePoints,
    byThemeRects:           solidCounts.byThemeRects,
    byThemeRuns:            solidCounts.byThemeRuns,
    byThemePoints:          solidCounts.byThemePoints,
    waterLayerPrimitives,
    lavaLayerPrimitives,
    waterZoneLegacy,
    lavaZoneLegacy,
    ambientClearPrimitives,
    ambientDarkPrimitives,
    ambientBlockerLegacy,
    bgLayerGroups,
    bgLayerPrimitives,
    bgBlockLegacy,
    hydratedWallCount: hydratedWalls.length + exactWallCount + (saved.specialWalls?.length ?? 0),
  };
}

/**
 * Print a formatted audit table to the console for an array of room JSON strings.
 * Each entry is `{ id: string; rawJson: string }`.
 *
 * DEV-only — call from a dev panel, editor toolbar, or browser console.
 */
export function printRoomAuditTable(rooms: Array<{ id: string; rawJson: string }>): void {
  if (!import.meta.env.DEV) return;

  const entries: RoomFileAuditEntry[] = [];
  for (const { rawJson } of rooms) {
    const entry = auditRoomJson(rawJson);
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    console.log('[RoomAudit] No v2/v3 rooms to audit.');
    return;
  }

  const pad = (s: unknown, n: number) => String(s).padStart(n);
  const fmt = (n: number) => n === 0 ? '-' : String(n);

  console.group('[RoomAudit] Room file summary');
  console.log(
    [
      'Room ID'.padEnd(35),
      pad('v',       3),
      pad('WxH',     9),
      pad('bytes',   8),
      pad('exactW',  7),
      pad('v1prims', 8),
      pad('byPrims', 8),
      pad('watLyr',  7),
      pad('lavLyr',  7),
      pad('watLeg',  7),
      pad('lavLeg',  7),
      pad('ambClr',  7),
      pad('ambDrk',  7),
      pad('ambLeg',  7),
      pad('bgGrps',  7),
      pad('bgPrms',  7),
      pad('bgLeg',   6),
      pad('hydWls',  7),
    ].join(' '),
  );
  console.log('-'.repeat(170));

  for (const e of entries.sort((a, b) => b.jsonBytes - a.jsonBytes)) {
    console.log(
      [
        e.roomId.padEnd(35),
        pad(e.version, 3),
        pad(`${e.widthBlocks}x${e.heightBlocks}`, 9),
        pad(e.jsonBytes, 8),
        pad(fmt(e.exactWallCount), 7),
        pad(fmt(e.v1ByThemePrimitives), 8),
        pad(fmt(e.byThemePrimitives), 8),
        pad(fmt(e.waterLayerPrimitives), 7),
        pad(fmt(e.lavaLayerPrimitives), 7),
        pad(fmt(e.waterZoneLegacy), 7),
        pad(fmt(e.lavaZoneLegacy), 7),
        pad(fmt(e.ambientClearPrimitives), 7),
        pad(fmt(e.ambientDarkPrimitives), 7),
        pad(fmt(e.ambientBlockerLegacy), 7),
        pad(fmt(e.bgLayerGroups), 7),
        pad(fmt(e.bgLayerPrimitives), 7),
        pad(fmt(e.bgBlockLegacy), 6),
        pad(e.hydratedWallCount, 7),
      ].join(' '),
    );
  }

  const totalBytes = entries.reduce((s, e) => s + e.jsonBytes, 0);
  const totalExact = entries.reduce((s, e) => s + e.exactWallCount, 0);
  const totalV1    = entries.reduce((s, e) => s + e.v1ByThemePrimitives, 0);
  console.log('-'.repeat(170));
  console.log(`Rooms: ${entries.length}  Total JSON: ${(totalBytes / 1024).toFixed(1)} KB  exactWalls: ${totalExact}  v1Prims: ${totalV1}`);
  console.groupEnd();
}
