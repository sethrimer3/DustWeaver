/**
 * roomFileAudit.ts — Dev-only room file audit / report.
 *
 * Logs a summary table for each room in a campaign, covering:
 *   • JSON byte size
 *   • exactWalls count (old v2 format)
 *   • v1ByTheme primitive counts (runs, points) by theme
 *   • byTheme primitive counts (rects, runs, points) by theme
 *   • waterZone / lavaZone rectangle counts
 *   • bgBlock / ambientBlocker counts
 *   • hydrated wall count
 *
 * Usage (DEV mode only):
 *   import { auditRoomFiles } from './roomFileAudit';
 *   auditRoomFiles(campaignRooms);
 *
 * This module tree-shakes out of production builds via the DEV guard.
 */

import type { SavedRoomV2, SavedSolids } from './roomSavedTypes';
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
  waterZoneRects: number;
  lavaZoneRects: number;
  bgBlockCount: number;
  ambientBlockerCount: number;
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
  // Also count special walls that came from exactWalls in v2 (now folded into specialWalls
  // or v1ByTheme in v3). For diagnostic purposes we report both sources.

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
    waterZoneRects:         saved.waterZones?.length  ?? 0,
    lavaZoneRects:          saved.lavaZones?.length   ?? 0,
    bgBlockCount:           saved.bgBlocks?.length    ?? 0,
    ambientBlockerCount:    saved.ambientBlockers?.length ?? 0,
    hydratedWallCount:      hydratedWalls.length + (saved.exactWalls?.length ?? 0) + (saved.specialWalls?.length ?? 0),
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
      pad('v', 3),
      pad('WxH', 9),
      pad('bytes', 8),
      pad('exactW', 7),
      pad('v1prims', 8),
      pad('v1runs', 7),
      pad('v1pts', 6),
      pad('byPrims', 8),
      pad('rects', 6),
      pad('runs', 5),
      pad('pts', 4),
      pad('watZn', 6),
      pad('lavZn', 6),
      pad('bgBlk', 6),
      pad('ambBlk', 7),
      pad('hydWls', 7),
    ].join(' '),
  );
  console.log('-'.repeat(145));

  for (const e of entries.sort((a, b) => b.jsonBytes - a.jsonBytes)) {
    console.log(
      [
        e.roomId.padEnd(35),
        pad(e.version, 3),
        pad(`${e.widthBlocks}x${e.heightBlocks}`, 9),
        pad(e.jsonBytes, 8),
        pad(fmt(e.exactWallCount), 7),
        pad(fmt(e.v1ByThemePrimitives), 8),
        pad(fmt(e.v1ByThemeRuns), 7),
        pad(fmt(e.v1ByThemePoints), 6),
        pad(fmt(e.byThemePrimitives), 8),
        pad(fmt(e.byThemeRects), 6),
        pad(fmt(e.byThemeRuns), 5),
        pad(fmt(e.byThemePoints), 4),
        pad(fmt(e.waterZoneRects), 6),
        pad(fmt(e.lavaZoneRects), 6),
        pad(fmt(e.bgBlockCount), 6),
        pad(fmt(e.ambientBlockerCount), 7),
        pad(e.hydratedWallCount, 7),
      ].join(' '),
    );
  }

  const totalBytes = entries.reduce((s, e) => s + e.jsonBytes, 0);
  const totalExact = entries.reduce((s, e) => s + e.exactWallCount, 0);
  const totalV1 = entries.reduce((s, e) => s + e.v1ByThemePrimitives, 0);
  console.log('-'.repeat(145));
  console.log(`Rooms: ${entries.length}  Total JSON: ${(totalBytes / 1024).toFixed(1)} KB  exactWalls: ${totalExact}  v1Prims: ${totalV1}`);
  console.groupEnd();
}
