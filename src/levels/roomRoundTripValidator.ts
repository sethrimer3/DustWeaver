/**
 * roomRoundTripValidator.ts — Dev-only round-trip correctness checks.
 *
 * Validates that a dehydrate → hydrate cycle produces equivalent room coverage:
 *   • Same solid cells (no cells added or dropped)
 *   • Same per-cell block theme
 *   • Same 1×1 vs 2×2 visual grain (hBlock=1 walls stay hBlock=1)
 *   • Same special wall count and properties
 *
 * DEV-only — import and call from a dev panel or test harness.
 */

import type { RoomJsonDef, RoomJsonWall } from '../editor/roomJson';
import { dehydrateRoom } from './roomSchemaV2';
import { hydrateV2Room } from './roomSchemaHydrator';

// ─── Cell coverage helpers ────────────────────────────────────────────────────

/** Expand a wall rect into individual cell keys `"x,y"`. */
function wallCells(w: RoomJsonWall): string[] {
  const cells: string[] = [];
  for (let dy = 0; dy < w.hBlock; dy++) {
    for (let dx = 0; dx < w.wBlock; dx++) {
      cells.push(`${w.xBlock + dx},${w.yBlock + dy}`);
    }
  }
  return cells;
}

/** Build a Map<cellKey, theme|undefined> for all solid (non-special) walls. */
function buildCoverageMap(walls: RoomJsonWall[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const w of walls) {
    if (w.isPlatform || w.rampOrientation !== undefined || w.isPillarHalfWidth) continue;
    const themeVal = w.blockTheme ?? undefined;
    for (const key of wallCells(w)) map.set(key, themeVal);
  }
  return map;
}

/**
 * Build a Set of cell keys that have hBlock=1 grain.
 * Any cell covered by a wall with hBlock > 1 is considered 2×2-grain.
 */
function buildV1GrainSet(walls: RoomJsonWall[]): Set<string> {
  const v1 = new Set<string>();
  const v2plus = new Set<string>();
  for (const w of walls) {
    if (w.isPlatform || w.rampOrientation !== undefined || w.isPillarHalfWidth) continue;
    const cells = wallCells(w);
    if (w.hBlock === 1) {
      for (const k of cells) if (!v2plus.has(k)) v1.add(k);
    } else {
      for (const k of cells) { v2plus.add(k); v1.delete(k); }
    }
  }
  return v1;
}

// ─── Validation result ────────────────────────────────────────────────────────

export interface RoundTripValidationResult {
  roomId: string;
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Perform a full dehydrate→hydrate round-trip on `json` and report any
 * discrepancies.
 *
 * Checks:
 *  1. Solid cell coverage (no cells added or dropped)
 *  2. Per-cell theme (no theme changes)
 *  3. 1×1 vs 2×2 visual grain (cells that had hBlock=1 remain hBlock=1)
 *  4. Special wall count (platforms/ramps/pillars)
 */
export function validateRoundTrip(json: RoomJsonDef): RoundTripValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── dehydrate → hydrate ───────────────────────────────────────────────────
  let roundTripped: RoomJsonDef;
  try {
    const saved = dehydrateRoom(json);
    roundTripped = hydrateV2Room(saved);
  } catch (e) {
    return {
      roomId: json.id,
      passed: false,
      errors: [`Round-trip threw: ${e}`],
      warnings,
    };
  }

  // ── 1. Solid coverage + theme ─────────────────────────────────────────────
  const before = buildCoverageMap(json.interiorWalls);
  const after  = buildCoverageMap(roundTripped.interiorWalls);

  for (const [key, theme] of before) {
    if (!after.has(key)) {
      errors.push(`Cell ${key} was DROPPED (had theme ${theme ?? 'default'})`);
    } else if (after.get(key) !== theme) {
      errors.push(`Cell ${key} theme changed: ${theme ?? 'default'} → ${after.get(key) ?? 'default'}`);
    }
  }
  for (const [key, theme] of after) {
    if (!before.has(key)) {
      errors.push(`Cell ${key} was ADDED (theme ${theme ?? 'default'})`);
    }
  }

  // ── 2. Visual grain (1×1 vs 2×2) ─────────────────────────────────────────
  const grainBefore = buildV1GrainSet(json.interiorWalls);
  const grainAfter  = buildV1GrainSet(roundTripped.interiorWalls);

  for (const key of grainBefore) {
    if (!grainAfter.has(key)) {
      errors.push(`Cell ${key} had 1×1 grain before but has 2×2 grain after`);
    }
  }
  for (const key of grainAfter) {
    if (!grainBefore.has(key)) {
      errors.push(`Cell ${key} had 2×2 grain before but has 1×1 grain after`);
    }
  }

  // ── 3. Special walls ──────────────────────────────────────────────────────
  const specialBefore = json.interiorWalls.filter(w =>
    w.isPlatform || w.rampOrientation !== undefined || w.isPillarHalfWidth,
  );
  const specialAfter = roundTripped.interiorWalls.filter(w =>
    w.isPlatform || w.rampOrientation !== undefined || w.isPillarHalfWidth,
  );
  if (specialBefore.length !== specialAfter.length) {
    errors.push(`Special wall count changed: ${specialBefore.length} → ${specialAfter.length}`);
  }

  // ── 4. Room dimensions ────────────────────────────────────────────────────
  if (json.widthBlocks !== roundTripped.widthBlocks || json.heightBlocks !== roundTripped.heightBlocks) {
    errors.push(`Room size changed: ${json.widthBlocks}×${json.heightBlocks} → ${roundTripped.widthBlocks}×${roundTripped.heightBlocks}`);
  }

  // Truncate error list to avoid log flooding for big rooms
  const MAX_ERRORS = 20;
  if (errors.length > MAX_ERRORS) {
    const extra = errors.length - MAX_ERRORS;
    errors.splice(MAX_ERRORS, extra, `... and ${extra} more errors`);
  }

  return {
    roomId: json.id,
    passed: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a batch of rooms and print results to the console.
 * DEV-only.
 */
export function printRoundTripReport(rooms: RoomJsonDef[]): void {
  if (!import.meta.env.DEV) return;

  console.group('[RoundTrip] Room round-trip validation');
  let passed = 0;
  let failed = 0;
  for (const room of rooms) {
    const result = validateRoundTrip(room);
    if (result.passed) {
      passed++;
      console.log(`  ✓ ${result.roomId}`);
    } else {
      failed++;
      console.group(`  ✗ ${result.roomId} (${result.errors.length} errors)`);
      for (const e of result.errors) console.error(`    ${e}`);
      console.groupEnd();
    }
    for (const w of result.warnings) console.warn(`    ⚠ ${w}`);
  }
  console.log(`\n  Passed: ${passed}  Failed: ${failed}`);
  console.groupEnd();
}
