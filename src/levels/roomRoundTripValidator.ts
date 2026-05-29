/**
 * roomRoundTripValidator.ts — Dev-only round-trip correctness checks.
 *
 * Validates that a dehydrate → hydrate cycle produces equivalent room coverage:
 *   • Same solid cells (no cells added or dropped)
 *   • Same per-cell block theme
 *   • Same 1×1 vs 2×2 visual grain (hBlock=1 walls stay hBlock=1)
 *   • Same special wall count and properties
 *   • Same water zone cell coverage
 *   • Same lava zone cell coverage
 *   • Same ambient blocker cells (clear and dark separately)
 *   • Same background block cells, theme, and light-blocking identity
 *
 * DEV-only — import and call from a dev panel or test harness.
 */

import type { RoomJsonDef, RoomJsonWall, RoomJsonZone, RoomJsonBackgroundBlock } from '../editor/roomJson';
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

/** Expand a zone rect into individual cell keys `"x,y"`. */
function zoneCells(z: RoomJsonZone): string[] {
  const cells: string[] = [];
  for (let dy = 0; dy < z.hBlock; dy++) {
    for (let dx = 0; dx < z.wBlock; dx++) {
      cells.push(`${z.xBlock + dx},${z.yBlock + dy}`);
    }
  }
  return cells;
}

/** Build a Set<"x,y"> covering all cells in an array of zones. */
function buildZoneCoverage(zones: RoomJsonZone[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const z of zones ?? []) for (const k of zoneCells(z)) set.add(k);
  return set;
}

/** Build a Map<"x,y", isDark> for all ambient blocker entries. */
function buildBlockerMap(blockers: RoomJsonDef['ambientLightBlockers']): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const b of blockers ?? []) {
    map.set(`${b.xBlock},${b.yBlock}`, b.isDark ?? false);
  }
  return map;
}

/**
 * Build a Map<"x,y", string> for background blocks where the value encodes
 * `"theme|lb"` for comparison.
 */
function buildBgBlockMap(blocks: RoomJsonBackgroundBlock[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const b of blocks ?? []) {
    // Signature encodes the two properties we must preserve per cell.
    // Using "theme|lb" where '|' cannot appear in a theme name (theme names use
    // alphanumeric/underscore identifiers), so this concatenation is unambiguous.
    const themeStr = b.blockTheme ?? '';
    const lbStr    = b.isLightBlocking ? '1' : '0';
    const sig      = `${themeStr}|${lbStr}`;
    for (let dy = 0; dy < b.hBlock; dy++) {
      for (let dx = 0; dx < b.wBlock; dx++) {
        map.set(`${b.xBlock + dx},${b.yBlock + dy}`, sig);
      }
    }
  }
  return map;
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
 *  5. Water zone cell coverage
 *  6. Lava zone cell coverage
 *  7. Ambient blocker cells (clear and dark identity)
 *  8. Background block cells, theme, and light-blocking identity
 *  9. Baked wall template preservation (schema version, source hash, wall count, array lengths)
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

  // ── 5. Water zone coverage ────────────────────────────────────────────────
  const waterBefore = buildZoneCoverage(json.waterZones);
  const waterAfter  = buildZoneCoverage(roundTripped.waterZones);
  for (const k of waterBefore) if (!waterAfter.has(k)) errors.push(`Water cell ${k} DROPPED`);
  for (const k of waterAfter)  if (!waterBefore.has(k)) errors.push(`Water cell ${k} ADDED`);

  // ── 6. Lava zone coverage ─────────────────────────────────────────────────
  const lavaBefore = buildZoneCoverage(json.lavaZones);
  const lavaAfter  = buildZoneCoverage(roundTripped.lavaZones);
  for (const k of lavaBefore) if (!lavaAfter.has(k))  errors.push(`Lava cell ${k} DROPPED`);
  for (const k of lavaAfter)  if (!lavaBefore.has(k)) errors.push(`Lava cell ${k} ADDED`);

  // ── 7. Ambient blockers (clear and dark identity) ─────────────────────────
  const blkBefore = buildBlockerMap(json.ambientLightBlockers);
  const blkAfter  = buildBlockerMap(roundTripped.ambientLightBlockers);
  for (const [k, dark] of blkBefore) {
    if (!blkAfter.has(k)) {
      errors.push(`Ambient blocker ${k} DROPPED (isDark=${dark})`);
    } else if (blkAfter.get(k) !== dark) {
      errors.push(`Ambient blocker ${k} dark-flag changed: ${dark} → ${blkAfter.get(k)}`);
    }
  }
  for (const [k, dark] of blkAfter) {
    if (!blkBefore.has(k)) errors.push(`Ambient blocker ${k} ADDED (isDark=${dark})`);
  }

  // ── 8. Background blocks (cell + theme + lb identity) ─────────────────────
  const bgBefore = buildBgBlockMap(json.backgroundBlocks);
  const bgAfter  = buildBgBlockMap(roundTripped.backgroundBlocks);
  for (const [k, sig] of bgBefore) {
    if (!bgAfter.has(k)) {
      errors.push(`BG block ${k} DROPPED (sig=${sig})`);
    } else if (bgAfter.get(k) !== sig) {
      errors.push(`BG block ${k} sig changed: ${sig} → ${bgAfter.get(k)}`);
    }
  }
  for (const [k, sig] of bgAfter) {
    if (!bgBefore.has(k)) errors.push(`BG block ${k} ADDED (sig=${sig})`);
  }

  // ── 9. Baked wall template preservation ──────────────────────────────────
  const btBefore = json.bakedWallTemplate;
  const btAfter  = roundTripped.bakedWallTemplate;
  if (btBefore !== undefined) {
    if (btAfter === undefined) {
      errors.push('bakedWallTemplate was DROPPED by round-trip');
    } else {
      if (btAfter.schemaVersion !== btBefore.schemaVersion) {
        errors.push(`bakedWallTemplate schemaVersion changed: ${btBefore.schemaVersion} → ${btAfter.schemaVersion}`);
      }
      if (btAfter.sourceHash !== btBefore.sourceHash) {
        errors.push(`bakedWallTemplate sourceHash changed: ${btBefore.sourceHash} → ${btAfter.sourceHash}`);
      }
      if (btAfter.wallCount !== btBefore.wallCount) {
        errors.push(`bakedWallTemplate wallCount changed: ${btBefore.wallCount} → ${btAfter.wallCount}`);
      }
      const arrayFields: (keyof typeof btBefore)[] = [
        'xWorld', 'yWorld', 'wWorld', 'hWorld',
        'isPlatformFlag', 'platformEdge', 'themeIndex', 'soundHardnessIndex',
        'isInvisibleFlag', 'rampOrientationIndex', 'isPillarHalfWidthFlag',
        'isIceFlag', 'isUltraIceFlag',
      ];
      for (const field of arrayFields) {
        const arrBefore = btBefore[field] as number[];
        const arrAfter  = btAfter[field]  as number[];
        if (!Array.isArray(arrAfter) || arrAfter.length !== arrBefore.length) {
          errors.push(`bakedWallTemplate.${field} length changed: ${arrBefore.length} → ${Array.isArray(arrAfter) ? arrAfter.length : 'not-array'}`);
        }
      }
    }
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
